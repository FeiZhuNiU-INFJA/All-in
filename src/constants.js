module.exports = {
  STARTING_CHIPS: 2000,
  MAX_PLAYERS: 10,
  MIN_PLAYERS_TO_START: 2,
  // Brief window after a socket drop (e.g. page refresh) to rejoin without
  // being folded / removed from the table.
  DISCONNECT_GRACE_MS: 20000,
};
