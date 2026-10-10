// Prueba en navegador real con TRES pestañas: el anfitrión se va a media ronda, el primer invitado
// toma el relevo de la sala y el segundo le sigue solo. Después juegan otra ronda, y alguien
// nuevo puede entrar con el código de siempre.
//   node test/browser/relevo.js
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, serve, sleep, waitFor } = require('../../tools/cdp.js');

const SHOTS = path.resolve(__dirname, '..', '..', '.tools', 'shots');

(async function () {
  const server = await serve(8134);
  const browser = await launch({ port: 9334 });
  let failed = false;
  try {
    const entrar = async (name, code) => {
      const page = await browser.newPage(server.url + '#' + code);
      await page.eval('document.getElementById("name").value = "' + name + '"');
      await page.click('#btn-join');
      await waitFor(() => page.eval('Esquiva.mode() === "client" && Esquiva.screen() !== "connecting"'), 40000, 'entrada de ' + name);
      return page;
    };

    const ana = await browser.newPage(server.url);
    await ana.eval('document.getElementById("name").value = "Ana"');
    await ana.click('#btn-host');
    await waitFor(() => ana.eval('Esquiva.mode() === "host"'), 25000, 'creación de la sala');
    const code = await ana.eval('Esquiva.code()');
    const bea = await entrar('Bea', code);
    const col = await entrar('Col', code);
    await waitFor(() => ana.eval('Esquiva.host().members.length === 3'), 45000, 'tres en la sala');

    await ana.click('#btn-start');
    await waitFor(() => col.eval('Esquiva.screen() === "playing"'), 45000, 'ronda en juego');

    // El anfitrión cierra la pestaña a media ronda.
    await ana.send('Page.close');
    await waitFor(() => bea.eval('Esquiva.mode() === "host"'), 25000, 'que Bea tome el relevo');
    assert.equal(await bea.eval('Esquiva.code()'), code);
    assert.equal(await bea.eval('Esquiva.gen()'), 2);
    // Col no hace nada: se reconecta solo con la nueva anfitriona.
    await waitFor(() => col.eval('Esquiva.mode() === "client" && Esquiva.screen() === "lobby"'), 40000, 'que Col siga a la nueva anfitriona');
    await waitFor(() => bea.eval('Esquiva.host().members.length === 2'), 45000, 'que Bea vea a Col');
    assert.deepEqual(await bea.eval('Esquiva.host().members.map(m => m.name)'), ['Bea', 'Col']);
    assert.match(await col.eval('document.getElementById("toast").textContent'), /otro anfitrión/);
    await col.screenshot(path.join(SHOTS, 'relevo-1-col-reconectado.png'));

    // La sala funciona: juegan otra ronda y Col mueve a su jugador.
    await bea.click('#btn-start');
    await waitFor(() => col.eval('Esquiva.screen() === "playing"'), 45000, 'ronda con la nueva anfitriona');
    await bea.eval('Esquiva.host().state.players.forEach(p => p.lives = 99)');
    const x0 = await bea.eval('Esquiva.host().state.players[1].x');
    await col.key('down', 'KeyD');
    await sleep(600);
    await col.key('up', 'KeyD');
    await sleep(300);
    const x1 = await bea.eval('Esquiva.host().state.players[1].x');
    assert.ok(x1 - x0 > 80, 'Col se mueve en la partida de la nueva anfitriona: ' + x0.toFixed(0) + ' -> ' + x1.toFixed(0));

    // Alguien nuevo entra con el código de siempre, aunque la sala ya va por su segunda anfitriona.
    const dani = await entrar('Dani', code);
    await waitFor(() => bea.eval('Esquiva.host().members.length === 3'), 45000, 'que entre alguien nuevo tras el relevo');
    assert.equal(await dani.eval('Esquiva.gen()'), 2);

    const errores = [bea, col, dani].reduce((a, p) => a.concat(p.errors.filter((e) => !/favicon|Could not connect to peer|PeerJS/.test(e))), []);
    assert.deepEqual(errores, [], 'sin errores en las consolas');
    console.log('OK relevo.js — sala ' + code + ': Bea toma el relevo, Col la sigue solo y Dani entra después con el mismo código');
  } catch (e) {
    failed = true;
    console.error('FALLO relevo.js:', e.message);
  } finally {
    await browser.close();
    server.stop();
  }
  process.exit(failed ? 1 : 0);
})();
