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
    const hayPesosEntrenados = require('node:fs').existsSync(path.resolve(__dirname, '..', '..', 'weights.json'));
    assert.ok(!hayPesosEntrenados || niveles.length > 0, 'hay weights.json pero el juego no ha cargado ningún nivel de bot');
    if (niveles.length) {
      await page.eval('document.getElementById("bots").value = "3"; document.getElementById("level").value = "' + niveles.indexOf('Experto') + '"');
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
      assert.ok(filas.filter((f) => f.includes('bot · Experto')).length === 3, 'la tabla marca a los bots y su nivel');
      await page.screenshot(path.join(SHOTS, 'solo-5-fin-bots.png'));

      // Repetición de la ronda que acaba de terminar: se vuelve a ver desde el principio,
      // acelerada con V, y al acabar (o con Esc) se vuelve a los resultados.
      const final = await page.eval('JSON.stringify(Esquiva.host().state.players.map(p => [p.score, p.stars, p.deathTick]))');
      await page.click('#btn-replay');
      assert.equal(await page.eval('Esquiva.replay() !== null'), true);
      assert.equal(await page.eval('document.getElementById("gameover").classList.contains("hidden")'), true);
      for (let k = 0; k < 2; k++) {
        await page.key('down', 'KeyV');
        await page.key('up', 'KeyV');
      }
      assert.equal(await page.eval('Esquiva.replay().speed'), 4);
      await sleep(1500);
      const r1 = await page.eval('Esquiva.replay() ? Esquiva.replay().run.state.tick : -1');
      assert.ok(r1 > 200, 'la repetición avanza a x4: tick ' + r1);
      await page.screenshot(path.join(SHOTS, 'solo-5b-repeticion.png'));
      // Se deja correr hasta el final: debe acabar exactamente como acabó la ronda.
      await page.eval('Esquiva.replay().speed = 60');
      await waitFor(() => page.eval('Esquiva.replay() === null'), 60000, 'fin de la repetición');
      assert.equal(await page.eval('document.getElementById("gameover").classList.contains("hidden")'), false, 'vuelve a los resultados');
      assert.equal(await page.eval('JSON.stringify(Esquiva.host().state.players.map(p => [p.score, p.stars, p.deathTick]))'), final, 'la ronda real no se ha tocado');
      console.log('   contra bots (' + niveles.join(', ') + '): ' + filas.join(' | '));
      await page.key('down', 'Escape');
      await page.key('up', 'Escape');
    }

    if (niveles.length) {
      assert.deepEqual(niveles.slice(-3), ['Modo Dios', 'Mixto', 'Adaptativo'], 'niveles que no son redes');
      const elegir = (bots, nivel, hazard) =>
        page.eval('document.getElementById("bots").value = "' + bots + '"; document.getElementById("level").value = "' + niveles.indexOf(nivel) +
          '"; document.getElementById("hazard").value = "' + hazard + '"; document.getElementById("powerups").value = "1"');
      const salir = async () => {
        await page.key('down', 'Escape');
        await page.key('up', 'Escape');
      };

      // Contra el Modo Dios con proyectiles en Imposible: juega, coge estrellas y no pierde vidas.
      await elegir(1, 'Modo Dios', 3);
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'partida contra el Modo Dios');
      await page.eval('Esquiva.state().players[0].lives = 99');
      await sleep(7000);
      const dios = await page.eval('(() => { const s = Esquiva.state(); const b = s.players[1]; return { hazard: s.hazard, power: s.power, stars: b.stars, lives: b.lives, alive: b.alive }; })()');
      assert.equal(dios.hazard, 3, 'dificultad Imposible');
      assert.equal(dios.power, 1, 'con mejoras');
      assert.ok(dios.alive && dios.lives === 3, 'el Modo Dios no ha perdido vidas en 7 s: ' + JSON.stringify(dios));
      assert.ok(dios.stars >= 3, 'y ya lleva estrellas: ' + dios.stars);
      const hz = await page.eval('(t1 => new Promise(r => setTimeout(() => r((Esquiva.state().tick - t1) / 2), 2000)))(Esquiva.state().tick)');
      assert.ok(hz > 55 && hz < 65, 'con el Modo Dios jugando se mantienen ~60 Hz: ' + hz.toFixed(1));
      await page.screenshot(path.join(SHOTS, 'solo-7-modo-dios-imposible.png'));
      await salir();

      // Pausa: con P el tiempo se detiene y con P sigue.
      await elegir(2, 'Normal', 1);
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'partida para la pausa');
      await page.key('down', 'KeyP');
      await page.key('up', 'KeyP');
      const p0 = await page.eval('Esquiva.state().tick');
      await sleep(600);
      assert.equal(await page.eval('Esquiva.state().tick'), p0, 'en pausa no avanza');
      assert.equal(await page.eval('Esquiva.paused()'), true);
      await page.key('down', 'KeyP');
      await page.key('up', 'KeyP');
      await sleep(400);
      assert.ok((await page.eval('Esquiva.state().tick')) > p0 + 10, 'al quitar la pausa sigue');
      await salir();

      // Mixto: cada bot de un nivel distinto, del más difícil al más fácil.
      await elegir(4, 'Mixto', 1);
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() !== "menu"'), 6000, 'partida mixta');
      const mixto = await page.eval('Esquiva.host().roster.filter(r => r.kind === "bot").map(r => Esquiva.levels()[r.level].name)');
      assert.deepEqual(mixto, ['Experto', 'Difícil', 'Normal', 'Fácil']);
      await salir();

      // Adaptativo: se concreta en un nivel de red según el historial.
      await elegir(2, 'Adaptativo', 1);
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() !== "menu"'), 6000, 'partida adaptativa');
      const adapt = await page.eval('Esquiva.host().roster.filter(r => r.kind === "bot").map(r => Esquiva.levels()[r.level].name)');
      assert.equal(adapt.length, 2);
      assert.ok(adapt[0] === adapt[1] && ['Fácil', 'Normal', 'Difícil', 'Experto'].includes(adapt[0]), 'adaptativo: ' + adapt);
      await salir();

      // Las mejoras aparecen y los jugadores las cogen (se fuerza una para no esperar).
      await elegir(0, 'Normal', 0);
      await page.click('#btn-play');
      await waitFor(() => page.eval('Esquiva.screen() === "playing"'), 6000, 'partida para las mejoras');
      await page.eval('(() => { const s = Esquiva.state(); const p = s.players[0]; s.powerups.push({ x: p.x, y: p.y, type: 0, ttl: 300 }); })()');
      await sleep(300);
      assert.ok((await page.eval('Esquiva.state().players[0].turbo')) > 0, 'el jugador ha cogido el turbo');
      await salir();
      // Ayuda.
      await page.click('#btn-help');
      assert.equal(await page.eval('document.querySelectorAll("#help-powers li").length'), 7, 'la ayuda explica las 7 mejoras');
      await page.click('#btn-help-close');
    }

    // Registro de partidas: las dos jugadas están guardadas con sus ajustes.
    const games = await page.eval('Esquiva.games()');
    assert.ok(games.length >= 1, 'hay partidas en el registro');
    const sola = games[0];
    assert.deepEqual({ o: sola.o, n: sola.n, b: sola.b, l: sola.l, h: sola.h, p: sola.p }, { o: 0, n: 1, b: 0, l: 5, h: 0, p: 1 }, 'la partida en solitario con 5 vidas, proyectiles suaves y mejoras');
    assert.ok(sola.s > 0 && sola.t > 0 && sola.d > 0);
    await page.click('#btn-stats');
    assert.equal(await page.eval('document.getElementById("stats").classList.contains("hidden")'), false);
    const modos = await page.eval('Array.from(document.querySelectorAll("#stats-modes tbody tr")).map(tr => tr.cells[0].textContent)');
    assert.ok(modos.includes('En solitario · 5 vidas · Suave'), 'récords por modo: ' + modos.join(' | '));
    const todas = await page.eval('document.querySelectorAll("#stats-games tbody tr").length');
    assert.equal(todas, games.length);
    // Filtro: solo las partidas sin bots.
    await page.eval('(() => { const s = document.getElementById("f-bots"); s.value = "0"; s.dispatchEvent(new Event("change")); })()');
    const sinBots = await page.eval('document.querySelectorAll("#stats-games tbody tr").length');
    assert.equal(sinBots, games.filter((g) => g.b === 0).length);
    assert.match(await page.eval('document.getElementById("stats-summary").textContent'), /media \d+ puntos · récord \d+/);
    // Pulsar un modo de la tabla de récords pone los filtros en ese modo.
    await page.eval('document.querySelector("#stats-modes tbody tr").click()');
    const filtros = await page.eval('["f-where", "f-bots", "f-lives", "f-hazard"].map(id => document.getElementById(id).value).join(",")');
    assert.match(filtros, /^0,\d,\d,\d$/);
    await page.screenshot(path.join(SHOTS, 'solo-6-mis-partidas.png'));
    await page.key('down', 'Escape');
    await page.key('up', 'Escape');
    assert.equal(await page.eval('document.getElementById("menu").classList.contains("hidden")'), false, 'Esc vuelve al menú');
    assert.match(await page.eval('document.getElementById("record").textContent'), /Con estos ajustes|Aún no has jugado/);

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
