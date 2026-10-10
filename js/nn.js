// nn.js — sensores y red neuronal de los bots. Sin DOM: se usa igual en Node (entrenamiento)
// y en el navegador (partida). La red es fija: N_IN entradas -> N_HID tanh -> 2 salidas tanh.
// Además de los pesos de la red, cada bot lleva N_SEL números que deciden a por qué va (qué
// estrella o qué mejora) cuando hay rivales: ver pickTarget. Todo ello es el "genoma" que
// ajusta la evolución.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.NN = factory(root.Sim);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Sim) {
  'use strict';

  const C = Sim.C;
  const N_POWERS = Sim.POWERS.length;

  const N_SECT = 8; // sectores de 45° centrados en las 8 direcciones de movimiento
  const PER_SECT = 3; // cercanía, inminencia de impacto, lado por el que pasaría de largo
  const N_FLAGS = 3; // efectos propios que cambian cómo conviene moverse: turbo, fantasma, escudo
  const N_IN = N_SECT * PER_SECT + 4 + 3 + 1 + N_FLAGS;
  const N_HID = 12;
  const N_OUT = 2;
  const N_NET = (N_IN + 1) * N_HID + (N_HID + 1) * N_OUT; // pesos de la red
  const SEL_POWER = 2; // posición, dentro del criterio, del valor de la primera mejora
  const SEL_STAR = SEL_POWER + N_POWERS; // ...y de lo que pesa el valor de una estrella
  const N_SEL = SEL_STAR + 1; // criterio: 2 números para los rivales + el valor de cada mejora + 1
  const N_W = N_NET + N_SEL; // tamaño del genoma completo

  const SENSE_RANGE = 260; // px: más lejos de esto el bot no "ve" el proyectil
  const WALL_RANGE = 150;
  const HORIZON = 1.2; // s: más allá de esto un cruce no es urgente
  const MISS_RANGE = 50; // px: pasar a más de esto es pasar de largo
  const DEADZONE = 0.3; // salida por debajo de esto = no moverse en ese eje
  const GHOST_MARGIN = 20; // ticks: con más de esto de intangible, los proyectiles no son amenaza

  const _threat = new Float64Array(N_SECT);
  const _target = { x: 0, y: 0, r: 0 };
  const _none = [];
  const NO_SEL = new Float64Array(N_SEL);

  // Penalización por rivales para un objetivo en (tx, ty): cuánta ventaja me llevan.
  //   going = la del rival que va hacia él; any = la de cualquier rival, vaya o no.
  // "Ventaja" son los px que ese rival está más cerca que yo.
  function rivalCost(s, idx, tx, ty, myD, selA, selB) {
    if (selA === 0 && selB === 0) return 0;
    const players = s.players;
    let going = 0;
    let any = 0;
    for (let i = 0; i < players.length; i++) {
      if (i === idx) continue;
      const q = players[i];
      if (!q.alive) continue;
      const rx = tx - q.x;
      const ry = ty - q.y;
      const rd = Math.sqrt(rx * rx + ry * ry) || 1e-6;
      const lead = myD - rd;
      if (lead <= 0) continue;
      if (lead > any) any = lead;
      // ¿Va hacia él? Coseno entre su movimiento y la dirección al objetivo.
      if (q.mx !== 0 || q.my !== 0) {
        const cos = (rx * q.mx + ry * q.my) / (rd * (q.mx !== 0 && q.my !== 0 ? Math.SQRT2 : 1));
        if (cos > 0 && lead * cos > going) going = lead * cos;
      }
    }
    return selA * going + selB * any;
  }

  // ¿A por qué va el jugador idx? Cada estrella y cada mejora tiene un coste, y elige el menor:
  //   estrella: mi distancia + penalización por rivales - S * (lo que vale de más o de menos
  //             que una estrella normal, medido en estrellas normales)
  //   mejora:   mi distancia + penalización por rivales - lo que el bot valora esa mejora (px)
  // sel = [A, B, valor de cada mejora..., S]. Con todo a 0 (o sin rivales ni mejoras) es la
  // estrella más cercana. Devuelve el índice de la estrella, o -1 - k si es la mejora k; el punto
  // elegido y la distancia a la que se coge quedan en `out` si se pasa.
  function pickTarget(s, idx, sel, out) {
    const p = s.players[idx];
    const selA = sel[0];
    const selB = sel[1];
    const selS = sel[SEL_STAR] || 0;
    let best = 0;
    let bestCost = Infinity;
    let bx = p.x;
    let by = p.y;
    let br = C.PLAYER_R + C.STAR_R;
    for (let k = 0; k < s.stars.length; k++) {
      const st = s.stars[k];
      const tier = Sim.starTier(st);
      const dx = st.x - p.x;
      const dy = st.y - p.y;
      const myD = Math.sqrt(dx * dx + dy * dy);
      const cost = myD + rivalCost(s, idx, st.x, st.y, myD, selA, selB) - selS * (tier.points / C.STAR_POINTS - 1);
      if (cost < bestCost) {
        bestCost = cost;
        best = k;
        bx = st.x;
        by = st.y;
        br = C.PLAYER_R + tier.r;
      }
    }
    const ups = s.powerups;
    if (ups) {
      for (let k = 0; k < ups.length; k++) {
        const u = ups[k];
        const value = sel[SEL_POWER + u.type];
        if (!(value > 0)) continue; // una mejora que no valora, ni la mira
        // Un corazón no sirve de mucho con todas las vidas.
        if (u.type === 3 && p.lives >= s.maxLives) continue;
        const dx = u.x - p.x;
        const dy = u.y - p.y;
        const myD = Math.sqrt(dx * dx + dy * dy);
        // Si no llega antes de que desaparezca, no merece el viaje.
        if (myD > (u.ttl * C.PLAYER_SPEED) / C.TICK_HZ) continue;
        const cost = myD + rivalCost(s, idx, u.x, u.y, myD, selA, selB) - value;
        if (cost < bestCost) {
          bestCost = cost;
          best = -1 - k;
          bx = u.x;
          by = u.y;
          br = C.PLAYER_R + C.POWER_R;
        }
      }
    }
    if (out) {
      out.x = bx;
      out.y = by;
      out.r = p.magnet > 0 && best >= 0 ? C.MAGNET_R : br;
    }
    return best;
  }

  // Índice de la estrella objetivo teniendo en cuenta solo a los rivales (sin mejoras).
  function targetStar(s, idx, selA, selB) {
    const sel = new Float64Array(N_SEL);
    sel[0] = selA || 0;
    sel[1] = selB || 0;
    return pickTarget({ players: s.players, stars: s.stars, powerups: null, maxLives: s.maxLives }, idx, sel, null);
  }

  // Rellena out[0..N_IN) con lo que percibe el jugador idx. Todo en [-1, 1].
  // sel: criterio para elegir objetivo (opcional; por defecto, la estrella más cercana).
  function sense(s, idx, out, sel) {
    const p = s.players[idx];
    for (let i = 0; i < N_SECT * PER_SECT; i++) out[i] = 0;
    for (let k = 0; k < N_SECT; k++) _threat[k] = 0;

    // Mientras es intangible los proyectiles no le hacen nada: no los percibe como amenaza
    // (salvo al final, para que no le pillen encima al volver a ser sólido).
    const hz = p.ghost > GHOST_MARGIN ? _none : s.hazards;
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

    // De todo lo que hay por coger, el bot solo percibe una cosa: su objetivo.
    pickTarget(s, idx, sel || NO_SEL, _target);
    const sx = _target.x - p.x;
    const sy = _target.y - p.y;
    const sd = Math.sqrt(sx * sx + sy * sy) || 1e-6;
    out[o++] = sx / sd;
    out[o++] = sy / sd;
    out[o++] = 1 - Math.min(1, sd / 1000);

    out[o++] = p.inv > 0 ? 1 : 0;
    out[o++] = p.turbo > 0 ? 1 : 0;
    out[o++] = p.ghost > GHOST_MARGIN ? 1 : 0;
    out[o++] = p.shield > 0 ? 1 : 0;
    return out;
  }

  function wallNear(dist) {
    return dist >= WALL_RANGE ? 0 : 1 - dist / WALL_RANGE;
  }

  // w: [ (N_IN pesos + sesgo) por neurona oculta ..., (N_HID pesos + sesgo) por salida ...,
  //      criterio (N_SEL números) ]  (el criterio no es de la red: lo usa pickTarget)
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

  // Genomas de versiones anteriores -> genoma actual, sin cambiar cómo se comportan:
  //   422 = red de 32 entradas, sin criterio          424 = lo mismo + criterio de rivales (A, B)
  //   467 = red actual, sin el peso del valor de las estrellas
  // Las entradas nuevas (efectos propios) entran con peso 0, y las mejoras y el valor de las
  // estrellas, con 0.
  const OLD_IN = 32;
  const OLD_NET = (OLD_IN + 1) * N_HID + (N_HID + 1) * N_OUT;
  function upgrade(weights) {
    if (weights.length === N_W) return Float64Array.from(weights);
    if (weights.length === N_W - 1) {
      const same = new Float64Array(N_W);
      same.set(weights);
      return same;
    }
    if (weights.length !== OLD_NET && weights.length !== OLD_NET + 2) {
      throw new Error('Se esperaban ' + N_W + ' pesos y hay ' + weights.length);
    }
    const w = new Float64Array(N_W);
    let from = 0;
    let to = 0;
    for (let j = 0; j < N_HID; j++) {
      for (let i = 0; i < OLD_IN; i++) w[to++] = weights[from++];
      to += N_IN - OLD_IN; // entradas nuevas: peso 0
      w[to++] = weights[from++]; // sesgo
    }
    for (let k = 0; k < (N_HID + 1) * N_OUT; k++) w[to++] = weights[from++];
    if (weights.length === OLD_NET + 2) {
      w[N_NET] = weights[OLD_NET];
      w[N_NET + 1] = weights[OLD_NET + 1];
    }
    return w;
  }

  // Un cerebro = pesos + memoria de trabajo. act() devuelve { mx, my } en {-1, 0, 1},
  // lo mismo que puede hacer un humano con el teclado.
  // opts.delay: ticks de tiempo de reacción (el bot actúa sobre lo que decidió hace `delay` ticks).
  function createBrain(weights, opts) {
    const w = upgrade(weights);
    const sel = w.subarray(N_NET);
    const inp = new Float64Array(N_IN);
    const hid = new Float64Array(N_HID);
    const out = new Float64Array(N_OUT);
    const delay = Math.max(0, (opts && opts.delay) | 0);
    const queue = [];
    const action = { mx: 0, my: 0 };

    function act(s, idx) {
      sense(s, idx, inp, sel);
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
    N_NET: N_NET,
    N_SEL: N_SEL,
    SEL_POWER: SEL_POWER,
    SEL_STAR: SEL_STAR,
    OLD_SIZES: [OLD_NET, OLD_NET + 2, N_W - 1],
    SENSE_RANGE: SENSE_RANGE,
    pickTarget: pickTarget,
    targetStar: targetStar,
    sense: sense,
    forward: forward,
    upgrade: upgrade,
    createBrain: createBrain,
  };
});
