// render.js — dibujo en canvas. Solo lee el estado; nunca lo modifica.
// Pensado para un portátil sin GPU: sin sombras ni filtros, brillos pre-renderizados.
(function () {
  'use strict';

  const C = Sim.C;
  const COLORS = ['#38e1ff', '#ff5fd2', '#ffd23f', '#5dff8f', '#ff9a3c', '#a98bff'];
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
  const TAU = Math.PI * 2;

  let canvas = null;
  let ctx = null;
  let scale = 1;
  let bg = null;
  let shake = 0;
  const particles = [];
  const rings = []; // ondas expansivas (bomba)
  const glows = {};
  const _pos = { x: 0, y: 0 };
  let hpos = new Float64Array(256); // posiciones de los proyectiles en este frame
  // Color de cada mejora, en el orden de Sim.POWERS: turbo, fantasma, escudo, corazón, bomba, doble, imán.
  const POWER_COLORS = ['#ffe14d', '#dfe4ff', '#4da3ff', '#ff4d5e', '#aab3d6', '#5dff8f', '#c77dff'];

  function init(c) {
    canvas = c;
    ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const k = Math.min((window.innerWidth - 12) / C.W, (window.innerHeight - 12) / C.H);
    const cssW = Math.max(160, Math.floor(C.W * k));
    const cssH = Math.max(120, Math.floor(C.H * k));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = canvas.width / C.W;
    bg = null;
  }

  function makeBackground() {
    const b = document.createElement('canvas');
    b.width = canvas.width;
    b.height = canvas.height;
    const g = b.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const grad = g.createRadialGradient(C.W / 2, C.H / 2, 60, C.W / 2, C.H / 2, 560);
    grad.addColorStop(0, '#131a36');
    grad.addColorStop(1, '#090c18');
    g.fillStyle = grad;
    g.fillRect(0, 0, C.W, C.H);
    g.strokeStyle = 'rgba(120, 140, 220, 0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 40; x < C.W; x += 40) {
      g.moveTo(x, 0);
      g.lineTo(x, C.H);
    }
    for (let y = 40; y < C.H; y += 40) {
      g.moveTo(0, y);
      g.lineTo(C.W, y);
    }
    g.stroke();
    return b;
  }

  // Halo circular pre-renderizado de un color (se dibuja escalado con drawImage).
  function glow(color) {
    if (glows[color]) return glows[color];
    const n = 64;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55;
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    glows[color] = c;
    return c;
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.3 + Math.random() * 0.7);
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: color });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  // Efectos visuales a partir de los eventos que emite la simulación.
  function onEvents(events, localIdx) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'hit') {
        burst(e.x, e.y, COLORS[e.p % COLORS.length], 14, 220);
        if (e.p === localIdx) shake = 9;
      } else if (e.type === 'dead') {
        burst(e.x, e.y, COLORS[e.p % COLORS.length], 34, 320);
        burst(e.x, e.y, '#ffffff', 10, 160);
      } else if (e.type === 'star') {
        burst(e.x, e.y, '#ffd23f', 12, 180);
      } else if (e.type === 'power') {
        burst(e.x, e.y, POWER_COLORS[e.k] || '#ffffff', 16, 200);
      } else if (e.type === 'shield') {
        burst(e.x, e.y, POWER_COLORS[2], 18, 260);
      } else if (e.type === 'bomb') {
        rings.push({ x: e.x, y: e.y, life: 1 });
        burst(e.x, e.y, '#ffffff', 24, 420);
      }
    }
  }

  function clearEffects() {
    particles.length = 0;
    rings.length = 0;
    shake = 0;
  }

  // Corazón centrado en (x, y) de ancho s.
  function heartPath(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.8, y - s * 0.05, x - s * 0.4, y - s * 0.7, x, y - s * 0.22);
    ctx.bezierCurveTo(x + s * 0.4, y - s * 0.7, x + s * 0.8, y - s * 0.05, x, y + s * 0.45);
    ctx.closePath();
  }

  // Icono de una mejora, centrado en (x, y), dentro de un círculo de radio r.
  function powerIcon(type, x, y, r) {
    const color = POWER_COLORS[type] || '#ffffff';
    ctx.fillStyle = '#0f1530';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const u = r / 13;
    if (type === 0) {
      // Turbo: dos flechas.
      ctx.beginPath();
      ctx.moveTo(x - 6 * u, y - 5 * u);
      ctx.lineTo(x - 1 * u, y);
      ctx.lineTo(x - 6 * u, y + 5 * u);
      ctx.moveTo(x + 1 * u, y - 5 * u);
      ctx.lineTo(x + 6 * u, y);
      ctx.lineTo(x + 1 * u, y + 5 * u);
      ctx.stroke();
    } else if (type === 1) {
      // Fantasma: un círculo a trazos.
      ctx.setLineDash([3 * u, 3 * u]);
      ctx.beginPath();
      ctx.arc(x, y, 6 * u, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (type === 2) {
      // Escudo.
      ctx.beginPath();
      ctx.moveTo(x - 6 * u, y - 6 * u);
      ctx.lineTo(x + 6 * u, y - 6 * u);
      ctx.lineTo(x + 6 * u, y);
      ctx.quadraticCurveTo(x + 5 * u, y + 6 * u, x, y + 8 * u);
      ctx.quadraticCurveTo(x - 5 * u, y + 6 * u, x - 6 * u, y);
      ctx.closePath();
      ctx.fill();
    } else if (type === 3) {
      heartPath(x, y + 1 * u, 13 * u);
      ctx.fill();
    } else if (type === 4) {
      // Bomba: bola con mecha.
      ctx.beginPath();
      ctx.arc(x - 1 * u, y + 2 * u, 5.5 * u, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 2 * u, y - 3 * u);
      ctx.lineTo(x + 6 * u, y - 7 * u);
      ctx.stroke();
    } else if (type === 5) {
      ctx.font = '800 ' + Math.round(11 * u) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('x2', x, y + 0.5);
    } else {
      // Imán: una herradura.
      ctx.lineWidth = 3.4 * u;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x - 5 * u, y - 6 * u);
      ctx.lineTo(x - 5 * u, y + 1 * u);
      ctx.arc(x, y + 1 * u, 5 * u, Math.PI, 0, true);
      ctx.lineTo(x + 5 * u, y - 6 * u);
      ctx.stroke();
    }
  }

  function starPath(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // view: estado con la forma del de sim.js. meta[i] = { name, kind }.
  // o: { localIdx, dt (s desde el frame anterior), hazExt / plExt (s a extrapolar), countdown, banner }
  function draw(view, meta, o) {
    if (!bg) bg = makeBackground();
    const dt = Math.min(0.05, o.dt || 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);

    let ox = 0;
    let oy = 0;
    if (shake > 0.3) {
      ox = (Math.random() * 2 - 1) * shake;
      oy = (Math.random() * 2 - 1) * shake;
      shake *= Math.pow(0.001, dt);
    }
    ctx.setTransform(scale, 0, 0, scale, ox * scale, oy * scale);

    if (view) {
      const time = view.tick / C.TICK_HZ;
      const hazExt = o.hazExt || 0;
      const plExt = o.plExt || 0;

      // Estrella
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < view.stars.length; i++) {
        const st = view.stars[i];
        const pulse = 1 + 0.12 * Math.sin(time * 5 + i * 2);
        ctx.drawImage(glow('#ffd23f'), st.x - 30, st.y - 30, 60, 60);
        starPath(st.x, st.y, C.STAR_R * 1.25 * pulse, time * 1.4 + i);
        ctx.fill();
      }

      // Mejoras: una ficha con su icono; parpadea cuando está a punto de desaparecer.
      const ups = view.powerups || [];
      for (let i = 0; i < ups.length; i++) {
        const w = ups[i];
        if (w.ttl < 120 && Math.floor(w.ttl / 8) % 2 === 0) continue;
        const bob = 1 + 0.08 * Math.sin(time * 6 + i);
        ctx.drawImage(glow(POWER_COLORS[w.type] || '#ffffff'), w.x - 32, w.y - 32, 64, 64);
        powerIcon(w.type, w.x, w.y, C.POWER_R * bob);
      }

      // Proyectiles: estela + cuerpo. Todos rojos (rojo = peligro); los que rebotan llevan un
      // anillo blanco mientras les quedan rebotes y los de ráfaga son más oscuros.
      const hz = view.hazards;
      const n = hz.length;
      if (hpos.length < n * 2) hpos = new Float64Array(n * 2 + 64);
      for (let i = 0; i < n; i++) {
        Sim.hazardPos(hz[i], hazExt, _pos);
        hpos[i * 2] = _pos.x;
        hpos[i * 2 + 1] = _pos.y;
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 77, 94, 0.28)';
      for (let i = 0; i < n; i++) {
        const z = hz[i];
        const x = hpos[i * 2];
        const y = hpos[i * 2 + 1];
        ctx.lineWidth = z.r * 1.3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - z.vx * 0.07, y - z.vy * 0.07);
        ctx.stroke();
      }
      for (let kind = 0; kind < 3; kind++) {
        ctx.fillStyle = kind === 2 ? '#d92b4b' : '#ff4d5e';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const z = hz[i];
          if ((z.k | 0) !== kind) continue;
          ctx.moveTo(hpos[i * 2] + z.r, hpos[i * 2 + 1]);
          ctx.arc(hpos[i * 2], hpos[i * 2 + 1], z.r, 0, TAU);
        }
        ctx.fill();
      }
      ctx.fillStyle = '#ffd9dc';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const z = hz[i];
        ctx.moveTo(hpos[i * 2] + z.r * 0.4, hpos[i * 2 + 1]);
        ctx.arc(hpos[i * 2], hpos[i * 2 + 1], z.r * 0.4, 0, TAU);
      }
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const z = hz[i];
        if (!(z.b > 0)) continue;
        ctx.moveTo(hpos[i * 2] + z.r + 3, hpos[i * 2 + 1]);
        ctx.arc(hpos[i * 2], hpos[i * 2 + 1], z.r + 3, 0, TAU);
      }
      ctx.stroke();

      // Jugadores
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '600 11px ' + FONT;
      for (let i = 0; i < view.players.length; i++) {
        const p = view.players[i];
        const color = COLORS[i % COLORS.length];
        if (!p.alive) {
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, C.PLAYER_R, 0, TAU);
          ctx.moveTo(p.x - 5, p.y - 5);
          ctx.lineTo(p.x + 5, p.y + 5);
          ctx.moveTo(p.x + 5, p.y - 5);
          ctx.lineTo(p.x - 5, p.y + 5);
          ctx.stroke();
          ctx.globalAlpha = 1;
          continue;
        }
        let x = p.x;
        let y = p.y;
        if (plExt > 0 && (p.mx || p.my)) {
          const k = C.PLAYER_SPEED * plExt * (p.mx && p.my ? Math.SQRT1_2 : 1) * (p.turbo > 0 ? C.TURBO_SPEED : 1);
          x = Math.max(C.PLAYER_R, Math.min(C.W - C.PLAYER_R, x + p.mx * k));
          y = Math.max(C.PLAYER_R, Math.min(C.H - C.PLAYER_R, y + p.my * k));
        }
        // Un efecto a punto de acabarse parpadea para avisar.
        const ending = function (ticks) {
          return ticks < 60 && Math.floor(ticks / 6) % 2 === 0;
        };
        const blink = p.inv > 0 && Math.floor(view.tick / 5) % 2 === 0;
        const ghost = p.ghost > 0 && !ending(p.ghost);
        const base = blink ? 0.3 : ghost ? 0.38 : 1;

        if (p.magnet > 0 && !ending(p.magnet)) {
          ctx.globalAlpha = 0.16;
          ctx.strokeStyle = POWER_COLORS[6];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, C.MAGNET_R, 0, TAU);
          ctx.stroke();
        }
        if (p.turbo > 0 && (p.mx || p.my) && !ending(p.turbo)) {
          // Turbo: estela de dos sombras detrás.
          ctx.fillStyle = color;
          for (let g = 1; g <= 2; g++) {
            ctx.globalAlpha = base * (0.34 - g * 0.1);
            ctx.beginPath();
            ctx.arc(x - p.mx * g * 9, y - p.my * g * 9, C.PLAYER_R - g, 0, TAU);
            ctx.fill();
          }
        }
        ctx.globalAlpha = base;
        ctx.drawImage(glow(color), x - 26, y - 26, 52, 52);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, C.PLAYER_R, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0a0d18';
        ctx.beginPath();
        ctx.arc(x + p.mx * 3, y + p.my * 3, 4, 0, TAU);
        ctx.fill();
        if (i === o.localIdx) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, C.PLAYER_R + 3.5, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (ghost) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = POWER_COLORS[1];
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, C.PLAYER_R + 7, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (p.shield > 0 && !ending(p.shield)) {
          ctx.strokeStyle = POWER_COLORS[2];
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, C.PLAYER_R + 7, 0, TAU);
          ctx.stroke();
        }
        if (p.double > 0 && !ending(p.double)) {
          ctx.font = '800 11px ' + FONT;
          ctx.textAlign = 'left';
          ctx.fillStyle = POWER_COLORS[5];
          ctx.fillText('x2', x + C.PLAYER_R + 5, y + 4);
          ctx.textAlign = 'center';
          ctx.font = '600 11px ' + FONT;
        }
        const m = meta[i];
        if (m && view.players.length > 1) {
          ctx.fillStyle = 'rgba(232, 236, 255, 0.75)';
          ctx.fillText(m.name, x, y - C.PLAYER_R - 11);
        }
      }
    }

    // Ondas de las bombas.
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.life -= dt * 2.6;
      if (g.life <= 0) {
        rings[i] = rings[rings.length - 1];
        rings.pop();
        continue;
      }
      ctx.globalAlpha = g.life * 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(g.x, g.y, C.BOMB_R * (1 - g.life), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Partículas
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.life -= dt * 1.9;
      if (q.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.96;
      q.vy *= 0.96;
      ctx.globalAlpha = q.life;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (view) drawHud(view, meta, o);

    if (o.dim) {
      // Exhibición detrás del menú: se oscurece para que no compita con él.
      ctx.fillStyle = 'rgba(9, 12, 24, 0.55)';
      ctx.fillRect(0, 0, C.W, C.H);
    }
    if (o.countdown) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 120px ' + FONT;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.9)';
      ctx.fillText(String(o.countdown), C.W / 2, C.H / 2 - 10);
    }
    if (o.banner) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 15px ' + FONT;
      ctx.fillStyle = 'rgba(232, 236, 255, 0.8)';
      ctx.fillText(o.banner, C.W / 2, C.H - 46);
    }
  }

  function drawHud(view, meta, o) {
    const n = view.players.length;
    const cellW = Math.min(190, (C.W - 16) / n);
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const p = view.players[i];
      const color = COLORS[i % COLORS.length];
      const x0 = 8 + i * cellW;
      const y = 16;
      ctx.globalAlpha = p.alive ? 1 : 0.4;
      ctx.fillStyle = 'rgba(8, 11, 22, 0.6)';
      ctx.fillRect(x0, 4, cellW - 4, 24);
      if (i === o.localIdx) {
        ctx.fillStyle = color;
        ctx.fillRect(x0, 26, cellW - 4, 2);
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x0 + 10, y, 4.5, 0, TAU);
      ctx.fill();
      // Vidas: un corazón por vida; las perdidas quedan apagadas.
      const maxLives = view.maxLives || C.LIVES;
      for (let l = 0; l < maxLives; l++) {
        heartPath(x0 + 24 + l * 10, y, 9);
        ctx.fillStyle = l < p.lives ? '#ff4d5e' : 'rgba(255,255,255,0.22)';
        ctx.fill();
      }
      const nameX = 22 + maxLives * 10;
      ctx.font = '700 12px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e8ecff';
      ctx.fillText(String(p.score), x0 + cellW - 9, y + 0.5);
      if (cellW - nameX > 80 && meta[i]) {
        ctx.font = '500 11px ' + FONT;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(232, 236, 255, 0.7)';
        ctx.fillText(clip(meta[i].name, cellW - nameX - 52), x0 + nameX, y + 0.5);
      }
    }
    ctx.globalAlpha = 1;

    const secs = Math.floor(view.tick / C.TICK_HZ);
    ctx.font = '600 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(232, 236, 255, 0.45)';
    ctx.fillText(Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'), C.W / 2, C.H - 14);
  }

  function clip(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  window.Render = {
    COLORS: COLORS,
    POWER_COLORS: POWER_COLORS,
    // Dibuja el icono de una mejora en otro canvas (para la ayuda del menú).
    drawPowerIcon: function (target, type) {
      const prev = ctx;
      ctx = target.getContext('2d');
      ctx.setTransform(target.width / 32, 0, 0, target.height / 32, 0, 0);
      ctx.clearRect(0, 0, 32, 32);
      powerIcon(type, 16, 16, 13);
      ctx = prev;
    },
    init: init,
    resize: resize,
    draw: draw,
    onEvents: onEvents,
    clearEffects: clearEffects,
  };
})();
