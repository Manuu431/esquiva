'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../js/sim.js');
const C = Sim.C;

// Política de relleno determinista: cambia de dirección cada cierto número de ticks.
function wiggle(tick, i) {
  const k = Math.floor(tick / 17) + i * 3;
  return { mx: (k % 3) - 1, my: (Math.floor(k / 3) % 3) - 1 };
}

function run(seed, numPlayers, ticks, policy) {
  const s = Sim.createState({ seed: seed, numPlayers: numPlayers });
  const inputs = [];
  for (let t = 0; t < ticks && !s.over; t++) {
    for (let i = 0; i < numPlayers; i++) inputs[i] = policy ? policy(s.tick, i) : null;
    Sim.step(s, inputs);
  }
  return s;
}

function hazardAt(x, y, vx, vy, r) {
  return { x: x, y: y, vx: vx || 0, vy: vy || 0, r: r || 10 };
}

test('misma semilla y mismas entradas => mismo estado exacto', () => {
  const a = run(1234, 4, 3000, wiggle);
  const b = run(1234, 4, 3000, wiggle);
  assert.deepEqual(a, b);
  assert.ok(a.tick > 300, 'la partida debería durar algo');
});

test('semillas distintas => partidas distintas', () => {
  const a = run(1, 1, 600, wiggle);
  const b = run(2, 1, 600, wiggle);
  assert.notDeepEqual(a.hazards, b.hazards);
});

test('el estado sobrevive a JSON y la partida continúa idéntica', () => {
  const a = run(77, 3, 500, wiggle);
  const b = JSON.parse(JSON.stringify(a));
  for (let t = 0; t < 500; t++) {
    const inp = [wiggle(a.tick, 0), wiggle(a.tick, 1), wiggle(a.tick, 2)];
    Sim.step(a, inp);
    Sim.step(b, inp);
  }
  assert.deepEqual(a, b);
});

test('el jugador nunca sale de la arena', () => {
  const dirs = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const d of dirs) {
    const s = Sim.createState({ seed: 5 });
    s.players[0].lives = 1e9;
    for (let t = 0; t < 400; t++) {
      Sim.step(s, [{ mx: d[0], my: d[1] }]);
      const p = s.players[0];
      assert.ok(p.x >= C.PLAYER_R && p.x <= C.W - C.PLAYER_R);
      assert.ok(p.y >= C.PLAYER_R && p.y <= C.H - C.PLAYER_R);
    }
  }
});

test('en diagonal se avanza a la misma velocidad que en recto', () => {
  const p = { x: 400, y: 300, mx: 0, my: 0 };
  Sim.movePlayer(p, 1, 0);
  const recto = p.x - 400;
  const q = { x: 400, y: 300, mx: 0, my: 0 };
  Sim.movePlayer(q, 1, 1);
  const diag = Math.hypot(q.x - 400, q.y - 300);
  assert.ok(Math.abs(recto - diag) < 1e-9);
  assert.ok(Math.abs(recto - C.PLAYER_SPEED * C.DT) < 1e-9);
});

test('entradas fuera de rango se tratan como -1/0/1 (un cliente no puede correr más)', () => {
  const p = { x: 400, y: 300, mx: 0, my: 0 };
  Sim.movePlayer(p, 50, 0);
  assert.ok(Math.abs(p.x - 400 - C.PLAYER_SPEED * C.DT) < 1e-9);
});

test('un impacto quita una vida, da invulnerabilidad y consume el proyectil', () => {
  const s = Sim.createState({ seed: 9 });
  const p = s.players[0];
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 1);
  assert.equal(p.inv, C.INVULN_TICKS);
  assert.equal(s.hazards.length, 0);
  assert.ok(s.events.some((e) => e.type === 'hit' && e.p === 0));

  // Mientras dura la invulnerabilidad no hay segundo impacto y el proyectil lo atraviesa.
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 1);
  assert.equal(s.hazards.length, 1);
});

test('el radio de impacto es algo menor que el dibujado', () => {
  const s = Sim.createState({ seed: 9 });
  const p = s.players[0];
  // Los círculos dibujados se solapan 1 px, pero no debe contar como impacto.
  s.hazards.push(hazardAt(p.x + C.PLAYER_R + 10 - 1, p.y, 0, 0, 10));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES);
});

test('en solitario la ronda acaba al perder la última vida y la puntuación se congela', () => {
  const s = Sim.createState({ seed: 3 });
  const p = s.players[0];
  p.lives = 1;
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.alive, false);
  assert.equal(s.over, true);
  assert.equal(s.winner, 0);
  assert.equal(p.deathTick, 1);
  const score = p.score;
  const tick = s.tick;
  Sim.step(s, [null]);
  assert.equal(p.score, score);
  assert.equal(s.tick, tick);
});

test('con varios jugadores la ronda acaba cuando queda uno; sin estrellas gana quien más aguanta', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 3 });
  s.players[0].lives = 1;
  s.players[2].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  assert.equal(s.over, false, 'quedan dos');
  s.hazards.push(hazardAt(s.players[2].x, s.players[2].y));
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
  assert.deepEqual(Sim.ranking(s), [1, 2, 0]);
});

