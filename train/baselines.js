// Mide a los jugadores de referencia sobre las semillas de validación.
//   node train/baselines.js
'use strict';
const T = require('./common.js');

const MAX_TICKS = 60 * 180;
const seeds = T.seedList(900001, 30);

const rows = [
  ['Quieto', T.idle()],
  ['Aleatorio', T.randomWalk(7)],
  ['Planificador, reacción 250 ms, decide cada 100 ms', T.planner({ delay: 15, every: 6 })],
  ['Planificador, reacción 150 ms, decide cada 50 ms', T.planner({ delay: 9, every: 3 })],
  ['Planificador perfecto (sin retraso)', T.planner({})],
];

console.log('Referencias sobre ' + seeds.length + ' semillas de validación (tope ' + MAX_TICKS / 60 + ' s)\n');
console.log('jugador'.padEnd(52) + 'puntos'.padStart(8) + 'segundos'.padStart(10) + 'estrellas'.padStart(11));
for (const [name, make] of rows) {
  const t0 = Date.now();
  const r = T.evaluate(make, seeds, MAX_TICKS);
  console.log(
    name.padEnd(52) +
      r.score.toFixed(0).padStart(8) +
      r.secs.toFixed(1).padStart(10) +
      r.stars.toFixed(1).padStart(11) +
      '   (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s de cálculo)'
  );
}
