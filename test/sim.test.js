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

test('gana quien más puntos tiene, aunque haya caído antes (tras la prórroga)', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 3, powerups: false });
  s.spawnTimer = 1e9; // sin más proyectiles que los que se ponen a mano
  parkStars(s);
  s.players[0].lives = 1;
  s.players[0].score = 5000; // cogió muchas estrellas
  s.players[2].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  s.hazards.push(hazardAt(s.players[2].x, s.players[2].y));
  Sim.step(s, []);
  // Queda uno en pie, pero va por detrás: no acaba todavía, tiene prórroga.
  assert.equal(s.over, false);
  assert.equal(s.overtime, C.OVERTIME_TICKS);
  assert.ok(s.events.some((e) => e.type === 'overtime'));
  let ticks = 0;
  while (!s.over && ticks < 2000) {
    Sim.step(s, []);
    ticks++;
  }
  assert.equal(ticks, C.OVERTIME_TICKS, 'la prórroga dura lo que dice');
  assert.equal(s.winner, 0, 'no le ha dado tiempo a remontar: gana el que tenía más puntos');
  assert.deepEqual(Sim.ranking(s), [0, 1, 2]);
});

test('prórroga: si el último en pie remonta, gana en ese momento', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 2, powerups: false });
  s.spawnTimer = 1e9;
  parkStars(s);
  s.players[0].lives = 1;
  s.players[0].score = 400;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  assert.equal(s.over, false, 'prórroga');
  // El superviviente coge una estrella de 600 y se pone por delante.
  s.stars[0].x = s.players[1].x;
  s.stars[0].y = s.players[1].y;
  s.stars[0].t = 2;
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.winner, 1);
});

test('prórroga: si el último en pie cae durante ella, se acaba', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 2, powerups: false });
  s.spawnTimer = 1e9;
  parkStars(s);
  s.players[0].lives = 1;
  s.players[0].score = 5000;
  s.players[1].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  assert.equal(s.over, false);
  s.hazards.push(hazardAt(s.players[1].x, s.players[1].y));
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.winner, 0);
});

test('sin prórroga cuando el último en pie ya va primero', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 2, powerups: false });
  s.players[0].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  assert.equal(s.over, true);
  assert.equal(s.overtime, -1);
  assert.equal(s.winner, 1);
});

test('a igualdad de puntos gana quien sigue en pie', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 2 });
  s.players[0].lives = 1;
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, []);
  s.players[0].score = s.players[1].score; // se fuerza el empate
  assert.deepEqual(Sim.ranking(s), [1, 0]);
});

// Aparta todas las estrellas a las esquinas para que un test controle cuáles se tocan.
function parkStars(s) {
  const corners = [[60, 60], [740, 540], [740, 60], [60, 540]];
  s.stars.forEach((st, k) => {
    st.x = corners[k][0];
    st.y = corners[k][1];
    st.t = 1; // todas normales, para que los tests de puntos no dependan del sorteo
  });
}

test('hay varias estrellas a la vez, dentro de la arena y separadas entre sí', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = Sim.createState({ seed: seed, numPlayers: 4 });
    assert.equal(s.stars.length, C.STAR_COUNT);
    assert.equal(C.STAR_COUNT, 3);
    for (let a = 0; a < s.stars.length; a++) {
      const st = s.stars[a];
      assert.ok(st.x >= C.STAR_MARGIN && st.x <= C.W - C.STAR_MARGIN && st.y >= C.STAR_MARGIN && st.y <= C.H - C.STAR_MARGIN);
      for (let b = a + 1; b < s.stars.length; b++) {
        assert.ok(Math.hypot(st.x - s.stars[b].x, st.y - s.stars[b].y) >= C.STAR_MIN_SEP - 1e-9, 'semilla ' + seed);
      }
    }
  }
});

