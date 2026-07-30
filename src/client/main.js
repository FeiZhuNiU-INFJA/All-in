function openLobbyModal(selector) {
  $('.lobby-modal').removeClass('is-open');
  $(selector).addClass('is-open');
  $('body').addClass('modal-open');
}

function closeLobbyModal() {
  $('.lobby-modal').removeClass('is-open');
  $('body').removeClass('modal-open');
}

$(document).ready(function () {
  $('#gameDiv').hide();

  $('#hostButton').on('click', function (e) {
    e.preventDefault();
    openLobbyModal('#hostModal');
  });
  $('#joinButton').on('click', function (e) {
    e.preventDefault();
    openLobbyModal('#joinModal');
  });
  $('#usernameBet').on('click', function (e) {
    e.preventDefault();
    updateBetModal();
    openLobbyModal('#betModal');
  });
  $('#usernameRaise').on('click', function (e) {
    e.preventDefault();
    updateRaiseModal();
    openLobbyModal('#raiseModal');
  });

  $(document).on('click', '.modal-close, .modal-backdrop', function (e) {
    e.preventDefault();
    closeLobbyModal();
  });

  $(document).on('keyup', function (e) {
    if (e.keyCode === 27) closeLobbyModal();
  });

  if ($('.tooltipped').length) {
    $('.tooltipped').tooltip({ delay: 50 });
  }
});

function showActionBtn(sel) {
  $(sel).addClass('action-on');
}

function hideActionBtn(sel) {
  $(sel).removeClass('action-on');
}

function hideAllActionBtns() {
  hideActionBtn('#usernameFold');
  hideActionBtn('#usernameCheck');
  hideActionBtn('#usernameBet');
  hideActionBtn('#usernameCall');
  hideActionBtn('#usernameRaise');
}

var socket = io();
var gameInfo = null;
var myUsername = '';
var roomCode = '';

/* ── Deal animation & sound ──────────────────────────── */
var lastCommunityCount = 0; // community cards already shown — animate only new ones
var pendingDealAnim = false; // set on 'dealt' so the next rerender animates opponents' cards
var lastActionSeq = 0; // last action sound played — de-dupe across rerenders
var countdownInterval = null;
var countdownKind = null;
var countdownSecs = 0;

// Local countdown shown to players (turn timer / ready-up timer). The server
// remains the source of truth for the actual timeout; this is just a display.
function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownKind = null;
  $('#countdown').empty();
}

function startCountdown(kind, secs, label) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownKind = kind;
  countdownSecs = secs;
  var render = function () {
    $('#countdown').text(label + ' ⏱ ' + countdownSecs + 's');
  };
  render();
  countdownInterval = setInterval(function () {
    countdownSecs -= 1;
    if (countdownSecs <= 0) {
      clearCountdown();
      return;
    }
    render();
  }, 1000);
}

var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// Browsers block audio until a user gesture; unlock on the first interaction.
$(document).one('click pointerdown keydown', ensureAudio);

// Synthesized "card hitting the felt": a short, decaying filtered noise burst.
// No external audio file, so it works fully offline on the LAN.
function playDealSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var dur = 0.09;
  var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
  }
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1100;
  var g = ctx.createGain();
  g.gain.value = 0.32;
  src.connect(hp);
  hp.connect(g);
  g.connect(ctx.destination);
  src.start();
}

// Chips clinking — a bet or a raise (a few chips stacking, scheduled on the
// audio clock so the clinks stay tight regardless of JS timing).
function playChipsSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  for (var k = 0; k < 3; k++) {
    var t0 = ctx.currentTime + k * 0.045;
    var dur = 0.05;
    var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300 - k * 350;
    bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.value = 0.28;
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(t0);
  }
}

// Coins showering down — a bet. Each coin is a metallic clink: a short noise
// transient (the strike) plus a triangle-wave resonance with harmonics and a
// longer ringing decay, randomly pitched, so it reads as coins clattering.
function playCoinsSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var n = 4;
  for (var k = 0; k < n; k++) {
    var t0 = ctx.currentTime + k * 0.08 + Math.random() * 0.03;
    // strike transient
    var durN = 0.025;
    var bufN = ctx.createBuffer(1, Math.floor(ctx.sampleRate * durN), ctx.sampleRate);
    var dN = bufN.getChannelData(0);
    for (var i = 0; i < dN.length; i++)
      dN[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dN.length, 4);
    var srcN = ctx.createBufferSource();
    srcN.buffer = bufN;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    var gN = ctx.createGain();
    gN.gain.value = 0.22;
    srcN.connect(hp);
    hp.connect(gN);
    gN.connect(ctx.destination);
    srcN.start(t0);
    // ringing resonance
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 2400 + Math.random() * 1100;
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.2, t0 + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }
}

