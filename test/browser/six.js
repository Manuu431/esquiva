// Prueba de carga en navegador real: una sala llena, 1 anfitrión + 5 invitados en 6 pestañas.
// Comprueba que todos entran, que el séptimo es rechazado y que el anfitrión mantiene los 60 Hz.
//   node test/browser/six.js
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, serve, sleep, waitFor } = require('../../tools/cdp.js');

const SHOTS = path.resolve(__dirname, '..', '..', '.tools', 'shots');
const NAMES = ['Ana', 'Bea', 'Col', 'Dani', 'Eva', 'Fer'];

(async function () {
  const server = await serve(8133);
  const browser = await launch({ port: 9333 });
  let failed = false;
  try {
    const host = await browser.newPage(server.url);
    await host.eval('document.getElementById("name").value = "Ana"');
    await host.click('#btn-host');
    await waitFor(() => host.eval('Esquiva.mode() === "host"'), 25000, 'creación de la sala');
    const code = await host.eval('Esquiva.code()');

    const guests = [];
    for (let i = 1; i < 6; i++) {
      const g = await browser.newPage(server.url + '#' + code);
      await g.eval('document.getElementById("name").value = "' + NAMES[i] + '"');
      await g.click('#btn-join');
      guests.push(g);
    }
    await waitFor(() => host.eval('Esquiva.host().members.length === 6'), 45000, 'que entren los 5 invitados');

    // La sala está llena: un séptimo es rechazado con un aviso claro.
    const extra = await browser.newPage(server.url + '#' + code);
    await extra.eval('document.getElementById("name").value = "Sobra"');
    await extra.click('#btn-join');
    await waitFor(() => extra.eval('document.getElementById("toast").textContent.includes("llena")'), 30000, 'rechazo del séptimo');
    assert.equal(await extra.eval('Esquiva.mode()'), null);
    assert.equal(await host.eval('Esquiva.host().members.length'), 6);

    // Aunque se pidan bots, con 6 humanos no cabe ninguno.
    await host.eval('Esquiva.host().setBots(3, 0)');
    await host.click('#btn-start');
    for (const g of guests) await waitFor(() => g.eval('Esquiva.screen() === "playing"'), 12000, 'ronda en juego');
    await host.eval('Esquiva.host().state.players.forEach(p => p.lives = 99)');
    assert.equal(await host.eval('Esquiva.host().state.players.length'), 6);

    // Cada invitado mueve a su jugador en una dirección distinta.
    const keys = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyA'];
    for (let i = 0; i < guests.length; i++) await guests[i].key('down', keys[i]);
    const t0 = await host.eval('Esquiva.host().state.tick');
    const start = await host.eval('Esquiva.host().state.players.map(p => [p.x, p.y])');
    await sleep(1000);
    for (let i = 0; i < guests.length; i++) await guests[i].key('up', keys[i]);
    await sleep(4000);
    const t1 = await host.eval('Esquiva.host().state.tick');
    const end = await host.eval('Esquiva.host().state.players.map(p => [p.x, p.y])');
    const hz = (t1 - t0) / 5;
    assert.ok(hz > 55 && hz < 65, 'el anfitrión mantiene ~60 Hz con la sala llena: ' + hz.toFixed(1));
    for (let i = 1; i < 6; i++) {
      const d = Math.hypot(end[i][0] - start[i][0], end[i][1] - start[i][1]);
      assert.ok(d > 100, NAMES[i] + ' se movió en el anfitrión: ' + d.toFixed(0) + ' px');
    }

    // Todos ven a los 6 y coinciden con el anfitrión sobre su propia posición.
    const stats = [];
    for (let i = 0; i < guests.length; i++) {
      const r = await guests[i].eval('(() => { const c = Esquiva.client(); const v = c.view(performance.now()); return { n: v.state.players.length, me: v.localIdx, x: v.state.players[v.localIdx].x, y: v.state.players[v.localIdx].y, rtt: c.rtt }; })()');
      assert.equal(r.n, 6);
      assert.equal(r.me, i + 1);
      const h = await host.eval('(() => { const p = Esquiva.host().state.players[' + (i + 1) + ']; return [p.x, p.y]; })()');
      assert.ok(Math.hypot(r.x - h[0], r.y - h[1]) < 2, NAMES[i + 1] + ' coincide con el anfitrión');
      stats.push(r.rtt.toFixed(0));
    }
    await guests[4].bringToFront();
    await guests[4].screenshot(path.join(SHOTS, 'six-invitado-5.png'));

    const errores = [host].concat(guests).reduce((a, p) => a.concat(p.errors), []);
    assert.deepEqual(errores, [], 'sin errores en ninguna consola');
    console.log('OK six.js — sala llena a ' + hz.toFixed(1) + ' Hz; ida y vuelta de los invitados (ms): ' + stats.join(', '));
  } catch (e) {
    failed = true;
    console.error('FALLO six.js:', e.message);
  } finally {
    await browser.close();
    server.stop();
  }
  process.exit(failed ? 1 : 0);
})();
