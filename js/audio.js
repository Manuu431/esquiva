// audio.js — pitidos sintetizados con WebAudio (sin ficheros de sonido).
(function () {
  'use strict';

  let ac = null;
  let muted = false;
  try {
    muted = localStorage.getItem('esquiva.mute') === '1';
  } catch (e) {
    /* sin almacenamiento: se queda con sonido */
  }

  // Los navegadores solo dejan sonar tras un gesto del usuario: se llama desde un clic.
  function unlock() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ac = new AC();
  }

  function blip(freq, toFreq, dur, type, vol) {
    if (!ac || muted || ac.state !== 'running') return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function onEvents(events, localIdx) {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const mine = e.p === localIdx;
      if (e.type === 'hit') blip(mine ? 220 : 160, 60, 0.22, 'sawtooth', mine ? 0.16 : 0.05);
      else if (e.type === 'star') blip(660, 1320, 0.14, 'triangle', mine ? 0.14 : 0.05);
      else if (e.type === 'dead') blip(300, 40, 0.6, 'square', mine ? 0.14 : 0.06);
    }
  }

  window.Sfx = {
    unlock: unlock,
    onEvents: onEvents,
    tick: function () {
      blip(440, 440, 0.08, 'square', 0.06);
    },
    go: function () {
      blip(880, 880, 0.2, 'square', 0.07);
    },
    toggleMute: function () {
      muted = !muted;
      try {
        localStorage.setItem('esquiva.mute', muted ? '1' : '0');
      } catch (e) {
        /* nada */
      }
      return muted;
    },
    isMuted: function () {
      return muted;
    },
  };
})();
