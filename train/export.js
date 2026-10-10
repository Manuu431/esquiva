// Convierte los entrenamientos en weights.json, el fichero que carga el juego en el navegador.
//   node train/export.js --run arena --easy tca
// Los niveles salen de la propia evolución:
//   - Fácil y Normal: campeones de generaciones tempranas del entrenamiento en solitario (--easy).
//     Van siempre a la estrella más cercana.
//   - Difícil y Experto: el campeón final del entrenamiento principal (--run), con y sin tiempo de
//     reacción. Si se entrenó en arena, lleva su criterio para elegir estrella frente a rivales.
// Cada nivel tiene además un tiempo de reacción (el bot actúa con lo que decidió hace N ticks).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NN = require('../js/nn.js');
const T = require('./common.js');
const E = require('./eval.js');
const A = require('./arena.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1];
}

const RUN = String(arg('run', 'arena'));
const EASY = String(arg('easy', 'tca'));
const SELECT = T.seedList(700001, 60); // para elegir campeón final entre los finalistas
const ARENA_TEST = T.seedList(300007, 80); // partidas de 4 para medir contra los bots de referencia
const VARIANTS = 5; // redes distintas por nivel: en una partida cada bot lleva la suya
const LEVELS = [
  { name: 'Fácil', frac: 0.3, delay: 9 },
  { name: 'Normal', frac: 0.6, delay: 6 },
  { name: 'Difícil', frac: 1, delay: 6 },
  { name: 'Experto', frac: 1, delay: 0 },
];

function loadRun(name) {
  const champs = E.loadChampions(name);
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', name, 'config.json'), 'utf8'));
  return { name: name, champs: champs, cfg: cfg };
}

// Genoma completo: los antiguos (solo red) se completan con criterio 0 = "la más cercana".
function full(weights) {
  const w = new Float64Array(NN.N_W);
  w.set(weights);
  return w;
}

function same(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// De una lista ordenada de campeones, los primeros que no son copia de uno ya elegido (un mismo
// individuo de élite puede ser campeón varias generaciones seguidas).
function distinct(champs, order, max) {
  const out = [];
  for (const i of order) {
    if (out.length >= max) break;
    if (!out.some(function (j) { return same(champs[i].weights, champs[j].weights); })) out.push(i);
  }
  return out;
}

function byValidation(champs) {
  return champs
    .map(function (_, i) {
      return i;
    })
    .sort(function (a, b) {
      return champs[b].val - champs[a].val;
    });
}

// Validación suavizada (media de 5 generaciones) para no fiarse de un golpe de suerte.
function smoothed(champs) {
  return champs.map(function (_, i) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(champs.length - 1, i + 2); j++, n++) sum += champs[j].val;
    return sum / n;
  });
}

// ---------- Referencia: lo mejor del entrenamiento en solitario, yendo a la estrella más cercana ----------
const easy = loadRun(EASY);
const easyFinalists = distinct(easy.champs, byValidation(easy.champs), 10)
  .map(function (i) {
    return { idx: i, score: T.evaluate(T.brainController(full(easy.champs[i].weights), 0), SELECT, E.MAX_TICKS).score };
  })
  .sort(function (a, b) {
    return b.score - a.score;
  });
const reference = easyFinalists.slice(0, VARIANTS).map(function (f) {
  return full(easy.champs[f.idx].weights);
});
console.log('Referencia ("' + EASY + '", estrella más cercana): generaciones ' + easyFinalists.slice(0, VARIANTS).map(function (f) { return easy.champs[f.idx].gen; }).join(', '));

// ---------- Campeón final del entrenamiento principal ----------
const main = loadRun(RUN);
const inArena = !!main.cfg.arena;
const finalists = distinct(main.champs, byValidation(main.champs), 10)
  .map(function (i) {
    const w = full(main.champs[i].weights);
    // En arena se elige por lo que puntúa contra los de referencia; en solitario, jugando solo.
    const score = inArena
      ? A.duel([w], reference, SELECT.slice(0, 40), 0).a.score
      : T.evaluate(T.brainController(w, 0), SELECT, E.MAX_TICKS).score;
    console.log('finalista gen ' + String(main.champs[i].gen).padStart(3) + ': validación ' + main.champs[i].val + ', selección ' + score.toFixed(0) +
      ', criterio (' + w[NN.N_NET].toFixed(2) + ', ' + w[NN.N_NET + 1].toFixed(2) + ')');
    return { idx: i, score: score };
  })
  .sort(function (a, b) {
    return b.score - a.score;
  });
