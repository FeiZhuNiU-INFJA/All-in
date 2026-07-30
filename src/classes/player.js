const { STARTING_CHIPS } = require('../constants.js');

const Player = function (playerName, socket, debug) {
  this.username = playerName;
  this.cards = [];
  this.socket = socket;
  this.currentCard = null;
  this.money = STARTING_CHIPS;
  this.buyIns = 0;
  this.spectating = false;
  this.status = '';
  this.blindValue = '';
  this.dealer = false;
  this.allIn = false;
  this.goAgainStatus = false;
  // Ready-up state between hands: 'undecided' | 'ready' | 'watching'.
  // 'watching' persists across hands; 'ready' resets to 'undecided' each hand.
  this.readyState = 'undecided';
  this.debug = debug || false;

  this.addCard = (card) => {
    this.cards.push(card);
  };

  this.log = () => {
    if (this.debug) {
      console.log(...arguments);
    }
  };

  this.setStatus = (data) => (this.status = data);
  this.setBlind = (data) => (this.blindValue = data);
  this.setDealer = (data) => (this.dealer = data);
  this.setReadyState = (v) => (this.readyState = v);
  this.getUsername = () => {
    return this.username;
  };
  this.getBuyIns = () => {
    return this.buyIns;
  };
  this.getMoney = () => {
    return this.money;
  };
  this.getStatus = () => {
    return this.status;
  };
  this.getBlind = () => {
    return this.blindValue;
  };
  this.getDealer = () => {
    return this.dealer;
  };
  this.getReadyState = () => {
    return this.readyState;
  };

  this.emit = (eventName, payload) => {
    this.socket.emit(eventName, payload);
  };
};

module.exports = Player;
