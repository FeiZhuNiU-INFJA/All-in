const Game = require('../../src/classes/game.js');
const events = require('events');
const { STARTING_CHIPS } = require('../../src/constants.js');

test('Test call until fold then check', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];

  // Test parametable small/big blind
  expect(smallPlayer.money).toBe(STARTING_CHIPS - 5);
  expect(bigPlayer.money).toBe(STARTING_CHIPS - 10);

  expect(smallPlayer.status).toBe('Their Turn');

  // Pre-Flop
  game.call(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Turn
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(3);

  // River
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(4);

  // End of game
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
});

test('Test raise more than possessed', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];

  // Test parametable small/big blind
  expect(smallPlayer.money).toBe(STARTING_CHIPS - 5);
  expect(bigPlayer.money).toBe(STARTING_CHIPS - 10);

  expect(smallPlayer.status).toBe('Their Turn');

  // Pre-Flop
  expect(game.call(smallPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  expect(game.raise(bigPlayer.socket, STARTING_CHIPS * 2)).not.toBe(true);
});

test('Test bet more than possessed', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];

  // Test parametable small/big blind
  expect(smallPlayer.money).toBe(STARTING_CHIPS - 5);
  expect(bigPlayer.money).toBe(STARTING_CHIPS - 10);

  expect(smallPlayer.status).toBe('Their Turn');

  // Pre-Flop
  expect(game.call(smallPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Turn
  expect(game.bet(bigPlayer.socket, STARTING_CHIPS * 2)).not.toBe(true);
});

test('Test all-in / call', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  p1.money = 50;
  expect(p1.money).toBe(50);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];

  expect(smallPlayer.status).toBe('Their Turn');

  // Pre-Flop
  expect(game.call(smallPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Turn
  expect(game.bet(bigPlayer.socket, bigPlayer.money)).toBe(true);

  expect(game.call(smallPlayer.socket)).toBe(true);

  expect(smallPlayer.money + bigPlayer.money).toBe(50 + STARTING_CHIPS);
});

test('Test all-in 3 players', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);
  const p2 = game.addPlayer("2", sock2);
  p2.money = 50;
  expect(p2.money).toBe(50);
  const p3 = game.addPlayer("3", sock3);
  expect(p3.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];
  const thirdPlayer = game.players.filter((p) => [smallPlayer, bigPlayer].indexOf(p) === -1)[0];

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Turn
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.bet(currentPlayer.socket, currentPlayer.money)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);

  expect(game.players.reduce((a, c) => a + c.money, 0)).toBe(
    50 + STARTING_CHIPS * 2
  );
  expect(game.roundData.bets.length).toBe(4);
});

test('Test disconnected', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  p1.money = 50;
  expect(p1.money).toBe(50);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  const smallPlayer = game.players[game.roundData.smallBlind];
  const bigPlayer = game.players[game.roundData.bigBlind];

  expect(smallPlayer.status).toBe('Their Turn');

  // Pre-Flop
  expect(game.call(smallPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  game.check(bigPlayer.socket);
  game.check(smallPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Turn
  game.disconnectPlayer(bigPlayer);

  expect(game.players.length).toBe(1);
});

test('Test init blind and dealer', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  const p2 = game.addPlayer("2", sock2);
  const p3 = game.addPlayer("3", sock3);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);

  expect(p1.dealer).toBe(true);
  expect(p2.dealer).toBe(false);
  expect(p3.dealer).toBe(false);
  expect(p1.blindValue).toBe('');
  expect(p2.blindValue).toBe('Small Blind');
  expect(p3.blindValue).toBe('Big Blind');

  game.startNewRound();
  expect(game.roundNum).toBe(2);

  expect(p1.dealer).toBe(false);
  expect(p2.dealer).toBe(true);
  expect(p3.dealer).toBe(false);
  expect(p1.blindValue).toBe('Big Blind');
  expect(p2.blindValue).toBe('');
  expect(p3.blindValue).toBe('Small Blind');

  game.startNewRound();
  expect(game.roundNum).toBe(3);

  expect(p1.dealer).toBe(false);
  expect(p2.dealer).toBe(false);
  expect(p3.dealer).toBe(true);
  expect(p1.blindValue).toBe('Small Blind');
  expect(p2.blindValue).toBe('Big Blind');
  expect(p3.blindValue).toBe('');

  game.startNewRound();
  expect(game.roundNum).toBe(4);

  expect(p1.dealer).toBe(true);
  expect(p2.dealer).toBe(false);
  expect(p3.dealer).toBe(false);
  expect(p1.blindValue).toBe('');
  expect(p2.blindValue).toBe('Small Blind');
  expect(p3.blindValue).toBe('Big Blind');
});

