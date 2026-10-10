'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../js/sim.js');
const Netcode = require('../js/netcode.js');
const T = require('../train/common.js');
const { createWorld, seenState, STEP } = require('./helpers/fakenet.js');
const C = Sim.C;

const idleBot = function () {
  const a = { mx: 0, my: 0 };
  return function () {
    return a;
  };
};

// Lleva la sala hasta que la ronda está en juego.
function startRound(w, seed) {
  w.run(10);
  assert.ok(w.host.start(seed || 7));
  w.run(Netcode.COUNTDOWN_TICKS + 12);
  assert.equal(w.host.phase, 'playing');
}

test('la instantánea codificada reproduce el estado (con precisión de 0,1 px)', () => {
  const s = Sim.createState({ seed: 3, numPlayers: 3 });
  for (let t = 0; t < 600; t++) Sim.step(s, [{ mx: 1, my: 0 }, { mx: 0, my: -1 }, null]);
  const wire = JSON.parse(JSON.stringify(Netcode.encodeSnapshot(s, 4, s.events)));
  const v = Netcode.decodeSnapshot(wire);
  assert.equal(v.tick, s.tick);
  assert.equal(v.players.length, 3);
  assert.equal(v.hazards.length, s.hazards.length);
  s.players.forEach((p, i) => {
    assert.ok(Math.abs(v.players[i].x - p.x) <= 0.05 + 1e-9 && Math.abs(v.players[i].y - p.y) <= 0.05 + 1e-9);
    assert.equal(v.players[i].lives, p.lives);
    assert.equal(v.players[i].score, p.score);
    assert.equal(v.players[i].alive, p.alive);
  });
  s.hazards.forEach((z, i) => {
    assert.ok(Math.abs(v.hazards[i].x - z.x) <= 0.05 + 1e-9 && Math.abs(v.hazards[i].vx - z.vx) <= 0.05 + 1e-9);
  });
  assert.equal(v.stars.length, 3);
  s.stars.forEach((st, i) => {
    assert.ok(Math.abs(v.stars[i].x - st.x) <= 0.05 + 1e-9 && Math.abs(v.stars[i].y - st.y) <= 0.05 + 1e-9);
  });
  assert.equal(v.maxLives, 3);
});

test('la instantánea lleva mejoras, efectos de los jugadores y tipo de proyectil', () => {
  const s = Sim.createState({ seed: 8, numPlayers: 2 });
  s.players[0].turbo = 120;
  s.players[1].ghost = 33;
  s.players[1].shield = 400;
  s.players[0].double = 7;
  s.players[1].magnet = 9;
  s.powerups.push({ x: 123.4, y: 456.7, type: 5, ttl: 321 });
  s.hazards.push({ x: 50, y: 60, vx: 100, vy: -200, r: 9, k: 1, b: 2 }, { x: 70, y: 80, vx: -90, vy: 10, r: 8, k: 2, b: 0 });
  const wire = JSON.parse(JSON.stringify(Netcode.encodeSnapshot(s, 1, [{ type: 'power', p: 1, k: 6, x: 10, y: 20 }, { type: 'bomb', p: 0, x: 1, y: 2 }])));
  const v = Netcode.decodeSnapshot(wire);
  assert.deepEqual([v.players[0].turbo, v.players[0].double, v.players[1].ghost, v.players[1].shield, v.players[1].magnet], [120, 7, 33, 400, 9]);
  assert.deepEqual(v.powerups, [{ type: 5, x: 123.4, y: 456.7, ttl: 321 }]);
  assert.deepEqual(v.hazards.map((z) => [z.k, z.b]), [[1, 2], [2, 0]]);
});

test('con turbo, la predicción del invitado sigue coincidiendo con el anfitrión', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 50);
  w.host.setRules(3, 1, false); // sin mejoras espontáneas: el turbo se da a mano
  startRound(w);
  w.host.state.players.forEach((p) => (p.lives = 1e9));
  w.host.state.players[1].turbo = 200;
  w.run(20); // que le llegue la noticia
  bea.input.mx = 1;
  const xs = [];
  w.run(60, () => xs.push(bea.net.view(w.now()).state.players[1].x));
  bea.input.mx = 0;
  const paso = xs[40] - xs[39];
  assert.ok(Math.abs(paso - C.PLAYER_SPEED * C.TURBO_SPEED * C.DT) < 0.3, 'se ve avanzar a velocidad de turbo: ' + paso.toFixed(2));
  w.run(40);
  const h = w.host.state.players[1];
  assert.ok(Math.abs(h.x - bea.net.view(w.now()).state.players[1].x) < 0.5, 'y acaban en el mismo sitio');
});

