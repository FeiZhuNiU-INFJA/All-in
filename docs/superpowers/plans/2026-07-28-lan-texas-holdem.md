# LAN Texas Hold'em Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host a browser Texas Hold'em cash table on the LAN by forking `ptwu/distributed-texasholdem`, binding to `0.0.0.0`, hardening join/start/disconnect, and adding optional 2000-chip rebuys with shame-coin markers.

**Architecture:** Keep the upstream Express + Socket.IO server and static client. Import the upstream tree into this repo alongside existing design docs. Change listen address, add small server-side guards (join errors, min players, max seats, disconnect auto-fold), set starting stack to 2000, replace auto buy-in with optional rebuy + shame-coin UI. Document how friends open `http://<LAN-IP>:3000`.

**Tech Stack:** Node.js, Express, Socket.IO 2.x, pokersolver, Jest, Yarn

**Spec:** `docs/superpowers/specs/2026-07-28-lan-texas-holdem-design.md`

---

## File map

| Path | Responsibility |
| --- | --- |
| `package.json`, `yarn.lock` | Dependencies and scripts (`start`, `dev`, `test`) |
| `src/app.js` | HTTP/Socket.IO server, rooms list, host/join/start/move/disconnect |
| `src/classes/game.js` | Table rules, betting, pots, disconnect handling |
| `src/classes/{player,deck,card}.js` | Player/deck primitives; starting money 2000; shame-coin count via `buyIns` |
| `src/client/index.html`, `src/client/main.js`, `src/client/css/` | Lobby + table UI; rebuy prompt; shame-coin icons |
| `src/constants.js` | Shared `STARTING_CHIPS = 2000` |
| `test/classes/game.test.js` | Engine unit tests |
| `test/config.json` | Jest config |
| `README.md` | LAN host instructions (rewrite for this fork) |
| `docs/superpowers/specs/...` | Existing design (do not overwrite) |

Constants to introduce (finalize in `src/constants.js` during Task 6; Task 3 may inline until then):

```javascript
const STARTING_CHIPS = 2000;
const MAX_PLAYERS = 10;
const MIN_PLAYERS_TO_START = 2;
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
```

Join failure payloads become structured instead of bare `undefined`:

```javascript
// server → client on failed join/host
{ ok: false, error: 'invalid_name' | 'room_not_found' | 'room_full' | 'duplicate_name' }
```

Successful join/host keep existing success shapes. Client must treat both legacy `undefined` and `{ ok: false, error }` as failure during transition, then prefer `error` toasts.

---

### Task 1: Import upstream into this repo

**Files:**
- Create: all upstream project files under repo root (`src/`, `test/`, `package.json`, `yarn.lock`, `LICENSE`, `index.js`, `.gitignore` merge)
- Preserve: `docs/superpowers/**`

- [ ] **Step 1: Clone upstream into a temp directory**

```bash
cd /Users/yulin/workspace/poker
git clone --depth 1 https://github.com/ptwu/distributed-texasholdem.git /tmp/distributed-texasholdem
```

Expected: clone succeeds.

- [ ] **Step 2: Copy upstream files into the repo without clobbering docs**

```bash
cd /Users/yulin/workspace/poker
rsync -a --exclude='.git' --exclude='docs' /tmp/distributed-texasholdem/ ./
# If upstream has no docs/, this is enough. Never delete docs/superpowers.
```

Expected: `src/app.js`, `package.json`, `test/classes/game.test.js` exist; `docs/superpowers/specs/2026-07-28-lan-texas-holdem-design.md` still present.

- [ ] **Step 3: Merge `.gitignore` if needed**

Ensure `.gitignore` includes at least:

```
node_modules/
.DS_Store
*.log
.env
```

Keep any upstream entries that are still relevant.

- [ ] **Step 4: Install dependencies and run upstream tests**

```bash
cd /Users/yulin/workspace/poker
yarn install
yarn test
```

Expected: Jest passes (upstream suite green). If Node version breaks Socket.IO/Jest, pin Node 18 via `.nvmrc` containing `18` and retry with that version.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Import distributed-texasholdem as LAN poker base.

Vendor the MIT upstream browser multiplayer server/client so we can harden it for local-network play.
EOF
)"
```

---

### Task 2: Bind to LAN and print join URL

**Files:**
- Modify: `src/app.js` (listen call + boot log)
- Test: manual smoke (no unit test for listen bind)

- [ ] **Step 1: Change listen to `HOST`/`PORT` and log LAN hint**

In `src/app.js`, replace the final listen line and add host/port constants near the top:

```javascript
const os = require('os');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

