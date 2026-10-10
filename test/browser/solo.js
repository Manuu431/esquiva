// Prueba en navegador real (headless): partida en solitario de principio a fin.
//   node test/browser/solo.js
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, serve, sleep, waitFor } = require('../../tools/cdp.js');

const SHOTS = path.resolve(__dirname, '..', '..', '.tools', 'shots');

(async function () {
  const server = await serve(8131);
  const browser = await launch({ port: 9331 });
  let failed = false;
  try {
    const page = await browser.newPage(server.url);
    await sleep(500);
    assert.equal(await page.eval('Esquiva.screen()'), 'menu');
    await page.screenshot(path.join(SHOTS, 'solo-1-menu.png'));

    // Partida sin bots.
    await page.eval('document.getElementById("bots").value = "0"; document.getElementById("name").value = "Prueba"');
    // Reglas elegidas en el menú: 5 vidas y proyectiles suaves.
    await page.eval('document.getElementById("lives").value = "5"; document.getElementById("hazard").value = "0"');
    await page.click('#btn-play');
    assert.equal(await page.eval('Esquiva.screen()'), 'countdown');
    const reglas = await page.eval('(() => { const s = Esquiva.state(); return { vidas: s.maxLives, tiene: s.players[0].lives, proyectiles: s.hazard, estrellas: s.stars.length }; })()');
    assert.deepEqual(reglas, { vidas: 5, tiene: 5, proyectiles: 0, estrellas: 3 });
    await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'fin de la cuenta atrás');

    // Mantener pulsada la flecha derecha debe mover al jugador a la derecha.
    const x0 = await page.eval('Esquiva.state().players[0].x');
    await page.key('down', 'ArrowRight');
    await sleep(500);
    await page.key('up', 'ArrowRight');
    const x1 = await page.eval('Esquiva.state().players[0].x');
    assert.ok(x1 > x0 + 60, 'el jugador se movió a la derecha: ' + x0 + ' -> ' + x1);

    // Táctil: arrastrar el dedo hacia abajo mueve al jugador hacia abajo; al soltar, se para.
    const y0 = await page.eval('Esquiva.state().players[0].y');
    const touch = (type, x, y) =>
      page.send('Input.dispatchTouchEvent', { type: type, touchPoints: type === 'touchEnd' ? [] : [{ x: x, y: y, id: 1 }] });
    await touch('touchStart', 300, 300);
    await touch('touchMove', 300, 330);
    await touch('touchMove', 300, 360);
    await sleep(400);
    await touch('touchEnd');
    const y1 = await page.eval('Esquiva.state().players[0].y');
    await sleep(200);
    const y2 = await page.eval('Esquiva.state().players[0].y');
    assert.ok(y1 > y0 + 50, 'el dedo movió al jugador hacia abajo: ' + y0.toFixed(0) + ' -> ' + y1.toFixed(0));
    assert.ok(Math.abs(y2 - y1) < 6, 'al levantar el dedo se detiene');

    // La simulación corre a ~60 ticks por segundo de reloj.
    const t0 = await page.eval('Esquiva.state().tick');
    await sleep(2000);
    const t1 = await page.eval('Esquiva.state().tick');
    const hz = (t1 - t0) / 2;
    assert.ok(hz > 50 && hz < 70, 'ritmo de simulación ~60 Hz: ' + hz.toFixed(1));
    await page.screenshot(path.join(SHOTS, 'solo-2-jugando.png'));

    // Sin tocar nada el juego acaba matando; para no esperar, se dejan las vidas en 1.
    await page.eval('Esquiva.state().players[0].lives = 1');
    await waitFor(() => page.eval('Esquiva.screen() === "over"'), 90000, 'fin de la partida');
    assert.equal(await page.eval('document.getElementById("gameover").classList.contains("hidden")'), false);
    const title = await page.eval('document.getElementById("over-title").textContent');
    assert.match(title, /Aguantaste/);
    await page.screenshot(path.join(SHOTS, 'solo-3-fin.png'));

    // Enter = otra ronda; Escape = menú.
    await page.key('down', 'Enter');
    await page.key('up', 'Enter');
    assert.equal(await page.eval('Esquiva.screen()'), 'countdown');
    await page.key('down', 'Escape');
    await page.key('up', 'Escape');
    assert.equal(await page.eval('Esquiva.screen()'), 'menu');

    // Partida contra 3 bots (si hay pesos entrenados): las redes juegan en el navegador.
    const niveles = await page.eval('Esquiva.levels().map(l => l.name)');
    if (niveles.length) {
      await page.eval('document.getElementById("bots").value = "3"; document.getElementById("level").value = "' + (niveles.length - 1) + '"');
      await page.eval('document.getElementById("lives").value = "3"; document.getElementById("hazard").value = "1"');
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'partida contra bots');
      const antes = await page.eval('Esquiva.state().players.map(p => [p.x, p.y])');
      assert.equal(antes.length, 4);
      await sleep(6000);
      const bots = await page.eval('Esquiva.state().players.map((p, i) => ({ x: p.x, y: p.y, stars: p.stars, alive: p.alive }))');
      const movidos = bots.filter((p, i) => i > 0 && Math.hypot(p.x - antes[i][0], p.y - antes[i][1]) > 30).length;
      assert.equal(movidos, 3, 'los tres bots se mueven por su cuenta');
      assert.ok(bots.slice(1).reduce((a, p) => a + p.stars, 0) >= 1, 'en 6 s algún bot ya ha cogido una estrella');
      await page.screenshot(path.join(SHOTS, 'solo-4-bots.png'));
      // El humano no se mueve: cae pronto. La ronda sigue hasta que quede un bot.
      await page.eval('Esquiva.state().players[0].lives = 1');
      await waitFor(() => page.eval('Esquiva.screen() === "over"'), 240000, 'fin de la ronda contra bots');
      const filas = await page.eval('Array.from(document.querySelectorAll("#over-list li")).map(li => li.textContent)');
      assert.equal(filas.length, 4);
      assert.ok(filas.filter((f) => f.includes('bot · ' + niveles[niveles.length - 1])).length === 3, 'la tabla marca a los bots y su nivel');
      await page.screenshot(path.join(SHOTS, 'solo-5-fin-bots.png'));
      console.log('   contra bots (' + niveles.join(', ') + '): ' + filas.join(' | '));
      await page.key('down', 'Escape');
      await page.key('up', 'Escape');
    }

    // Mientras no haya bots entrenados, el 404 de weights.json es esperado.
    const hayPesos = require('node:fs').existsSync(path.resolve(__dirname, '..', '..', 'weights.json'));
    const errores = page.errors.filter((e) => hayPesos || !e.includes('weights.json'));
    assert.deepEqual(errores, [], 'sin errores en la consola');
    console.log('OK solo.js — ritmo ' + hz.toFixed(1) + ' Hz, título "' + title + '"');
  } catch (e) {
    failed = true;
    console.error('FALLO solo.js:', e.message);
  } finally {
    await browser.close();
    server.stop();
  }
  process.exit(failed ? 1 : 0);
})();