test('las estrellas no aparecen encima ni cerca de ningún jugador', () => {
  // Partidas reales con jugadores que persiguen estrellas: se mide cada estrella al aparecer.
  const chase = (s, i) => {
    const p = s.players[i];
    let best = s.stars[0];
    for (const st of s.stars) if (Math.hypot(st.x - p.x, st.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = st;
    return { mx: Math.abs(best.x - p.x) > 3 ? Math.sign(best.x - p.x) : 0, my: Math.abs(best.y - p.y) > 3 ? Math.sign(best.y - p.y) : 0 };
  };
  for (const n of [1, 2, 4, 6]) {
    let total = 0;
    let cumplen = 0;
    let peor = Infinity;
    const medir = (s, st) => {
      const need = Sim.starPlayerDist(s);
      let d = Infinity;
      for (const p of s.players) if (p.alive) d = Math.min(d, Math.hypot(st.x - p.x, st.y - p.y));
      total++;
      if (d >= need - 1e-9) cumplen++;
      peor = Math.min(peor, d / need);
    };
    for (let seed = 1; seed <= 12; seed++) {
      const s = Sim.createState({ seed: seed, numPlayers: n, lives: 5, hazard: 0 });
      s.stars.forEach((st) => medir(s, st));
      for (let t = 0; t < 60 * 15 && !s.over; t++) {
        const antes = s.stars.map((st) => st.x + ',' + st.y);
        Sim.step(s, s.players.map((_, i) => chase(s, i)));
        s.stars.forEach((st, k) => {
          if (st.x + ',' + st.y !== antes[k]) medir(s, st);
        });
      }
    }
    assert.ok(total > 60, n + ' jugadores: ' + total + ' estrellas medidas');
    assert.ok(cumplen / total > 0.97, n + ' jugadores: ' + cumplen + ' de ' + total + ' aparecen a la distancia pedida');
    assert.ok(peor > 0.6, n + ' jugadores: la peor aparece al ' + (peor * 100).toFixed(0) + ' % de la distancia pedida');
  }
});

test('con más jugadores en pie, las estrellas aparecen más lejos de ellos', () => {
  const dist = (n) => Sim.starPlayerDist(Sim.createState({ seed: 1, numPlayers: n }));
  assert.equal(dist(1), C.STAR_PLAYER_DIST);
  assert.ok(dist(2) > dist(1) && dist(4) > dist(2) && dist(6) > dist(4));
  assert.equal(dist(6), 160);
  const s = Sim.createState({ seed: 1, numPlayers: 6 });
  s.players[0].alive = false;
  assert.equal(Sim.starPlayerDist(s), 150, 'solo cuentan los que siguen en pie');
});

test('coger una estrella da puntos y la recoloca lejos de quien la cogió y de las otras', () => {
  const s = Sim.createState({ seed: 11 });
  const p = s.players[0];
  parkStars(s);
  for (let n = 0; n < 50; n++) {
    const k = n % C.STAR_COUNT;
    s.stars[k].x = p.x;
    s.stars[k].y = p.y;
    s.stars[k].t = 1;
    p.combo = 0; // sin racha: aquí se mide lo que vale una estrella suelta
    const before = p.score;
    Sim.step(s, [null]);
    assert.equal(p.score, before + 1 + C.STAR_POINTS);
    assert.equal(p.stars, n + 1);
    assert.equal(s.stars.length, C.STAR_COUNT, 'siempre hay las mismas en la arena');
    const st = s.stars[k];
    assert.ok(Math.hypot(st.x - p.x, st.y - p.y) >= C.STAR_RESPAWN_DIST - 1e-9, 'reaparece lejos de quien la cogió');
    assert.ok(st.x >= C.STAR_MARGIN && st.x <= C.W - C.STAR_MARGIN);
    assert.ok(st.y >= C.STAR_MARGIN && st.y <= C.H - C.STAR_MARGIN);
    s.hazards.length = 0;
  }
});

test('un jugador puede coger dos estrellas en el mismo tick', () => {
  const s = Sim.createState({ seed: 11 });
  const p = s.players[0];
  parkStars(s);
  s.stars[0].x = p.x + 5;
  s.stars[0].y = p.y;
  s.stars[2].x = p.x - 5;
  s.stars[2].y = p.y;
  Sim.step(s, [null]);
  assert.equal(p.stars, 2);
  assert.equal(p.score, 1 + 2 * C.STAR_POINTS);
  assert.equal(p.combo, 2, 'y ya lleva dos de racha');
});

test('estrellas de tres tamaños: la pequeña vale más y hay que acercarse más', () => {
  assert.deepEqual(Sim.STAR_TIERS.map((t) => t.points), [150, 300, 600]);
  assert.ok(Sim.STAR_TIERS[0].r > Sim.STAR_TIERS[1].r && Sim.STAR_TIERS[1].r > Sim.STAR_TIERS[2].r);
  for (let t = 0; t < 3; t++) {
    const tier = Sim.STAR_TIERS[t];
    const s = Sim.createState({ seed: 11, powerups: false });
    s.spawnTimer = 1e9;
    parkStars(s);
    const p = s.players[0];
    // Justo fuera de su alcance no se coge; justo dentro, sí, y da sus puntos.
    s.stars[0].t = t;
    s.stars[0].x = p.x + C.PLAYER_R + tier.r + 1;
    s.stars[0].y = p.y;
    Sim.step(s, [null]);
    assert.equal(p.stars, 0, 'tamaño ' + t + ': fuera de alcance');
    s.stars[0].x = p.x + C.PLAYER_R + tier.r - 1;
    const before = p.score;
    Sim.step(s, [null]);
    assert.equal(p.score, before + 1 + tier.points, 'tamaño ' + t);
    assert.deepEqual(s.events.filter((e) => e.type === 'star').map((e) => e.k), [t]);
  }
  // En una partida salen de los tres tamaños, y la normal es la más frecuente.
  const count = [0, 0, 0];
  for (let seed = 1; seed <= 300; seed++) for (const st of Sim.createState({ seed: seed }).stars) count[st.t]++;
  assert.ok(count[1] > count[2] && count[2] > count[0] && count[0] > 100, 'reparto: ' + count);
});

test('racha: la tercera estrella seguida vale el doble, la sexta el triple, y se pierde si tardas', () => {
  const s = Sim.createState({ seed: 11, powerups: false });
  s.spawnTimer = 1e9;
  parkStars(s);
  const p = s.players[0];
  const coger = () => {
    s.stars[0].x = p.x;
    s.stars[0].y = p.y;
    s.stars[0].t = 1;
    const before = p.score;
    Sim.step(s, [null]);
    parkStars(s);
    return p.score - before - 1;
  };
  assert.deepEqual([coger(), coger(), coger(), coger(), coger(), coger(), coger()], [300, 300, 600, 600, 600, 900, 900]);
  assert.equal(Sim.comboMult(p), 3);
  // Pasa el plazo sin coger ninguna: la racha se pierde.
  for (let t = 0; t < C.COMBO_WINDOW; t++) Sim.step(s, [null]);
  assert.equal(p.combo, 0);
  assert.equal(coger(), 300);
  // Racha y mejora "doble" se multiplican entre sí.
  p.combo = 5;
  p.comboT = 100;
  p.double = 100;
  assert.equal(coger(), 300 * 3 * 2 + 1, 'x3 de racha, x2 de doble (y el punto extra del tick doble)');
});

// ---------- Enemigos por dificultad ----------

function kindsSeen(hazard, seconds) {
  const s = Sim.createState({ seed: 5, hazard: hazard, powerups: false });
  s.players[0].lives = 1e9;
  const seen = new Set();
  const kinds = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 60 * seconds; t++) {
    Sim.step(s, [wiggle(s.tick, 0)]);
    for (const z of s.hazards) {
      if (seen.has(z)) continue;
      seen.add(z);
      kinds[z.k]++;
    }
  }
  return kinds;
}

test('cada dificultad añade enemigos a la anterior', () => {
  const suave = kindsSeen(0, 80);
  const normal = kindsSeen(1, 80);
  const intensa = kindsSeen(2, 80);
  const imposible = kindsSeen(3, 60);
  assert.deepEqual(suave.slice(1), [0, 0, 0, 0, 0], 'suave: solo normales');
  assert.ok(normal[1] > 0 && normal[2] > 0, 'normal: rebotan y ráfagas');
  assert.deepEqual(normal.slice(3), [0, 0, 0], 'normal: ni pesados, ni minas, ni zigzag');
  assert.ok(intensa[4] > 0 && intensa[5] > 0, 'intensa: minas y zigzag: ' + intensa);
  assert.equal(intensa[3], 0, 'intensa: sin pesados');
  assert.ok(imposible[3] > 0 && imposible[4] > 0 && imposible[5] > 0 && imposible[1] > 0, 'imposible: de todo: ' + imposible);
  // El normal sigue siendo el tipo más frecuente en todas (las ráfagas cuentan por tres).
  for (const k of [suave, normal, intensa, imposible]) assert.ok(k[0] > Math.max(k[1], k[2], k[3], k[4], k[5]), 'el normal es el más frecuente: ' + k);
});

test('pesado: quita dos vidas (y el escudo lo para entero)', () => {
  const s = Sim.createState({ seed: 9, powerups: false });
  s.spawnTimer = 1e9;
  const p = s.players[0];
  s.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: C.HEAVY_R, k: 3, b: 0 });
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 2);
  p.inv = 0;
  p.shield = 100;
  s.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: C.HEAVY_R, k: 3, b: 0 });
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 2, 'el escudo absorbe el golpe entero');
  p.inv = 0;
  s.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: C.HEAVY_R, k: 3, b: 0 });
  Sim.step(s, [null]);
  assert.equal(p.alive, false, 'con una vida, un pesado elimina');
});