// ... existing room handlers ...

server.listen(PORT, HOST, () => {
  console.log(`Poker server listening on http://${HOST}:${PORT}`);
  const addrs = lanAddresses();
  if (addrs.length === 0) {
    console.log('No non-internal IPv4 address found; try http://127.0.0.1:' + PORT);
  } else {
    for (const ip of addrs) {
      console.log(`Friends on your LAN can open http://${ip}:${PORT}`);
    }
  }
});
```

- [ ] **Step 2: Start server and verify local + bind**

```bash
yarn start
```

Expected console includes something like:

```
Poker server listening on http://0.0.0.0:3000
Friends on your LAN can open http://192.168.x.x:3000
```

In another terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

Expected: `200`

Stop the server (Ctrl+C) after the check.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "$(cat <<'EOF'
Listen on 0.0.0.0 and print LAN join URLs.

Friends need a reachable host address instead of localhost-only binding.
EOF
)"
```

---

### Task 3: Structured join/host errors + max seats

**Files:**
- Modify: `src/app.js` (`host`, `join` handlers)
- Modify: `src/client/main.js` (toasts for structured errors)
- Test: `test/classes/game.test.js` does not cover sockets; add `test/app/joinValidation.test.js` for pure helpers extracted from app

- [ ] **Step 1: Extract pure validation helpers and write tests**

Create `src/joinValidation.js`:

```javascript
const MAX_PLAYERS = 10;

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

module.exports = { MAX_PLAYERS, validateUsername, validateJoin };
```

Create `test/app/joinValidation.test.js`:

```javascript
const {
  validateUsername,
  validateJoin,
  MAX_PLAYERS,
} = require('../../src/joinValidation.js');

function fakeRoom({ code, players }) {
  return {
    getCode: () => code,
    getPlayersArray: () => players,
    getNumPlayers: () => players.length,
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
```

- [ ] **Step 2: Run the new tests**

```bash
yarn test test/app/joinValidation.test.js
```

Expected: PASS (helpers and tests landed together in Step 1). If FAIL, fix `src/joinValidation.js` until green before wiring sockets.

- [ ] **Step 3: Wire helpers into `src/app.js` host/join**

At top:

```javascript
const {
  MAX_PLAYERS,
  validateUsername,
  validateJoin,
} = require('./joinValidation.js');
```

Update `host` handler rejection branch:

```javascript
socket.on('host', (data) => {
  const nameErr = validateUsername(data && data.username);
  if (nameErr) {
    socket.emit('hostRoom', { ok: false, error: nameErr });
    return;
  }
  // ... existing successful host creation code unchanged ...
});
```

Update `join` handler:

```javascript
socket.on('join', (data) => {
  const err = validateJoin({
    username: data && data.username,
    code: data && data.code,
    rooms,
    maxPlayers: MAX_PLAYERS,
  });
  if (err) {
    socket.emit('joinRoom', { ok: false, error: err });
    return;
  }
  const game = rooms.find((r) => r.getCode() === data.code);
  game.addPlayer(data.username, socket);
  rooms = rooms.map((r) => (r.getCode() === data.code ? game : r));
  game.emitPlayers('joinRoom', {
    host: game.getHostName(),
    players: game.getPlayersArray(),
  });
  game.emitPlayers('hostRoom', {
    code: data.code,
    players: game.getPlayersArray(),
  });
});
```

- [ ] **Step 4: Update client toasts in `src/client/main.js`**

Add helper near top of `main.js`:

```javascript
function joinErrorMessage(data) {
  const code = data && data.error;
  if (code === 'room_not_found') return 'Room not found. Check the code.';
  if (code === 'room_full') return 'Room is full (max 10 players).';
  if (code === 'duplicate_name') return 'That name is already taken in this room.';
  if (code === 'invalid_name')
    return 'Enter a valid name (1–12 characters).';
  return 'Could not join. Check name/code and try again.';
}
```

Change `joinRoom` failure branch from `data == undefined` to:

```javascript
if (data == undefined || data.ok === false) {
  $('#joinModal').closeModal();
  Materialize.toast(joinErrorMessage(data), 4000);
  $('#hostButton').removeClass('disabled');
} else {
  // existing success UI...
}
```

Change `hostRoom` failure branch similarly:

