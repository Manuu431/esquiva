// net.js — transporte WebRTC con PeerJS. Solo mueve mensajes; las reglas están en netcode.js.
// La señalización usa el servidor público gratuito de PeerJS (0.peerjs.com): hace falta para
// encontrarse, pero una vez conectados los datos van directos de navegador a navegador.
(function () {
  'use strict';

  const PREFIX = 'esquiva-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para dictarlo sin líos
  const CODE_LEN = 5;
  const CONNECT_TIMEOUT_MS = 20000;

  function randomCode() {
    const buf = new Uint32Array(CODE_LEN);
    crypto.getRandomValues(buf);
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[buf[i] % ALPHABET.length];
    return code;
  }

  function normalizeCode(text) {
    let code = '';
    const up = String(text || '').toUpperCase();
    for (let i = 0; i < up.length && code.length < CODE_LEN; i++) {
      if (ALPHABET.indexOf(up[i]) >= 0) code += up[i];
    }
    return code;
  }

  function explain(err) {
    const type = err && err.type;
    if (type === 'peer-unavailable') return 'No hay ninguna sala con ese código.';
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      return 'No se puede contactar con el servidor de salas. Revisa tu conexión.';
    }
    if (type === 'browser-incompatible') return 'Este navegador no admite WebRTC.';
    if (type === 'webrtc') return 'No se pudo establecer la conexión directa (¿red muy restrictiva?).';
    return 'Error de conexión' + (type ? ' (' + type + ')' : '') + '.';
  }

  // Abre una sala. handlers: onJoin(id), onMessage(id, msg), onLeave(id), onError(texto).
  // Devuelve una promesa con { code, send(id, msg), kick(id), close() }.
  function host(handlers) {
    return new Promise(function (resolve, reject) {
      let attempts = 0;
      (function tryOpen() {
        attempts++;
        const code = randomCode();
        const peer = new Peer(PREFIX + code, { debug: 1 });
        const conns = new Map();
        let opened = false;

        const timer = setTimeout(function () {
          if (opened) return;
          peer.destroy();
          reject(new Error('El servidor de salas no responde. Inténtalo de nuevo en un momento.'));
        }, CONNECT_TIMEOUT_MS);

        peer.on('open', function () {
          opened = true;
          clearTimeout(timer);
          resolve({
            code: code,
            send: function (id, msg) {
              const c = conns.get(id);
              if (c && c.open) c.send(msg);
            },
            kick: function (id) {
              const c = conns.get(id);
              conns.delete(id);
              // Se cierra con un poco de margen para que salga antes el mensaje de despedida.
              if (c) setTimeout(function () { c.close(); }, 300);
            },
            close: function () {
              peer.destroy();
            },
          });
        });

        peer.on('connection', function (conn) {
          const id = conn.connectionId;
          conn.on('open', function () {
            conns.set(id, conn);
            handlers.onJoin(id);
          });
          conn.on('data', function (msg) {
            if (conns.has(id)) handlers.onMessage(id, msg);
          });
          const gone = function () {
            if (!conns.delete(id)) return;
            handlers.onLeave(id);
          };
          conn.on('close', gone);
          conn.on('error', gone);
        });

        // Si se cae la señalización, la partida en curso sigue (va por WebRTC), pero nadie
        // nuevo podría entrar: se intenta recuperar.
        peer.on('disconnected', function () {
          if (opened && !peer.destroyed) setTimeout(function () { if (!peer.destroyed) peer.reconnect(); }, 1500);
        });

        peer.on('error', function (err) {
          if (!opened) {
            clearTimeout(timer);
            peer.destroy();
            if (err.type === 'unavailable-id' && attempts < 4) return tryOpen(); // código ya en uso
            return reject(new Error(explain(err)));
          }
          if (err.type !== 'peer-unavailable') handlers.onError(explain(err));
        });
      })();
    });
  }

  // Entra en una sala. handlers: onMessage(msg), onClose().
  // Devuelve una promesa con { send(msg), close() }.
  function join(code, handlers) {
    return new Promise(function (resolve, reject) {
      const peer = new Peer({ debug: 1 });
      let conn = null;
      let settled = false;
      let closed = false;

      const fail = function (text) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(text));
      };
      const timer = setTimeout(function () {
        fail('No se pudo conectar con la sala. Puede que la red de alguno de los dos lo impida.');
      }, CONNECT_TIMEOUT_MS);

      const lost = function () {
        if (!settled) return fail('No se pudo conectar con la sala.');
        if (closed) return;
        closed = true;
        handlers.onClose();
      };

      peer.on('open', function () {
        // reliable:false = canal sin orden garantizado: un paquete lento no frena a los que
        // vienen detrás. netcode.js ya numera lo que necesita orden.
        conn = peer.connect(PREFIX + code, { reliable: false, serialization: 'json' });
        conn.on('open', function () {
          settled = true;
          clearTimeout(timer);
          resolve({
            send: function (msg) {
              if (conn.open) conn.send(msg);
            },
            close: function () {
              closed = true;
              peer.destroy();
            },
          });
        });
        conn.on('data', function (msg) {
          handlers.onMessage(msg);
        });
        conn.on('close', lost);
        conn.on('error', lost);
      });

      peer.on('error', function (err) {
        if (!settled) return fail(explain(err));
        // Con la partida en marcha, perder la señalización no importa; perder al otro, sí.
        if (err.type === 'peer-unavailable') lost();
      });
    });
  }

  window.Net = {
    available: function () {
      return typeof Peer !== 'undefined' && typeof RTCPeerConnection !== 'undefined';
    },
    host: host,
    join: join,
    normalizeCode: normalizeCode,
    ALPHABET: ALPHABET,
    CODE_LEN: CODE_LEN,
  };
})();