test('mina: llega a su punto, se queda parada el tiempo justo y desaparece', () => {
  const s = Sim.createState({ seed: 9, powerups: false });
  s.spawnTimer = 1e9;
  s.players[0].x = 60;
  s.players[0].y = 60;
  s.hazards.push({ x: 0, y: 300, vx: 200, vy: 0, r: 11, k: 4, b: 0, e1: 1.5, e2: C.MINE_HOLD, e3: 0 }); // 300 px de viaje
  const z = s.hazards[0];
  let viaje = 0;
  while (z.vx !== 0 && viaje < 200) {
    Sim.step(s, [null]);
    viaje++;
  }
  assert.ok(viaje >= 90 && viaje <= 91, 'tarda 1,5 s en llegar: ' + viaje + ' ticks');
  assert.ok(Math.abs(z.x - 300) < 1e-6, 'se para a los 300 px: ' + z.x);
  let parada = 0;
  while (s.hazards.length && parada < 1000) {
    Sim.step(s, [null]);
    parada++;
    if (s.hazards.length) assert.ok(Math.abs(z.x - 300) < 1e-6, 'mientras tanto no se mueve');
  }
  assert.ok(Math.abs(parada - C.MINE_HOLD * 60) <= 2, 'aguanta parada 4 s y desaparece: ' + parada + ' ticks');
});

