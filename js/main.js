// main.js — menús, bucle de juego y pegamento entre netcode.js (reglas), net.js (PeerJS),
// render.js (dibujo) e input.js (teclado/táctil).
// Tres formas de jugar, mismo código: local (un anfitrión sin invitados), anfitrión de una sala
// e invitado.
(function () {
  'use strict';

  const C = Sim.C;
  const STEP_MS = Netcode.STEP_MS;
  const BOT_NAMES = ['Ada', 'Turing', 'Hebb', 'Minsky', 'Hopfield'];
  const HAZARD_NAMES = Stats.HAZARD_NAMES;
  // Lo que hace cada mejora, en el orden de Sim.POWERS.
  const POWER_HELP = [
    ['Turbo', 'te mueves un 45 % más rápido durante 6 s.'],
    ['Fantasma', 'intangible 4 s: los proyectiles te atraviesan.'],
    ['Escudo', 'absorbe el siguiente impacto (dura 12 s).'],
    ['Corazón', 'una vida más; con todas, 300 puntos.'],
    ['Bomba', 'destruye los proyectiles que tengas cerca.'],
    ['Doble', 'puntos dobles durante 8 s.'],
    ['Imán', 'coges las estrellas desde lejos durante 8 s.'],
  ];

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
  let roomGen = 1; // relevos de anfitrión que lleva la sala (ver net.js)
  let levels = []; // niveles de bot cargados de weights.json
  let acc = 0;
  let last = performance.now();
  let lastFrame = last;
  let countdownShown = 0;
  let resultsRound = -1; // ronda cuyos resultados ya se han mostrado
  let busy = false; // conectando
  let statsOpen = false; // viendo "Mis partidas" o la ayuda
  let paused = false; // solo en partidas de este ordenador
  const stats = Stats.create(store);
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
        // Valen los genomas completos y los antiguos, sin criterio de elección de estrella.
        const size = data.arch && data.arch.weights;
        if (size !== NN.N_W && NN.OLD_SIZES.indexOf(size) < 0) throw new Error('weights.json no corresponde a esta red');
        levels = (data.levels || []).slice();
        // Niveles que no son una red entrenada: el planificador y dos formas de repartir niveles.
        if (levels.length) {
          if (!levels.some(function (lv) { return lv.kind === 'god'; })) levels.push({ name: 'Modo Dios', kind: 'god' });
          levels.push({ name: 'Mixto', kind: 'mixed' }, { name: 'Adaptativo', kind: 'adaptive' });
        }
      })
      .catch(function () {
        levels = [];
      })
      .then(fillLevelSelects)
      .then(updateRecord);
  }

  // ---------- Exhibición detrás del menú ----------

  function newDemo() {
    const top = netLevels().pop();
    if (top === undefined) return null;
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
    const def = saved >= 0 && saved < levels.length ? saved : Math.max(0, netLevels().length - 2);
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
    if (!lv) return null;
    if (lv.kind === 'god') return God.createBot(lv.params);
    if (!lv.variants || !lv.variants.length) return null;
    return NN.createBrain(lv.variants[botIdx % lv.variants.length], { delay: lv.delay || 0 }).act;
  }

  // Índices de los niveles que son redes entrenadas, de más fácil a más difícil.
  function netLevels() {
    const out = [];
    levels.forEach(function (lv, i) {
      if (!lv.kind) out.push(i);
    });
    return out;
  }

  // Nivel que te corresponde según cómo te ha ido contra bots en este ordenador: empieza en el
  // segundo nivel, sube medio escalón por cada ronda ganada y baja un tercio por cada una perdida.
  function adaptiveLevel() {
    const nets = netLevels();
    let r = Math.min(1, nets.length - 1);
    stats.all().forEach(function (g) {
      if (g.o || !g.b) return;
      r += g.w ? 0.5 : -0.34;
      r = Math.max(0, Math.min(nets.length - 1, r));
    });
    return nets[Math.round(r)];
  }

  // Nivel concreto del bot n cuando el elegido es mixto (uno de cada, empezando por el más
  // difícil) o adaptativo.
  function botLevel(levelIdx, botIdx) {
    const lv = levels[levelIdx];
    if (lv && lv.kind === 'mixed') {
      const nets = netLevels();
      return nets[nets.length - 1 - (botIdx % nets.length)];
    }
    if (lv && lv.kind === 'adaptive') return adaptiveLevel();
    return levelIdx;
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

  // Red mala simulada, para pruebas: con ?lag=120&jitter=40 en la dirección, cada mensaje que
  // sale de esta pestaña tarda esos milisegundos de más (con variación, así que se desordenan).
  const fakeLag = (function () {
    const q = new URLSearchParams(location.search);
    const lag = parseFloat(q.get('lag')) || 0;
    const jitter = parseFloat(q.get('jitter')) || 0;
    if (!lag && !jitter) return null;
    return function (fn) {
      return function () {
        const args = arguments;
        setTimeout(function () {
          fn.apply(null, args);
        }, Math.max(0, lag + (Math.random() * 2 - 1) * jitter));
      };
    };
  })();

  function newHost(send, kick) {
    const h = Netcode.createHost({ name: playerName(), makeBot: makeBot, botLevel: botLevel, botNames: BOT_NAMES, send: send, kick: kick });
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
  function rulesText(lives, hazard, power) {
    return lives + (lives === 1 ? ' vida' : ' vidas') + ' · proyectiles: ' + HAZARD_NAMES[hazard] + (power ? '' : ' · sin mejoras');
  }

  // Las reglas de referencia, con las que se miden los bots: 3 vidas, proyectiles normales, con mejoras.
  function defaultRules(lives, hazard, power) {
    return lives === C.LIVES && hazard === C.HAZARD_DEFAULT && !!power;
  }

  function startLocal() {
    leave();
    mode = 'local';
    host = newHost(function () {}, null);
    host.setBots(intOf('bots'), intOf('level'));
    host.setRules(intOf('lives'), intOf('hazard'), intOf('powerups') === 1);
    resetClock();
    host.start(randomSeed());
  }

  // takeover: { code, gen } cuando se toma el relevo de una sala cuyo anfitrión se ha ido.
  function createRoom(takeover) {
    if (busy) return;
    leave();
    setBusy(true, takeover ? 'Tomando el relevo de la sala ' + takeover.code + '…' : 'Creando sala…');
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
    }, takeover).then(
      function (l) {
        setBusy(false);
        mode = 'host';
        link = l;
        roomCode = l.code;
        roomGen = l.gen;
        if (takeover) toast('El anfitrión se ha ido: ahora la sala la llevas tú.', 6000);
        h = host = newHost(fakeLag ? fakeLag(l.send) : l.send, l.kick);
        pendingJoins.forEach(function (id) {
          h.join(id, performance.now());
        });
        host.setBots(intOf('lobby-bots'), intOf('lobby-level'));
        host.setRules(intOf('lobby-lives'), intOf('lobby-hazard'), intOf('lobby-powerups') === 1);
        resetClock();
        setHash(roomCode);
        syncUi();
      },
      function (err) {
        setBusy(false);
        if (takeover && err.taken) {
          // Otro jugador ha tomado el relevo antes: se le sigue.
          attemptJoin(takeover.code, { gen: takeover.gen, tries: 6 });
          return;
        }
        toast(err.message);
      }
    );
  }

  // Cuando desaparece el anfitrión: el primer invitado de la lista abre la sala de nuevo y
  // los demás le siguen. La ronda en curso se pierde, pero la sala continúa.
  function hostLost(c) {
    if (client !== c) return;
    const room = c.room;
    const code = roomCode;
    const gen = roomGen;
    leave();
    if (!room || room.me < 1) {
      toast('El anfitrión se ha desconectado: la partida ha terminado.', 5000);
    } else if (room.me === 1) {
      createRoom({ code: code, gen: gen + 1 });
    } else {
      toast('El anfitrión se ha ido. Buscando al nuevo anfitrión…', 6000);
      setBusy(true, 'Reconectando con la sala ' + code + '…');
      // Se le da un momento al nuevo anfitrión para abrir la sala.
      setTimeout(function () {
        attemptJoin(code, { gen: gen + 1, tries: 6 });
      }, 2500);
    }
  }

  function joinRoom() {
    if (busy) return;
    const code = Net.normalizeCode($('code').value);
    if (code.length !== Net.CODE_LEN) {
      toast('El código de sala tiene ' + Net.CODE_LEN + ' caracteres.');
      return;
    }
    leave();
    $('toast').classList.add('hidden');
    attemptJoin(code, null);
  }

  // follow: { gen, tries } al seguir a un anfitrión de relevo (se reintenta unas cuantas veces).
  function attemptJoin(code, follow) {
    setBusy(true, (follow ? 'Reconectando con la sala ' : 'Entrando en la sala ') + code + '…');
    let c = null;
    Net.join(code, {
      onMessage: function (msg) {
        if (c) c.receive(msg, performance.now());
      },
      onClose: function () {
        hostLost(c);
      },
    }, follow ? { gen: follow.gen } : null).then(
      function (l) {
        setBusy(false);
        mode = 'client';
        link = l;
        roomCode = code;
        roomGen = l.gen;
        if (follow) toast('Reconectado: la sala sigue con otro anfitrión.', 5000);
        c = client = Netcode.createClient({ name: playerName(), send: fakeLag ? fakeLag(l.send) : l.send });
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
        if (follow && follow.tries > 1) {
          setTimeout(function () {
            attemptJoin(code, { gen: follow.gen, tries: follow.tries - 1 });
          }, 2000);
          return;
        }
        setBusy(false);
        toast(follow ? 'No se ha podido encontrar al nuevo anfitrión: la sala se ha cerrado.' : err.message, 5000);
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
    roomGen = 1;
    resultsRound = -1;
    countdownShown = 0;
    statsOpen = false;
    paused = false;
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
      ? 'Uno crea la sala y pasa el código. Si el anfitrión se va, otro jugador toma el relevo.'
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
    if (client && client.bye) {
      const why = client.bye === 'full' ? 'La sala está llena (máximo ' + C.MAX_PLAYERS + ').'
        : 'El anfitrión usa otra versión del juego. Recargad los dos la página.';
      leave();
      toast(why, 5000);
      return;
    }
    if (client && client.lost) {
      hostLost(client);
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
    const rules = host ? rulesText(host.lives, host.hazard, host.powerups) : client && client.room ? rulesText(client.room.lives, client.room.hazard, client.room.power) : '';

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

    // Al registro, si el jugador ha participado en la ronda (no si solo miraba).
    let note = '';
    if (localIdx >= 0 && s.players[localIdx]) {
      const me = s.players[localIdx];
      const bots = meta.filter(function (m) {
        return m.kind === 'bot';
      });
      const entry = {
        d: Date.now(),
        o: mode === 'local' ? 0 : 1,
        n: meta.length,
        b: bots.length,
        lv: !bots.length ? '' : bots.every(function (m) { return m.level === bots[0].level; }) ? levelName(bots[0].level) : 'Mixto',
        l: host ? s.maxLives : client.room.lives,
        h: host ? s.hazard : client.room.hazard,
        p: host ? s.power : client.room.power,
        s: me.score,
        t: (me.alive ? s.tick : me.deathTick) / C.TICK_HZ,
        st: me.stars,
        r: Sim.ranking(s).indexOf(localIdx) + 1,
        w: !solo && s.winner === localIdx ? 1 : 0,
      };
      const before = Stats.summarize(sameMode(stats.all(), entry));
      stats.add(entry);
      if (!before.n) note = 'Primera partida en este modo (' + Stats.modeLabel(entry) + ').';
      else if (entry.s > before.best) note = '¡Nuevo récord en este modo! El anterior era ' + before.best + '.';
      else note = 'Tu récord en este modo: ' + before.best + ' · tu media: ' + Math.round(before.avg) + '.';
      if (solo && defaultRules(entry.l, entry.h, entry.p) && botsSoloText()) note += ' Media de los bots jugando solos: ' + botsSoloText() + '.';
    }
    if (solo) {
      $('over-title').textContent = 'Aguantaste ' + fmtTime(s.tick);
    } else {
      $('over-title').textContent = s.winner === localIdx ? '¡Has ganado!' : 'Gana ' + meta[s.winner].name;
    }
    if (mode === 'client') note += ' Esperando al anfitrión…';
    $('over-note').textContent = note;
    $('btn-again').classList.toggle('hidden', mode === 'client');
    $('btn-menu').textContent = mode === 'local' ? 'Menú' : mode === 'host' ? 'Volver a la sala' : 'Salir';
    show('gameover');
  }

  // Lo que hacen de media los bots jugando solos con las reglas de referencia.
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
    ['menu', 'lobby', 'gameover', 'stats', 'help'].forEach(function (k) {
      $(k).classList.toggle('hidden', k !== id);
    });
    if (id) $('touch-hint').classList.add('hidden');
    $('btn-exit').classList.toggle('hidden', id !== null); // solo durante la partida
  }

  // Ajustes elegidos ahora mismo en el menú, con la forma de una partida del registro.
  function menuMode() {
    const bots = levels.length ? intOf('bots') : 0;
    // Mixto con un solo bot es, en realidad, el nivel más difícil; adaptativo, el que toque.
    let lv = '';
    if (bots) {
      const first = botLevel(intOf('level'), 0);
      let same = true;
      for (let b = 1; b < bots; b++) if (botLevel(intOf('level'), b) !== first) same = false;
      lv = same ? levelName(first) : 'Mixto';
    }
    return { o: 0, n: bots + 1, b: bots, lv: lv, l: intOf('lives') || C.LIVES, h: intOf('hazard'), p: intOf('powerups') };
  }

  function sameMode(list, m) {
    const key = Stats.modeKey(m);
    return list.filter(function (g) {
      return Stats.modeKey(g) === key;
    });
  }

  // En el menú: cómo te ha ido con los ajustes que tienes elegidos.
  function updateRecord() {
    const m = menuMode();
    const sum = Stats.summarize(sameMode(stats.all(), m));
    let text = sum.n
      ? 'Con estos ajustes: récord ' + sum.best + ' · media ' + Math.round(sum.avg) + ' (' + sum.n + (sum.n === 1 ? ' partida' : ' partidas') + ').'
      : 'Aún no has jugado con estos ajustes.';
    if (m.b === 0 && defaultRules(m.l, m.h, m.p) && botsSoloText()) text += ' Bots solos: ' + botsSoloText() + '.';
    const chosen = levels[intOf('level')];
    if (m.b && chosen && chosen.kind === 'adaptive') text += ' Adaptativo: ahora te toca ' + levelName(adaptiveLevel()) + '.';
    $('record').textContent = text;
  }

  // ---------- Mis partidas ----------

  function statsFilter() {
    return { o: $('f-where').value, b: $('f-bots').value, lv: $('f-level').value, l: $('f-lives').value, h: $('f-hazard').value, p: $('f-power').value };
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const two = function (v) {
      return String(v).padStart(2, '0');
    };
    return two(d.getDate()) + '/' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = emptyText;
      return div;
    }
    const t = document.createElement('table');
    const head = t.createTHead().insertRow();
    headers.forEach(function (h, i) {
      const th = document.createElement('th');
      th.textContent = h;
      if (rows[0].cells[i].cls === 'mode') th.className = 'mode';
      head.appendChild(th);
    });
    const body = t.createTBody();
    rows.forEach(function (r) {
      const tr = body.insertRow();
      if (r.onPick) {
        tr.className = 'pick';
        tr.title = 'Ver solo las partidas de este modo';
        tr.addEventListener('click', r.onPick);
      }
      r.cells.forEach(function (c) {
        const td = tr.insertCell();
        td.textContent = c.text;
        if (c.cls) td.className = c.cls;
      });
    });
    return t;
  }

  function renderStats() {
    const all = stats.all();

    // Récords: una fila por modo jugado. Al pulsar una, los filtros se ponen en ese modo.
    const modes = Stats.modes(all);
    const modesBox = $('stats-modes');
    modesBox.innerHTML = '';
    modesBox.appendChild(
      table(
        ['Modo', 'Récord', 'Media', 'Partidas', 'Ganadas'],
        modes.map(function (m) {
          const g = m.sample;
          return {
            onPick: function () {
              $('f-where').value = String(g.o);
              $('f-bots').value = String(g.b);
              $('f-level').value = g.lv;
              $('f-lives').value = String(g.l);
              $('f-hazard').value = String(g.h);
              $('f-power').value = String(g.p);
              renderStats();
            },
            cells: [
              { text: Stats.modeLabel(g) },
              { text: String(m.best), cls: 'num' },
              { text: String(Math.round(m.avg)) },
              { text: String(m.n) },
              { text: m.rivals ? m.wins + ' de ' + m.rivals : '—' },
            ],
          };
        }),
        'Todavía no hay partidas. Juega una y aparecerá aquí.'
      )
    );

    // Lista filtrada y su resumen.
    const f = statsFilter();
    const list = all.filter(function (g) {
      return Stats.matches(g, f);
    });
    const sum = Stats.summarize(list);
    const summary = $('stats-summary');
    summary.innerHTML = '';
    if (!sum.n) {
      summary.textContent = all.length ? 'Ninguna partida con estos filtros.' : '';
    } else {
      const add = function (text, strong) {
        const el = document.createElement(strong ? 'b' : 'span');
        el.textContent = text;
        summary.appendChild(el);
      };
      add(sum.n + (sum.n === 1 ? ' partida' : ' partidas') + ' · media ');
      add(Math.round(sum.avg) + ' puntos', true);
      add(' · récord ');
      add(String(sum.best), true);
      add(' · ' + sum.avgSecs.toFixed(1) + ' s y ' + sum.avgStars.toFixed(1) + ' estrellas de media');
      if (sum.rivals) add(' · ganadas ' + sum.wins + ' de ' + sum.rivals + ' con rivales');
    }

    const gamesBox = $('stats-games');
    gamesBox.innerHTML = '';
    gamesBox.appendChild(
      table(
        ['Fecha', 'Puntos', 'Tiempo', 'Estrellas', 'Puesto', 'Modo'],
        list
          .slice(-200)
          .reverse()
          .map(function (g) {
            return {
              cells: [
                { text: fmtDate(g.d) },
                { text: String(g.s), cls: 'num' },
                { text: g.t ? g.t.toFixed(1) + ' s' : '—' },
                { text: String(g.st) },
                { text: g.n > 1 ? g.r + 'º de ' + g.n : '—' },
                { text: Stats.modeLabel(g), cls: 'mode' },
              ],
            };
          }),
        all.length ? 'Prueba a quitar algún filtro.' : 'Aquí verás cada partida con sus puntos y sus ajustes.'
      )
    );
    $('btn-stats-clear').disabled = $('btn-stats-export').disabled = !all.length;
  }

  function openHelp() {
    if (mode || busy) return;
    statsOpen = true; // comparte con "Mis partidas" el estar encima del menú
    const list = $('help-powers');
    if (!list.children.length) {
      POWER_HELP.forEach(function (h, k) {
        const li = document.createElement('li');
        const icon = document.createElement('canvas');
        icon.width = icon.height = 60;
        Render.drawPowerIcon(icon, k);
        li.appendChild(icon);
        const text = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = h[0] + ': ';
        text.appendChild(name);
        text.appendChild(span('', h[1]));
        li.appendChild(text);
        list.appendChild(li);
      });
    }
    show('help');
  }

  function openStats() {
    if (mode || busy) return;
    statsOpen = true;
    const sel = $('f-level');
    const keep = sel.value;
    sel.innerHTML = '';
    // Niveles: los actuales y cualquiera que aparezca en partidas antiguas.
    const names = levels.map(function (lv) {
      return lv.name;
    });
    stats.all().forEach(function (g) {
      if (g.lv && names.indexOf(g.lv) < 0) names.push(g.lv);
    });
    [['', 'Todos']].concat(names.map(function (n) { return [n, n]; })).forEach(function (o) {
      const opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = names.indexOf(keep) >= 0 ? keep : '';
    renderStats();
    show('stats');
  }

  function closeStats() {
    statsOpen = false;
    updateRecord();
    show('menu');
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
    if (paused) return;
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
      banner: paused ? 'PAUSA · pulsa P para seguir' : client && client.silent ? 'Sin noticias del anfitrión: esperando…' : client && v.state && v.localIdx < 0 && client.phase === 'playing' ? 'Ronda en curso: entras en la siguiente' : '',
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
    $('powerups').value = $('lobby-powerups').value = store.get('powerups', '1');
    updateRecord();
    setBusy(false);

    $('btn-play').addEventListener('click', function () {
      Sfx.unlock();
      store.set('bots', $('bots').value);
      store.set('level', $('level').value);
      store.set('lives', $('lives').value);
      store.set('hazard', $('hazard').value);
      store.set('powerups', $('powerups').value);
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
      store.set('powerups', $('lobby-powerups').value);
      if (mode === 'host') host.setRules(intOf('lobby-lives'), intOf('lobby-hazard'), intOf('lobby-powerups') === 1);
    };
    $('lobby-lives').addEventListener('change', rulesChanged);
    $('lobby-hazard').addEventListener('change', rulesChanged);
    $('lobby-powerups').addEventListener('change', rulesChanged);
    $('btn-start').addEventListener('click', function () {
      Sfx.unlock();
      if (mode === 'host') host.start(randomSeed());
    });
    $('btn-leave').addEventListener('click', leave);
    $('btn-stats').addEventListener('click', openStats);
    $('btn-help').addEventListener('click', openHelp);
    $('btn-help-close').addEventListener('click', closeStats);
    $('btn-stats-close').addEventListener('click', closeStats);
    $('btn-stats-export').addEventListener('click', function () {
      // Descarga el registro completo como fichero; no sale del navegador.
      const blob = new Blob(['\ufeff' + Stats.toCsv(stats.all())], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'esquiva-partidas.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 1000);
    });
    $('btn-stats-clear').addEventListener('click', function () {
      if (window.confirm('¿Borrar todas tus partidas y récords guardados en este navegador? No se puede deshacer.')) {
        stats.clear();
        renderStats();
      }
    });
    ['f-where', 'f-bots', 'f-level', 'f-lives', 'f-hazard', 'f-power'].forEach(function (id) {
      $(id).addEventListener('change', renderStats);
    });
    ['bots', 'level', 'lives', 'hazard', 'powerups'].forEach(function (id) {
      $(id).addEventListener('change', updateRecord);
    });
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
      } else if (e.code === 'KeyP' && !typing) {
        // Pausa: solo jugando en este ordenador (en una sala hay más gente esperando).
        const ph = phase();
        if (mode === 'local' && (ph === 'playing' || ph === 'countdown')) paused = !paused;
      } else if (e.code === 'Enter') {
        const ph = phase();
        if (ph === 'over' && mode !== 'client') $('btn-again').click();
        else if (ph === 'lobby' && mode === 'host') $('btn-start').click();
        else if (ph === 'menu' && !busy && !statsOpen) $('btn-play').click();
      } else if (e.code === 'Escape') {
        if (statsOpen) closeStats();
        else if (mode) leave();
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
    gen: function () {
      return roomGen;
    },
    levels: function () {
      return levels;
    },
    games: function () {
      return stats.all();
    },
    paused: function () {
      return paused;
    },
  };

  boot();
})();
