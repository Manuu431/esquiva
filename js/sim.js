// sim.js — lógica pura de "Esquiva". Sin DOM, sin reloj, sin Math.random.
// Mismo fichero en Node (require) y en el navegador (window.Sim).
// Todo el estado vive en un objeto plano; step() lo avanza un tick fijo de 1/60 s.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = Object.freeze({
    W: 800,
    H: 600,
    TICK_HZ: 60,
    DT: 1 / 60,
    MAX_PLAYERS: 6,

    PLAYER_R: 11,
    PLAYER_SPEED: 260, // px/s
    LIVES: 3, // por defecto; se puede elegir entre LIVES_MIN y LIVES_MAX al crear la ronda
    LIVES_MIN: 1,
    LIVES_MAX: 5,
    INVULN_TICKS: 90, // 1,5 s de gracia tras un impacto

    HAZ_R_MIN: 7,
    HAZ_R_MAX: 14,
    HAZ_SPEED0: 140, // px/s al empezar
    HAZ_SPEED_GROW: 3, // px/s ganados por segundo de ronda
    HAZ_SPEED_MAX: 520,
    HIT_FORGIVE: 0.85, // el radio de impacto es algo menor que el dibujado

    SPAWN_GRACE: 1.0, // s sin proyectiles al empezar
    SPAWN_INTERVAL0: 0.9, // s entre proyectiles al empezar
    SPAWN_HALVING: 18, // cada tantos s el ritmo sube en una unidad: i0 / (1 + t/18 + ...)
    SPAWN_RUSH: 60, // "muerte súbita": a partir de ~1 min el ritmo crece además con (t/60)^3
    SPAWN_INTERVAL_MIN: 0.02,
    SPAWN_SAFE_DIST: 150, // un proyectil no nace a menos de esto de un jugador
    AIM_AT_PLAYER: 0.6, // probabilidad de apuntar a un jugador (si no, a un punto al azar)
    AIM_NOISE: 70,
    OUT_MARGIN: 40,

    // Proyectiles especiales (además del normal, que cruza en línea recta y se va):
    BOUNCER_FROM: 12, // s de ronda a partir de los cuales aparecen los que rebotan
    BOUNCER_CHANCE: 0.12,
    BURST_FROM: 20, // ...y las ráfagas de tres en abanico
    BURST_CHANCE: 0.1,
    BURST_ANGLE: 0.24, // rad entre los proyectiles de una ráfaga

    STAR_COUNT: 3, // estrellas a la vez: con una sola, se la lleva quien la tenga más cerca
    STAR_R: 10,
    STAR_POINTS: 300, // un tick vivo = 1 punto; una estrella = 5 s
    STAR_MARGIN: 50,
    STAR_RESPAWN_DIST: 180, // una estrella no reaparece a menos de esto de quien la cogió
    STAR_MIN_SEP: 140, // ni a menos de esto de otra estrella o de una mejora
    STAR_PLAYER_DIST: 110, // ni a menos de esto de ningún jugador en pie...
    STAR_PLAYER_DIST_PER: 10, // ...más esto por cada jugador adicional (con 6 en pie: 160)
    STAR_TRIES: 16, // sitios que se prueban; si ninguno cumple todo, se queda el mejor

    // Mejoras: objetos que aparecen de vez en cuando y dan una ventaja a quien los coge.
    POWER_R: 13,
    POWER_FIRST: 7, // s hasta la primera
    POWER_EVERY_MIN: 8, // s entre una y la siguiente (con un jugador; con más, algo menos)
    POWER_EVERY_MAX: 13,
    POWER_TTL: 600, // ticks que espera en la arena antes de desaparecer (10 s)
    POWER_MAX: 2, // como mucho, a la vez en la arena
    TURBO_SPEED: 1.45, // multiplicador de velocidad con turbo
    MAGNET_R: 120, // con imán, las estrellas se cogen desde esta distancia
    BOMB_R: 230, // la bomba destruye los proyectiles a esta distancia
    SHIELD_INVULN: 30, // ticks de gracia tras perder el escudo
    HEART_POINTS: 300, // un corazón con todas las vidas da puntos en su lugar

    HAZARD_DEFAULT: 1, // dificultad de los proyectiles por defecto (índice de HAZARD_LEVELS)
  });

  // Dificultad de los proyectiles: multiplica su velocidad y su ritmo de aparición.
  const HAZARD_LEVELS = Object.freeze([
    Object.freeze({ speed: 0.8, rate: 0.7 }), // suave
    Object.freeze({ speed: 1, rate: 1 }), // normal
    Object.freeze({ speed: 1.2, rate: 1.4 }), // intensa
    Object.freeze({ speed: 1.5, rate: 2.4 }), // imposible
  ]);

  // Mejoras, por índice. `ticks` = cuánto dura el efecto (0 = instantáneo); `weight` = cuánto sale.
  const POWERS = Object.freeze([
    Object.freeze({ id: 'turbo', ticks: 360, weight: 3 }), // 0: te mueves un 45 % más rápido
    Object.freeze({ id: 'ghost', ticks: 240, weight: 2 }), // 1: intangible, los proyectiles te atraviesan
    Object.freeze({ id: 'shield', ticks: 720, weight: 3 }), // 2: absorbe el siguiente impacto
    Object.freeze({ id: 'heart', ticks: 0, weight: 1.5 }), // 3: una vida más (hasta el máximo)
    Object.freeze({ id: 'bomb', ticks: 0, weight: 2 }), // 4: destruye los proyectiles cercanos
    Object.freeze({ id: 'double', ticks: 480, weight: 2 }), // 5: puntos dobles
    Object.freeze({ id: 'magnet', ticks: 480, weight: 2 }), // 6: coges las estrellas desde lejos
  ]);
  const P_TURBO = 0;
  const P_GHOST = 1;
  const P_SHIELD = 2;
  const P_HEART = 3;
  const P_BOMB = 4;
  const P_DOUBLE = 5;
  const P_MAGNET = 6;

  const INV_SQRT2 = Math.SQRT1_2;
  const BURST_COS = Math.cos(C.BURST_ANGLE);
  const BURST_SIN = Math.sin(C.BURST_ANGLE);

  // PRNG mulberry32 con el estado guardado en state.rng (entero de 32 bits).
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function hazardLevel(level) {
    return HAZARD_LEVELS[level] || HAZARD_LEVELS[C.HAZARD_DEFAULT];
  }

  // t en segundos de ronda; level = dificultad de los proyectiles (por defecto, la normal).
  function hazardSpeed(t, level) {
    return Math.min(C.HAZ_SPEED_MAX, C.HAZ_SPEED0 + C.HAZ_SPEED_GROW * t) * hazardLevel(level).speed;
  }

  function spawnInterval(t, level) {
    // El término cúbico garantiza que ninguna ronda dure para siempre, por bueno que sea quien juegue.
    const rush = t / C.SPAWN_RUSH;
    const base = C.SPAWN_INTERVAL0 / (1 + t / C.SPAWN_HALVING + rush * rush * rush) / hazardLevel(level).rate;
    return Math.max(C.SPAWN_INTERVAL_MIN, base);
  }

  function clampInt(v, def, min, max) {
    v = v === undefined || v === null ? def : v | 0;
    return v < min ? min : v > max ? max : v;
  }

  // opts: { seed, numPlayers, lives (1-5), hazard (0 suave ... 3 imposible), powerups (true/false) }
  function createState(opts) {
    const o = opts || {};
    const n = Math.max(1, Math.min(C.MAX_PLAYERS, o.numPlayers | 0 || 1));
    const lives = clampInt(o.lives, C.LIVES, C.LIVES_MIN, C.LIVES_MAX);
    const s = {
      tick: 0,
      rng: (o.seed | 0) || 1,
      numPlayers: n,
      maxLives: lives,
      hazard: clampInt(o.hazard, C.HAZARD_DEFAULT, 0, HAZARD_LEVELS.length - 1),
      power: o.powerups === false || o.powerups === 0 ? 0 : 1, // ¿hay mejoras en esta ronda?
      players: [],
      hazards: [],
      stars: [], // estrellas en la arena (no confundir con player.stars, las que lleva cogidas)
      powerups: [], // mejoras en la arena: { x, y, type, ttl }
      spawnTimer: C.SPAWN_GRACE,
      powerTimer: C.POWER_FIRST,
      over: false,
      winner: -1,
      events: [],
    };
    for (let i = 0; i < n; i++) {
      // Un jugador solo empieza en el centro; varios, repartidos en un círculo.
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rad = n === 1 ? 0 : 130;
      s.players.push({
        x: C.W / 2 + Math.cos(a) * rad,
        y: C.H / 2 + Math.sin(a) * rad,
        mx: 0,
        my: 0,
        lives: lives,
        inv: 0,
        alive: true,
        score: 0,
        stars: 0,
        deathTick: -1,
        // Efectos de mejoras: ticks que le quedan a cada uno (0 = no lo tiene).
        turbo: 0,
        ghost: 0,
        shield: 0,
        double: 0,
        magnet: 0,
      });
    }
    for (let k = 0; k < C.STAR_COUNT; k++) {
      s.stars.push({ x: -1e4, y: -1e4 });
      placeStar(s, k, -1);
    }
    return s;
  }

  function aliveCount(s) {
    let n = 0;
    for (let i = 0; i < s.players.length; i++) if (s.players[i].alive) n++;
    return n;
  }

  // Distancia mínima a la que debe aparecer una estrella o una mejora de cualquier jugador en
  // pie. Crece con el número de jugadores: cuantos más hay, más fácil es que a alguno le caiga al lado.
  function starPlayerDist(s) {
    return C.STAR_PLAYER_DIST + C.STAR_PLAYER_DIST_PER * Math.max(0, aliveCount(s) - 1);
  }

  const _spot = { x: 0, y: 0 };

  // Busca un sitio al azar que esté lejos de todos los jugadores (nadie lo recibe regalado), más
  // lejos aún de `avoidIdx` (quien acaba de coger algo, para que no encadene) y separado de las
  // estrellas y mejoras que ya hay. Se prueban varios sitios; si ninguno lo cumple todo (arena
  // muy llena), se queda el que más se acerca. `skipStar` = estrella que se está recolocando.
  function findSpot(s, avoidIdx, skipStar) {
    const m = C.STAR_MARGIN;
    const need = starPlayerDist(s);
    let bestQ = -1;
    for (let tries = 0; tries < C.STAR_TRIES; tries++) {
      const x = m + rand(s) * (C.W - 2 * m);
      const y = m + rand(s) * (C.H - 2 * m);
      // q = la peor de las distancias, cada una medida respecto a la que se pide (1 = cumple).
      let q = 1;
      for (let i = 0; i < s.players.length; i++) {
        const p = s.players[i];
        if (!p.alive) continue;
        const dx = x - p.x;
        const dy = y - p.y;
        const want = i === avoidIdx && C.STAR_RESPAWN_DIST > need ? C.STAR_RESPAWN_DIST : need;
        const r = Math.sqrt(dx * dx + dy * dy) / want;
        if (r < q) q = r;
      }
      for (let j = 0; j < s.stars.length; j++) {
        if (j === skipStar) continue;
        const dx = x - s.stars[j].x;
        const dy = y - s.stars[j].y;
        const r = Math.sqrt(dx * dx + dy * dy) / C.STAR_MIN_SEP;
        if (r < q) q = r;
      }
      for (let j = 0; j < s.powerups.length; j++) {
        const dx = x - s.powerups[j].x;
        const dy = y - s.powerups[j].y;
        const r = Math.sqrt(dx * dx + dy * dy) / C.STAR_MIN_SEP;
        if (r < q) q = r;
      }
      if (q > bestQ) {
        bestQ = q;
        _spot.x = x;
        _spot.y = y;
        if (q >= 1) break;
      }
    }
    return _spot;
  }

  function placeStar(s, k, avoidIdx) {
    const spot = findSpot(s, avoidIdx, k);
    s.stars[k].x = spot.x;
    s.stars[k].y = spot.y;
  }

  // Punto del perímetro (justo fuera de la arena) para una fracción u en [0,1).
  function perimeterPoint(u, r, out) {
    const per = 2 * (C.W + C.H);
    let d = u * per;
    if (d < C.W) {
      out.x = d;
      out.y = -r;
    } else if ((d -= C.W) < C.H) {
      out.x = C.W + r;
      out.y = d;
    } else if ((d -= C.H) < C.W) {
      out.x = C.W - d;
      out.y = C.H + r;
    } else {
      out.x = -r;
      out.y = C.H - (d - C.W);
    }
  }

  const _pt = { x: 0, y: 0 };

  function spawnHazard(s, t) {
    const sizeU = rand(s);
    let r = C.HAZ_R_MIN + sizeU * (C.HAZ_R_MAX - C.HAZ_R_MIN);
    const safe2 = C.SPAWN_SAFE_DIST * C.SPAWN_SAFE_DIST;
    // Hasta 4 intentos de nacer lejos de todos: nada de impactos sin aviso junto al borde.
    for (let tries = 0; tries < 4; tries++) {
      perimeterPoint(rand(s), r, _pt);
      let ok = true;
      for (let i = 0; i < s.players.length; i++) {
        const p = s.players[i];
        if (!p.alive) continue;
        const dx = p.x - _pt.x;
        const dy = p.y - _pt.y;
        if (dx * dx + dy * dy < safe2) {
          ok = false;
          break;
        }
      }
      if (ok) break;
    }
    let tx;
    let ty;
    const target = rand(s) < C.AIM_AT_PLAYER ? pickAlive(s) : null;
    if (target) {
      tx = target.x + (rand(s) * 2 - 1) * C.AIM_NOISE;
      ty = target.y + (rand(s) * 2 - 1) * C.AIM_NOISE;
    } else {
      tx = C.W * (0.15 + 0.7 * rand(s));
      ty = C.H * (0.15 + 0.7 * rand(s));
    }
    const dx = tx - _pt.x;
    const dy = ty - _pt.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    // Los grandes van algo más lentos que los pequeños.
    const speed = hazardSpeed(t, s.hazard) * (1.15 - 0.3 * sizeU) * (0.9 + 0.2 * rand(s));
    const vx = (dx / d) * speed;
    const vy = (dy / d) * speed;

    // k = tipo (0 normal, 1 rebota, 2 de ráfaga); b = rebotes que le quedan.
    const roll = rand(s);
    if (t >= C.BOUNCER_FROM && roll < C.BOUNCER_CHANCE) {
      s.hazards.push({ x: _pt.x, y: _pt.y, vx: vx, vy: vy, r: r, k: 1, b: 1 + (rand(s) < 0.4 ? 1 : 0) });
    } else if (t >= C.BURST_FROM && roll < C.BOUNCER_CHANCE + C.BURST_CHANCE) {
      // Ráfaga: tres pequeños en abanico desde el mismo punto.
      r = C.HAZ_R_MIN + 1;
      s.hazards.push({ x: _pt.x, y: _pt.y, vx: vx, vy: vy, r: r, k: 2, b: 0 });
      s.hazards.push({ x: _pt.x, y: _pt.y, vx: vx * BURST_COS - vy * BURST_SIN, vy: vx * BURST_SIN + vy * BURST_COS, r: r, k: 2, b: 0 });
      s.hazards.push({ x: _pt.x, y: _pt.y, vx: vx * BURST_COS + vy * BURST_SIN, vy: -vx * BURST_SIN + vy * BURST_COS, r: r, k: 2, b: 0 });
    } else {
      s.hazards.push({ x: _pt.x, y: _pt.y, vx: vx, vy: vy, r: r, k: 0, b: 0 });
    }
  }

  // Avanza un proyectil dt segundos. Los que rebotan cambian de sentido al llegar a una pared
  // mientras les queden rebotes; después salen de la arena como los demás.
  function moveHazard(z, dt) {
    z.x += z.vx * dt;
    z.y += z.vy * dt;
    if (z.b > 0) {
      if (z.x < z.r && z.vx < 0) {
        z.x = 2 * z.r - z.x;
        z.vx = -z.vx;
        z.b--;
      } else if (z.x > C.W - z.r && z.vx > 0) {
        z.x = 2 * (C.W - z.r) - z.x;
        z.vx = -z.vx;
        z.b--;
      }
    }
    if (z.b > 0) {
      if (z.y < z.r && z.vy < 0) {
        z.y = 2 * z.r - z.y;
        z.vy = -z.vy;
        z.b--;
      } else if (z.y > C.H - z.r && z.vy > 0) {
        z.y = 2 * (C.H - z.r) - z.y;
        z.vy = -z.vy;
        z.b--;
      }
    }
  }

  const _hz = { x: 0, y: 0, vx: 0, vy: 0, r: 0, b: 0 };

  // Dónde estará un proyectil dentro de `secs` segundos (sin modificarlo). Lo usan el dibujo
  // (para adelantar los proyectiles en el invitado) y los bots que planifican.
  function hazardPos(z, secs, out) {
    if (!(z.b > 0)) {
      out.x = z.x + z.vx * secs;
      out.y = z.y + z.vy * secs;
      return out;
    }
    _hz.x = z.x;
    _hz.y = z.y;
    _hz.vx = z.vx;
    _hz.vy = z.vy;
    _hz.r = z.r;
    _hz.b = z.b;
    let left = secs;
    while (left > 1e-9) {
      const dt = left > C.DT ? C.DT : left;
      moveHazard(_hz, dt);
      left -= dt;
    }
    out.x = _hz.x;
    out.y = _hz.y;
    return out;
  }

  function pickAlive(s) {
    const n = aliveCount(s);
    if (n === 0) return null;
    let k = Math.floor(rand(s) * n);
    for (let i = 0; i < s.players.length; i++) {
      if (!s.players[i].alive) continue;
      if (k-- === 0) return s.players[i];
    }
    return null;
  }

  function sign(v) {
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  // Mueve a un jugador un tick. Separado de step() para que el cliente de red
  // pueda predecir su propio movimiento con exactamente la misma regla.
  function movePlayer(p, mx, my) {
    mx = sign(mx);
    my = sign(my);
    p.mx = mx;
    p.my = my;
    let k = C.PLAYER_SPEED * C.DT;
    if (p.turbo > 0) k *= C.TURBO_SPEED;
    if (mx !== 0 && my !== 0) k *= INV_SQRT2;
    const r = C.PLAYER_R;
    const x = p.x + mx * k;
    const y = p.y + my * k;
    p.x = x < r ? r : x > C.W - r ? C.W - r : x;
    p.y = y < r ? r : y > C.H - r ? C.H - r : y;
  }

  // ---------- Mejoras ----------

  function spawnPower(s) {
    // Qué sale: al azar según su peso; el corazón solo si a alguien le falta una vida.
    let needHeart = false;
    for (let i = 0; i < s.players.length; i++) {
      if (s.players[i].alive && s.players[i].lives < s.maxLives) needHeart = true;
    }
    let total = 0;
    for (let k = 0; k < POWERS.length; k++) total += k === P_HEART && !needHeart ? 0 : POWERS[k].weight;
    let roll = rand(s) * total;
    let type = 0;
    for (let k = 0; k < POWERS.length; k++) {
      const w = k === P_HEART && !needHeart ? 0 : POWERS[k].weight;
      if (roll < w) {
        type = k;
        break;
      }
      roll -= w;
    }
    const spot = findSpot(s, -1, -1);
    s.powerups.push({ x: spot.x, y: spot.y, type: type, ttl: C.POWER_TTL });
  }

  function applyPower(s, i, type) {
    const p = s.players[i];
    if (type === P_TURBO) p.turbo = POWERS[P_TURBO].ticks;
    else if (type === P_GHOST) p.ghost = POWERS[P_GHOST].ticks;
    else if (type === P_SHIELD) p.shield = POWERS[P_SHIELD].ticks;
    else if (type === P_DOUBLE) p.double = POWERS[P_DOUBLE].ticks;
    else if (type === P_MAGNET) p.magnet = POWERS[P_MAGNET].ticks;
    else if (type === P_HEART) {
      if (p.lives < s.maxLives) p.lives++;
      else p.score += C.HEART_POINTS;
    } else if (type === P_BOMB) {
      const hz = s.hazards;
      const r2 = C.BOMB_R * C.BOMB_R;
      for (let h = hz.length - 1; h >= 0; h--) {
        const dx = hz[h].x - p.x;
        const dy = hz[h].y - p.y;
        if (dx * dx + dy * dy < r2) {
          hz[h] = hz[hz.length - 1];
          hz.pop();
        }
      }
      s.events.push({ type: 'bomb', p: i, x: p.x, y: p.y });
    }
  }

  // inputs[i] = { mx, my } con valores en {-1, 0, 1}; puede faltar (se trata como quieto).
  function step(s, inputs) {
    if (s.over) return s;
    s.events.length = 0;
    s.tick++;
    const t = s.tick * C.DT;
    const players = s.players;
    const np = players.length;

    for (let i = 0; i < np; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const inp = inputs ? inputs[i] : null;
      movePlayer(p, inp ? inp.mx : 0, inp ? inp.my : 0);
      if (p.inv > 0) p.inv--;
      if (p.turbo > 0) p.turbo--;
      if (p.ghost > 0) p.ghost--;
      if (p.shield > 0) p.shield--;
      if (p.magnet > 0) p.magnet--;
      p.score += p.double > 0 ? 2 : 1;
      if (p.double > 0) p.double--;
    }

    s.spawnTimer -= C.DT;
    while (s.spawnTimer <= 0) {
      spawnHazard(s, t);
      s.spawnTimer += spawnInterval(t, s.hazard);
    }

    const hz = s.hazards;
    const m = C.OUT_MARGIN;
    for (let h = hz.length - 1; h >= 0; h--) {
      const z = hz[h];
      moveHazard(z, C.DT);
      let gone = z.x < -m || z.x > C.W + m || z.y < -m || z.y > C.H + m;
      if (!gone) {
        for (let i = 0; i < np; i++) {
          const p = players[i];
          if (!p.alive || p.inv > 0 || p.ghost > 0) continue;
          const dx = z.x - p.x;
          const dy = z.y - p.y;
          const rr = C.PLAYER_R + z.r * C.HIT_FORGIVE;
          if (dx * dx + dy * dy < rr * rr) {
            if (p.shield > 0) {
              // El escudo se gasta en lugar de una vida.
              p.shield = 0;
              p.inv = C.SHIELD_INVULN;
              s.events.push({ type: 'shield', p: i, x: p.x, y: p.y });
            } else {
              p.lives--;
              p.inv = C.INVULN_TICKS;
              s.events.push({ type: 'hit', p: i, x: p.x, y: p.y });
              if (p.lives <= 0) {
                p.alive = false;
                p.deathTick = s.tick;
                s.events.push({ type: 'dead', p: i, x: p.x, y: p.y });
              }
            }
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        hz[h] = hz[hz.length - 1];
        hz.pop();
      }
    }

    // Estrellas: si dos jugadores tocan la misma en el mismo tick, se la lleva el más cercano.
    // Con imán se cogen desde más lejos.
    const sr = C.PLAYER_R + C.STAR_R;
    for (let k = 0; k < s.stars.length; k++) {
      const st = s.stars[k];
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < np; i++) {
        const p = players[i];
        if (!p.alive) continue;
        const dx = p.x - st.x;
        const dy = p.y - st.y;
        const d2 = dx * dx + dy * dy;
        const reach = p.magnet > 0 ? C.MAGNET_R : sr;
        if (d2 < reach * reach && d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      if (best >= 0) {
        const p = players[best];
        p.score += p.double > 0 ? 2 * C.STAR_POINTS : C.STAR_POINTS;
        p.stars++;
        s.events.push({ type: 'star', p: best, x: st.x, y: st.y });
        placeStar(s, k, best);
      }
    }

    // Mejoras: aparecen de vez en cuando, esperan un rato y se las lleva quien las toque.
    if (s.power) {
      const pr = C.PLAYER_R + C.POWER_R;
      for (let k = s.powerups.length - 1; k >= 0; k--) {
        const u = s.powerups[k];
        let best = -1;
        let bestD = pr * pr;
        for (let i = 0; i < np; i++) {
          const p = players[i];
          if (!p.alive) continue;
          const dx = p.x - u.x;
          const dy = p.y - u.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = i;
          }
        }
        if (best >= 0) {
          s.events.push({ type: 'power', p: best, x: u.x, y: u.y, k: u.type });
          applyPower(s, best, u.type);
        }
        if (best >= 0 || --u.ttl <= 0) {
          s.powerups[k] = s.powerups[s.powerups.length - 1];
          s.powerups.pop();
        }
      }
      s.powerTimer -= C.DT;
      if (s.powerTimer <= 0) {
        if (s.powerups.length < C.POWER_MAX) spawnPower(s);
        const wait = C.POWER_EVERY_MIN + rand(s) * (C.POWER_EVERY_MAX - C.POWER_EVERY_MIN);
        s.powerTimer = wait / (1 + 0.15 * Math.max(0, aliveCount(s) - 1));
      }
    }

    // Fin de ronda: en solitario al morir; con varios, cuando queda uno en pie (o ninguno).
    // Gana quien más puntos tiene: aguantar puntúa, pero las estrellas también.
    if (aliveCount(s) <= (np === 1 ? 0 : 1)) {
      s.over = true;
      s.winner = ranking(s)[0];
      s.events.push({ type: 'over', p: s.winner, x: 0, y: 0 });
    }
    return s;
  }

  // Retira a un jugador de la ronda (se ha desconectado). El fin de ronda se decide en el
  // siguiente step(), igual que si hubiera caído jugando.
  function eliminate(s, idx) {
    const p = s.players[idx];
    if (!p || !p.alive || s.over) return;
    p.lives = 0;
    p.alive = false;
    p.deathTick = s.tick;
  }

  // Clasificación de la ronda: por puntos; a igualdad, quien sigue en pie o cayó más tarde.
  function ranking(s) {
    const idx = s.players.map(function (_, i) {
      return i;
    });
    idx.sort(function (a, b) {
      const p = s.players[a];
      const q = s.players[b];
      if (p.score !== q.score) return q.score - p.score;
      if (p.alive !== q.alive) return p.alive ? -1 : 1;
      return q.deathTick - p.deathTick;
    });
    return idx;
  }

  return {
    C: C,
    HAZARD_LEVELS: HAZARD_LEVELS,
    POWERS: POWERS,
    starPlayerDist: starPlayerDist,
    createState: createState,
    step: step,
    movePlayer: movePlayer,
    moveHazard: moveHazard,
    hazardPos: hazardPos,
    applyPower: applyPower,
    eliminate: eliminate,
    ranking: ranking,
    hazardSpeed: hazardSpeed,
    spawnInterval: spawnInterval,
    rand: rand,
  };
});
