// server-side socket.io backend event handling
const express = require('express');
const http = require('http');
const os = require('os');
const socketio = require('socket.io');
const Game = require('./classes/game.js');
const {
  MAX_PLAYERS,
  validateUsername,
  validateJoin,
  validateStart,
} = require('./joinValidation.js');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 5714;

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
        addrs.push(net.address);
      }
    }
  }
  return addrs;
}

app.use('/', express.static(__dirname + '/client'));

let rooms = [];

// Persistent lobby: a fixed room (code 2026) that always exists, so friends
// can jump straight in without anyone having to create it first.
const persistentLobby = new Game('2026', '');
persistentLobby.persistent = true;
rooms.push(persistentLobby);

io.on('connection', (socket) => {
  console.log('new connection ', socket.id);
  socket.on('host', (data) => {
    const nameErr = validateUsername(data && data.username);
    if (nameErr) {
      socket.emit('hostRoom', { ok: false, error: nameErr });
      return;
    }
    let code;
    do {
      code =
        '' +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10);
    } while (rooms.length != 0 && rooms.some((r) => r.getCode() === code));
    const game = new Game(code, data.username);
    rooms.push(game);
    game.addPlayer(data.username, socket);
    game.emitPlayers('hostRoom', {
      code: code,
      players: game.getPlayersArray(),
    });
  });

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
      code: data.code,
      persistent: game.persistent,
    });
    game.emitPlayers('hostRoom', {
      code: data.code,
      players: game.getPlayersArray(),
    });
    // Late join: if the game already started, drop the new player straight
    // onto the table. They have no cards this hand (sit out), then ready-up
    // for the next hand like everyone else.
    if (game.started) {
      socket.emit('gameBegin', { ok: true, code: data.code });
      game.rerender();
    }
  });

  socket.on('startGame', (data) => {
    const code = String(data && data.code != null ? data.code : '').trim();
    const game = rooms.find((r) => r.getCode() === code);
    const err = validateStart(game);
    if (err) {
      socket.emit('gameBegin', { ok: false, error: err });
      return;
    }
    if (game.started) {
      socket.emit('gameBegin', { ok: false, error: 'already_started' });
      return;
    }
    game.emitPlayers('gameBegin', { ok: true, code });
    game.startGame();
  });

  socket.on('evaluatePossibleMoves', () => {
    const game = rooms.find(
      (r) => r.findPlayer(socket.id).socket.id === socket.id
    );
    if (game.roundInProgress) {
      const possibleMoves = game.getPossibleMoves(socket);
      socket.emit('displayPossibleMoves', possibleMoves);
    }
  });

  socket.on('raiseModalData', () => {
    const game = rooms.find(
      (r) => r.findPlayer(socket.id).socket.id === socket.id
    );
    if (game != undefined) {
      socket.emit('updateRaiseModal', {
        topBet: game.getCurrentTopBet(),
        usernameMoney:
          game.getPlayerBetInStage(game.findPlayer(socket.id)) +
          game.findPlayer(socket.id).getMoney(),
        minRaise: game.getCurrentTopBet() + game.lastRaiseSize,
      });
    }
  });

  socket.on('playerReady', (data) => {
    const game = rooms.find(
      (r) => r.findPlayer(socket.id).socket.id === socket.id
    );
    if (game != undefined) {
      game.setReady(socket, data && data.choice);
    }
  });

  // precondition: user must be able to make the move in the first place.
  socket.on('moveMade', (data) => {
    // worst case complexity O(num_rooms * num_players_in_room)
    const game = rooms.find(
      (r) => r.findPlayer(socket.id).socket.id === socket.id
    );

    if (game == undefined) {
      console.log("ERROR: can't find game!!!");
      return;
    }
    let ok = false;
    if (data.move == 'fold') ok = game.fold(socket);
    else if (data.move == 'check') ok = game.check(socket);
    else if (data.move == 'bet') ok = game.bet(socket, data.bet);
    else if (data.move == 'call') ok = game.call(socket);
    else if (data.move == 'raise') ok = game.raise(socket, data.bet);
    // Broadcast the resolved action so every client can play its sound.
    if (ok) game.recordAction(data.move, socket, data.bet);
  });

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
      error: ok ? null : game.lastRebuyError || 'not_broke',
    });
  });

  socket.on('disconnect', () => {
    const game = rooms.find(
      (r) => r.findPlayer(socket.id).socket.id === socket.id
    );
    if (game != undefined) {
      const player = game.findPlayer(socket.id);
      game.disconnectPlayer(player);
      if (game.players.length == 0) {
        if (game.persistent) {
          // Keep the persistent lobby open but reset it for the next group.
          const code = game.getCode();
          rooms = rooms.map((r) => {
            if (r !== game) return r;
            const fresh = new Game(code, '');
            fresh.persistent = true;
            return fresh;
          });
        } else {
          rooms = rooms.filter((a) => a != game);
        }
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`All-In listening on http://${HOST}:${PORT}`);
  const addrs = lanAddresses();
  if (addrs.length === 0) {
    console.log('No non-internal IPv4 address found; try http://127.0.0.1:' + PORT);
  } else {
    for (const ip of addrs) {
      console.log(`Friends on your LAN can open http://${ip}:${PORT}`);
    }
  }
});