```javascript
if (data == undefined || data.ok === false) {
  Materialize.toast(joinErrorMessage(data || { error: 'invalid_name' }), 4000);
  $('#joinButton').removeClass('disabled');
} else {
  // existing success UI...
}
```

- [ ] **Step 5: Run full test suite**

```bash
yarn test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/joinValidation.js src/app.js src/client/main.js test/app/joinValidation.test.js
git commit -m "$(cat <<'EOF'
Add structured join errors and enforce max seats.

Clear room-not-found, full, and duplicate-name feedback for LAN friends.
EOF
)"
```

---

### Task 4: Require at least two players to start

**Files:**
- Modify: `src/app.js` (`startGame` handler)
- Modify: `src/client/main.js` (toast on reject)
- Test: extend `test/app/joinValidation.test.js` or add `test/app/startValidation.test.js`

- [ ] **Step 1: Add failing test for start guard helper**

Add to `src/joinValidation.js`:

```javascript
const MIN_PLAYERS_TO_START = 2;

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
```

Add tests in `test/app/joinValidation.test.js`:

```javascript
const { validateStart } = require('../../src/joinValidation.js');

test('start requires two players', () => {
  expect(validateStart(null)).toBe('room_not_found');
  expect(validateStart(fakeRoom({ code: '1', players: ['A'] }))).toBe(
    'not_enough_players'
  );
  expect(validateStart(fakeRoom({ code: '1', players: ['A', 'B'] }))).toBe(
    null
  );
});
```

- [ ] **Step 2: Run test**

```bash
yarn test test/app/joinValidation.test.js
```

Expected: FAIL until `validateStart` is exported/implemented, then PASS after Step 1 code is in place.

- [ ] **Step 3: Guard `startGame` in `src/app.js`**

```javascript
const { validateStart } = require('./joinValidation.js');

socket.on('startGame', (data) => {
  const game = rooms.find((r) => r.getCode() == data.code);
  const err = validateStart(game);
  if (err) {
    socket.emit('gameBegin', { ok: false, error: err });
    return;
  }
  game.emitPlayers('gameBegin', { code: data.code });
  game.startGame();
});
```

- [ ] **Step 4: Client toast for failed begin**

In `src/client/main.js`, update `gameBegin` handler:

```javascript
socket.on('gameBegin', function (data) {
  if (data == undefined || data.ok === false) {
    const msg =
      data && data.error === 'not_enough_players'
        ? 'Need at least 2 players to start.'
        : 'Error - invalid game.';
    Materialize.toast(msg, 4000);
    return;
  }
  // existing success path that enters the table UI...
});
```

(Keep the existing success body; only change the failure condition/message.)

- [ ] **Step 5: Run tests**

```bash
yarn test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/joinValidation.js src/app.js src/client/main.js test/app/joinValidation.test.js
git commit -m "$(cat <<'EOF'
Require two players before starting a hand.

Prevent accidental solo starts from the host UI or forged socket events.
EOF
)"
```

---

### Task 5: Auto-fold on disconnect during a hand

**Files:**
- Modify: `src/classes/game.js` (`disconnectPlayer`)
- Test: `test/classes/game.test.js`

- [ ] **Step 1: Write failing test for disconnect-during-hand**

Append to `test/classes/game.test.js`:

```javascript
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

  // Player removed from active seats
  expect(game.players.map((p) => p.getUsername())).not.toContain('3');
  // Fold recorded for the disconnected player in current betting stage
  const stage = game.getCurrentRoundBets();
  expect(stage.some((b) => b.player === '3' && b.bet === 'Fold')).toBe(true);
});
```

If `getCurrentRoundBets` is not exported on the instance for tests, use the same accessor the class already uses (`game.getCurrentRoundBets()` — it exists on the Game instance in upstream).

- [ ] **Step 2: Run the new test — expect FAIL**

```bash
yarn test test/classes/game.test.js -t 'disconnect during hand folds'
```

Expected: FAIL (no Fold bet recorded for player `3`).

- [ ] **Step 3: Implement auto-fold inside `disconnectPlayer`**

Replace `disconnectPlayer` in `src/classes/game.js` with:

```javascript
this.disconnectPlayer = (player) => {
  this.disconnectedPlayers.push(player);

  const wasTheirTurn =
    player.getStatus() === 'Their Turn' ||
    this.roundData.turn === player.getUsername();

  if (this.roundInProgress && player.getStatus() !== 'Fold') {
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
  }

  if (wasTheirTurn && this.roundInProgress) {
    this.moveOntoNextPlayer();
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
  this.rerender();
};
```