test('mina parada: quita una vida a quien la pisa', () => {
  const s = Sim.createState({ seed: 9, powerups: false });
  s.spawnTimer = 1e9;
  const p = s.players[0];
  s.hazards.push({ x: p.x + 100, y: p.y, vx: 0, vy: 0, r: 11, k: 4, b: 0, e1: 0, e2: 3, e3: 0 });
  for (let t = 0; t < 30; t++) Sim.step(s, [{ mx: 1, my: 0 }]);
  assert.equal(p.lives, C.LIVES - 1);
});

test('zigzag: avanza en su dirección serpenteando a los lados', () => {
  const z = { x: 0, y: 300, vx: 200, vy: 0, r: 9, k: 5, b: 0, e1: 200, e2: 0, e3: 0 };
  let minY = Infinity;
  let maxY = -Infinity;
  for (let t = 0; t < 180; t++) {
    Sim.moveHazard(z, C.DT);
    minY = Math.min(minY, z.y);
    maxY = Math.max(maxY, z.y);
  }
  assert.ok(Math.abs(z.x - 600) < 1e-6, 'avanza a su velocidad de base: ' + z.x);
  assert.ok(maxY - 300 > C.ZIGZAG_AMP * 0.9 && 300 - minY > C.ZIGZAG_AMP * 0.9, 'se desvía a ambos lados: ' + minY.toFixed(0) + '..' + maxY.toFixed(0));
  assert.ok(maxY - 300 < C.ZIGZAG_AMP * 1.1);
});