test('Test raise', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);
  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);

  expect(game.players.length).toBe(2);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.bet(currentPlayer.socket, 30)).toBe(true);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  // Check can't raise under topBet
  expect(game.raise(currentPlayer.socket, 20)).not.toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Raise correct value
  expect(game.raise(currentPlayer.socket, 30)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);
});

test('Test all-in 3 players low credits win', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);

  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  const p3 = game.addPlayer("3", sock3);
  p3.money = 50;
  expect(p3.money).toBe(50);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();


  p1.cards[0].value = 7;
  p1.cards[0].suit = '♠';
  p1.cards[1].value = 7;
  p1.cards[1].suit = '♥';

  p2.cards[0].value = 8;
  p2.cards[0].suit = '♠';
  p2.cards[1].value = 8;
  p2.cards[1].suit = '♥';

  p3.cards[0].value = 1;
  p3.cards[0].suit = '♠';
  p3.cards[1].value = 1;
  p3.cards[1].suit = '♥';


  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  game.community[0].value = 1;
  game.community[0].suit = '♦';
  game.community[1].value = 1;
  game.community[1].suit = '♣';
  game.community[2].value = 'K';
  game.community[2].suit = '♣';

  // Turn
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(STARTING_CHIPS - 10);
  expect(game.bet(currentPlayer.socket, currentPlayer.money)).toBe(true);
  expect(currentPlayer.money).toBe(0);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(40);
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(currentPlayer.money).toBe(0);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(STARTING_CHIPS - 10);
  expect(game.call(currentPlayer.socket)).toBe(true);

  // Winner has to be p3 with 4 as
  expect(p1.money).toBe(STARTING_CHIPS - 50);
  expect(p2.money).toBe(STARTING_CHIPS - 50);
  expect(p3.money).toBe(150);

  expect(game.players.reduce((a, c) => a + c.money, 0)).toBe(
    STARTING_CHIPS * 2 + 50
  );
  expect(game.roundData.bets.length).toBe(4);
});

test('Test all-in 3 players high credits win', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);

  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  const p3 = game.addPlayer("3", sock3);
  p3.money = 50;
  expect(p3.money).toBe(50);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();


  p1.cards[0].value = 7;
  p1.cards[0].suit = '♠';
  p1.cards[1].value = 7;
  p1.cards[1].suit = '♥';

  p2.cards[0].value = 1;
  p2.cards[0].suit = '♠';
  p2.cards[1].value = 1;
  p2.cards[1].suit = '♥';

  p3.cards[0].value = 8;
  p3.cards[0].suit = '♠';
  p3.cards[1].value = 8;
  p3.cards[1].suit = '♥';


  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(1);

  // Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  game.community[0].value = 1;
  game.community[0].suit = '♦';
  game.community[1].value = 1;
  game.community[1].suit = '♣';
  game.community[2].value = 'K';
  game.community[2].suit = '♣';

  // Turn
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(STARTING_CHIPS - 10);
  expect(game.bet(currentPlayer.socket, currentPlayer.money)).toBe(true);
  expect(currentPlayer.money).toBe(0);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(40);
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(currentPlayer.money).toBe(0);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(currentPlayer.money).toBe(STARTING_CHIPS - 10);
  expect(game.call(currentPlayer.socket)).toBe(true);

  // Winner has to be p2 with 4 as
  expect(p1.money).toBe(0);
  expect(p2.money).toBe(STARTING_CHIPS * 2 + 50);
  expect(p3.money).toBe(0);

  expect(game.players.reduce((a, c) => a + c.money, 0)).toBe(
    STARTING_CHIPS * 2 + 50
  );
  expect(game.roundData.bets.length).toBe(4);
});

