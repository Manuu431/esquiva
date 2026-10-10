'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../js/sim.js');
const NN = require('../js/nn.js');
const C = Sim.C;

function emptyState() {
  const s = Sim.createState({ seed: 1 });
  s.hazards.length = 0;
  return s;
}

const SECT = 3; // valores por sector

test('la red tiene el tamaño documentado', () => {
  assert.equal(NN.N_IN, 32);
  assert.equal(NN.N_W, (NN.N_IN + 1) * NN.N_HID + (NN.N_HID + 1) * NN.N_OUT);
});

test('sin proyectiles los sectores están a cero', () => {
  const s = emptyState();
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  for (let i = 0; i < 8 * SECT; i++) assert.equal(out[i], 0);
});

test('un proyectil que viene de frente por la derecha activa el sector 0', () => {
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + 100, y: p.y, vx: -400, vy: 0, r: 10 });
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.ok(out[0] > 0.6, 'cercanía');
  // Llegaría en 0,25 s de un horizonte de 1,2 s, y da de lleno.
  assert.ok(Math.abs(out[1] - (1 - 0.25 / 1.2)) < 1e-9, 'inminencia del impacto');
  assert.ok(Math.abs(out[2]) < 1e-9, 'viene centrado: ni a un lado ni a otro');
  for (let i = SECT; i < 8 * SECT; i++) assert.equal(out[i], 0);
});

test('los sectores siguen las 8 direcciones (y positiva = abajo)', () => {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  dirs.forEach((d, k) => {
    const s = emptyState();
    const p = s.players[0];
    s.hazards.push({ x: p.x + d[0] * 80, y: p.y + d[1] * 80, vx: 0, vy: 0, r: 10 });
    const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
    for (let j = 0; j < 8; j++) assert.equal(out[j * SECT] > 0, j === k, 'dirección ' + k + ', sector ' + j);
  });
});

test('en un sector manda el proyectil más amenazante, no el más cercano', () => {
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + 60, y: p.y, vx: 400, vy: 0, r: 10 }); // cerca pero alejándose
  s.hazards.push({ x: p.x + 120, y: p.y, vx: -400, vy: 0, r: 10 }); // más lejos pero viene
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.ok(out[1] > 0.6, 'se queda con el que va a dar');
});

test('un proyectil que pasará de largo no es urgente, y se sabe por qué lado pasa', () => {
  const lado = (vy) => {
    const s = emptyState();
    const p = s.players[0];
    // Viene desde la derecha, pero desviado: cruzará 100 px por encima o por debajo.
    s.hazards.push({ x: p.x + 200, y: p.y, vx: -400, vy: vy, r: 10 });
    return NN.sense(s, 0, new Float64Array(NN.N_IN));
  };
  const arriba = lado(-250);
  const abajo = lado(250);
  assert.ok(arriba[0] > 0, 'se percibe');
  assert.equal(arriba[1], 0, 'no va a dar');
  assert.equal(arriba[2], -1, 'pasa de largo por un lado...');
  assert.equal(abajo[2], 1, '...o por el otro');

  // Si va a rozar, la urgencia y el lado son intermedios.
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + 200, y: p.y + 46, vx: -400, vy: 0, r: 10 }); // pasará a 25 px del borde
  const roce = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.ok(roce[1] > 0.1 && roce[1] < 0.5, 'urgencia parcial: ' + roce[1]);
  assert.ok(Math.abs(Math.abs(roce[2]) - 0.5) < 1e-9, 'lado parcial: ' + roce[2]);
});

test('un proyectil casi encima cuenta aunque ya no vaya a dar', () => {
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + 30, y: p.y, vx: 0, vy: 300, r: 10 }); // pegado, cruzando por delante
  s.hazards.push({ x: p.x + 250, y: p.y, vx: 0, vy: 300, r: 10 }); // lejos, igual de inofensivo
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.ok(out[0] > 0.9, 'el sector informa del que está pegado: ' + out[0]);
});

test('lo que queda fuera del alcance no se percibe', () => {
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + NN.SENSE_RANGE + 60, y: p.y, vx: -400, vy: 0, r: 10 });
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.equal(out[0], 0);
});

test('paredes, estrella e invulnerabilidad', () => {
  const s = emptyState();
  const p = s.players[0];
  p.x = C.PLAYER_R;
  p.y = C.H / 2;
  s.star.x = p.x + 300;
  s.star.y = p.y;
  p.inv = 10;
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  const o = 8 * SECT;
  assert.equal(out[o], 1, 'pegado a la pared izquierda');
  assert.equal(out[o + 1], 0, 'lejos de la derecha');
  assert.ok(Math.abs(out[o + 4] - 1) < 1e-9 && Math.abs(out[o + 5]) < 1e-9, 'estrella a la derecha');
  assert.ok(Math.abs(out[o + 6] - 0.7) < 1e-9, 'cercanía de la estrella');
  assert.equal(out[o + 7], 1);
});

test('todas las percepciones están acotadas durante una partida real', () => {
  const s = Sim.createState({ seed: 99 });
  s.players[0].lives = 1e9;
  const out = new Float64Array(NN.N_IN);
  for (let t = 0; t < 60 * 60; t++) {
    Sim.step(s, [{ mx: (t >> 5) % 3 - 1, my: (t >> 6) % 3 - 1 }]);
    NN.sense(s, 0, out);
    for (let i = 0; i < NN.N_IN; i++) assert.ok(out[i] >= -1 && out[i] <= 1 && !Number.isNaN(out[i]));
  }
});

test('el cerebro devuelve movimientos de teclado y es determinista', () => {
  const w = new Float64Array(NN.N_W);
  let seed = 7;
  for (let i = 0; i < w.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    w[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  const play = () => {
    const brain = NN.createBrain(w);
    const s = Sim.createState({ seed: 5 });
    for (let t = 0; t < 1500 && !s.over; t++) {
      const a = brain.act(s, 0);
      assert.ok([-1, 0, 1].includes(a.mx) && [-1, 0, 1].includes(a.my));
      Sim.step(s, [a]);
    }
    return s;
  };
  assert.deepEqual(play(), play());
});

test('pesos a cero => el bot se queda quieto', () => {
  const brain = NN.createBrain(new Float64Array(NN.N_W));
  const s = Sim.createState({ seed: 5 });
  const a = brain.act(s, 0);
  assert.deepEqual({ mx: a.mx, my: a.my }, { mx: 0, my: 0 });
});

test('con tiempo de reacción el bot actúa con ese retraso exacto', () => {
  // Una sola conexión: "estrella a la derecha" (entrada 28) -> salida x.
  const w = new Float64Array(NN.N_W);
  w[8 * SECT + 4] = 5; // neurona oculta 0 <- dirección x de la estrella
  w[(NN.N_IN + 1) * NN.N_HID] = 5; // salida x <- neurona oculta 0
  const s = emptyState();
  s.star.x = s.players[0].x + 200;
  s.star.y = s.players[0].y;
  assert.equal(NN.createBrain(w).act(s, 0).mx, 1);
  const lento = NN.createBrain(w, { delay: 5 });
  const seq = [];
  for (let t = 0; t < 8; t++) seq.push(lento.act(s, 0).mx);
  assert.deepEqual(seq, [0, 0, 0, 0, 0, 1, 1, 1]);
});

test('createBrain rechaza un vector de pesos de tamaño incorrecto', () => {
  assert.throws(() => NN.createBrain([1, 2, 3]));
});
