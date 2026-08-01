function openLobbyModal(selector) {
  $('.lobby-modal').removeClass('is-open');
  $(selector).addClass('is-open');
  $('body').addClass('modal-open');
}

function closeLobbyModal() {
  $('.lobby-modal').removeClass('is-open');
  $('body').removeClass('modal-open');
  // Re-enable the lobby buttons. Hosting/joining disables + unbinds the other
  // button, so restore both when returning to the lobby screen.
  $('#hostButton')
    .removeClass('disabled')
    .off('click')
    .on('click', function (e) {
      e.preventDefault();
      openLobbyModal('#hostModal');
    });
  $('#joinButton')
    .removeClass('disabled')
    .off('click')
    .on('click', function (e) {
      e.preventDefault();
      openLobbyModal('#joinModal');
    });
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

  $(document).on('click', '.modal-close', function (e) {
    e.preventDefault();
    closeLobbyModal();
  });

  $(document).on('keyup', function (e) {
    if (e.keyCode === 27) closeLobbyModal();
  });

  if ($('.tooltipped').length) {
    $('.tooltipped').tooltip({ delay: 50 });
  }

  // Refresh recovery: rejoin the last room within the server grace window.
  var session = loadSession();
  if (session && session.code && session.username) {
    myUsername = session.username;
    roomCode = session.code;
    socket.emit('join', { code: session.code, username: session.username });
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
  hideActionBtn('#usernameAllIn');
}

// Branded confirm dialog (replaces the ugly native window.confirm).
var confirmCallback = null;
function confirmDialog(title, message, onYes, danger) {
  $('#confirmTitle').text(title || '确认');
  $('#confirmMessage').text(message || '');
  $('#confirmOk').toggleClass('modal-danger', !!danger);
  confirmCallback = onYes;
  openLobbyModal('#confirmModal');
}
$('#confirmOk').on('click', function (e) {
  e.preventDefault();
  closeLobbyModal();
  var cb = confirmCallback;
  confirmCallback = null;
  if (typeof cb === 'function') cb();
});
$('#confirmCancel').on('click', function (e) {
  e.preventDefault();
  confirmCallback = null;
  closeLobbyModal();
});

function confirmAllIn() {
  confirmDialog(
    '确认 All-In',
    '确定要 All-In 吗？这将投入你的全部筹码。',
    function () {
      socket.emit('moveMade', { move: 'allin', bet: 'All-in' });
    },
    true // danger -> red confirm button
  );
}

var socket = io();
var gameInfo = null;
var myUsername = '';
var roomCode = '';

var SESSION_KEY = 'allin_session';
function saveSession(code, username) {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ code: String(code), username: String(username) })
    );
  } catch (e) {}
}
function loadSession() {
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

/* ── Deal animation & sound ──────────────────────────── */
var lastCommunityCount = 0; // community cards already shown — animate only new ones
var skipNextDealAnim = false; // set on gameBegin so late joiners don't replay the deal animation
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
    $('#countdown').text(label + ' ' + countdownSecs + 's');
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

// Short mechanical switch click — pairs with the pressed-in button visuals.
function playClickSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var t0 = ctx.currentTime;
  var osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.035);
  var og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(0.07, t0 + 0.001);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
  osc.connect(og);
  og.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.045);

  var dur = 0.018;
  var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
  }
  var src = ctx.createBufferSource();
  src.buffer = buf;
  var hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  var ng = ctx.createGain();
  ng.gain.value = 0.1;
  src.connect(hp);
  hp.connect(ng);
  ng.connect(ctx.destination);
  src.start(t0);
}

var CLICKABLE_BTN =
  '.action-btn, .lobby-btn, .modal-action-btn, .play-next-btn, .play-next-wrap button, .rebuy-btn, .spectate-btn';

$(document).on('pointerdown', CLICKABLE_BTN, function (e) {
  if (e.button != null && e.button !== 0) return;
  var el = this;
  if (el.disabled || $(el).is('[disabled]') || $(el).hasClass('disabled')) return;
  $(el).addClass('is-pressed');
  playClickSound();
});

$(document).on('pointerup pointercancel pointerleave', CLICKABLE_BTN, function () {
  $(this).removeClass('is-pressed');
});

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

