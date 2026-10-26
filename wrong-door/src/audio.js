// Sound: the soundtrack is the user's own (files in Work/music/, listed in music/tracks.js); effects
// are kept to a couple of soft, short noises (a parcel set down, a door knock), nothing synth-y.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const A = { ctx: null, master: null, vol: 0.7, musicVol: 0.5 };
  let noiseBuf = null, musicEl = null, tracks = [], trackI = 0;

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return;
    A.ctx = new C();
    A.master = A.ctx.createGain(); A.master.gain.value = A.vol; A.master.connect(A.ctx.destination);
    noiseBuf = A.ctx.createBuffer(1, A.ctx.sampleRate * 0.6, A.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic(WD.TRACKS || []);
  };
  A.setVolume = function (v) { A.vol = v; if (A.master) A.master.gain.value = v; };
  // iPhone Safari ignores <audio>.volume, so the music goes through the context's gain when it can
  let musicGain = null;
  A.setMusicVolume = function (v) { A.musicVol = v; if (musicGain) musicGain.gain.value = v; else if (musicEl) musicEl.volume = v; };
  function startMusic(list) {
    tracks = list.slice();
    if (!tracks.length || musicEl) return;
    musicEl = new Audio();
    musicEl.addEventListener("ended", function () { trackI = (trackI + 1) % tracks.length; musicEl.src = "music/" + tracks[trackI]; musicEl.play().catch(function () {}); });
    // (not from a double-clicked file: a file:// media source plays silent through the context)
    try { if (location.protocol === "file:") throw 0; const src = A.ctx.createMediaElementSource(musicEl); musicGain = A.ctx.createGain(); musicGain.gain.value = A.musicVol; src.connect(musicGain); musicGain.connect(A.ctx.destination); }
    catch (e) { musicEl.volume = A.musicVol; }
    musicEl.src = "music/" + tracks[0];
    musicEl.play().catch(function () {});
  }

  function thump(freq, dur, vol) {
    const c = A.ctx;
    if (!c) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  A.event = function (e) {
    if (e.t === "deliver") thump(420, 0.16, 0.5);
    else if (e.t === "wrong") { thump(260, 0.09, 0.45); setTimeout(function () { thump(260, 0.09, 0.45); }, 140); }   // a knock-knock from inside
    else if (e.t === "load") thump(900, 0.12, 0.18);
  };
  WD.Audio = A;
})(globalThis.WD);
