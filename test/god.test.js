'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../js/sim.js');
const NN = require('../js/nn.js');
const God = require('../js/god.js');
const T = require('../train/common.js');
const C = Sim.C;

test('Modo Dios: en el primer minuto no pierde ni una vida y coge muchas estrellas', () => {
  for (const seed of [11, 12, 13]) {
    const s = Sim.createState({ seed: seed });
    const bot = God.createBot();
    while (!s.over && s.tick < 60 * 60) Sim.step(s, [bot(s, 0)]);
    const p = s.players[0];
    assert.equal(s.over, false, 'semilla ' + seed + ': sigue en pie al minuto');
    assert.equal(p.lives, C.LIVES, 'semilla ' + seed + ': conserva todas las vidas');
    assert.ok(p.stars >= 25, 'semilla ' + seed + ': ' + p.stars + ' estrellas en un minuto');
  }
});

test('Modo Dios aguanta mucho más que la mejor red y que el planificador antiguo', () => {
  const seeds = [21, 22];
  const god = T.evaluate(() => God.createBot(), seeds, 60 * 300);
  const old = T.evaluate(T.planner({}), seeds, 60 * 300);
  assert.ok(god.secs > 150, 'aguanta ' + god.secs.toFixed(0) + ' s');
  assert.ok(god.score > old.score * 1.5, 'puntos: ' + god.score.toFixed(0) + ' frente a ' + old.score.toFixed(0));
});

test('Modo Dios se mueve como un jugador: solo -1/0/1, y es determinista', () => {
  const play = () => {
    const s = Sim.createState({ seed: 5, numPlayers: 2, hazard: 3 });
    const a = God.createBot();
    const b = God.createBot();
    for (let t = 0; t < 900 && !s.over; t++) {
      const ia = s.players[0].alive ? a(s, 0) : null;
      const ib = s.players[1].alive ? b(s, 1) : null;
      for (const i of [ia, ib]) if (i) assert.ok([-1, 0, 1].includes(i.mx) && [-1, 0, 1].includes(i.my));
      Sim.step(s, [ia && { mx: ia.mx, my: ia.my }, ib && { mx: ib.mx, my: ib.my }]);
    }
    return s;
  };
  assert.deepEqual(play(), play());
});

test('Modo Dios esquiva también los proyectiles que rebotan', () => {
  // Un rebotador que, tras dar en la pared, vuelve directo hacia el jugador.
  const s = Sim.createState({ seed: 1, powerups: false });
  s.spawnTimer = 1e9;
  const p = s.players[0];
  p.x = 700;
  p.y = 300;
  s.stars.forEach((st) => {
    st.x = 700;
    st.y = 300 + 1e-3;
  }); // sin motivo para moverse... salvo el proyectil
  s.hazards.push({ x: 600, y: 300, vx: 420, vy: 0, r: 12, k: 1, b: 1 }); // pasa, rebota en x=788 y vuelve
  const bot = God.createBot();
  for (let t = 0; t < 120; t++) {
    s.stars.forEach((st) => {
      st.x = 60;
      st.y = 60;
    });
    Sim.step(s, [bot(s, 0)]);
  }
  assert.equal(p.lives, C.LIVES, 'ni a la ida ni a la vuelta');
});

test('Modo Dios aprovecha el fantasma y va a por las mejoras que valora', () => {
  const s = Sim.createState({ seed: 3 });
  s.spawnTimer = 1e9;
  s.powerTimer = 1e9;
  const p = s.players[0];
  s.stars.forEach((st, k) => {
    st.x = 60 + k * 30;
    st.y = 560;
  });
  s.powerups.push({ x: p.x + 120, y: p.y, type: 2, ttl: 600 }); // un escudo cerca; las estrellas, lejos
  const bot = God.createBot();
  for (let t = 0; t < 60 && !p.shield; t++) Sim.step(s, [bot(s, 0)]);
  assert.ok(p.shield > 0, 'coge el escudo antes de ir a por las estrellas');
});

test('Modo Dios sobrevive al primer minuto en Imposible con todos los enemigos', () => {
  let vivos = 0;
  let vidas = 0;
  for (const seed of [31, 32, 33, 34]) {
    const s = Sim.createState({ seed: seed, hazard: 3 });
    const bot = God.createBot();
    while (!s.over && s.tick < 60 * 60) Sim.step(s, [bot(s, 0)]);
    if (!s.over) vivos++;
    vidas += s.players[0].lives;
  }
  assert.ok(vivos >= 3, 'sigue en pie al minuto en ' + vivos + ' de 4 partidas');
  assert.ok(vidas >= 8, 'y conserva casi todas las vidas: ' + vidas + ' de 12');
});

test('Modo Dios esquiva las minas paradas y los zigzag', () => {
  // Una mina parada justo en el camino recto hacia la única estrella que le interesa.
  const s = Sim.createState({ seed: 3, powerups: false });
  s.spawnTimer = 1e9;
  const p = s.players[0];
  p.x = 200;
  p.y = 300;
  s.stars.forEach((st) => {
    st.x = 600;
    st.y = 300;
    st.t = 1;
  });
  s.hazards.push({ x: 400, y: 300, vx: 0, vy: 0, r: 11, k: 4, b: 0, e1: 0, e2: 30, e3: 0 });
  s.hazards.push({ x: 800, y: 300, vx: -220, vy: 0, r: 9, k: 5, b: 0, e1: -220, e2: 0, e3: 0 });
  const bot = God.createBot();
  for (let t = 0; t < 200 && p.stars === 0; t++) Sim.step(s, [bot(s, 0)]);
  assert.ok(p.stars >= 1, 'llega a la estrella');
  assert.equal(p.lives, C.LIVES, 'rodeando la mina y sin que le dé el zigzag');
});

test('los parámetros por defecto del Modo Dios son coherentes', () => {
  assert.equal(God.DEFAULTS.powers.length, Sim.POWERS.length);
  assert.ok(God.DEFAULTS.turn <= God.DEFAULTS.horizon);
  assert.equal(NN.N_SEL, 2 + God.DEFAULTS.powers.length + 1);
});
