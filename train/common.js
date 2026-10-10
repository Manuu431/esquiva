// Piezas comunes del entrenamiento: PRNG, episodios sin pantalla y jugadores de referencia.
'use strict';
const Sim = require('../js/sim.js');
const NN = require('../js/nn.js');
const C = Sim.C;

// PRNG con semilla para que un entrenamiento se pueda repetir exactamente.
function makeRng(seed) {
  const st = { rng: seed | 0 || 1 };
  const next = function () {
    return Sim.rand(st);
  };
  let spare = null;
  next.gauss = function () {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * next();
    spare = r * Math.sin(a);
    return r * Math.cos(a);
  };
  next.int = function (n) {
    return Math.floor(next() * n);
  };
  next.state = function () {
    return st.rng;
  };
  return next;
}

// Juega una partida en solitario sin pantalla. controller(state, idx) -> { mx, my }.
// rules: { lives, hazard } opcional (por defecto, 3 vidas y proyectiles normales).
function playEpisode(controller, seed, maxTicks, rules) {
  const r = rules || {};
  const s = Sim.createState({ seed: seed, numPlayers: 1, lives: r.lives, hazard: r.hazard });
  const inputs = [null];
  while (!s.over && s.tick < maxTicks) {
    inputs[0] = controller(s, 0);
    Sim.step(s, inputs);
  }
  const p = s.players[0];
  return { score: p.score, ticks: s.tick, stars: p.stars, survived: !s.over };
}

// Media de varias partidas, una por semilla. makeController() crea un jugador nuevo por partida
// (los que tienen memoria, como los de tiempo de reacción, empiezan limpios).
// rulesFor(i): reglas de la partida i (opcional).
function evaluate(makeController, seeds, maxTicks, rulesFor) {
  let score = 0;
  let ticks = 0;
  let stars = 0;
  let survived = 0;
  for (let i = 0; i < seeds.length; i++) {
    const r = playEpisode(makeController(), seeds[i], maxTicks, rulesFor ? rulesFor(i) : null);
    score += r.score;
    ticks += r.ticks;
    stars += r.stars;
    if (r.survived) survived++;
  }
  const n = seeds.length;
  return { score: score / n, secs: ticks / n / C.TICK_HZ, stars: stars / n, survived: survived / n };
}

function brainController(weights, delay) {
  return function () {
    const brain = NN.createBrain(weights, { delay: delay || 0 });
    return brain.act;
  };
}

// ---------- Jugadores de referencia (no aprenden) ----------

function idle() {
  const a = { mx: 0, my: 0 };
  return function () {
    return a;
  };
}

function randomWalk(seed) {
  return function () {
    const rng = makeRng(seed || 7);
    const a = { mx: 0, my: 0 };
    return function (s) {
      if (s.tick % 20 === 1) {
        a.mx = rng.int(3) - 1;
        a.my = rng.int(3) - 1;
      }
      return a;
    };
  };
}

const MOVES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Planificador escrito a mano: prueba los 9 movimientos, proyecta medio segundo hacia delante
// con los proyectiles en línea recta y elige el de menor riesgo, tirando hacia la estrella.
// Ve TODA la arena con precisión perfecta, cosa que ni la red ni un humano tienen.
//   opts.delay: ticks de tiempo de reacción (actúa con lo que decidió hace `delay` ticks)
//   opts.every: cada cuántos ticks se replantea la decisión
function planner(opts) {
  const o = opts || {};
  const delay = o.delay || 0;
  const every = o.every || 1;
  const horizon = o.horizon || 30;
  return function () {
    const queue = [];
    const cur = { mx: 0, my: 0 };
    const out = { mx: 0, my: 0 };
    return function (s, idx) {
      if ((s.tick % every) === 0) decide(s, idx, horizon, cur);
      if (delay === 0) return cur;
      queue.push(cur.mx, cur.my);
      if (queue.length > delay * 2) {
        out.mx = queue.shift();
        out.my = queue.shift();
      } else {
        out.mx = out.my = 0;
      }
      return out;
    };
  };
}

function decide(s, idx, horizon, out) {
  const p = s.players[idx];
  const hz = s.hazards;
  let bestCost = Infinity;
  let best = 0;
  for (let m = 0; m < MOVES.length; m++) {
    const mx = MOVES[m][0];
    const my = MOVES[m][1];
    const k = C.PLAYER_SPEED * C.DT * (mx && my ? Math.SQRT1_2 : 1);
    let x = p.x;
    let y = p.y;
    let cost = 0;
    for (let t = 1; t <= horizon; t++) {
      x = Math.max(C.PLAYER_R, Math.min(C.W - C.PLAYER_R, x + mx * k));
      y = Math.max(C.PLAYER_R, Math.min(C.H - C.PLAYER_R, y + my * k));
      const ft = t * C.DT;
      for (let h = 0; h < hz.length; h++) {
        const z = hz[h];
        const dx = z.x + z.vx * ft - x;
        const dy = z.y + z.vy * ft - y;
        const gap = Math.sqrt(dx * dx + dy * dy) - z.r - C.PLAYER_R;
        if (gap < 0) cost += p.inv > t ? 0 : 1000 / t;
        else if (gap < 14) cost += ((14 - gap) * 3) / t;
      }
    }
    // Las paredes quitan salidas; la estrella atrae.
    const wall = Math.min(x, C.W - x, y, C.H - y);
    if (wall < 60) cost += (60 - wall) * 0.15;
    let near = Infinity;
    for (let k = 0; k < s.stars.length; k++) {
      const sx = s.stars[k].x - x;
      const sy = s.stars[k].y - y;
      const sd = Math.sqrt(sx * sx + sy * sy);
      if (sd < near) near = sd;
    }
    cost += near * 0.02;
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  out.mx = MOVES[best][0];
  out.my = MOVES[best][1];
}

function seedList(base, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(base + i * 7919);
  return out;
}

module.exports = {
  makeRng: makeRng,
  playEpisode: playEpisode,
  evaluate: evaluate,
  brainController: brainController,
  idle: function () {
    return idle;
  },
  randomWalk: randomWalk,
  planner: planner,
  seedList: seedList,
};

// ---------- Varios bots en la misma arena ----------

// Juega una ronda con varios jugadores. makers[i]() crea el controlador del puesto i.
// Devuelve, por puesto, { score, ticks, stars } y quién ganó.
function playArena(makers, seed, maxTicks, rules) {
  const r = rules || {};
  const n = makers.length;
  const s = Sim.createState({ seed: seed, numPlayers: n, lives: r.lives, hazard: r.hazard });
  const ctl = makers.map(function (m) {
    return m();
  });
  const inputs = [];
  while (!s.over && s.tick < maxTicks) {
    for (let i = 0; i < n; i++) inputs[i] = s.players[i].alive ? ctl[i](s, i) : null;
    Sim.step(s, inputs);
  }
  return {
    winner: s.over ? s.winner : Sim.ranking(s)[0],
    ticks: s.tick,
    players: s.players.map(function (p) {
      return { score: p.score, ticks: p.alive ? s.tick : p.deathTick, stars: p.stars };
    }),
  };
}

module.exports.playArena = playArena;