test('hazardPos predice también minas y zigzag', () => {
  for (const z0 of [
    { x: 0, y: 300, vx: 240, vy: 30, r: 11, k: 4, b: 0, e1: 0.4, e2: 0.3, e3: 0 },
    { x: 100, y: 100, vx: 180, vy: 90, r: 9, k: 5, b: 0, e1: 180, e2: 90, e3: 1.3 },
  ]) {
    const real = Sim.copyHazard(z0, {});
    const out = { x: 0, y: 0 };
    for (let t = 1; t <= 36; t++) {
      if (!real.dead) Sim.moveHazard(real, C.DT);
      Sim.hazardPos(z0, t * C.DT, out);
      assert.ok(Math.abs(out.x - real.x) < 1e-6 && Math.abs(out.y - real.y) < 1e-6, 'tipo ' + z0.k + ', tick ' + t);
    }
  }
});


test('con tres estrellas ya no se las lleva todas quien tenga suerte con la primera', () => {
  // Dos jugadores que van siempre a por su estrella más cercana: el reparto debe ser
  // razonablemente parejo a lo largo de muchas partidas.
  const chase = (s, i) => {
    const p = s.players[i];
    let best = s.stars[0];
    for (const st of s.stars) if (Math.hypot(st.x - p.x, st.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = st;
    return { mx: Math.abs(best.x - p.x) > 3 ? Math.sign(best.x - p.x) : 0, my: Math.abs(best.y - p.y) > 3 ? Math.sign(best.y - p.y) : 0 };
  };
  let a = 0;
  let b = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = Sim.createState({ seed: seed, numPlayers: 2, lives: 5, hazard: 0 });
    for (let t = 0; t < 60 * 12 && !s.over; t++) Sim.step(s, [chase(s, 0), chase(s, 1)]);
    a += s.players[0].stars;
    b += s.players[1].stars;
  }
  assert.ok(a + b > 150, 'se cogen muchas estrellas: ' + (a + b));
  assert.ok(Math.min(a, b) / Math.max(a, b) > 0.75, 'reparto parejo: ' + a + ' / ' + b);
});

test('las vidas se pueden elegir entre 1 y 5 (3 por defecto)', () => {
  assert.equal(Sim.createState({ seed: 1 }).players[0].lives, 3);
  assert.equal(Sim.createState({ seed: 1 }).maxLives, 3);
  for (const [pedido, real] of [[1, 1], [2, 2], [5, 5], [0, 1], [-3, 1], [99, 5], [undefined, 3]]) {
    const s = Sim.createState({ seed: 1, numPlayers: 2, lives: pedido });
    assert.equal(s.maxLives, real, 'pedido ' + pedido);
    assert.ok(s.players.every((p) => p.lives === real));
  }
  // Con 1 vida, el primer impacto elimina.
  const s = Sim.createState({ seed: 1, lives: 1 });
  s.hazards.push(hazardAt(s.players[0].x, s.players[0].y));
  Sim.step(s, [null]);
  assert.equal(s.over, true);
});

test('la dificultad de los proyectiles cambia su velocidad y su ritmo', () => {
  for (const t of [0, 20, 60]) {
    assert.ok(Sim.hazardSpeed(t, 0) < Sim.hazardSpeed(t, 1) && Sim.hazardSpeed(t, 1) < Sim.hazardSpeed(t, 2));
    assert.ok(Sim.hazardSpeed(t, 2) < Sim.hazardSpeed(t, 3), 'imposible es más rápida que intensa');
    assert.ok(Sim.spawnInterval(t, 0) > Sim.spawnInterval(t, 1) && Sim.spawnInterval(t, 1) > Sim.spawnInterval(t, 2));
    assert.ok(Sim.spawnInterval(t, 2) > Sim.spawnInterval(t, 3));
    assert.equal(Sim.hazardSpeed(t), Sim.hazardSpeed(t, 1), 'por defecto, normal');
    assert.equal(Sim.spawnInterval(t), Sim.spawnInterval(t, 1));
  }
  // En una partida real: más proyectiles nacidos y más rápidos cuanto más alta.
  const medir = (hazard) => {
    const s = Sim.createState({ seed: 77, hazard: hazard, lives: 5 });
    s.players[0].lives = 1e9;
    const seen = new Set();
    let speed = 0;
    for (let t = 0; t < 60 * 40; t++) {
      Sim.step(s, [wiggle(s.tick, 0)]);
      for (const z of s.hazards) {
        if (seen.has(z)) continue;
        seen.add(z);
        speed += Math.hypot(z.vx, z.vy);
      }
    }
    return { n: seen.size, speed: speed / seen.size };
  };
  const suave = medir(0);
  const normal = medir(1);
  const intensa = medir(2);
  assert.ok(suave.n < normal.n * 0.85 && normal.n < intensa.n * 0.85, 'ritmo: ' + [suave.n, normal.n, intensa.n]);
  assert.ok(suave.speed < normal.speed * 0.9 && normal.speed < intensa.speed * 0.9, 'velocidad');
  assert.equal(Sim.createState({ seed: 1, hazard: 9 }).hazard, 3, 'fuera de rango se recorta');
  assert.equal(Sim.createState({ seed: 1 }).hazard, C.HAZARD_DEFAULT);
});

test('toda ronda acaba también con proyectiles suaves y 5 vidas', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const s = Sim.createState({ seed: seed, hazard: 0, lives: 5 });
    for (let t = 0; t < 60 * 300 && !s.over; t++) Sim.step(s, [null]);
    assert.equal(s.over, true, 'semilla ' + seed);
  }
});

