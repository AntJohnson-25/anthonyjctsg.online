// Synthesized sound (Web Audio only, no files): whooshes, stabs, knife
// impacts by surface, pickups, splashes, footsteps, the sea. World sounds are
// panned and attenuated relative to the listener.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const A = { on: true, ctx: null, L: { x: 0, y: 0, z: 0, yaw: 0 } };
  let ctx = null, master = null, noiseBuf = null, amb = null;

  A.unlock = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = A.ctx = new AC();
        master = ctx.createGain();
        master.gain.value = A.on ? 0.8 : 0;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        ambience();
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) { /* no audio */ }
  };
  A.setOn = function (on) {
    A.on = on;
    if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
  };
  A.setListener = function (x, y, z, yaw) { A.L.x = x; A.L.y = y; A.L.z = z; A.L.yaw = yaw; };

  function out(x, y, z, vol) {
    // Returns a node to connect a voice into, or null if too far to hear.
    const g = ctx.createGain();
    if (x === undefined) { g.gain.value = vol; g.connect(master); return g; }
    const dx = x - A.L.x, dy = y - A.L.y, dz = z - A.L.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 60) return null;
    g.gain.value = vol / (1 + d * d * 0.012);
    const rel = Math.atan2(dz, dx) - A.L.yaw;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, Math.sin(rel) * Math.min(1, d / 3) * 0.85));
      g.connect(p); p.connect(master);
    } else g.connect(master);
    return g;
  }
  function noise(dest, t, dur, type, f0, f1, q) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f); f.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  function env(dest, t, a, h, r, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    g.connect(dest);
    return g;
  }
  function tone(dest, t, type, f0, f1, dur, peak) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = env(dest, t, 0.005, 0, dur, peak);
    o.connect(e);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const SFX = {
    whoosh: function (d, t) { noise(env(d, t, 0.03, 0.04, 0.16, 0.9), t, 0.25, "bandpass", 500, 2600, 1.4); },
    throw: function (d, t) {
      noise(env(d, t, 0.02, 0.03, 0.12, 0.9), t, 0.2, "bandpass", 900, 3600, 2);
      tone(d, t, "triangle", 2400, 1800, 0.05, 0.08);
    },
    lunge: function (d, t) { noise(env(d, t, 0.01, 0.05, 0.12, 1.0), t, 0.2, "bandpass", 300, 1800, 1); },
    stab: function (d, t) {
      tone(d, t, "sine", 160, 55, 0.16, 0.9);
      noise(env(d, t, 0.002, 0.02, 0.1, 0.9), t, 0.14, "lowpass", 1400, 300, 0.7);
    },
    metal: function (d, t) {
      tone(d, t, "triangle", 2100 + Math.random() * 400, 1600, 0.22, 0.25);
      tone(d, t, "sine", 3300, 3000, 0.15, 0.12);
      noise(env(d, t, 0.001, 0, 0.05, 0.6), t, 0.06, "highpass", 2500, 0, 0.7);
    },
    wood: function (d, t) {
      tone(d, t, "sine", 260, 140, 0.1, 0.6);
      noise(env(d, t, 0.001, 0, 0.07, 0.8), t, 0.08, "bandpass", 700, 400, 1.2);
    },
    glass: function (d, t) {
      tone(d, t, "sine", 3800, 3600, 0.18, 0.18);
      noise(env(d, t, 0.001, 0, 0.08, 0.5), t, 0.1, "highpass", 3000, 0, 1);
    },
    soft: function (d, t) { noise(env(d, t, 0.002, 0, 0.08, 0.7), t, 0.1, "lowpass", 600, 200, 0.7); },
    clatter: function (d, t) { for (let i = 0; i < 3; i++) tone(d, t + i * 0.07, "triangle", 2600 - i * 300, 2000, 0.06, 0.12 / (i + 1)); },
    pickup: function (d, t) { tone(d, t, "square", 880, 0, 0.05, 0.06); tone(d, t + 0.06, "square", 1320, 0, 0.08, 0.06); noise(env(d, t, 0.001, 0, 0.04, 0.3), t, 0.05, "highpass", 4000); },
    splash: function (d, t) { noise(env(d, t, 0.01, 0.05, 0.5, 0.8), t, 0.6, "lowpass", 2400, 300, 0.7); },
    step: function (d, t) { noise(env(d, t, 0.002, 0, 0.06, 0.5), t, 0.07, "lowpass", 900, 300, 0.8); },
    land: function (d, t) { tone(d, t, "sine", 90, 50, 0.12, 0.5); noise(env(d, t, 0.002, 0, 0.08, 0.5), t, 0.1, "lowpass", 700, 200); },
    jump: function (d, t) { noise(env(d, t, 0.005, 0, 0.06, 0.25), t, 0.07, "lowpass", 800, 400); },
    kill: function (d, t) { tone(d, t, "sine", 1180, 0, 0.12, 0.25); tone(d, t + 0.07, "sine", 1760, 0, 0.18, 0.2); },
    hit: function (d, t) { tone(d, t, "square", 2600, 2200, 0.04, 0.08); },
    dry: function (d, t) { tone(d, t, "square", 300, 200, 0.04, 0.08); },
    death: function (d, t) { tone(d, t, "sawtooth", 220, 70, 0.6, 0.12); noise(env(d, t, 0.01, 0.1, 0.4, 0.3), t, 0.5, "lowpass", 600, 100); },
    // Rogue Wave: a swell that builds under the horn, then the crash.
    swell: function (d, t) { noise(env(d, t, 1.4, 0.1, 0.3, 0.55), t, 1.9, "lowpass", 180, 900, 0.8); },
    crash: function (d, t) {
      noise(env(d, t, 0.01, 0.25, 1.6, 1.0), t, 2.0, "lowpass", 2600, 300, 0.6);
      noise(env(d, t, 0.005, 0.05, 0.5, 0.6), t, 0.6, "highpass", 1800, 0, 0.7);
      tone(d, t, "sine", 70, 34, 0.9, 0.7);
    },
    // The death cut: a deep boom with a low rumble tail.
    wasted: function (d, t) {
      tone(d, t, "sine", 95, 32, 1.4, 0.9);
      tone(d, t, "triangle", 190, 60, 0.5, 0.25);
      noise(env(d, t, 0.004, 0.08, 1.1, 0.7), t, 1.3, "lowpass", 900, 120, 0.7);
    },
    medal: function (d, t) { [660, 880, 1320].forEach(function (f, i) { tone(d, t + i * 0.06, "triangle", f, 0, 0.16, 0.12); }); },
    horn: function (d, t) {
      [110, 165, 220].forEach(function (f) {
        const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        o.connect(lp); lp.connect(env(d, t, 0.06, 0.6, 0.5, 0.12));
        o.start(t); o.stop(t + 1.3);
      });
    },
    tick: function (d, t) { tone(d, t, "sine", 900, 0, 0.06, 0.12); }
  };

  // Play a sound; pass x,y,z for a world sound (panned + attenuated).
  A.play = function (name, x, y, z, vol) {
    if (!ctx || !A.on || ctx.state !== "running") return;
    const f = SFX[name];
    if (!f) return;
    const d = out(x, y, z, vol === undefined ? 1 : vol);
    if (d) f(d, ctx.currentTime + 0.005);
  };

  function ambience() {
    // The sea: low rolling noise with a slow swell, plus a little wind.
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.11;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.06;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(lp); lp.connect(g); g.connect(master);
    s.start(); lfo.start();
    const w = ctx.createBufferSource();
    w.buffer = noiseBuf; w.loop = true; w.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.025;
    w.connect(bp); bp.connect(wg); wg.connect(master);
    w.start();
    amb = { g: g };
  }

  HK.Audio = A;
})(globalThis.HK);
