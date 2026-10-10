// Neuroevolución con varios bots en la misma arena: cada individuo se mide jugando contra otros
// tres de su población, así que lo que aprende incluye competir por las estrellas.
//   node train/evolve-arena.js --name arena --gens 200
// Parte de los bots ya publicados (weights.json) en vez de redes al azar: lo que se busca aquí no
// es aprender a jugar desde cero, sino a jugar contra otros. Además de los pesos de la red,
// evolucionan los dos números del criterio de elección de estrella (ver NN.targetStar).
// Deja en train/runs/<name>/ lo mismo que evolve.js.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const NN = require('../js/nn.js');
const T = require('./common.js');
const A = require('./arena.js');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const CFG = {
  name: String(arg('name', 'arena')),
  arena: 4, // bots por partida
  pop: parseInt(arg('pop', 64), 10), // múltiplo de `arena`
  gens: parseInt(arg('gens', 200), 10),
  rounds: parseInt(arg('rounds', 8), 10), // partidas que juega cada individuo por generación
  delay: 0,
  seed: parseInt(arg('seed', 1), 10),
  elite: 4,
  tournament: 3,
  crossover: 0.7,
  mutRate: 0.08,
  sigma0: 0.2, // menor que al entrenar desde cero: se parte de redes que ya saben jugar
  sigmaDecay: 0.99,
  sigmaMin: 0.06,
  selMutRate: 0.3, // el criterio de estrella son solo 2 números: se mutan más a menudo...
  selSigma: 0.4, // ...y con pasos propios
  maxTicks: 60 * 240,
  valGames: 16, // partidas fijas del campeón contra 3 bots de referencia
  valSeeds: 20, // partidas fijas del campeón jugando solo
  restMs: 150,
  hazards: [1, 1, 1, 0, 1, 1, 1, 2], // casi todo en dificultad normal
};

const DIR = path.join(__dirname, 'runs', CFG.name);
const VAL_SOLO = T.seedList(900001, CFG.valSeeds);
const VAL_ARENA = T.seedList(910001, CFG.valGames);

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function tournament(pop, fit, rng) {
  let best = rng.int(pop.length);
  for (let k = 1; k < CFG.tournament; k++) {
    const c = rng.int(pop.length);
    if (fit[c] > fit[best]) best = c;
  }
  return pop[best];
}

// Cruce por bloques: cada neurona se hereda entera de un progenitor, y el criterio de estrella también.
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
  if (rng() < 0.5) child.set(b.subarray(NN.N_NET), NN.N_NET);
  return child;
}

