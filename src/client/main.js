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

function requestLandscape() {
  try {
    var orient = screen.orientation || screen.mozOrientation || screen.msOrientation;
    if (orient && typeof orient.lock === 'function') {
      orient.lock('landscape').catch(function () {});
    } else if (typeof screen.lockOrientation === 'function') {
      screen.lockOrientation('landscape');
    } else if (typeof screen.mozLockOrientation === 'function') {
      screen.mozLockOrientation('landscape');
    } else if (typeof screen.msLockOrientation === 'function') {
      screen.msLockOrientation('landscape');
    }
  } catch (e) {
    // Browsers often deny lock outside fullscreen / installed PWA.
  }
}

function isDisplayStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isPageFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function canRequestFullscreen() {
  var el = document.documentElement;
  return !!(
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.webkitRequestFullScreen ||
    el.msRequestFullscreen
  );
}

function requestGameFullscreen() {
  if (isDisplayStandalone() || isPageFullscreen()) {
    requestLandscape();
    return;
  }
  var el = document.documentElement;
  var req =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.webkitRequestFullScreen ||
    el.msRequestFullscreen;
  if (!req) {
    requestLandscape();
    updateFullscreenBtn();
    return;
  }
  try {
    var result = req.call(el, { navigationUI: 'hide' });
    if (result && typeof result.then === 'function') {
      result
        .then(function () {
          requestLandscape();
          updateFullscreenBtn();
        })
        .catch(function () {
          updateFullscreenBtn();
        });
    } else {
      requestLandscape();
      updateFullscreenBtn();
    }
  } catch (e) {
    updateFullscreenBtn();
  }
}

function updateFullscreenBtn() {
  var $btn = $('#fullscreenBtn');
  if (!$btn.length) return;
  var show =
    $('body').hasClass('in-game') &&
    !isDisplayStandalone() &&
    !isPageFullscreen() &&
    canRequestFullscreen() &&
    ('ontouchstart' in window || window.matchMedia('(max-width: 900px)').matches);
  if (show) $btn.prop('hidden', false);
  else $btn.prop('hidden', true);
}

function enterGameView() {
  $('body').addClass('in-game');
  requestGameFullscreen();
  updateFullscreenBtn();
}

function leaveGameView() {
  $('body').removeClass('in-game');
  updateFullscreenBtn();
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

  $('#fullscreenBtn').on('click', function (e) {
    e.preventDefault();
    requestGameFullscreen();
  });

  // Orientation / fullscreen need a user gesture on most browsers.
  $(document).on('click pointerdown', function () {
    if ($('body').hasClass('in-game') && !isPageFullscreen() && !isDisplayStandalone()) {
      // Soft retry only when already in-game; explicit button is the main path.
      updateFullscreenBtn();
    }
  });

  $(document).on(
    'fullscreenchange webkitfullscreenchange mozfullscreenchange MSFullscreenChange',
    updateFullscreenBtn
  );

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
var countdownLabel = '';
var countdownTurnPlayer = null; // username whose seat shows the turn timer
var lastReadyHint = '';
// While hole/community cards are still flying in, hide own-turn chrome
// and action buttons until the deal finishes.
var dealLocked = false;
var dealUnlockTimer = null;
var pendingHeroTurn = false;
var pendingTurnCountdown = null; // { username, deadlineMs }

function lockActionsForDeal(durationMs) {
  if (durationMs <= 0) return;
  dealLocked = true;
  hideAllActionBtns();
  $('#gameDiv').addClass('is-dealing');
  $('#playerInformationCard').removeClass('seat-active');
  $('#status').text('');
  // Hide turn timer while cards are still dealing.
  if (countdownKind === 'turn') clearCountdown();
  clearTimeout(dealUnlockTimer);
  dealUnlockTimer = setTimeout(finishDealLock, durationMs);
}

function finishDealLock() {
  dealLocked = false;
  $('#gameDiv').removeClass('is-dealing');
  if (pendingTurnCountdown) {
    var left = Math.max(
      1,
      Math.ceil((pendingTurnCountdown.deadlineMs - Date.now()) / 1000)
    );
    startCountdown('turn', left, '', pendingTurnCountdown.username);
    pendingTurnCountdown = null;
  }
  if (pendingHeroTurn) {
    pendingHeroTurn = false;
    revealHeroTurn();
  }
}

function revealHeroTurn() {
  if (dealLocked || $('#gameDiv').hasClass('is-dealing')) {
    pendingHeroTurn = true;
    return;
  }
  var $hero = $('#playerInformationCard');
  $hero.addClass('seat-active');
  $('#status').text('');
  // Thinking chip (no amount) if this street has no bet yet.
  if ($('#heroBet').prop('hidden') || !$('#heroBet').text()) {
    $('#heroBet')
      .html(chipLottieHtml())
      .prop('hidden', false)
      .addClass('seat-thinking-chip');
  }
  socket.emit('evaluatePossibleMoves', {});
}

// Local countdown: ready-up text on the felt; turn timer on the acting seat.
function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownKind = null;
  countdownLabel = '';
  countdownTurnPlayer = null;
  $('#countdown').empty().removeClass('is-turn');
  $('.seat-turn-timer').remove();
}

