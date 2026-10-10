// Prueba en navegador real (headless) con DOS pestañas: una crea la sala y la otra entra.
// Usa el servidor público de PeerJS y WebRTC de verdad, así que necesita Internet.
//   node test/browser/online.js                  (sirve la carpeta local)
//   node test/browser/online.js https://...      (prueba el juego ya publicado)
//   node test/browser/online.js --lag 75         (la invitada con 75 ms de retraso por trayecto)
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, serve, sleep, waitFor } = require('../../tools/cdp.js');

const SHOTS = path.resolve(__dirname, '..', '..', '.tools', 'shots');

(async function () {
  const lagAt = process.argv.indexOf('--lag');
  const LAG = lagAt > 0 ? parseFloat(process.argv[lagAt + 1]) || 0 : 0; // ms por trayecto, con ±25 % de variación
  const publicUrl = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const server = publicUrl ? { url: publicUrl.replace(/\/?$/, '/'), stop: function () {} } : await serve(8132);
  const browser = await launch({ port: 9332 });
  let failed = false;
  const pages = {};
  try {
    // --- Pestaña 1: Ana crea la sala ---
    const ana = (pages.anfitrion = await browser.newPage(server.url));
    await ana.eval('document.getElementById("name").value = "Ana"');
    await ana.click('#btn-host');
    await waitFor(() => ana.eval('Esquiva.mode() === "host"'), 25000, 'creación de la sala');
    const code = await ana.eval('Esquiva.code()');
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.equal(await ana.eval('location.hash'), '#' + code);

    // --- Pestaña 2: Bea entra con el enlace ---
    const bea = (pages.invitada = await browser.newPage(server.url + (LAG ? '?lag=' + LAG + '&jitter=' + LAG / 4 : '') + '#' + code));
    assert.equal(await bea.eval('document.getElementById("code").value'), code, 'el enlace rellena el código');
    await bea.eval('document.getElementById("name").value = "Bea"');
    await bea.click('#btn-join');
    await waitFor(() => bea.eval('Esquiva.mode() === "client" && Esquiva.screen() === "lobby"'), 30000, 'entrada en la sala');
    await waitFor(() => ana.eval('Esquiva.host().members.length === 2'), 45000, 'que el anfitrión vea a la invitada');
    const names = await bea.eval('Array.from(document.querySelectorAll("#lobby-players .who")).map(e => e.textContent)');
    assert.deepEqual(names, ['Ana', 'Bea']);
    assert.equal(await bea.eval('document.getElementById("lobby-host-controls").classList.contains("hidden")'), true);
    await bea.screenshot(path.join(SHOTS, 'online-1-sala-invitada.png'));

    // --- Empieza la ronda ---
    await ana.click('#btn-start');
    // (Con el ordenador cargado la cuenta atrás puede haber pasado ya cuando se mira.)
    await waitFor(() => bea.eval('Esquiva.screen() === "countdown" || Esquiva.screen() === "playing"'), 45000, 'que la ronda arranque en la invitada');
    await waitFor(() => bea.eval('Esquiva.screen() === "playing"'), 45000, 'ronda en juego en la invitada');
    await ana.eval('Esquiva.host().state.players.forEach(p => p.lives = 99)');

    // La invitada pulsa izquierda: se mueve en su pantalla (predicción) y en la del anfitrión (autoridad).
    const before = await ana.eval('Esquiva.host().state.players[1].x');
    await bea.key('down', 'KeyA');
    await sleep(700);
    const predicted = await bea.eval('Esquiva.state().players[1].x');
    await bea.key('up', 'KeyA');
    await sleep(400);
    const onHost = await ana.eval('Esquiva.host().state.players[1].x');
    const onGuest = await bea.eval('Esquiva.state().players[1].x');
    assert.ok(before - onHost > 100, 'el anfitrión movió a la invitada: ' + before.toFixed(0) + ' -> ' + onHost.toFixed(0));
    assert.ok(before - predicted > 100, 'la invitada se vio moverse mientras pulsaba');
    assert.ok(Math.abs(onHost - onGuest) < 1.5, 'en reposo coinciden: ' + onHost.toFixed(1) + ' / ' + onGuest.toFixed(1));
    if (LAG) {
      // Con retraso, la invitada se vio moverse ANTES de que el anfitrión la moviera: mientras
      // pulsaba iba por delante de lo que el anfitrión tenía en ese momento.
      assert.ok(before - predicted > 120, 'con retraso la invitada también se mueve al instante: ' + (before - predicted).toFixed(0) + ' px en 0,7 s');
    }

    // El anfitrión pulsa abajo: la invitada lo ve moverse.
    const y0 = await bea.eval('Esquiva.state().players[0].y');
    await ana.key('down', 'ArrowDown');
    await sleep(600);
    await ana.key('up', 'ArrowDown');
    await sleep(400);
    const y1 = await bea.eval('Esquiva.state().players[0].y');
    assert.ok(y1 - y0 > 100, 'la invitada ve moverse al anfitrión: ' + y0.toFixed(0) + ' -> ' + y1.toFixed(0));

    // La invitada ve los mismos proyectiles, adelantados menos de 3 ticks en local.
    await sleep(2500);
    const sync = await bea.eval('(() => { const c = Esquiva.client(); const v = c.view(performance.now()); return { rtt: c.rtt, haz: v.state.hazards.length, ahead: v.hazExt * 60 }; })()');
    const hostHaz = await ana.eval('Esquiva.host().state.hazards.length');
    assert.ok(sync.haz > 0 && Math.abs(sync.haz - hostHaz) <= 2, 'proyectiles: invitada ' + sync.haz + ', anfitrión ' + hostHaz);
    // El retraso simulado solo afecta a lo que ENVÍA la invitada, así que su ida y vuelta medida sube en LAG.
    assert.ok(sync.rtt >= LAG * 0.6 && sync.rtt < 80 + LAG * 1.5, 'ida y vuelta medida por la invitada: ' + sync.rtt.toFixed(1) + ' ms');
    assert.ok(sync.ahead >= LAG / 16.7 * 0.5 && sync.ahead < 8 + LAG / 16.7 * 1.5, 'adelanto de proyectiles: ' + sync.ahead.toFixed(2) + ' ticks');
    await ana.bringToFront();
    await ana.screenshot(path.join(SHOTS, 'online-2-anfitrion.png'));
    await bea.bringToFront();
    await bea.screenshot(path.join(SHOTS, 'online-2-invitada.png'));

    // --- Fin de ronda: cae el anfitrión y la invitada va por delante en puntos ---
    await ana.eval('(() => { const s = Esquiva.host().state; const p = s.players[0]; s.players[1].score += 1000; p.lives = 1; p.inv = 0; s.hazards.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: 12 }); })()');
    await waitFor(() => bea.eval('Esquiva.screen() === "over"'), 45000, 'fin de ronda en la invitada');
    await sleep(300);
    assert.equal(await bea.eval('document.getElementById("over-title").textContent'), '¡Has ganado!');
    assert.equal(await ana.eval('document.getElementById("over-title").textContent'), 'Gana Bea');
    assert.equal(await bea.eval('document.getElementById("btn-again").classList.contains("hidden")'), true, 'solo el anfitrión relanza');
    await bea.screenshot(path.join(SHOTS, 'online-3-fin-invitada.png'));

    // --- Otra ronda, y el anfitrión cierra la pestaña a mitad ---
    await ana.click('#btn-again');
    await waitFor(() => bea.eval('Esquiva.screen() === "playing"'), 45000, 'segunda ronda');
    assert.equal(await bea.eval('Esquiva.client().room.roster[1].wins'), 1);
    await ana.send('Page.close');
    // La invitada era la primera de la lista: toma el relevo y la sala sigue con ella de anfitriona.
    await waitFor(() => bea.eval('Esquiva.mode() === "host"'), 25000, 'que la invitada tome el relevo de la sala');
    const toast = await bea.eval('document.getElementById("toast").textContent');
    assert.match(toast, /ahora la sala la llevas tú/);
    assert.equal(await bea.eval('Esquiva.code()'), code, 'misma sala');
    assert.equal(await bea.eval('Esquiva.gen()'), 2, 'segunda generación');
    assert.equal(await bea.eval('document.getElementById("lobby").classList.contains("hidden")'), false, 'queda en la sala, lista para seguir');

    const ignorar = (e) => /favicon/.test(e);
    assert.deepEqual(ana.errors.filter((e) => !ignorar(e)), [], 'sin errores en la consola del anfitrión');
    assert.deepEqual(bea.errors.filter((e) => !ignorar(e)), [], 'sin errores en la consola de la invitada');
    console.log('OK online.js (' + server.url + (LAG ? ', invitada con ' + LAG + ' ms de retraso' : '') + ') — sala ' + code + ', ida y vuelta ' + sync.rtt.toFixed(1) + ' ms, adelanto ' + sync.ahead.toFixed(2) + ' ticks, aviso: "' + toast + '"');
  } catch (e) {
    failed = true;
    console.error('FALLO online.js:', e.message);
    for (const who of Object.keys(pages)) {
      try {
        const dump = await pages[who].eval('JSON.stringify({ mode: Esquiva.mode(), screen: Esquiva.screen(), gen: Esquiva.gen(), hostPhase: Esquiva.host() && Esquiva.host().phase, hostRound: Esquiva.host() && Esquiva.host().round, members: Esquiva.host() && Esquiva.host().members.length, room: Esquiva.client() && Esquiva.client().room && { phase: Esquiva.client().room.phase, round: Esquiva.client().room.round, q: Esquiva.client().room.q }, lost: Esquiva.client() && Esquiva.client().lost, toast: document.getElementById("toast").textContent })');
        console.error('  ' + who + ': ' + dump + ' errores: ' + JSON.stringify(pages[who].errors));
      } catch (e2) {
        console.error('  ' + who + ': sin respuesta (' + e2.message + ')');
      }
    }
  } finally {
    await browser.close();
    server.stop();
  }
  process.exit(failed ? 1 : 0);
})();