test('si dos tocan la estrella a la vez se la lleva el más cercano', () => {
  const s = Sim.createState({ seed: 11, numPlayers: 2 });
  parkStars(s);
  s.stars[1].x = 400;
  s.stars[1].y = 300;
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

// ---------- Proyectiles especiales ----------

test('los proyectiles que rebotan cambian de sentido en la pared y luego salen', () => {
  const z = { x: 780, y: 300, vx: 300, vy: 0, r: 10, k: 1, b: 1 };
  let rebotes = 0;
  let vxAntes = z.vx;
  for (let t = 0; t < 600; t++) {
    Sim.moveHazard(z, C.DT);
    if (Math.sign(z.vx) !== Math.sign(vxAntes)) rebotes++;
    vxAntes = z.vx;
    if (z.b > 0) assert.ok(z.x <= C.W - z.r + 1e-9, 'mientras le quedan rebotes no cruza la pared');
  }
  assert.equal(rebotes, 1);
  assert.equal(z.b, 0);
  assert.ok(z.x < -C.OUT_MARGIN, 'gastados los rebotes, acaba saliendo por el otro lado');
});

test('un proyectil recién nacido fuera de la arena entra sin rebotar', () => {
  const z = { x: -10, y: 300, vx: 300, vy: 0, r: 10, k: 1, b: 2 };
  Sim.moveHazard(z, C.DT);
  assert.equal(z.vx, 300);
  assert.equal(z.b, 2);
});

test('hazardPos predice exactamente dónde estará un proyectil, rebotes incluidos', () => {
  for (const z0 of [
    { x: 100, y: 100, vx: 250, vy: -180, r: 9, k: 0, b: 0 },
    { x: 700, y: 520, vx: 330, vy: 280, r: 12, k: 1, b: 2 },
    { x: 60, y: 40, vx: -400, vy: -150, r: 8, k: 1, b: 1 },
  ]) {
    const real = Object.assign({}, z0);
    const out = { x: 0, y: 0 };
    for (let t = 1; t <= 45; t++) {
      Sim.moveHazard(real, C.DT);
      Sim.hazardPos(z0, t * C.DT, out);
      assert.ok(Math.abs(out.x - real.x) < 1e-6 && Math.abs(out.y - real.y) < 1e-6, 'tick ' + t);
    }
    assert.equal(z0.b, z0.k === 0 ? 0 : z0.b, 'no modifica el original');
  }
});

test('aparecen proyectiles que rebotan y ráfagas, pero no al principio', () => {
  const s = Sim.createState({ seed: 5, powerups: false });
  s.players[0].lives = 1e9;
  const seen = new Set();
  const kinds = [0, 0, 0];
  let tempranos = 0;
  for (let t = 0; t < 60 * 70; t++) {
    Sim.step(s, [wiggle(s.tick, 0)]);
    for (const z of s.hazards) {
      if (seen.has(z)) continue;
      seen.add(z);
      kinds[z.k]++;
      if (z.k !== 0 && s.tick < C.BOUNCER_FROM * 60) tempranos++;
    }
  }
  assert.equal(tempranos, 0, 'los primeros segundos solo hay proyectiles normales');
  assert.ok(kinds[0] > kinds[1] && kinds[0] > kinds[2], 'la mayoría son normales: ' + kinds);
  assert.ok(kinds[1] > 5, 'hay rebotadores: ' + kinds[1]);
  assert.ok(kinds[2] >= 9 && kinds[2] % 3 === 0, 'las ráfagas son de tres: ' + kinds[2]);
});

// ---------- Mejoras ----------

const POWER = { turbo: 0, ghost: 1, shield: 2, heart: 3, bomb: 4, double: 5, magnet: 6 };

function quiet(opts) {
  const s = Sim.createState(Object.assign({ seed: 61 }, opts));
  s.spawnTimer = 1e9; // sin proyectiles
  s.powerTimer = 1e9; // ni mejoras espontáneas
  parkStars(s);
  return s;
}

function give(s, type) {
  const p = s.players[0];
  s.powerups.push({ x: p.x, y: p.y, type: type, ttl: 100 });
  Sim.step(s, [null]);
  return p;
}

test('las mejoras aparecen cada pocos segundos, lejos de los jugadores, y caducan', () => {
  const s = Sim.createState({ seed: 9, numPlayers: 2, lives: 5, hazard: 0 });
  for (const p of s.players) p.lives = 1e9;
  let nacidas = 0;
  let cerca = 0;
  const seen = new Set();
  let max = 0;
  for (let t = 0; t < 60 * 120; t++) {
    Sim.step(s, [null, null]);
    for (const u of s.powerups) {
      if (seen.has(u)) continue;
      seen.add(u);
      nacidas++;
      assert.ok(u.type >= 0 && u.type < Sim.POWERS.length);
      for (const p of s.players) if (Math.hypot(u.x - p.x, u.y - p.y) < Sim.starPlayerDist(s) - 1e-9) cerca++;
    }
    max = Math.max(max, s.powerups.length);
  }
  assert.ok(nacidas >= 8 && nacidas <= 22, 'en 2 minutos nacen unas cuantas: ' + nacidas);
  assert.equal(cerca, 0, 'ninguna nace al lado de un jugador quieto');
  assert.ok(max <= C.POWER_MAX);
  // Nadie las coge (los jugadores no se mueven): al final no se acumulan, caducan.
  assert.ok(s.powerups.length <= C.POWER_MAX);
});

test('sin mejoras en las reglas, no aparece ninguna', () => {
  const s = Sim.createState({ seed: 9, powerups: false });
  s.players[0].lives = 1e9;
  for (let t = 0; t < 60 * 60; t++) Sim.step(s, [wiggle(s.tick, 0)]);
  assert.equal(s.power, 0);
  assert.equal(s.powerups.length, 0);
});

test('turbo: te mueves más rápido mientras dura', () => {
  const s = quiet();
  const p = give(s, POWER.turbo);
  assert.equal(p.turbo, Sim.POWERS[POWER.turbo].ticks);
  const x0 = p.x;
  Sim.step(s, [{ mx: 1, my: 0 }]);
  assert.ok(Math.abs(p.x - x0 - C.PLAYER_SPEED * C.TURBO_SPEED * C.DT) < 1e-9);
  p.turbo = 0;
  const x1 = p.x;
  Sim.step(s, [{ mx: 1, my: 0 }]);
  assert.ok(Math.abs(p.x - x1 - C.PLAYER_SPEED * C.DT) < 1e-9);
});

test('fantasma: los proyectiles te atraviesan, y al acabarse vuelves a ser sólido', () => {
  const s = quiet();
  const p = give(s, POWER.ghost);
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES, 'intangible');
  assert.equal(s.hazards.length, 1, 'el proyectil sigue su camino');
  p.ghost = 1;
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 1, 'se acabó el efecto con un proyectil encima');
});

