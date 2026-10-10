// Convierte un entrenamiento en weights.json, el fichero que carga el juego en el navegador.
//   node train/export.js --run base
// Los niveles de dificultad salen de la propia evolución: los fáciles son campeones de
// generaciones tempranas; los difíciles, el campeón final. Además cada nivel tiene un tiempo de
// reacción (el bot actúa con lo que decidió hace N ticks), como lo tiene una persona.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NN = require('../js/nn.js');
const T = require('./common.js');
const E = require('./eval.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? def : process.argv[i + 1];
}

const RUN = String(arg('run', 'base'));
const SELECT = T.seedList(700001, 60); // para elegir campeón final entre los candidatos
const VARIANTS = 5; // redes distintas por nivel: en una partida cada bot lleva la suya
const LEVELS = [
  { name: 'Fácil', frac: 0.4, delay: 9 },
  { name: 'Normal', frac: 0.7, delay: 6 },
  { name: 'Difícil', frac: 1, delay: 6 },
  { name: 'Experto', frac: 1, delay: 0 },
];

const champs = E.loadChampions(RUN);
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', RUN, 'config.json'), 'utf8'));

// Validación suavizada (media de 5 generaciones) para no fiarse de un golpe de suerte.
const smooth = champs.map(function (_, i) {
  let sum = 0;
  let n = 0;
  for (let j = Math.max(0, i - 2); j <= Math.min(champs.length - 1, i + 2); j++, n++) sum += champs[j].val;
  return sum / n;
});

function sameWeights(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// De una lista ordenada de campeones, los primeros que no son copia de uno ya elegido (un
// mismo individuo de élite puede ser campeón varias generaciones seguidas).
function distinct(order, max) {
  const out = [];
  for (const i of order) {
    if (out.length >= max) break;
    const dup = out.some(function (j) {
      return sameWeights(champs[i].weights, champs[j].weights);
    });
    if (!dup) out.push(i);
  }
  return out;
}

// Finalistas: los mejores por validación, sin repetidos, se vuelven a medir con partidas nuevas.
const byVal = champs
  .map(function (_, i) {
    return i;
  })
  .sort(function (a, b) {
    return champs[b].val - champs[a].val;
  });
const finalists = distinct(byVal, 10)
  .map(function (i) {
    const r = T.evaluate(T.brainController(champs[i].weights, cfg.delay), SELECT, E.MAX_TICKS);
    console.log('finalista gen ' + String(champs[i].gen).padStart(3) + ': validación ' + champs[i].val + ', selección ' + r.score.toFixed(0));
    return { idx: i, score: r.score };
  })
  .sort(function (a, b) {
    return b.score - a.score;
  });
const finalIdx = finalists[0].idx;
console.log('Campeón final: generación ' + champs[finalIdx].gen);
console.log('');

const levels = LEVELS.map(function (lv) {
  let order;
  if (lv.frac < 1) {
    // Nivel intermedio: la primera generación que alcanza esa fracción de la fitness final, y
    // como variantes los campeones de las generaciones siguientes.
    const target = smooth[finalIdx] * lv.frac;
    let idx = smooth.findIndex(function (v) {
      return v >= target;
    });
    if (idx < 0) idx = finalIdx;
    order = [];
    for (let i = idx; i < Math.min(champs.length, idx + 15); i++) order.push(i);
  } else {
    order = finalists.map(function (f) {
      return f.idx;
    });
  }
  const variants = distinct(order, VARIANTS);
  const c = champs[variants[0]];
  const r = E.measure(T.brainController(c.weights, lv.delay), E.TEST);
  console.log(
    lv.name.padEnd(9) + 'gen ' + String(c.gen).padStart(3) + ', reacción ' + String(Math.round((lv.delay * 1000) / 60)).padStart(3) + ' ms -> ' +
      r.score.toFixed(0).padStart(6) + ' puntos, ' + r.secs.toFixed(1) + ' ± ' + r.sd.toFixed(1) + ' s, ' + r.stars.toFixed(1) + ' estrellas' +
      '   (variantes: gen ' + variants.map(function (i) { return champs[i].gen; }).join(', ') + ')'
  );
  return {
    name: lv.name,
    delay: lv.delay,
    gens: variants.map(function (i) {
      return champs[i].gen;
    }),
    test: { score: Math.round(r.score), secs: +r.secs.toFixed(1), stars: +r.stars.toFixed(1) },
    variants: variants.map(function (i) {
      return champs[i].weights.map(function (w) {
        return Math.round(w * 1e4) / 1e4;
      });
    }),
  };
});

const out = {
  version: 1,
  arch: { inputs: NN.N_IN, hidden: NN.N_HID, outputs: NN.N_OUT, weights: NN.N_W },
  training: { run: RUN, generations: champs.length, population: cfg.pop, episodes: cfg.episodes, testGames: E.TEST.length },
  levels: levels,
};
const file = path.join(__dirname, '..', 'weights.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log('');
console.log('Escrito ' + file + ' (' + (fs.statSync(file).size / 1024).toFixed(1) + ' KB)');
