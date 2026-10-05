// Synth sounds, no files: paddle pops, bounces, the net, point chimes.
// The context starts on the first touch or click (browsers require it).
let ctx = null, out = null, noise = null, muted = false;

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = muted ? 0 : 0.8;
      out.connect(ctx.destination);
      const n = ctx.sampleRate * 0.5;
      noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { ctx = null; }
}

export function setMuted(m) {
  muted = m;
  if (out) out.gain.value = m ? 0 : 0.8;
}
export const isMuted = () => muted;

function dest(pan) {
  if (!pan || !ctx.createStereoPanner) return out;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

function tone(type, f0, f1, dur, vol, pan, at = 0) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest(pan));
  o.start(t); o.stop(t + dur + 0.02);
}

function hiss(filter, freq, q, dur, vol, pan, at = 0) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise;
  f.type = filter; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest(pan));
  s.start(t, Math.random() * 0.3); s.stop(t + dur + 0.02);
}

const ready = () => ctx && !muted;

// The hollow "pock" of a paddle on a holed ball. power 0..1.
export function pop(power = 0.5, pan = 0, far = false) {
  if (!ready()) return;
  const v = (far ? 0.35 : 0.7) * (0.6 + power * 0.5);
  hiss("bandpass", 1500 + power * 900, 3, 0.035, v, pan);
  tone("sine", 700 + power * 200, 380, 0.08, v * 0.8, pan);
}

export function bounce(hard = 3, pan = 0) {
  if (!ready()) return;
  const v = Math.min(0.5, 0.12 + hard * 0.05);
  tone("sine", 260, 110, 0.06, v, pan);
  hiss("lowpass", 900, 1, 0.04, v * 0.6, pan);
}

export function net() {
  if (!ready()) return;
  hiss("lowpass", 500, 1, 0.16, 0.5, 0);
  tone("triangle", 140, 80, 0.12, 0.25, 0);
}

export function chime(good) {
  if (!ready()) return;
  const notes = good ? [523, 659, 784] : [392, 311];
  notes.forEach((f, i) => tone("triangle", f, f * 0.995, 0.22, 0.22, 0, i * 0.09));
  if (good) hiss("bandpass", 1200, 0.6, 0.8, 0.06, 0, 0.05);   // a small crowd "ooh"
}

export function perfect() {
  if (!ready()) return;
  tone("sine", 1568, 1560, 0.12, 0.12, 0, 0.02);
  tone("sine", 2093, 2090, 0.16, 0.1, 0, 0.07);
}

export function whistle() {
  if (!ready()) return;
  tone("square", 1750, 1700, 0.09, 0.05, 0);
  tone("square", 1750, 1700, 0.18, 0.05, 0, 0.12);
}

export function win(good) {
  if (!ready()) return;
  const notes = good ? [523, 659, 784, 1047] : [440, 392, 349, 262];
  notes.forEach((f, i) => tone("triangle", f, f, 0.3, 0.22, 0, i * 0.14));
  if (good) hiss("bandpass", 1000, 0.5, 1.6, 0.1, 0, 0.1);
}
