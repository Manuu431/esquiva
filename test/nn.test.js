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
  assert.equal(NN.N_IN, 35);
  assert.equal(NN.N_SEL, 2 + Sim.POWERS.length);
  assert.equal(NN.N_NET, (NN.N_IN + 1) * NN.N_HID + (NN.N_HID + 1) * NN.N_OUT);
  assert.equal(NN.N_W, NN.N_NET + NN.N_SEL);
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
  s.stars = [{ x: p.x + 300, y: p.y }, { x: p.x + 500, y: p.y + 200 }, { x: p.x + 301, y: p.y + 250 }];
  p.inv = 10;
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  const o = 8 * SECT;
  assert.equal(out[o], 1, 'pegado a la pared izquierda');
  assert.equal(out[o + 1], 0, 'lejos de la derecha');
  assert.ok(Math.abs(out[o + 4] - 1) < 1e-9 && Math.abs(out[o + 5]) < 1e-9, 'estrella a la derecha');
  assert.ok(Math.abs(out[o + 6] - 0.7) < 1e-9, 'cercanía de la estrella más cercana');
  assert.equal(out[o + 7], 1);
});

test('de varias estrellas el bot mira la más cercana', () => {
  const s = emptyState();
  const p = s.players[0];
  s.stars = [{ x: p.x + 300, y: p.y }, { x: p.x, y: p.y - 100 }, { x: p.x - 250, y: p.y }];
  const out = NN.sense(s, 0, new Float64Array(NN.N_IN));
  const o = 8 * SECT + 4;
  assert.ok(Math.abs(out[o]) < 1e-9 && Math.abs(out[o + 1] + 1) < 1e-9, 'apunta a la de arriba');
  assert.ok(Math.abs(out[o + 2] - 0.9) < 1e-9);
});

// Arena de prueba: yo en el centro, una estrella cerca a la derecha y otra más lejos a la izquierda.
function rivalScene() {
  const s = Sim.createState({ seed: 1, numPlayers: 2 });
  s.hazards.length = 0;
  const me = s.players[0];
  const rival = s.players[1];
  me.x = 400;
  me.y = 300;
  s.stars = [{ x: 600, y: 300 }, { x: 150, y: 300 }, { x: 400, y: 560 }]; // a 200, 250 y 260 px
  return { s, me, rival };
}

test('elegir estrella: sin rivales o sin criterio, la más cercana', () => {
  const { s, rival } = rivalScene();
  rival.x = 580; // pegado a la estrella que yo tengo más cerca, y yendo hacia ella
  rival.y = 300;
  rival.mx = 1;
  assert.equal(NN.targetStar(s, 0, 0, 0), 0, 'con criterio 0 se ignora a los rivales');
  rival.alive = false;
  assert.equal(NN.targetStar(s, 0, 3, 1), 0, 'un rival caído no cuenta');
});

test('elegir estrella: si un rival llega antes a la más cercana, se va a por otra', () => {
  const { s, rival } = rivalScene();
  rival.x = 520; // a 80 px de la estrella; yo, a 200: me lleva 120 de ventaja
  rival.y = 300;
  rival.mx = 1; // y va hacia ella
  assert.equal(NN.targetStar(s, 0, 2, 0), 1, 'la da por perdida y va a la siguiente');
  rival.mx = -1; // se aleja de ella: no la está disputando
  assert.equal(NN.targetStar(s, 0, 2, 0), 0, 'si el rival no va hacia ella, sigue siendo mía');
  assert.equal(NN.targetStar(s, 0, 0, 1), 1, 'salvo que el criterio penalice la mera cercanía');
  // Si quien está más cerca soy yo, no cambia nada aunque el rival venga.
  rival.x = 150;
  rival.mx = 1;
  assert.equal(NN.targetStar(s, 0, 5, 5), 0);
});

test('elegir estrella: el bot percibe la dirección de su objetivo, no de la más cercana', () => {
  const { s, rival } = rivalScene();
  rival.x = 520;
  rival.y = 300;
  rival.mx = 1;
  const o = 8 * SECT + 4;
  const ingenuo = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.ok(ingenuo[o] > 0.99, 'sin criterio mira a la derecha');
  const criterio = new Float64Array(NN.N_SEL);
  criterio[0] = 2;
  const listo = NN.sense(s, 0, new Float64Array(NN.N_IN), criterio);
  assert.ok(listo[o] < -0.99, 'con criterio mira a la izquierda');
});

