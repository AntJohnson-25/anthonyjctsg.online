// Tiny WebAudio synth: no audio files. Starts on the first tap/key (browsers and
// iPhone Safari require a gesture), and everything is a no-op until then.
(function (G) {
  "use strict";
  const A = { muted: false, ctx: null };
  G.Audio = A;
  let master, noiseBuf, wind, windGain, windFilter;

  A.unlock = function () {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC();
      master = A.ctx.createGain(); master.gain.value = A.muted ? 0 : 0.7; master.connect(A.ctx.destination);
      const n = A.ctx.sampleRate * 2;
      noiseBuf = A.ctx.createBuffer(1, n, A.ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      wind = A.ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
      windFilter = A.ctx.createBiquadFilter(); windFilter.type = "bandpass"; windFilter.frequency.value = 500; windFilter.Q.value = 0.6;
      windGain = A.ctx.createGain(); windGain.gain.value = 0;
      wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wind.start();
    } catch (e) { A.ctx = null; }
  };
  A.setMuted = function (m) {
    A.muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
    try { localStorage.setItem("cj_muted", m ? "1" : "0"); } catch (e) {}
  };
  A.wind = function (speed, on) {
    if (!windGain) return;
    windGain.gain.value = on ? Math.min(0.16, 0.02 + speed * 0.006) : 0;
    windFilter.frequency.value = 300 + speed * 40;
  };
  function tone(type, f0, f1, dur, vol, delay) {
    if (!A.ctx || A.muted) return;
    const t = A.ctx.currentTime + (delay || 0);
    const o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function burst(freq, q, dur, vol, type) {
    if (!A.ctx || A.muted) return;
    const t = A.ctx.currentTime;
    const s = A.ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = A.ctx.createBiquadFilter(); f.type = type || "lowpass"; f.frequency.value = freq; f.Q.value = q;
    const g = A.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  A.jump = function () { tone("sine", 260, 520, 0.18, 0.18); burst(1200, 0.7, 0.14, 0.08, "bandpass"); };
  A.land = function (hard) { burst(hard ? 220 : 340, 0.8, hard ? 0.22 : 0.11, hard ? 0.5 : 0.28); tone("sine", 90, 45, 0.15, hard ? 0.4 : 0.2); };
  A.slide = function () { burst(1800, 0.5, 0.5, 0.12, "bandpass"); };
  A.jacks = function () { for (let i = 0; i < 6; i++) tone("triangle", 2100 + Math.random() * 1700, 1700 + Math.random() * 900, 0.07, 0.06, i * 0.035 + Math.random() * 0.02); };
  A.step = function (v) { burst(420 + Math.random() * 120, 1, 0.05, 0.06 * v); };
  A.crash = function () { burst(500, 0.6, 0.5, 0.7); tone("sawtooth", 140, 40, 0.4, 0.3); };
  A.fall = function () { tone("sine", 700, 90, 1.1, 0.12); };
  A.grab = function () { burst(2600, 4, 0.12, 0.18, "bandpass"); tone("triangle", 1300, 1250, 0.12, 0.07); };
  A.trick = function () { [660, 880, 1175].forEach(function (f, i) { tone("triangle", f, f, 0.1, 0.09, i * 0.06); }); };
  A.bark = function (v) {     // two hoarse barks: a falling saw through a vowel-ish bandpass
    [0, 0.17].forEach(function (d) {
      tone("sawtooth", 520, 210, 0.13, 0.12 * v, d);
      if (!A.ctx || A.muted) return;
      const t = A.ctx.currentTime + d, s = A.ctx.createBufferSource(); s.buffer = noiseBuf;
      const f = A.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 900; f.Q.value = 2;
      const g = A.ctx.createGain(); g.gain.setValueAtTime(0.2 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + 0.14);
    });
  };
  A.punch = function () { burst(700, 1.2, 0.09, 0.45, "lowpass"); tone("square", 180, 70, 0.1, 0.22); };
  A.kick = function () { burst(420, 1, 0.16, 0.6, "lowpass"); tone("sine", 130, 45, 0.2, 0.4); };
  A.whiff = function () { burst(2200, 0.7, 0.16, 0.1, "bandpass"); };
  A.block = function () { tone("triangle", 880, 700, 0.1, 0.25); burst(3000, 3, 0.08, 0.25, "bandpass"); };
  A.ko = function () { burst(300, 0.8, 0.45, 0.65); tone("sawtooth", 200, 50, 0.4, 0.3); };
  A.beep = function (hi) { tone("square", hi ? 1040 : 520, hi ? 1040 : 520, hi ? 0.45 : 0.18, 0.18); };
  A.finish = function () { [523, 659, 784, 1046, 1318].forEach(function (f, i) { tone("triangle", f, f, 0.2, 0.14, i * 0.08); }); };  A.best = function () { [523, 659, 784, 1046].forEach(function (f, i) { tone("triangle", f, f, 0.18, 0.12, i * 0.09); }); };
})(window.CJ = window.CJ || {});
