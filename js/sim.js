// sim.js — lógica pura de "Esquiva". Sin DOM, sin reloj, sin Math.random.
// Mismo fichero en Node (require) y en el navegador (window.Sim).
// Todo el estado vive en un objeto plano; step() lo avanza un tick fijo de 1/60 s.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = Object.freeze({
    W: 800,
    H: 600,
    TICK_HZ: 60,
    DT: 1 / 60,
    MAX_PLAYERS: 6,

    PLAYER_R: 11,
    PLAYER_SPEED: 260, // px/s
    LIVES: 3,
    INVULN_TICKS: 90, // 1,5 s de gracia tras un impacto

    HAZ_R_MIN: 7,
    HAZ_R_MAX: 14,
    HAZ_SPEED0: 140, // px/s al empezar
    HAZ_SPEED_GROW: 3, // px/s ganados por segundo de ronda
    HAZ_SPEED_MAX: 520,
    HIT_FORGIVE: 0.85, // el radio de impacto es algo menor que el dibujado

    SPAWN_GRACE: 1.0, // s sin proyectiles al empezar
    SPAWN_INTERVAL0: 0.9, // s entre proyectiles al empezar
    SPAWN_HALVING: 18, // cada tantos s el ritmo sube en una unidad: i0 / (1 + t/18 + ...)
    SPAWN_RUSH: 60, // "muerte súbita": a partir de ~1 min el ritmo crece además con (t/60)^3
    SPAWN_INTERVAL_MIN: 0.02,
    SPAWN_SAFE_DIST: 150, // un proyectil no nace a menos de esto de un jugador
    AIM_AT_PLAYER: 0.6, // probabilidad de apuntar a un jugador (si no, a un punto al azar)
    AIM_NOISE: 70,
    OUT_MARGIN: 40,

    STAR_R: 10,
    STAR_POINTS: 300, // un tick vivo = 1 punto; una estrella = 5 s
    STAR_MARGIN: 50,
    STAR_RESPAWN_DIST: 180,
  });

  const INV_SQRT2 = Math.SQRT1_2;

  // PRNG mulberry32 con el estado guardado en state.rng (entero de 32 bits).
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function hazardSpeed(t) {
    return Math.min(C.HAZ_SPEED_MAX, C.HAZ_SPEED0 + C.HAZ_SPEED_GROW * t);
  }

  function spawnInterval(t) {
    // El término cúbico garantiza que ninguna ronda dure para siempre, por bueno que sea quien juegue.
    const rush = t / C.SPAWN_RUSH;
    return Math.max(C.SPAWN_INTERVAL_MIN, C.SPAWN_INTERVAL0 / (1 + t / C.SPAWN_HALVING + rush * rush * rush));
  }

  function createState(opts) {
    const o = opts || {};
    const n = Math.max(1, Math.min(C.MAX_PLAYERS, o.numPlayers | 0 || 1));
    const s = {
      tick: 0,
      rng: (o.seed | 0) || 1,
      numPlayers: n,
      players: [],
      hazards: [],
      star: { x: 0, y: 0 },
      spawnTimer: C.SPAWN_GRACE,
      over: false,
      winner: -1,
      events: [],
    };
    for (let i = 0; i < n; i++) {
      // Un jugador solo empieza en el centro; varios, repartidos en un círculo.
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rad = n === 1 ? 0 : 130;
      s.players.push({
        x: C.W / 2 + Math.cos(a) * rad,
        y: C.H / 2 + Math.sin(a) * rad,
        mx: 0,
        my: 0,
        lives: C.LIVES,
        inv: 0,
        alive: true,
        score: 0,
        stars: 0,
        deathTick: -1,
      });
    }
    placeStar(s, -1);
    return s;
  }

  function placeStar(s, avoidIdx) {
    const m = C.STAR_MARGIN;
    const avoid = avoidIdx >= 0 ? s.players[avoidIdx] : null;
    const min2 = C.STAR_RESPAWN_DIST * C.STAR_RESPAWN_DIST;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = m + rand(s) * (C.W - 2 * m);
      y = m + rand(s) * (C.H - 2 * m);
      if (!avoid) break;
      const dx = x - avoid.x;
      const dy = y - avoid.y;
      if (dx * dx + dy * dy >= min2) break;
    }
    s.star.x = x;
    s.star.y = y;
  }

  // Punto del perímetro (justo fuera de la arena) para una fracción u en [0,1).
  function perimeterPoint(u, r, out) {
    const per = 2 * (C.W + C.H);
    let d = u * per;
    if (d < C.W) {
      out.x = d;
      out.y = -r;
    } else if ((d -= C.W) < C.H) {
      out.x = C.W + r;
      out.y = d;
    } else if ((d -= C.H) < C.W) {
      out.x = C.W - d;
      out.y = C.H + r;
    } else {
      out.x = -r;
      out.y = C.H - (d - C.W);
    }
  }

  const _pt = { x: 0, y: 0 };

  function spawnHazard(s, t) {
    const sizeU = rand(s);
    const r = C.HAZ_R_MIN + sizeU * (C.HAZ_R_MAX - C.HAZ_R_MIN);
    const safe2 = C.SPAWN_SAFE_DIST * C.SPAWN_SAFE_DIST;
    // Hasta 4 intentos de nacer lejos de todos: nada de impactos sin aviso junto al borde.
    for (let tries = 0; tries < 4; tries++) {
      perimeterPoint(rand(s), r, _pt);
      let ok = true;
      for (let i = 0; i < s.players.length; i++) {
        const p = s.players[i];
        if (!p.alive) continue;
        const dx = p.x - _pt.x;
        const dy = p.y - _pt.y;
        if (dx * dx + dy * dy < safe2) {
          ok = false;
          break;
        }
      }
      if (ok) break;
    }
    let tx;
    let ty;
    const target = rand(s) < C.AIM_AT_PLAYER ? pickAlive(s) : null;
    if (target) {
      tx = target.x + (rand(s) * 2 - 1) * C.AIM_NOISE;
      ty = target.y + (rand(s) * 2 - 1) * C.AIM_NOISE;
    } else {
      tx = C.W * (0.15 + 0.7 * rand(s));
      ty = C.H * (0.15 + 0.7 * rand(s));
    }
    let dx = tx - _pt.x;
    let dy = ty - _pt.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    // Los grandes van algo más lentos que los pequeños.
    const speed = hazardSpeed(t) * (1.15 - 0.3 * sizeU) * (0.9 + 0.2 * rand(s));
    s.hazards.push({ x: _pt.x, y: _pt.y, vx: (dx / d) * speed, vy: (dy / d) * speed, r: r });
  }

  function pickAlive(s) {
    let n = 0;
    for (let i = 0; i < s.players.length; i++) if (s.players[i].alive) n++;
    if (n === 0) return null;
    let k = Math.floor(rand(s) * n);
    for (let i = 0; i < s.players.length; i++) {
      if (!s.players[i].alive) continue;
      if (k-- === 0) return s.players[i];
    }
    return null;
  }

  function sign(v) {
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  // Mueve a un jugador un tick. Separado de step() para que el cliente de red
  // pueda predecir su propio movimiento con exactamente la misma regla.
  function movePlayer(p, mx, my) {
    mx = sign(mx);
    my = sign(my);
    p.mx = mx;
    p.my = my;
    let k = C.PLAYER_SPEED * C.DT;
    if (mx !== 0 && my !== 0) k *= INV_SQRT2;
    const r = C.PLAYER_R;
    let x = p.x + mx * k;
    let y = p.y + my * k;
    p.x = x < r ? r : x > C.W - r ? C.W - r : x;
    p.y = y < r ? r : y > C.H - r ? C.H - r : y;
  }

  // inputs[i] = { mx, my } con valores en {-1, 0, 1}; puede faltar (se trata como quieto).
  function step(s, inputs) {
    if (s.over) return s;
    s.events.length = 0;
    s.tick++;
    const t = s.tick * C.DT;
    const players = s.players;
    const np = players.length;

    for (let i = 0; i < np; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const inp = inputs ? inputs[i] : null;
      movePlayer(p, inp ? inp.mx : 0, inp ? inp.my : 0);
      if (p.inv > 0) p.inv--;
      p.score++;
    }

    s.spawnTimer -= C.DT;
    while (s.spawnTimer <= 0) {
      spawnHazard(s, t);
      s.spawnTimer += spawnInterval(t);
    }

    const hz = s.hazards;
    const m = C.OUT_MARGIN;
    for (let h = hz.length - 1; h >= 0; h--) {
      const z = hz[h];
      z.x += z.vx * C.DT;
      z.y += z.vy * C.DT;
      let gone = z.x < -m || z.x > C.W + m || z.y < -m || z.y > C.H + m;
      if (!gone) {
        for (let i = 0; i < np; i++) {
          const p = players[i];
          if (!p.alive || p.inv > 0) continue;
          const dx = z.x - p.x;
          const dy = z.y - p.y;
          const rr = C.PLAYER_R + z.r * C.HIT_FORGIVE;
          if (dx * dx + dy * dy < rr * rr) {
            p.lives--;
            p.inv = C.INVULN_TICKS;
            s.events.push({ type: 'hit', p: i, x: p.x, y: p.y });
            if (p.lives <= 0) {
              p.alive = false;
              p.deathTick = s.tick;
              s.events.push({ type: 'dead', p: i, x: p.x, y: p.y });
            }
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        hz[h] = hz[hz.length - 1];
        hz.pop();
      }
    }

    // Estrella: si dos la tocan en el mismo tick, se la lleva el más cercano.
    const sr = C.PLAYER_R + C.STAR_R;
    let best = -1;
    let bestD = sr * sr;
    for (let i = 0; i < np; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const dx = p.x - s.star.x;
      const dy = p.y - s.star.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      const p = players[best];
      p.score += C.STAR_POINTS;
      p.stars++;
      s.events.push({ type: 'star', p: best, x: s.star.x, y: s.star.y });
      placeStar(s, best);
    }

    // Fin de ronda: en solitario al morir; con varios, cuando queda uno en pie (o ninguno).
    // Gana quien más puntos tiene: aguantar puntúa, pero las estrellas también.
    let alive = 0;
    for (let i = 0; i < np; i++) if (players[i].alive) alive++;
    if (alive <= (np === 1 ? 0 : 1)) {
      s.over = true;
      s.winner = ranking(s)[0];
      s.events.push({ type: 'over', p: s.winner, x: 0, y: 0 });
    }
    return s;
  }

  // Retira a un jugador de la ronda (se ha desconectado). El fin de ronda se decide en el
  // siguiente step(), igual que si hubiera caído jugando.
  function eliminate(s, idx) {
    const p = s.players[idx];
    if (!p || !p.alive || s.over) return;
    p.lives = 0;
    p.alive = false;
    p.deathTick = s.tick;
  }

  // Clasificación de la ronda: por puntos; a igualdad, quien sigue en pie o cayó más tarde.
  function ranking(s) {
    const idx = s.players.map(function (_, i) {
      return i;
    });
    idx.sort(function (a, b) {
      const p = s.players[a];
      const q = s.players[b];
      if (p.score !== q.score) return q.score - p.score;
      if (p.alive !== q.alive) return p.alive ? -1 : 1;
      return q.deathTick - p.deathTick;
    });
    return idx;
  }

  return {
    C: C,
    createState: createState,
    step: step,
    movePlayer: movePlayer,
    eliminate: eliminate,
    ranking: ranking,
    hazardSpeed: hazardSpeed,
    spawnInterval: spawnInterval,
    rand: rand,
  };
});
