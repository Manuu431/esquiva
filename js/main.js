// main.js — menús, bucle de juego y pegamento entre netcode.js (reglas), net.js (PeerJS),
// render.js (dibujo) e input.js (teclado/táctil).
// Tres formas de jugar, mismo código: local (un anfitrión sin invitados), anfitrión de una sala
// e invitado.
(function () {
  'use strict';

  const C = Sim.C;
  const STEP_MS = Netcode.STEP_MS;
  const BOT_NAMES = ['Ada', 'Turing', 'Hebb', 'Minsky', 'Hopfield'];
  const HAZARD_NAMES = ['Suave', 'Normal', 'Intensa'];

  const $ = function (id) {
    return document.getElementById(id);
  };

  const store = {
    get: function (k, def) {
      try {
        const v = localStorage.getItem('esquiva.' + k);
        return v === null ? def : v;
      } catch (e) {
        return def;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem('esquiva.' + k, String(v));
      } catch (e) {
        /* modo privado: no se guarda */
      }
    },
  };

  let mode = null; // null (menú) | 'local' | 'host' | 'client'
  let host = null; // Netcode host (modos local y host)
  let client = null; // Netcode client (modo client)
  let link = null; // transporte de net.js (modos host y client)
  let roomCode = '';
  let levels = []; // niveles de bot cargados de weights.json
  let acc = 0;
  let last = performance.now();
  let lastFrame = last;
  let countdownShown = 0;
  let resultsRound = -1; // ronda cuyos resultados ya se han mostrado
  let busy = false; // conectando
  let demo = null; // partida de exhibición entre bots que se ve detrás del menú
  const humanInput = { mx: 0, my: 0 };
  const localView = { state: null, meta: [], localIdx: -1, countdown: 0, hazExt: 0, plExt: 0 };

  // ---------- Bots ----------

  function loadWeights() {
    return fetch('weights.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data.arch || data.arch.weights !== NN.N_W) throw new Error('weights.json no corresponde a esta red');
        levels = data.levels || [];
      })
      .catch(function () {
        levels = [];
      })
      .then(fillLevelSelects)
      .then(updateRecord);
  }

  // ---------- Exhibición detrás del menú ----------

  function newDemo() {
    const top = levels.length - 1;
    if (top < 0) return null;
    const n = 4;
    const brains = [];
    for (let i = 0; i < n; i++) brains.push(makeBot(top, i));
    return {
      state: Sim.createState({ seed: randomSeed(), numPlayers: n }),
      meta: BOT_NAMES.slice(0, n).map(function (name) {
        return { name: name, kind: 'bot' };
      }),
      brains: brains,
      inputs: [],
      rest: 0,
    };
  }

  function stepDemo() {
    if (!demo) {
      demo = newDemo();
      if (!demo) return;
    }
    const s = demo.state;
    if (s.over) {
      if (++demo.rest > 2 * C.TICK_HZ) demo = null;
      return;
    }
    for (let i = 0; i < demo.brains.length; i++) demo.inputs[i] = s.players[i].alive ? demo.brains[i](s, i) : null;
    Sim.step(s, demo.inputs);
    Render.onEvents(s.events, -1);
  }

  function fillLevelSelects() {
    const saved = parseInt(store.get('level', ''), 10);
    const def = saved >= 0 && saved < levels.length ? saved : Math.max(0, levels.length - 2);
    ['level', 'lobby-level'].forEach(function (id) {
      const sel = $(id);
      sel.innerHTML = '';
      levels.forEach(function (lv, i) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = lv.name;
        sel.appendChild(opt);
      });
      sel.value = String(def);
    });
    const none = levels.length === 0;
    $('bots').disabled = $('level').disabled = none;
    $('lobby-bots').disabled = $('lobby-level').disabled = none;
    if (none) $('bots').value = $('lobby-bots').value = '0';
    $('bots-note').classList.toggle('hidden', !none);
    $('bots-note').textContent = none ? 'Los bots no están disponibles (no se pudo cargar weights.json).' : '';
  }

  // Cada bot de una partida lleva una red distinta del mismo nivel: si no, verían lo mismo,
  // decidirían lo mismo y acabarían moviéndose pegados.
  function makeBot(levelIdx, botIdx) {
    const lv = levels[levelIdx];
    if (!lv || !lv.variants || !lv.variants.length) return null;
    return NN.createBrain(lv.variants[botIdx % lv.variants.length], { delay: lv.delay || 0 }).act;
  }

  function levelName(i) {
    return levels[i] ? levels[i].name : '';
  }

  // ---------- Crear / entrar / salir ----------

  function playerName() {
    const name = Netcode.cleanName($('name').value);
    store.set('name', name);
    return name;
  }

  function newHost(send, kick) {
    const h = Netcode.createHost({ name: playerName(), makeBot: makeBot, botNames: BOT_NAMES, send: send, kick: kick });
    h.onChange = syncUi;
    h.onEvents = function (ev) {
      Render.onEvents(ev, h.localIdx);
      Sfx.onEvents(ev, h.localIdx);
    };
    return h;
  }

  function randomSeed() {
    return ((Math.random() * 0x7fffffff) | 0) + 1;
  }

  function intOf(id) {
    return parseInt($(id).value, 10) || 0;
  }

  // "3 vidas · proyectiles normales" es la partida de referencia; lo demás se indica.
  function rulesText(lives, hazard) {
    return lives + (lives === 1 ? ' vida' : ' vidas') + ' · proyectiles: ' + HAZARD_NAMES[hazard];
  }

  function defaultRules(lives, hazard) {
    return lives === C.LIVES && hazard === C.HAZARD_DEFAULT;
  }

  function startLocal() {
    leave();
    mode = 'local';
    host = newHost(function () {}, null);
    host.setBots(intOf('bots'), intOf('level'));
    host.setRules(intOf('lives'), intOf('hazard'));
    resetClock();
    host.start(randomSeed());
  }

  function createRoom() {
    if (busy) return;
    leave();
    setBusy(true, 'Creando sala…');
    let h = null;
    const pendingJoins = [];
    Net.host({
      onJoin: function (id) {
        if (h) h.join(id, performance.now());
        else pendingJoins.push(id);
      },
      onMessage: function (id, msg) {
        if (h) h.receive(id, msg, performance.now());
      },
      onLeave: function (id) {
        if (h) h.leave(id);
      },
      onError: function (text) {
        toast(text);
      },
    }).then(
      function (l) {
        setBusy(false);
        mode = 'host';
        link = l;
        roomCode = l.code;
        h = host = newHost(l.send, l.kick);
        pendingJoins.forEach(function (id) {
          h.join(id, performance.now());
        });
        host.setBots(intOf('lobby-bots'), intOf('lobby-level'));
        host.setRules(intOf('lobby-lives'), intOf('lobby-hazard'));
        resetClock();
        setHash(roomCode);
        syncUi();
      },
      function (err) {
        setBusy(false);
        toast(err.message);
      }
    );
  }

  function joinRoom() {
    if (busy) return;
    const code = Net.normalizeCode($('code').value);
    if (code.length !== Net.CODE_LEN) {
      toast('El código de sala tiene ' + Net.CODE_LEN + ' caracteres.');
      return;
    }
    leave();
    setBusy(true, 'Entrando en la sala ' + code + '…');
    $('toast').classList.add('hidden');
    let c = null;
    Net.join(code, {
      onMessage: function (msg) {
        if (c) c.receive(msg, performance.now());
      },
      onClose: function () {
        if (client === c) {
          leave();
          toast('El anfitrión se ha desconectado: la partida ha terminado.', 5000);
        }
      },
    }).then(
      function (l) {
        setBusy(false);
        mode = 'client';
        link = l;
        roomCode = code;
        c = client = Netcode.createClient({ name: playerName(), send: l.send });
        client.onChange = syncUi;
        client.onEvents = function (ev) {
          const me = client.view(performance.now()).localIdx;
          Render.onEvents(ev, me);
          Sfx.onEvents(ev, me);
        };
        resetClock();
        setHash(code);
        client.hello(performance.now());
        syncUi();
      },
      function (err) {
        setBusy(false);
        toast(err.message, 5000);
      }
    );
  }

  // Vuelve al menú cerrando lo que hubiera abierto.
  function leave() {
    if (link) link.close();
    link = null;
    host = null;
    client = null;
    mode = null;
    roomCode = '';
    resultsRound = -1;
    countdownShown = 0;
    demo = null;
    Render.clearEffects();
    setHash('');
    updateRecord();
    show('menu');
  }

  function setBusy(on, text) {
    busy = on;
    ['btn-play', 'btn-host', 'btn-join'].forEach(function (id) {
      $(id).disabled = on || (id !== 'btn-play' && !Net.available());
    });
    $('online-note').textContent = on ? text : onlineNote();
  }

  function onlineNote() {
    return Net.available()
      ? 'Uno crea la sala y pasa el código. Si el anfitrión cierra la pestaña, la partida termina.'
      : 'El multijugador no está disponible en este navegador.';
  }

  function setHash(code) {
    try {
      history.replaceState(null, '', code ? '#' + code : location.pathname + location.search);
    } catch (e) {
      /* file:// u otros: sin enlace directo */
    }
  }

  // ---------- Interfaz según el estado ----------

  function phase() {
    return host ? host.phase : client ? client.phase : 'menu';
  }

  function syncUi() {
    if (client && (client.bye || client.lost)) {
      const why = client.bye === 'full' ? 'La sala está llena (máximo ' + C.MAX_PLAYERS + ').'
        : client.bye === 'version' ? 'El anfitrión usa otra versión del juego. Recargad los dos la página.'
        : 'Se ha perdido la conexión con el anfitrión: la partida ha terminado.';
      leave();
      toast(why, 5000);
      return;
    }
    const ph = phase();
    if (ph === 'menu') return;
    if (ph === 'lobby' || ph === 'connecting') {
      renderLobby();
      show('lobby');
    } else if (ph === 'over') {
      const round = host ? host.round : client.room.round;
      const state = host ? host.state : client.snapshot();
      if (state && state.over && resultsRound !== round) {
        resultsRound = round;
        showResults(state, host ? host.roster : client.room.roster, host ? host.localIdx : client.room.you);
      }
    } else {
      show(null);
      $('touch-hint').classList.toggle('hidden', !Input.usedTouch());
    }
  }

  function renderLobby() {
    const isHost = mode === 'host';
    const members = host ? host.members.map(function (m) { return { name: m.name, wins: m.wins, host: m.id === null }; })
      : client && client.room ? client.room.members : [];
    const me = host ? 0 : client && client.room ? client.room.me : -1;
    const bots = host ? host.bots : client && client.room ? client.room.bots : 0;
    const level = host ? host.level : client && client.room ? client.room.level : 0;
    const rules = host ? rulesText(host.lives, host.hazard) : client && client.room ? rulesText(client.room.lives, client.room.hazard) : '';

    $('lobby-code').textContent = roomCode;
    const list = $('lobby-players');
    list.innerHTML = '';
    members.forEach(function (m, i) {
      const li = document.createElement('li');
      if (i === me) li.className = 'me';
      const dot = span('dot', '');
      dot.style.background = Render.COLORS[i % Render.COLORS.length];
      li.appendChild(dot);
      li.appendChild(span('who', m.name));
      li.appendChild(span('tag', [m.host ? 'anfitrión' : '', i === me ? 'tú' : ''].filter(Boolean).join(' · ')));
      li.appendChild(span('wins', m.wins ? '★ ' + m.wins : ''));
      list.appendChild(li);
    });

    $('lobby-host-controls').classList.toggle('hidden', !isHost);
    $('lobby-start-row').classList.toggle('hidden', !isHost);
    const free = C.MAX_PLAYERS - members.length;
    let status;
    if (!members.length) {
      status = 'Conectando…';
    } else if (isHost) {
      status = members.length === 1 && !bots
        ? 'Pasa el código o el enlace a tus amigos. También puedes empezar solo.'
        : members.length + ' de ' + C.MAX_PLAYERS + ' jugadores' + (bots ? ' + ' + Math.min(bots, free) + ' bots (' + levelName(level) + ')' : '') + '.';
    } else {
      status = 'Esperando a que el anfitrión empiece. ' + rules + (bots ? ' · ' + Math.min(bots, free) + ' bots (' + levelName(level) + ')' : '') + '.';
    }
    $('lobby-status').textContent = status;
  }

  function showResults(s, meta, localIdx) {
    const solo = meta.length === 1;
    const list = $('over-list');
    list.innerHTML = '';
    Sim.ranking(s).forEach(function (i, pos) {
      const p = s.players[i];
      const li = document.createElement('li');
      if (i === localIdx) li.className = 'me';
      li.appendChild(span('pos', solo ? '' : String(pos + 1)));
      const dot = span('dot', '');
      dot.style.background = Render.COLORS[i % Render.COLORS.length];
      li.appendChild(dot);
      li.appendChild(span('who', meta[i].name));
      const tags = [];
      if (meta[i].kind === 'bot') tags.push('bot' + (levelName(meta[i].level) ? ' · ' + levelName(meta[i].level) : ''));
      tags.push(fmtTime(p.alive ? s.tick : p.deathTick));
      if (p.stars) tags.push(p.stars + '★');
      li.appendChild(span('tag', tags.join(' · ')));
      li.appendChild(span('num', String(p.score)));
      if (!solo) li.appendChild(span('wins', meta[i].wins ? '★ ' + meta[i].wins : ''));
      list.appendChild(li);
    });

    let note;
    if (solo) {
      const mine = s.players[0].score;
      const standard = defaultRules(s.maxLives, s.hazard);
      const key = standard ? 'record' : 'record.' + s.maxLives + '.' + s.hazard;
      const record = parseInt(store.get(key, '0'), 10) || 0;
      if (standard) recordSolo(s.players[0], s.tick);
      if (mine > record) {
        store.set(key, mine);
        note = record ? '¡Nuevo récord! El anterior era ' + record + '.' : '¡Primer récord!';
      } else {
        note = 'Tu récord: ' + record + '.';
      }
      if (!standard) note += ' (Con ' + rulesText(s.maxLives, s.hazard) + '.)';
      else if (botsSoloText()) note += ' Media de los bots jugando solos: ' + botsSoloText() + '.';
      $('over-title').textContent = 'Aguantaste ' + fmtTime(s.tick);
    } else {
      $('over-title').textContent = s.winner === localIdx ? '¡Has ganado!' : 'Gana ' + meta[s.winner].name;
      note = 'Gana quien más puntos suma: tiempo en pie + ' + C.STAR_POINTS + ' por estrella.';
    }
    if (mode === 'client') note += ' Esperando al anfitrión…';
    $('over-note').textContent = note;
    $('btn-again').classList.toggle('hidden', mode === 'client');
    $('btn-menu').textContent = mode === 'local' ? 'Menú' : mode === 'host' ? 'Volver a la sala' : 'Salir';
    show('gameover');
  }

  // Partidas en solitario del humano, para compararlas con lo que hacen los bots solos.
  function soloHistory() {
    try {
      const h = JSON.parse(store.get('history', '[]'));
      return Array.isArray(h) ? h : [];
    } catch (e) {
      return [];
    }
  }

  function recordSolo(p, ticks) {
    const h = soloHistory();
    h.push({ score: p.score, secs: Math.round((ticks / C.TICK_HZ) * 10) / 10, stars: p.stars });
    store.set('history', JSON.stringify(h.slice(-50)));
  }

  function botsSoloText() {
    return levels
      .filter(function (lv) {
        return lv.test;
      })
      .map(function (lv) {
        return lv.name + ' ' + lv.test.score;
      })
      .join(' · ');
  }

  function fmtTime(ticks) {
    const secs = ticks / C.TICK_HZ;
    return Math.floor(secs / 60) + ':' + (secs % 60).toFixed(1).padStart(4, '0');
  }

  function span(cls, text) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function show(id) {
    ['menu', 'lobby', 'gameover'].forEach(function (k) {
      $(k).classList.toggle('hidden', k !== id);
    });
    if (id) $('touch-hint').classList.add('hidden');
    $('btn-exit').classList.toggle('hidden', id !== null); // solo durante la partida
  }

  function updateRecord() {
    const record = parseInt(store.get('record', '0'), 10) || 0;
    const h = soloHistory();
    let text = '';
    if (h.length) {
      const recent = h.slice(-10);
      const avg = recent.reduce(function (a, r) { return a + r.score; }, 0) / recent.length;
      const secs = recent.reduce(function (a, r) { return a + r.secs; }, 0) / recent.length;
      text = 'Tú en solitario (3 vidas, proyectiles normales): récord ' + record + ', media de las últimas ' + recent.length + ': ' + Math.round(avg) + ' puntos (' + secs.toFixed(1) + ' s).';
      if (botsSoloText()) text += ' Bots: ' + botsSoloText() + '.';
    }
    $('record').textContent = text;
  }

  let toastTimer = 0;
  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, ms || 2400);
  }

  // ---------- Bucle ----------

  function resetClock() {
    acc = 0;
    last = performance.now();
  }

  // Avanza a paso fijo de 1/60 s. Lo llama un temporizador en un Worker, que el navegador no
  // frena con la pestaña en segundo plano: así el anfitrión no congela la partida de todos
  // por cambiar de pestaña.
  function advance() {
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    // En local (y en la exhibición) no hay nadie esperando: si no se mira, se pausa.
    if ((mode === 'local' || mode === null) && document.hidden) return;
    acc += elapsed;
    if (acc > 250) acc = 250; // tras un parón no se intenta recuperar todo de golpe
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      Input.read(humanInput);
      if (host) host.tick(humanInput, now - acc);
      else if (client) client.tick(humanInput, now - acc);
      else stepDemo();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;

    let v = localView;
    if (client) {
      v = client.view(performance.now());
    } else if (host) {
      const playing = host.phase === 'playing';
      v.state = host.state;
      v.meta = host.roster;
      v.localIdx = host.localIdx;
      v.countdown = host.phase === 'countdown' ? Math.ceil(host.countdown / C.TICK_HZ) : 0;
      v.hazExt = v.plExt = playing ? acc / 1000 : 0;
    } else {
      v.state = demo ? demo.state : null;
      v.meta = demo ? demo.meta : [];
      v.localIdx = -1;
      v.countdown = 0;
      v.hazExt = v.plExt = demo && !demo.state.over ? acc / 1000 : 0;
    }

    if (v.countdown !== countdownShown) {
      if (v.countdown > 0) Sfx.tick();
      else if (countdownShown > 0 && phase() === 'playing') Sfx.go();
      countdownShown = v.countdown;
    }

    Render.draw(v.state, v.meta, {
      localIdx: v.localIdx,
      dt: dt,
      hazExt: v.hazExt,
      plExt: v.plExt,
      countdown: v.countdown,
      dim: mode === null,
      banner: client && v.state && v.localIdx < 0 && client.phase === 'playing' ? 'Ronda en curso: entras en la siguiente' : '',
    });
  }

  function startTicker() {
    try {
      const src = 'setInterval(function(){postMessage(0)},' + Math.floor(STEP_MS / 2) + ');';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = advance;
    } catch (e) {
      setInterval(advance, Math.floor(STEP_MS / 2));
    }
  }

  // ---------- Arranque ----------

  function boot() {
    Render.init($('canvas'));
    Input.attachTouch($('stage'));
    $('name').value = store.get('name', '');
    $('bots').value = store.get('bots', '3');
    $('lives').value = $('lobby-lives').value = store.get('lives', String(C.LIVES));
    $('hazard').value = $('lobby-hazard').value = store.get('hazard', String(C.HAZARD_DEFAULT));
    updateRecord();
    setBusy(false);

    $('btn-play').addEventListener('click', function () {
      Sfx.unlock();
      store.set('bots', $('bots').value);
      store.set('level', $('level').value);
      store.set('lives', $('lives').value);
      store.set('hazard', $('hazard').value);
      startLocal();
    });
    $('btn-host').addEventListener('click', function () {
      Sfx.unlock();
      createRoom();
    });
    $('btn-join').addEventListener('click', function () {
      Sfx.unlock();
      joinRoom();
    });
    $('code').addEventListener('input', function () {
      $('code').value = Net.normalizeCode($('code').value);
    });
    $('code').addEventListener('keydown', function (e) {
      if (e.code === 'Enter') {
        e.stopPropagation();
        $('btn-join').click();
      }
    });

    const botsChanged = function () {
      if (mode === 'host') host.setBots(intOf('lobby-bots'), intOf('lobby-level'));
    };
    $('lobby-bots').addEventListener('change', botsChanged);
    $('lobby-level').addEventListener('change', botsChanged);
    const rulesChanged = function () {
      store.set('lives', $('lobby-lives').value);
      store.set('hazard', $('lobby-hazard').value);
      if (mode === 'host') host.setRules(intOf('lobby-lives'), intOf('lobby-hazard'));
    };
    $('lobby-lives').addEventListener('change', rulesChanged);
    $('lobby-hazard').addEventListener('change', rulesChanged);
    $('btn-start').addEventListener('click', function () {
      Sfx.unlock();
      if (mode === 'host') host.start(randomSeed());
    });
    $('btn-leave').addEventListener('click', leave);
    $('btn-exit').addEventListener('click', leave);
    const paintMute = function () {
      $('btn-mute').textContent = Sfx.isMuted() ? 'Sonido: no' : 'Sonido: sí';
    };
    $('btn-mute').addEventListener('click', function () {
      Sfx.unlock();
      Sfx.toggleMute();
      paintMute();
    });
    paintMute();
    $('btn-copy').addEventListener('click', function () {
      const url = location.origin + location.pathname + '#' + roomCode;
      const done = function () {
        toast('Enlace copiado');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast(url, 6000); });
      else toast(url, 6000);
    });

    $('btn-again').addEventListener('click', function () {
      Sfx.unlock();
      if (host && host.canStart()) host.start(randomSeed());
    });
    $('btn-menu').addEventListener('click', function () {
      if (mode === 'host') host.toLobby();
      else leave();
    });

    window.addEventListener('keydown', function (e) {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
      if (e.code === 'KeyM' && !typing) {
        $('btn-mute').click();
      } else if (e.code === 'Enter') {
        const ph = phase();
        if (ph === 'over' && mode !== 'client') $('btn-again').click();
        else if (ph === 'lobby' && mode === 'host') $('btn-start').click();
        else if (ph === 'menu' && !busy) $('btn-play').click();
      } else if (e.code === 'Escape' && mode) {
        leave();
      }
    });

    // Cerrar la pestaña avisa a los demás al momento en vez de dejarles esperando.
    window.addEventListener('pagehide', function () {
      if (link) link.close();
    });

    // Enlace directo a una sala: .../#CODIGO
    const hash = Net.normalizeCode(location.hash.slice(1));
    if (hash.length === Net.CODE_LEN) {
      $('code').value = hash;
      toast('Escribe tu nombre y pulsa «Unirse» para entrar en la sala ' + hash, 5000);
    }

    loadWeights();
    startTicker();
    requestAnimationFrame(frame);
  }

  // Ganchos para las pruebas automáticas y para curiosear desde la consola.
  window.Esquiva = {
    mode: function () {
      return mode;
    },
    screen: function () {
      return phase();
    },
    host: function () {
      return host;
    },
    client: function () {
      return client;
    },
    state: function () {
      return host ? host.state : client ? client.view(performance.now()).state : null;
    },
    code: function () {
      return roomCode;
    },
    levels: function () {
      return levels;
    },
  };

  boot();
})();
