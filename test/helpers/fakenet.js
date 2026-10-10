// Red simulada para probar netcode.js en Node: un anfitrión, varios invitados y mensajes que
// tardan lo que se les diga (con variación, y por tanto pudiendo llegar desordenados).
'use strict';
const Sim = require('../../js/sim.js');
const Netcode = require('../../js/netcode.js');

const STEP = Netcode.STEP_MS;

function createWorld(opts) {
  const o = opts || {};
  let now = 1000; // ms; no empieza en 0 para no esconder errores de "tiempo absoluto"
  let nextId = 1;
  let rngState = { rng: o.seed || 12345 };
  const queue = [];
  const world = { clients: [], sent: 0, hostTicks: [] };

  function post(delay, fn) {
    queue.push({ at: now + delay, fn: fn });
  }

  function deliver() {
    // En orden de llegada, que no tiene por qué ser el de envío.
    queue.sort(function (a, b) {
      return a.at - b.at;
    });
    while (queue.length && queue[0].at <= now) queue.shift().fn();
  }

  function clone(msg) {
    world.sent++;
    return JSON.parse(JSON.stringify(msg));
  }

  world.rand = function () {
    return Sim.rand(rngState);
  };

  world.now = function () {
    return now;
  };

  world.host = Netcode.createHost({
    name: o.hostName || 'Ana',
    makeBot: o.makeBot,
    botNames: ['Ada', 'Turing', 'Hebb', 'Minsky', 'Hopfield'],
    send: function (id, msg) {
      const c = world.clients.find(function (x) {
        return x.id === id;
      });
      if (!c || c.cut) return;
      const m = clone(msg);
      post(c.latency(), function () {
        c.net.receive(m, now);
      });
    },
    kick: function (id) {
      world.kicked = (world.kicked || []).concat(id);
    },
  });

  // latency: ms por trayecto (número) o función que devuelve ms.
  world.addClient = function (name, latency, version) {
    const lat = typeof latency === 'function' ? latency : function () {
      return latency || 0;
    };
    const c = { id: 'c' + nextId++, latency: lat, cut: false, input: { mx: 0, my: 0 }, events: [] };
    c.net = Netcode.createClient({
      name: name,
      send: function (msg) {
        if (c.cut) return;
        const m = clone(msg);
        if (version && m.t === 'hello') m.v = version;
        post(lat(), function () {
          world.host.receive(c.id, m, now);
        });
      },
    });
    c.net.onEvents = function (ev) {
      c.events.push.apply(c.events, ev);
    };
    world.clients.push(c);
    world.host.join(c.id, now);
    c.net.hello(now);
    return c;
  };

  world.hostInput = { mx: 0, my: 0 };

  // Avanza `ticks` ticks de 1/60 s. El anfitrión y los invitados van desfasados medio tick.
  // each(tick) se llama tras cada tick completo.
  world.run = function (ticks, each) {
    for (let t = 0; t < ticks; t++) {
      now += STEP / 2;
      deliver();
      world.host.tick(world.hostInput, now);
      world.hostTicks.push({ at: now, tick: world.host.state ? world.host.state.tick : -1 });
      now += STEP / 2;
      deliver();
      for (const c of world.clients) c.net.tick(c.input, now);
      if (each) each(t);
    }
  };

  // Tick de simulación que tendrá el anfitrión en el instante `at` (según lo ya ocurrido).
  world.hostTickAt = function (at) {
    let k = -1;
    for (const h of world.hostTicks) {
      if (h.at <= at) k = h.tick;
      else break;
    }
    return k;
  };

  return world;
}

// Estado "tal como lo ve el invitado", con la forma que esperan los controladores de sim.js.
function seenState(view) {
  const s = view.state;
  return {
    tick: s.tick,
    players: s.players,
    stars: s.stars,
    hazards: s.hazards.map(function (z) {
      return { x: z.x + z.vx * view.hazExt, y: z.y + z.vy * view.hazExt, vx: z.vx, vy: z.vy, r: z.r };
    }),
  };
}

module.exports = { createWorld: createWorld, seenState: seenState, STEP: STEP };