function mutate(g, sigma, rng) {
  for (let i = 0; i < NN.N_NET; i++) {
    if (rng() < CFG.mutRate) g[i] += rng.gauss() * sigma;
  }
  for (let i = NN.N_NET; i < NN.N_W; i++) {
    if (rng() < CFG.selMutRate) g[i] += rng.gauss() * CFG.selSigma;
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

function shuffled(n, rng) {
  const idx = Array.from({ length: n }, function (_, i) {
    return i;
  });
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx;
}

function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

async function main() {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch (e) {
    /* si no se puede bajar la prioridad, se sigue igual */
  }
  if (CFG.pop % CFG.arena !== 0) throw new Error('La población debe ser múltiplo de ' + CFG.arena);
  fs.mkdirSync(DIR, { recursive: true });
  const logFile = path.join(DIR, 'log.csv');
  const champFile = path.join(DIR, 'champions.jsonl');

  // Bots de referencia: los publicados, yendo siempre a la estrella más cercana.
  const published = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'weights.json'), 'utf8'));
  const seedsNets = published.levels[published.levels.length - 1].variants;
  const reference = A.withSelector(seedsNets, 0, 0);

  const rng = T.makeRng(CFG.seed);
  let sigma = CFG.sigma0;
  let pop = [];
  for (let i = 0; i < CFG.pop; i++) {
    const g = new Float64Array(NN.N_W);
    g.set(seedsNets[i % seedsNets.length].slice(0, NN.N_NET));
    // Una cuarta parte empieza sin criterio (como los publicados); el resto, con criterios variados.
    if (i >= CFG.pop / 4) {
      g[NN.N_NET] = rng() * 4;
      g[NN.N_NET + 1] = rng() * 2;
    }
    // Las primeras copias de cada red se dejan intactas; las demás, ligeramente mutadas.
    if (i >= seedsNets.length * 2) {
      for (let k = 0; k < NN.N_NET; k++) if (rng() < CFG.mutRate) g[k] += rng.gauss() * sigma;
    }
    pop.push(g);
  }

  fs.writeFileSync(logFile, 'gen,mejor,media,mediana,arena_puntos,arena_rivales,arena_gana,solo_puntos,sel_a,sel_b,media_sel_a,media_sel_b,sigma,segundos_calculo\n');
  fs.writeFileSync(champFile, '');
  fs.writeFileSync(path.join(DIR, 'config.json'), JSON.stringify(CFG, null, 2));
  console.log('Entrenamiento en arena "' + CFG.name + '": ' + JSON.stringify(CFG));
  console.log('gen   mejor   media | campeón vs 3 de referencia: puntos  rivales  gana | solo | criterio (campeón)  (media) | cálculo');

  const fit = new Float64Array(CFG.pop);
  for (let gen = 0; gen < CFG.gens; gen++) {
    const t0 = Date.now();
    fit.fill(0);
    for (let r = 0; r < CFG.rounds; r++) {
      // En cada ronda todas las mesas juegan la misma partida (misma semilla y dificultad);
      // los compañeros de mesa se sortean.
      const seed = 1 + rng.int(800000);
      const rules = { hazard: CFG.hazards[r % CFG.hazards.length] };
      const idx = shuffled(CFG.pop, rng);
      for (let t = 0; t < CFG.pop; t += CFG.arena) {
        const table = idx.slice(t, t + CFG.arena);
        const res = T.playArena(
          table.map(function (i) {
            return T.brainController(pop[i], CFG.delay);
          }),
          seed,
          CFG.maxTicks,
          rules
        );
        table.forEach(function (i, k) {
          fit[i] += res.players[k].score / CFG.rounds;
        });
      }
    }

    const order = Array.from(fit.keys()).sort(function (a, b) {
      return fit[b] - fit[a];
    });
    const champion = pop[order[0]];

    // Validación comparable entre generaciones: el campeón contra 3 bots de referencia fijos.
    let mine = 0;
    let rivals = 0;
    let wins = 0;
    VAL_ARENA.forEach(function (seed, g) {
      const slot = g % CFG.arena;
      let ref = 0;
      const makers = [];
      for (let k = 0; k < CFG.arena; k++) {
        makers.push(T.brainController(k === slot ? champion : reference[(ref++ + g) % reference.length], CFG.delay));
      }
      const res = T.playArena(makers, seed, CFG.maxTicks);
      res.players.forEach(function (p, k) {
        if (k === slot) mine += p.score;
        else rivals += p.score / (CFG.arena - 1);
      });
      if (res.winner === slot) wins++;
    });
    mine /= VAL_ARENA.length;
    rivals /= VAL_ARENA.length;
    const solo = T.evaluate(T.brainController(champion, CFG.delay), VAL_SOLO, CFG.maxTicks);

    let meanA = 0;
    let meanB = 0;
    for (const g of pop) {
      meanA += g[NN.N_NET] / pop.length;
      meanB += g[NN.N_NET + 1] / pop.length;
    }
    const st = stats(fit);
    const secs = (Date.now() - t0) / 1000;
    fs.appendFileSync(
      logFile,
      [gen, st.best.toFixed(0), st.mean.toFixed(0), st.median.toFixed(0), mine.toFixed(0), rivals.toFixed(0), (wins / VAL_ARENA.length).toFixed(2), solo.score.toFixed(0),
        champion[NN.N_NET].toFixed(2), champion[NN.N_NET + 1].toFixed(2), meanA.toFixed(2), meanB.toFixed(2), sigma.toFixed(3), secs.toFixed(1)].join(',') + '\n'
    );
    fs.appendFileSync(
      champFile,
      JSON.stringify({ gen: gen, val: Math.round(mine), win: +(wins / VAL_ARENA.length).toFixed(2), solo: Math.round(solo.score), weights: Array.from(champion, round5) }) + '\n'
    );
    console.log(
      String(gen).padStart(3) + st.best.toFixed(0).padStart(8) + st.mean.toFixed(0).padStart(8) + ' |' +
        mine.toFixed(0).padStart(35) + rivals.toFixed(0).padStart(9) + ((100 * wins) / VAL_ARENA.length).toFixed(0).padStart(5) + '% |' +
        solo.score.toFixed(0).padStart(6) + ' |' +
        ('(' + champion[NN.N_NET].toFixed(2) + ', ' + champion[NN.N_NET + 1].toFixed(2) + ')').padStart(16) +
        ('(' + meanA.toFixed(2) + ', ' + meanB.toFixed(2) + ')').padStart(16) + ' |' + (secs.toFixed(1) + ' s').padStart(8)
    );

    const next = [];
    for (let e = 0; e < CFG.elite; e++) next.push(pop[order[e]]);
    while (next.length < CFG.pop) {
      const a = tournament(pop, fit, rng);
      const child = rng() < CFG.crossover ? crossover(a, tournament(pop, fit, rng), rng) : Float64Array.from(a);
      next.push(mutate(child, sigma, rng));
    }
    pop = next;
    sigma = Math.max(CFG.sigmaMin, sigma * CFG.sigmaDecay);
    await sleep(CFG.restMs);
  }
  console.log('Hecho. Resultados en ' + DIR);
}

main();
