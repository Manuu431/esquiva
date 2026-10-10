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
    await page.click('#btn-play');
    assert.equal(await page.eval('Esquiva.screen()'), 'countdown');
    await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'fin de la cuenta atrás');

    // Mantener pulsada la flecha derecha debe mover al jugador a la derecha.
    const x0 = await page.eval('Esquiva.game().state.players[0].x');
    await page.key('down', 'ArrowRight');
    await sleep(500);
    await page.key('up', 'ArrowRight');
    const x1 = await page.eval('Esquiva.game().state.players[0].x');
    assert.ok(x1 > x0 + 60, 'el jugador se movió a la derecha: ' + x0 + ' -> ' + x1);

    // La simulación corre a ~60 ticks por segundo de reloj.
    const t0 = await page.eval('Esquiva.game().state.tick');
    await sleep(2000);
    const t1 = await page.eval('Esquiva.game().state.tick');
    const hz = (t1 - t0) / 2;
    assert.ok(hz > 50 && hz < 70, 'ritmo de simulación ~60 Hz: ' + hz.toFixed(1));
    await page.screenshot(path.join(SHOTS, 'solo-2-jugando.png'));

    // Sin tocar nada el juego acaba matando; para no esperar, se dejan las vidas en 1.
    await page.eval('Esquiva.game().state.players[0].lives = 1');
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