test('la regla de mejoras la fija el anfitrión y llega a los invitados', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  w.run(5);
  assert.equal(bea.net.room.power, 1, 'por defecto, con mejoras');
  w.host.setRules(3, 3, false);
  w.run(5);
  assert.equal(bea.net.room.power, 0);
  assert.equal(bea.net.room.hazard, 3, 'dificultad imposible');
  w.host.start(4);
  assert.equal(w.host.state.power, 0);
  assert.equal(w.host.state.hazard, 3);
});

test('reglas de la ronda: el anfitrión elige vidas y dificultad, y los invitados las ven', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  w.host.setRules(5, 2);
  w.run(10);
  assert.equal(bea.net.room.lives, 5);
  assert.equal(bea.net.room.hazard, 2);
  w.host.start(7);
  w.run(Netcode.COUNTDOWN_TICKS + 12);
  assert.equal(w.host.state.maxLives, 5);
  assert.equal(w.host.state.hazard, 2);
  const v = bea.net.view(w.now());
  assert.equal(v.state.maxLives, 5, 'el invitado sabe cuántas vidas dibujar');
  assert.ok(v.state.players.every((p) => p.lives === 5));
  assert.equal(v.state.stars.length, 3);

  // Valores absurdos se recortan; por defecto, 3 vidas y dificultad normal.
  const otro = createWorld();
  assert.equal(otro.host.lives, 3);
  assert.equal(otro.host.hazard, 1);
  otro.host.setRules(40, -2);
  assert.equal(otro.host.lives, 5);
  assert.equal(otro.host.hazard, 0);
  otro.host.setRules(3, 99);
  assert.equal(otro.host.hazard, 3);
});

test('sala: entrar, ver la lista de jugadores y recibir la configuración', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  const col = w.addClient('  <b>Col</b> con nombre larguísimo ', 30);
  w.host.setBots(2, 1);
  w.run(10);
  assert.deepEqual(w.host.members.map((m) => m.name), ['Ana', 'Bea', 'bCol/b con n']);
  assert.equal(bea.net.phase, 'lobby');
  assert.equal(bea.net.room.me, 1);
  assert.equal(col.net.room.me, 2);
  assert.equal(bea.net.room.members[0].host, true);
  assert.equal(bea.net.room.bots, 2);
  assert.equal(bea.net.room.level, 1);
});

test('se rechaza a quien trae otra versión del protocolo y a quien llega con la sala llena', () => {
  const w = createWorld();
  const viejo = w.addClient('Viejo', 10, 999);
  w.run(5);
  assert.equal(viejo.net.bye, 'version');
  assert.equal(w.host.members.length, 1);

  const ok = [];
  for (let i = 0; i < 5; i++) ok.push(w.addClient('J' + i, 10));
  const sobra = w.addClient('Sobra', 10);
  w.run(5);
  assert.equal(w.host.members.length, C.MAX_PLAYERS);
  assert.equal(sobra.net.bye, 'full');
  assert.ok(ok.every((c) => c.net.bye === null));
});

test('ronda: cada uno sabe quién es, los bots rellenan hasta 6 y la cuenta atrás llega', () => {
  const w = createWorld({ makeBot: idleBot });
  const bea = w.addClient('Bea', 40);
  w.host.setBots(5, 0);
  w.run(10);
  w.host.start(7);
  w.run(20);
  assert.equal(bea.net.phase, 'countdown');
  const v = bea.net.view(w.now());
  assert.equal(v.countdown, 3);
  assert.equal(v.localIdx, 1);
  assert.equal(v.state.players.length, 6, 'dos humanos + 4 bots, no 5');
  assert.deepEqual(v.meta.map((m) => m.kind), ['human', 'remote', 'bot', 'bot', 'bot', 'bot']);
  w.run(Netcode.COUNTDOWN_TICKS);
  assert.equal(bea.net.phase, 'playing');
  assert.equal(bea.net.view(w.now()).countdown, 0);
});

test('predicción: con retraso fijo, el invitado se ve exactamente donde el anfitrión lo pondrá', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 50); // 100 ms de ida y vuelta
  startRound(w);
  w.host.state.players.forEach((p) => (p.lives = 1e9));

  const seenByClient = [];
  const hostX = () => w.host.state.players[1].x;
  bea.input.mx = 1;
  w.run(60, () => seenByClient.push(bea.net.view(w.now()).state.players[1].x));
  bea.input.mx = 0;
  const atRelease = seenByClient[seenByClient.length - 1];
  // Al soltar, el invitado ya se ve donde el anfitrión aún tardará en ponerlo...
  assert.ok(atRelease - hostX() > 15, 'la predicción va por delante: ' + (atRelease - hostX()).toFixed(1) + ' px');
  // ...y sin tirones: cada tick avanza justo lo que se mueve un jugador.
  for (let i = 1; i < seenByClient.length; i++) {
    const d = seenByClient[i] - seenByClient[i - 1];
    assert.ok(Math.abs(d - C.PLAYER_SPEED * C.DT) < 0.2, 'paso ' + i + ': ' + d.toFixed(3));
  }
  w.run(30);
  assert.ok(Math.abs(hostX() - atRelease) < 0.2, 'el anfitrión acaba donde el invitado se veía');
  assert.ok(Math.abs(bea.net.view(w.now()).state.players[1].x - hostX()) < 0.2);
});

