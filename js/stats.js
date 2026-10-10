// stats.js — registro de las partidas del jugador: guardar, filtrar y resumir.
// Sin DOM: el almacenamiento se inyecta (en el navegador, localStorage), así que se prueba en Node.
//
// Una partida es un objeto pequeño:
//   d  fecha (ms desde 1970; 0 = desconocida)      s  puntos
//   o  0 = en este ordenador, 1 = en sala          t  segundos aguantados (0 = desconocido)
//   n  jugadores en la ronda (contando bots)       st estrellas
//   b  bots                                        r  puesto (1 = primero)
//   lv nivel de los bots ('' si no hay)            w  1 si ganó la ronda
//   l  vidas       h  dificultad de los proyectiles (0 suave, 1 normal, 2 intensa, 3 imposible)
//   p  1 si había mejoras en la arena (las partidas anteriores a que existieran cuentan como 0)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Stats = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_GAMES = 1000;
  const HAZARD_NAMES = ['Suave', 'Normal', 'Intensa', 'Imposible'];

  function clean(g) {
    return {
      d: Number(g.d) || 0,
      o: g.o ? 1 : 0,
      n: Math.max(1, g.n | 0),
      b: Math.max(0, g.b | 0),
      lv: g.b > 0 ? String(g.lv || '') : '',
      l: g.l | 0,
      h: g.h | 0,
      p: g.p ? 1 : 0,
      s: g.s | 0,
      t: Math.round((Number(g.t) || 0) * 10) / 10,
      st: g.st | 0,
      r: Math.max(1, g.r | 0),
      w: g.w ? 1 : 0,
    };
  }

  // store: { get(clave, porDefecto), set(clave, valor) }
  function create(store) {
    let games = load(store);

    function save() {
      store.set('games', JSON.stringify(games));
    }

    return {
      all: function () {
        return games;
      },
      add: function (g) {
        games.push(clean(g));
        if (games.length > MAX_GAMES) games = games.slice(-MAX_GAMES);
        save();
      },
      clear: function () {
        games = [];
        save();
      },
    };
  }

  function load(store) {
    const raw = store.get('games', null);
    if (raw !== null) {
      try {
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list.map(clean) : [];
      } catch (e) {
        return [];
      }
    }
    // Primera vez con registro: se recupera lo que guardaban las versiones anteriores (el
    // historial en solitario con las reglas de referencia y los récords sueltos).
    const games = [];
    const solo = function (l, h, s, t, st) {
      games.push(clean({ d: 0, o: 0, n: 1, b: 0, lv: '', l: l, h: h, s: s, t: t, st: st, r: 1, w: 0 }));
    };
    let best = 0;
    try {
      const old = JSON.parse(store.get('history', '[]'));
      if (Array.isArray(old)) {
        old.forEach(function (e) {
          solo(3, 1, e.score, e.secs, e.stars);
          if (e.score > best) best = e.score;
        });
      }
    } catch (e) {
      /* historial ilegible: se ignora */
    }
    const record = parseInt(store.get('record', '0'), 10) || 0;
    if (record > best) solo(3, 1, record, 0, 0);
    for (let l = 1; l <= 5; l++) {
      for (let h = 0; h <= 2; h++) {
        const r = parseInt(store.get('record.' + l + '.' + h, '0'), 10) || 0;
        if (r > 0) solo(l, h, r, 0, 0);
      }
    }
    if (games.length) store.set('games', JSON.stringify(games));
    return games;
  }

  // Dos partidas son del mismo "modo" si se jugaron con lo mismo: dónde, contra cuántos humanos y
  // bots, de qué nivel, con cuántas vidas y con qué proyectiles.
  function modeKey(g) {
    return [g.o, g.o ? g.n - g.b : 1, g.b, g.lv, g.l, g.h, g.p].join('|');
  }

  function modeLabel(g) {
    let who;
    if (g.o) {
      const humans = g.n - g.b;
      who = 'Sala de ' + humans + (g.b ? ' + ' + g.b + (g.b === 1 ? ' bot ' : ' bots ') + g.lv : '');
    } else if (g.b === 0) {
      who = 'En solitario';
    } else {
      who = g.b + (g.b === 1 ? ' bot ' : ' bots ') + g.lv;
    }
    return who + ' · ' + g.l + (g.l === 1 ? ' vida' : ' vidas') + ' · ' + (HAZARD_NAMES[g.h] || '?') + (g.p ? '' : ' · sin mejoras');
  }

  // f: { o, b, lv, l, h, p }; un campo vacío ('' / null / undefined) significa "cualquiera".
  function matches(g, f) {
    const any = function (v) {
      return v === '' || v === null || v === undefined;
    };
    return (
      (any(f.o) || g.o === Number(f.o)) &&
      (any(f.b) || g.b === Number(f.b)) &&
      (any(f.lv) || g.lv === f.lv) &&
      (any(f.l) || g.l === Number(f.l)) &&
      (any(f.h) || g.h === Number(f.h)) &&
      (any(f.p) || g.p === Number(f.p))
    );
  }

  function summarize(list) {
    const out = { n: list.length, best: 0, avg: 0, avgSecs: 0, avgStars: 0, rivals: 0, wins: 0 };
    let timed = 0;
    list.forEach(function (g) {
      out.avg += g.s;
      out.avgStars += g.st;
      if (g.s > out.best) out.best = g.s;
      if (g.t > 0) {
        out.avgSecs += g.t;
        timed++;
      }
      if (g.n > 1) {
        out.rivals++;
        if (g.w) out.wins++;
      }
    });
    if (list.length) {
      out.avg /= list.length;
      out.avgStars /= list.length;
    }
    if (timed) out.avgSecs /= timed;
    return out;
  }

  // Un resumen por modo jugado, el más reciente primero.
  function modes(list) {
    const map = new Map();
    list.forEach(function (g) {
      const key = modeKey(g);
      let m = map.get(key);
      if (!m) map.set(key, (m = { key: key, sample: g, games: [], last: 0 }));
      m.games.push(g);
      if (g.d >= m.last) m.last = g.d;
    });
    return Array.from(map.values())
      .map(function (m) {
        const sum = summarize(m.games);
        return { key: m.key, sample: m.sample, last: m.last, n: sum.n, best: sum.best, avg: sum.avg, rivals: sum.rivals, wins: sum.wins };
      })
      .sort(function (a, b) {
        return b.last - a.last || b.n - a.n;
      });
  }

  // El registro como CSV (separado por punto y coma, que es lo que abre bien una hoja de cálculo
  // en español), una partida por línea y la más antigua primero.
  function toCsv(list) {
    const two = function (v) {
      return String(v).padStart(2, '0');
    };
    const rows = ['fecha;donde;jugadores;bots;nivel_bots;vidas;proyectiles;mejoras;puntos;segundos;estrellas;puesto;gano'];
    list.forEach(function (g) {
      let date = '';
      if (g.d) {
        const d = new Date(g.d);
        date = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
      }
      rows.push([
        date, g.o ? 'sala' : 'local', g.n, g.b, g.lv, g.l, HAZARD_NAMES[g.h] || '', g.p ? 'si' : 'no',
        g.s, String(g.t).replace('.', ','), g.st, g.r, g.n > 1 ? (g.w ? 'si' : 'no') : '',
      ].join(';'));
    });
    return rows.join('\r\n') + '\r\n';
  }

  return {
    MAX_GAMES: MAX_GAMES,
    toCsv: toCsv,
    HAZARD_NAMES: HAZARD_NAMES,
    create: create,
    modeKey: modeKey,
    modeLabel: modeLabel,
    matches: matches,
    summarize: summarize,
    modes: modes,
  };
});