function paintSeatTurnTimer() {
  if (countdownKind !== 'turn' || !countdownTurnPlayer || countdownSecs <= 0) {
    $('.seat-turn-timer').remove();
    return;
  }
  var name = countdownTurnPlayer;
  var $seat =
    name === myUsername
      ? $('#playerInformationCard')
      : $('#opponentCards .table-seat').filter(function () {
          return $(this).attr('data-name') === name;
        });
  var $name = $seat.find('.seat-name').first();
  if (!$name.length) {
    $('.seat-turn-timer').remove();
    return;
  }
  var label = countdownSecs + 's';
  // Update in place — recreating the span every second restarts CSS
  // animation and desyncs from the seat name / cards / chip pulse.
  var $timer = $name.find('.seat-turn-timer').first();
  if ($timer.length) {
    $timer.text(label);
    $('.seat-turn-timer').not($timer).remove();
    return;
  }
  $('.seat-turn-timer').remove();
  $name.prepend(
    '<span class="seat-turn-timer" aria-hidden="true">' + label + '</span>'
  );
}

function paintCountdown() {
  if (!countdownKind) {
    $('#countdown').empty().removeClass('is-turn');
    $('.seat-turn-timer').remove();
    return;
  }
  if (countdownKind === 'turn') {
    // Turn clock lives on the acting player's name, not the felt.
    $('#countdown').empty().removeClass('is-turn');
    paintSeatTurnTimer();
    return;
  }
  var text = countdownLabel || '';
  if (countdownSecs > 0) {
    text = text ? text + ' ' + countdownSecs + 's' : countdownSecs + 's';
  }
  $('#countdown').text(text).removeClass('is-turn');
}

function updateCountdownLabel(label) {
  countdownLabel = label || '';
  if (countdownKind === 'turn') return;
  if (countdownKind) paintCountdown();
  else if (countdownLabel) $('#countdown').text(countdownLabel);
}

