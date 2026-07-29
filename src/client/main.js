function openLobbyModal(selector) {
  $('.lobby-modal').removeClass('is-open');
  $(selector).addClass('is-open');
  $('body').addClass('modal-open');
}

function closeLobbyModal() {
  $('.lobby-modal').removeClass('is-open');
  $('body').removeClass('modal-open');
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

  $(document).on('click', '.modal-close, .modal-backdrop', function (e) {
    e.preventDefault();
    closeLobbyModal();
  });

  $(document).on('keyup', function (e) {
    if (e.keyCode === 27) closeLobbyModal();
  });

  if ($('.tooltipped').length) {
    $('.tooltipped').tooltip({ delay: 50 });
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
}

var socket = io();
var gameInfo = null;
var myUsername = '';
var roomCode = '';

/* Seat positions around the oval table (top %, left %) */
var SEAT_LAYOUTS = [
  [],
  [{ top: '8%', left: '50%' }],
  [
    { top: '10%', left: '30%' },
    { top: '10%', left: '70%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '22%', left: '16%' },
    { top: '22%', left: '84%' },
  ],
  [
    { top: '8%', left: '26%' },
    { top: '8%', left: '74%' },
    { top: '38%', left: '6%' },
    { top: '38%', left: '94%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '14%', left: '20%' },
    { top: '14%', left: '80%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
  ],
  [
    { top: '7%', left: '50%' },
    { top: '13%', left: '22%' },
    { top: '13%', left: '78%' },
    { top: '38%', left: '6%' },
    { top: '38%', left: '94%' },
    { top: '55%', left: '50%' },
  ],
  [
    { top: '7%', left: '38%' },
    { top: '7%', left: '62%' },
    { top: '20%', left: '12%' },
    { top: '20%', left: '88%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '7%', left: '32%' },
    { top: '7%', left: '50%' },
    { top: '7%', left: '68%' },
    { top: '22%', left: '10%' },
    { top: '22%', left: '90%' },
    { top: '42%', left: '6%' },
    { top: '42%', left: '94%' },
    { top: '58%', left: '50%' },
  ],
  [
    { top: '7%', left: '28%' },
    { top: '7%', left: '50%' },
    { top: '7%', left: '72%' },
    { top: '20%', left: '10%' },
    { top: '20%', left: '90%' },
    { top: '38%', left: '5%' },
    { top: '38%', left: '95%' },
    { top: '55%', left: '28%' },
    { top: '55%', left: '72%' },
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
  return '';
}

function abbrevBlind(blind) {
  if (!blind) return '';
  if (blind.indexOf('Dealer') !== -1) return 'D';
  if (blind.indexOf('Small') !== -1) return 'SB';
  if (blind.indexOf('Big') !== -1) return 'BB';
  return blind;
}

function joinErrorMessage(data) {
  const code = data && data.error;
  if (code === 'room_not_found') return 'Room not found. Check the code.';
  if (code === 'room_full') return 'Room is full (max 10 players).';
  if (code === 'duplicate_name') return 'That name is already taken in this room.';
  if (code === 'invalid_name')
    return 'Enter a valid name (1–12 characters).';
  return 'Could not join. Check name/code and try again.';
}

socket.on('playerDisconnected', function (data) {
  Materialize.toast(data.player + ' disconnected.', 4000);
});

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
  var coins = '';
  for (var i = 0; i < count; i++) {
    coins += '<span class="shame-coin" title="Shame coin"></span>';
  }
  return (
    '<span class="shame-coins" title="' +
    count +
    ' shame coin(s)">' +
    coins +
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

function rebuyErrorMessage(data) {
  const code = data && data.error;
  if (code === 'hand_in_progress')
    return 'Wait until the hand finishes to rebuy.';
  return 'Rebuy only when you have 0 chips.';
}

socket.on('rebuyResult', function (data) {
  if (!data || data.ok === false) {
    Materialize.toast(rebuyErrorMessage(data), 3000);
    return;
  }
  $('#rebuyBar').hide();
  Materialize.toast('Rebuy +2000. Shame coin earned.', 3000);
});

socket.on('playerRebuy', function (data) {
  Materialize.toast(data.player + ' rebought (+shame coin)', 3000);
});

socket.on('waitingForPlayers', function () {
  Materialize.toast('Waiting for at least two players with chips.', 4000);
});

socket.on('hostRoom', function (data) {
  if (data == undefined || data.ok === false) {
    Materialize.toast(joinErrorMessage(data || { error: 'invalid_name' }), 4000);
    $('#joinButton').removeClass('disabled');
  } else {
    if (data.code != null) roomCode = String(data.code);
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
    closeLobbyModal();
    Materialize.toast(joinErrorMessage(data), 4000);
    $('#hostButton').removeClass('disabled');
  } else {
    roomCode = String($('#code-field').val()).trim();
    $('#joinModalContent').html(
      '<h5>' +
        data.host +
        "'s room</h5><hr /><h5>Players Currently in Room</h5><p>Please wait until your host starts the game. Leaving the page, refreshing, or going back will disconnect you from the game. </p>"
    );
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
    data.cards.map(function (c) {
      return renderCard(c);
    })
  );
  $('#usernamesCards').html(data.username + shameCoinsHtml(0));
  $('#mainContent').remove();
});

socket.on('rerender', function (data) {
  myUsername = data.username;
  var nameLabel = data.username + shameCoinsHtml(data.buyIns);
  if (data.myBet > 0) nameLabel += ' · Bet $' + data.myBet;
  $('#usernamesCards').html(nameLabel);
  if (data.community != undefined)
    $('#communityCards').html(
      data.community.map(function (c) {
        return renderCard(c);
      })
    );
  else $('#communityCards').empty();
  if (data.currBet == undefined) data.currBet = 0;
  $('#potAmount').text('$' + data.pot);
  $('#tableStage').text(
    'Hand #' + data.round + ' · ' + data.stage + ' · Top bet $' + data.topBet
  );
  $('#table-title').text('');
  var styles = opponentSeatStyles(data.players.length);
  $('#opponentCards').html(
    data.players.map(function (p, i) {
      return renderSeat(p.username, {
        text: p.status,
        money: p.money,
        blind: p.blind,
        bets: data.bets,
        buyIns: p.buyIns,
        isChecked: p.isChecked,
      }, styles[i] || styles[0]);
    }).join('')
  );
  renderSelf({
    money: data.myMoney,
    text: data.myStatus,
    blind: data.myBlind,
    bets: data.bets,
    buyIns: data.buyIns,
  });
  maybeShowRebuyPrompt(data.myMoney, data.roundInProgress);
  if (!data.roundInProgress) hideAllActionBtns();
});

socket.on('gameBegin', function (data) {
  $('#navbar-ptwu').hide();
  closeLobbyModal();
  if (data == undefined || data.ok === false) {
    var msg = 'Could not start the game. Try again.';
    if (data && data.error === 'not_enough_players') {
      msg = 'Need at least 2 players to start.';
    } else if (data && data.error === 'room_not_found') {
      msg = 'Room not found. Create or join again.';
    }
    Materialize.toast(msg, 4000);
    return;
  }
  $('#mainContent').hide();
  $('#gameDiv').css('display', 'flex');
});

function playNext() {
  socket.emit('startNextRound', {});
}

socket.on('reveal', function (data) {
  hideAllActionBtns();

  var winners = parseWinners(data.winners);
  for (var i = 0; i < winners.length; i++) {
    if (winners[i] == data.username) {
      Materialize.toast('You won the hand!', 4000);
      break;
    }
  }
  $('#table-title').text('Winner: ' + winners.join(', '));
  $('#tableStage').text('');
  $('#playNext').html(
    '<button onClick=playNext() id="playNextButton" class="play-next-btn">Start Next Hand</button>'
  );
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
      }, styles[i] || styles[0]);
    }).join('')
  );
});

socket.on('endHand', function (data) {
  hideAllActionBtns();
  $('#table-title').text(data.winner + ' wins $' + data.pot);
  $('#potAmount').text('$' + data.pot);
  $('#tableStage').text('');
  $('#playNext').html(
    '<button onClick=playNext() id="playNextButton" class="play-next-btn">Start Next Hand</button>'
  );
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
      }, styles[i] || styles[0]);
    }).join('')
  );
});

