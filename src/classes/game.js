// server-side game logic for a texas hold 'em game
const Deck = require('./deck.js');
const Player = require('./player.js');
const Hand = require('pokersolver').Hand;
const { STARTING_CHIPS, MAX_PLAYERS } = require('../constants.js');

const Game = function (name, host) {
  this.deck = new Deck();
  this.host = host;
  this.players = [];
  this.status = 0;
  this.cardsPerPlayer = 2;
  this.currentlyPlayed = 0;
  this.gameWinner = null;
  this.gameName = name;
  this.roundNum = 0;
  this.roundData = {
    dealer: 0,
    bigBlind: '',
    smallBlind: '',
    turn: '',
    bets: [],
  };
  this.community = [];
  this.foldPot = 0;
  this.bigBlindWent = false;
  this.lastMoveParsed = { move: '', player: '' };
  this.roundInProgress = false;
  this.disconnectedPlayers = [];
  this.autoBuyIns = false;
  this.lastRebuyError = null;
  this.actionSeq = 0;
  this.started = false;
  this.persistent = false;
  this.runoutCards = 0;
  this.turnTimer = null;
  this.readyTimer = null;
  this.streetAdvanceTimer = null;
  this.pendingStreetAdvance = false;
  // >0 = give clients time to see seat bets, then collect-to-pot.
  // Tests set these to 0 for synchronous street advances.
  this.streetShowMs = 1500;
  this.streetCollectMs = 900;
  if (process.env.JEST_WORKER_ID != null) {
    this.streetShowMs = 0;
    this.streetCollectMs = 0;
  }
  this.debug = false;
  this.smallBlind = 1;
  this.bigBlind = 2;
  this.lastRaiseSize = this.bigBlind;

  const constructor = (function () {})(this);

  this.log = () => {
    if (this.debug) {
      console.log(...arguments);
    }
  };

  // Broke players (money === 0) sit out as spectators: skipped for cards,
  // blinds, and turn order, but stay in `this.players` so they can rebuy.
  this.nextActiveIndex = (fromIndex) => {
    let idx = fromIndex;
    for (let i = 0; i < this.players.length; i++) {
      idx = idx + 1 < this.players.length ? idx + 1 : 0;
      if (!this.players[idx].spectating) return idx;
    }
    return fromIndex;
  };

  this.assignBlind = () => {
    this.roundData.smallBlind = this.nextActiveIndex(this.roundData.dealer);
    this.roundData.bigBlind = this.nextActiveIndex(this.roundData.smallBlind);

    this.log('smallBlind: ' + this.roundData.smallBlind);
    this.log('bigBlind: ' + this.roundData.bigBlind);

    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].spectating) {
        this.players[i].setDealer(false);
        this.players[i].setBlind('');
        this.players[i].setStatus('Spectating');
        continue;
      }
      this.players[i].setDealer(i === this.roundData.dealer);
      if (i === this.roundData.bigBlind) {
        this.players[i].setBlind('Big Blind');
      } else if (i === this.roundData.smallBlind) {
        this.players[i].setBlind('Small Blind');
      } else {
        this.players[i].setBlind('');
      }
      this.players[i].setStatus('');
    }

    // The active player immediately preceding the big blind (in seating
    // order, skipping spectators) always coincides with the small blind.
    const goFirstIndex = this.roundData.smallBlind;
    this.roundData.turn = this.players[goFirstIndex].getUsername();
    this.players[goFirstIndex].setStatus('Their Turn');
    // Preflop the big blind is the opening bet, so the first raise must add at
    // least one big blind (i.e. raise to >= 2x the big blind).
    this.lastRaiseSize = this.bigBlind;
  };

  // A next hand can begin once every funded (money > 0) player has resolved
  // their ready-up choice (no 'undecided' left) AND at least two are 'ready'.
  this.canStartNextHand = () => {
    const funded = this.players.filter((p) => p.getMoney() > 0);
    const readyCount = funded.filter((p) => p.getReadyState() === 'ready').length;
    const undecidedCount = funded.filter(
      (p) => p.getReadyState() === 'undecided'
    ).length;
    return undecidedCount === 0 && readyCount >= 2;
  };

  // Record a successful player action and broadcast a dedicated sound event.
  // This is decoupled from rerender on purpose: end-of-hand paths
  // (all-fold -> endHand, showdown -> reveal) never emit a rerender, so
  // piggybacking the sound on rerender would drop the final action's sound.
  this.isStreetAdvancing = () =>
    !!(this.streetAdvanceTimer || this.pendingStreetAdvance);

  // Write/replace this player's numeric bet in the current street array.
  this.setPlayerStreetBet = (player, amount) => {
    const name = player.getUsername();
    const round = this.getCurrentRoundBets();
    if (round.some((a) => a.player == name)) {
      this.setCurrentRoundBets(
        round.map((a) => (a.player == name ? { player: name, bet: amount } : a))
      );
    } else {
      round.push({ player: name, bet: amount });
    }
  };

  this.recordAction = (move, socket, amount) => {
    const player = this.findPlayer(socket.id);
    const hasPlayer = player && typeof player.getUsername === 'function';
    const streetBet = hasPlayer ? this.getPlayerBetInStage(player) : 0;
    this.actionSeq++;
    this.emitPlayers('actionSound', {
      move: move,
      player: hasPlayer ? player.getUsername() : '',
      seq: this.actionSeq,
      amount: typeof amount === 'number' ? amount : streetBet || null,
      // Total chips this player has in the current betting round (for seat UI).
      streetBet: streetBet,
    });
  };

  // Single exit for a resolved move: sound/UI first, then street hold if needed.
  // Call sites must use this (or flushPendingStreetAdvance) so pending never stalls.
  this.flushPendingStreetAdvance = () => {
    if (this.pendingStreetAdvance) this.scheduleStreetAdvance();
  };

  this.finishResolvedAction = (move, socket, amount) => {
    this.recordAction(move, socket, amount);
    this.flushPendingStreetAdvance();
  };

  // Per-turn auto-act: if the player whose turn it is doesn't act within the
  // limit, auto check (when free) or fold for them. Re-armed on every rerender,
  // so each new turn resets the clock.
  this.scheduleTurnTimeout = () => {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (!this.roundInProgress) return;
    const turnPlayer = this.players.find((p) => p.getStatus() === 'Their Turn');
    if (!turnPlayer) return;
    this.turnTimer = setTimeout(() => this.autoAct(turnPlayer), 120000);
  };

  this.autoAct = (player) => {
    if (!this.roundInProgress || player.getStatus() !== 'Their Turn') return;
    if (this.isStreetAdvancing()) return;
    const moves = this.getPossibleMoves(player.socket);
    const move = moves.check === 'yes' ? 'check' : 'fold';
    if (move === 'check') this.check(player.socket);
    else this.fold(player.socket);
    this.finishResolvedAction(move, player.socket, null);
  };

  // Ready-up phase timeout: if the ready-up drags on (someone AFK), auto-set
  // every still-undecided funded player to 'watching' so the table can proceed.
  this.startReadyTimeout = () => {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.readyTimer = setTimeout(() => this.autoWatch(), 120000);
  };

  this.autoWatch = () => {
    this.readyTimer = null;
    if (this.roundInProgress) return;
    let changed = false;
    this.players.forEach((p) => {
      if (p.getMoney() > 0 && p.getReadyState() === 'undecided') {
        p.setReadyState('watching');
        changed = true;
      }
    });
    if (!changed) return;
    if (this.canStartNextHand()) this.startNewRound();
    else this.rerender();
  };

  this.startNewRound = () => {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.lastMoveParsed = { move: '', player: '' };
    this.foldPot = 0;
    this.bigBlindWent = false;
    this.community = [];
    this.roundData.turn = '';
    this.roundData.bets = [];

    // Only 'ready' funded players are dealt in this hand; everyone else
    // (broke, watching, or still-undecided) sits out as a spectator.
    for (pn of this.players) {
      pn.spectating = !(pn.getMoney() > 0 && pn.getReadyState() === 'ready');
    }

    // Never deal/blind a hand with fewer than two funded players: that
    // would either self-play a "heads-up" hand against a spectator or
    // stack both blinds onto a single seat. Pause until enough rebuy.
    const activePlayers = this.players.filter((p) => !p.spectating);
    if (activePlayers.length < 2) {
      this.roundInProgress = false;
      for (pn of this.players) {
        pn.cards = [];
        pn.allIn = false;
        pn.setBlind('');
        pn.setDealer(false);
        pn.setStatus(pn.spectating ? 'Spectating' : '');
      }
      this.emitPlayers('waitingForPlayers', {
        players: this.getPlayersArray(),
      });
      this.rerender();
      return;
    }

    this.roundInProgress = true;
    this.dealCards();
    this.log('deck len' + this.deck.cards.length);
    for (pn of this.players) {
      pn.allIn = false;
    }

    // Init dealer
    if (this.roundNum == 0) {
      const firstActive = this.players.findIndex((p) => !p.spectating);
      this.roundData.dealer = firstActive === -1 ? 0 : firstActive;
    } else {
      this.roundData.dealer = this.nextActiveIndex(this.roundData.dealer);
    }
    // Init blind and first player
    this.assignBlind();

    // handle big and small blind initial forced bets

    if (this.players[this.roundData.bigBlind].money < this.bigBlind) {
      this.players[this.roundData.bigBlind].money = 0;
      this.players[this.roundData.bigBlind].allIn = true;
      this.roundData.bets.push([
        {
          player: this.players[this.roundData.bigBlind].getUsername(),
          bet: this.bigBlind - this.players[this.roundData.bigBlind].money,
        },
      ]);
    } else {
      this.players[this.roundData.bigBlind].money =
        this.players[this.roundData.bigBlind].money - this.bigBlind;
      this.roundData.bets.push([
        {
          player: this.players[this.roundData.bigBlind].getUsername(),
          bet: this.bigBlind,
        },
      ]);
    }

    if (this.players[this.roundData.smallBlind].money == this.smallBlind) {
      this.players[this.roundData.smallBlind].money = 0;
      this.roundData.bets[0].push({
        player: this.players[this.roundData.smallBlind].getUsername(),
        bet: this.smallBlind - this.players[this.roundData.bigBlind].money,
      });
      this.players[this.roundData.smallBlind].allIn = true;
    } else {
      this.players[this.roundData.smallBlind].money =
        this.players[this.roundData.smallBlind].money - this.smallBlind;
      this.roundData.bets[0].push({
        player: this.players[this.roundData.smallBlind].getUsername(),
        bet: this.smallBlind,
      });
    }

    // A hand just began: 'ready' players must re-confirm next hand, so reset
    // them to 'undecided'. 'watching' players stay watching (persistent).
    for (pn of this.players) {
      if (pn.getReadyState() === 'ready') pn.setReadyState('undecided');
    }

    this.roundNum++;
    this.rerender();
  };

  // Room session chip ledger: live seats + finalized disconnects. Cleared only
  // when the room itself is destroyed / reset (no live players left).
  // Net = money − buyIns×STARTING_CHIPS (1 耻辱币 = −2000).
  this.getSessionLedger = () => {
    const rows = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const money = p.getMoney();
      const buyIns = p.buyIns || 0;
      rows.push({
        username: p.getUsername(),
        money,
        buyIns,
        net: money - buyIns * STARTING_CHIPS,
        present: true,
        reconnecting: !!p.pendingDisconnect,
      });
    }
    for (let i = 0; i < this.disconnectedPlayers.length; i++) {
      const p = this.disconnectedPlayers[i];
      const money = p.getMoney();
      const buyIns = p.buyIns || 0;
      rows.push({
        username: p.getUsername(),
        money,
        buyIns,
        net: money - buyIns * STARTING_CHIPS,
        present: false,
        reconnecting: false,
      });
    }
    // Most chips first.
    rows.sort((a, b) => b.money - a.money || a.username.localeCompare(b.username));
    return rows;
  };

  this.rerender = () => {
    this.ensurePlayerSeats();
    let playersData = [];
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      playersData.push({
        username: this.players[pn].getUsername(),
        status: this.players[pn].pendingDisconnect
          ? 'Reconnecting'
          : this.players[pn].getStatus(),
        blind: this.players[pn].getBlind(),
        dealer: this.players[pn].getDealer(),
        money: this.players[pn].getMoney(),
        buyIns: this.players[pn].buyIns,
        isChecked: this.playerIsChecked(this.players[pn]),
        readyState: this.players[pn].getReadyState(),
        reconnecting: !!this.players[pn].pendingDisconnect,
        seatIndex: this.players[pn].getSeatIndex(),
      });
    }
    const ledger = this.getSessionLedger();
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit('rerender', {
        community: this.community,
        topBet: this.getCurrentTopBet(),
        bets: this.roundData.bets,
        username: this.players[pn].getUsername(),
        round: this.roundNum,
        stage: this.getStageName(),
        pot: this.getCurrentPot(),
        players: playersData,
        ledger,
        myMoney: this.players[pn].getMoney(),
        myBet: this.getPlayerBetInStage(this.players[pn]),
        myStatus: this.players[pn].getStatus(),
        myBlind: this.players[pn].getBlind(),
        roundInProgress: this.roundInProgress,
        myReadyState: this.players[pn].getReadyState(),
        buyIns: this.players[pn].buyIns,
      });
    }
    this.scheduleTurnTimeout();
  };

  this.getCurrentPot = () => {
    if (this.roundData.bets == undefined || this.roundData.bets.length == 0)
      return 0;
    else {
      let sum = 0;
      for (let i = 0; i < this.roundData.bets.length; i++) {
        sum += this.roundData.bets[i].reduce(
          (acc, curr) =>
            curr.bet != 'Buy-in' && curr.bet != 'Fold'
              ? acc + curr.bet
              : acc + 0,
          0
        );
      }
      return this.foldPot + sum;
    }
  };

  this.getPlayerBetInStage = (player) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.getCurrentRoundBets() == undefined
    )
      return 0;
    const stageData = this.getCurrentRoundBets();
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (
        stageData[j].player == player.getUsername() &&
        stageData[j].bet != 'Buy-in' &&
        stageData[j].bet != 'Fold'
      ) {
        totalBetInStage += stageData[j].bet;
        break;
      }
    }
    return totalBetInStage;
  };

  this.getCurrentTopBet = () => {
    if (this.roundData.bets == undefined || this.roundData.bets.length == 0)
      return 0;
    else {
      let maxBet = 0;
      for (let i = 0; i < this.players.length; i++) {
        maxBet = Math.max(maxBet, this.getPlayerBetInStage(this.players[i]));
      }
      return maxBet;
    }
  };

  this.getStageName = () => {
    if (this.roundData.bets.length == 0) {
      return 'Waiting';
    } else if (this.roundData.bets.length == 1) {
      return 'Pre-Flop';
    } else if (this.roundData.bets.length == 2) {
      return 'Flop';
    } else if (this.roundData.bets.length == 3) {
      return 'Turn';
    } else if (this.roundData.bets.length == 4) {
      return 'River';
    } else {
      return 'Error';
    }
  };

  this.playerIsChecked = (playr) => {
    if (this.roundData.bets) {
      const bets = this.getCurrentRoundBets() || [];
      return bets.some((a) => a.player == playr.getUsername() && a.bet == 0);
    }
  };

  this.findFirstToGoPlayer = () => {
    if (
      !this.players[this.roundData.smallBlind] ||
      this.players[this.roundData.smallBlind].getStatus() == 'Fold' ||
      this.players[this.roundData.smallBlind].getStatus() == 'Spectating' ||
      this.players[this.roundData.smallBlind].allIn
    ) {
      let index = this.roundData.smallBlind;
      do {
        index = index - 1 < 0 ? this.players.length - 1 : index - 1;
      } while (
        this.players[index].getStatus() == 'Fold' ||
        this.players[index].getStatus() == 'Spectating' ||
        this.players[index].allIn
      );
      return index;
    } else {
      return this.roundData.smallBlind;
    }
  };

  this.getNonFoldedPlayer = () => {
    let numNonFolds = 0;
    let nonFolderPlayer;
    for (let i = 0; i < this.getNumPlayers(); i++) {
      if (
        this.players[i].getStatus() != 'Fold' &&
        this.players[i].getStatus() != 'Spectating'
      ) {
        numNonFolds++;
        nonFolderPlayer = this.players[i];
      }
    }
    return [numNonFolds, nonFolderPlayer];
  };

  this.updateStage = () => {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].getStatus() === 'Spectating') continue;
      if (
        i === this.findFirstToGoPlayer() &&
        this.players[i].getStatus() !== 'Fold'
      ) {
        this.players[i].setStatus('Their Turn');
      } else if (this.players[i].getStatus() !== 'Fold') {
        this.players[i].setStatus('');
      }
    }
    this.roundData.bets.push([]);
    // New betting round (flop/turn/river): the minimum raise resets to the big blind.
    this.lastRaiseSize = this.bigBlind;
  };

  // Pause briefly after a betting round closes so clients can: (1) show the
  // last call/all-in at each seat, (2) animate chips into the pot, (3) then
  // clear seat bets and deal the next street / reveal.
  this.clearTheirTurn = () => {
    for (const p of this.players) {
      if (p.getStatus() === 'Their Turn') p.setStatus('');
    }
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  };

  this.scheduleStreetAdvance = () => {
    if (this.streetAdvanceTimer) {
      clearTimeout(this.streetAdvanceTimer);
      this.streetAdvanceTimer = null;
    }
    this.pendingStreetAdvance = false;
    this.clearTheirTurn();

    // Snapshot who has chips in for this street — clients paint these on seats
    // and hold for streetShowMs before collect animation.
    const streetBets = {};
    for (const p of this.players) {
      const amt = this.getPlayerBetInStage(p);
      if (amt > 0) streetBets[p.getUsername()] = amt;
    }
    this.rerender();
    this.emitPlayers('holdStreetBets', {
      bets: streetBets,
      pot: this.getCurrentPot(),
      holdMs: this.streetShowMs,
      collectMs: this.streetCollectMs,
    });

    const runCollect = () => {
      this.emitPlayers('collectBets', {
        pot: this.getCurrentPot(),
        bets: streetBets,
        collectMs: this.streetCollectMs,
      });
      const finish = () => {
        this.streetAdvanceTimer = null;
        this.advanceStreet();
      };
      if (this.streetCollectMs <= 0) finish();
      else this.streetAdvanceTimer = setTimeout(finish, this.streetCollectMs);
    };

    if (this.streetShowMs <= 0) runCollect();
    else this.streetAdvanceTimer = setTimeout(runCollect, this.streetShowMs);
  };

  this.finishShowdown = () => {
    const roundResults = this.evaluateWinners();
    for (playerResult of roundResults.playersData) {
      playerResult.player.setStatus(playerResult.hand.name);
    }
    const winningData = this.distributeMoney(roundResults);
    this.roundInProgress = false;
    const winners = winningData.filter((a) => a.winner);
    const dealMs =
      this.runoutCards > 0 ? this.runoutCards * 1000 + 1000 : 350;
    this.runoutCards = 0;
    setTimeout(() => this.revealCards(winners), dealMs);
  };

  this.advanceStreet = () => {
    const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
    if (numNonFolds == 1) {
      this.log('everyone folded except one');
      nonFolderPlayer.money = this.getCurrentPot() + nonFolderPlayer.money;
      this.endHandAllFold(nonFolderPlayer.getUsername());
      return;
    }

    if (this.allPlayersAllIn()) {
      this.log(' all players all in');
      this.runoutCards = 0;
      if (this.roundData.bets.length == 1) {
        this.community.push(this.deck.dealRandomCard());
        this.community.push(this.deck.dealRandomCard());
        this.community.push(this.deck.dealRandomCard());
        this.roundData.bets.push([]);
        this.runoutCards += 3;
      }
      if (this.roundData.bets.length == 2) {
        this.community.push(this.deck.dealRandomCard());
        this.roundData.bets.push([]);
        this.runoutCards += 1;
      }
      if (this.roundData.bets.length == 3) {
        this.community.push(this.deck.dealRandomCard());
        this.roundData.bets.push([]);
        this.runoutCards += 1;
      }
      // Runout dealt into empty stage shells — go straight to showdown.
      this.rerender();
      this.finishShowdown();
      return;
    }

    if (this.roundData.bets.length == 1) {
      this.community.push(this.deck.dealRandomCard());
      this.community.push(this.deck.dealRandomCard());
      this.community.push(this.deck.dealRandomCard());
      this.updateStage();
      this.rerender();
    } else if (this.roundData.bets.length == 2) {
      this.community.push(this.deck.dealRandomCard());
      this.updateStage();
      this.rerender();
    } else if (this.roundData.bets.length == 3) {
      this.community.push(this.deck.dealRandomCard());
      this.updateStage();
      this.rerender();
    } else if (this.roundData.bets.length == 4) {
      this.finishShowdown();
    } else {
      this.log('This stage of the round is INVALID!!');
    }
  };

  this.moveOntoNextPlayer = () => {
    let handOver = false;
    if (this.isStageComplete()) {
      this.log('stage complete');
      const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
      if (numNonFolds == 1) {
        this.log('everyone folded except one');
        nonFolderPlayer.money = this.getCurrentPot() + nonFolderPlayer.money;
        this.endHandAllFold(nonFolderPlayer.getUsername());
        handOver = true;
      } else {
        // Defer street deal / showdown so the closing bet is visible first.
        // Live play: app.js calls scheduleStreetAdvance AFTER recordAction.
        // Tests (streetShowMs === 0): schedule immediately for sync advances.
        this.pendingStreetAdvance = true;
        this.clearTheirTurn();
        handOver = true; // skip the immediate rerender below
        if (this.streetShowMs <= 0) this.scheduleStreetAdvance();
      }
    } else {
      this.log('stage not complete');
      //check if everyone folded except one player
      const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
      if (!handOver && numNonFolds == 1) {
        // everyone folded, start new round, give pot to player
        this.log('everyone folded except one');
        nonFolderPlayer.money = this.getCurrentPot() + nonFolderPlayer.money;
        this.endHandAllFold(nonFolderPlayer.getUsername());
        handOver = true;
      } else {
        let currTurnIndex = 0;
        //check if move just made was a fold
        if (this.lastMoveParsed.move == 'Fold') {
          currTurnIndex = this.players.findIndex(
            (p) => p === this.lastMoveParsed.player
          );
          this.lastMoveParsed = { move: '', player: '' };
        } else {
          currTurnIndex = this.players.findIndex(
            (p) => p.getStatus() === 'Their Turn'
          );
          this.players[currTurnIndex].setStatus('');
        }
        let count = 0;
        do {
          currTurnIndex = currTurnIndex - 1 < 0 ? this.players.length - 1 : currTurnIndex - 1;
          count ++;
        } while (
          (this.players[currTurnIndex].getStatus() == 'Fold'
          || this.players[currTurnIndex].getStatus() == 'Spectating'
          || this.players[currTurnIndex].allIn)
          && count < Object.keys(this.players).length * 2 // Avoid infinite loop, allow search twice on all players
        );
        this.players[currTurnIndex].setStatus('Their Turn');
      }
    }
    if (!handOver) {
      this.log('RERENDERING');
      this.rerender();
    }
  };

  this.getPlayerBetInStageNum = (player, stageNum) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.roundData.bets[stageNum - 1] == undefined
    )
      return 0;
    const stageData = this.roundData.bets[stageNum - 1];
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (
        stageData[j].player == player.getUsername() &&
        stageData[j].bet != 'Buy-in' &&
        stageData[j].bet != 'Fold'
      )
        totalBetInStage += stageData[j].bet;
    }
    return totalBetInStage;
  };

  this.getTotalBetsInStageNum = (stageNum) => {
    if (
      this.roundData.bets == undefined ||
      this.roundData.bets.length == 0 ||
      this.roundData.bets[stageNum - 1] == undefined
    )
      return 0;
    const stageData = this.roundData.bets[stageNum - 1];
    let totalBetInStage = 0;

    for (let j = 0; j < stageData.length; j++) {
      if (stageData[j].bet != 'Buy-in' && stageData[j].bet != 'Fold')
        totalBetInStage += stageData[j].bet;
    }
    return totalBetInStage;
  };

  this.getTotalInvested = (player) => {
    return (
      this.getPlayerBetInStageNum(player, 1) +
      this.getPlayerBetInStageNum(player, 2) +
      this.getPlayerBetInStageNum(player, 3) +
      this.getPlayerBetInStageNum(player, 4)
    );
  };

  this.calculateMoney = (winnerPot, players) => {
    let playerInvestments = [...players];
    while (playerInvestments.length > 1) {
      const sortedByInvested = playerInvestments.sort((a, b) =>
        a.invested < b.invested ? -1 : 1
      );
      const minStack = sortedByInvested[0].invested;
      winnerPot += minStack * playerInvestments.length;
      for (p of playerInvestments) {
        p.invested -= minStack;
      }
      const sortedByHandStrength = playerInvestments.filter((p) => p.live);
      let maxHand = -1;
      for (let p of sortedByHandStrength) {
        if (p.handStrength > maxHand) maxHand = p.handStrength;
      }
      const winners = sortedByHandStrength.filter(
        (p) => p.handStrength === maxHand
      );
      for (p of winners) {
        p.result += winnerPot / winners.length;
        // Only pot awards count as "winner" — not uncalled-bet returns below.
        if (winnerPot > 0) p.winner = true;
      }
      playerInvestments = playerInvestments.filter((p) => p.invested > 0);
      winnerPot = 0;
    }

    if (playerInvestments.length === 1) {
      let p = playerInvestments[0];
      // Leftover chips / uncalled bet — money comes back, but this is not a win.
      p.result += winnerPot + p.invested;
    }
  };

  // Total-order hand strength for every showdown hand, kickers included.
  //
  // pokersolver's `hand.rank` only encodes the hand CATEGORY (High Card = 1 …
  // Straight Flush = 9); it ignores kickers. Ranking side pots by `hand.rank`
  // alone mis-scores hands that share a category — two "High Card" hands with
  // different kickers, or a pair of Kings vs a pair of Queens — as equal, so a
  // pot one player clearly won gets split and everyone lights up "Winner".
  //
  // Derive a real total order by repeatedly asking pokersolver for the current
  // best hand(s): each "layer" of co-best hands shares a strength, genuinely
  // tied hands share a strength, and stronger hands score higher. Values are
  // only ever compared against each other, so their absolute size is irrelevant.
  this.rankHandStrengths = (playersData) => {
    const strengthByHand = new Map();
    let remaining = playersData.map((pd) => pd.hand);
    let level = remaining.length;
    while (remaining.length > 0) {
      const best = Hand.winners(remaining);
      for (const hand of best) strengthByHand.set(hand, level);
      remaining = remaining.filter((hand) => !best.includes(hand));
      level--;
    }
    return strengthByHand;
  };

  this.distributeMoney = (result) => {
    const playersData = result.playersData || [];
    // Rank once, up front, so every side pot shares one consistent total order.
    const strengthByHand = this.rankHandStrengths(playersData);
    let playerInvestments = this.players.map((p) => {
      // Every live player needs a real hand strength for side pots. Losers left
      // at -1 (folded / not at showdown) can never out-rank a live hand.
      const playerHand = playersData.find((pd) => pd.player === p);
      const invested = this.getTotalInvested(p);
      return {
        player: p,
        invested: invested,
        originalInvested: invested,
        handStrength: playerHand ? strengthByHand.get(playerHand.hand) : -1,
        result: -invested,
        live: p.getStatus() !== 'Fold' && p.getStatus() !== 'Spectating',
        winner: false,
        gain: 0,
      };
    });
    let pot = this.foldPot;
    this.calculateMoney(pot, playerInvestments);

    for (p of playerInvestments) {
      p.gain = p.originalInvested + p.result;
      p.player.money += p.gain;
    }
    return playerInvestments;
  };

  this.evaluateWinners = () => {
    let handArray = [];
    let playerArray = [];
    for (let i = 0; i < this.players.length; i++) {
      if (
        this.players[i].getStatus() != 'Fold' &&
        this.players[i].getStatus() != 'Spectating'
      ) {
        let h = Hand.solve(
          this.convertCardsFormat(this.players[i].cards.concat(this.community))
        );
        handArray.push(h);
        playerArray.push({ player: this.players[i], hand: h });
      }
    }
    const winners = Hand.winners(handArray);

    let winnerData = [];
    if (Array.isArray(winners)) {
      for (playerHand of playerArray) {
        for (winner of winners) {
          // Compare as strings — Card objects coerce, but keep it explicit.
          const playerCards = playerHand.hand.cards.map(String).sort();
          const winnerCards = winner.toString().split(', ').sort();
          if (this.arraysEqual(playerCards, winnerCards)) {
            winnerData.push({
              player: playerHand.player,
              rank: playerHand.hand.rank,
              handTitle: playerHand.hand.name,
            });
            break;
          }
        }
      }
    } else {
      this.log('fatal error: winner cannot be calculated');
    }
    const res = { winnerData: winnerData, playersData: playerArray };
    return res;
  };

  this.arraysEqual = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length != b.length) return false;

    for (let i = 0; i < a.length; ++i) {
      if (a[i] != b[i]) return false;
    }
    return true;
  };

  this.convertCardsFormat = (arr) => {
    let res = [];
    for (let i = 0; i < arr.length; i++) {
      let str = '';
      let value = arr[i].getValue();
      let suit = arr[i].getSuit();
      if (value == 10) {
        str += 'T';
      } else {
        str += value.toString();
      }
      if (suit == '♠') str += 's';
      else if (suit == '♥') str += 'h';
      else if (suit == '♦') str += 'd';
      else if (suit == '♣') str += 'c';
      res.push(str);
    }
    return res;
  };

  this.endHandAllFold = (username) => {
    this.log('endhandallfold' + this.players);
    this.roundInProgress = false;
    let cardData = [];
    for (let i = 0; i < this.players.length; i++) {
      cardData.push({
        username: this.players[i].getUsername(),
        money: this.players[i].getMoney(),
        text: this.players[i].getStatus(),
        readyState: this.players[i].getReadyState(),
        seatIndex: this.players[i].getSeatIndex(),
      });
    }
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit('endHand', {
        winner: username,
        folded: this.players[pn].getUsername() != username ? 'Fold' : '',
        username: this.players[pn].getUsername(),
        pot: this.getCurrentPot(),
        money: this.players[pn].getMoney(),
        cards: cardData,
        bets: this.roundData.bets,
        myReadyState: this.players[pn].getReadyState(),
        roundInProgress: this.roundInProgress,
      });
    }
    // Pot already paid out — clear so ready-phase rerenders don't re-show it.
    this.clearTableStakes();
    this.startReadyTimeout();
  };

  this.revealCards = (winners) => {
    this.log('revealllllll');
    this.roundInProgress = false;
    let cardData = [];
    for (let i = 0; i < this.players.length; i++) {
      const winData = winners.find((w) => w.player === this.players[i]);
      cardData.push({
        username: this.players[i].getUsername(),
        cards: this.players[i].cards,
        hand: this.players[i].getStatus(),
        folded: this.players[i].getStatus() == 'Fold',
        money: this.players[i].getMoney(),
        buyIns: this.players[i].buyIns,
        readyState: this.players[i].getReadyState(),
        gain: winData ? winData.gain : null,
        seatIndex: this.players[i].getSeatIndex(),
      });
    }
    const winnersUsernames = winners.map((a) => a.player.getUsername());
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit('reveal', {
        username: this.players[pn].getUsername(),
        money: this.players[pn].getMoney(),
        cards: cardData,
        bets: this.roundData.bets,
        winners: winnersUsernames,
        hand: this.players[pn].getStatus(),
        myReadyState: this.players[pn].getReadyState(),
        roundInProgress: this.roundInProgress,
      });
    }
    this.clearTableStakes();
    this.startReadyTimeout();
  };

  // After a hand is awarded, drop bet/pot state so between-hand UI shows $0.
  this.clearTableStakes = () => {
    this.roundData.bets = [];
    this.foldPot = 0;
  };

  this.allPlayersAllIn = () => {
    let participatingPlayers = 0;
    for (player of this.players) {
      if (
        !player.allIn &&
        player.getStatus() != 'Fold' &&
        player.getStatus() != 'Spectating'
      )
        participatingPlayers++;
    }
    return participatingPlayers <= 1;
  };

  this.isStageComplete = () => {
    let allPlayersPresent = false;
    let numUnfolded = 0;
    for (let i = 0; i < this.players.length; i++) {
      if (
        this.players[i].status != 'Fold' &&
        this.players[i].status != 'Spectating' &&
        !this.players[i].allIn
      )
        numUnfolded++;
    }
    const currRound = this.getCurrentRoundBets();
    if (this.roundData.bets.length == 1) {
      allPlayersPresent =
        currRound.filter((a) => a.bet != 'Fold').length >= numUnfolded &&
        this.bigBlindWent;
    } else {
      allPlayersPresent =
        currRound.filter((a) => a.bet != 'Fold').length >= numUnfolded;
    }
    this.log('all players present ' + allPlayersPresent);
    let allPlayersCall = true;
    for (player of this.players) {
      if (
        player.getStatus() != 'Fold' &&
        player.getStatus() != 'Spectating' &&
        this.getPlayerBetInStage(player) != this.getCurrentTopBet() &&
        !player.allIn
      ) {
        allPlayersCall = false;
        break;
      }
    }
    this.log('all players call ' + allPlayersCall);
    return allPlayersPresent && allPlayersCall;
  };

  this.setCardsPerPlayer = (numCards) => {
    this.cardsPerPlayer = numCards;
  };

  this.getHostName = () => {
    return this.host;
  };

  this.getPlayersArray = () => {
    return this.players.map((p) => {
      return p.getUsername();
    });
  };

  this.getCode = () => {
    return this.gameName;
  };

  this.getOccupiedSeatIndexes = () => {
    return this.players
      .map((p) => p.getSeatIndex())
      .filter((i) => i != null && i >= 0);
  };

  this.pickRandomEmptySeat = (preferSeat) => {
    const taken = new Set(this.getOccupiedSeatIndexes());
    if (
      preferSeat != null &&
      preferSeat >= 0 &&
      preferSeat < MAX_PLAYERS &&
      !taken.has(preferSeat)
    ) {
      return preferSeat;
    }
    const empty = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (!taken.has(i)) empty.push(i);
    }
    if (empty.length === 0) return null;
    return empty[Math.floor(Math.random() * empty.length)];
  };

  this.sortPlayersBySeat = () => {
    this.players.sort((a, b) => {
      const sa = a.getSeatIndex();
      const sb = b.getSeatIndex();
      if (sa == null && sb == null) return 0;
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sa - sb;
    });
  };

  // Assign seats to anyone still missing one (e.g. hot-reload / old sessions).
  this.ensurePlayerSeats = () => {
    let changed = false;
    for (const p of this.players) {
      if (p.getSeatIndex() == null) {
        const seat = this.pickRandomEmptySeat();
        if (seat != null) {
          p.setSeatIndex(seat);
          changed = true;
        }
      }
    }
    if (changed) this.sortPlayersBySeat();
  };

  this.addPlayer = (playerName, socket, preferSeat) => {
    const seat = this.pickRandomEmptySeat(
      preferSeat != null ? preferSeat : undefined
    );
    if (seat == null) return null;
    const player = new Player(playerName, socket, this.debug);
    player.setSeatIndex(seat);
    this.players.push(player);
    this.sortPlayersBySeat();
    return player;
  };

  // Reconnect a player who left. Prefers an in-progress grace-period seat
  // (page refresh) so the hand continues; otherwise restores a finalized
  // disconnect session (chips + shame coins). Returns null if neither exists.
  this.reconnectPlayer = (playerName, socket) => {
    const live = this.players.find(
      (p) => p.getUsername() === playerName && p.pendingDisconnect
    );
    if (live) {
      if (live.disconnectTimer) {
        clearTimeout(live.disconnectTimer);
        live.disconnectTimer = null;
      }
      live.pendingDisconnect = false;
      live.socket = socket;
      this.rerender();
      return live;
    }

    const idx = this.disconnectedPlayers.findIndex(
      (p) => p.getUsername() === playerName
    );
    if (idx === -1) return null;
    const player = this.disconnectedPlayers[idx];
    this.disconnectedPlayers.splice(idx, 1);
    player.socket = socket;
    player.pendingDisconnect = false;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    if (player.getMoney() > 0) player.setReadyState('undecided');
    // Keep prior seat if still free; otherwise pick a random empty chair.
    const seat = this.pickRandomEmptySeat(player.getSeatIndex());
    if (seat == null) return null;
    player.setSeatIndex(seat);
    this.players.push(player);
    this.sortPlayersBySeat();
    return player;
  };

  // Mark a dropped socket so a refresh can reclaim the seat. Caller (app.js)
  // owns the grace timer and must call disconnectPlayer if it expires.
  this.markPendingDisconnect = (player) => {
    if (!player || typeof player.getUsername !== 'function') return;
    if (player.pendingDisconnect) return;
    player.pendingDisconnect = true;
    this.rerender();
  };

  this.clearPendingDisconnect = (player) => {
    if (!player) return;
    player.pendingDisconnect = false;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
  };

  this.getNumPlayers = () => {
    return this.players.length;
  };

  this.startGame = () => {
    this.started = true;
    // The host chose to start, so treat every funded player as 'ready' for
    // the first hand (seeds an immediate deal when >= 2 are funded).
    for (pn of this.players) {
      pn.setReadyState(pn.getMoney() > 0 ? 'ready' : 'undecided');
    }
    // Note: no dealCards() here — startNewRound() below sets `spectating` first
    // and then deals, so broke/watching players are correctly skipped. Dealing
    // here would deal to everyone (spectating not yet set).
    this.emitPlayers('startGame', {
      players: this.players.map((p) => {
        return p.username;
      }),
    });
    this.startNewRound();
  };

  this.dealCards = () => {
    this.deck.shuffle();
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].cards = [];
      if (this.players[pn].spectating) continue;
      for (let i = 0; i < this.cardsPerPlayer; i++) {
        this.players[pn].addCard(this.deck.dealRandomCard());
      }
    }

    this.refreshCards();
  };

  this.refreshCards = function () {
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].cards.sort((a, b) => {
        return a.compare(b);
      });

      this.players[pn].emit('dealt', {
        currBet: this.getCurrentTopBet(),
        username: this.players[pn].getUsername(),
        cards: this.players[pn].cards,
        players: this.players.map((p) => {
          return p.username;
        }),
      });
    }
  };

  this.emitPlayers = (eventName, payload) => {
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      this.players[pn].emit(eventName, payload);
    }
  };

  this.findPlayer = (socketId) => {
    for (let pn = 0; pn < this.getNumPlayers(); pn++) {
      if (this.players[pn].socket.id === socketId) {
        return this.players[pn];
      }
    }
    return { socket: { id: 0 } };
  };

  this.setReady = (socket, choice) => {
    const player = this.findPlayer(socket.id);
    if (!player || typeof player.getMoney !== 'function') {
      return false;
    }
    // Only meaningful between hands.
    if (this.roundInProgress) {
      return false;
    }
    // Broke players rebuy rather than ready up.
    if (player.getMoney() === 0) {
      return false;
    }
    if (choice !== 'ready' && choice !== 'watching') {
      return false;
    }
    player.setReadyState(choice);
    if (this.canStartNextHand()) {
      this.startNewRound();
    } else {
      this.rerender();
    }
    return true;
  };

  this.rebuy = (socket) => {
    const player = this.findPlayer(socket.id);
    if (!player || typeof player.getMoney !== 'function') {
      this.lastRebuyError = 'room_not_found';
      return false;
    }
    // Rebuying mid-hand would corrupt the hand in progress (e.g. promoting
    // a spectator into blinds/turn order); only allow it between hands.
    if (this.roundInProgress) {
      this.lastRebuyError = 'hand_in_progress';
      return false;
    }
    if (player.getMoney() !== 0) {
      this.lastRebuyError = 'not_broke';
      return false;
    }
    player.money = STARTING_CHIPS;
    player.buyIns = (player.buyIns || 0) + 1;
    player.spectating = false;
    player.setStatus('');
    // A rebuyer sits out by default until they actively opt back in.
    player.setReadyState('watching');
    this.lastRebuyError = null;
    this.emitPlayers('playerRebuy', {
      player: player.getUsername(),
      money: player.getMoney(),
      buyIns: player.buyIns,
    });
    this.rerender();
    return true;
  };

  this.disconnectPlayer = (player) => {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.pendingDisconnect = false;
    this.disconnectedPlayers.push(player);

    const wasTheirTurn = player.getStatus() === 'Their Turn';
    let foldedNow = false;

    // Mid-hand leave = fold. Their chips already in the pot stay there.
    if (this.roundInProgress && player.getStatus() !== 'Fold') {
      if (player.getBlind() === 'Big Blind' && this.roundData.bets.length === 1) {
        this.bigBlindWent = true;
      }
      const stageBets = this.getCurrentRoundBets() || [];
      let preFoldBetAmount = 0;
      const existing = stageBets.find((a) => a.player == player.getUsername());
      if (existing != undefined && existing.bet != 'Fold') {
        preFoldBetAmount += existing.bet;
      }
      this.foldPot = this.foldPot + preFoldBetAmount;
      player.setStatus('Fold');
      if (existing) {
        this.setCurrentRoundBets(
          stageBets.map((a) =>
            a.player == player.getUsername()
              ? { player: player.getUsername(), bet: 'Fold' }
              : a
          )
        );
      } else {
        stageBets.push({ player: player.getUsername(), bet: 'Fold' });
        this.setCurrentRoundBets(stageBets);
      }
      this.lastMoveParsed = { move: 'Fold', player: player };
      foldedNow = true;
      this.recordAction('fold', player.socket, null);
    }

    if (this.roundInProgress && foldedNow) {
      const [numNonFolds, nonFolderPlayer] = this.getNonFoldedPlayer();
      if (numNonFolds == 1) {
        // Leaving player was the last opponent — award pot immediately,
        // whether or not it was their turn to act.
        nonFolderPlayer.money =
          this.getCurrentPot() + nonFolderPlayer.money;
        this.endHandAllFold(nonFolderPlayer.getUsername());
      } else if (wasTheirTurn) {
        this.moveOntoNextPlayer();
        this.flushPendingStreetAdvance();
      }
    }

    this.players = this.players.filter((a) => a !== player);
    if (player.getUsername() == this.host && this.players.length > 0) {
      this.host = this.players[0].getUsername();
    }
    this.emitPlayers('playerDisconnected', { player: player.getUsername() });
    this.emitPlayers('joinRoomUpdate', {
      players: this.getPlayersArray(),
      code: this.getCode(),
    });
    this.emitPlayers('hostRoomUpdate', { players: this.getPlayersArray() });
    // If the departing player was the only one stalling the ready-up phase,
    // try to start the next hand now so the table doesn't sit idle.
    if (!this.roundInProgress && this.canStartNextHand()) {
      this.startNewRound();
    } else {
      this.rerender();
    }
  };

  this.checkBigBlindWent = (socket) => {
    if (
      this.findPlayer(socket.id).blindValue == 'Big Blind' &&
      this.roundData.bets.length == 1
    ) {
      this.bigBlindWent = true;
    }
  };

  this.getCurrentRoundBets = () => {
    return this.roundData.bets[this.roundData.bets.length - 1];
  };

  this.setCurrentRoundBets = (bets) => {
    return (this.roundData.bets[this.roundData.bets.length - 1] = bets);
  };

  this.fold = (socket) => {
    if (this.isStreetAdvancing()) return false;
    this.checkBigBlindWent(socket);
    const player = this.findPlayer(socket.id);
    let preFoldBetAmount = 0;

    let roundDataStage = this.getCurrentRoundBets().find(
      (a) => a.player == player.getUsername()
    );
    if (roundDataStage != undefined && roundDataStage.bet != 'Fold') {
      preFoldBetAmount += roundDataStage.bet;
    }
    player.setStatus('Fold');
    this.foldPot = this.foldPot + preFoldBetAmount;
    if (
      this.getCurrentRoundBets().some((a) => a.player == player.getUsername())
    ) {
      this.setCurrentRoundBets(
        this.getCurrentRoundBets().map((a) =>
          a.player == player.getUsername()
            ? { player: player.getUsername(), bet: 'Fold' }
            : a
        )
      );
    } else {
      this.getCurrentRoundBets().push({
        player: player.getUsername(),
        bet: 'Fold',
      });
    }
    this.lastMoveParsed = { move: 'Fold', player: player };
    this.moveOntoNextPlayer();
    return true;
  };

  this.call = (socket) => {
    if (this.isStreetAdvancing()) return false;
    this.checkBigBlindWent(socket);
    const player = this.findPlayer(socket.id);
    if (!player || typeof player.getUsername !== 'function') return false;
    const currBet = this.getPlayerBetInStage(player);
    const topBet = this.getCurrentTopBet();
    const need = topBet - currBet;
    if (need < 0) return false;

    if (player.getMoney() <= need) {
      // All-in for the remainder (may be less than topBet).
      this.setPlayerStreetBet(player, currBet + player.getMoney());
      player.money = 0;
      player.allIn = true;
    } else {
      this.setPlayerStreetBet(player, topBet);
      player.money -= need;
    }
    this.moveOntoNextPlayer();
    return true;
  };

  this.bet = (socket, bet) => {
    if (this.isStreetAdvancing()) return false;
    this.checkBigBlindWent(socket);
    if (bet >= this.bigBlind) {
      const player = this.findPlayer(socket.id);
      if (player.getMoney() - bet >= 0) {
        this.setPlayerStreetBet(player, bet);
        player.money = player.money - bet;
        if (player.money == 0) player.allIn = true;
        this.lastRaiseSize = bet; // an opening bet sets the new min-raise increment
        this.moveOntoNextPlayer();
        return true;
      }
    }
  };

  this.check = (socket) => {
    if (this.isStreetAdvancing()) return false;
    this.checkBigBlindWent(socket);
    let currBet = 0;
    const player = this.findPlayer(socket.id);
    if (
      this.getCurrentRoundBets().find(
        (a) => a.player == player.getUsername()
      ) != undefined
    ) {
      currBet = this.getCurrentRoundBets().find(
        (a) => a.player == player.getUsername()
      ).bet;
      this.setPlayerStreetBet(player, currBet);
    } else {
      this.setPlayerStreetBet(player, currBet);
    }
    this.moveOntoNextPlayer();
    return true;
  };

  this.raise = (socket, bet) => {
    if (this.isStreetAdvancing()) return false;
    this.checkBigBlindWent(socket);
    const topBet = this.getCurrentTopBet();
    const player = this.findPlayer(socket.id);
    const currBet = this.getPlayerBetInStage(player);
    const moneyToRemove = bet - currBet;
    const raiseIncrement = bet - topBet;
    const isAllIn = player.getMoney() - moneyToRemove === 0;
    if (
      moneyToRemove > 0 &&
      bet >= topBet &&
      player.getMoney() - moneyToRemove >= 0 &&
      // Min-raise: the raise increment must be >= the previous raise size.
      // All-in for less is allowed (but doesn't reopen the betting).
      (isAllIn || raiseIncrement >= this.lastRaiseSize)
    ) {
      this.setPlayerStreetBet(player, bet);
      player.money -= moneyToRemove;
      if (player.money == 0) player.allIn = true;
      if (raiseIncrement >= this.lastRaiseSize) this.lastRaiseSize = raiseIncrement;
      this.moveOntoNextPlayer();
      return true;
    }
  };

  // All-in: shove all remaining chips. Routes to bet / call / raise on its own
  // so the client only needs a single "All-In" action.
  this.allIn = (socket) => {
    if (this.isStreetAdvancing()) return false;
    const player = this.findPlayer(socket.id);
    if (!player || player.getMoney() <= 0) return false;
    const topBet = this.getCurrentTopBet();
    const currBet = this.getPlayerBetInStage(player);
    const total = currBet + player.getMoney();
    if (topBet === 0) return this.bet(socket, player.getMoney());
    if (total <= topBet) return this.call(socket);
    return this.raise(socket, total);
  };

  this.getPossibleMoves = (socket) => {
    const player = this.findPlayer(socket.id);
    const playerBet = this.getPlayerBetInStage(player);
    const topBet = this.getCurrentTopBet();
    let possibleMoves = {
      fold: 'yes',
      check: 'yes',
      bet: 'yes',
      call: topBet,
      raise: 'yes',
      allin: 'yes',
    };
    if (player.getStatus() == 'Fold') {
      this.log('Error: Folded players should not be able to move.');
    }
    if (topBet != 0) {
      possibleMoves.bet = 'no';
      possibleMoves.check = 'no';
      if (
        player.blindValue == 'Big Blind' &&
        !this.bigBlindWent &&
        topBet == this.bigBlind
      )
        possibleMoves.check = 'yes';
    } else {
      possibleMoves.raise = 'no';
    }
    if (topBet <= playerBet) {
      possibleMoves.call = 'no';
    }
    if (topBet >= player.getMoney() + playerBet) {
      possibleMoves.raise = 'no';
      possibleMoves.call = 'all-in';
    }
    return possibleMoves;
  };
};

module.exports = Game;
