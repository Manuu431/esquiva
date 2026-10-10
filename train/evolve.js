// Neuroevolución de los bots: población -> evaluación -> torneo -> cruce -> mutación.
//   node train/evolve.js --name base --gens 150
// Opciones: --pop 48 --episodes 5 --delay 0 --seed 1 --resume
// Deja en train/runs/<name>/: log.csv (métricas por generación), champions.jsonl (el mejor de
// cada generación con sus pesos) y checkpoint.json (para continuar con --resume).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const NN = require('../js/nn.js');
const T = require('./common.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const CFG = {
  name: String(arg('name', 'base')),
  pop: parseInt(arg('pop', 48), 10),
  gens: parseInt(arg('gens', 150), 10),
  episodes: parseInt(arg('episodes', 5), 10), // partidas por individuo y generación
  delay: parseInt(arg('delay', 0), 10), // ticks de tiempo de reacción con los que se entrena
  seed: parseInt(arg('seed', 1), 10),
  elite: 4, // los mejores pasan intactos
  tournament: 3,
  crossover: 0.7,
  mutRate: 0.08, // probabilidad de mutar cada peso
  sigma0: 0.35, // tamaño inicial de la mutación
  sigmaDecay: 0.99,
  sigmaMin: 0.08,
  maxTicks: 60 * 240,
  valSeeds: 20, // semillas fijas para comparar generaciones entre sí
  restMs: 150, // pausa entre generaciones para no acaparar el portátil
  // Dificultad de los proyectiles en cada partida de entrenamiento (se repite en ciclo): la
  // mitad en normal y el resto repartido, para que el bot sirva en las tres.
  hazards: [1, 0, 1, 2, 1, 0, 1, 2],
};

function trainRules(i) {
  return { hazard: CFG.hazards[i % CFG.hazards.length] };
}

const DIR = path.join(__dirname, 'runs', CFG.name);
const VAL = T.seedList(900001, CFG.valSeeds);

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function randomGenome(rng) {
  const g = new Float64Array(NN.N_W);
  for (let i = 0; i < g.length; i++) g[i] = rng.gauss() * 0.5;
  return g;
}

function tournament(pop, fit, rng) {
  let best = rng.int(pop.length);
  for (let k = 1; k < CFG.tournament; k++) {
    const c = rng.int(pop.length);
    if (fit[c] > fit[best]) best = c;
  }
  return pop[best];
}

// Cruce por neuronas: cada neurona (sus pesos de entrada y su sesgo) se hereda entera de un
// progenitor, para no romper lo que esa neurona había aprendido a detectar.
function crossover(a, b, rng) {
  const child = Float64Array.from(a);
  const blockH = NN.N_IN + 1;
  const blockO = NN.N_HID + 1;
  let k = 0;
  for (let j = 0; j < NN.N_HID; j++, k += blockH) {
    if (rng() < 0.5) child.set(b.subarray(k, k + blockH), k);
  }
  for (let q = 0; q < NN.N_OUT; q++, k += blockO) {
    if (rng() < 0.5) child.set(b.subarray(k, k + blockO), k);
  }
  return child;
}

function mutate(g, sigma, rng) {
  for (let i = 0; i < g.length; i++) {
    if (rng() < CFG.mutRate) g[i] += rng.gauss() * sigma;
  }
  return g;
}

function stats(fit) {
  const s = Array.from(fit).sort(function (a, b) {
    return a - b;
  });
  let sum = 0;
  for (const v of s) sum += v;
  return { best: s[s.length - 1], mean: sum / s.length, median: s[s.length >> 1] };
}