// A single chip placed — a call.
function playCallSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var dur = 0.06;
  var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < d.length; i++)
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700;
  bp.Q.value = 1;
  var g = ctx.createGain();
  g.gain.value = 0.32;
  src.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  src.start();
}

// A knuckle on the felt — a check.
function playCheckSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var t0 = ctx.currentTime;
  var osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 180;
  var g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.13);
}

// A card slid away — a fold (filtered noise swept high→low).
function playFoldSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var dur = 0.18;
  var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < d.length; i++)
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(2400, ctx.currentTime);
  bp.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + dur);
  var g = ctx.createGain();
  g.gain.value = 0.26;
  src.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  src.start();
}

function playActionSound(move) {
  if (move === 'fold') return playFoldSound();
  if (move === 'check') return playCheckSound();
  if (move === 'bet' || move === 'call') return playCoinsSound();
  if (move === 'raise') return playChipsSound();
}

// A playing card carrying the deal-in animation class, with an optional
// stagger delay (seconds) so a round of deals plays one after another.
function renderCardWithAnim(card, delaySec) {
  var cls =
    card.suit === '♠' || card.suit === '♣'
      ? 'playingCard_black deal-in'
      : 'playingCard_red deal-in';
  var style = delaySec ? ' style="animation-delay:' + delaySec + 's"' : '';
  return (
    '<div class="' +
    cls +
    '"' +
    style +
    ' data-value="' +
    card.value +
    ' ' +
    card.suit +
    '">' +
    card.value +
    ' ' +
    card.suit +
    '</div>'
  );
}