var beginHost = function () {
  if ($('#hostName-field').val() == '') {
    $('.toast').hide();
    closeLobbyModal();
    Materialize.toast(
      'Enter a valid name! (max length of name is 12 characters)',
      4000
    );
    $('#joinButton').removeClass('disabled');
  } else {
    socket.emit('host', { username: $('#hostName-field').val() });
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
    $('.toast').hide();
    Materialize.toast(
      'Enter a valid name/code! (max length of name is 12 characters.)',
      4000
    );
    closeLobbyModal();
    $('#hostButton').removeClass('disabled');
    $('#hostButton').on('click');
  } else {
    socket.emit('join', {
      code: String($('#code-field').val()).trim(),
      username: $('#joinName-field').val(),
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
    Materialize.toast('Missing room code. Create or join a room first.', 4000);
    return;
  }
  socket.emit('startGame', { code: code });
};

var fold = function () {
  socket.emit('moveMade', { move: 'fold', bet: 'Fold' });
};

var bet = function () {
  if (parseInt($('#betRangeSlider').val()) == 0) {
    Materialize.toast('You must bet more than $0! Try again.', 4000);
  } else if (parseInt($('#betRangeSlider').val()) < 2) {
    Materialize.toast('The minimum bet is $2.', 4000);
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
  if (
    parseInt($('#raiseRangeSlider').val()) == $('#raiseRangeSlider').prop('min')
  ) {
    Materialize.toast(
      'You must raise higher than the current top bet! Try again.',
      4000
    );
  } else {
    socket.emit('moveMade', {
      move: 'raise',
      bet: parseInt($('#raiseRangeSlider').val()),
    });
  }
};

function renderCard(card) {
  if (card.suit == '♠' || card.suit == '♣')
    return (
      '<div class="playingCard_black" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
  else
    return (
      '<div class="playingCard_red" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
}

function renderSeat(name, data, style) {
  var bet = getPlayerBet(name, data.bets);
  var stateClass = seatStateClass(data.text);
  var nameHtml = name + shameCoinsHtml(data.buyIns);
  var blindBadge = data.blind
    ? '<span class="seat-blind">' + abbrevBlind(data.blind) + '</span>'
    : '';
  var cardsHtml;
  if (data.showCards && data.cards) {
    cardsHtml =
      renderOpponentCard(data.cards[0]) + renderOpponentCard(data.cards[1]);
  } else {
    cardsHtml = '<div class="blankCard"></div><div class="blankCard"></div>';
  }
  var betHtml = bet > 0 ? '<div class="seat-bet">$' + bet + '</div>' : '';
  var statusHtml = '';
  if (data.text === 'Fold') statusHtml = '<div class="seat-status">Fold</div>';
  else if (data.isChecked) statusHtml = '<div class="seat-status">Check</div>';
  else if (data.text === 'Spectating')
    statusHtml = '<div class="seat-status">Spectating</div>';
  var handHtml = data.endHand
    ? '<div class="seat-hand">' + data.endHand + '</div>'
    : '';
  return (
    '<div class="table-seat ' +
    stateClass +
    '" style="top:' +
    style.top +
    ';left:' +
    style.left +
    '">' +
    blindBadge +
    '<div class="seat-name">' +
    nameHtml +
    '</div>' +
    '<div class="seat-cards">' +
    cardsHtml +
    '</div>' +
    betHtml +
    statusHtml +
    handHtml +
    '<div class="seat-stack">$' +
    data.money +
    '</div>' +
    '</div>'
  );
}

function renderOpponentCard(card) {
  if (card.suit == '♠' || card.suit == '♣')
    return (
      '<div class="playingCard_black_opponent" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
      '</div>'
    );
  else
    return (
      '<div class="playingCard_red_opponent" id="card"' +
      card.value +
      card.suit +
      '" data-value="' +
      card.value +
      ' ' +
      card.suit +
      '">' +
      card.value +
      ' ' +
      card.suit +
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
    '<h3 class="center-align">Raise top bet to $' +
      $('#raiseRangeSlider').val() +
      '</h3>'
  );
}

socket.on('updateRaiseModal', function (data) {
  $('#raiseRangeSlider').attr({
    max: data.usernameMoney,
    min: data.topBet,
  });
});

function updateRaiseModal() {
  document.getElementById('raiseRangeSlider').value = 0;
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
});

function renderSelf(data) {
  $('#playNext').empty();
  $('#usernamesMoney').text('$' + data.money);
  var $hero = $('#playerInformationCard');
  $hero.removeClass('seat-active seat-folded');
  if (data.text == 'Their Turn') {
    $hero.addClass('seat-active');
    $('#status').text('Your Turn');
    Materialize.toast('Your turn', 3000);
    socket.emit('evaluatePossibleMoves', {});
  } else if (data.text == 'Fold') {
    $hero.addClass('seat-folded');
    $('#status').text('Folded');
    Materialize.toast('You folded', 3000);
    hideAllActionBtns();
  } else {
    $('#status').text('');
    hideAllActionBtns();
  }
  $('#blindStatus').text(abbrevBlind(data.blind));
}