function startCountdown(kind, secs, label, turnPlayer) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownKind = kind;
  countdownSecs = secs;
  countdownLabel = label || '';
  countdownTurnPlayer = kind === 'turn' ? turnPlayer || null : null;
  paintCountdown();
  countdownInterval = setInterval(function () {
    countdownSecs -= 1;
    if (countdownSecs <= 0) {
      clearCountdown();
      return;
    }
    paintCountdown();
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

// Lottie chip glyph for pot / seat bets.
function chipLottieHtml(extraClass) {
  return (
    '<dotlottie-wc class="chip-lottie' +
    (extraClass ? ' ' + extraClass : '') +
    '" src="./img/lottie-trial/chip-shuffle.lottie" autoplay loop speed="0.9" aria-hidden="true"></dotlottie-wc>'
  );
}

/* Fixed absolute seats on the oval. visualIndex 0 = south (hero on the ring).
 * Indices 1..9 go clockwise from the hero's left.
 * Percentages are relative to .poker-table (seats-ring is inside it). */
var MAX_TABLE_SEATS = 10;
var FIXED_SEAT_POSITIONS = [
  { top: '88%', left: '50%' }, // 0 — hero (bottom of table)
  { top: '76%', left: '16%' }, // 1 lower-left
  { top: '50%', left: '6%' }, // 2 mid-left
  { top: '22%', left: '12%' }, // 3 upper-left
  { top: '4%', left: '28%' }, // 4 top-left
  { top: '0%', left: '50%' }, // 5 top center
  { top: '4%', left: '72%' }, // 6 top-right
  { top: '22%', left: '88%' }, // 7 upper-right
  { top: '50%', left: '94%' }, // 8 mid-right
  { top: '76%', left: '84%' }, // 9 lower-right
];

// Local player's hole cards — painted on the table seat (same ring as others).
var myHoleCards = [];

/** Fill in missing seatIndex values so older payloads still render. */
function ensureSeatIndexes(players) {
  var list = (players || []).map(function (p) {
    return Object.assign({}, p);
  });
  var taken = {};
  list.forEach(function (p) {
    if (p.seatIndex != null && p.seatIndex >= 0) taken[p.seatIndex] = true;
  });
  var next = 0;
  list.forEach(function (p) {
    if (p.seatIndex != null && p.seatIndex >= 0) return;
    while (taken[next]) next++;
    p.seatIndex = next;
    taken[next] = true;
    next++;
  });
  return list;
}

function findMySeatIndex(players, username) {
  if (!players) return 0;
  for (var i = 0; i < players.length; i++) {
    if (players[i].username === username && players[i].seatIndex != null) {
      return players[i].seatIndex;
    }
  }
  return 0;
}

function visualSeatIndex(seatIndex, mySeatIndex) {
  return (seatIndex - mySeatIndex + MAX_TABLE_SEATS) % MAX_TABLE_SEATS;
}

function renderEmptySeat(style) {
  var topPct = style && style.top != null ? parseFloat(style.top) : 50;
  var edgeClass = topPct <= 16 ? ' seat-edge-top' : '';
  if (topPct >= 90) edgeClass = ' seat-edge-bottom';
  return (
    '<div class="table-seat seat-empty' +
    edgeClass +
    '" style="top:' +
    style.top +
    ';left:' +
    style.left +
    '" aria-hidden="true"></div>'
  );
}

/** Hero seat on the felt — same ring as opponents, face-up hole cards. */
function renderHeroSeat(name, data, style) {
  var bet = getPlayerBet(name, data.bets);
  var stateClass = seatStateClass(data.text);
  if (data.text === 'Their Turn') stateClass = 'seat-active';
  var nameHtml = name + shameCoinsHtml(data.buyIns);
  var dealerBadge = data.dealer
    ? '<span class="seat-dealer" title="庄家">D</span>'
    : '';
  var blindBadge =
    '<span class="seat-blind" id="blindStatus">' +
    (data.blind ? abbrevBlind(data.blind) : '') +
    '</span>';
  var cardsHtml = '';
  if (data.text === 'Spectating') {
    cardsHtml = '';
  } else if (myHoleCards && myHoleCards.length) {
    cardsHtml = myHoleCards
      .map(function (c, i) {
        return data.animateHole
          ? renderCardWithAnim(c, i * 0.6)
          : renderCard(c);
      })
      .join('');
  } else {
    cardsHtml = '<div class="blankCard"></div><div class="blankCard"></div>';
  }
  var betHtml = '';
  if (bet > 0) {
    betHtml =
      '<div id="heroBet" class="seat-bet">' +
      chipLottieHtml() +
      '$' +
      bet +
      '</div>';
  } else if (data.text === 'Their Turn') {
    betHtml =
      '<div id="heroBet" class="seat-bet seat-thinking-chip" aria-hidden="true">' +
      chipLottieHtml() +
      '</div>';
  } else {
    betHtml = '<div id="heroBet" class="seat-bet" hidden></div>';
  }
  var statusText = '';
  if (data.roundInProgress === false) {
    // Between hands: only ready-up choice, not leftover hand labels.
    if (data.money > 0 && data.readyState === 'ready') statusText = '已准备';
    else if (data.money > 0 && data.readyState === 'watching') statusText = '旁观';
  } else if (data.text === 'Fold') statusText = '弃牌';
  else if (data.text === 'Their Turn') statusText = '';
  else if (data.isChecked) statusText = 'Check';
  else if (data.text === 'Spectating') statusText = '旁观';
  else if (data.text === 'Reconnecting') statusText = '重连中…';
  var handHtml = data.endHand
    ? '<div class="seat-hand">' + data.endHand + '</div>'
    : '';
  return (
    '<div id="playerInformationCard" class="table-seat seat-hero ' +
    stateClass +
    ' seat-edge-bottom" data-name="' +
    name +
    '" style="top:' +
    style.top +
    ';left:' +
    style.left +
    '">' +
    '<div class="seat-cards" id="mycards">' +
    cardsHtml +
    '</div>' +
    '<div class="seat-hero-side">' +
    '<div class="seat-head">' +
    dealerBadge +
    blindBadge +
    '<div class="seat-name" id="usernamesCards">' +
    nameHtml +
    '</div>' +
    '</div>' +
    '<div class="seat-meta">' +
    '<div class="seat-stack" id="usernamesMoney">$' +
    data.money +
    '</div>' +
    betHtml +
    '<div class="seat-status hero-status" id="status">' +
    (data.text === 'Their Turn' ? '' : statusText) +
    '</div>' +
    '</div>' +
    handHtml +
    '</div>' +
    '</div>'
  );
}

/** Render all fixed ring seats relative to the local player's seat. */
function renderTableRing(players, myUsername, seatDataFn) {
  var seated = ensureSeatIndexes(players);
  var bySeat = {};
  seated.forEach(function (p) {
    bySeat[p.seatIndex] = p;
  });
  var mySeat = findMySeatIndex(seated, myUsername);
  var html = '';
  for (var abs = 0; abs < MAX_TABLE_SEATS; abs++) {
    var vis = visualSeatIndex(abs, mySeat);
    var style = FIXED_SEAT_POSITIONS[vis];
    var p = bySeat[abs];
    if (vis === 0) {
      var me =
        p && p.username === myUsername
          ? p
          : seated.filter(function (x) {
              return x.username === myUsername;
            })[0] || {
              username: myUsername,
              seatIndex: mySeat,
              money: 0,
            };
      var heroData = seatDataFn(me);
      heroData.animateHole = !!pendingDealAnim;
      html += renderHeroSeat(me.username || myUsername, heroData, style);
      continue;
    }
    if (p && p.username !== myUsername) {
      html += renderSeat(p.username, seatDataFn(p), style);
    } else {
      html += renderEmptySeat(style);
    }
  }
  return html;
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
  myHoleCards = data.cards || [];
  lastCommunityCount = 0; // new hand: community is empty again
  pendingDealAnim = true; // hole + opponents animate on the next rerender
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
  $('.seat-winner-badge').remove();
  if (data.community != undefined) {
    var prevCommunity = skipNextDealAnim ? data.community.length : lastCommunityCount;
    var newCommunity = Math.max(0, data.community.length - prevCommunity);
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
    if (newCommunity > 0 && !skipNextDealAnim) {
      // Last new card: delay 1s + (n-1)*1s, flight 0.5s. Extra buffer so the
      // turn chrome never pops before the final card has settled.
      var communityDealMs = (1.0 + (newCommunity - 1) * 1.0 + 0.5) * 1000 + 250;
      lockActionsForDeal(communityDealMs);
    }
    lastCommunityCount = data.community.length;
    skipNextDealAnim = false;
  } else {
    $('#communityCards').empty();
    lastCommunityCount = 0;
  }
  if (data.currBet == undefined) data.currBet = 0;
  $('#potAmount').text('$' + (data.roundInProgress ? data.pot : 0));
  $('#table-title').text('');
  $('#opponentCards').html(
    renderTableRing(data.players, data.username, function (p) {
      return {
        text: p.status,
        money: p.money,
        blind: p.blind,
        dealer: p.dealer,
        bets: data.bets,
        buyIns: p.buyIns,
        isChecked: p.isChecked,
        readyState: p.readyState,
        roundInProgress: data.roundInProgress,
      };
    })
  );
  if (pendingDealAnim) {
    // Hole cards already have deal-in from renderHeroSeat; also fly opponents'.
    $('#opponentCards .seat-hero .deal-in').each(function (i) {
      // Sound when each hole card LANDS (delay + 0.5s flight).
      var delay = parseFloat(this.style.animationDelay) || i * 0.6;
      setTimeout(playDealSound, (delay + 0.5) * 1000);
    });
    var $dealtSeats = $('#opponentCards .table-seat:not(.seat-hero) .blankCard');
    $dealtSeats.addClass('deal-in');
    $dealtSeats.each(function (i) {
      this.style.animationDelay = i * 0.5 + 's';
    });
    var blankCount = $dealtSeats.length;
    var holeDealMs = 0.6 + 0.5; // seconds
    var blankDealMs = blankCount > 0 ? (blankCount - 1) * 0.5 + 0.5 : 0;
    lockActionsForDeal(Math.max(holeDealMs, blankDealMs) * 1000 + 250);
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
  // While cards are dealing, defer the seat turn timer until the deal finishes.
  if (data.roundInProgress) {
    if (countdownKind === 'ready') clearCountdown();
    var turnPlayer = (data.players || []).filter(function (p) {
      return p.status === 'Their Turn';
    })[0];
    if (turnPlayer) {
      if (dealLocked) {
        pendingTurnCountdown = {
          username: turnPlayer.username,
          deadlineMs: Date.now() + 120000,
        };
        clearCountdown();
      } else {
        pendingTurnCountdown = null;
        startCountdown('turn', 120, '', turnPlayer.username);
      }
    } else {
      pendingTurnCountdown = null;
      if (countdownKind === 'turn') clearCountdown();
    }
  } else {
    pendingTurnCountdown = null;
    if (countdownKind === 'turn') clearCountdown();
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
  enterGameView();
  skipNextDealAnim = true; // late join / game start: don't replay the deal animation
});

function chooseReady(choice) {
  socket.emit('playerReady', { choice: choice });
}

// Between hands, render the ready-up controls (Ready / Watch) for the local
// player plus a waiting hint derived from everyone's readyState. This replaces
// Between hands the action dock only shows ready/watch buttons. Status text
// like "等待至少 2 人准备好" lives on the felt countdown. Turn timers sit
// in front of the acting player's name instead.
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
  lastReadyHint = hint;
  // Same felt slot as turn "思考中" — keep the ready timer if it's running.
  if (countdownKind === 'ready') updateCountdownLabel(hint);
  else if (countdownKind !== 'turn') updateCountdownLabel(hint);

  var html = '<div class="ready-phase">';
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
  $('#table-title').text('');
  $('#usernamesMoney').text('$' + data.money);
  maybeShowRebuyPrompt(data.money, false);
  var meReveal = (data.cards || []).filter(function (p) {
    return p.username === data.username;
  })[0];
  if (meReveal && meReveal.cards && meReveal.cards.length) {
    myHoleCards = meReveal.cards;
  }
  $('#opponentCards').html(
    renderTableRing(data.cards, data.username, function (p) {
      return {
        text: p.folded ? 'Fold' : '',
        money: p.money,
        blind: '',
        bets: data.bets,
        buyIns: p.buyIns,
        cards: p.cards,
        showCards: !p.folded,
        // Showdown rank (e.g. "Pair, A's") — not Fold / ready labels.
        endHand: !p.folded && p.hand ? p.hand : '',
        readyState: p.readyState,
        roundInProgress: false,
      };
    })
  );
  renderReadyPhase({
    roundInProgress: false,
    myMoney: data.money,
    myReadyState: data.myReadyState,
    players: data.cards,
  });
  startCountdown('ready', 120, lastReadyHint || '准备/旁观');
  highlightWinners(winners, data.username, 'Winner');
  setTimeout(function () {
    animateChipsToWinners(winners, data.username);
    // Pot already paid out — clear after the fly-to-winner animation starts.
    setTimeout(function () {
      $('#potAmount').text('$0');
    }, 700);
  }, 500);
});

socket.on('endHand', function (data) {
  hideAllActionBtns();
  $('#table-title').text('');
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
  $('#opponentCards').html(
    renderTableRing(data.cards, data.username, function (p) {
      return {
        text: p.text,
        money: p.money,
        blind: '',
        bets: data.bets,
        readyState: p.readyState,
        roundInProgress: false,
      };
    })
  );
  renderReadyPhase({
    roundInProgress: false,
    myMoney: data.money,
    myReadyState: data.myReadyState,
    players: data.cards,
  });
  startCountdown('ready', 120, lastReadyHint || '准备/旁观');
  highlightWinners([data.winner], data.username, 'Wins $' + data.pot);
  setTimeout(function () {
    animateChipsToWinners([data.winner], data.username);
    setTimeout(function () {
      $('#potAmount').text('$0');
    }, 700);
  }, 400);
});

var beginHost = function () {
  if ($('#hostName-field').val() == '') {
    return;
  } else {
    myUsername = $('#hostName-field').val();
    requestGameFullscreen();
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
    requestGameFullscreen();
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
  requestGameFullscreen();
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
// label: optional badge text above the seat (e.g. "Winner", "Wins $4").
function highlightWinners(winners, myName, label) {
  $('.seat-winner').removeClass('seat-winner');
  $('.seat-winner-badge').remove();
  var badge = label || 'Winner';
  winners.forEach(function (w) {
    var $el = getWinnerEl(w, myName);
    if ($el && $el.length) {
      $el.addClass('seat-winner');
      $el.append(
        '<div class="seat-winner-badge">' + badge + '</div>'
      );
    }
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
  var betweenHands = data.roundInProgress === false;
  if (
    !betweenHands &&
    (data.text === 'Spectating' || data.endHand === 'Spectating')
  ) {
    // Mid-hand spectator: no hole cards.
    cardsHtml = '';
  } else if (data.showCards && data.cards && data.cards.length) {
    cardsHtml =
      renderOpponentCard(data.cards[0]) + renderOpponentCard(data.cards[1]);
  } else if (betweenHands) {
    // Between hands don't keep stale backs from the last deal.
    cardsHtml = '';
  } else {
    cardsHtml = '<div class="blankCard"></div><div class="blankCard"></div>';
  }
  var betHtml =
    bet > 0
      ? '<div class="seat-bet">' + chipLottieHtml() + '$' + bet + '</div>'
      : data.text === 'Their Turn'
        ? '<div class="seat-bet seat-thinking-chip" aria-hidden="true">' +
          chipLottieHtml() +
          '</div>'
        : '';
  var statusHtml = '';
  if (betweenHands) {
    // Ready phase: only show 已准备 / 旁观 — never stack with last hand's status.
    if (data.money > 0 && data.readyState === 'ready') {
      statusHtml = '<div class="seat-status seat-ready">已准备</div>';
    } else if (data.money > 0 && data.readyState === 'watching') {
      statusHtml = '<div class="seat-status seat-watching">旁观</div>';
    }
  } else if (data.text === 'Fold') {
    statusHtml = '<div class="seat-status">弃牌</div>';
  } else if (data.isChecked) {
    statusHtml = '<div class="seat-status">Check</div>';
  } else if (data.text === 'Spectating') {
    statusHtml = '<div class="seat-status">旁观</div>';
  } else if (data.text === 'Reconnecting') {
    statusHtml = '<div class="seat-status seat-reconnecting-label">重连中…</div>';
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
  if (dealLocked) {
    // Deal animation still running — buttons wait until revealHeroTurn.
    hideAllActionBtns();
    return;
  }
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
  var $hero = $('#playerInformationCard');
  if (!$hero.length) return;
  $('#usernamesMoney').text('$' + data.money);
  $hero.removeClass('seat-active seat-folded');
  if (data.text == 'Their Turn') {
    if (dealLocked || $('#gameDiv').hasClass('is-dealing')) {
      pendingHeroTurn = true;
      $('#status').text('');
      hideAllActionBtns();
    } else {
      pendingHeroTurn = false;
      revealHeroTurn();
    }
  } else if (data.text == 'Fold') {
    pendingHeroTurn = false;
    $hero.addClass('seat-folded');
    $('#status').text('Folded');
    hideAllActionBtns();
  } else {
    pendingHeroTurn = false;
    $('#status').text('');
    hideAllActionBtns();
  }
  if (data.blind) $('#blindStatus').text(abbrevBlind(data.blind));
  else $('#blindStatus').text('');
}
