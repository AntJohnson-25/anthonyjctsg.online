// A few soft synthesised sounds (a bag landing, a thunk through the hole). Kept deliberately quiet and small.
(function (SB) {
  "use strict";
  const A = { ctx: null, vol: 1, noise: null };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      A.ctx = new AC();
      const n = A.ctx.sampleRate * 0.5, buf = A.ctx.createBuffer(1, n, A.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      A.noise = buf;
    } catch (e) { A.ctx = null; }
  };
  A.setVolume = function (v) { A.vol = Math.max(0, Math.min(1, v)); };

  function burst(freq, dur, gain, type, q) {
    const c = A.ctx;
    if (!c || A.vol <= 0.001) return;
    const t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = A.noise; f.type = type || "lowpass"; f.frequency.value = freq; f.Q.value = q || 0.7;
    g.gain.setValueAtTime(gain * A.vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + dur + 0.02);
  }
  function tone(freq, dur, gain, endFreq) {
    const c = A.ctx;
    if (!c || A.vol <= 0.001) return;
    const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(freq, t); if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(gain * A.vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  A.event = function (e) {
    if (!A.ctx) return;
    switch (e.t) {
      case "swing": burst(1800, 0.18, 0.05, "bandpass", 0.8); break;
      case "land": { const k = Math.min(1, 0.3 + (e.speed || 0) * 0.1); burst(380, 0.14, 0.42 * k); tone(95, 0.12, 0.22 * k, 60); break; }
      case "ground": burst(260, 0.16, 0.3); break;
      case "bump": burst(520, 0.08, 0.22); break;
      case "hole": tone(130, 0.22, 0.34, 70); burst(300, 0.2, 0.3); break;
      case "drop": burst(220, 0.12, 0.26); tone(80, 0.12, 0.16, 55); break;
    }
  };
  SB.Audio = A;
})(globalThis.SB);
