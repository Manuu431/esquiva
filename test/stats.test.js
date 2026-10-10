'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../js/stats.js');

function fakeStore(initial) {
  const data = Object.assign({}, initial);
  return {
    data: data,
    get: (k, def) => (k in data ? data[k] : def),
    set: (k, v) => {
      data[k] = String(v);
    },
  };
}

function game(over) {
  return Object.assign({ d: 1000, o: 0, n: 2, b: 1, lv: 'Difícil', l: 3, h: 2, p: 0, s: 7032, t: 41.5, st: 15, r: 1, w: 1 }, over);
}

test('una partida guardada se recupera tal cual al volver a abrir', () => {
  const store = fakeStore();
  const a = Stats.create(store);
  a.add(game());
  a.add(game({ s: 5000, w: 0, r: 2 }));
  const b = Stats.create(store);
  assert.equal(b.all().length, 2);
  assert.deepEqual(b.all()[0], game());
});

test('filtros: cada campo vacío significa "cualquiera"', () => {
  const list = [
    game(),
    game({ b: 3, n: 4, lv: 'Normal', h: 1 }),
    game({ b: 0, n: 1, lv: '', l: 5, h: 0, w: 0 }),
    game({ o: 1, n: 3, b: 0, lv: '' }),
  ];
  const count = (f) => list.filter((g) => Stats.matches(g, f)).length;
  assert.equal(count({}), 4);
  assert.equal(count({ o: '0' }), 3, 'en este ordenador');
  assert.equal(count({ o: '1' }), 1, 'en sala');
  assert.equal(count({ b: '0' }), 2, 'sin bots');
  assert.equal(count({ b: '1' }), 1);
  assert.equal(count({ lv: 'Normal' }), 1);
  assert.equal(count({ l: '5' }), 1);
  assert.equal(count({ h: '2' }), 2, 'proyectiles intensos');
  assert.equal(count({ b: '1', lv: 'Difícil', l: '3', h: '2' }), 1, 'todos a la vez');
  assert.equal(count({ b: '1', h: '0' }), 0);
  assert.equal(count({ p: '0' }), 4, 'sin mejoras');
  assert.equal(count({ p: '1' }), 0);
  assert.equal(count({ o: '', b: null, lv: undefined }), 4);
});

test('resumen: media, récord, estrellas y victorias solo en partidas con rivales', () => {
  const sum = Stats.summarize([
    game({ s: 7000, t: 40, st: 10, w: 1 }),
    game({ s: 5000, t: 30, st: 6, w: 0 }),
    game({ s: 3000, t: 0, st: 2, n: 1, b: 0, lv: '', w: 0 }), // en solitario y sin tiempo conocido
  ]);
  assert.equal(sum.n, 3);
  assert.equal(sum.best, 7000);
  assert.equal(sum.avg, 5000);
  assert.equal(sum.avgStars, 6);
  assert.equal(sum.avgSecs, 35, 'las partidas sin tiempo no cuentan para la media de tiempo');
  assert.equal(sum.rivals, 2);
  assert.equal(sum.wins, 1);
  assert.deepEqual(Stats.summarize([]), { n: 0, best: 0, avg: 0, avgSecs: 0, avgStars: 0, rivals: 0, wins: 0 });
});

test('récords por modo: un modo es una combinación de ajustes; el más reciente primero', () => {
  const list = [
    game({ d: 10, s: 4000 }),
    game({ d: 30, s: 7032 }),
    game({ d: 20, s: 6000, h: 1 }), // mismos ajustes salvo los proyectiles: otro modo
    game({ d: 5, b: 0, n: 1, lv: '', s: 3000 }),
    game({ d: 40, o: 1, n: 3, b: 1, s: 2000 }),
    game({ d: 41, o: 1, n: 4, b: 1, s: 2500 }), // sala con otro número de humanos: otro modo
  ];
  const modes = Stats.modes(list);
  assert.equal(modes.length, 5);
  assert.deepEqual(modes.map((m) => m.last), [41, 40, 30, 20, 5]);
  const mio = modes[2];
  assert.equal(mio.n, 2);
  assert.equal(mio.best, 7032);
  assert.equal(mio.avg, 5516);
  assert.equal(Stats.modeLabel(mio.sample), '1 bot Difícil · 3 vidas · Intensa · sin mejoras');
  assert.equal(Stats.modeLabel(modes[4].sample), 'En solitario · 3 vidas · Intensa · sin mejoras');
  assert.equal(Stats.modeLabel(modes[0].sample), 'Sala de 3 + 1 bot Difícil · 3 vidas · Intensa · sin mejoras');
  assert.equal(Stats.modeLabel(game({ o: 1, n: 2, b: 0, lv: '', l: 1, h: 0, p: 1 })), 'Sala de 2 · 1 vida · Suave');
  assert.equal(Stats.modeLabel(game({ b: 3, n: 4, lv: 'Experto', h: 3, p: 1 })), '3 bots Experto · 3 vidas · Imposible');
  // Con mejoras o sin ellas son modos distintos.
  assert.notEqual(Stats.modeKey(game({ p: 1 })), Stats.modeKey(game({ p: 0 })));
});

test('se recupera lo guardado por versiones anteriores (historial en solitario y récords)', () => {
  const store = fakeStore({
    history: JSON.stringify([{ score: 2500, secs: 20.5, stars: 4 }, { score: 4100, secs: 31, stars: 8 }]),
    record: '5200', // el récord era de una partida que ya no está en el historial
    'record.5.0': '9000',
  });
  const games = Stats.create(store).all();
  assert.equal(games.length, 4);
  const ref = games.filter((g) => Stats.matches(g, { b: '0', l: '3', h: '1' }));
  assert.equal(Stats.summarize(ref).best, 5200);
  assert.equal(ref.length, 3);
  assert.equal(Stats.summarize(games.filter((g) => Stats.matches(g, { l: '5', h: '0' }))).best, 9000);
  // La recuperación se hace una sola vez.
  assert.equal(Stats.create(store).all().length, 4);
});

test('el registro tiene tope y borrar lo vacía', () => {
  const store = fakeStore();
  const s = Stats.create(store);
  for (let i = 0; i < Stats.MAX_GAMES + 25; i++) s.add(game({ s: i }));
  assert.equal(s.all().length, Stats.MAX_GAMES);
  assert.equal(s.all()[0].s, 25, 'se descartan las más antiguas');
  s.clear();
  assert.equal(s.all().length, 0);
  assert.equal(Stats.create(store).all().length, 0);
});

test('datos estropeados en el almacenamiento no rompen nada', () => {
  assert.deepEqual(Stats.create(fakeStore({ games: '{esto no es json' })).all(), []);
  assert.deepEqual(Stats.create(fakeStore({ games: '"hola"' })).all(), []);
  assert.deepEqual(Stats.create(fakeStore({ history: 'zzz' })).all(), []);
});