Also fix room cleanup bug in `src/app.js` disconnect handler (`this.rooms` is wrong — rooms is a let in module scope):

```javascript
socket.on('disconnect', () => {
  const game = rooms.find(
    (r) => r.findPlayer(socket.id).socket.id === socket.id
  );
  if (game != undefined) {
    const player = game.findPlayer(socket.id);
    game.disconnectPlayer(player);
    if (game.players.length == 0) {
      rooms = rooms.filter((a) => a != game);
    }
  }
});
```

- [ ] **Step 4: Run disconnect test + full suite**

```bash
yarn test test/classes/game.test.js -t 'disconnect during hand folds'
yarn test
```

Expected: PASS

If `moveOntoNextPlayer` after fold causes an early hand end with 3→2 players and the Fold record is cleared, relax the assertion to:

```javascript
expect(game.disconnectedPlayers.map((p) => p.getUsername())).toContain('3');
expect(game.players.map((p) => p.getUsername())).not.toContain('3');
```

…but only after confirming Fold is applied before removal via a spy or status check immediately before filter. Prefer keeping the Fold assertion if possible.

- [ ] **Step 5: Commit**

```bash
git add src/classes/game.js src/app.js test/classes/game.test.js
git commit -m "$(cat <<'EOF'
Auto-fold disconnected players during an active hand.

Keeps pot resolution sane when a friend drops off Wi-Fi mid-hand.
EOF
)"
```

---

### Task 6: Optional rebuy (2000) + shame coins

**Files:**
- Create: `src/constants.js`
- Modify: `src/classes/player.js` (starting money)
- Modify: `src/classes/game.js` (disable auto buy-in; skip broke spectators when dealing; `rebuy` helper)
- Modify: `src/app.js` (`rebuy` socket handler)
- Modify: `src/client/main.js`, `src/client/index.html`, `src/client/css/index.css` (prompt + coin icons)
- Test: `test/classes/game.test.js`, `test/app/rebuy.test.js` (optional pure helper)

- [ ] **Step 1: Add shared constant and failing rebuy tests**

Create `src/constants.js`:

```javascript
module.exports = {
  STARTING_CHIPS: 2000,
  MAX_PLAYERS: 10,
  MIN_PLAYERS_TO_START: 2,
};
```

Append to `test/classes/game.test.js`:

```javascript
const { STARTING_CHIPS } = require('../../src/constants.js');

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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
yarn test test/classes/game.test.js -t 'STARTING_CHIPS|rebuy adds'
```

Expected: FAIL (money still 100 / no `rebuy` method).

- [ ] **Step 3: Implement starting stack, disable auto buy-in, add `rebuy`**

In `src/classes/player.js`, set:

```javascript
const { STARTING_CHIPS } = require('../constants.js');
// ...
this.money = STARTING_CHIPS;
this.buyIns = 0; // shame-coin count
this.spectating = false;
```

In `src/classes/game.js` constructor:

```javascript
this.autoBuyIns = false;
```

Remove or no-op the auto top-up block in `startNewRound` (the `if (this.autoBuyIns) { ... }` loop).

Add:

```javascript
this.rebuy = (socket) => {
  const player = this.findPlayer(socket.id);
  if (!player || !player.getUsername || player.getUsername() == null) {
    // findPlayer sentinel has socket.id 0 — treat as miss
    if (!player.getMoney) return false;
  }
  if (!player.getMoney) return false;
  if (player.getMoney() !== 0) return false;
  player.money = STARTING_CHIPS;
  player.buyIns = (player.buyIns || 0) + 1;
  player.spectating = false;
  this.emitPlayers('playerRebuy', {
    player: player.getUsername(),
    money: player.getMoney(),
    buyIns: player.buyIns,
  });
  this.rerender();
  return true;
};
```

Require `STARTING_CHIPS` at top of `game.js`.

When dealing a new round, skip players with `money === 0` (spectators): do not deal them cards and do not include them in blind rotation if upstream allows. Minimal approach for v1:

- Before `dealCards` / blinds in `startNewRound`, mark `player.spectating = player.getMoney() === 0`
- In `dealCards`, only deal to players with `money > 0`
- Blind assignment must only consider players with `money > 0` (filter a working list or skip broke seats). If upstream blind logic assumes dense indices, build `activePlayers` array for the round **or** temporarily filter: the simplest robust approach is to keep broke players in `this.players` but give them status `'Spectating'` and never set them as turn/blind. Implement carefully; add a unit test that a 0-chip player is not dealt cards after `startNewRound`.