test('predicción con red irregular: las correcciones son pequeñas y acaba convergiendo', () => {
  const w = createWorld({ seed: 5 });
  const bea = w.addClient('Bea', () => 30 + w.rand() * 50); // 30-80 ms por trayecto, desordena paquetes
  startRound(w);
  w.host.state.players.forEach((p) => (p.lives = 1e9));
  let prev = null;
  let maxJump = 0;
  w.run(400, (t) => {
    const k = Math.floor(t / 23);
    bea.input.mx = (k % 3) - 1;
    bea.input.my = (Math.floor(k / 3) % 3) - 1;
    const p = bea.net.view(w.now()).state.players[1];
    if (prev) maxJump = Math.max(maxJump, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = { x: p.x, y: p.y };
  });
  // Un tick normal son 4,3 px; con correcciones no debe pasar de un par de ticks.
  assert.ok(maxJump < 10, 'salto máximo entre ticks: ' + maxJump.toFixed(2) + ' px');
  bea.input.mx = bea.input.my = 0;
  w.run(40);
  const h = w.host.state.players[1];
  const c = bea.net.view(w.now()).state.players[1];
  assert.ok(Math.hypot(h.x - c.x, h.y - c.y) < 0.5, 'en reposo coinciden');
});

test('los proyectiles se dibujan adelantados: como estarán cuando llegue la tecla de ahora', () => {
  for (const lat of [0, 25, 60, 120]) {
    const w = createWorld();
    const bea = w.addClient('Bea', lat);
    startRound(w, 11);
    w.host.state.players.forEach((p) => (p.lives = 1e9));
    w.run(600); // 10 s: ya hay proyectiles y el reloj está estimado
    let worst = 0;
    w.run(120, () => {
      const now = w.now();
      const v = bea.net.view(now);
      const shownTick = v.state.tick + (v.hazExt / C.DT - Math.floor(v.hazExt / C.DT));
      const ideal = w.hostTickAt(now) + lat / STEP; // tick del anfitrión cuando llegue lo enviado ahora
      worst = Math.max(worst, Math.abs(shownTick - ideal));
    });
    assert.ok(worst <= 1.6, 'retraso ' + lat + ' ms: desfase máximo ' + worst.toFixed(2) + ' ticks');
  }
});

test('jugar a 150 ms de ida y vuelta cuesta poco: se esquiva casi igual que en local', () => {
  const MAX = 60 * 75;
  const seeds = [21, 22, 23, 24, 25, 26];
  let localTicks = 0;
  let remoteTicks = 0;
  for (const seed of seeds) {
    // En local: el planificador juega solo.
    localTicks += T.playEpisode(T.planner({})(), seed, MAX).ticks;

    // En remoto: el mismo planificador juega como invitado, decidiendo con lo que ve en su
    // pantalla (su posición predicha y los proyectiles adelantados).
    const w = createWorld({ seed: seed });
    const bea = w.addClient('Bea', () => 65 + w.rand() * 20);
    w.run(10);
    w.host.start(seed);
    w.run(Netcode.COUNTDOWN_TICKS + 2);
    // El anfitrión no juega: se le aparta para que la ronda dependa solo de la invitada.
    w.host.state.players[0].lives = 1e9;
    const plan = T.planner({})();
    w.run(MAX, () => {
      const v = bea.net.view(w.now());
      const a = v.state && v.state.players[1].alive ? plan(seenState(v), 1) : null;
      bea.input.mx = a ? a.mx : 0;
      bea.input.my = a ? a.my : 0;
    });
    const p = w.host.state.players[1];
    remoteTicks += p.alive ? MAX : p.deathTick;
  }
  const ratio = remoteTicks / localTicks;
  assert.ok(ratio > 0.8, 'supervivencia en remoto / en local = ' + ratio.toFixed(2));
});

test('los efectos (impactos, estrellas) llegan al invitado una sola vez aunque haya desorden', () => {
  const w = createWorld({ seed: 9 });
  const bea = w.addClient('Bea', () => 20 + w.rand() * 90);
  startRound(w, 5);
  const hostEvents = [];
  w.host.onEvents = (ev) => ev.forEach((e) => hostEvents.push(e.type + e.p));
  w.host.state.players.forEach((p) => (p.lives = 50));
  w.run(60 * 30);
  // Se congela la acción (nadie puede recibir más impactos) y se deja llegar lo que iba de camino.
  w.host.state.players.forEach((p) => (p.inv = 1e9));
  w.run(30);
  assert.ok(hostEvents.length > 5, 'en 30 s quietos hay impactos: ' + hostEvents.length);
  assert.deepEqual(bea.events.map((e) => e.type + e.p).sort(), hostEvents.slice().sort());
});

test('si un invitado se va a media ronda queda eliminado y la ronda puede acabar', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  const col = w.addClient('Col', 30);
  startRound(w);
  w.host.leave(bea.id);
  bea.cut = true;
  w.run(3);
  assert.equal(w.host.state.players[1].alive, false);
  assert.equal(w.host.phase, 'playing', 'quedan dos');
  assert.deepEqual(col.net.room.members.map((m) => m.name), ['Ana', 'Col']);
  w.host.leave(col.id);
  w.run(3);
  assert.equal(w.host.phase, 'over');
  assert.equal(w.host.state.winner, 0);
  assert.equal(w.host.members[0].wins, 1);
});

