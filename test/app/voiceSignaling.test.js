const { buildVoicePeerList, canRelayVoiceSignal } = require('../../src/voiceSignaling.js');

function mockGame(code, players) {
  return {
    getCode: () => code,
    players,
  };
}

function mockPlayer(username, socketId) {
  return {
    socket: { id: socketId },
    getUsername: () => username,
  };
}

describe('voiceSignaling', () => {
  test('buildVoicePeerList returns only other voice participants', () => {
    const game = mockGame('1234', [
      mockPlayer('alice', 's1'),
      mockPlayer('bob', 's2'),
      mockPlayer('carol', 's3'),
    ]);
    const voice = new Set(['s2']);
    const peers = buildVoicePeerList(game, 's1', voice);
    expect(peers).toEqual([{ socketId: 's2', username: 'bob' }]);
  });

  test('canRelayVoiceSignal allows same room only', () => {
    const a = mockGame('1234', []);
    const b = mockGame('1234', []);
    const c = mockGame('9999', []);
    expect(canRelayVoiceSignal(a, b)).toBe(true);
    expect(canRelayVoiceSignal(a, c)).toBe(false);
    expect(canRelayVoiceSignal(null, b)).toBe(false);
  });
});
