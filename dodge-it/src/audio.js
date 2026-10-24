// Sound, kept to a few soft thumps (the user's own music matters more than effects): the smack of a hit, a slap
// for a catch, the ball bouncing on the boards, a whoosh for your own throw.
// Music: drop files in Work/music/ and list them in Work/music/tracks.js; they loop in order.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const A = { ctx: null, master: null, vol: 0.7, musicVol: 0.5 };
  let noiseBuf = null, musicEl = null, tracks = [], trackI = 0;

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return;
    A.ctx = new C();
    A.master = A.ctx.createGain();
    A.master.gain.value = A.vol;
    A.master.connect(A.ctx.destination);
    noiseBuf = A.ctx.createBuffer(1, A.ctx.sampleRate * 1.2, A.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.loadMusic();
  };
  A.setVolume = function (v) { A.vol = v; if (A.master) A.master.gain.value = v; };
  A.setMusicVolume = function (v) { A.musicVol = v; if (musicEl) musicEl.volume = v; };
  A.loadMusic = function () {
    tracks = SB.TRACKS || [];
    if (!tracks.length || musicEl) return;
    musicEl = new Audio();
    musicEl.volume = A.musicVol;
    musicEl.addEventListener("ended", function () { trackI = (trackI + 1) % tracks.length; musicEl.src = "music/" + tracks[trackI]; musicEl.play().catch(function () {}); });
    musicEl.src = "music/" + tracks[0];
    musicEl.play().catch(function () {});
  };

  function noise(t0, dur, type, f0, f1, vol, q) {
    const c = A.ctx;
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q || 0.9;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.012, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t0, Math.random() * 0.8); src.stop(t0 + dur + 0.05);
  }

  // How loud something is from where you stand (0.15 far .. 1 close).
  function near(sim, x, z) {
    const h = sim && sim.human();
    if (!h) return 0.5;
    return Math.max(0.15, Math.min(1, 1.4 - Math.hypot(h.x - x, h.z - z) / 14));
  }
  A.event = function (e, sim) {
    const c = A.ctx;
    if (!c || !sim) return;
    const t = c.currentTime, me = sim.me;
    switch (e.t) {
      case "throw": if (e.id === me) noise(t, 0.16, "bandpass", 900, 2400, 0.14, 1.2); break;
      case "hit": { const p = sim.players[e.id]; noise(t, 0.13, "lowpass", 1400, 220, 0.55 * near(sim, p.x, p.z)); break; }
      case "caught": case "block": { const p = sim.players[e.id]; noise(t, 0.07, "bandpass", 1800, 900, 0.4 * near(sim, p.x, p.z), 1.5); break; }
      case "bounce": case "floor": { const B = sim.balls[e.b]; if (B) noise(t, 0.09, "lowpass", 600, 140, Math.min(0.3, (e.v || 6) / 30) * near(sim, B.x, B.z)); break; }
    }
  };
  SB.Audio = A;
})(globalThis.SB);