test('disconnect during hand folds the player', () => {
  const game = new Game('disc-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer('1', sock1);
  const p2 = game.addPlayer('2', sock2);
  const p3 = game.addPlayer('3', sock3);
  game.startGame();

  expect(game.roundInProgress).toBe(true);
  const victim = game.findPlayer(3);
  expect(victim.getUsername()).toBe('3');

  game.disconnectPlayer(victim);

  expect(game.players.map((p) => p.getUsername())).not.toContain('3');
  const stage = game.getCurrentRoundBets();
  expect(stage.some((b) => b.player === '3' && b.bet === 'Fold')).toBe(true);
});

test('big blind disconnect during preflop sets bigBlindWent and unstalls the hand', () => {
  const game = new Game('bb-disc-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer('1', sock1);
  const p2 = game.addPlayer('2', sock2);
  const p3 = game.addPlayer('3', sock3);
  game.startGame();

  expect(game.roundInProgress).toBe(true);
  expect(game.bigBlindWent).toBe(false);

  const bigBlindPlayer = game.players[game.roundData.bigBlind];

  // Every other player calls, leaving the big blind still to act.
  let currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  while (currentPlayer !== bigBlindPlayer) {
    expect(game.call(currentPlayer.socket)).toBe(true);
    currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  }

  expect(currentPlayer).toBe(bigBlindPlayer);
  expect(game.bigBlindWent).toBe(false);
  expect(game.roundData.bets.length).toBe(1);

  // Big blind disconnects instead of acting.
  game.disconnectPlayer(bigBlindPlayer);

  expect(game.bigBlindWent).toBe(true);
  expect(game.players.map((p) => p.getUsername())).not.toContain(
    bigBlindPlayer.getUsername()
  );
  // Hand should have advanced past pre-flop instead of stalling.
  expect(game.roundData.bets.length).toBeGreaterThanOrEqual(2);
});

function getCurrentPlayer(players) {
  const currentTurnArr = players.filter((p) => p.status === 'Their Turn');
  expect(currentTurnArr.length).toBe(1);
  return currentTurnArr[0];
}

test('Test fold', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);

  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  const p3 = game.addPlayer("3", sock3);
  expect(p3.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();

  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = getCurrentPlayer(game.players);
  expect(game.raise(currentPlayer.socket, 30)).toBe(true);
  currentPlayer = getCurrentPlayer(game.players);
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = getCurrentPlayer(game.players);
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);

  // Flop
  currentPlayer = getCurrentPlayer(game.players);
  game.fold(currentPlayer.socket);
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(3);

  // Turn
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(4);

  // River
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  currentPlayer = getCurrentPlayer(game.players);
  game.check(currentPlayer.socket);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(4);
  expect(game.roundInProgress).toBe(false);

  expect(game.players.reduce((a, c) => a + c.money, 0)).toBe(
    STARTING_CHIPS * 3
  );
});

test('Test all fold', () => {
  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const sock3 = new events.EventEmitter();
  sock3.id = 3;

  const p1 = game.addPlayer("1", sock1);
  expect(p1.money).toBe(STARTING_CHIPS);

  const p2 = game.addPlayer("2", sock2);
  expect(p2.money).toBe(STARTING_CHIPS);

  const p3 = game.addPlayer("3", sock3);
  expect(p3.money).toBe(STARTING_CHIPS);

  expect(game.findPlayer(1)).toBe(p1);
  expect(game.findPlayer(2)).toBe(p2);
  expect(game.findPlayer(3)).toBe(p3);

  expect(game.players.length).toBe(3);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  game.startGame();

  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.raise(currentPlayer.socket, 30)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);
  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);
  expect(game.roundInProgress).toBe(true);

  // Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.fold(currentPlayer.socket);
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  game.fold(currentPlayer.socket);

  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBe(2);
  expect(game.roundInProgress).toBe(false);

  expect(game.players.reduce((a, c) => a + c.money, 0)).toBe(
    STARTING_CHIPS * 3
  );
});

test('Test _distributeMoney', () => {
  const game = new Game('best-game', '1');
  const pot = 100;
  const players = [
    { live: true, invested: 20, handStrength: 100, result: 0 },
    { live: true, invested: 50, handStrength: 200, result: 0 },
    { live: true, invested: 80, handStrength: 90, result: 0 },
    { live: true, invested: 80, handStrength: 100, result: 0 },
    { live: true, invested: 1000, handStrength: 0, result: 0 },
  ];

  game.calculateMoney(pot, players);

  expect(players[0].result).toBe(0);
  expect(players[1].result).toBe(320);
  expect(players[2].result).toBe(0);
  expect(players[3].result).toBe(90);
  expect(players[4].result).toBe(920);
});



