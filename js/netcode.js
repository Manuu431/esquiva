// netcode.js — reglas de sala y sincronización, sin DOM y sin PeerJS (el transporte se inyecta).
// Así se puede probar en Node con una red simulada con retraso.
//
// Modelo: el anfitrión es la autoridad. Ejecuta sim.js y envía instantáneas 20 veces por
// segundo. Cada invitado envía su dirección en cada tick y, para no notar el retraso:
//   1. predice su propio movimiento en local y lo corrige con lo que confirma el anfitrión;
//   2. dibuja los proyectiles ADELANTADOS un viaje de ida y vuelta (van en línea recta, así
//      que se pueden extrapolar exactamente): ve la arena tal como estará en el anfitrión
//      cuando llegue la tecla que pulsa ahora. Lo que esquiva en su pantalla, lo esquiva de verdad.
// Los mensajes llevan contador porque el canal no garantiza el orden de llegada.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.Netcode = factory(root.Sim);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Sim) {
  'use strict';

  const C = Sim.C;
  const PROTOCOL = 1;
  const STEP_MS = 1000 / C.TICK_HZ;
  const SNAP_EVERY = 3; // ticks entre instantáneas (20 por segundo)
  const COUNTDOWN_TICKS = 3 * C.TICK_HZ;
  const HEARTBEAT_TICKS = C.TICK_HZ; // el anfitrión repite el estado de la sala cada segundo
  const CLIENT_TIMEOUT_MS = 8000; // sin noticias de un invitado: fuera
  const HOST_TIMEOUT_MS = 6000; // sin noticias del anfitrión: partida perdida
  const PING_MS = 500;
  const MAX_EXTRAP_TICKS = 30; // si dejan de llegar instantáneas no se extrapola más de 0,5 s
  const P_FIELDS = 10;
  const H_FIELDS = 5;
  const EVENT_TYPES = ['hit', 'dead', 'star', 'over'];

  function r10(v) {
    return Math.round(v * 10);
  }

  function cleanName(name) {
    const s = String(name === undefined || name === null ? '' : name)
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, 12);
    return s || 'Jugador';
  }

  // ---------- Instantáneas ----------

  function encodeSnapshot(s, round, events) {
    const p = [];
    for (let i = 0; i < s.players.length; i++) {
      const q = s.players[i];
      p.push(r10(q.x), r10(q.y), q.mx, q.my, q.lives, q.inv, q.alive ? 1 : 0, q.score, q.stars, q.deathTick);
    }
    const h = [];
    for (let i = 0; i < s.hazards.length; i++) {
      const z = s.hazards[i];
      h.push(r10(z.x), r10(z.y), r10(z.vx), r10(z.vy), r10(z.r));
    }
    const e = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      e.push(EVENT_TYPES.indexOf(ev.type), ev.p, Math.round(ev.x), Math.round(ev.y));
    }
    return { t: 's', r: round, k: s.tick, o: s.over ? 1 : 0, w: s.winner, p: p, h: h, s: [r10(s.star.x), r10(s.star.y)], e: e, a: -1 };
  }

  // Devuelve un objeto con la misma forma que el estado de sim.js (lo justo para dibujar).
  function decodeSnapshot(m) {
    const players = [];
    for (let i = 0; i + P_FIELDS <= m.p.length; i += P_FIELDS) {
      players.push({
        x: m.p[i] / 10,
        y: m.p[i + 1] / 10,
        mx: m.p[i + 2],
        my: m.p[i + 3],
        lives: m.p[i + 4],
        inv: m.p[i + 5],
        alive: m.p[i + 6] === 1,
        score: m.p[i + 7],
        stars: m.p[i + 8],
        deathTick: m.p[i + 9],
      });
    }
    const hazards = [];
    for (let i = 0; i + H_FIELDS <= m.h.length; i += H_FIELDS) {
      hazards.push({ x: m.h[i] / 10, y: m.h[i + 1] / 10, vx: m.h[i + 2] / 10, vy: m.h[i + 3] / 10, r: m.h[i + 4] / 10 });
    }
    return {
      tick: m.k,
      over: m.o === 1,
      winner: m.w,
      numPlayers: players.length,
      players: players,
      hazards: hazards,
      star: { x: m.s[0] / 10, y: m.s[1] / 10 },
    };
  }

  function decodeEvents(e) {
    const out = [];
    for (let i = 0; i + 4 <= e.length; i += 4) out.push({ type: EVENT_TYPES[e[i]], p: e[i + 1], x: e[i + 2], y: e[i + 3] });
    return out;
  }

  // ---------- Anfitrión ----------
  // o.send(clientId, msg), o.kick(clientId) opcional, o.makeBot(level) -> controller(state, idx),
  // o.name: nombre del anfitrión. Una partida local es un anfitrión sin invitados.
  function createHost(o) {
    const clients = new Map(); // id -> { member, input, heard, slot }
    const botWins = [];
    let controllers = [];
    let pendingEvents = [];
    let roomSeq = 0;
    let ticks = 0;
    let localInput = null;

    const host = {
      phase: 'lobby', // lobby | countdown | playing | over
      round: 0,
      bots: 0,
      level: 0,
      members: [{ id: null, name: cleanName(o.name), wins: 0 }], // id null = el anfitrión
      roster: [], // quién juega la ronda en curso: { name, kind, level, wins }
      state: null,
      localIdx: 0,
      countdown: 0,
      onChange: null,
      onEvents: null,
    };

    function changed() {
      broadcastRoom();
      if (host.onChange) host.onChange();
    }

    function roomFor(c) {
      return {
        t: 'room',
        q: roomSeq,
        phase: host.phase,
        round: host.round,
        cd: host.countdown,
        bots: host.bots,
        level: host.level,
        members: host.members.map(function (m) {
          return { name: m.name, wins: m.wins, host: m.id === null };
        }),
        roster: host.roster.map(function (r) {
          return { name: r.name, kind: r.kind, level: r.level, wins: r.wins };
        }),
        you: c.slot,
        me: host.members.indexOf(c.member),
      };
    }

    function broadcastRoom() {
      roomSeq++;
      clients.forEach(function (c, id) {
        if (c.member) o.send(id, roomFor(c));
      });
    }

    function sendSnapshot() {
      const snap = encodeSnapshot(host.state, host.round, pendingEvents);
      pendingEvents = [];
      clients.forEach(function (c, id) {
        if (!c.member) return;
        snap.a = c.input.n;
        o.send(id, snap);
      });
    }

    host.join = function (id, now) {
      clients.set(id, { member: null, input: { n: -1, mx: 0, my: 0 }, heard: now, slot: -1 });
    };

    host.leave = function (id) {
      const c = clients.get(id);
      if (!c) return;
      clients.delete(id);
      if (!c.member) return;
      host.members.splice(host.members.indexOf(c.member), 1);
      if (c.slot >= 0 && host.state && (host.phase === 'playing' || host.phase === 'countdown')) {
        Sim.eliminate(host.state, c.slot);
      }
      changed();
    };

    host.receive = function (id, msg, now) {
      const c = clients.get(id);
      if (!c || !msg || typeof msg !== 'object') return;
      c.heard = now;
      if (msg.t === 'i') {
        const n = msg.n | 0;
        if (c.slot >= 0 && msg.r === host.round && n > c.input.n) {
          c.input.n = n;
          c.input.mx = msg.mx | 0;
          c.input.my = msg.my | 0;
        }
      } else if (msg.t === 'ping') {
        o.send(id, { t: 'pong', ts: msg.ts });
      } else if (msg.t === 'hello' && !c.member) {
        if (msg.v !== PROTOCOL) return reject(id, 'version');
        if (host.members.length >= C.MAX_PLAYERS) return reject(id, 'full');
        c.member = { id: id, name: cleanName(msg.name), wins: 0 };
        host.members.push(c.member);
        changed();
        // Quien entra con la ronda empezada la ve como espectador hasta la siguiente.
        if (host.state && host.phase !== 'lobby') {
          const snap = encodeSnapshot(host.state, host.round, []);
          o.send(id, snap);
        }
      }
    };

    function reject(id, reason) {
      o.send(id, { t: 'bye', reason: reason });
      clients.delete(id);
      if (o.kick) o.kick(id);
    }

    host.setBots = function (n, level) {
      host.bots = Math.max(0, Math.min(C.MAX_PLAYERS - 1, n | 0));
      host.level = level | 0;
      changed();
    };

    host.canStart = function () {
      return host.phase === 'lobby' || host.phase === 'over';
    };

    host.start = function (seed) {
      if (!host.canStart()) return false;
      const roster = [];
      controllers = [];
      clients.forEach(function (c) {
        c.slot = -1;
        c.input.n = -1;
        c.input.mx = c.input.my = 0;
      });
      host.members.slice(0, C.MAX_PLAYERS).forEach(function (m, i) {
        roster.push({ name: m.name, kind: m.id === null ? 'human' : 'remote', level: 0, wins: m.wins, member: m });
        if (m.id === null) {
          host.localIdx = i;
          controllers.push(function () {
            return localInput;
          });
        } else {
          const c = clients.get(m.id);
          c.slot = i;
          controllers.push(function () {
            return c.input;
          });
        }
      });
      for (let b = 0; b < host.bots && roster.length < C.MAX_PLAYERS; b++) {
        const ctl = o.makeBot ? o.makeBot(host.level, b) : null;
        if (!ctl) break;
        roster.push({ name: (o.botNames && o.botNames[b]) || 'Bot ' + (b + 1), kind: 'bot', level: host.level, wins: botWins[b] || 0, bot: b });
        controllers.push(ctl);
      }
      host.roster = roster;
      host.round++;
      host.state = Sim.createState({ seed: seed, numPlayers: roster.length });
      host.phase = 'countdown';
      host.countdown = COUNTDOWN_TICKS;
      pendingEvents = [];
      changed();
      sendSnapshot();
      return true;
    };

    host.toLobby = function () {
      host.phase = 'lobby';
      host.state = null;
      host.roster = [];
      clients.forEach(function (c) {
        c.slot = -1;
      });
      changed();
    };

    const inputs = [];

    // Un tick de 1/60 s. input = dirección del jugador local.
    host.tick = function (input, now) {
      ticks++;
      localInput = input;
      clients.forEach(function (c, id) {
        if (now - c.heard > CLIENT_TIMEOUT_MS) {
          host.leave(id);
          if (o.kick) o.kick(id);
        }
      });

      if (host.phase === 'countdown') {
        if (--host.countdown <= 0) {
          host.phase = 'playing';
          changed();
        }
      } else if (host.phase === 'playing') {
        const s = host.state;
        for (let i = 0; i < controllers.length; i++) inputs[i] = s.players[i].alive ? controllers[i](s, i) : null;
        inputs.length = controllers.length;
        Sim.step(s, inputs);
        for (let i = 0; i < s.events.length; i++) pendingEvents.push(s.events[i]);
        if (host.onEvents && s.events.length) host.onEvents(s.events);
        if (s.over) {
          host.phase = 'over';
          if (host.roster.length > 1 && s.winner >= 0) {
            const w = host.roster[s.winner];
            w.wins++;
            if (w.member) w.member.wins = w.wins;
            else botWins[w.bot] = w.wins;
          }
          sendSnapshot();
          changed();
        } else if (s.tick % SNAP_EVERY === 0) {
          sendSnapshot();
        }
      }
      if (ticks % HEARTBEAT_TICKS === 0) broadcastRoom();
    };

    host.clientCount = function () {
      return clients.size;
    };

    return host;
  }

  // ---------- Invitado ----------
  // o.send(msg), o.name
  function createClient(o) {
    let lastQ = 0;
    let round = 0;
    let snap = null;
    let est = -Infinity; // tick del anfitrión en el instante local 0, visto por el paquete más rápido
    let rtt = -1;
    let n = 0;
    let pending = [];
    const pred = { x: 0, y: 0, mx: 0, my: 0 };
    const off = { x: 0, y: 0 }; // corrección visual pendiente de absorber
    let shown = []; // posiciones suavizadas de los demás
    let predReady = false;
    let lastHeard = -1;
    let lastPing = -Infinity;
    let lastTickMs = 0;
    let cdEnd = 0;
    const view = { state: null, meta: [], localIdx: -1, countdown: 0, hazExt: 0, plExt: 0 };
    const viewState = { tick: 0, over: false, winner: -1, numPlayers: 0, players: [], hazards: [], star: { x: 0, y: 0 } };

    const client = {
      phase: 'connecting', // connecting | lobby | countdown | playing | over
      room: null,
      rtt: 0,
      lost: false,
      bye: null,
      onChange: null,
      onEvents: null,
    };

    function you() {
      return client.room && client.room.round === round ? client.room.you : -1;
    }

    function resetRound(r) {
      round = r;
      snap = null;
      est = -Infinity;
      n = 0;
      pending = [];
      off.x = off.y = 0;
      shown = [];
      predReady = false;
    }

    client.hello = function (now) {
      lastHeard = now;
      o.send({ t: 'hello', v: PROTOCOL, name: cleanName(o.name) });
    };

    client.receive = function (msg, now) {
      if (!msg || typeof msg !== 'object') return;
      lastHeard = now;
      if (msg.t === 's') onSnapshot(msg, now);
      else if (msg.t === 'room') onRoom(msg, now);
      else if (msg.t === 'ping') o.send({ t: 'pong', ts: msg.ts });
      else if (msg.t === 'pong') {
        const sample = now - msg.ts;
        // Se sigue el mínimo reciente: los picos de un paquete lento no deben mover la arena.
        rtt = rtt < 0 || sample < rtt ? sample : rtt + (sample - rtt) * 0.1;
        client.rtt = rtt;
      } else if (msg.t === 'bye') {
        client.bye = msg.reason;
        if (client.onChange) client.onChange();
      }
    };

    function onRoom(msg, now) {
      if (msg.q <= lastQ) return;
      lastQ = msg.q;
      if (msg.round > round) resetRound(msg.round);
      client.room = msg;
      client.phase = msg.phase;
      cdEnd = now + msg.cd * STEP_MS;
      if (client.onChange) client.onChange();
    }

    function onSnapshot(msg, now) {
      if (msg.r < round) return;
      if (msg.r > round) resetRound(msg.r);
      if (client.onEvents && msg.e.length) client.onEvents(decodeEvents(msg.e));
      if (snap && msg.k <= snap.tick) return; // llegó desordenada: ya hay una más reciente
      const first = !snap;
      snap = decodeSnapshot(msg);

      // Reloj del anfitrión: manda el paquete más rápido visto; se deja caer muy despacio para
      // adaptarse si la conexión empeora, y se resincroniza de golpe si el anfitrión se paró
      // (cuenta atrás, pestaña congelada...).
      const c = msg.k - now / STEP_MS;
      est = c > est || c < est - 10 ? c : est - 0.02;

      const me = you();
      if (me >= 0 && snap.players[me]) {
        // Reconciliación: se parte de la posición confirmada por el anfitrión y se vuelven a
        // aplicar las pulsaciones que él todavía no había recibido al hacer la instantánea.
        const sp = snap.players[me];
        const ox = pred.x;
        const oy = pred.y;
        pred.x = sp.x;
        pred.y = sp.y;
        let keep = 0;
        for (let i = 0; i < pending.length; i++) {
          const inp = pending[i];
          if (inp.n <= msg.a) continue;
          pending[keep++] = inp;
          if (sp.alive) Sim.movePlayer(pred, inp.mx, inp.my);
        }
        pending.length = keep;
        if (!predReady) {
          predReady = true;
          off.x = off.y = 0;
        } else {
          off.x += ox - pred.x;
          off.y += oy - pred.y;
          if (off.x * off.x + off.y * off.y > 80 * 80) off.x = off.y = 0;
        }
      }
      if (first) {
        shown = snap.players.map(function (p) {
          return { x: p.x, y: p.y };
        });
      }
    }

    // Ticks que hay que adelantar la última instantánea para dibujar "el presente del anfitrión
    // cuando llegue mi tecla": lo que tardó en llegar + el viaje de vuelta.
    function aheadTicks(now) {
      if (!snap || snap.over || client.phase !== 'playing') return 0;
      const display = est + now / STEP_MS + Math.max(0, rtt) / STEP_MS;
      const d = display - snap.tick;
      return d < 0 ? 0 : d > MAX_EXTRAP_TICKS ? MAX_EXTRAP_TICKS : d;
    }

    // Un tick de 1/60 s. input = dirección que pulsa el jugador.
    client.tick = function (input, now) {
      lastTickMs = now;
      if (now - lastPing >= PING_MS) {
        lastPing = now;
        o.send({ t: 'ping', ts: now });
      }
      if (!client.lost && lastHeard >= 0 && now - lastHeard > HOST_TIMEOUT_MS) {
        client.lost = true;
        if (client.onChange) client.onChange();
      }
      if (!snap) return;

      const me = you();
      const mine = me >= 0 ? snap.players[me] : null;
      if (mine && mine.alive && client.phase === 'playing' && !snap.over) {
        n++;
        const inp = { n: n, mx: input.mx, my: input.my };
        pending.push(inp);
        if (pending.length > 120) pending.shift();
        Sim.movePlayer(pred, inp.mx, inp.my);
        o.send({ t: 'i', r: round, n: n, mx: inp.mx, my: inp.my });
      } else {
        pred.mx = pred.my = 0;
      }
      off.x *= 0.85;
      off.y *= 0.85;

      // Los demás jugadores: última posición conocida, un poco extrapolada y suavizada.
      const ahead = Math.min(6, aheadTicks(now));
      for (let i = 0; i < snap.players.length; i++) {
        if (i === me) continue;
        const p = snap.players[i];
        const k = p.alive ? C.PLAYER_SPEED * C.DT * ahead * (p.mx && p.my ? Math.SQRT1_2 : 1) : 0;
        const tx = Math.max(C.PLAYER_R, Math.min(C.W - C.PLAYER_R, p.x + p.mx * k));
        const ty = Math.max(C.PLAYER_R, Math.min(C.H - C.PLAYER_R, p.y + p.my * k));
        const sh = shown[i] || (shown[i] = { x: tx, y: ty });
        sh.x += (tx - sh.x) * 0.4;
        sh.y += (ty - sh.y) * 0.4;
      }
    };

    // Lo que hay que dibujar en el instante `now`. Devuelve siempre el mismo objeto.
    client.view = function (now) {
      view.meta = client.room ? client.room.roster : [];
      view.localIdx = you();
      view.countdown = client.phase === 'countdown' ? Math.max(1, Math.ceil((cdEnd - now) / 1000)) : 0;
      if (!snap) {
        view.state = null;
        return view;
      }
      const ahead = aheadTicks(now);
      view.hazExt = ahead * C.DT;
      view.plExt = 0;
      viewState.tick = snap.tick + Math.floor(ahead);
      viewState.over = snap.over;
      viewState.winner = snap.winner;
      viewState.numPlayers = snap.numPlayers;
      viewState.hazards = snap.hazards;
      viewState.star = snap.star;
      viewState.players.length = snap.players.length;
      const me = view.localIdx;
      for (let i = 0; i < snap.players.length; i++) {
        const p = snap.players[i];
        const d = viewState.players[i] || (viewState.players[i] = {});
        d.lives = p.lives;
        d.inv = p.inv;
        d.alive = p.alive;
        d.score = p.score;
        d.stars = p.stars;
        d.deathTick = p.deathTick;
        if (i === me && p.alive && client.phase === 'playing') {
          // Propio: predicción + fracción de tick transcurrida, para que no dé tirones.
          const frac = Math.min(1, Math.max(0, (now - lastTickMs) / STEP_MS));
          const k = C.PLAYER_SPEED * C.DT * frac * (pred.mx && pred.my ? Math.SQRT1_2 : 1);
          d.x = Math.max(C.PLAYER_R, Math.min(C.W - C.PLAYER_R, pred.x + off.x + pred.mx * k));
          d.y = Math.max(C.PLAYER_R, Math.min(C.H - C.PLAYER_R, pred.y + off.y + pred.my * k));
          d.mx = pred.mx;
          d.my = pred.my;
        } else {
          const sh = p.alive && shown[i] ? shown[i] : p;
          d.x = sh.x;
          d.y = sh.y;
          d.mx = p.mx;
          d.my = p.my;
        }
      }
      view.state = viewState;
      return view;
    };

    // Estado final de la ronda tal como lo envió el anfitrión (para la tabla de resultados).
    client.snapshot = function () {
      return snap;
    };

    return client;
  }

  return {
    PROTOCOL: PROTOCOL,
    STEP_MS: STEP_MS,
    SNAP_EVERY: SNAP_EVERY,
    COUNTDOWN_TICKS: COUNTDOWN_TICKS,
    HOST_TIMEOUT_MS: HOST_TIMEOUT_MS,
    CLIENT_TIMEOUT_MS: CLIENT_TIMEOUT_MS,
    cleanName: cleanName,
    encodeSnapshot: encodeSnapshot,
    decodeSnapshot: decodeSnapshot,
    createHost: createHost,
    createClient: createClient,
  };
});