// Coins / chips clink — used for bet, call, raise, all-in, and pot collection.
function playCoinsSound() {
  var ctx = ensureAudio();
  if (!ctx) return;
  var n = 5;
  for (var k = 0; k < n; k++) {
    var t0 = ctx.currentTime + k * 0.06 + Math.random() * 0.02;
    // bright high "tink" (sine, short decay = crisp)
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 3800 + Math.random() * 2200;
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.22, t0 + 0.001);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.1);
    // bright strike transient
    var durN = 0.02;
    var bufN = ctx.createBuffer(1, Math.floor(ctx.sampleRate * durN), ctx.sampleRate);
    var dN = bufN.getChannelData(0);
    for (var i = 0; i < dN.length; i++)
      dN[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dN.length, 5);
    var srcN = ctx.createBufferSource();
    srcN.buffer = bufN;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    var gN = ctx.createGain();
    gN.gain.value = 0.18;
    srcN.connect(hp);
    hp.connect(gN);
    gN.connect(ctx.destination);
    srcN.start(t0);
  }
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
  if (move === 'bet' || move === 'call' || move === 'raise' || move === 'allin') {
    return playCoinsSound();
  }
}

// A playing card carrying the deal-in animation class, with an optional
// stagger delay (seconds) so a round of deals plays one after another.
function cardFaceHtml(card) {
  return (
    '<span class="card-face">' +
    '<span class="card-idx"><b>' +
    card.value +
    '</b></span>' +
    '<span class="card-center">' +
    card.suit +
    '</span>' +
    '<span class="card-idx card-idx-flip"><b>' +
    card.value +
    '</b></span>' +
    '</span>'
  );
}

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
    cardFaceHtml(card) +
    '</div>'
  );
}