test('escudo: absorbe un impacto sin perder vida, y solo uno', () => {
  const s = quiet();
  const p = give(s, POWER.shield);
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES);
  assert.equal(p.shield, 0);
  assert.equal(s.hazards.length, 0, 'el proyectil se consume');
  assert.ok(s.events.some((e) => e.type === 'shield'));
  p.inv = 0;
  s.hazards.push(hazardAt(p.x, p.y));
  Sim.step(s, [null]);
  assert.equal(p.lives, C.LIVES - 1, 'el segundo impacto ya quita vida');
});

test('corazón: una vida más hasta el máximo; con todas, puntos', () => {
  const s = quiet();
  const p = s.players[0];
  p.lives = 1;
  give(s, POWER.heart);
  assert.equal(p.lives, 2);
  p.lives = s.maxLives;
  const antes = p.score;
  give(s, POWER.heart);
  assert.equal(p.lives, s.maxLives);
  assert.equal(p.score, antes + 1 + C.HEART_POINTS);
});

test('bomba: destruye los proyectiles cercanos y deja los lejanos', () => {
  const s = quiet();
  const p = s.players[0];
  s.hazards.push(hazardAt(p.x + 100, p.y), hazardAt(p.x - 150, p.y + 100), hazardAt(p.x + C.BOMB_R + 60, p.y));
  give(s, POWER.bomb);
  assert.equal(s.hazards.length, 1);
  assert.ok(Math.abs(s.hazards[0].x - (p.x + C.BOMB_R + 60)) < 1e-9);
  assert.ok(s.events.some((e) => e.type === 'bomb'));
});

