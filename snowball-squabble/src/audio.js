// Sound, all synthesised (no files): whooshes, thumps, crunch, horns. Music is the
// user's own: drop files in Work/music/ and list them in Work/music/tracks.json
// (["song1.mp3", ...]); they loop in order. Kept deliberately light on SFX.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const A = { ctx: null, master: null, vol: 0.7, musicVol: 0.5, listener: { x: 0, z: 0, yaw: 0 } };
  let noiseBuf = null, musicEl = null, tracks = [], trackI = 0, stepT = 0;

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
  A.musicState = function () { return musicEl ? { src: musicEl.src.split("/").pop(), paused: musicEl.paused, ready: musicEl.readyState, t: +musicEl.currentTime.toFixed(1), dur: +(musicEl.duration || 0).toFixed(1), vol: musicEl.volume, err: musicEl.error && musicEl.error.code } : null; };
  A.setVolume = function (v) { A.vol = v; if (A.master) A.master.gain.value = v; };
  A.setMusicVolume = function (v) { A.musicVol = v; if (musicEl) musicEl.volume = v; };

  function startMusic(list) {
    tracks = Array.isArray(list) ? list : [];
    if (!tracks.length || musicEl) return;
    musicEl = new Audio();
    musicEl.volume = A.musicVol;
    musicEl.addEventListener("ended", function () { trackI = (trackI + 1) % tracks.length; musicEl.src = "music/" + tracks[trackI]; musicEl.play().catch(function () {}); });
    musicEl.src = "music/" + tracks[0];
    musicEl.play().catch(function () {});
  }
  A.loadMusic = function () {
    // music/tracks.js (works from a double-clicked file) first, music/tracks.json when served over http.
    if (SB.TRACKS && SB.TRACKS.length) { startMusic(SB.TRACKS); return; }
    if (!globalThis.fetch) return;
    fetch("music/tracks.json").then((r) => (r.ok ? r.json() : [])).then(startMusic).catch(function () { /* no soundtrack yet */ });
  };

  // Where a sound is: quieter with distance, panned left/right of where we look.
  function place(x, z) {
    if (x === undefined) return { g: 1, p: 0 };
    const L = A.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    return { g: 1 / (1 + d / 14), p: d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0 };
  }
  function out(g, pan) {
    const c = A.ctx;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(A.master); } else g.connect(A.master);
  }
  function noise(t0, dur, type, f0, f1, vol, x, z, q) {
    const c = A.ctx;
    if (!c) return;
    const pl = place(x, z);
    const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q || 0.9;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol * pl.g, t0 + Math.min(0.03, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); out(g, pl.p);
    src.start(t0, Math.random() * 0.8); src.stop(t0 + dur + 0.05);
  }
  function tone(t0, dur, f0, f1, vol, type, x, z) {
    const c = A.ctx;
    if (!c) return;
    const pl = place(x, z);
    const o = c.createOscillator(); o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol * pl.g, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); out(g, pl.p);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  A.setListener = function (x, z, yaw) { A.listener.x = x; A.listener.z = z; A.listener.yaw = yaw; };

  A.event = function (e, sim) {
    const c = A.ctx;
    if (!c) return;
    const t = c.currentTime;
    switch (e.t) {
      case "throw": noise(t, 0.2, "bandpass", 1700, 380, 0.34, e.x, e.z, 1.2); break;
      case "splat":
        if (e.on === "player") { noise(t, 0.22, "lowpass", 2400, 300, 0.55, e.x, e.z); tone(t, 0.16, 150, 60, 0.35, "sine", e.x, e.z); }
        else if (e.on === "mound") noise(t, 0.17, "lowpass", 1300, 250, 0.4, e.x, e.z);
        else if (e.on === "ground") noise(t, 0.1, "lowpass", 1100, 300, 0.2, e.x, e.z);
        else { noise(t, 0.14, "lowpass", 1800, 300, 0.35, e.x, e.z); tone(t, 0.09, 220, 120, 0.12, "triangle", e.x, e.z); }
        break;
      case "out": if (sim && e.id === sim.humanId) { tone(t, 0.5, 520, 130, 0.3, "triangle"); } break;
      case "roll": noise(t, 0.45, "bandpass", 600, 1200, 0.2, sim && sim.players[e.id] ? sim.players[e.id].x : undefined, sim && sim.players[e.id] ? sim.players[e.id].z : undefined); break;
      case "pack": noise(t, 0.12, "bandpass", 900, 500, 0.3); noise(t + 0.09, 0.1, "bandpass", 1100, 600, 0.25); break;
      case "empty": tone(t, 0.07, 300, 200, 0.12, "square"); break;
      case "built": noise(t, 0.3, "lowpass", 1500, 250, 0.4, e.x, e.z); break;
      case "go": tone(t, 0.18, 660, 660, 0.25, "square"); tone(t + 0.2, 0.34, 990, 990, 0.25, "square"); break;
      case "count": tone(t, 0.12, 440, 440, 0.2, "square"); break;
      case "roundover":
        if (sim && e.winner === sim.humanTeam) [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, 0.3, f, f, 0.22, "triangle"));
        else if (e.winner >= 0) [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, 0.34, f, f * 0.98, 0.2, "triangle"));
        else tone(t, 0.4, 330, 330, 0.18, "triangle");
        break;
    }
  };
  // Crunching steps for the nearby fighters.
  A.steps = function (sim, dt) {
    if (!A.ctx) return;
    stepT -= dt;
    if (stepT > 0) return;
    stepT = 0.17;
    for (const p of sim.players) {
      if (!p.alive || p.roll > 0) continue;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 1.2) continue;
      const d = Math.hypot(p.x - A.listener.x, p.z - A.listener.z);
      if (d > 26) continue;
      if (Math.random() < clampStep(sp)) noise(A.ctx.currentTime, 0.07, "bandpass", 3200, 1500, p.human ? 0.1 : 0.16, p.human ? undefined : p.x, p.human ? undefined : p.z, 1.5);
    }
  };
  function clampStep(sp) { return Math.min(1, sp / 6) * 0.9; }
  SB.Audio = A;
})(globalThis.SB);