/* Seat positions around the oval table (top %, left %) */
var SEAT_LAYOUTS = [
  [],
  [{ top: '8%', left: '50%' }],
  [
    { top: '10%', left: '30%' },
    { top: '10%', left: '70%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '22%', left: '16%' },
    { top: '22%', left: '84%' },
  ],
  [
    { top: '8%', left: '26%' },
    { top: '8%', left: '74%' },
    { top: '38%', left: '6%' },
    { top: '38%', left: '94%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '14%', left: '20%' },
    { top: '14%', left: '80%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '13%', left: '22%' },
    { top: '13%', left: '78%' },
    { top: '38%', left: '6%' },
    { top: '38%', left: '94%' },
    { top: '55%', left: '50%' },
  ],
  [
    { top: '7%', left: '38%' },
    { top: '7%', left: '62%' },
    { top: '20%', left: '12%' },
    { top: '20%', left: '88%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '7%', left: '32%' },
    { top: '7%', left: '50%' },
    { top: '7%', left: '68%' },
    { top: '22%', left: '10%' },
    { top: '22%', left: '90%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '7%', left: '28%' },
    { top: '7%', left: '50%' },
    { top: '7%', left: '72%' },
    { top: '20%', left: '10%' },
    { top: '20%', left: '90%' },
    { top: '38%', left: '5%' },
    { top: '38%', left: '95%' },
    { top: '55%', left: '28%' },
    { top: '55%', left: '72%' },
  ],
];

function opponentSeatStyles(count) {
  var idx = Math.min(Math.max(count, 1), SEAT_LAYOUTS.length - 1);
  return SEAT_LAYOUTS[idx];
}

function getPlayerBet(name, bets) {
  if (!bets || !bets.length) return 0;
  var arr = bets[bets.length - 1];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].player === name) return arr[i].bet;
  }
  return 0;
}

function seatStateClass(text) {
  if (text === 'Fold') return 'seat-folded';
  if (text === 'Their Turn') return 'seat-active';
  if (text === 'Spectating') return 'seat-spectating';
  return '';
}

function abbrevBlind(blind) {
  if (!blind) return '';
  if (blind.indexOf('Dealer') !== -1) return 'D';
  if (blind.indexOf('Small') !== -1) return 'SB';
  if (blind.indexOf('Big') !== -1) return 'BB';
  return blind;
}

function joinErrorMessage(data) {
  const code = data && data.error;
  if (code === 'room_not_found') return 'Room not found. Check the code.';
  if (code === 'room_full') return 'Room is full (max 10 players).';
  if (code === 'duplicate_name') return 'That name is already taken in this room.';
  if (code === 'invalid_name')
    return 'Enter a valid name (1–12 characters).';
  return 'Could not join. Check name/code and try again.';
}

socket.on('playerDisconnected', function (data) {
  Materialize.toast(data.player + ' disconnected.', 4000);
});

function parseWinners(winners) {
  if (winners == null) return [];
  if (Array.isArray(winners)) return winners;
  return String(winners)
    .split(',')
    .map(function (name) {
      return name.trim();
    })
    .filter(Boolean);
}

function shameCoinsHtml(count) {
  if (!count || count <= 0) return '';
  var coins = '';
  for (var i = 0; i < count; i++) {
    coins += '<span class="shame-coin" title="Shame coin"></span>';
  }
  return (
    '<span class="shame-coins" title="' +
    count +
    ' shame coin(s)">' +
    coins +
    '</span>'
  );
}

function requestRebuy() {
  socket.emit('rebuy');
}

function dismissRebuyPrompt() {
  $('#rebuyBar').hide();
}

function maybeShowRebuyPrompt(money, roundInProgress) {
  if (money === 0 && !roundInProgress) $('#rebuyBar').show();
  else $('#rebuyBar').hide();
}

function rebuyErrorMessage(data) {
  const code = data && data.error;
  if (code === 'hand_in_progress')
    return 'Wait until the hand finishes to rebuy.';
  return 'Rebuy only when you have 0 chips.';
}

socket.on('rebuyResult', function (data) {
  if (!data || data.ok === false) {
    Materialize.toast(rebuyErrorMessage(data), 3000);
    return;
  }
  $('#rebuyBar').hide();
  Materialize.toast('Rebuy +2000. Shame coin earned.', 3000);
});

socket.on('playerRebuy', function (data) {
  Materialize.toast(data.player + ' rebought (+shame coin)', 3000);
});

socket.on('waitingForPlayers', function () {
  Materialize.toast('Waiting for at least two players with chips.', 4000);
});

socket.on('hostRoom', function (data) {
  if (data == undefined || data.ok === false) {
    Materialize.toast(joinErrorMessage(data || { error: 'invalid_name' }), 4000);
    $('#joinButton').removeClass('disabled');
  } else {
    if (data.code != null) roomCode = String(data.code);
  }
  if (data == undefined || data.ok === false) {
    return;
  }
  if (data.players.length >= 11) {
      $('#hostModalContent').html(
        '<h5>Code:</h5><code>' +
          data.code +
          '</code><br /><h5>Warning: you have too many players in your room. Max is 11.</h5><h5>Players Currently in My Room</h5>'
      );
      $('#playersNames').html(
        data.players.map(function (p) {
          return '<span>' + p + '</span><br />';
        })
      );
    } else if (data.players.length > 1) {
      $('#hostModalContent').html(
        '<h5>Code:</h5><code>' +
          data.code +
          '</code><br /><h5>Players Currently in My Room</h5>'
      );
      $('#playersNames').html(
        data.players.map(function (p) {
          return '<span>' + p + '</span><br />';
        })
      );
      $('#startGameArea').html(
        '<br /><button type="button" onclick="startGame()" class="modal-action-btn">Start Game</button>'
      );
    } else {
      $('#hostModalContent').html(
        '<h5>Code:</h5><code>' +
          data.code +
          '</code><br /><h5>Players Currently in My Room</h5>'
      );
      $('#playersNames').html(
        data.players.map(function (p) {
          return '<span>' + p + '</span><br />';
        })
      );
    }
});

socket.on('hostRoomUpdate', function (data) {
  $('#playersNames').html(
    data.players.map(function (p) {
      return '<span>' + p + '</span><br />';
    })
  );
  if (data.players.length == 1) {
    $('#startGameArea').empty();
  }
});

socket.on('joinRoomUpdate', function (data) {
  if (data.code != null) roomCode = String(data.code);
  $('#startGameAreaDisconnectSituation').html(
    '<br /><button type="button" onclick="startGame()" class="modal-action-btn">Start Game</button>'
  );
  $('#joinModalContent').html(
    '<h5>' +
      data.host +
      "'s room</h5><hr /><h5>Players Currently in Room</h5><p>You are now a host of this game.</p>"
  );

  $('#playersNamesJoined').html(
    data.players.map(function (p) {
      return '<span>' + p + '</span><br />';
    })
  );
});

socket.on('joinRoom', function (data) {
  if (data == undefined || data.ok === false) {
    closeLobbyModal();
    Materialize.toast(joinErrorMessage(data), 4000);
    $('#hostButton').removeClass('disabled');
  } else {
    roomCode = String($('#code-field').val()).trim();
    if (data.persistent) {
      // Persistent lobby: no fixed host, anyone can start once >= 2 are in.
      $('#joinModalContent').html(
        '<h5>房间已就绪</h5><hr /><h5>Players Currently in Room</h5>'
      );
      var needMore = !data.players || data.players.length < 2;
      $('#startGameAreaDisconnectSituation').html(
        needMore
          ? '<p style="opacity:.7">等待至少 2 位玩家加入…</p>'
          : '<br /><button type="button" onclick="startGame()" class="modal-action-btn">Start Game</button>'
      );
    } else {
      $('#joinModalContent').html(
        '<h5>' +
          data.host +
          "'s room</h5><hr /><h5>Players Currently in Room</h5><p>Please wait until your host starts the game. Leaving the page, refreshing, or going back will disconnect you from the game. </p>"
      );
    }
    $('#playersNamesJoined').html(
      data.players.map(function (p) {
        return '<span>' + p + '</span><br />';
      })
    );
  }
});

socket.on('dealt', function (data) {
  myUsername = data.username;
  $('#mycards').html(
    data.cards.map(function (c, i) {
      // Hole cards: ~0.6s apart; sound when each LANDS (deal delay + 0.5s flight).
      setTimeout(playDealSound, 500 + i * 600);
      return renderCardWithAnim(c, i * 0.6);
    })
  );
  lastCommunityCount = 0; // new hand: community is empty again
  pendingDealAnim = true; // opponents' face-down cards animate on the next rerender
  $('#usernamesCards').html(data.username + shameCoinsHtml(0));
  $('#mainContent').remove();
});

// A player action resolved (fold/check/bet/call/raise). Played via a dedicated
// event — not rerender — so it fires even on all-fold/showdown, and so a deal
// sound that follows (next street) can be staggered AFTER it.
socket.on('actionSound', function (data) {
  if (data && data.seq > lastActionSeq) {
    playActionSound(data.move);
    lastActionSeq = data.seq;
  }
});

socket.on('rerender', function (data) {
  myUsername = data.username;
  // A new hand is starting — clear last hand's winner highlight.
  $('.seat-winner').removeClass('seat-winner');
  var nameLabel = data.username + shameCoinsHtml(data.buyIns);
  if (data.myBet > 0) nameLabel += ' · Bet $' + data.myBet;
  $('#usernamesCards').html(nameLabel);
  if (data.community != undefined) {
    var prevCommunity = lastCommunityCount;
    $('#communityCards').html(
      data.community.map(function (c, i) {
        if (i >= prevCommunity) {
          // After the last check/call, wait 1s, then deal 1 card/sec. Sound fires
          // when each card LANDS (deal delay + 0.5s flight) so audio matches video.
          setTimeout(playDealSound, 1500 + (i - prevCommunity) * 1000);
          return renderCardWithAnim(c, 1.0 + (i - prevCommunity) * 1.0);
        }
        return renderCard(c);
      })
    );
    lastCommunityCount = data.community.length;
  } else {
    $('#communityCards').empty();
    lastCommunityCount = 0;
  }
  if (data.currBet == undefined) data.currBet = 0;
  $('#potAmount').text('$' + data.pot);
  $('#tableStage').text(
    'Hand #' + data.round + ' · ' + data.stage + ' · Top bet $' + data.topBet
  );
  $('#table-title').text('');
  var styles = opponentSeatStyles(data.players.length);
  $('#opponentCards').html(
    data.players.map(function (p, i) {
      return renderSeat(p.username, {
        text: p.status,
        money: p.money,
        blind: p.blind,
        bets: data.bets,
        buyIns: p.buyIns,
        isChecked: p.isChecked,
        readyState: p.readyState,
        roundInProgress: data.roundInProgress,
      }, styles[i] || styles[0]);
    }).join('')
  );
  if (pendingDealAnim) {
    // A new hand was just dealt — fly opponents' face-down cards in too.
    var $dealtSeats = $('#opponentCards .blankCard');
    $dealtSeats.addClass('deal-in');
    $dealtSeats.each(function (i) {
      this.style.animationDelay = i * 0.5 + 's';
    });
    pendingDealAnim = false;
  }
  renderSelf({
    money: data.myMoney,
    text: data.myStatus,
    blind: data.myBlind,
    bets: data.bets,
    buyIns: data.buyIns,
  });
  maybeShowRebuyPrompt(data.myMoney, data.roundInProgress);
  if (!data.roundInProgress) hideAllActionBtns();
  renderReadyPhase({
    roundInProgress: data.roundInProgress,
    myMoney: data.myMoney,
    myReadyState: data.myReadyState,
    players: data.players,
  });
  // Countdown: during a hand show the acting player's turn timer; the ready-up
  // timer is started by reveal/endHand and cleared when the next hand begins.
  if (data.roundInProgress) {
    if (countdownKind === 'ready') clearCountdown();
    var turnPlayer = (data.players || []).filter(function (p) {
      return p.status === 'Their Turn';
    })[0];
    if (turnPlayer) startCountdown('turn', 120, turnPlayer.username + ' 操作');
    else if (countdownKind === 'turn') clearCountdown();
  } else if (countdownKind === 'turn') {
    clearCountdown();
  }
});

socket.on('gameBegin', function (data) {
  $('#navbar-ptwu').hide();
  closeLobbyModal();
  if (data == undefined || data.ok === false) {
    var msg = 'Could not start the game. Try again.';
    if (data && data.error === 'not_enough_players') {
      msg = 'Need at least 2 players to start.';
    } else if (data && data.error === 'room_not_found') {
      msg = 'Room not found. Create or join again.';
    }
    Materialize.toast(msg, 4000);
    return;
  }
  $('#mainContent').hide();
  $('#gameDiv').css('display', 'flex');
});

function chooseReady(choice) {
  socket.emit('playerReady', { choice: choice });
}

// Between hands, render the ready-up controls (Ready / Watch) for the local
// player plus a waiting hint derived from everyone's readyState. This replaces
// the old single "Start Next Hand" button: the next hand now begins
// automatically server-side once every funded player has chosen and >= 2 are ready.
function renderReadyPhase(opts) {
  var $wrap = $('#playNext');
  $wrap.empty();
  if (opts.roundInProgress) return; // mid-hand: action buttons own the bar
  if (opts.myMoney === 0) return; // broke: the rebuy bar handles this

  var funded = (opts.players || []).filter(function (p) {
    return p.money > 0;
  });
  var ready = funded.filter(function (p) {
    return p.readyState === 'ready';
  }).length;
  var undecided = funded.filter(function (p) {
    return p.readyState === 'undecided';
  }).length;
  var hint;
  if (ready < 2) hint = '等待至少 2 人准备好（当前 ' + ready + ' 人已准备）…';
  else if (undecided > 0) hint = '等待 ' + undecided + ' 位玩家选择…';
  else hint = '即将开始…';

  var html =
    '<div class="ready-phase"><div class="ready-phase-hint">' + hint + '</div>';
  if (opts.myReadyState === 'ready') {
    html +=
      '<button class="action-btn action-on ready-btn" disabled>✓ 已准备好</button>';
    html +=
      '<button onclick="chooseReady(\'watching\')" class="action-btn action-on watch-btn">旁观</button>';
  } else if (opts.myReadyState === 'watching') {
    html +=
      '<button onclick="chooseReady(\'ready\')" class="action-btn action-on ready-btn">准备好</button>';
    html +=
      '<button class="action-btn action-on watch-btn" disabled>旁观中</button>';
  } else {
    html +=
      '<button onclick="chooseReady(\'ready\')" class="action-btn action-on ready-btn">准备好</button>';
    html +=
      '<button onclick="chooseReady(\'watching\')" class="action-btn action-on watch-btn">旁观</button>';
  }
  html += '</div>';
  $wrap.html(html);
}

socket.on('reveal', function (data) {
  hideAllActionBtns();

  var winners = parseWinners(data.winners);
  for (var i = 0; i < winners.length; i++) {
    if (winners[i] == data.username) {
      Materialize.toast('You won the hand!', 4000);
      break;
    }
  }
  $('#table-title').text('Winner: ' + winners.join(', '));
  $('#tableStage').text('');
  $('#blindStatus').text(data.hand);
  $('#usernamesMoney').text('$' + data.money);
  maybeShowRebuyPrompt(data.money, false);
  var styles = opponentSeatStyles(data.cards.length);
  $('#opponentCards').html(
    data.cards.map(function (p, i) {
      return renderSeat(p.username, {
        text: p.folded ? 'Fold' : '',
        money: p.money,
        blind: '',
        bets: data.bets,
        buyIns: p.buyIns,
        cards: p.cards,
        showCards: !p.folded,
        endHand: p.hand,
        readyState: p.readyState,
        roundInProgress: false,
      }, styles[i] || styles[0]);
    }).join('')
  );
  renderReadyPhase({
    roundInProgress: false,
    myMoney: data.money,
    myReadyState: data.myReadyState,
    players: data.cards,
  });
  startCountdown('ready', 120, '准备/旁观');
  highlightWinners(winners, data.username);
  setTimeout(function () {
    animateChipsToWinners(winners, data.username);
  }, 500);
});

socket.on('endHand', function (data) {
  hideAllActionBtns();
  $('#table-title').text(data.winner + ' wins $' + data.pot);
  $('#potAmount').text('$' + data.pot);
  $('#tableStage').text('');
  $('#blindStatus').text('');
  if (data.folded == 'Fold') {
    $('#status').text('Folded');
    $('#playerInformationCard')
      .removeClass('seat-active')
      .addClass('seat-folded');
    hideAllActionBtns();
  }
  $('#usernamesMoney').text('$' + data.money);
  maybeShowRebuyPrompt(data.money, false);
  var styles = opponentSeatStyles(data.cards.length);
  $('#opponentCards').html(
    data.cards.map(function (p, i) {
      return renderSeat(p.username, {
        text: p.text,
        money: p.money,
        blind: '',
        bets: data.bets,
        readyState: p.readyState,
        roundInProgress: false,
      }, styles[i] || styles[0]);
    }).join('')
  );
  renderReadyPhase({
    roundInProgress: false,
    myMoney: data.money,
    myReadyState: data.myReadyState,
    players: data.cards,
  });
  startCountdown('ready', 120, '准备/旁观');
  highlightWinners([data.winner], data.username);
  setTimeout(function () {
    animateChipsToWinners([data.winner], data.username);
  }, 400);
});

var beginHost = function () {
  if ($('#hostName-field').val() == '') {
    $('.toast').hide();
    closeLobbyModal();
    Materialize.toast(
      'Enter a valid name! (max length of name is 12 characters)',
      4000
    );
    $('#joinButton').removeClass('disabled');
  } else {
    socket.emit('host', { username: $('#hostName-field').val() });
    $('#joinButton').addClass('disabled');
    $('#joinButton').off('click');
  }
};

var joinRoom = function () {
  // yes, i know this is client-side.
  if (
    $('#joinName-field').val() == '' ||
    $('#code-field').val() == '' ||
    $('#joinName-field').val().length > 12
  ) {
    $('.toast').hide();
    Materialize.toast(
      'Enter a valid name/code! (max length of name is 12 characters.)',
      4000
    );
    closeLobbyModal();
    $('#hostButton').removeClass('disabled');
    $('#hostButton').on('click');
  } else {
    socket.emit('join', {
      code: String($('#code-field').val()).trim(),
      username: $('#joinName-field').val(),
    });
    $('#hostButton').addClass('disabled');
    $('#hostButton').off('click');
  }
};

var startGame = function (gameCode) {
  var code =
    gameCode != null && String(gameCode).trim() !== ''
      ? String(gameCode).trim()
      : roomCode;
  if (!code) {
    Materialize.toast('Missing room code. Create or join a room first.', 4000);
    return;
  }
  socket.emit('startGame', { code: code });
};

var fold = function () {
  socket.emit('moveMade', { move: 'fold', bet: 'Fold' });
};

var bet = function () {
  if (parseInt($('#betRangeSlider').val()) == 0) {
    Materialize.toast('You must bet more than $0! Try again.', 4000);
  } else if (parseInt($('#betRangeSlider').val()) < 2) {
    Materialize.toast('The minimum bet is $2.', 4000);
  } else {
    socket.emit('moveMade', {
      move: 'bet',
      bet: parseInt($('#betRangeSlider').val()),
    });
  }
};

function call() {
  socket.emit('moveMade', { move: 'call', bet: 'Call' });
}

var check = function () {
  socket.emit('moveMade', { move: 'check', bet: 'Check' });
};

var raise = function () {
  if (
    parseInt($('#raiseRangeSlider').val()) == $('#raiseRangeSlider').prop('min')
  ) {
    Materialize.toast(
      'You must raise higher than the current top bet! Try again.',
      4000
    );
  } else {
    socket.emit('moveMade', {
      move: 'raise',
      bet: parseInt($('#raiseRangeSlider').val()),
    });
  }
};

function renderCard(card) {
  if (card.suit == '♠' || card.suit == '♣')
    return (
      '<div class="playingCard_black" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
  else
    return (
      '<div class="playingCard_red" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
}

function getWinnerEl(name, myName) {
  if (name === myName) return $('#playerInformationCard');
  return $('#opponentCards .table-seat').filter(function () {
    return $(this).attr('data-name') === name;
  });
}

// Highlight every winner's seat (handles split pots with multiple winners).
function highlightWinners(winners, myName) {
  $('.seat-winner').removeClass('seat-winner');
  winners.forEach(function (w) {
    var $el = getWinnerEl(w, myName);
    if ($el && $el.length) $el.addClass('seat-winner');
  });
}

// Spawn gold chips that fly from the pot to the target seat and fade out.
function flyChipsTo($target) {
  var $pot = $('.pot-area');
  if (!$pot.length || !$target || !$target.length) return;
  var pr = $pot[0].getBoundingClientRect();
  var tr = $target[0].getBoundingClientRect();
  var fromX = pr.left + pr.width / 2;
  var fromY = pr.top + pr.height / 2;
  var toX = tr.left + tr.width / 2;
  var toY = tr.top + tr.height / 2;
  for (var i = 0; i < 8; i++) {
    var dx = toX - fromX + (Math.random() * 24 - 12);
    var dy = toY - fromY + (Math.random() * 24 - 12);
    var $chip = $('<div class="fly-chip"></div>');
    $chip.css({ left: fromX + 'px', top: fromY + 'px' });
    $('body').append($chip);
    (function ($c, dx, dy, delay) {
      setTimeout(function () {
        $c.css({
          transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.5)',
          opacity: '0',
        });
      }, delay);
      setTimeout(function () {
        $c.remove();
      }, delay + 700);
    })($chip, dx, dy, i * 55);
  }
}

function animateChipsToWinners(winners, myName) {
  playCoinsSound(); // pot being collected — coins clinking into the winner's stack
  winners.forEach(function (w) {
    flyChipsTo(getWinnerEl(w, myName));
  });
}

function renderSeat(name, data, style) {
  var bet = getPlayerBet(name, data.bets);
  var stateClass = seatStateClass(data.text);
  var nameHtml = name + shameCoinsHtml(data.buyIns);
  var blindBadge = data.blind
    ? '<span class="seat-blind">' + abbrevBlind(data.blind) + '</span>'
    : '';
  var cardsHtml;
  if (data.showCards && data.cards) {
    cardsHtml =
      renderOpponentCard(data.cards[0]) + renderOpponentCard(data.cards[1]);
  } else {
    cardsHtml = '<div class="blankCard"></div><div class="blankCard"></div>';
  }
  var betHtml = bet > 0 ? '<div class="seat-bet">$' + bet + '</div>' : '';
  var statusHtml = '';
  if (data.text === 'Fold') statusHtml = '<div class="seat-status">Fold</div>';
  else if (data.isChecked) statusHtml = '<div class="seat-status">Check</div>';
  else if (data.text === 'Spectating')
    statusHtml = '<div class="seat-status">Spectating</div>';
  // Between hands, show each funded player's ready-up choice on their seat.
  if (
    data.roundInProgress === false &&
    data.money > 0 &&
    (data.readyState === 'ready' || data.readyState === 'watching')
  ) {
    statusHtml +=
      '<div class="seat-status seat-' +
      data.readyState +
      '">' +
      (data.readyState === 'ready' ? 'Ready' : 'Watching') +
      '</div>';
  }
  var handHtml = data.endHand
    ? '<div class="seat-hand">' + data.endHand + '</div>'
    : '';
  return (
    '<div class="table-seat ' +
    stateClass +
    '" data-name="' +
    name +
    '" style="top:' +
    style.top +
    ';left:' +
    style.left +
    '">' +
    blindBadge +
    '<div class="seat-name">' +
    nameHtml +
    '</div>' +
    '<div class="seat-cards">' +
    cardsHtml +
    '</div>' +
    betHtml +
    statusHtml +
    handHtml +
    '<div class="seat-stack">$' +
    data.money +
    '</div>' +
    '</div>'
  );
}

function renderOpponentCard(card) {
  if (card.suit == '♠' || card.suit == '♣')
    return (
      '<div class="playingCard_black_opponent" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
  else
    return (
      '<div class="playingCard_red_opponent" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
}

function updateBetDisplay() {
  if ($('#betRangeSlider').val() == $('#usernamesMoney').text()) {
    $('#betDisplay').html(
      '<h3 class="center-align">All-In $' +
        $('#betRangeSlider').val() +
        '</h36>'
    );
  } else {
    $('#betDisplay').html(
      '<h3 class="center-align">$' + $('#betRangeSlider').val() + '</h36>'
    );
  }
}

function updateBetModal() {
  $('#betDisplay').html('<h3 class="center-align">$0</h3>');
  document.getElementById('betRangeSlider').value = 0;
  var usernamesMoneyStr = $('#usernamesMoney').text().replace('$', '');
  var usernamesMoneyNum = parseInt(usernamesMoneyStr);
  $('#betRangeSlider').attr({
    max: usernamesMoneyNum,
    min: 0,
  });
}

function updateRaiseDisplay() {
  $('#raiseDisplay').html(
    '<h3 class="center-align">Raise top bet to $' +
      $('#raiseRangeSlider').val() +
      '</h3>'
  );
}

socket.on('updateRaiseModal', function (data) {
  $('#raiseRangeSlider').attr({
    max: data.usernameMoney,
    min: data.topBet,
  });
});

function updateRaiseModal() {
  document.getElementById('raiseRangeSlider').value = 0;
  socket.emit('raiseModalData', {});
}

socket.on('displayPossibleMoves', function (data) {
  if (data.fold == 'yes') showActionBtn('#usernameFold');
  else hideActionBtn('#usernameFold');
  if (data.check == 'yes') showActionBtn('#usernameCheck');
  else hideActionBtn('#usernameCheck');
  if (data.bet == 'yes') showActionBtn('#usernameBet');
  else hideActionBtn('#usernameBet');
  if (data.call != 'no' || data.call == 'all-in') {
    showActionBtn('#usernameCall');
    if (data.call == 'all-in') $('#usernameCall').text('Call All-In');
    else $('#usernameCall').text('Call $' + data.call);
  } else hideActionBtn('#usernameCall');
  if (data.raise == 'yes') showActionBtn('#usernameRaise');
  else hideActionBtn('#usernameRaise');
});

function renderSelf(data) {
  $('#playNext').empty();
  $('#usernamesMoney').text('$' + data.money);
  var $hero = $('#playerInformationCard');
  $hero.removeClass('seat-active seat-folded');
  if (data.text == 'Their Turn') {
    $hero.addClass('seat-active');
    $('#status').text('Your Turn');
    Materialize.toast('Your turn', 3000);
    socket.emit('evaluatePossibleMoves', {});
  } else if (data.text == 'Fold') {
    $hero.addClass('seat-folded');
    $('#status').text('Folded');
    Materialize.toast('You folded', 3000);
    hideAllActionBtns();
  } else {
    $('#status').text('');
    hideAllActionBtns();
  }
  $('#blindStatus').text(abbrevBlind(data.blind));
}