/* Seat positions around the oval table (top %, left %) */
var SEAT_LAYOUTS = [
  [],
  [{ top: '2%', left: '50%' }],
  [
    { top: '4%', left: '28%' },
    { top: '4%', left: '72%' },
  ],
  [
    { top: '2%', left: '50%' },
    { top: '28%', left: '12%' },
    { top: '28%', left: '88%' },
  ],
  [
    { top: '2%', left: '26%' },
    { top: '2%', left: '74%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
  ],
  [
    { top: '2%', left: '50%' },
    { top: '10%', left: '18%' },
    { top: '10%', left: '82%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
  ],
  [
    { top: '2%', left: '50%' },
    { top: '10%', left: '20%' },
    { top: '10%', left: '80%' },
    { top: '40%', left: '6%' },
    { top: '40%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '2%', left: '36%' },
    { top: '2%', left: '64%' },
    { top: '22%', left: '10%' },
    { top: '22%', left: '90%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '2%', left: '32%' },
    { top: '2%', left: '50%' },
    { top: '2%', left: '68%' },
    { top: '24%', left: '8%' },
    { top: '24%', left: '92%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '2%', left: '28%' },
    { top: '2%', left: '50%' },
    { top: '2%', left: '72%' },
    { top: '20%', left: '8%' },
    { top: '20%', left: '92%' },
    { top: '40%', left: '5%' },
    { top: '40%', left: '95%' },
    { top: '56%', left: '28%' },
    { top: '56%', left: '72%' },
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
  if (text === 'Reconnecting') return 'seat-reconnecting';
  return '';
}

function abbrevBlind(blind) {
  if (!blind) return '';
  if (blind.indexOf('Dealer') !== -1) return 'D';
  if (blind.indexOf('Small') !== -1) return 'SB';
  if (blind.indexOf('Big') !== -1) return 'BB';
  return blind;
}

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
  return (
    '<span class="shame-coins" title="' +
    count +
    ' 耻辱币">' +
    '<span class="shame-coin">辱</span>' +
    '<span class="shame-count">×' +
    count +
    '</span>' +
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

socket.on('rebuyResult', function (data) {
  if (!data || data.ok === false) {
    return;
  }
  $('#rebuyBar').hide();
});

socket.on('hostRoom', function (data) {
  if (data == undefined || data.ok === false) {
    $('#joinButton').removeClass('disabled');
  } else {
    if (data.code != null) roomCode = String(data.code);
    if (data.code && myUsername) saveSession(data.code, myUsername);
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
    clearSession();
    $('#hostButton').removeClass('disabled');
  } else {
    roomCode =
      data.code != null
        ? String(data.code)
        : String($('#code-field').val()).trim();
    if (!myUsername) {
      myUsername = $('#joinName-field').val() || '';
    }
    if (roomCode && myUsername) saveSession(roomCode, myUsername);
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
          "'s room</h5><hr /><h5>Players Currently in Room</h5><p>刷新页面会在约 20 秒内自动回到房间。</p>"
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
    showActionPopup(data.player, data.move, data.amount);
    lastActionSeq = data.seq;
  }
});

socket.on('rerender', function (data) {
  myUsername = data.username;
  // Clear any lingering action popups. Popups on opponent seats get wiped when
  // the seats are rebuilt below, but the hero's popup survives renderSelf, so
  // without this it would persist into the ready-up phase and look like it
  // "keeps popping up" on every re-render. New popups arrive via actionSound,
  // which fires after this rerender, so this never clobbers a fresh popup.
  $('.action-popup').remove();
  // A new hand is starting — clear last hand's winner highlight.
  $('.seat-winner').removeClass('seat-winner');
  var nameLabel = data.username + shameCoinsHtml(data.buyIns);
  $('#usernamesCards').html(nameLabel);
  if (data.myBet > 0) {
    $('#heroBet')
      .html('<span class="chip-icon" aria-hidden="true"></span>$' + data.myBet)
      .prop('hidden', false);
  } else {
    $('#heroBet').html('').prop('hidden', true);
  }
  if (data.community != undefined) {
    var prevCommunity = skipNextDealAnim ? data.community.length : lastCommunityCount;
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
    skipNextDealAnim = false;
  } else {
    $('#communityCards').empty();
    lastCommunityCount = 0;
  }
  if (data.currBet == undefined) data.currBet = 0;
  $('#potAmount').text('$' + data.pot);
  $('#table-title').text('');
  var styles = opponentSeatStyles(data.players.length);
  $('#opponentCards').html(
    data.players.map(function (p, i) {
      return renderSeat(p.username, {
        text: p.status,
        money: p.money,
        blind: p.blind,
        dealer: p.dealer,
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
    if (turnPlayer) startCountdown('turn', 120, turnPlayer.username + ' 思考中...');
    else if (countdownKind === 'turn') clearCountdown();
  } else if (countdownKind === 'turn') {
    clearCountdown();
  }
});

socket.on('gameBegin', function (data) {
  $('#navbar-ptwu').hide();
  closeLobbyModal();
  if (data == undefined || data.ok === false) {
    return;
  }
  $('#mainContent').hide();
  $('#gameDiv').css('display', 'flex');
  skipNextDealAnim = true; // late join / game start: don't replay the deal animation
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
  $('#table-title').text('Winner: ' + winners.join(', '));
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
    return;
  } else {
    myUsername = $('#hostName-field').val();
    socket.emit('host', { username: myUsername });
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
    return;
  } else {
    myUsername = $('#joinName-field').val();
    socket.emit('join', {
      code: String($('#code-field').val()).trim(),
      username: myUsername,
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
    return;
  }
  socket.emit('startGame', { code: code });
};

var fold = function () {
  socket.emit('moveMade', { move: 'fold', bet: 'Fold' });
};

var bet = function () {
  if (parseInt($('#betRangeSlider').val()) == 0) {
    return;
  } else if (parseInt($('#betRangeSlider').val()) < 2) {
    return;
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
  var val = parseInt($('#raiseRangeSlider').val());
  var min = parseInt($('#raiseRangeSlider').prop('min'));
  if (val < min) {
    return;
  }
  socket.emit('moveMade', { move: 'raise', bet: val });
};

function renderCard(card) {
  var cls =
    card.suit == '♠' || card.suit == '♣' ? 'playingCard_black' : 'playingCard_red';
  return (
    '<div class="' +
    cls +
    '" id="card' +
    card.value +
    card.suit +
    '" data-value="' +
    card.value +
    ' ' +
    card.suit +
    '">' +
    cardFaceHtml(card) +
    '</div>'
  );
}

function actionLabel(move, amount) {
  if (move === 'fold') return '弃牌';
  if (move === 'check') return '过牌';
  if (move === 'call') return '跟注';
  if (move === 'bet') return '下注 $' + amount;
  if (move === 'raise') return '加注 $' + amount;
  if (move === 'allin') return 'All-In';
  return move;
}

// Pop a bold action label above the acting player's seat so everyone sees the
// move (fold/check/call/bet/raise) at a glance.
function showActionPopup(playerName, move, amount) {
  var $seat =
    playerName === myUsername
      ? $('#playerInformationCard')
      : $('#opponentCards .table-seat').filter(function () {
          return $(this).attr('data-name') === playerName;
        });
  if (!$seat || !$seat.length) return;
  $seat.find('.action-popup').remove();
  var $popup = $(
    '<div class="action-popup action-' + move + '">' +
      actionLabel(move, amount) +
      '</div>'
  );
  $seat.append($popup);
  setTimeout(function () {
    $popup.remove();
  }, 1800);
  // Bet/call/raise also fling chips from the seat into the pot.
  if (move === 'bet' || move === 'call' || move === 'raise') {
    flyChipsToPot($seat);
  }
}

// Chips flying from a player's seat into the pot (bet/call/raise).
function flyChipsToPot($fromSeat) {
  var $pot = $('.pot-area');
  if (!$pot.length || !$fromSeat || !$fromSeat.length) return;
  var pr = $pot[0].getBoundingClientRect();
  var sr = $fromSeat[0].getBoundingClientRect();
  var fromX = sr.left + sr.width / 2;
  var fromY = sr.top + sr.height / 2;
  var toX = pr.left + pr.width / 2;
  var toY = pr.top + pr.height / 2;
  var dx = toX - fromX;
  var dy = toY - fromY;
  for (var i = 0; i < 6; i++) {
    var $chip = $('<div class="fly-chip"></div>');
    $chip.css({ left: fromX + 'px', top: fromY + 'px' });
    $('body').append($chip);
    (function ($c, dx, dy, delay) {
      setTimeout(function () {
        $c.css({
          transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.6)',
          opacity: '0',
        });
      }, delay);
      setTimeout(function () {
        $c.remove();
      }, delay + 650);
    })($chip, dx + (Math.random() * 20 - 10), dy + (Math.random() * 20 - 10), i * 50);
  }
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
  var dealerBadge = data.dealer
    ? '<span class="seat-dealer" title="庄家">D</span>'
    : '';
  var blindBadge = data.blind
    ? '<span class="seat-blind">' + abbrevBlind(data.blind) + '</span>'
    : '';
  var cardsHtml;
  if (data.text === 'Spectating' || data.endHand === 'Spectating') {
    // 旁观者这手不参与，不显示牌位
    cardsHtml = '';
  } else if (data.showCards && data.cards && data.cards.length) {
    cardsHtml =
      renderOpponentCard(data.cards[0]) + renderOpponentCard(data.cards[1]);
  } else {
    cardsHtml = '<div class="blankCard"></div><div class="blankCard"></div>';
  }
  var betHtml =
    bet > 0
      ? '<div class="seat-bet"><span class="chip-icon" aria-hidden="true"></span>$' + bet + '</div>'
      : '';
  var statusHtml = '';
  if (data.text === 'Fold') statusHtml = '<div class="seat-status">Fold</div>';
  else if (data.isChecked) statusHtml = '<div class="seat-status">Check</div>';
  else if (data.text === 'Spectating')
    statusHtml = '<div class="seat-status">Spectating</div>';
  else if (data.text === 'Reconnecting')
    statusHtml = '<div class="seat-status seat-reconnecting-label">重连中…</div>';
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
  var topPct = style && style.top != null ? parseFloat(style.top) : 50;
  var edgeClass = topPct <= 16 ? ' seat-edge-top' : '';
  return (
    '<div class="table-seat ' +
    stateClass +
    edgeClass +
    '" data-name="' +
    name +
    '" style="top:' +
    style.top +
    ';left:' +
    style.left +
    '">' +
    dealerBadge +
    blindBadge +
    '<div class="seat-name">' +
    nameHtml +
    '</div>' +
    '<div class="seat-cards">' +
    cardsHtml +
    '</div>' +
    '<div class="seat-stack">$' +
    data.money +
    '</div>' +
    betHtml +
    statusHtml +
    handHtml +
    '</div>'
  );
}

function renderOpponentCard(card) {
  var cls =
    card.suit == '♠' || card.suit == '♣'
      ? 'playingCard_black_opponent'
      : 'playingCard_red_opponent';
  return (
    '<div class="' +
    cls +
    '" id="card' +
    card.value +
    card.suit +
    '" data-value="' +
    card.value +
    ' ' +
    card.suit +
    '">' +
    cardFaceHtml(card) +
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
    '<h3 class="center-align">加注到 $' +
      $('#raiseRangeSlider').val() +
      '</h3>'
  );
}

socket.on('updateRaiseModal', function (data) {
  var minRaise = data.minRaise || data.topBet;
  // If the player can't afford a full min-raise, the slider lets them go all-in.
  var sliderMin =
    data.usernameMoney >= minRaise ? minRaise : data.usernameMoney;
  sliderMin = Math.max(data.topBet, sliderMin);
  var $slider = $('#raiseRangeSlider');
  $slider.attr({ max: data.usernameMoney, min: sliderMin });
  $slider.val(sliderMin); // default to the minimum raise, show the amount right away
  updateRaiseDisplay();
});

function updateRaiseModal() {
  document.getElementById('raiseRangeSlider').value = 0;
  $('#raiseDisplay').html('<h3 class="center-align">…</h3>');
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
  if (data.allin == 'yes') showActionBtn('#usernameAllIn');
  else hideActionBtn('#usernameAllIn');
});

function renderSelf(data) {
  $('#playNext').empty();
  $('#usernamesMoney').text('$' + data.money);
  var $hero = $('#playerInformationCard');
  $hero.removeClass('seat-active seat-folded');
  if (data.text == 'Their Turn') {
    $hero.addClass('seat-active');
    $('#status').text('Your Turn');
    socket.emit('evaluatePossibleMoves', {});
  } else if (data.text == 'Fold') {
    $hero.addClass('seat-folded');
    $('#status').text('Folded');
    hideAllActionBtns();
  } else {
    $('#status').text('');
    hideAllActionBtns();
  }
  $('#blindStatus').text(abbrevBlind(data.blind));
}