test('los genomas antiguos siguen sirviendo y se comportan igual que antes', () => {
  // Un genoma de 424 números (red de 32 entradas + criterio de rivales) con pesos cualesquiera.
  const viejo = new Float64Array(424);
  let seed = 11;
  for (let i = 0; i < viejo.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    viejo[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  const nuevo = NN.upgrade(viejo);
  assert.equal(nuevo.length, NN.N_W);
  assert.equal(nuevo[NN.N_NET], viejo[422], 'conserva el criterio de rivales');
  assert.equal(nuevo[NN.N_NET + 1], viejo[423]);
  for (let k = 0; k < Sim.POWERS.length; k++) assert.equal(nuevo[NN.N_NET + NN.SEL_POWER + k], 0, 'no valora ninguna mejora');
  // La salida de la red no cambia: las entradas nuevas entran con peso 0.
  const inp = new Float64Array(NN.N_IN).map((_, i) => Math.sin(i * 1.7));
  const out = NN.forward(nuevo, inp, new Float64Array(NN.N_HID), new Float64Array(NN.N_OUT));
  let k = 0;
  const hid = [];
  for (let j = 0; j < NN.N_HID; j++) {
    let a = 0;
    for (let i = 0; i < 32; i++) a += viejo[k++] * inp[i];
    hid.push(Math.tanh(a + viejo[k++]));
  }
  for (let q = 0; q < NN.N_OUT; q++) {
    let a = 0;
    for (let j = 0; j < NN.N_HID; j++) a += viejo[k++] * hid[j];
    assert.ok(Math.abs(Math.tanh(a + viejo[k++]) - out[q]) < 1e-12);
  }
  assert.doesNotThrow(() => NN.createBrain(new Float64Array(422)));
  assert.doesNotThrow(() => NN.createBrain(viejo));
  assert.throws(() => NN.createBrain(new Float64Array(400)));
});

test('mejoras como objetivo: el bot va a por las que valora, si le compensa el desvío', () => {
  const { s, me } = rivalScene();
  s.players[1].alive = false;
  s.maxLives = 3;
  me.lives = 3;
  s.powerups = [{ x: 400, y: 0, type: 2, ttl: 600 }]; // un escudo a 300 px; la estrella más cercana, a 200
  const sel = new Float64Array(NN.N_SEL);
  assert.equal(NN.pickTarget(s, 0, sel, null), 0, 'si no la valora, ni la mira');
  sel[NN.SEL_POWER + 2] = 60;
  assert.equal(NN.pickTarget(s, 0, sel, null), 0, 'vale 60 px y el desvío es de 100: no compensa');
  sel[NN.SEL_POWER + 2] = 150;
  const out = { x: 0, y: 0 };
  assert.equal(NN.pickTarget(s, 0, sel, out), -1, 'vale 150 px: va a por ella');
  assert.deepEqual(out, { x: 400, y: 0 });
  // Si caduca antes de que pueda llegar, no hace el viaje.
  s.powerups[0].ttl = 30;
  assert.equal(NN.pickTarget(s, 0, sel, null), 0);
  // Un corazón no interesa con todas las vidas, y sí cuando falta alguna.
  s.powerups = [{ x: 400, y: 250, type: 3, ttl: 600 }];
  sel[NN.SEL_POWER + 3] = 500;
  assert.equal(NN.pickTarget(s, 0, sel, null), 0);
  me.lives = 2;
  assert.equal(NN.pickTarget(s, 0, sel, null), -1);
});

test('intangible: el bot deja de percibir los proyectiles como amenaza', () => {
  const s = emptyState();
  const p = s.players[0];
  s.hazards.push({ x: p.x + 60, y: p.y, vx: -400, vy: 0, r: 10 });
  assert.ok(NN.sense(s, 0, new Float64Array(NN.N_IN))[1] > 0.5);
  p.ghost = 200;
  const fantasma = NN.sense(s, 0, new Float64Array(NN.N_IN));
  assert.equal(fantasma[0], 0);
  assert.equal(fantasma[1], 0);
  assert.equal(fantasma[NN.N_IN - 2], 1, 'y sabe que lo es');
  p.ghost = 5; // a punto de acabarse: vuelve a verlos
  assert.ok(NN.sense(s, 0, new Float64Array(NN.N_IN))[1] > 0.5);
});

test('el bot percibe sus propios efectos: turbo, intangible y escudo', () => {
  const s = emptyState();
  const p = s.players[0];
  const flags = () => Array.from(NN.sense(s, 0, new Float64Array(NN.N_IN)).slice(NN.N_IN - 3));
  assert.deepEqual(flags(), [0, 0, 0]);
  p.turbo = 10;
  p.shield = 10;
  assert.deepEqual(flags(), [1, 0, 1]);
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
  s.stars = [{ x: s.players[0].x + 200, y: s.players[0].y }];
  assert.equal(NN.createBrain(w).act(s, 0).mx, 1);
  const lento = NN.createBrain(w, { delay: 5 });
  const seq = [];
  for (let t = 0; t < 8; t++) seq.push(lento.act(s, 0).mx);
  assert.deepEqual(seq, [0, 0, 0, 0, 0, 1, 1, 1]);
});

test('createBrain rechaza un vector de pesos de tamaño incorrecto', () => {
  assert.throws(() => NN.createBrain([1, 2, 3]));
});
