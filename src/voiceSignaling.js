/** Helpers for in-room WebRTC voice relay (same room only). */

function buildVoicePeerList(game, socketId, voiceSocketIds) {
  if (!game || !socketId || !voiceSocketIds) return [];
  const peers = [];
  game.players.forEach((p) => {
    if (
      p.socket &&
      p.socket.id !== socketId &&
      voiceSocketIds.has(p.socket.id)
    ) {
      peers.push({ socketId: p.socket.id, username: p.getUsername() });
    }
  });
  return peers;
}

function canRelayVoiceSignal(fromGame, toGame) {
  if (!fromGame || !toGame) return false;
  return fromGame.getCode() === toGame.getCode();
}

module.exports = { buildVoicePeerList, canRelayVoiceSignal };
