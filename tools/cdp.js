// Cliente mínimo del protocolo de depuración de Chrome (CDP) para las pruebas en navegador.
// Sin dependencias: usa el Chrome/Edge ya instalado, en headless y con un perfil temporal propio.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Dónde buscar el navegador. Se puede forzar uno con la variable de entorno CHROME.
const CANDIDATES = [
  process.env.CHROME,
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('Tiempo agotado esperando: ' + what);
    await sleep(100);
  }
}

async function launch(opts) {
  const o = opts || {};
  const port = o.port || 9333;
  const exe = CANDIDATES.find(function (p) {
    return fs.existsSync(p);
  });
  if (!exe) throw new Error('No se encuentra Chrome ni Edge');
  const profile = path.join(ROOT, '.tools', 'chrome-profile-' + port);
  fs.rmSync(profile, { recursive: true, force: true });
  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1000,760',
    'about:blank',
  ];
  if (!o.headful) args.unshift('--headless=new');
  const proc = spawn(exe, args, { stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  await waitFor(
    function () {
      return fetch(base + '/json/version').then(
        function (r) {
          return r.ok;
        },
        function () {
          return false;
        }
      );
    },
    15000,
    'arranque del navegador'
  );

  async function newPage(url) {
    const r = await fetch(base + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
    const info = await r.json();
    const page = await connect(info.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    // Cada pestaña se comporta como si tuviera el foco (si no, las teclas no llegarían a la de atrás).
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (url) await page.goto(url);
    return page;
  }

  async function close() {
    try {
      proc.kill();
    } catch (e) {
      /* ya estaba cerrado */
    }
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }

  return { newPage: newPage, close: close };
}

function connect(wsUrl) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const page = {
      errors: [], // excepciones y console.error de la página
      logs: [],
      send: function (method, params) {
        return new Promise(function (res, rej) {
          const id = nextId++;
          pending.set(id, { res: res, rej: rej, method: method });
          ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        });
      },
      goto: async function (url) {
        await page.send('Page.navigate', { url: url });
        await waitFor(
          function () {
            return page.eval('document.readyState === "complete"');
          },
          15000,
          'carga de ' + url
        );
      },
      // Evalúa una expresión en la página y devuelve su valor (espera promesas).
      eval: async function (expr) {
        const r = await page.send('Runtime.evaluate', {
          expression: expr,
          returnByValue: true,
          awaitPromise: true,
        });
        if (r.exceptionDetails) {
          throw new Error('Error en la página: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
        }
        return r.result.value;
      },
      key: function (type, code, key) {
        return page.send('Input.dispatchKeyEvent', {
          type: type === 'down' ? 'rawKeyDown' : 'keyUp',
          code: code,
          key: key || code,
        });
      },
      click: function (selector) {
        return page.eval('document.querySelector(' + JSON.stringify(selector) + ').click()');
      },
      screenshot: async function (file) {
        const r = await page.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      bringToFront: function () {
        return page.send('Page.bringToFront');
      },
      close: function () {
        ws.close();
      },
    };
    ws.addEventListener('open', function () {
      resolve(page);
    });
    ws.addEventListener('error', function () {
      reject(new Error('No se pudo conectar a ' + wsUrl));
    });
    ws.addEventListener('message', function (ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.rej(new Error(p.method + ': ' + msg.error.message));
        else p.res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        page.errors.push((d.exception && d.exception.description) || d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args
          .map(function (a) {
            return a.value !== undefined ? String(a.value) : a.description || a.type;
          })
          .join(' ');
        (msg.params.type === 'error' ? page.errors : page.logs).push(text);
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        page.errors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
      }
    });
  });
}

// Arranca tools/serve.js en un puerto y devuelve { url, stop }.
async function serve(port) {
  const proc = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(port)], { stdio: 'ignore' });
  const url = 'http://127.0.0.1:' + port + '/';
  await waitFor(
    function () {
      return fetch(url).then(
        function (r) {
          return r.ok;
        },
        function () {
          return false;
        }
      );
    },
    8000,
    'servidor local'
  );
  return {
    url: url,
    stop: function () {
      proc.kill();
    },
  };
}

module.exports = { launch: launch, serve: serve, sleep: sleep, waitFor: waitFor };
