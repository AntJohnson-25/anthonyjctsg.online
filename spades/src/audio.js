// Sound. Music first: the user supplies the soundtrack (music/tracks.json:
// menu, play, results). Then a few quiet, real-sounding effects made in code:
// a card snapped onto the felt, the shuffle and deal, a trick swept up, a soft
// bid chip, a gentle turn chime, a low "tsk" when someone cuts their partner,
// and the sea below (a soft wash, a breeze, each wave breaking). No cartoon sounds.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const A = { ctx: null, on: true, vol: { master: 0.8, music: 0.6, sfx: 0.75 }, userMusic: 1,
    tracks: { menu: [], play: [], results: [] }, buffers: {}, cur: null, curKey: "", playIdx: 0 };

  A.unlock = function () {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    A.ctx = new C();
    A.master = A.ctx.createGain(); A.master.connect(A.ctx.destination);
    A.musicGain = A.ctx.createGain(); A.musicGain.connect(A.master);
    A.sfxGain = A.ctx.createGain(); A.sfxGain.connect(A.master);
    A.ambGain = A.ctx.createGain(); A.ambGain.gain.value = 0; A.ambGain.connect(A.sfxGain);
    const n = A.ctx.sampleRate * 2;
    A.noise = A.ctx.createBuffer(1, n, A.ctx.sampleRate);
    const d = A.noise.getChannelData(0);
    // Brown-ish noise: smoother than white, good for paper and wind.
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.15; }
    A.white = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate);
    const wd = A.white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    A.apply();
    ambience();
  };
  A.setVolumes = function (v) { if (v) Object.assign(A.vol, v); A.apply(); };
  A.setOn = function (on) { A.on = on; A.apply(); };
  A.setMusic = function (v) { A.userMusic = v; A.apply(); };
  A.apply = function () {
    if (!A.ctx) return;
    A.master.gain.value = A.on ? A.vol.master : 0;
    A.musicGain.gain.value = A.vol.music * A.userMusic;
    A.sfxGain.gain.value = A.vol.sfx;
  };

  // ------------------------------------------------------------------ music (the user's tracks)
  // music/tracks.json: { "menu": ["menu.mp3"], "play": ["groove1.mp3", "groove2.mp3"], "results": ["win.mp3"] }
  A.loadTracks = function () {
    fetch("music/tracks.json").then(function (r) { return r.ok ? r.json() : {}; }).then(function (j) {
      ["menu", "play", "results"].forEach(function (k) {
        if (Array.isArray(j[k])) A.tracks[k] = j[k].map(function (x) { return typeof x === "string" ? x : x && x.file; }).filter(function (x) { return typeof x === "string"; });
      });
      if (A.want) { const w = A.want; A.want = null; A.music(w); }
    }).catch(function () { /* no soundtrack yet */ });
  };
  function buf(file) {
    if (A.buffers[file]) return A.buffers[file];
    A.buffers[file] = fetch("music/" + file).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(function (b) { return new Promise(function (ok, no) { A.ctx.decodeAudioData(b, ok, no); }); });
    return A.buffers[file];
  }
  // kind: "menu" | "play" | "results" | null (silence). Play tracks rotate; each one loops until the kind changes.
  A.music = function (kind) {
    if (!A.ctx) { A.want = kind; return; }
    const list = kind ? A.tracks[kind] : [];
    if (kind === "play" && A.curKind !== "play") A.playIdx = (A.playIdx + 1) % Math.max(1, list.length);
    const file = list.length ? list[(kind === "play" ? A.playIdx : 0) % list.length] : null;
    const key = kind + ":" + file;
    if (key === A.curKey) return;
    A.curKey = key; A.curKind = kind;
    fadeOut(A.cur);
    A.cur = null;
    if (!file) return;
    buf(file).then(function (b) {
      if (A.curKey !== key) return;
      const src = A.ctx.createBufferSource(), g = A.ctx.createGain();
      src.buffer = b; src.loop = true;
      g.gain.setValueAtTime(0, A.ctx.currentTime); g.gain.linearRampToValueAtTime(1, A.ctx.currentTime + 1.5);
      src.connect(g); g.connect(A.musicGain); src.start();
      A.cur = { src: src, g: g };
    }).catch(function () { /* missing file: stay quiet */ });
  };
  function fadeOut(c) {
    if (!c) return;
    const t = A.ctx.currentTime;
    c.g.gain.cancelScheduledValues(t); c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.linearRampToValueAtTime(0, t + 1.2);
    try { c.src.stop(t + 1.3); } catch (e) { /* stopped */ }
  }

  // ------------------------------------------------------------------ effects
  function noiseHit(t, o) {
    const s = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
    s.buffer = o.white ? A.white : A.noise;
    f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f0 || 2500, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.len);
    f.Q.value = o.q || 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol, t + (o.att || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.len);
    s.connect(f); f.connect(g); g.connect(o.out || A.sfxGain);
    s.start(t, Math.random() * 1.5); s.stop(t + o.len + 0.05);
  }
  function tone(t, f, len, vol, type) {
    const o = A.ctx.createOscillator(), g = A.ctx.createGain();
    o.type = type || "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(A.sfxGain); o.start(t); o.stop(t + len + 0.05);
  }
  function ok() { return A.ctx && A.on; }
  // A card snapped down on felt: a short papery slap with a low thud.
  A.card = function (hard) {
    if (!ok()) return;
    const t = A.ctx.currentTime + 0.005;
    noiseHit(t, { white: true, f0: 3200, f1: 1400, len: 0.07, vol: hard ? 0.5 : 0.32, q: 0.7 });
    noiseHit(t, { type: "lowpass", f0: 420, len: 0.09, vol: hard ? 0.5 : 0.3 });
  };
  // Picking a card up / hovering: the faintest flick.
  A.flick = function () { if (!ok()) return; noiseHit(A.ctx.currentTime, { white: true, f0: 5200, len: 0.035, vol: 0.06, q: 1.4 }); };
  // The deal: a riffle, then cards flicked out round the table.
  A.deal = function () {
    if (!ok()) return;
    const t = A.ctx.currentTime;
    for (let i = 0; i < 26; i++) noiseHit(t + i * 0.018, { white: true, f0: 4200 + Math.random() * 1500, len: 0.025, vol: 0.12, q: 1.2 });
    noiseHit(t + 0.5, { type: "lowpass", f0: 600, len: 0.08, vol: 0.25 });
    for (let i = 0; i < 52; i++) noiseHit(t + 0.6 + i * 0.05, { white: true, f0: 2600 + Math.random() * 800, f1: 1500, len: 0.04, vol: 0.09 + Math.random() * 0.04, q: 0.8 });
  };
  // The trick swept to its winner.
  A.sweep = function () {
    if (!ok()) return;
    const t = A.ctx.currentTime;
    noiseHit(t, { white: true, f0: 1800, f1: 3800, len: 0.22, vol: 0.16, q: 0.6, att: 0.06 });
    noiseHit(t + 0.2, { type: "lowpass", f0: 500, len: 0.07, vol: 0.18 });
  };
  // A bid: a clay chip set down.
  A.chip = function () {
    if (!ok()) return;
    const t = A.ctx.currentTime;
    tone(t, 2400, 0.05, 0.06, "triangle"); tone(t + 0.006, 3100, 0.04, 0.04, "triangle");
    noiseHit(t, { type: "lowpass", f0: 900, len: 0.05, vol: 0.18 });
  };
  // Your turn: two soft notes.
  A.turn = function () {
    if (!ok()) return;
    const t = A.ctx.currentTime + 0.01;
    tone(t, 659, 0.35, 0.07); tone(t + 0.11, 880, 0.45, 0.06);
  };
  // Someone cut their partner: a quiet low "tsk".
  A.tsk = function () {
    if (!ok()) return;
    const t = A.ctx.currentTime;
    noiseHit(t, { white: true, f0: 3800, len: 0.05, vol: 0.12, q: 2 });
    tone(t + 0.02, 220, 0.25, 0.05, "triangle"); tone(t + 0.02, 207, 0.3, 0.04, "triangle");
  };
  // Something good: a nil made, a cover, a win.
  A.chime = function (big) {
    if (!ok()) return;
    const t = A.ctx.currentTime + 0.01;
    (big ? [523, 659, 784, 1047] : [784, 988]).forEach(function (f, i) { tone(t + i * 0.09, f, 0.9, big ? 0.07 : 0.05); });
  };
  A.tick = function () { if (!ok()) return; tone(A.ctx.currentTime, 1500, 0.04, 0.03, "square"); };

  // ------------------------------------------------------------------ the sea below
  function ambience() {
    // The steady wash of the sea: low, soft.
    const s = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
    s.buffer = A.noise; s.loop = true;
    f.type = "lowpass"; f.frequency.value = 420;
    g.gain.value = 0.16;
    s.connect(f); f.connect(g); g.connect(A.ambGain); s.start();
    // A light sea breeze.
    const w = A.ctx.createBufferSource(), wf = A.ctx.createBiquadFilter(), wg = A.ctx.createGain(), lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
    w.buffer = A.noise; w.loop = true; w.playbackRate.value = 0.6;
    wf.type = "bandpass"; wf.frequency.value = 900; wf.Q.value = 0.5;
    wg.gain.value = 0.03; lfo.frequency.value = 0.05; lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(wg.gain);
    w.connect(wf); wf.connect(wg); wg.connect(A.ambGain); w.start(); lfo.start();
    A.ambGain.gain.linearRampToValueAtTime(0.55, A.ctx.currentTime + 3);
    A.surfAt = 0;
  }
  // Each wave breaking on the beach below (main.js calls this in time with the ocean):
  // a rising rumble as it curls, the crash, then the hiss of the swash up the sand.
  A.surf = function (strength) {
    if (!ok()) return;
    const t = A.ctx.currentTime, k = 0.6 + 0.4 * (strength || 1);
    const s = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
    s.buffer = A.noise; s.loop = true;
    f.type = "lowpass"; f.frequency.setValueAtTime(260, t); f.frequency.linearRampToValueAtTime(1300, t + 0.9); f.frequency.exponentialRampToValueAtTime(380, t + 4.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32 * k, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    s.connect(f); f.connect(g); g.connect(A.ambGain); s.start(t, Math.random()); s.stop(t + 5.1);
    const h = A.ctx.createBufferSource(), hf = A.ctx.createBiquadFilter(), hg = A.ctx.createGain();
    h.buffer = A.white; h.loop = true;
    hf.type = "bandpass"; hf.frequency.value = 3200; hf.Q.value = 0.4;
    hg.gain.setValueAtTime(0.0001, t + 0.7); hg.gain.exponentialRampToValueAtTime(0.03 * k, t + 1.4); hg.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    h.connect(hf); hf.connect(hg); hg.connect(A.ambGain); h.start(t + 0.7); h.stop(t + 4.3);
  };
  HS.Audio = A;
})(globalThis.HS);
