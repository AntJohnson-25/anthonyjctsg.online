// Sound. Two halves:
//  - Music: the user's own tracks in music/ (music/tracks.json: menu, match,
//    results), one <audio> element that swaps its src (iPhone Safari ignores
//    <audio>.volume, so levels go through Web Audio where it can).
//  - Gunfire as real as synthesis gets. Every gunshot is layered (the muzzle
//    blast's crack through a saturating drive, the body of the blast, a low
//    thump, the action cycling, brass hitting the pavement) and rendered once
//    at start-up into a few variations per gun (OfflineAudioContext). Each shot
//    then plays from where it was fired: quieter and duller with distance (air
//    soaks up the highs), late by the speed of sound, and sent into an urban
//    reverb (slap-back off the buildings, then a long tail) that grows with
//    distance. Rounds passing close to you crack (rifles) or whizz (pistols).
// Real recordings win: any sound named in sounds/sounds.json replaces the
// synthesized one (see sounds/README.md).
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  // The soundtrack and the guns share the mix: shots punch through but don't bury the music.
  const A = { on: true, musicVol: 0.4, sfxVol: 1, ctx: null, L: { x: 0, y: 0, z: 0, yaw: 0 } };
  let ctx = null, master = null, sfx = null, verb = null, music = null, noiseBuf = null;
  const BUF = {};          // name -> [AudioBuffer variations]
  const SAMPLES = {};      // name -> [AudioBuffer] from sounds/ (beat BUF)
  const SOUND_SPEED = 343;

  A.unlock = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = A.ctx = new AC();
        master = ctx.createGain(); master.gain.value = A.on ? 1 : 0; master.connect(ctx.destination);
        // A limiter on the effects so a magazine dump next to your ear doesn't
        // clip. It only catches the top few dB: set lower, it squashed every
        // shot under the music.
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -4; lim.knee.value = 3; lim.ratio.value = 12; lim.attack.value = 0.001; lim.release.value = 0.12;
        lim.connect(master);
        sfx = ctx.createGain(); sfx.gain.value = A.sfxVol; sfx.connect(lim);
        verb = ctx.createConvolver();
        verb.buffer = cityIR(ctx);
        const verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
        verb.connect(verbOut); verbOut.connect(sfx);
        // Music skips the limiter so gunfire doesn't pump the song.
        music = ctx.createGain(); music.gain.value = 0; music.connect(master);
        noiseBuf = makeNoise(ctx.sampleRate, 2);
        renderAll();
        loadSamples();
        ambience();
        musicInit();
      }
      if (ctx.state === "suspended") ctx.resume();
      if (A.want && mEl && mEl.paused && mTrack) { const p = mEl.play(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* no audio */ }
  };
  A.setOn = function (on) {
    A.on = on;
    if (master) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.05);
    if (direct && mEl) mEl.volume = on ? musicLevel() : 0;
  };
  A.setSfxVol = function (v) { A.sfxVol = v; if (sfx) sfx.gain.setTargetAtTime(v, ctx.currentTime, 0.05); };
  A.setMusicVol = function (v) { A.musicVol = v; if (mTrack) musicTo(musicLevel(), 0.1); };
  A.setListener = function (x, y, z, yaw) { A.L.x = x; A.L.y = y; A.L.z = z; A.L.yaw = yaw; };

  function makeNoise(rate, secs) {
    const b = new AudioBuffer({ length: Math.ceil(rate * secs), sampleRate: rate, numberOfChannels: 1 });
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // The street's impulse response: a cluster of slap-back echoes off the
  // building fronts (20-160 ms), then a diffuse tail that darkens as it dies.
  function cityIR(c) {
    const rate = c.sampleRate, len = Math.floor(rate * 2.4);
    const ir = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const k = 0.25 + 0.7 * Math.exp(-t / 0.5);      // the tail gets duller as it goes
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.exp(-t / 0.55) * 0.35 * Math.min(1, t / 0.03);
      }
      for (let e = 0; e < 9; e++) {
        const t = 0.02 + Math.random() * 0.14 + e * 0.012, i = Math.floor(t * rate);
        const a = (0.55 - e * 0.045) * (Math.random() < 0.5 ? -1 : 1);
        for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += a * Math.exp(-k / 6) * (k % 2 ? -0.6 : 1);
      }
    }
    return ir;
  }

  // ------------------------------------------------------------------ synthesis kit (works on any context)
  function envGain(c, dest, t, attack, peak, decay) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, decay);
    g.connect(dest);
    return g;
  }
  // Filtered noise: frequency sweeps f0 -> f1 over `sweep` seconds.
  function nz(c, dest, t, dur, type, f0, f1, q, attack, peak, decay, sweep) {
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q || 0.7;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + (sweep || dur));
    s.connect(f); f.connect(envGain(c, dest, t, attack, peak, decay));
    s.start(t, Math.random() * 1.2); s.stop(t + dur);
  }
  function osc(c, dest, t, type, f0, f1, dur, peak, decay) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(envGain(c, dest, t, 0.002, peak, decay || dur / 3));
    o.start(t); o.stop(t + dur + 0.05);
  }
  function drive(c, dest, amount) {
    const ws = c.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    ws.curve = curve; ws.oversample = "2x";
    ws.connect(dest);
    return ws;
  }
  // Brass on pavement: two or three bright pings, each quieter and closer together.
  function casing(c, dest, t, shell) {
    let tt = t, a = shell ? 0.1 : 0.16;
    const f = shell ? 900 : 3600 + Math.random() * 1600;
    for (let k = 0; k < 3; k++) {
      if (shell) nz(c, dest, tt, 0.06, "bandpass", f * (1 + Math.random() * 0.3), 0, 4, 0.001, a, 0.012);
      else { osc(c, dest, tt, "sine", f * (1 + (Math.random() - 0.5) * 0.15), 0, 0.09, a, 0.025); osc(c, dest, tt, "sine", f * 2.71, 0, 0.05, a * 0.4, 0.012); }
      tt += 0.06 + Math.random() * 0.07 - k * 0.012;
      a *= 0.55;
    }
  }
  function clack(c, dest, t, f, peak, body) {
    nz(c, dest, t, 0.05, "bandpass", f, 0, 2.5, 0.0005, peak, 0.01);
    if (body) nz(c, dest, t, 0.08, "lowpass", 600, 0, 0.7, 0.001, peak * body, 0.02);
  }

  // The guns. crack: the blast's top end (bandpass f0 -> f1); body: its
  // lowpassed weight; thump: the low sine punch; drv: how hard it clips.
  const GUNS = {
    pistol:   { len: 0.9, crack: [2800, 900, 0.04, 1.0], body: [1100, 0.09, 0.7], thump: [160, 55, 0.09, 0.8], drv: 3.0, snap: 0.9, mech: [0.022, 2400, 0.25], casing: 0.42 },
    rifle:    { len: 0.9, crack: [3600, 1000, 0.05, 1.1], body: [1300, 0.13, 0.8], thump: [130, 45, 0.12, 0.9], drv: 4.5, snap: 1.0, mech: [0.018, 2000, 0.2], casing: 0.38 },
    shotgun:  { len: 1.4, crack: [2000, 500, 0.08, 1.0], body: [800, 0.26, 1.1], thump: [95, 32, 0.25, 1.2], drv: 3.5, snap: 0.8, pump: 0.36, casing: 0.95, shell: true },
    marksman: { len: 1.0, crack: [3200, 800, 0.06, 1.25], body: [1100, 0.24, 1.0], thump: [105, 34, 0.22, 1.1], drv: 5.5, snap: 1.1, mech: [0.02, 1800, 0.22], casing: 0.5 }
  };
  function gunshot(c, out, P) {
    const j = 0.93 + Math.random() * 0.14;
    // Only the crack goes through the drive (it's what clips in a real
    // recording); the body and the thump stay clean so the shot ends sharply.
    const pre = c.createGain();
    pre.gain.value = 0.6;
    pre.connect(drive(c, out, P.drv));
    // The supersonic snap of the muzzle: a few hundred microseconds of everything.
    nz(c, pre, 0, 0.01, "highpass", 3000, 0, 0.7, 0.0002, P.snap, 0.0025);
    nz(c, pre, 0, P.crack[2] * 4, "bandpass", P.crack[0] * j, P.crack[1], 0.55, 0.0004, P.crack[3], P.crack[2] * 0.6, P.crack[2] * 2);
    nz(c, out, 0, P.body[1] * 5, "lowpass", P.body[0] * j, P.body[0] * 0.35, 0.8, 0.001, P.body[2] * 0.55, P.body[1] * 0.6, P.body[1] * 3);
    osc(c, out, 0, "sine", P.thump[0] * j, P.thump[1], P.thump[2] * 3, P.thump[3] * 0.8, P.thump[2] * 0.6);
    osc(c, out, 0, "triangle", P.thump[0] * 2 * j, P.thump[1] * 2, P.thump[2] * 1.5, P.thump[3] * 0.2, P.thump[2] * 0.4);
    // The action cycling, a pump, brass on the pavement.
    if (P.mech) clack(c, out, P.mech[0], P.mech[1] * j, P.mech[2], 0.5);
    if (P.pump) { clack(c, out, P.pump, 1500, 0.35, 0.8); clack(c, out, P.pump + 0.13, 2100, 0.4, 0.6); }
    if (P.casing) casing(c, out, P.casing + Math.random() * 0.12, !!P.shell);
  }
  function rpgLaunch(c, out) {
    const pre = c.createGain(); pre.connect(drive(c, out, 2.5));
    nz(c, pre, 0, 0.3, "bandpass", 1600, 500, 0.6, 0.001, 0.9, 0.06);
    osc(c, pre, 0, "sine", 90, 30, 0.6, 1.1, 0.18);
    // The motor: a rising hiss that runs away from you.
    nz(c, out, 0.03, 1.4, "bandpass", 500, 2200, 1.2, 0.05, 0.55, 0.45, 0.5);
    nz(c, out, 0.03, 1.6, "highpass", 3000, 0, 0.7, 0.05, 0.25, 0.6);
  }
  function explosion(c, out) {
    const pre = c.createGain(); pre.connect(drive(c, out, 3));
    nz(c, pre, 0, 0.05, "highpass", 1500, 0, 0.7, 0.0003, 1.0, 0.01);
    nz(c, pre, 0, 2.6, "lowpass", 2400, 140, 0.7, 0.002, 1.2, 0.5, 0.9);
    osc(c, pre, 0, "sine", 62, 22, 1.8, 1.4, 0.45);
    osc(c, pre, 0, "sine", 38, 18, 2.0, 0.9, 0.7);
    // Debris pattering down.
    for (let k = 0; k < 14; k++) nz(c, out, 0.25 + Math.random() * 1.4, 0.05, "bandpass", 1500 + Math.random() * 3000, 0, 3, 0.001, 0.12 * Math.random(), 0.01);
  }
  // The dead: a rasping voice (a sawtooth through two vocal-tract bandpasses,
  // its pitch sagging and wobbling) over breath noise.
  function voice(c, out, t, dur, f0, f1, peak, rasp) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    const vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 5 + Math.random() * 4; vg.gain.value = f0 * 0.06;
    vib.connect(vg); vg.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.25);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.18);
    [[480 + Math.random() * 120, 3], [1100 + Math.random() * 300, 5]].forEach(function (fm) {
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = fm[0]; f.Q.value = fm[1];
      o.connect(f); f.connect(g);
    });
    g.connect(out);
    o.start(t); o.stop(t + dur + 0.1); vib.start(t); vib.stop(t + dur + 0.1);
    nz(c, out, t, dur, "bandpass", 900, 500, 1.5, dur * 0.3, peak * (rasp || 0.35), dur * 0.3);
  }
  const ZOMBIE = {
    groan: { len: 2.2, f: function (c, o) { voice(c, o, 0, 1.4 + Math.random() * 0.6, 85 + Math.random() * 40, 60 + Math.random() * 20, 0.5); } },
    zscream: { len: 1.6, f: function (c, o) { voice(c, o, 0, 1.2, 230 + Math.random() * 80, 150, 0.7, 0.8); } },
    zswipe: { len: 0.7, f: function (c, o) { nz(c, o, 0.05, 0.25, "bandpass", 500, 1700, 1.2, 0.04, 0.35, 0.06); voice(c, o, 0, 0.5, 140, 100, 0.45, 0.6); } },
    rise: { len: 2.6, f: function (c, o) {
      for (let k = 0; k < 9; k++) nz(c, o, k * 0.18 + Math.random() * 0.1, 0.12, "lowpass", 500, 200, 0.7, 0.003, 0.35, 0.03);
      voice(c, o, 0.6, 1.6, 70, 55, 0.45);
    } }
  };

  // Everything else, each a short recipe.
  const MISC = {
    flyby_crack: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.004, "highpass", 2500, 0, 0.7, 0.0001, 1.2, 0.0015); nz(c, o, 0.002, 0.2, "bandpass", 3000, 700, 1.4, 0.001, 0.3, 0.05, 0.15); } },
    flyby_whiz: { len: 0.3, f: function (c, o) { nz(c, o, 0, 0.3, "bandpass", 4200, 1600, 6, 0.04, 0.5, 0.06, 0.25); } },
    imp_concrete: { len: 0.3, f: function (c, o) { nz(c, o, 0, 0.05, "bandpass", 3200, 1500, 1.2, 0.0005, 0.6, 0.012); nz(c, o, 0, 0.1, "lowpass", 500, 0, 0.7, 0.001, 0.4, 0.02); nz(c, o, 0.02, 0.25, "highpass", 2500, 0, 0.7, 0.01, 0.06, 0.08); } },
    imp_brick: { len: 0.3, f: function (c, o) { nz(c, o, 0, 0.05, "bandpass", 2400, 1200, 1.2, 0.0005, 0.6, 0.014); nz(c, o, 0, 0.1, "lowpass", 450, 0, 0.7, 0.001, 0.45, 0.025); nz(c, o, 0.02, 0.25, "highpass", 2200, 0, 0.7, 0.01, 0.07, 0.09); } },
    imp_metal: { len: 0.5, f: function (c, o) { const f = 1800 + Math.random() * 1500; osc(c, o, 0, "sine", f, 0, 0.45, 0.35, 0.09); osc(c, o, 0, "sine", f * 2.43, 0, 0.3, 0.18, 0.05); nz(c, o, 0, 0.04, "highpass", 3000, 0, 0.7, 0.0005, 0.5, 0.008); } },
    imp_wood: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.08, "bandpass", 700, 400, 2, 0.0008, 0.7, 0.02); nz(c, o, 0, 0.04, "highpass", 2000, 0, 0.7, 0.0005, 0.25, 0.006); } },
    imp_glass: { len: 0.6, f: function (c, o) { for (let k = 0; k < 6; k++) osc(c, o, k * 0.03 + Math.random() * 0.06, "sine", 3500 + Math.random() * 4000, 0, 0.12, 0.12, 0.03); nz(c, o, 0, 0.05, "highpass", 4000, 0, 0.7, 0.0005, 0.4, 0.01); } },
    imp_dirt: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.12, "lowpass", 700, 250, 0.7, 0.001, 0.6, 0.03); } },
    body: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.12, "lowpass", 500, 180, 0.8, 0.001, 0.9, 0.03); osc(c, o, 0, "sine", 110, 60, 0.12, 0.5, 0.04); } },
    magout: { len: 0.3, f: function (c, o) { clack(c, o, 0, 1700, 0.4, 0.6); nz(c, o, 0.04, 0.12, "bandpass", 2600, 1800, 3, 0.01, 0.12, 0.03); } },
    magin: { len: 0.3, f: function (c, o) { nz(c, o, 0, 0.08, "bandpass", 2200, 1600, 3, 0.02, 0.12, 0.02); clack(c, o, 0.07, 1400, 0.5, 0.9); } },
    bolt: { len: 0.4, f: function (c, o) { nz(c, o, 0, 0.1, "bandpass", 2400, 1400, 4, 0.01, 0.2, 0.04); clack(c, o, 0.13, 1900, 0.6, 0.7); } },
    slide: { len: 0.35, f: function (c, o) { nz(c, o, 0, 0.07, "bandpass", 3000, 2000, 4, 0.005, 0.18, 0.025); clack(c, o, 0.09, 2300, 0.55, 0.5); } },
    shell: { len: 0.2, f: function (c, o) { nz(c, o, 0, 0.06, "bandpass", 1300, 900, 3, 0.005, 0.25, 0.02); clack(c, o, 0.04, 1100, 0.3, 0.8); } },
    pump: { len: 0.4, f: function (c, o) { clack(c, o, 0, 1500, 0.45, 0.8); clack(c, o, 0.14, 2100, 0.5, 0.6); } },
    tube: { len: 0.4, f: function (c, o) { nz(c, o, 0, 0.25, "bandpass", 900, 500, 2, 0.03, 0.2, 0.08); clack(c, o, 0.22, 900, 0.4, 1); } },
    dry: { len: 0.1, f: function (c, o) { clack(c, o, 0, 2600, 0.35, 0.2); } },
    switch: { len: 0.35, f: function (c, o) { nz(c, o, 0, 0.18, "bandpass", 1200, 700, 1, 0.03, 0.12, 0.05); clack(c, o, 0.16, 1600, 0.25, 0.5); } },
    step: { len: 0.15, f: function (c, o) { nz(c, o, 0, 0.08, "lowpass", 900 + Math.random() * 400, 300, 0.8, 0.002, 0.5, 0.018); nz(c, o, 0.01, 0.05, "bandpass", 3000, 0, 1, 0.003, 0.08, 0.012); } },
    land: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.15, "lowpass", 700, 200, 0.8, 0.002, 0.8, 0.04); } },
    jump: { len: 0.15, f: function (c, o) { nz(c, o, 0, 0.12, "bandpass", 1000, 600, 1, 0.01, 0.2, 0.03); } },
    hurt: { len: 0.3, f: function (c, o) { osc(c, o, 0, "sine", 120, 55, 0.2, 0.7, 0.06); nz(c, o, 0, 0.15, "lowpass", 600, 200, 0.7, 0.002, 0.5, 0.04); } },
    hit: { len: 0.08, f: function (c, o) { osc(c, o, 0, "triangle", 1700, 1500, 0.04, 0.12, 0.012); } },
    head: { len: 0.12, f: function (c, o) { osc(c, o, 0, "triangle", 2300, 2100, 0.05, 0.15, 0.015); osc(c, o, 0.04, "triangle", 2300, 2100, 0.04, 0.1, 0.012); } },
    kill: { len: 0.3, f: function (c, o) { osc(c, o, 0, "sine", 200, 90, 0.22, 0.3, 0.07); } },
    melee: { len: 0.3, f: function (c, o) { nz(c, o, 0, 0.18, "bandpass", 500, 1600, 1.2, 0.03, 0.3, 0.05); } },
    smack: { len: 0.25, f: function (c, o) { nz(c, o, 0, 0.1, "lowpass", 800, 250, 0.8, 0.001, 1, 0.025); osc(c, o, 0, "sine", 140, 70, 0.1, 0.6, 0.03); } },
    throw: { len: 0.4, f: function (c, o) { osc(c, o, 0, "sine", 2900, 0, 0.08, 0.12, 0.02); nz(c, o, 0.12, 0.25, "bandpass", 500, 1500, 1.2, 0.03, 0.25, 0.06); } },
    bounce: { len: 0.3, f: function (c, o) { const f = 2400 + Math.random() * 800; osc(c, o, 0, "sine", f, 0, 0.2, 0.25, 0.04); nz(c, o, 0, 0.04, "bandpass", 2000, 0, 2, 0.001, 0.3, 0.01); } },
    pickup: { len: 0.35, f: function (c, o) { nz(c, o, 0, 0.12, "bandpass", 1100, 700, 1, 0.02, 0.15, 0.04); clack(c, o, 0.1, 1700, 0.3, 0.5); } },
    capture: { len: 0.6, f: function (c, o) { osc(c, o, 0, "sine", 330, 0, 0.2, 0.18, 0.08); osc(c, o, 0.16, "sine", 495, 0, 0.35, 0.16, 0.12); } },
    lost: { len: 0.6, f: function (c, o) { osc(c, o, 0, "sine", 330, 0, 0.2, 0.16, 0.08); osc(c, o, 0.16, "sine", 247, 0, 0.35, 0.14, 0.12); } },
    tick: { len: 0.08, f: function (c, o) { osc(c, o, 0, "sine", 900, 0, 0.04, 0.08, 0.015); } },
    go: { len: 0.4, f: function (c, o) { osc(c, o, 0, "sine", 440, 0, 0.12, 0.14, 0.05); osc(c, o, 0.1, "sine", 660, 0, 0.2, 0.12, 0.08); } }
  };

  // Render every sound (a few variations each) into buffers, off the main mix.
  function render(len, fn) {
    const oc = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    fn(oc, oc.destination);
    return oc.startRendering();
  }
  function renderAll() {
    const jobs = [];
    // Loud sounds are normalised to a peak just under full scale.
    function add(name, n, len, fn, peak) {
      BUF[name] = [];
      for (let k = 0; k < n; k++) jobs.push(render(len, fn).then(function (b) {
        if (peak) {
          const d = b.getChannelData(0);
          let pk = 0;
          for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
          if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / pk;
        }
        BUF[name].push(b);
      }));
    }
    Object.keys(GUNS).forEach(function (k) { add(k, 4, GUNS[k].len, function (c, o) { gunshot(c, o, GUNS[k]); }, 0.95); });
    add("rpg", 2, 1.8, rpgLaunch, 0.95);
    add("boom", 3, 2.8, explosion, 0.98);
    Object.keys(MISC).forEach(function (k) { add(k, k === "step" || k.indexOf("imp_") === 0 ? 4 : 2, MISC[k].len, MISC[k].f); });
    Object.keys(ZOMBIE).forEach(function (k) { add(k, k === "groan" ? 5 : 3, ZOMBIE[k].len, ZOMBIE[k].f, 0.8); });
    return Promise.all(jobs).catch(function () { /* a browser without OfflineAudioContext: silence */ });
  }
  // sounds/sounds.json: { "rifle": ["rifle-1.wav", "rifle-2.wav"], "boom": [...], ... }
  function loadSamples() {
    fetch("sounds/sounds.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (map) {
      Object.keys(map || {}).forEach(function (name) {
        (Array.isArray(map[name]) ? map[name] : [map[name]]).forEach(function (file) {
          fetch("sounds/" + encodeURI(file)).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return ctx.decodeAudioData(ab); })
            .then(function (b) { (SAMPLES[name] = SAMPLES[name] || []).push(b); }).catch(function () { /* skip a bad file */ });
        });
      });
    }).catch(function () { /* no sounds folder: synthesized only */ });
  }
  function bufferFor(name) {
    const L = SAMPLES[name] && SAMPLES[name].length ? SAMPLES[name] : BUF[name];
    return L && L.length ? L[(Math.random() * L.length) | 0] : null;
  }

  // ------------------------------------------------------------------ playing
  // Play a sound at a world point (or, with x undefined, on you). opt: {vol,
  // far (how far it carries: gunfire 1, footsteps 0.3...), delay, rate, wet}.
  function emit(name, x, y, z, opt) {
    if (!ctx || !A.on || ctx.state !== "running") return;
    const b = bufferFor(name);
    if (!b) return;
    opt = opt || {};
    const vol = opt.vol === undefined ? 1 : opt.vol, far = opt.far || 0.5;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (opt.rate || 1) * (0.97 + Math.random() * 0.06);
    let d = 0, node = src, when = ctx.currentTime + (opt.delay || 0);
    const g = ctx.createGain();
    if (x === undefined) {
      g.gain.value = vol;
      node.connect(g); g.connect(sfx);
      if (opt.wet) { const s = ctx.createGain(); s.gain.value = opt.wet; g.connect(s); s.connect(verb); }
    } else {
      const dx = x - A.L.x, dy = y - A.L.y, dz = z - A.L.z;
      d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = 30 + far * 250;
      if (d > reach) return;
      // Loudness falls ~6 dB per doubling of distance; air takes the highs.
      // (Gunfire, far = 1, keeps half its level out to ~20 m: it carries.)
      g.gain.value = vol / (1 + d / (4 + far * 16));
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = Math.max(700, 19000 / (1 + d / 22)); lp.Q.value = 0.5;
      node.connect(lp); lp.connect(g);
      const rel = Math.atan2(dz, dx) - A.L.yaw;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, Math.sin(rel) * Math.min(1, d / 3) * 0.85));
        g.connect(p); p.connect(sfx);
      } else g.connect(sfx);
      const s = ctx.createGain();
      s.gain.value = (opt.wet === undefined ? 0.25 : opt.wet) + Math.min(0.7, d / 70) * far;
      g.connect(s); s.connect(verb);
      // Sound travels at 343 m/s: a distant shot is heard after its flash.
      if (opt.travel !== false) when += Math.min(0.7, d / SOUND_SPEED);
    }
    src.start(when);
  }
  A.emit = emit;
  // The simple form most callers use.
  A.play = function (name, x, y, z, vol) { emit(name, x, y, z, { vol: vol }); };

  // A gunshot. mine: you fired it (closer, drier, centred).
  const GUN_SND = ["pistol", "rifle", "shotgun", "marksman", "rpg", "throw"];
  A.gun = function (w, x, y, z, mine) {
    const name = GUN_SND[w] || "rifle";
    // Guns were drowning the soundtrack (2026-10-17): about 40% quieter than before.
    if (mine) emit(name, undefined, 0, 0, { vol: w === 5 ? 0.4 : 0.8, wet: 0.45 });
    else emit(name, x, y, z, { vol: w === 5 ? 0.35 : 1.2, far: w === 5 ? 0.2 : 1 });
  };
  // Reload foley, timed across the reload (fractions of its length).
  const RELOAD = {
    0: [[0.12, "magout"], [0.55, "magin"], [0.84, "slide"]],
    1: [[0.12, "magout"], [0.55, "magin"], [0.82, "bolt"]],
    2: [[0.1, "shell"], [0.3, "shell"], [0.5, "shell"], [0.7, "shell"], [0.9, "pump"]],
    3: [[0.14, "magout"], [0.58, "magin"], [0.85, "bolt"]],
    4: [[0.2, "tube"], [0.75, "magin"]]
  };
  A.reload = function (w, secs, x, y, z, mine) {
    (RELOAD[w] || []).forEach(function (s) {
      emit(s[1], mine ? undefined : x, y, z, { vol: mine ? 0.55 : 0.6, far: 0.15, delay: s[0] * secs, travel: false });
    });
  };
  // A round passing close: rifles crack (supersonic), pistols and buckshot whizz.
  A.flyby = function (w, x, y, z, miss) {
    const sup = w === 1 || w === 3;
    emit(sup ? "flyby_crack" : "flyby_whiz", x, y, z, { vol: (sup ? 1.1 : 0.7) * Math.max(0.3, 1 - miss / 3), far: 0.1, travel: false, wet: 0.15 });
  };

  // ------------------------------------------------------------------ the city around you
  // Distant traffic, wind between the buildings, a siren now and then, and
  // somebody else's war a few blocks over.
  function ambience() {
    const rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuf; rumble.loop = true; rumble.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 160;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    rumble.connect(lp); lp.connect(g); g.connect(sfx);
    rumble.start(); lfo.start();
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf; wind.loop = true; wind.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 450; bp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.012;
    wind.connect(bp); bp.connect(wg); wg.connect(sfx);
    wind.start();
    function siren() {
      if (A.on && ctx.state === "running") {
        const o = ctx.createOscillator(), t = ctx.currentTime;
        o.type = "sine";
        for (let k = 0; k < 6; k++) { o.frequency.setValueAtTime(650, t + k * 1.3); o.frequency.linearRampToValueAtTime(980, t + k * 1.3 + 0.65); o.frequency.linearRampToValueAtTime(650, t + k * 1.3 + 1.3); }
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400;
        const sg = envGain(ctx, verb, t, 2, 0.02, 2.5);
        o.connect(f); f.connect(sg);
        o.start(t); o.stop(t + 8);
      }
      setTimeout(siren, 45000 + Math.random() * 60000);
    }
    function distantFight() {
      if (A.on && ctx.state === "running" && BUF.rifle && BUF.rifle.length) {
        const a = Math.random() * Math.PI * 2, n = 3 + (Math.random() * 7 | 0), auto = Math.random() < 0.6;
        for (let k = 0; k < n; k++) emit(Math.random() < 0.85 ? "rifle" : "pistol", A.L.x + Math.cos(a) * 240, 0, A.L.z + Math.sin(a) * 240,
          { vol: 0.9, far: 1, delay: k * (auto ? 0.1 : 0.3 + Math.random() * 0.5), travel: false, wet: 0.9 });
      }
      setTimeout(distantFight, 12000 + Math.random() * 30000);
    }
    setTimeout(siren, 20000);
    setTimeout(distantFight, 8000);
  }

  // ------------------------------------------------------------------ music
  // music/tracks.json: { "menu": [...], "match": [...], "results": [...] }. The
  // same list is built in below, because a double-clicked (file://) page can't
  // fetch the json but can still play the files.
  const DEFAULT_TRACKS = { menu: ["Cold_Pavement.mp3"], match: ["Rain_Over_Concrete.mp3", "Lava_and_Concrete.mp3", "Cold_Pavement.mp3"], results: ["Rain_Over_Concrete.mp3"] };
  let tracks = null, mEl = null, mTrack = null, mList = null, mIdx = 0, mTimer = 0, ducked = false, direct = false, bad = {};
  const DUCK = 0.35;
  function musicLevel() { return A.musicVol * 1.15 * (ducked ? DUCK : 1); }
  function musicTo(v, tau) {
    if (!mEl) return;
    if (direct) { mEl.volume = A.on ? Math.min(1, v) : 0; return; }
    music.gain.cancelScheduledValues(ctx.currentTime);
    music.gain.setTargetAtTime(v, ctx.currentTime, tau);
  }
  A.loadTracks = function () {
    return fetch("music/tracks.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { tracks = j && typeof j === "object" ? j : DEFAULT_TRACKS; }, function () { tracks = DEFAULT_TRACKS; });
  };
  function musicInit() {
    mEl = document.createElement("audio");
    mEl.preload = "auto";
    mEl.loop = false;
    // file:// pages can't route an <audio> through Web Audio (it plays silent),
    // so there the element's own volume does the levels.
    direct = location.protocol === "file:";
    if (!direct) { try { ctx.createMediaElementSource(mEl).connect(music); } catch (e) { direct = true; } }
    mEl.addEventListener("ended", function () { nextTrack(); });
    mEl.addEventListener("error", function () { if (mTrack) bad[mTrack] = true; nextTrack(); });
    if (A.want) A.song(A.want);
  }
  function listFor(which) {
    const L = (tracks || DEFAULT_TRACKS)[which];
    return Array.isArray(L) ? L.filter(function (f) { return typeof f === "string" && !bad[f]; }) : [];
  }
  function startTrack(file) {
    mTrack = file;
    mEl.src = "music/" + encodeURI(file);
    const p = mEl.play(); if (p && p.catch) p.catch(function () {});
    musicTo(musicLevel(), 0.3);
  }
  function nextTrack() {
    if (!mList) return;
    const L = listFor(mList);
    if (!L.length) { mTrack = null; return; }
    mIdx = (mIdx + 1) % L.length;
    startTrack(L[mIdx]);
  }
  // which: "menu" | "match" | "results" | null (fade out). Crossfades through silence.
  A.song = function (which) {
    A.want = which;
    if (!ctx || !mEl) return;
    if (which === mList && mTrack && !mEl.paused) return;
    mList = which;
    clearTimeout(mTimer);
    const L = which ? listFor(which) : [];
    mIdx = which === "match" ? Math.floor(Math.random() * Math.max(1, L.length)) : 0;
    const go = function () { if (L.length) startTrack(L[mIdx % L.length]); else { mTrack = null; mEl.pause(); } };
    if (mEl.paused || !mTrack) { go(); return; }
    musicTo(0, 0.25);
    mTimer = setTimeout(go, 800);
  };
  // Settings open: the song drops under, it doesn't cut.
  A.duck = function (on) { ducked = on; if (mTrack) musicTo(musicLevel(), 0.15); };
  A.songState = function () {
    return mEl ? { list: mList, track: mTrack, t: +mEl.currentTime.toFixed(1), paused: mEl.paused, gain: +(direct ? mEl.volume : music.gain.value).toFixed(2), direct: direct, bad: Object.keys(bad) } : null;
  };
  A.ready = function () { return Object.keys(BUF).length > 0 && BUF.rifle && BUF.rifle.length > 0; };
  // For checks: each rendered sound's length (s), peak level and RMS.
  A.stats = function () {
    const out = {};
    Object.keys(BUF).forEach(function (k) {
      const b = BUF[k][0];
      if (!b) return;
      const d = b.getChannelData(0);
      let pk = 0, ss = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; ss += d[i] * d[i]; }
      out[k] = [+b.duration.toFixed(2), +pk.toFixed(2), +Math.sqrt(ss / d.length).toFixed(3), BUF[k].length];
    });
    return out;
  };
  document.addEventListener("visibilitychange", function () {
    if (!mEl || !mTrack) return;
    if (document.hidden) mEl.pause();
    else { const p = mEl.play(); if (p && p.catch) p.catch(function () {}); }
  });

  SP.Audio = A;
})(globalThis.SP);
