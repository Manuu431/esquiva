// god.js — el bot "Modo Dios". No es una red neuronal: es un planificador. En cada decisión
// simula medio segundo largo de futuro para muchas secuencias de movimientos, sabiendo
// exactamente por dónde irá cada proyectil (rebotes incluidos), y se queda con la mejor.
// Ve toda la arena, no tiene tiempo de reacción y no se equivoca al calcular: lo único que le
// para es que al final de la ronda ya no queda hueco físico por el que pasar.
// Sin DOM: se usa igual en Node (para medirlo y ajustarlo) y en el navegador.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'), require('./nn.js'));
  else root.God = factory(root.Sim, root.NN);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Sim, NN) {
  'use strict';

  const C = Sim.C;
  const MOVES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const N_MOVES = MOVES.length;

  // Parámetros por defecto (ajustados con train/tune-god.js).
  const DEFAULTS = {
    horizon: 40, // ticks de futuro que simula
    turn: 6, // tick en el que cada secuencia puede cambiar de dirección
    hit: 4000, // coste de un impacto (dividido por lo pronto que ocurre)
    margin: 16, // px de holgura que intenta dejar con cada proyectil
    near: 3, // coste por px de holgura perdida
    wall: 0.2, // coste por px de cercanía a una pared (a menos de 60)
    target: 8, // lo que tira el objetivo: coste por px de distancia media hasta él en el horizonte
    selA: 7, // criterio de rivales (como en los bots de red)
    selB: 5,
    // Lo que vale cada mejora, en px de desvío: turbo, fantasma, escudo, corazón, bomba, doble, imán.
    powers: [140, 180, 260, 380, 120, 320, 220],
  };

  function createBot(params) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const H = P.horizon;
    const sel = new Float64Array(NN.N_SEL);
    sel[0] = P.selA;
    sel[1] = P.selB;
    for (let k = 0; k < P.powers.length; k++) sel[NN.SEL_POWER + k] = P.powers[k];

    let cap = 128;
    let hx = new Float32Array(cap * H); // posición prevista de cada proyectil en cada tick
    let hy = new Float32Array(cap * H);
    let hr = new Float32Array(cap);
    const copy = { x: 0, y: 0, vx: 0, vy: 0, r: 0, b: 0 };
    const target = { x: 0, y: 0 };
    const action = { mx: 0, my: 0 };
    const firstCost = new Float64Array(N_MOVES);
    const midX = new Float64Array(N_MOVES);
    const midY = new Float64Array(N_MOVES);
    const midCost = new Float64Array(N_MOVES);
    const midSum = new Float64Array(N_MOVES);
    const midDone = new Uint8Array(N_MOVES);
    let n = 0;
    let grab = 0; // distancia a la que se da el objetivo por cogido

    // Simula ticks [from, to] moviéndose en (mx, my) desde (x, y). Devuelve el coste acumulado
    // por proyectiles y deja en out la posición final y lo lejos que ha estado del objetivo:
    // out.sum = suma de las distancias tick a tick hasta que lo coge (out.done). Sumar en vez de
    // mirar solo si llega hace que prefiera llegar cuanto antes: si no, se entretiene.
    const out = { x: 0, y: 0, sum: 0, done: 0 };
    function rollout(p, x, y, mx, my, from, to, tx, ty) {
      let k = C.PLAYER_SPEED * C.DT * (mx && my ? Math.SQRT1_2 : 1);
      const kTurbo = k * C.TURBO_SPEED;
      const R = C.PLAYER_R;
      let cost = 0;
      let sum = out.sum;
      let done = out.done;
      for (let t = from; t <= to; t++) {
        const step = p.turbo >= t ? kTurbo : k;
        x += mx * step;
        y += my * step;
        if (x < R) x = R;
        else if (x > C.W - R) x = C.W - R;
        if (y < R) y = R;
        else if (y > C.H - R) y = C.H - R;
        // Mientras dure la invulnerabilidad o el fantasma, los proyectiles no cuentan.
        if (p.inv < t && p.ghost < t) {
          const row = (t - 1) * cap;
          for (let h = 0; h < n; h++) {
            const dx = hx[row + h] - x;
            const dy = hy[row + h] - y;
            const lim = hr[h] + R + P.margin;
            const d2 = dx * dx + dy * dy;
            if (d2 < lim * lim) {
              const gap = Math.sqrt(d2) - hr[h] - R;
              if (gap < 0) cost += (p.shield >= t ? P.hit * 0.4 : P.hit) / t;
              else cost += ((P.margin - gap) * P.near) / t;
            }
          }
        }
        if (!done) {
          const ddx = tx - x;
          const ddy = ty - y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < grab) done = 1;
          else sum += d;
        }
      }
      out.x = x;
      out.y = y;
      out.sum = sum;
      out.done = done;
      return cost;
    }

    function endCost(x, y, sum) {
      const wall = Math.min(x, C.W - x, y, C.H - y);
      return (wall < 60 ? (60 - wall) * P.wall : 0) + (sum / H) * P.target;
    }

    return function act(s, idx) {
      const p = s.players[idx];
      NN.pickTarget(s, idx, sel, target);
      grab = p.magnet > 0 ? C.MAGNET_R : C.PLAYER_R + C.STAR_R;

      // 1. Dónde estará cada proyectil en cada tick del horizonte. Se descartan los que no
      //    pueden alcanzar al jugador en ese tiempo, por lejos que este se mueva.
      const hz = s.hazards;
      if (hz.length > cap) {
        cap = hz.length + 64;
        hx = new Float32Array(cap * H);
        hy = new Float32Array(cap * H);
        hr = new Float32Array(cap);
      }
      n = 0;
      const reach = C.PLAYER_SPEED * C.TURBO_SPEED * H * C.DT + P.margin + C.PLAYER_R;
      for (let h = 0; h < hz.length; h++) {
        const z = hz[h];
        const dx = z.x - p.x;
        const dy = z.y - p.y;
        const far = Math.sqrt(dx * dx + dy * dy) - Math.sqrt(z.vx * z.vx + z.vy * z.vy) * H * C.DT - z.r - reach;
        if (far > 0) continue;
        hr[n] = z.r * C.HIT_FORGIVE;
        if (z.b > 0) {
          copy.x = z.x;
          copy.y = z.y;
          copy.vx = z.vx;
          copy.vy = z.vy;
          copy.r = z.r;
          copy.b = z.b;
          for (let t = 0; t < H; t++) {
            Sim.moveHazard(copy, C.DT);
            hx[t * cap + n] = copy.x;
            hy[t * cap + n] = copy.y;
          }
        } else {
          for (let t = 0; t < H; t++) {
            hx[t * cap + n] = z.x + z.vx * (t + 1) * C.DT;
            hy[t * cap + n] = z.y + z.vy * (t + 1) * C.DT;
          }
        }
        n++;
      }

      // 2. Primer tramo: los 9 movimientos hasta el tick `turn`.
      const turn = Math.min(P.turn, H);
      for (let m = 0; m < N_MOVES; m++) {
        out.sum = 0;
        out.done = 0;
        midCost[m] = rollout(p, p.x, p.y, MOVES[m][0], MOVES[m][1], 1, turn, target.x, target.y);
        midX[m] = out.x;
        midY[m] = out.y;
        midSum[m] = out.sum;
        midDone[m] = out.done;
        firstCost[m] = Infinity;
      }
      // 3. Segundo tramo: desde cada final, otros 9 movimientos hasta el horizonte. Cada primer
      //    movimiento vale lo que su mejor continuación.
      for (let m = 0; m < N_MOVES; m++) {
        for (let q = 0; q < N_MOVES; q++) {
          out.sum = midSum[m];
          out.done = midDone[m];
          const c = midCost[m] + rollout(p, midX[m], midY[m], MOVES[q][0], MOVES[q][1], turn + 1, H, target.x, target.y) + endCost(out.x, out.y, out.sum);
          if (c < firstCost[m]) firstCost[m] = c;
        }
      }
      let best = 0;
      for (let m = 1; m < N_MOVES; m++) if (firstCost[m] < firstCost[best]) best = m;
      action.mx = MOVES[best][0];
      action.my = MOVES[best][1];
      return action;
    };
  }

  return { DEFAULTS: DEFAULTS, createBot: createBot };
});