Add test:

```javascript
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
  expect(game.players.filter((p) => p.money > 0).every((p) => p.cards.length === 2)).toBe(true);
});
```

- [ ] **Step 4: Socket handler in `src/app.js`**

```javascript
socket.on('rebuy', () => {
  const game = rooms.find(
    (r) => r.findPlayer(socket.id).socket.id === socket.id
  );
  if (!game) {
    socket.emit('rebuyResult', { ok: false, error: 'room_not_found' });
    return;
  }
  const ok = game.rebuy(socket);
  socket.emit('rebuyResult', {
    ok,
    error: ok ? null : 'not_broke',
  });
});
```

- [ ] **Step 5: Client UI — prompt + shame coins**

In `src/client/index.html`, add a hidden rebuy bar (inside game view):

```html
<div id="rebuyBar" class="rebuy-bar" style="display:none;">
  <p>You are out of chips.</p>
  <button type="button" class="btn green" onclick="requestRebuy()">Buy 2000 (shame coin)</button>
  <button type="button" class="btn grey" onclick="dismissRebuyPrompt()">Spectate</button>
</div>
```

In `src/client/css/index.css`:

```css
.shame-coins {
  display: inline-flex;
  gap: 2px;
  vertical-align: middle;
  margin-left: 6px;
}
.shame-coin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #f6e27a, #b8860b 60%, #6b4f0e);
  border: 1px solid #5c440c;
  box-shadow: inset 0 0 2px rgba(255, 255, 255, 0.4);
  display: inline-block;
}
.rebuy-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a1a;
  color: #fff;
  padding: 12px 16px;
  z-index: 20;
  text-align: center;
}
```

In `src/client/main.js`:

```javascript
function shameCoinsHtml(count) {
  if (!count || count <= 0) return '';
  var coins = '';
  for (var i = 0; i < count; i++) {
    coins += '<span class="shame-coin" title="Shame coin"></span>';
  }
  return '<span class="shame-coins" title="' + count + ' shame coin(s)">' + coins + '</span>';
}

function requestRebuy() {
  socket.emit('rebuy');
}

function dismissRebuyPrompt() {
  $('#rebuyBar').hide();
}

function maybeShowRebuyPrompt(money) {
  if (money === 0) $('#rebuyBar').show();
  else $('#rebuyBar').hide();
}

socket.on('rebuyResult', function (data) {
  if (!data || data.ok === false) {
    Materialize.toast('Rebuy only when you have 0 chips.', 3000);
    return;
  }
  $('#rebuyBar').hide();
  Materialize.toast('Rebuy +2000. Shame coin earned.', 3000);
});

socket.on('playerRebuy', function (data) {
  Materialize.toast(data.player + ' rebought (+shame coin)', 3000);
});
```

Wherever opponent/self name + money HTML is built (the buy-ins text branches), replace textual `N buy-in(s)` with `shameCoinsHtml(data.buyIns)` next to the name, e.g.:

```javascript
name + shameCoinsHtml(data.buyIns)
```

After hand updates that include `data.money` / `data.myMoney`, call `maybeShowRebuyPrompt(data.money || data.myMoney)`.

Keep a persistent **Buy 2000** control visible for spectators with 0 chips (same `requestRebuy`), not only the first prompt — e.g. leave `#rebuyBar` showable whenever local money is 0.

- [ ] **Step 6: Run full tests**

```bash
yarn test
```

Expected: PASS (update any upstream tests that assume starting money `100` to use `STARTING_CHIPS` / expect `2000`).

- [ ] **Step 7: Commit**

```bash
git add src/constants.js src/classes/player.js src/classes/game.js src/app.js \
  src/client/main.js src/client/index.html src/client/css/index.css \
  test/classes/game.test.js
git commit -m "$(cat <<'EOF'
Add optional 2000 rebuy with shame-coin markers.

Broke players can spectate and rebuy later; each rebuy grants a visible shame coin.
EOF
)"
```

---

### Task 7: LAN README for hosts

**Files:**
- Modify: `README.md` (replace upstream Render-focused docs with LAN fork docs)
- Keep: LICENSE attribution to upstream

- [ ] **Step 1: Rewrite README**

