// Enfrenta dos tipos de bot en la misma arena: 2 de cada tipo por partida, alternando puestos.
//   node train/arena.js            compara el criterio de elección de estrella sobre los pesos publicados
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NN = require('../js/nn.js');
const T = require('./common.js');

const MAX_TICKS = 60 * 240;

// a, b: listas de genomas (un bot usa el genoma k % longitud). Devuelve medias por tipo.
function duel(a, b, seeds, delay, rules) {
  const sum = { a: { score: 0, stars: 0, secs: 0, wins: 0 }, b: { score: 0, stars: 0, secs: 0, wins: 0 } };
  let games = 0;
  seeds.forEach(function (seed, g) {
    // Puestos alternos, y se intercambian de una partida a otra para que nadie salga favorecido.
    const order = g % 2 === 0 ? ['a', 'b', 'a', 'b'] : ['b', 'a', 'b', 'a'];
    const count = { a: 0, b: 0 };
    const makers = order.map(function (t) {
      const list = t === 'a' ? a : b;
      return T.brainController(list[(count[t]++ + g) % list.length], delay);
    });
    const r = T.playArena(makers, seed, MAX_TICKS, rules);
    r.players.forEach(function (p, i) {
      const t = sum[order[i]];
      t.score += p.score;
      t.stars += p.stars;
      t.secs += p.ticks / 60;
    });
    sum[order[r.winner]].wins++;
    games++;
  });
  const out = {};
  for (const t of ['a', 'b']) {
    out[t] = { score: sum[t].score / (2 * games), stars: sum[t].stars / (2 * games), secs: sum[t].secs / (2 * games), wins: sum[t].wins / games };
  }
  return out;
}

function withSelector(genomes, selA, selB) {
  return genomes.map(function (g) {
    const w = NN.upgrade(g);
    w[NN.N_NET] = selA;
    w[NN.N_NET + 1] = selB;
    return w;
  });
}

if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'weights.json'), 'utf8'));
  const top = data.levels[data.levels.length - 1].variants;
  const seeds = T.seedList(300007, 80);
  const naive = withSelector(top, 0, 0);
  console.log('Mismos pesos (nivel ' + data.levels[data.levels.length - 1].name + '), 80 partidas de 4 bots: 2 con criterio contra 2 que van a la más cercana\n');
  console.log('criterio (A, B)'.padEnd(18) + 'con criterio: puntos  estrellas  gana'.padEnd(42) + 'ingenuos: puntos  estrellas  gana');
  for (const [selA, selB] of [[0, 0], [0.5, 0], [1, 0], [2, 0], [4, 0], [0, 0.5], [0, 1], [1, 0.5], [2, 1], [4, 2]]) {
    const r = duel(withSelector(top, selA, selB), naive, seeds, 0);
    console.log(
      ('(' + selA + ', ' + selB + ')').padEnd(18) +
        (r.a.score.toFixed(0).padStart(20) + r.a.stars.toFixed(1).padStart(11) + (100 * r.a.wins).toFixed(0).padStart(5) + '%').padEnd(42) +
        r.b.score.toFixed(0).padStart(16) + r.b.stars.toFixed(1).padStart(11) + (100 * r.b.wins).toFixed(0).padStart(5) + '%'
    );
  }
}

module.exports = { duel: duel, withSelector: withSelector, MAX_TICKS: MAX_TICKS };
