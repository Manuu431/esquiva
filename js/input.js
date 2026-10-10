// input.js — teclado (WASD / flechas) y táctil (arrastrar = palanca virtual de 8 direcciones).
(function () {
  'use strict';

  const KEYS = {
    ArrowLeft: 'l', KeyA: 'l',
    ArrowRight: 'r', KeyD: 'r',
    ArrowUp: 'u', KeyW: 'u',
    ArrowDown: 'd', KeyS: 'd',
  };
  const down = { l: false, r: false, u: false, d: false };
  const touch = { id: null, x0: 0, y0: 0, mx: 0, my: 0 };
  const TOUCH_DEADZONE = 14; // px
  let usedTouch = false;

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', function (e) {
    const k = KEYS[e.code];
    if (!k || isTyping(e)) return;
    down[k] = true;
    e.preventDefault();
  });

  window.addEventListener('keyup', function (e) {
    const k = KEYS[e.code];
    if (k) down[k] = false;
  });

  // Si la ventana pierde el foco no llegan los keyup: se sueltan todas las teclas.
  window.addEventListener('blur', function () {
    down.l = down.r = down.u = down.d = false;
    touch.id = null;
    touch.mx = touch.my = 0;
  });

  function attachTouch(el) {
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      // Los toques sobre menús y botones son para ellos, no para mover al jugador.
      if (e.target.closest && e.target.closest('.overlay, button')) return;
      usedTouch = true;
      touch.id = e.pointerId;
      touch.x0 = e.clientX;
      touch.y0 = e.clientY;
      touch.mx = touch.my = 0;
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== touch.id) return;
      const dx = e.clientX - touch.x0;
      const dy = e.clientY - touch.y0;
      const d = Math.hypot(dx, dy);
      if (d < TOUCH_DEADZONE) {
        touch.mx = touch.my = 0;
        return;
      }
      // Ángulo -> una de las 8 direcciones.
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
      touch.mx = Math.round(Math.cos((a * Math.PI) / 4));
      touch.my = Math.round(Math.sin((a * Math.PI) / 4));
      // El origen sigue al dedo para poder cambiar de sentido con poco recorrido.
      const max = 48;
      if (d > max) {
        touch.x0 += (dx / d) * (d - max);
        touch.y0 += (dy / d) * (d - max);
      }
      e.preventDefault();
    });
    const end = function (e) {
      if (e.pointerId !== touch.id) return;
      touch.id = null;
      touch.mx = touch.my = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Devuelve la dirección actual: { mx, my } en {-1, 0, 1}.
  function read(out) {
    let mx = (down.r ? 1 : 0) - (down.l ? 1 : 0);
    let my = (down.d ? 1 : 0) - (down.u ? 1 : 0);
    if (touch.id !== null) {
      mx = touch.mx;
      my = touch.my;
    }
    out.mx = mx;
    out.my = my;
    return out;
  }

  window.Input = {
    attachTouch: attachTouch,
    read: read,
    usedTouch: function () {
      return usedTouch;
    },
  };
})();
