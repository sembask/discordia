// Player do YouTube usado pela música da sala.
//
// Roda numa página própria (player.html), servida pelo servidor do Discordia
// em https: — assim o YouTube vê um site normal tanto no navegador quanto no
// app desktop. O app manda comandos por postMessage e recebe o estado.
//
// Comandos (app → player): load {videoId, start, play} · play · pause ·
//   seek {t} · volume {v} · stop · playlist {list, reqId}
// Eventos (player → app): ready · tick {id, t, d, s} · ended {id} ·
//   error {id, code} · playlist {reqId, ids} · fatal {message}
//
// ?fake=1 troca o YouTube por um player simulado (testes automáticos).

(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var FAKE = params.get('fake') === '1';
  var STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  var TICK_MS = 250;

  function post(msg) {
    window.parent.postMessage(Object.assign({ __discordiaPlayer: true }, msg), '*');
  }

  // ------------------------------------------------------------ player simulado

  function createFake() {
    var el = document.getElementById('player');
    el.innerHTML = '<div id="fake"></div>';
    var label = document.getElementById('fake');
    var dur = Number(params.get('dur') || 30);
    var cur = { id: null, t: 0, s: STATE.UNSTARTED, startedAt: 0, volume: 100 };
    function now() {
      return performance.now() / 1000;
    }
    function time() {
      return cur.s === STATE.PLAYING ? Math.min(dur, cur.t + (now() - cur.startedAt)) : cur.t;
    }
    function setPlaying(on) {
      cur.t = time();
      cur.startedAt = now();
      cur.s = on ? STATE.PLAYING : STATE.PAUSED;
    }
    setInterval(function () {
      if (cur.s === STATE.PLAYING && time() >= dur) {
        cur.t = dur;
        cur.s = STATE.ENDED;
        post({ ev: 'ended', id: cur.id });
      }
      label.textContent = cur.id ? 'FAKE ' + cur.id + ' · ' + time().toFixed(1) + 's · vol ' + cur.volume : 'FAKE';
    }, 100);
    return {
      load: function (id, start, play) {
        if (id === 'unavailable') {
          post({ ev: 'error', id: id, code: 150 });
          return;
        }
        cur.id = id;
        cur.t = start || 0;
        cur.startedAt = now();
        cur.s = play ? STATE.PLAYING : STATE.CUED;
      },
      play: function () {
        if (cur.id) setPlaying(true);
      },
      pause: function () {
        if (cur.id) setPlaying(false);
      },
      seek: function (t) {
        cur.t = Math.max(0, Math.min(dur, t));
        cur.startedAt = now();
        if (cur.s === STATE.ENDED) cur.s = STATE.PAUSED;
      },
      volume: function (v) {
        cur.volume = v;
      },
      stop: function () {
        cur = { id: null, t: 0, s: STATE.UNSTARTED, startedAt: 0, volume: cur.volume };
      },
      tick: function () {
        return { id: cur.id, t: time(), d: cur.id ? dur : 0, s: cur.s };
      },
      playlist: function (list, reqId) {
        var ids = list === 'PLFAKE' ? ['fakeVideo01', 'fakeVideo02', 'fakeVideo03'] : [];
        setTimeout(function () {
          post({ ev: 'playlist', reqId: reqId, ids: ids });
        }, 200);
      },
    };
  }

  // ------------------------------------------------------------ YouTube

  function createYouTube(onReady) {
    var api = null;
    var helper = null;
    var currentId = null;
    var pendingPlaylist = null;

    window.onYouTubeIframeAPIReady = function () {
      var vars = { autoplay: 0, controls: 1, rel: 0, playsinline: 1, enablejsapi: 1, origin: location.origin };
      api = new YT.Player('player', {
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: vars,
        events: {
          onReady: onReady,
          onStateChange: function (e) {
            if (e.data === STATE.ENDED) post({ ev: 'ended', id: currentId });
          },
          onError: function (e) {
            post({ ev: 'error', id: currentId, code: e.data });
          },
        },
      });
      // Segundo player, invisível e parado, só pra ler a lista de uma playlist.
      helper = new YT.Player('helper-target', {
        width: 1,
        height: 1,
        host: 'https://www.youtube-nocookie.com',
        playerVars: vars,
        events: {
          onStateChange: function (e) {
            if (e.data === STATE.CUED && pendingPlaylist) {
              var req = pendingPlaylist;
              pendingPlaylist = null;
              clearTimeout(req.timer);
              post({ ev: 'playlist', reqId: req.reqId, ids: helper.getPlaylist() || [] });
            }
          },
        },
      });
    };

    var script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = function () {
      post({ ev: 'fatal', message: 'Não foi possível carregar o YouTube.' });
    };
    document.head.appendChild(script);

    function ready() {
      return api && typeof api.getPlayerState === 'function';
    }

    return {
      load: function (id, start, play) {
        if (!ready()) return;
        currentId = id;
        var opts = { videoId: id, startSeconds: Math.max(0, start || 0) };
        if (play) api.loadVideoById(opts);
        else api.cueVideoById(opts);
      },
      play: function () {
        if (ready()) api.playVideo();
      },
      pause: function () {
        if (ready()) api.pauseVideo();
      },
      seek: function (t) {
        if (ready()) api.seekTo(Math.max(0, t), true);
      },
      volume: function (v) {
        if (!ready()) return;
        api.setVolume(v);
        if (v > 0 && api.isMuted()) api.unMute();
      },
      stop: function () {
        currentId = null;
        if (ready()) api.stopVideo();
      },
      tick: function () {
        if (!ready()) return { id: null, t: 0, d: 0, s: STATE.UNSTARTED };
        return { id: currentId, t: api.getCurrentTime() || 0, d: api.getDuration() || 0, s: api.getPlayerState() };
      },
      playlist: function (list, reqId) {
        if (!helper || typeof helper.cuePlaylist !== 'function') {
          post({ ev: 'playlist', reqId: reqId, ids: [], error: 'player não está pronto' });
          return;
        }
        if (pendingPlaylist) clearTimeout(pendingPlaylist.timer);
        pendingPlaylist = {
          reqId: reqId,
          timer: setTimeout(function () {
            pendingPlaylist = null;
            post({ ev: 'playlist', reqId: reqId, ids: [], error: 'tempo esgotado' });
          }, 10000),
        };
        helper.cuePlaylist({ listType: 'playlist', list: list });
      },
    };
  }

  // ------------------------------------------------------------ ponte com o app

  var player;
  function start() {
    post({ ev: 'ready' });
    setInterval(function () {
      post(Object.assign({ ev: 'tick' }, player.tick()));
    }, TICK_MS);
  }

  if (FAKE) {
    player = createFake();
    setTimeout(start, 50);
  } else {
    player = createYouTube(start);
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || !m.__discordiaCmd) return;
    switch (m.cmd) {
      case 'load':
        player.load(m.videoId, m.start, m.play);
        break;
      case 'play':
        player.play();
        break;
      case 'pause':
        player.pause();
        break;
      case 'seek':
        player.seek(m.t);
        break;
      case 'volume':
        player.volume(m.v);
        break;
      case 'stop':
        player.stop();
        break;
      case 'playlist':
        player.playlist(m.list, m.reqId);
        break;
    }
  });
})();
