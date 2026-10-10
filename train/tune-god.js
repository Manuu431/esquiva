// Ajuste de los parámetros del bot "Modo Dios" por descenso coordenado: se prueba a cambiar un
// parámetro cada vez, se mide en partidas en solitario y se conserva el cambio si mejora.
//   node train/tune-god.js
// Deja el resultado en train/results/god.json (lo recoge train/export.js).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const God = require('../js/god.js');
const T = require('./common.js');

const SEEDS = T.seedList(820001, 10); // semillas propias del ajuste (no son las de test)
const MAX_TICKS = 60 * 300;
const GRID = [
  ['target', [2, 4, 8, 16]],
  ['turn', [6, 12, 20, 40]],
  ['margin', [10, 16, 24]],
  ['horizon', [30, 40, 54]],
  ['near', [1.5, 3, 6]],
  ['target', [3, 4, 6, 8, 12, 16, 24]], // segunda pasada al más influyente, con lo demás ya ajustado
  ['turn', [6, 9, 12, 16, 20, 40]],
];

function measure(params) {
  let score = 0;
  let secs = 0;
  let stars = 0;
  for (const seed of SEEDS) {
    const r = T.playEpisode(God.createBot(params), seed, MAX_TICKS);
    score += r.score;
    secs += r.ticks / 60;
    stars += r.stars;
  }
  const n = SEEDS.length;
  return { score: score / n, secs: secs / n, stars: stars / n };
}

try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch (e) {
  /* sin prioridad baja, se sigue igual */
}

const best = Object.assign({}, God.DEFAULTS);
let bestRes = measure(best);
const log = [];
const seen = new Map();
console.log('inicio: ' + bestRes.score.toFixed(0) + ' puntos, ' + bestRes.secs.toFixed(1) + ' s, ' + bestRes.stars.toFixed(1) + ' estrellas');
for (const [name, values] of GRID) {
  for (const v of values) {
    if (best[name] === v) continue;
    const cand = Object.assign({}, best);
    cand[name] = v;
    if (cand.turn > cand.horizon) cand.turn = cand.horizon;
    const key = JSON.stringify(cand);
    const res = seen.get(key) || measure(cand);
    seen.set(key, res);
    const better = res.score > bestRes.score;
    console.log((name + ' = ' + v).padEnd(16) + res.score.toFixed(0).padStart(7) + ' puntos' + res.secs.toFixed(1).padStart(7) + ' s' + res.stars.toFixed(1).padStart(7) + ' estrellas' + (better ? '   <- mejora' : ''));
    log.push({ param: name, value: v, score: Math.round(res.score), secs: +res.secs.toFixed(1), stars: +res.stars.toFixed(1), kept: better });
    if (better) {
      Object.assign(best, cand);
      bestRes = res;
    }
  }
}
const out = { params: best, tune: { score: Math.round(bestRes.score), secs: +bestRes.secs.toFixed(1), stars: +bestRes.stars.toFixed(1), games: SEEDS.length }, log: log };
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'god.json'), JSON.stringify(out, null, 2));
console.log('Hecho. Mejor: ' + JSON.stringify(best));