test('gana quien más puntos tiene, aunque haya caído antes', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 3 });
  s.players[0].lives = 1;
  s.players[0].score = 900; // cogió estrellas
  s.players[2].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  s.hazards.push(hazardAt(s.players[2].x, s.players[2].y));
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.winner, 0);
  assert.deepEqual(Sim.ranking(s), [0, 1, 2]);
});

test('a igualdad de puntos gana quien sigue en pie', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 2 });
  s.players[0].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  s.players[0].score = s.players[1].score; // se fuerza el empate
  assert.deepEqual(Sim.ranking(s), [1, 0]);
});

test('coger la estrella da puntos y la recoloca lejos de quien la cogió', () => {
  const s = Sim.createState({ seed: 11 });
  const p = s.players[0];
  for (let n = 0; n < 50; n++) {
    s.star.x = p.x;
    s.star.y = p.y;
    const before = p.score;
    Sim.step(s, [null]);
    assert.equal(p.score, before + 1 + C.STAR_POINTS);
    assert.equal(p.stars, n + 1);
    assert.ok(Math.hypot(s.star.x - p.x, s.star.y - p.y) >= C.PLAYER_R + C.STAR_R, 'no reaparece encima');
    assert.ok(s.star.x >= C.STAR_MARGIN && s.star.x <= C.W - C.STAR_MARGIN);
    assert.ok(s.star.y >= C.STAR_MARGIN && s.star.y <= C.H - C.STAR_MARGIN);
    s.hazards.length = 0;
  }
});

test('si dos tocan la estrella a la vez se la lleva el más cercano', () => {
  const s = Sim.createState({ seed: 11, numPlayers: 2 });
  s.star.x = 400;
  s.star.y = 300;
  s.players[0].x = 410;
  s.players[0].y = 300;
  s.players[1].x = 395;
  s.players[1].y = 300;
  Sim.step(s, []);
  assert.equal(s.players[1].stars, 1);
  assert.equal(s.players[0].stars, 0);
});

test('la dificultad sube con el tiempo y tiene tope', () => {
  assert.ok(Sim.hazardSpeed(60) > Sim.hazardSpeed(10));
  assert.ok(Sim.spawnInterval(60) < Sim.spawnInterval(10));
  assert.equal(Sim.hazardSpeed(1e6), C.HAZ_SPEED_MAX);
  assert.equal(Sim.spawnInterval(1e6), C.SPAWN_INTERVAL_MIN);
});

test('hay un respiro inicial sin proyectiles', () => {
  const s = Sim.createState({ seed: 21 });
  for (let t = 0; t < C.SPAWN_GRACE * C.TICK_HZ - 1; t++) Sim.step(s, [null]);
  assert.equal(s.hazards.length, 0);
  for (let t = 0; t < 5; t++) Sim.step(s, [null]);
  assert.equal(s.hazards.length, 1);
});

test('los proyectiles nacen fuera de la arena, lejos de los jugadores, y se retiran al salir', () => {
  const s = Sim.createState({ seed: 31, numPlayers: 2 });
  for (const p of s.players) p.lives = 1e9;
  const seen = new Set();
  let maxOnScreen = 0;
  let nuevos = 0;
  let cerca = 0;
  for (let t = 0; t < 60 * 90; t++) {
    Sim.step(s, [wiggle(s.tick, 0), wiggle(s.tick, 1)]);
    for (const z of s.hazards) {
      if (seen.has(z)) continue;
      seen.add(z);
      nuevos++;
      // Recién nacido: ha avanzado un solo tick desde el borde.
      const fuera = z.x < 0 || z.x > C.W || z.y < 0 || z.y > C.H;
      assert.ok(fuera || Math.min(z.x, C.W - z.x, z.y, C.H - z.y) < 12, 'nace en el borde');
      for (const p of s.players) if (Math.hypot(z.x - p.x, z.y - p.y) < C.SPAWN_SAFE_DIST - 15) cerca++;
    }
    maxOnScreen = Math.max(maxOnScreen, s.hazards.length);
  }
  assert.ok(nuevos > 300, 'en 90 s salen muchos proyectiles: ' + nuevos);
  assert.ok(cerca / nuevos < 0.02, 'casi ninguno nace pegado a un jugador: ' + cerca + '/' + nuevos);
  assert.ok(maxOnScreen < 80, 'los proyectiles se van retirando: máx ' + maxOnScreen);
});

test('quedarse quieto no sirve: el juego acaba matando', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const s = run(seed, 1, 60 * 180, null);
    assert.equal(s.over, true, 'semilla ' + seed + ' sigue viva tras 3 minutos');
  }
});

test('eliminar a un jugador (desconexión) lo saca de la ronda y puede acabarla', () => {
  const s = Sim.createState({ seed: 41, numPlayers: 3 });
  Sim.step(s, []);
  Sim.eliminate(s, 1);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.players[1].deathTick, 1);
  Sim.step(s, []);
  assert.equal(s.over, false, 'quedan dos');
  const score = s.players[1].score;
  Sim.eliminate(s, 0);
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.winner, 2);
  assert.equal(s.players[1].score, score, 'el eliminado ya no puntúa');
  Sim.eliminate(s, 2); // con la ronda acabada no hace nada
  assert.equal(s.players[2].alive, true);
});
