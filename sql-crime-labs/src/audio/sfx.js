// Crime-lab sound effects, all synthesized with Web Audio (no files): a quiet server-room bed, keyboard ticks, query and
// result sounds, the hologram whoosh. Subtle on purpose; the music slot stays the user's own tracks.
//   sfx.unlock()            // call from a user gesture (creates / resumes the AudioContext)
//   sfx.scene("lab"|"term"|"holo")   // switches the ambience
//   sfx.key() sfx.run() sfx.ok() sfx.bad() sfx.err() sfx.holo() sfx.phone() sfx.ui() sfx.pick() sfx.chair() sfx.text()
let ctx = null;
let master = null;
let bed = null;           // { gain, lp, pad } the looping ambience
let timer = 0;
let mode = "off";
let muted = false;
try { muted = localStorage.getItem("sqlquest.sfx") === "0"; } catch (e) { /* ignore */ }

const rnd = (a, b) => a + Math.random() * (b - a);

function make() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  return true;
}

function noiseBuf(sec = 2) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// one enveloped oscillator
function tone(freq, t0, dur, { type = "sine", vol = 0.1, to = null, attack = 0.005, dest = null } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest || master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
// a burst of filtered noise
function puff(t0, dur, { vol = 0.1, freq = 2000, q = 1, type = "bandpass", to = null } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf(Math.max(0.2, dur + 0.05));
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t0); s.stop(t0 + dur + 0.05);
}

function startBed() {
  if (bed) return;
  const gain = ctx.createGain(); gain.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(3); src.loop = true;
  src.connect(lp); lp.connect(gain);
  // mains hum
  const h1 = ctx.createOscillator(), h2 = ctx.createOscillator(), hg = ctx.createGain();
  h1.frequency.value = 60; h2.frequency.value = 120; hg.gain.value = 0.35;
  h1.connect(hg); h2.connect(hg); hg.connect(gain);
  // the holo pad: two detuned fifths with a slow tremolo (only audible in "holo")
  const pad = ctx.createGain(); pad.gain.value = 0;
  const p1 = ctx.createOscillator(), p2 = ctx.createOscillator(), p3 = ctx.createOscillator();
  p1.frequency.value = 110; p2.frequency.value = 165.6; p3.frequency.value = 220.4;
  [p1, p2, p3].forEach((p) => { p.type = "sine"; p.connect(pad); });
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.18; lg.gain.value = 0.35; lfo.connect(lg); lg.connect(pad.gain);
  pad.connect(master);
  gain.connect(master);
  [src, h1, h2, p1, p2, p3, lfo].forEach((n) => n.start());
  bed = { gain, lp, pad };
}

function ping() {   // a distant console / server blip in the lab
  if (!ctx || muted || mode !== "lab") return;
  const t = ctx.currentTime, f = rnd(1500, 2800);
  tone(f, t, 0.09, { vol: 0.012, type: "sine" });
  if (Math.random() < 0.45) tone(f * 1.25, t + 0.11, 0.09, { vol: 0.01 });
}
function tick() {
  clearTimeout(timer);
  timer = setTimeout(() => { ping(); tick(); }, rnd(3500, 9000));
}