const top = finalists.slice(0, VARIANTS).map(function (f) {
  return full(main.champs[f.idx].weights);
});
console.log('Campeón final: generación ' + main.champs[finalists[0].idx].gen);
console.log('');

// ---------- Niveles ----------
const easySmooth = smoothed(easy.champs);
const easyBest = easySmooth[easyFinalists[0].idx];
const levels = LEVELS.map(function (lv) {
  let genomes;
  let gens;
  if (lv.frac < 1) {
    // Primera generación que alcanza esa fracción de la fitness final, y las siguientes como variantes.
    let idx = easySmooth.findIndex(function (v) {
      return v >= easyBest * lv.frac;
    });
    if (idx < 0) idx = easyFinalists[0].idx;
    const order = [];
    for (let i = idx; i < Math.min(easy.champs.length, idx + 15); i++) order.push(i);
    const picked = distinct(easy.champs, order, VARIANTS);
    genomes = picked.map(function (i) { return full(easy.champs[i].weights); });
    gens = picked.map(function (i) { return EASY + ':' + easy.champs[i].gen; });
  } else {
    genomes = top;
    gens = finalists.slice(0, VARIANTS).map(function (f) { return RUN + ':' + main.champs[f.idx].gen; });
  }
  const solo = E.measure(T.brainController(genomes[0], lv.delay), E.TEST);
  // Contra bots de referencia sin tiempo de reacción: 2 de este nivel y 2 de referencia.
  const arena = A.duel(genomes, reference, ARENA_TEST, 0);
  console.log(
    lv.name.padEnd(9) + 'reacción ' + String(Math.round((lv.delay * 1000) / 60)).padStart(3) + ' ms | solo: ' +
      solo.score.toFixed(0).padStart(6) + ' puntos, ' + solo.secs.toFixed(1) + ' s, ' + solo.stars.toFixed(1) + ' estrellas' +
      ' | criterio (' + genomes[0][NN.N_NET].toFixed(2) + ', ' + genomes[0][NN.N_NET + 1].toFixed(2) + ')   (' + gens.join(', ') + ')'
  );
  return {
    name: lv.name,
    delay: lv.delay,
    gens: gens,
    test: { score: Math.round(solo.score), secs: +solo.secs.toFixed(1), stars: +solo.stars.toFixed(1) },
    variants: genomes.map(function (g) {
      return Array.from(g, function (w) {
        return Math.round(w * 1e4) / 1e4;
      });
    }),
  };
});

// El campeón final contra la referencia, en igualdad (ninguno con tiempo de reacción).
const duel = A.duel(top, reference, ARENA_TEST, 0);
console.log('');
console.log('Campeones finales contra la referencia (80 partidas de 4, 2 contra 2):');
console.log('  campeones:  ' + duel.a.score.toFixed(0) + ' puntos, ' + duel.a.stars.toFixed(1) + ' estrellas, ganan el ' + (100 * duel.a.wins).toFixed(0) + ' %');
console.log('  referencia: ' + duel.b.score.toFixed(0) + ' puntos, ' + duel.b.stars.toFixed(1) + ' estrellas, ganan el ' + (100 * duel.b.wins).toFixed(0) + ' %');

const out = {
  version: 2,
  arch: { inputs: NN.N_IN, hidden: NN.N_HID, outputs: NN.N_OUT, weights: NN.N_W },
  training: { run: RUN, easy: EASY, generations: main.champs.length, population: main.cfg.pop, testGames: E.TEST.length },
  levels: levels,
};
const file = path.join(__dirname, '..', 'weights.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log('');
console.log('Escrito ' + file + ' (' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB)');
