// Web Audio: the ride beds (skate wheels whirring on concrete, tyres crunching dirt, a dirt bike's
// two-stroke engine that follows the throttle, and wind), plus a handful of dry impacts: punches,
// kicks, landings, wipeouts, splashes, the countdown. Deliberately few sounds: the music carries it.
// Music: the user's own tracks, soundtrack/menu.mp3, skate.mp3, mtb.mp3, moto.mp3. A missing track
// simply plays nothing (there is no stand-in music).
(function (RR) {
  "use strict";
  const A = RR.Audio = { on: true, ready: false, want: "menu" };
  let ctx, master, sfx, music, noiseBuf, roll, dirt, wind, eng;

  function noise(sec) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  function bed(type, f, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(fl); fl.connect(g); g.connect(sfx); s.start(0, Math.random() * 2);
    return { g: g, f: fl };
  }
  function engine() {
    // two detuned saws through a soft clipper and a low-pass: a buzzy four-stroke thump
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
    o1.type = "sawtooth"; o2.type = "sawtooth"; sub.type = "square";
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.4); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const subG = ctx.createGain(); subG.gain.value = 0.5;
    o1.connect(shaper); o2.connect(shaper); sub.connect(subG); subG.connect(shaper);
    shaper.connect(lp); lp.connect(g); g.connect(sfx);
    o1.start(); o2.start(); sub.start();
    return { o1: o1, o2: o2, sub: sub, lp: lp, g: g };
  }
  A.init = function () {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = A.on ? 0.9 : 0; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
    sfx = ctx.createGain(); sfx.gain.value = 0.85; sfx.connect(comp);
    music = ctx.createGain(); music.gain.value = 0; music.connect(master);
    noiseBuf = noise(3);
    roll = bed("bandpass", 2600, 1.2);
    dirt = bed("lowpass", 900, 0.6);
    wind = bed("bandpass", 600, 0.5);
    eng = engine();
    mEl = new Audio(); mEl.loop = true; mEl.preload = "auto";
    direct = location.protocol === "file:" && !RR.trackURL;
    if (!direct) ctx.createMediaElementSource(mEl).connect(music);
    mEl.addEventListener("error", function () { mTrack = null; });
    A.ready = true;
    if (A.want) A.song(A.want);
  };
  A.setOn = function (on) {
    A.on = on;
    if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
    if (direct && mTrack) mEl.volume = on ? musicLevel() : 0;
  };

  // per frame: sport, speed 0..1, throttle/effort 0..1, airborne
  A.ride = function (sport, speed, load, air) {
    if (!A.ready) return;
    const t = ctx.currentTime, on = sport ? 1 : 0;
    const sk = sport === "skate" ? 1 : 0, mb = sport === "mtb" ? 1 : 0, mx = sport === "moto" ? 1 : 0;
    roll.g.gain.setTargetAtTime(on * (air ? 0 : sk * (0.03 + speed * 0.12)), t, 0.06);
    roll.f.frequency.setTargetAtTime(1800 + speed * 1800, t, 0.1);
    dirt.g.gain.setTargetAtTime(on * (air ? 0 : (mb + mx * 0.6) * (0.04 + speed * 0.22)), t, 0.06);
    dirt.f.frequency.setTargetAtTime(500 + speed * 900, t, 0.1);
    wind.g.gain.setTargetAtTime(on * (0.01 + speed * 0.1 + (air ? 0.08 : 0)), t, 0.2);
    wind.f.frequency.setTargetAtTime(400 + speed * 900, t, 0.3);
    // the engine: revs with speed and throttle, screams when the back wheel's in the air
    const rpm = Math.min(1, speed * 0.85 + load * 0.25 + (air ? 0.2 : 0));
    const f = 42 + rpm * 120;
    eng.o1.frequency.setTargetAtTime(f, t, 0.05); eng.o2.frequency.setTargetAtTime(f * 1.012, t, 0.05); eng.sub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    eng.lp.frequency.setTargetAtTime(380 + rpm * 1500 + load * 400, t, 0.06);
    eng.g.gain.setTargetAtTime(on * mx * (0.05 + 0.07 * load + 0.04 * rpm), t, 0.05);
  };

  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function nz(t, dur, type, f0, f1, peak, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q || 1; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
    s.connect(fl); fl.connect(g); g.connect(sfx); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  function tone(t, type, f0, f1, dur, peak) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, 0.006, peak, dur);
    o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  // vol 0..1 for distance falloff
  A.play = function (name, vol) {
    if (!A.ready) return;
    const t = ctx.currentTime, v = vol === undefined ? 1 : vol;
    if (v < 0.03) return;
    switch (name) {
      case "punch": tone(t, "sine", 120, 45, 0.16, 0.6 * v); nz(t, 0.07, "lowpass", 2400, 300, 0.5 * v, 0.7); break;
      case "kick": tone(t, "sine", 95, 40, 0.2, 0.6 * v); nz(t, 0.09, "lowpass", 1800, 250, 0.45 * v, 0.7); break;
      case "whiff": nz(t, 0.16, "bandpass", 700, 1600, 0.12 * v, 1.4); break;
      case "slam": tone(t, "sine", 80, 35, 0.3, 0.6 * v); nz(t, 0.35, "lowpass", 1800, 200, 0.55 * v, 0.6); break;
      case "land": nz(t, 0.18, "lowpass", 1400, 260, 0.35 * v, 0.7); tone(t, "sine", 70, 40, 0.12, 0.25 * v); break;
      case "jump": nz(t, 0.14, "bandpass", 800, 1800, 0.12 * v, 1.0); break;
      case "bump": tone(t, "sine", 90, 50, 0.15, 0.45 * v); break;
      case "splash": nz(t, 0.5, "bandpass", 1600, 600, 0.45 * v, 0.8); break;
      case "boost": nz(t, 0.6, "bandpass", 300, 1400, 0.25 * v, 1.2); break;
      case "beep": tone(t, "sine", 660, 0, 0.16, 0.14 * v); break;
      case "go": tone(t, "sine", 990, 0, 0.45, 0.16 * v); break;
      case "tick": tone(t, "sine", 1400, 0, 0.03, 0.04 * v); break;
      case "fin": tone(t, "sine", 784, 0, 0.5, 0.12 * v); tone(t + 0.12, "sine", 1046, 0, 0.6, 0.12 * v); break;
    }
  };

  // ---------------- music: the user's tracks ----------------
  const TRACKS = { menu: "soundtrack/menu.mp3", skate: "soundtrack/skate.mp3", mtb: "soundtrack/mtb.mp3", moto: "soundtrack/moto.mp3" };
  const MUSIC_VOL = 0.45, DUCK = 0.3;
  let mEl, mTrack = null, mTimer = 0, ducked = false, direct = false;
  function musicLevel() { return MUSIC_VOL * (ducked ? DUCK : 1); }
  function musicTo(v, tau) {
    if (direct) { mEl.volume = A.on ? v : 0; return; }
    music.gain.cancelScheduledValues(ctx.currentTime);
    music.gain.setTargetAtTime(v, ctx.currentTime, tau);
  }
  // which: "menu" | "skate" | "mtb" | "moto" | null (fade out)
  A.song = function (which) {
    A.want = which;
    if (!A.ready) return;
    const key = which && TRACKS[which] ? which : null;
    if (key === mTrack) return;
    const prev = mTrack;
    mTrack = key;
    clearTimeout(mTimer);
    const begin = function () {
      if (!key) return;
      if (RR.trackURL && !RR.hasTrack(key)) return;
      mEl.src = RR.trackURL ? RR.trackURL(key, TRACKS[key]) : TRACKS[key];
      const p = mEl.play(); if (p && p.catch) p.catch(function () {});
      musicTo(musicLevel(), 0.3);
    };
    if (!prev) { begin(); return; }
    musicTo(0, 0.25);
    mTimer = setTimeout(function () { mEl.pause(); begin(); }, 700);
  };
  A.songState = function () { return mEl ? { track: mTrack, gain: +music.gain.value.toFixed(2), paused: mEl.paused } : null; };
  A.duck = function (on) {
    ducked = on;
    if (A.ready && mTrack) musicTo(musicLevel(), 0.15);
  };
  document.addEventListener("visibilitychange", function () {
    if (!A.ready) return;
    if (document.hidden) { mEl.pause(); ctx.suspend(); }
    else { ctx.resume(); if (mTrack) { const p = mEl.play(); if (p && p.catch) p.catch(function () {}); } }
  });
})(window.RR = window.RR || {});
