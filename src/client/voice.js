/* WebRTC voice chat — mesh audio within the same poker room. */
(function () {
  var ICE_CONFIG = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  var socket = null;
  var localStream = null;
  var peerMap = {};
  var enabled = false;
  var muted = false;
  var $btn = null;

  function isSecureContext() {
    return window.isSecureContext === true;
  }

  function supportsVoice() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function setBtnState() {
    if (!$btn || !$btn.length) return;
    $btn.removeClass('voice-on voice-muted voice-error');
    if (!enabled) {
      $btn.text('麦');
      $btn.attr('title', '开启语音');
      return;
    }
    if (muted) {
      $btn.addClass('voice-muted');
      $btn.text('静音');
      $btn.attr('title', '点击恢复麦克风');
    } else {
      $btn.addClass('voice-on');
      $btn.text('开麦');
      $btn.attr('title', '点击静音');
    }
  }

  function removeAudioEl(socketId) {
    var el = document.getElementById('voice-audio-' + socketId);
    if (el) el.remove();
  }

  function closePeer(socketId) {
    var pc = peerMap[socketId];
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
      delete peerMap[socketId];
    }
    removeAudioEl(socketId);
  }

  function teardownAll() {
    Object.keys(peerMap).forEach(closePeer);
    if (localStream) {
      localStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    localStream = null;
    enabled = false;
    muted = false;
    setBtnState();
  }

  function leaveVoiceChannel() {
    if (socket && enabled) socket.emit('voiceLeave');
    teardownAll();
  }

  function createPeerConnection(remoteId) {
    var pc = new RTCPeerConnection(ICE_CONFIG);
    if (localStream) {
      localStream.getTracks().forEach(function (track) {
        pc.addTrack(track, localStream);
      });
    }
    pc.onicecandidate = function (ev) {
      if (!ev.candidate || !socket) return;
      socket.emit('voiceSignal', {
        to: remoteId,
        signal: { candidate: ev.candidate.toJSON() },
      });
    };
    pc.ontrack = function (ev) {
      var el = document.getElementById('voice-audio-' + remoteId);
      if (!el) {
        el = document.createElement('audio');
        el.id = 'voice-audio-' + remoteId;
        el.autoplay = true;
        el.setAttribute('playsinline', '');
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
      }
      el.srcObject = ev.streams[0];
    };
    peerMap[remoteId] = pc;
    return pc;
  }

  function offerPeer(remoteId) {
    var pc = createPeerConnection(remoteId);
    return pc
      .createOffer()
      .then(function (offer) {
        return pc.setLocalDescription(offer).then(function () {
          socket.emit('voiceSignal', {
            to: remoteId,
            signal: { sdp: offer },
          });
        });
      })
      .catch(function (err) {
        console.warn('voice offer failed', err);
      });
  }

  function handleSignal(from, signal) {
    if (!signal) return;
    var pc = peerMap[from];
    if (!pc) pc = createPeerConnection(from);

    if (signal.sdp) {
      var desc = new RTCSessionDescription(signal.sdp);
      return pc
        .setRemoteDescription(desc)
        .then(function () {
          if (desc.type !== 'offer') return;
          return pc.createAnswer().then(function (answer) {
            return pc.setLocalDescription(answer).then(function () {
              socket.emit('voiceSignal', {
                to: from,
                signal: { sdp: answer },
              });
            });
          });
        })
        .catch(function (err) {
          console.warn('voice signal failed', err);
        });
    }

    if (signal.candidate) {
      return pc
        .addIceCandidate(new RTCIceCandidate(signal.candidate))
        .catch(function (err) {
          console.warn('voice ice failed', err);
        });
    }
  }

  function applyMute() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(function (t) {
      t.enabled = !muted;
    });
    setBtnState();
  }

  function enableVoice() {
    if (!socket) return;
    if (!isSecureContext()) {
      alert('语音需要 HTTPS 访问（或本机 localhost）。请用 https:// 地址打开游戏。');
      return;
    }
    if (!supportsVoice()) {
      alert('当前浏览器不支持麦克风。');
      return;
    }
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      .then(function (stream) {
        localStream = stream;
        enabled = true;
        muted = false;
        setBtnState();
        socket.emit('voiceJoin');
      })
      .catch(function (err) {
        console.warn('getUserMedia failed', err);
        alert('无法打开麦克风，请检查浏览器权限。');
      });
  }

  function onVoiceClick() {
    if (!enabled) {
      enableVoice();
      return;
    }
    muted = !muted;
    applyMute();
  }

  function bindSocket() {
    socket.on('voicePeers', function (data) {
      if (!enabled || !data || !data.peers) return;
      data.peers.forEach(function (peer) {
        if (peer.socketId && !peerMap[peer.socketId]) {
          offerPeer(peer.socketId);
        }
      });
    });

    socket.on('voicePeerJoined', function () {
      // New peer will offer us after voiceJoin — wait for their signal.
    });

    socket.on('voicePeerLeft', function (data) {
      if (data && data.socketId) closePeer(data.socketId);
    });

    socket.on('voiceSignal', function (data) {
      if (!data || !data.from || !data.signal) return;
      handleSignal(data.from, data.signal);
    });
  }

  function init(sock) {
    socket = sock;
    $btn = $('#voiceBtn');
    bindSocket();
    $btn.on('click', function (e) {
      e.preventDefault();
      onVoiceClick();
    });
    window.addEventListener('beforeunload', leaveVoiceChannel);
    setBtnState();
  }

  window.VoiceChat = {
    init: init,
    leave: leaveVoiceChannel,
    show: function () {
      if ($btn) $btn.prop('hidden', false);
    },
    hide: function () {
      leaveVoiceChannel();
      if ($btn) $btn.prop('hidden', true);
    },
  };
})();
