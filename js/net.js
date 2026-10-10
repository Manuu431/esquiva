// net.js — transporte WebRTC con PeerJS. Solo mueve mensajes; las reglas están en netcode.js.
// La señalización usa el servidor público gratuito de PeerJS (0.peerjs.com): hace falta para
// encontrarse, pero una vez conectados los datos van directos de navegador a navegador.
//
// Una sala tiene un código y una "generación": empieza en la 1 y sube cada vez que, al caerse el
// anfitrión, otro jugador toma el relevo. El identificador de PeerJS del anfitrión se deriva de
// ambos, así que los demás saben dónde buscar al nuevo sin que nadie se lo diga.
(function () {
  'use strict';

  const PREFIX = 'esquiva-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para dictarlo sin líos
  const CODE_LEN = 5;
  const CONNECT_TIMEOUT_MS = 20000;
  const MAX_GEN = 5; // relevos de anfitrión que se buscan al entrar con un código

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

  function peerId(code, gen) {
    return PREFIX + code + (gen > 1 ? '-' + gen : '');
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
  // opts: { code, gen } para tomar el relevo de una sala existente (por defecto, sala nueva).
  // Devuelve una promesa con { code, gen, send(id, msg), kick(id), close() }.
  function host(handlers, opts) {
    const fixed = opts && opts.code ? { code: opts.code, gen: opts.gen || 1 } : null;
    return new Promise(function (resolve, reject) {
      let attempts = 0;
      (function tryOpen() {
        attempts++;
        const code = fixed ? fixed.code : randomCode();
        const gen = fixed ? fixed.gen : 1;
        const peer = new Peer(peerId(code, gen), { debug: 1 });
        const conns = new Map();
        let opened = false;
        let closing = false;

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
            gen: gen,
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
              closing = true;
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
            if (closing || !conns.delete(id)) return;
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
            // Código ya en uso: con sala nueva se sortea otro; al tomar un relevo no hay alternativa.
            if (err.type === 'unavailable-id' && !fixed && attempts < 4) return tryOpen();
            const e = new Error(explain(err));
            e.taken = err.type === 'unavailable-id';
            return reject(e);
          }
          if (err.type !== 'peer-unavailable') handlers.onError(explain(err));
        });
      })();
    });
  }

  // Entra en una sala. handlers: onMessage(msg), onClose().
  // opts.gen: generación concreta a la que conectar (al seguir a un anfitrión de relevo); si no se
  // indica, se busca la sala en la generación 1 y, si ya no existe, en las siguientes.
  // Devuelve una promesa con { gen, send(msg), close() }.
  function join(code, handlers, opts) {
    const gens = [];
    if (opts && opts.gen) gens.push(opts.gen);
    else for (let g = 1; g <= MAX_GEN; g++) gens.push(g);

    return new Promise(function (resolve, reject) {
      const peer = new Peer({ debug: 1 });
      let conn = null;
      let settled = false;
      let closed = false;
      let at = 0;

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

      function connect() {
        const gen = gens[at];
        // reliable:false = canal sin orden garantizado: un paquete lento no frena a los que
        // vienen detrás. netcode.js ya numera lo que necesita orden.
        const c = (conn = peer.connect(peerId(code, gen), { reliable: false, serialization: 'json' }));
        c.on('open', function () {
          if (settled || c !== conn) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            gen: gen,
            send: function (msg) {
              if (c.open) c.send(msg);
            },
            close: function () {
              closed = true;
              peer.destroy();
            },
          });
        });
        c.on('data', function (msg) {
          if (c === conn) handlers.onMessage(msg);
        });
        c.on('close', function () {
          if (c === conn) lost();
        });
        c.on('error', function () {
          if (c === conn) lost();
        });
      }

      peer.on('open', connect);

      peer.on('error', function (err) {
        if (!settled) {
          // Esa generación de la sala no existe: se prueba la siguiente.
          if (err.type === 'peer-unavailable' && at + 1 < gens.length) {
            at++;
            return connect();
          }
          return fail(explain(err));
        }
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
