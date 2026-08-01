const {
  validateUsername,
  validateJoin,
  validateStart,
  MAX_PLAYERS,
} = require('../../src/joinValidation.js');

function fakeRoom({ code, players, pendingNames = [] }) {
  const playerObjs = players.map((name) => ({
    getUsername: () => name,
    pendingDisconnect: pendingNames.indexOf(name) !== -1,
  }));
  return {
    getCode: () => code,
    getPlayersArray: () => players,
    getNumPlayers: () => players.length,
    players: playerObjs,
  };
}

test('rejects empty or long usernames', () => {
  expect(validateUsername('')).toBe('invalid_name');
  expect(validateUsername('abcdefghijklm')).toBe('invalid_name');
  expect(validateUsername('Alice')).toBe(null);
});

test('join validation covers missing room, duplicate, and full', () => {
  const rooms = [fakeRoom({ code: '1234', players: ['Alice', 'Bob'] })];
  expect(validateJoin({ username: 'Carol', code: '9999', rooms })).toBe(
    'room_not_found'
  );
  expect(validateJoin({ username: 'Alice', code: '1234', rooms })).toBe(
    'duplicate_name'
  );
  const fullPlayers = Array.from({ length: MAX_PLAYERS }, (_, i) => 'P' + i);
  const fullRooms = [fakeRoom({ code: '1234', players: fullPlayers })];
  expect(validateJoin({ username: 'Zed', code: '1234', rooms: fullRooms })).toBe(
    'room_full'
  );
  expect(validateJoin({ username: 'Carol', code: '1234', rooms })).toBe(null);
});

test('join allows reclaiming a pending-disconnect seat', () => {
  const rooms = [
    fakeRoom({
      code: '1234',
      players: ['Alice', 'Bob'],
      pendingNames: ['Alice'],
    }),
  ];
  expect(validateJoin({ username: 'Alice', code: '1234', rooms })).toBe(null);
});

test('start requires two players', () => {
  expect(validateStart(null)).toBe('room_not_found');
  expect(validateStart(fakeRoom({ code: '1', players: ['A'] }))).toBe(
    'not_enough_players'
  );
  expect(validateStart(fakeRoom({ code: '1', players: ['A', 'B'] }))).toBe(
    null
  );
});
