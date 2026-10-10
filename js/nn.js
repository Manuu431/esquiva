// nn.js — sensores y red neuronal de los bots. Sin DOM: se usa igual en Node (entrenamiento)
// y en el navegador (partida). La red es fija: N_IN entradas -> N_HID tanh -> 2 salidas tanh.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.NN = factory(root.Sim);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Sim) {
  'use strict';

  const C = Sim.C;

  const N_SECT = 8; // sectores de 45° centrados en las 8 direcciones de movimiento
  const PER_SECT = 3; // cercanía, inminencia de impacto, lado por el que pasaría de largo
  const N_IN = N_SECT * PER_SECT + 4 + 3 + 1;
  const N_HID = 12;
  const N_OUT = 2;
  const N_W = (N_IN + 1) * N_HID + (N_HID + 1) * N_OUT;

  const SENSE_RANGE = 260; // px: más lejos de esto el bot no "ve" el proyectil
  const WALL_RANGE = 150;
  const HORIZON = 1.2; // s: más allá de esto un cruce no es urgente
  const MISS_RANGE = 50; // px: pasar a más de esto es pasar de largo
  const DEADZONE = 0.3; // salida por debajo de esto = no moverse en ese eje

  const _threat = new Float64Array(N_SECT);

  // Rellena out[0..N_IN) con lo que percibe el jugador idx. Todo en [-1, 1].
  function sense(s, idx, out) {
    const p = s.players[idx];
    for (let i = 0; i < N_SECT * PER_SECT; i++) out[i] = 0;
    for (let k = 0; k < N_SECT; k++) _threat[k] = 0;

    const hz = s.hazards;
    for (let h = 0; h < hz.length; h++) {
      const z = hz[h];
      const dx = z.x - p.x;
      const dy = z.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const gap = d - z.r - C.PLAYER_R;
      if (gap > SENSE_RANGE) continue;
      const prox = gap <= 0 ? 1 : 1 - gap / SENSE_RANGE;
      // Si el jugador no se moviera: cuándo pasaría más cerca y a qué distancia.
      const v2 = z.vx * z.vx + z.vy * z.vy || 1e-6;
      const tca = -(dx * z.vx + dy * z.vy) / v2;
      let urgency = 0;
      let lateral = 0;
      let hit = 0;
      if (tca > 0) {
        const cx = dx + z.vx * tca;
        const cy = dy + z.vy * tca;
        const miss = Math.sqrt(cx * cx + cy * cy) - z.r - C.PLAYER_R;
        urgency = tca >= HORIZON ? 0 : 1 - tca / HORIZON;
        hit = miss <= 0 ? 1 : miss >= MISS_RANGE ? 0 : 1 - miss / MISS_RANGE;
        const side = dx * z.vy - dy * z.vx > 0 ? 1 : -1;
        lateral = side * (1 - hit);
      }
      // En cada sector solo cuenta el proyectil más amenazante: el que va a dar antes, o el que
      // ya está casi encima.
      const threat = urgency * hit + (gap < 30 ? 0.3 * (1 - Math.max(0, gap) / 30) : 0) + 0.01 * prox;
      let k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
      k = (k + N_SECT) % N_SECT;
      if (threat > _threat[k]) {
        _threat[k] = threat;
        const o = k * PER_SECT;
        out[o] = prox;
        out[o + 1] = urgency * hit; // 1 = impacto inminente; 0 = no viene o no dará
        out[o + 2] = lateral; // 0 = viene centrado; ±1 = pasará de largo por ese lado
      }
    }

    let o = N_SECT * PER_SECT;
    out[o++] = wallNear(p.x - C.PLAYER_R);
    out[o++] = wallNear(C.W - C.PLAYER_R - p.x);
    out[o++] = wallNear(p.y - C.PLAYER_R);
    out[o++] = wallNear(C.H - C.PLAYER_R - p.y);

    const sx = s.star.x - p.x;
    const sy = s.star.y - p.y;
    const sd = Math.sqrt(sx * sx + sy * sy) || 1e-6;
    out[o++] = sx / sd;
    out[o++] = sy / sd;
    out[o++] = 1 - Math.min(1, sd / 1000);

    out[o++] = p.inv > 0 ? 1 : 0;
    return out;
  }

  function wallNear(dist) {
    return dist >= WALL_RANGE ? 0 : 1 - dist / WALL_RANGE;
  }

  // w: [ (N_IN pesos + sesgo) por neurona oculta ..., (N_HID pesos + sesgo) por salida ... ]
  function forward(w, inp, hid, out) {
    let k = 0;
    for (let j = 0; j < N_HID; j++) {
      let a = 0;
      for (let i = 0; i < N_IN; i++) a += w[k++] * inp[i];
      hid[j] = Math.tanh(a + w[k++]);
    }
    for (let q = 0; q < N_OUT; q++) {
      let a = 0;
      for (let j = 0; j < N_HID; j++) a += w[k++] * hid[j];
      out[q] = Math.tanh(a + w[k++]);
    }
    return out;
  }

  // Un cerebro = pesos + memoria de trabajo. act() devuelve { mx, my } en {-1, 0, 1},
  // lo mismo que puede hacer un humano con el teclado.
  // opts.delay: ticks de tiempo de reacción (el bot actúa sobre lo que decidió hace `delay` ticks).
  function createBrain(weights, opts) {
    if (weights.length !== N_W) throw new Error('Se esperaban ' + N_W + ' pesos y hay ' + weights.length);
    const w = Float64Array.from(weights);
    const inp = new Float64Array(N_IN);
    const hid = new Float64Array(N_HID);
    const out = new Float64Array(N_OUT);
    const delay = Math.max(0, (opts && opts.delay) | 0);
    const queue = [];
    const action = { mx: 0, my: 0 };

    function act(s, idx) {
      sense(s, idx, inp);
      forward(w, inp, hid, out);
      const mx = out[0] > DEADZONE ? 1 : out[0] < -DEADZONE ? -1 : 0;
      const my = out[1] > DEADZONE ? 1 : out[1] < -DEADZONE ? -1 : 0;
      if (delay === 0) {
        action.mx = mx;
        action.my = my;
        return action;
      }
      queue.push(mx, my);
      if (queue.length > delay * 2) {
        action.mx = queue.shift();
        action.my = queue.shift();
      } else {
        action.mx = 0;
        action.my = 0;
      }
      return action;
    }

    function reset() {
      queue.length = 0;
      action.mx = 0;
      action.my = 0;
    }

    return { act: act, reset: reset };
  }

  return {
    N_IN: N_IN,
    N_HID: N_HID,
    N_OUT: N_OUT,
    N_W: N_W,
    SENSE_RANGE: SENSE_RANGE,
    sense: sense,
    forward: forward,
    createBrain: createBrain,
  };
});
