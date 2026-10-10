// Evalúa un entrenamiento sobre semillas de TEST (distintas de las de entrenamiento y de las de
// validación, que se usaron para elegir campeón) y lo compara con los jugadores de referencia.
//   node train/eval.js --run base [--delay 0]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const T = require('./common.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1];
}

const RUN = String(arg('run', 'tca'));
const MAX_TICKS = 60 * 240;
const TEST = T.seedList(500003, 60);

function loadChampions(run) {
  const file = path.join(__dirname, 'runs', run, 'champions.jsonl');
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(function (l) {
      return JSON.parse(l);
    });
}

// Media y desviación típica de los segundos aguantados, además de puntos y estrellas.
// rules: { lives, hazard } opcional (por defecto, las reglas de referencia).
function measure(make, seeds, rules) {
  const secs = [];
  let score = 0;
  let stars = 0;
  for (const seed of seeds) {
    const r = T.playEpisode(make(), seed, MAX_TICKS, rules);
    secs.push(r.ticks / 60);
    score += r.score;
    stars += r.stars;
  }
  const mean = secs.reduce((a, b) => a + b, 0) / secs.length;
  const sd = Math.sqrt(secs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / secs.length);
  const sorted = secs.slice().sort((a, b) => a - b);
  return { score: score / seeds.length, secs: mean, sd: sd, median: sorted[sorted.length >> 1], stars: stars / seeds.length };
}

function row(name, r) {
  console.log(
    name.padEnd(46) +
      r.score.toFixed(0).padStart(7) +
      (r.secs.toFixed(1) + ' ± ' + r.sd.toFixed(1)).padStart(15) +
      r.median.toFixed(1).padStart(9) +
      r.stars.toFixed(1).padStart(10)
  );
}

// El mejor campeón según validación (media móvil de 5 generaciones para no premiar un golpe de suerte).
function pickBest(champs) {
  let best = champs[0];
  let bestAvg = -Infinity;
  for (let i = 0; i < champs.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(champs.length - 1, i + 2); j++, n++) sum += champs[j].val;
    if (sum / n > bestAvg) {
      bestAvg = sum / n;
      best = champs[i];
    }
  }
  return best;
}

if (require.main === module) {
  const champs = loadChampions(RUN);
  const delay = parseInt(arg('delay', JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', RUN, 'config.json'), 'utf8')).delay), 10);
  const best = pickBest(champs);
  console.log('Entrenamiento "' + RUN + '" (' + champs.length + ' generaciones, entrenado con reacción de ' + delay + ' ticks)');
  console.log(TEST.length + ' partidas de test por fila\n');
  console.log('jugador'.padEnd(46) + 'puntos'.padStart(7) + 'segundos ± dt'.padStart(15) + 'mediana'.padStart(9) + 'estrellas'.padStart(10));
  row('Quieto', measure(T.idle(), TEST));
  row('Aleatorio', measure(T.randomWalk(7), TEST));
  for (const g of [0, 5, 10, 20, 40, 80, 160, champs.length - 1]) {
    if (g < champs.length) row('Red, campeón de la generación ' + g, measure(T.brainController(champs[g].weights, delay), TEST));
  }
  row('Red, mejor por validación (gen ' + best.gen + ')', measure(T.brainController(best.weights, delay), TEST));
  for (const d of [3, 6, 9, 12, 15]) {
    if (d !== delay) row('  ...la misma con reacción de ' + Math.round((d * 1000) / 60) + ' ms', measure(T.brainController(best.weights, d), TEST));
  }
  ['suaves', 'normales', 'intensos'].forEach(function (name, hazard) {
    row('  ...la misma con proyectiles ' + name, measure(T.brainController(best.weights, delay), TEST, { hazard: hazard }));
  });
  row('Planificador, reacción 250 ms ("humano simulado")', measure(T.planner({ delay: 15, every: 6 }), TEST));
  row('Planificador, reacción 150 ms', measure(T.planner({ delay: 9, every: 3 }), TEST));
  row('Planificador perfecto (techo del juego)', measure(T.planner({}), TEST));
}

module.exports = { loadChampions: loadChampions, measure: measure, pickBest: pickBest, TEST: TEST, MAX_TICKS: MAX_TICKS };
