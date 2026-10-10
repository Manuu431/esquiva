// main.js — menús, bucle de juego y partidas en este ordenador (solo o contra bots).
(function () {
  'use strict';

  const C = Sim.C;
  const STEP_MS = 1000 / C.TICK_HZ;
  const COUNTDOWN_MS = 3000;
  const BOT_NAMES = ['Ada', 'Turing', 'Hebb', 'Minsky', 'Hopfield'];

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

  let screen = 'menu'; // menu | countdown | playing | over
  let game = null; // { state, meta, controllers, localIdx }
  let levels = []; // niveles de bot cargados de weights.json
  let acc = 0;
  let last = performance.now();
  let lastFrame = last;
  let countdownEnd = 0;
  let countdownShown = 0;
  const humanInput = { mx: 0, my: 0 };
  const inputs = [];

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
      .then(fillLevelSelects);
  }

  function fillLevelSelects() {
    ['level', 'lobby-level'].forEach(function (id) {
      const sel = $(id);
      sel.innerHTML = '';
      levels.forEach(function (lv, i) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = lv.name;
        sel.appendChild(opt);
      });
      const saved = parseInt(store.get('level', ''), 10);
      sel.value = String(saved >= 0 && saved < levels.length ? saved : Math.max(0, levels.length - 2));
    });
    const none = levels.length === 0;
    $('bots').disabled = $('level').disabled = none;
    $('lobby-bots').disabled = $('lobby-level').disabled = none;
    if (none) {
      $('bots').value = '0';
      $('lobby-bots').value = '0';
    }
    $('bots-note').classList.toggle('hidden', !none);
    $('bots-note').textContent = none ? 'Los bots aún no están disponibles (falta weights.json).' : '';
  }

  function makeBot(levelIdx) {
    const lv = levels[levelIdx];
    const brain = NN.createBrain(lv.weights, { delay: lv.delay || 0 });
    return function (state, idx) {
      return brain.act(state, idx);
    };
  }

  // ---------- Partida local ----------

  function startLocal() {
    const nBots = levels.length ? parseInt($('bots').value, 10) || 0 : 0;
    const levelIdx = parseInt($('level').value, 10) || 0;
    const name = playerName();
    const prevWins = game && game.meta.length === nBots + 1 ? game.meta.map(function (m) { return m.wins; }) : null;
    const meta = [{ name: name, kind: 'human', wins: 0 }];
    const controllers = [
      function () {
        return Input.read(humanInput);
      },
    ];
    for (let i = 0; i < nBots; i++) {
      meta.push({ name: BOT_NAMES[i], kind: 'bot', level: levelIdx, wins: 0 });
      controllers.push(makeBot(levelIdx));
    }
    if (prevWins) meta.forEach(function (m, i) { m.wins = prevWins[i]; });
    game = {
      state: Sim.createState({ seed: (Math.random() * 0x7fffffff) | 0, numPlayers: meta.length }),
      meta: meta,
      controllers: controllers,
      localIdx: 0,
    };
    Render.clearEffects();
    beginCountdown();
  }

  function playerName() {
    const name = ($('name').value || '').trim().slice(0, 12) || 'Jugador';
    store.set('name', name);
    return name;
  }

  function beginCountdown() {
    show(null);
    screen = 'countdown';
    countdownEnd = performance.now() + COUNTDOWN_MS;
    countdownShown = 0;
    $('touch-hint').classList.toggle('hidden', !Input.usedTouch());
  }

  function stepLocal() {
    const g = game;
    for (let i = 0; i < g.controllers.length; i++) {
      inputs[i] = g.state.players[i].alive ? g.controllers[i](g.state, i) : null;
    }
    inputs.length = g.controllers.length;
    Sim.step(g.state, inputs);
    Render.onEvents(g.state.events, g.localIdx);
    Sfx.onEvents(g.state.events, g.localIdx);
  }

  // Avanza la simulación a paso fijo. La llama un temporizador en un Worker, que el
  // navegador no frena aunque la pestaña esté en segundo plano.
  function advance() {
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    if (screen !== 'playing' || !game) return;
    if (document.hidden) return; // en local, la partida se pausa si no se está mirando
    acc += elapsed;
    if (acc > 250) acc = 250; // tras un parón no se intenta recuperar todo de golpe
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      stepLocal();
      if (game.state.over) {
        endRound();
        break;
      }
    }
  }

  function endRound() {
    screen = 'over';
    acc = 0;
    const s = game.state;
    const meta = game.meta;
    if (meta.length > 1 && s.winner >= 0) meta[s.winner].wins++;
    showResults(s, meta, game.localIdx);
  }

  function showResults(s, meta, localIdx) {
    const solo = meta.length === 1;
    const list = $('over-list');
    list.innerHTML = '';
    const order = Sim.ranking(s);
    order.forEach(function (i, pos) {
      const p = s.players[i];
      const li = document.createElement('li');
      if (i === localIdx) li.className = 'me';
      li.appendChild(span('pos', solo ? '' : String(pos + 1)));
      const dot = span('dot', '');
      dot.style.background = Render.COLORS[i % Render.COLORS.length];
      li.appendChild(dot);
      li.appendChild(span('who', meta[i].name));
      li.appendChild(span('tag', tagFor(meta[i], p)));
      li.appendChild(span('num', String(p.score)));
      if (!solo) li.appendChild(span('wins', meta[i].wins ? '★ ' + meta[i].wins : ''));
      list.appendChild(li);
    });

    const me = s.players[localIdx];
    let note = '';
    if (solo) {
      const record = parseInt(store.get('record', '0'), 10) || 0;
      if (me.score > record) {
        store.set('record', me.score);
        note = '¡Nuevo récord! Antes: ' + record;
      } else {
        note = 'Tu récord: ' + record;
      }
      $('over-title').textContent = 'Aguantaste ' + fmtTime(s.tick);
    } else {
      $('over-title').textContent = s.winner === localIdx ? '¡Has ganado!' : 'Gana ' + meta[s.winner].name;
      note = 'La ronda duró ' + fmtTime(s.tick) + '.';
    }
    $('over-note').textContent = note;
    updateRecord();
    show('gameover');
  }

  function tagFor(m, p) {
    const parts = [];
    if (m.kind === 'bot') parts.push(levels[m.level] ? 'bot · ' + levels[m.level].name : 'bot');
    if (p.stars) parts.push(p.stars + '★');
    return parts.join(' · ');
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

  // ---------- Pantallas ----------

  function show(id) {
    ['menu', 'lobby', 'gameover'].forEach(function (k) {
      $(k).classList.toggle('hidden', k !== id);
    });
    if (id) $('touch-hint').classList.add('hidden');
  }

  function toMenu() {
    screen = 'menu';
    game = null;
    Render.clearEffects();
    updateRecord();
    show('menu');
  }

  function updateRecord() {
    const record = parseInt(store.get('record', '0'), 10) || 0;
    $('record').textContent = record ? 'Tu récord en solitario: ' + record : '';
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, 2200);
  }

  // ---------- Bucle de dibujo ----------

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;

    let countdown = 0;
    if (screen === 'countdown') {
      const left = countdownEnd - performance.now();
      if (left <= 0) {
        screen = 'playing';
        acc = 0;
        last = performance.now();
        Sfx.go();
      } else {
        countdown = Math.ceil(left / 1000);
        if (countdown !== countdownShown) {
          countdownShown = countdown;
          Sfx.tick();
        }
      }
    }

    const ext = screen === 'playing' ? acc / 1000 : 0;
    Render.draw(game ? game.state : null, game ? game.meta : [], {
      localIdx: game ? game.localIdx : -1,
      dt: dt,
      hazExt: ext,
      plExt: ext,
      countdown: countdown,
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
    Input.attachTouch($('canvas'));
    $('name').value = store.get('name', '');
    $('bots').value = store.get('bots', '3');
    updateRecord();

    $('btn-play').addEventListener('click', function () {
      Sfx.unlock();
      store.set('bots', $('bots').value);
      store.set('level', $('level').value);
      startLocal();
    });
    $('btn-again').addEventListener('click', function () {
      Sfx.unlock();
      startLocal();
    });
    $('btn-menu').addEventListener('click', toMenu);
    $('btn-host').disabled = true;
    $('btn-join').disabled = true;
    $('code').disabled = true;

    window.addEventListener('keydown', function (e) {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
      if (e.code === 'KeyM' && !typing) {
        toast(Sfx.toggleMute() ? 'Sonido desactivado' : 'Sonido activado');
      } else if (e.code === 'Enter') {
        if (screen === 'over') $('btn-again').click();
        else if (screen === 'menu') $('btn-play').click();
      } else if (e.code === 'Escape') {
        if (screen !== 'menu') toMenu();
      }
    });

    loadWeights();
    startTicker();
    requestAnimationFrame(frame);
  }

  // Ganchos para pruebas automáticas y para curiosear desde la consola.
  window.Esquiva = {
    screen: function () {
      return screen;
    },
    game: function () {
      return game;
    },
    levels: function () {
      return levels;
    },
  };

  boot();
})();