test('doble: el tiempo y las estrellas puntúan el doble', () => {
  const s = quiet();
  const p = give(s, POWER.double);
  const antes = p.score;
  Sim.step(s, [null]);
  assert.equal(p.score, antes + 2);
  s.stars[0].x = p.x;
  s.stars[0].y = p.y;
  s.stars[0].t = 1;
  const antes2 = p.score;
  Sim.step(s, [null]);
  assert.equal(p.score, antes2 + 2 + 2 * C.STAR_POINTS);
  assert.equal(p.stars, 1, 'cuenta como una estrella');
});

test('imán: las estrellas se cogen desde lejos', () => {
  const s = quiet();
  const p = s.players[0];
  s.stars[0].x = p.x + 100;
  s.stars[0].y = p.y;
  Sim.step(s, [null]);
  assert.equal(p.stars, 0, 'sin imán, a 100 px no se coge');
  give(s, POWER.magnet);
  Sim.step(s, [null]); // el efecto empieza en el tick siguiente a coger la mejora
  assert.equal(p.stars, 1);
});

test('el corazón solo sale si a alguien le falta una vida', () => {
  const tipos = (lives) => {
    const s = Sim.createState({ seed: 3, lives: 3 });
    s.spawnTimer = 1e9;
    s.players[0].lives = lives;
    const seen = new Set();
    for (let t = 0; t < 60 * 400; t++) {
      Sim.step(s, [null]);
      for (const u of s.powerups) seen.add(u.type);
    }
    return seen;
  };
  assert.equal(tipos(3).has(POWER.heart), false);
  assert.equal(tipos(1).has(POWER.heart), true);
  assert.equal(tipos(3).size, Sim.POWERS.length - 1, 'en 400 s salen todas las demás');
});

test('si dos tocan una mejora a la vez se la lleva el más cercano, y emite un evento', () => {
  const s = quiet({ numPlayers: 2 });
  s.players[0].x = 410;
  s.players[0].y = 300;
  s.players[1].x = 395;
  s.players[1].y = 300;
  s.powerups.push({ x: 400, y: 300, type: POWER.turbo, ttl: 100 });
  Sim.step(s, []);
  assert.equal(s.players[1].turbo > 0, true);
  assert.equal(s.players[0].turbo, 0);
  assert.equal(s.powerups.length, 0);
  assert.deepEqual(s.events.filter((e) => e.type === 'power').map((e) => [e.p, e.k]), [[1, POWER.turbo]]);
});