test('Test infinite loop issue', () => {
  // Log data retreive before infinite loop crash
  const playersData = [{
    "username": "$2a$11$sN3yXEe38GKcnCfxIO2GCe8/rGoSkZ5AtWba6p1cq5NQXQ4HZUYPS",
    "cards": [{
      "value": "A",
      "suit": "♣"
    }, {
      "value": 3,
      "suit": "♠"
    }],
    "money": 5,
  }, {
    "username": "$2a$11$Um0VU8I.gNaKNi6LeFFUG.n7yvlTcCd0CNIozbfofFoP82IcMmri2",
    "cards": [{
      "value": "Q",
      "suit": "♠"
    }, {
      "value": 2,
      "suit": "♣"
    }],
    "money": 5,
  }, {
    "username": "$2a$11$EFSkbqmMr9.xSzEWOWXcEuu85NypJpg3XUdMrT3oO1FmMjB1wF4JO",
    "cards": [{
      "value": 10,
      "suit": "♥"
    }, {
      "value": "A",
      "suit": "♥"
    }],
    "money": 5,
  }];

  const game = new Game('best-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;

  // Mock socket
  const sockets = [];
  const players = [];
  for (const pl of playersData) {
    const sock = new events.EventEmitter();
    sock.id = pl.username;
    sockets.push(sock);

    const p = game.addPlayer(pl.username, sock);
    p.money = pl.money;
    players.push(p);
  }

  expect(game.players.length).toBe(playersData.length);

  expect(game.roundNum).toBe(0);
  expect(game.roundData.bets.length).toBe(0);

  game.startGame();

  for (const [index, pl] of Object.entries(playersData)) {
    const p = players[Number(index)];
    p.cards = [...pl.cards];
  }

  expect(game.roundNum).toBe(1);
  expect(game.roundData.bets.length).toBeGreaterThan(0);

  let currentPlayer;

  // Pre-Flop
  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true);

  currentPlayer = game.players.filter((p) => p.status === 'Their Turn')[0];
  expect(game.call(currentPlayer.socket)).toBe(true); // This call made an infinite loop
});

test('new players start with STARTING_CHIPS', () => {
  const game = new Game('stack-game', 'host');
  const sock = new events.EventEmitter();
  sock.id = 1;
  const p = game.addPlayer('host', sock);
  expect(p.money).toBe(STARTING_CHIPS);
  expect(p.buyIns).toBe(0);
});

test('rebuy adds STARTING_CHIPS and increments shame coins when broke', () => {
  const game = new Game('rebuy-game', '1');
  game.autoBuyIns = false;
  const sock1 = new events.EventEmitter();
  sock1.id = 1;
  const sock2 = new events.EventEmitter();
  sock2.id = 2;
  const p1 = game.addPlayer('1', sock1);
  game.addPlayer('2', sock2);
  p1.money = 0;
  expect(game.rebuy(sock1)).toBe(true);
  expect(p1.money).toBe(STARTING_CHIPS);
  expect(p1.buyIns).toBe(1);
  expect(game.rebuy(sock1)).toBe(false); // not broke anymore
});

test('broke player is not dealt cards on next round', () => {
  const game = new Game('spec-game', '1');
  game.autoBuyIns = false;
  game.smallBlind = 5;
  game.bigBlind = 10;
  const s1 = new events.EventEmitter();
  s1.id = 1;
  const s2 = new events.EventEmitter();
  s2.id = 2;
  const s3 = new events.EventEmitter();
  s3.id = 3;
  const p1 = game.addPlayer('1', s1);
  game.addPlayer('2', s2);
  game.addPlayer('3', s3);
  p1.money = 0;
  game.startGame();
  expect(p1.cards.length).toBe(0);
  expect(
    game.players.filter((p) => p.money > 0).every((p) => p.cards.length === 2)
  ).toBe(true);
});

test('rebuy is rejected while a hand is in progress', () => {
  const game = new Game('mid-hand-rebuy-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;
  const s1 = new events.EventEmitter();
  s1.id = 1;
  const s2 = new events.EventEmitter();
  s2.id = 2;
  const s3 = new events.EventEmitter();
  s3.id = 3;
  const p1 = game.addPlayer('1', s1);
  game.addPlayer('2', s2);
  game.addPlayer('3', s3);
  p1.money = 0;
  game.startGame();

  expect(game.roundInProgress).toBe(true);
  expect(p1.spectating).toBe(true);

  expect(game.rebuy(s1)).toBe(false);
  expect(p1.money).toBe(0);
  expect(p1.buyIns).toBe(0);
});

test('fewer than two funded players pauses instead of dealing a corrupted hand', () => {
  const game = new Game('pause-game', '1');
  game.smallBlind = 5;
  game.bigBlind = 10;
  const s1 = new events.EventEmitter();
  s1.id = 1;
  const s2 = new events.EventEmitter();
  s2.id = 2;
  const p1 = game.addPlayer('1', s1);
  const p2 = game.addPlayer('2', s2);
  p1.money = 0;

  game.startGame();

  expect(game.roundInProgress).toBe(false);
  expect(p1.cards.length).toBe(0);
  expect(p2.cards.length).toBe(0);
  expect(game.roundData.bets.length).toBe(0);
  expect(game.community.length).toBe(0);
  // The lone funded player must not have been charged a blind.
  expect(p2.money).toBe(STARTING_CHIPS);
});