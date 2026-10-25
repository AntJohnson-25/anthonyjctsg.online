// Turkey Bowl 3D — sound, all synthesized with Web Audio (no files to load).
// Started from a user gesture (the team pick), which satisfies iOS Safari.
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master = null;
  let enabled = true;
  let ambience = null;
  let birdT = 0;

  function context() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, vol, type, endFreq, delay) {
    const ac = context();
    if (!ac || !enabled) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, filterType, freq, q, delay, attack) {
    const ac = context();
    if (!ac || !enabled) return;
    const t0 = ac.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = filterType || "lowpass";
    f.frequency.value = freq || 1200;
    f.Q.value = q || 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  // A crowd of a dozen relatives: layered band-passed noise with a swell.
  function cheer(vol, dur) {
    const ac = context();
    if (!ac || !enabled) return;
    [520, 900, 1500, 2400].forEach(function (f, i) {
      noise(dur, vol * (1 - i * 0.18), "bandpass", f, 1.2, i * 0.02, 0.25);
    });
    // A few whoops.
    for (let i = 0; i < 4; i++) {
      const f = 500 + Math.random() * 400;
      tone(f, 0.35, vol * 0.25, "triangle", f * 1.6, 0.2 + Math.random() * 1.2);
    }
  }

  function startAmbience() {
    const ac = context();
    if (!ac || !enabled || ambience) return;
    const buf = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      prev = prev * 0.985 + (Math.random() * 2 - 1) * 0.03;
      d[i] = prev;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 420;
    f.Q.value = 0.4;
    const g = ac.createGain();
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(master);
    src.start();
    ambience = { src: src, gain: g };
  }

  function stopAmbience() {
    if (!ambience) return;
    try { ambience.src.stop(); } catch (_) { /* already stopped */ }
    ambience = null;
  }

  function cue(name, arg) {
    if (!enabled || !context()) return;
    switch (name) {
      case "hut":
        // Two short barked beats — a voice-ish formant on a buzz.
        [0, 0.28].forEach(function (d) {
          tone(150, 0.12, 0.08, "sawtooth", 120, d);
          noise(0.1, 0.05, "bandpass", 700, 3, d);
        });
        break;
      case "snap":
        tone(110, 0.07, 0.07, "triangle", 70);
        noise(0.05, 0.05, "lowpass", 900);
        break;
      case "throw":
        noise(0.28, 0.06, "bandpass", 1800, 2, 0.08, 0.08);
        break;
      case "catch":
        tone(180, 0.08, 0.12, "sine", 90);
        noise(0.06, 0.08, "lowpass", 1400);
        break;
      case "hit":
        tone(75, 0.22, 0.28, "sine", 38);
        noise(0.18, 0.2, "lowpass", 700);
        break;
      case "thud":
        tone(90, 0.12, 0.12, "sine", 55);
        noise(0.08, 0.07, "lowpass", 600);
        break;
      case "whistle": {
        const ac = context();
        const t0 = ac.currentTime;
        const o = ac.createOscillator();
        const lfo = ac.createOscillator();
        const lg = ac.createGain();
        const g = ac.createGain();
        o.frequency.value = 2900;
        lfo.frequency.value = 38;
        lg.gain.value = 120;
        lfo.connect(lg).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
        g.gain.setValueAtTime(0.06, t0 + 0.32);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
        o.connect(g).connect(master);
        o.start(t0); lfo.start(t0);
        o.stop(t0 + 0.45); lfo.stop(t0 + 0.45);
        break;
      }
      case "juke":
        noise(0.12, 0.05, "highpass", 2500, 0.7);
        break;
      case "firstdown":
        tone(660, 0.12, 0.05, "triangle");
        tone(880, 0.18, 0.05, "triangle", null, 0.1);
        break;
      case "touchdown":
        cheer(0.16, 2.6);
        tone(392, 0.4, 0.06, "triangle", null, 0.05);
        tone(494, 0.4, 0.06, "triangle", null, 0.2);
        tone(587, 0.4, 0.06, "triangle", null, 0.35);
        tone(784, 0.9, 0.07, "triangle", null, 0.5);
        break;
      case "groan":
        noise(1.0, 0.07, "bandpass", 380, 1.5, 0, 0.2);
        tone(220, 0.8, 0.04, "sawtooth", 150);
        break;
      case "turnover":
        tone(330, 0.2, 0.06, "square", 220);
        tone(220, 0.35, 0.06, "square", 160, 0.18);
        break;
      case "cheer":
        cheer(0.09 * (arg || 1), 1.2);
        break;
      case "click":
        tone(1200, 0.04, 0.03, "square", 900);
        break;
      default:
        break;
    }
  }

  // Occasional birdsong in the trees.
  function tick(dt) {
    if (!enabled || !ctx || ctx.state !== "running") return;
    birdT -= dt;
    if (birdT <= 0) {
      birdT = 4 + Math.random() * 9;
      const base = 2400 + Math.random() * 1600;
      const n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) tone(base, 0.09, 0.012, "sine", base * (1.15 + Math.random() * 0.3), i * 0.13);
    }
  }

  window.TBAudio = {
    start: function () { context(); startAmbience(); },
    cue: cue,
    tick: tick,
    isEnabled: function () { return enabled; },
    setEnabled: function (on) {
      enabled = !!on;
      if (enabled) startAmbience(); else stopAmbience();
    }
  };
})();