test('fin de ronda: el invitado recibe el resultado y las victorias; se puede jugar otra', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 40);
  startRound(w);
  w.host.state.players[0].lives = 1;
  w.host.state.hazards.push({ x: w.host.state.players[0].x, y: w.host.state.players[0].y, vx: 0, vy: 0, r: 10 });
  w.host.state.players[0].inv = 0;
  w.run(20);
  assert.equal(w.host.phase, 'over');
  assert.equal(bea.net.phase, 'over');
  assert.equal(bea.net.snapshot().over, true);
  assert.equal(bea.net.snapshot().winner, 1);
  assert.equal(bea.net.room.roster[1].wins, 1);
  assert.equal(bea.net.room.members[1].wins, 1);

  assert.ok(w.host.start(99));
  w.run(Netcode.COUNTDOWN_TICKS + 12);
  assert.equal(bea.net.phase, 'playing');
  assert.equal(bea.net.room.round, 2);
  assert.equal(bea.net.snapshot().over, false);
  assert.equal(bea.net.room.roster[1].wins, 1, 'las victorias se conservan');
});

test('quien entra con la ronda empezada la ve como espectador y juega la siguiente', () => {
  const w = createWorld();
  w.addClient('Bea', 30);
  startRound(w);
  const tarde = w.addClient('Tarde', 30);
  w.run(30);
  assert.equal(tarde.net.phase, 'playing');
  const v = tarde.net.view(w.now());
  assert.equal(v.localIdx, -1);
  assert.equal(v.state.players.length, 2);
  w.host.leave(w.clients[0].id);
  w.run(5);
  assert.equal(w.host.phase, 'over');
  w.host.start(3);
  w.run(10);
  assert.equal(tarde.net.view(w.now()).localIdx, 1);
});

test('si el anfitrión desaparece, el invitado lo detecta', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  startRound(w);
  assert.equal(bea.net.lost, false);
  bea.cut = true; // deja de llegar nada del anfitrión
  let changes = 0;
  bea.net.onChange = () => changes++;
  for (let t = 0; t < 60 * 8; t++) bea.net.tick(bea.input, w.now() + t * STEP);
  assert.equal(bea.net.lost, true);
  assert.equal(changes, 1, 'avisa una sola vez');
});

test('si un invitado deja de dar señales, el anfitrión lo expulsa', () => {
  const w = createWorld();
  const bea = w.addClient('Bea', 30);
  startRound(w);
  bea.cut = true;
  bea.net.tick = function () {};
  w.run(Math.ceil(Netcode.CLIENT_TIMEOUT_MS / STEP) + 60);
  assert.deepEqual(w.host.members.map((m) => m.name), ['Ana']);
  assert.deepEqual(w.kicked, [bea.id]);
  assert.equal(w.host.phase, 'over');
});

test('una partida local es un anfitrión sin invitados', () => {
  const w = createWorld({ makeBot: idleBot });
  w.host.setBots(2, 0);
  w.host.start(4);
  w.run(Netcode.COUNTDOWN_TICKS + 60 * 200);
  assert.equal(w.host.phase, 'over');
  assert.equal(w.sent, 0, 'sin invitados no se envía nada');
  assert.equal(w.host.roster.reduce((a, r) => a + r.wins, 0), 1);
});