export const sfx = {
  get muted() { return muted; },
  setMuted(v) {
    muted = !!v;
    try { localStorage.setItem("sqlquest.sfx", muted ? "0" : "1"); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  },
  unlock() {
    try {
      if (!ctx && !make()) return;
      if (ctx.state === "suspended") ctx.resume();
      startBed();
    } catch (e) { /* no audio, no sound */ }
  },
  // ambience per place: the lab floor, zoomed into the terminal (fan only), the hologram room (pad)
  scene(m) {
    mode = m;
    if (!ctx || !bed) return;
    const t = ctx.currentTime;
    const lab = { gain: 0.05, lp: 420, pad: 0 }, term = { gain: 0.022, lp: 260, pad: 0 }, holo = { gain: 0.012, lp: 200, pad: 0.016 };
    const s = m === "term" ? term : m === "holo" ? holo : lab;
    bed.gain.gain.setTargetAtTime(s.gain, t, 0.4);
    bed.lp.frequency.setTargetAtTime(s.lp, t, 0.4);
    bed.pad.gain.setTargetAtTime(s.pad, t, 0.8);
    if (m === "lab") tick(); else clearTimeout(timer);
  },
  off() { mode = "off"; clearTimeout(timer); if (bed && ctx) { bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); bed.pad.gain.setTargetAtTime(0, ctx.currentTime, 0.2); } },

  // a keyboard tick: a short click plus a soft low thock, a little different each time
  key(k) {
    if (!ctx || muted) return;
    const t = ctx.currentTime, big = k === "Enter" || k === " " || k === "Backspace";
    puff(t, 0.03, { vol: big ? 0.075 : 0.055, freq: rnd(2600, 4200), q: 2.5 });
    tone(rnd(150, 210) * (big ? 0.8 : 1), t, 0.05, { type: "triangle", vol: big ? 0.05 : 0.035 });
  },
  // Run pressed: the database chewing, a quick rising run of chirps
  run() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 7; i++) tone(520 + i * 95 + rnd(-20, 20), t + i * 0.06, 0.05, { type: "square", vol: 0.018 });
    puff(t, 0.4, { vol: 0.025, freq: 700, q: 1.5, to: 2600 });
  },
  // a correct answer: a clean two-note confirm
  ok() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    tone(660, t, 0.18, { vol: 0.07 }); tone(880, t + 0.12, 0.22, { vol: 0.07 }); tone(1320, t + 0.26, 0.5, { vol: 0.05 });
  },
  // right query, wrong rows: a low double thud-buzz
  bad() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    tone(150, t, 0.22, { type: "sawtooth", vol: 0.05, to: 110 }); tone(150, t + 0.26, 0.3, { type: "sawtooth", vol: 0.05, to: 95 });
  },
  // SQL error: a short sharp denied blip
  err() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    tone(300, t, 0.09, { type: "square", vol: 0.045 }); tone(230, t + 0.11, 0.14, { type: "square", vol: 0.045 });
  },
  // the screen pulling back into the hologram (and back again): a rising / falling sweep
  holo(up = true) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    puff(t, 1.1, { vol: 0.07, freq: up ? 300 : 3000, q: 1.2, to: up ? 3200 : 260 });
    tone(up ? 180 : 700, t, 1.0, { type: "sine", vol: 0.05, to: up ? 700 : 180, attack: 0.2 });
    if (up) { tone(1760, t + 0.9, 0.5, { vol: 0.03 }); tone(2640, t + 1.0, 0.45, { vol: 0.02 }); }
  },
  // Marcus's phone (the lab's alert): same pattern as before, through the shared context
  phone() {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    [0, 0.17, 0.5, 0.67].forEach((d) => tone(1240, t + d, 0.11, { type: "square", vol: 0.05 }));
  },
  text() { if (!ctx || muted) return; const t = ctx.currentTime; tone(1500, t, 0.07, { vol: 0.04 }); tone(1900, t + 0.08, 0.1, { vol: 0.04 }); },
  ui() { if (!ctx || muted) return; const t = ctx.currentTime; tone(1100, t, 0.04, { type: "triangle", vol: 0.035 }); },
  pick() { if (!ctx || muted) return; const t = ctx.currentTime; tone(520, t, 0.08, { type: "triangle", vol: 0.05 }); tone(780, t + 0.06, 0.12, { type: "triangle", vol: 0.05 }); },
  // sitting down / standing up: a soft chair-and-cushion thump
  chair() { if (!ctx || muted) return; const t = ctx.currentTime; puff(t, 0.3, { vol: 0.06, freq: 260, q: 0.8, type: "lowpass" }); tone(95, t, 0.18, { vol: 0.05, to: 60 }); }
};