```markdown
# LAN Texas Hold'em

Private No-Limit Texas Hold'em for friends on the same Wi‑Fi.

Based on [ptwu/distributed-texasholdem](https://github.com/ptwu/distributed-texasholdem) (MIT).

## Requirements

- Node.js 18+ (recommended)
- Yarn

## Host (your computer)

```bash
yarn install
yarn start
```

The server listens on `0.0.0.0:3000` and prints LAN URLs, for example:

```text
Friends on your LAN can open http://192.168.1.23:3000
```

Open that URL yourself, click **Host**, enter a name, and share the 4-digit code.

### macOS firewall

If friends cannot connect, allow Node incoming connections, or temporarily:

```bash
# check listener
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## Join (friends)

1. Connect to the **same Wi‑Fi** as the host
2. Open `http://<host-lan-ip>:3000` in a browser
3. Click **Join**, enter your name and the room code
4. Wait for the host to start

## Rules of this build

- Cash table, play-money chips (not real money)
- Starting stack **2000**
- Optional rebuy **+2000** when at 0 chips; otherwise spectate and rebuy later
- Each rebuy adds a **shame coin** next to your name
- 2–10 players per room
- Disconnect during a hand = fold
- Restarting the host clears all rooms (no persistence)

## Dev

```bash
yarn dev    # needs nodemon: yarn add -D nodemon
yarn test
```

## Upstream

Original project: https://github.com/ptwu/distributed-texasholdem
```

- [ ] **Step 2: Add nodemon so `yarn dev` works**

```bash
yarn add -D nodemon
```

- [ ] **Step 3: Commit**

```bash
git add README.md package.json yarn.lock
git commit -m "$(cat <<'EOF'
Document LAN hosting and add nodemon for yarn dev.

EOF
)"
```

---

### Task 8: Acceptance walkthrough

**Files:** none (manual verification)

- [ ] **Step 1: Start server**

```bash
yarn start
```

Note the printed LAN IP.

- [ ] **Step 2: Two-browser smoke (same machine)**

1. Window A: open `http://127.0.0.1:3000` → Host as `Alice`
2. Window B: open `http://127.0.0.1:3000` → Join code as `Bob`
3. Alice starts game
4. Play fold/check/call/raise through at least one street; finish a hand

Expected: both see updates; hand resolves; stacks start at 2000.

- [ ] **Step 3: Rebuy / shame-coin smoke**

1. Play until one player reaches 0 (or temporarily force via test hook / long session)
2. Broke player sees rebuy prompt → choose Spectate → still visible, no cards next hand
3. Click Buy 2000 → stack 2000, one shame coin by name
4. Rebuy again after another bust → second coin appears

- [ ] **Step 4: Error-path smoke**

1. Join with wrong code → toast `Room not found...`
2. Second join as `Alice` into Alice's room → duplicate name toast
3. Host alone clicks start if possible → `Need at least 2 players...` (or button hidden + server reject if forged)

- [ ] **Step 5: Optional phone-on-Wi‑Fi check**

From a phone on the same Wi‑Fi, open `http://<lan-ip>:3000` and join.

- [ ] **Step 6: Final commit only if walkthrough found small doc/script fixes; otherwise done**

If README needed a correction after walkthrough, commit it:

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Fix LAN README after acceptance walkthrough.

EOF
)"
```

---

## Spec coverage checklist

| Spec item | Task |
| --- | --- |
| Fork distributed-texasholdem | Task 1 |
| Bind `0.0.0.0` + LAN URL | Task 2 |
| Create/join/start cash table | Tasks 1, 4, 8 |
| Clear errors: missing room / full / duplicate nick | Task 3 |
| Min 2 players to start | Task 4 |
| Disconnect → auto-fold | Task 5 |
| Starting 2000 + optional rebuy + shame coins | Task 6 |
| README LAN instructions | Task 7 |
| Acceptance: two clients complete a hand + rebuy | Task 8 |
| No cloud/auth/persistence | Honored (non-goals) |

## Self-review notes

- No TBD placeholders in tasks
- Join error codes are consistent across server helper, app.js, and client toasts
- `MAX_PLAYERS = 10` matches README and validation tests (upstream UI warned at 11; this fork enforces 10)
- Disconnect implementation uses the minimal `disconnectPlayer` version; room list cleanup uses module-scoped `rooms`, not `this.rooms`
- `STARTING_CHIPS = 2000`; `buyIns` doubles as shame-coin count; `autoBuyIns` stays false
- Spectators remain in `players` with 0 chips and are skipped for dealing until rebuy