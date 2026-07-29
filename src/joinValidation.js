const { MAX_PLAYERS, MIN_PLAYERS_TO_START } = require('./constants.js');

function validateUsername(username) {
  if (username == null || username === '' || username.length > 12) {
    return 'invalid_name';
  }
  return null;
}

function validateJoin({ username, code, rooms, maxPlayers = MAX_PLAYERS }) {
  const nameErr = validateUsername(username);
  if (nameErr) return nameErr;
  const game = rooms.find((r) => r.getCode() === code);
  if (!game) return 'room_not_found';
  if (game.getPlayersArray().some((p) => p === username)) return 'duplicate_name';
  if (game.getNumPlayers() >= maxPlayers) return 'room_full';
  return null;
}

function validateStart(game, minPlayers = MIN_PLAYERS_TO_START) {
  if (!game) return 'room_not_found';
  if (game.getNumPlayers() < minPlayers) return 'not_enough_players';
  return null;
}

module.exports = {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  validateUsername,
  validateJoin,
  validateStart,
};