async function main() {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (e) {
    /* si no se puede bajar la prioridad, se sigue igual */
  }
  fs.mkdirSync(DIR, { recursive: true });
  const logFile = path.join(DIR, 'log.csv');
  const champFile = path.join(DIR, 'champions.jsonl');
  const ckptFile = path.join(DIR, 'checkpoint.json');

  let rng = T.makeRng(CFG.seed);
  let pop = [];
  let gen = 0;
  let sigma = CFG.sigma0;

  if (arg('resume', false) && fs.existsSync(ckptFile)) {
    const ck = JSON.parse(fs.readFileSync(ckptFile, 'utf8'));
    gen = ck.gen;
    sigma = ck.sigma;
    pop = ck.pop.map(function (g) {
      return Float64Array.from(g);
    });
    rng = T.makeRng(ck.rng);
    console.log('Continuando "' + CFG.name + '" desde la generación ' + gen);
  } else {
    for (let i = 0; i < CFG.pop; i++) pop.push(randomGenome(rng));
    fs.writeFileSync(logFile, 'gen,mejor,media,mediana,val_puntos,val_segundos,val_estrellas,sigma,segundos_calculo\n');
    fs.writeFileSync(champFile, '');
    fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify(CFG, null, 2));
    console.log('Entrenamiento "' + CFG.name + '": ' + JSON.stringify(CFG));
  }

  console.log('gen   mejor   media  mediana | validación: puntos  seg  estrellas | sigma  cálculo');
  const fit = new Float64Array(CFG.pop);

  for (; gen < CFG.gens; gen++) {
    const t0 = Date.now();
    // Todos los individuos de una generación juegan las mismas partidas (comparación justa);
    // cada generación usa partidas nuevas (no se memorizan).
    const seeds = [];
    for (let e = 0; e < CFG.episodes; e++) seeds.push(1 + rng.int(800000));

    for (let i = 0; i < pop.length; i++) {
      fit[i] = T.evaluate(T.brainController(pop[i], CFG.delay), seeds, CFG.maxTicks, trainRules).score;
    }

    const order = Array.from(fit.keys()).sort(function (a, b) {
      return fit[b] - fit[a];
    });
    const champion = pop[order[0]];
    const val = T.evaluate(T.brainController(champion, CFG.delay), VAL, CFG.maxTicks);
    const st = stats(fit);
    const secs = (Date.now() - t0) / 1000;

    fs.appendFileSync(
      logFile,
      [gen, st.best.toFixed(0), st.mean.toFixed(0), st.median.toFixed(0), val.score.toFixed(0), val.secs.toFixed(1), val.stars.toFixed(1), sigma.toFixed(3), secs.toFixed(1)].join(',') + '\n'
    );
    fs.appendFileSync(
      champFile,
      JSON.stringify({ gen: gen, val: Math.round(val.score), secs: +val.secs.toFixed(1), stars: +val.stars.toFixed(1), weights: Array.from(champion, round5) }) + '\n'
    );
    console.log(
      String(gen).padStart(3) +
        st.best.toFixed(0).padStart(8) +
        st.mean.toFixed(0).padStart(8) +
        st.median.toFixed(0).padStart(9) +
        ' |' +
        val.score.toFixed(0).padStart(19) +
        val.secs.toFixed(1).padStart(6) +
        val.stars.toFixed(1).padStart(10) +
        ' |' +
        sigma.toFixed(3).padStart(6) +
        (secs.toFixed(1) + ' s').padStart(9)
    );

    // Siguiente generación.
    const next = [];
    for (let e = 0; e < CFG.elite; e++) next.push(pop[order[e]]);
    while (next.length < CFG.pop) {
      const a = tournament(pop, fit, rng);
      const child = rng() < CFG.crossover ? crossover(a, tournament(pop, fit, rng), rng) : Float64Array.from(a);
      next.push(mutate(child, sigma, rng));
    }
    pop = next;
    sigma = Math.max(CFG.sigmaMin, sigma * CFG.sigmaDecay);

    fs.writeFileSync(
      ckptFile,
      JSON.stringify({ gen: gen + 1, sigma: sigma, rng: rng.state(), pop: pop.map(function (g) { return Array.from(g); }) })
    );
    await sleep(CFG.restMs);
  }
  console.log('Hecho. Resultados en ' + DIR);
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

main();
