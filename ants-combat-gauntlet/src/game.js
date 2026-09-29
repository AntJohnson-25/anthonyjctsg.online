// Ant's Combat Gauntlet: fighting game. Canvas 2D, fixed 60Hz simulation.
// Sprite frames and anchors come from assets/sprites/manifest.js (window.SPRITES),
// fighter/move data from src/data.js (window.GAME_DATA).
(() => {
  'use strict';

  const { CHARACTERS, GAUNTLET_ORDER, AI_LEVELS, AI_STYLE, AI_GOON, STAGES, QUALIFY } = window.GAME_DATA;
  const SPRITES = window.SPRITES;

  const W = 1280, H = 720, FLOOR = 650, TARGET_H = 270;
  const GRAV = 0.95, ARENA_L = 70, ARENA_R = W - 70, ROUND_TICKS = 60 * 60;
  const FONT = "Impact, 'Arial Black', 'Segoe UI Black', sans-serif";

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  // touch devices get the on-screen pad, tap targets and "TAP" wording instead of key hints
  const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || params.has('touch');
  const prompt = (keysText, tapText) => (TOUCH ? tapText : keysText);

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function shuffle(arr) {   // Fisher-Yates, returns a new array
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pickWeighted(w) {
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) { if ((r -= w[k]) <= 0) return k; }
    return Object.keys(w)[0];
  }

  // ---------------------------------------------------------------- assets
  const IMG = {};
  function loadImages() {
    const jobs = [];
    for (const [sid, frames] of Object.entries(SPRITES)) {
      IMG[sid] = {};
      for (const f of Object.keys(frames)) {
        const im = new Image();
        IMG[sid][f] = im;
        jobs.push(new Promise((res) => { im.onload = res; im.onerror = () => { console.warn('missing sprite', sid, f); res(); }; }));
        im.src = `assets/sprites/${sid}/${f}.png`;
      }
    }
    // optional generated stage art; the procedural painting is the fallback
    jobs.push(new Promise((res) => {
      const im = new Image();
      im.onload = () => { IMG.stage_qualify = im; res(); };
      im.onerror = () => res();
      im.src = 'assets/stages/qualify.jpg';
    }));
    // title key art (asset-prompts/key-art.md); the painted title is the fallback
    jobs.push(new Promise((res) => {
      const im = new Image();
      im.onload = () => { IMG.keyart = im; res(); };
      im.onerror = () => res();
      im.src = 'assets/title/keyart.jpg';
    }));
    for (const s of STAGES) {
      if (!s.img) continue;
      jobs.push(new Promise((res) => {
        const im = new Image();
        im.onload = () => { IMG['stage_' + s.img] = im; res(); };
        im.onerror = () => res();   // falls back to the painted `kind`
        im.src = `assets/stages/${s.img}.jpg`;
      }));
    }
    return Promise.all(jobs);
  }

  // every character is drawn at the same standing height regardless of source size
  const charScale = (c) => { const m = SPRITES[c.sprite].idle; return TARGET_H / (m.h * m.scale) * (c.size || 1); };

  // c.alias maps logical frame names onto a placeholder sprite's frames
  function drawFrame(sprite, frame, x, feetY, k, facing, o = {}) {
    if (o.alias && o.alias[frame]) frame = o.alias[frame];
    const m = SPRITES[sprite][frame], im = IMG[sprite][frame];
    if (!m || !im || !im.complete) return;
    const s = m.scale * k * (o.scale || 1);
    ctx.save();
    ctx.translate(x, feetY);
    if (facing < 0) ctx.scale(-1, 1);
    if (o.squash) ctx.scale(1, o.squash);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.filter) ctx.filter = o.filter;
    ctx.drawImage(im, -m.ax * s, -m.ay * s, m.w * s, m.h * s);
    ctx.restore();
  }

  // prepare move timelines once; resolve generated-vs-placeholder art
  for (const c of Object.values(CHARACTERS)) {
    if (c.placeholder && !SPRITES[c.sprite]) {
      c.sprite = c.placeholder.sprite;
      c.alias = c.placeholder.alias;
      c.tint = c.placeholder.filter;
      c.isPlaceholder = true;
    }
    // back-walk frames come from generated sheets; until they exist, backing
    // up plays the forward walk in reverse
    const spr = SPRITES[c.sprite];
    if (!c.goon) {
      // Walking uses each fighter's stride in data.js (`STRIDE`: sheet walk + run pose;
      // Chain and Saint stride through their generated guard walk, fwd_1-3). The guard
      // stance is only at rest (user, 2026-09-28 / 2026-09-29).
      // Stand in the guard stance in fights (the user's template look), on
      // whichever side you face; mirrored art covers facing left
      if (spr.fwd_guard) c.frames.idle = ['fwd_guard'];
      // real block poses where generated; blockstun shows the impact pose
      // (keepBlock: Kai keeps his own surfboard-shield block from his sheet)
      if (spr.guard_block && !c.keepBlock) c.frames.block = 'guard_block';
      if (spr.guard_block_hit && !c.keepBlock) c.frames.blockHit = 'guard_block_hit';
      c.frames.back = spr.back_1 ? ['back_1', 'back_2', 'back_3', 'back_2'] : [...c.frames.walk].reverse();
      // front/back flip dodges: the three airborne poses of each generated flip
      if (spr.flipf_1) c.frames.flipF = ['flipf_1', 'flipf_2', 'flipf_3'];
      if (spr.flipb_1) c.frames.flipB = ['flipb_1', 'flipb_2', 'flipb_3'];
    }
    for (const mv of Object.values(c.moves)) {
      let t = 0;
      mv.timeline = mv.frames.map(([f, d]) => { const e = { f, start: t, end: t + d }; t += d; return e; });
      mv.total = t;
      mv.hits = mv.hits || [];
      mv.shots = mv.shots || [];
    }
  }

  // ---------------------------------------------------------------- audio
  const Sound = {
    ac: null, noise: null, muted: false,
    init() {
      if (this.ac) return;
      try {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        const len = this.ac.sampleRate;
        this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ac = null; }
    },
    tone(type, f0, f1, dur, vol) {
      const ac = this.ac, t = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
    },
    burst(filterType, freq, dur, vol) {
      const ac = this.ac, t = ac.currentTime;
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = this.noise; f.type = filterType; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(ac.destination); s.start(t, Math.random() * 0.5); s.stop(t + dur);
    },
    play(name) {
      if (!this.ac || this.muted) return;
      switch (name) {
        case 'swing': this.burst('bandpass', 1400, 0.09, 0.25); break;
        case 'slash': this.burst('highpass', 3000, 0.12, 0.3); break;
        case 'hit': this.burst('lowpass', 1800, 0.08, 0.5); this.tone('sine', 160, 60, 0.12, 0.5); break;
        case 'heavy': this.burst('lowpass', 900, 0.18, 0.6); this.tone('sine', 110, 40, 0.25, 0.7); break;
        case 'block': this.tone('square', 900, 700, 0.05, 0.12); this.burst('highpass', 4000, 0.04, 0.2); break;
        case 'shot': this.burst('highpass', 1200, 0.16, 0.6); this.tone('square', 220, 60, 0.08, 0.2); break;
        case 'magic': this.tone('sine', 380, 1300, 0.22, 0.18); this.tone('triangle', 760, 2400, 0.18, 0.08); break;
        case 'jump': this.tone('sine', 220, 420, 0.1, 0.12); break;
        case 'thud': this.tone('sine', 90, 35, 0.25, 0.6); this.burst('lowpass', 400, 0.2, 0.4); break;
        case 'ko': this.tone('sawtooth', 120, 30, 1.0, 0.3); this.burst('lowpass', 600, 0.6, 0.5); break;
        case 'select': this.tone('square', 660, 660, 0.05, 0.08); break;
        case 'confirm': this.tone('square', 520, 520, 0.07, 0.1); setTimeout(() => this.tone('square', 780, 780, 0.12, 0.1), 70); break;
        case 'bell': this.tone('triangle', 1200, 1180, 0.6, 0.2); this.tone('sine', 2400, 2380, 0.4, 0.08); break;
      }
    },
  };

  // ---------------------------------------------------------------- music
  // An <audio> element, not WebAudio: fetch/decode is blocked on file:// but <audio> plays fine there.
  // Browsers only allow playback after a user gesture, so start() runs on every key/tap until it sticks.
  // One mute switch covers music and sound effects, remembered across visits.
  // A playlist on ONE <audio> element: the calm track, then the hype track, then round again.
  // One element means two songs can never overlap. (v1 used an element per track with a crossfade,
  // and on iPhone both kept playing: Safari ignores .volume, so the old track never faded out.)
  // Swapping src on the same element also keeps iPhone's "user tapped" unlock for the next song.
  const Music = {
    el: null, idx: 0, gesture: false, VOL: 0.45,
    PLAYLIST: ['late_night_heat.mp3', 'cold_pavement.mp3'],
    get muted() { return Sound.muted; },
    get track() { return this.PLAYLIST[this.idx]; },
    init() {
      try { Sound.muted = localStorage.getItem('antcombat.muted') === '1'; } catch (e) { /* private mode */ }
      this.el = new Audio(`assets/music/${this.track}`);
      this.el.preload = 'auto'; this.el.volume = this.VOL;
      this.el.addEventListener('ended', () => this.next());
      // a phone call, app switch or background tab pauses it; coming back resumes it
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.el.pause(); else this.start();
      });
    },
    next() {
      this.idx = (this.idx + 1) % this.PLAYLIST.length;
      this.el.src = `assets/music/${this.track}`;
      if (!this.muted && !document.hidden && this.gesture) this.el.play().catch(() => {});
    },
    // called on every key/tap: the first one is the gesture that unlocks playback
    start() {
      if (params.has('selftest')) return;
      this.gesture = true;
      if (!this.muted && this.el.paused) this.el.play().catch(() => {});
    },
    toggle() {
      Sound.muted = !Sound.muted;
      try { localStorage.setItem('antcombat.muted', Sound.muted ? '1' : '0'); } catch (e) { /* private mode */ }
      if (Sound.muted) this.el.pause(); else { this.start(); Sound.play('select'); }
    },
    // quieter under the pause menu (desktop/Android; iPhone ignores volume, which is harmless here)
    update(screen, paused) {
      const v = paused && screen === 'fight' ? this.VOL * 0.35 : this.VOL;
      if (this.el.volume !== v) this.el.volume = v;
    },
  };
  Music.init();

  // ---------------------------------------------------------------- input
  const keys = new Set();
  const buffered = {}; // action -> ticks left
  // number keys 1-6 are the shown attack keys; the old J/K/U/I/L/O layout still works
  const ATTACK_ORDER = ['punch', 'kick', 'heavy', 'sweep', 'shoot', 'special'];
  const ATTACK_KEYS = { KeyJ: 'punch', KeyK: 'kick', KeyU: 'heavy', KeyI: 'sweep', KeyL: 'shoot', KeyO: 'special' };
  ATTACK_ORDER.forEach((name, i) => { ATTACK_KEYS[`Digit${i + 1}`] = name; ATTACK_KEYS[`Numpad${i + 1}`] = name; });
  const GAME_KEYS = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyE', 'KeyQ', 'Space', 'ShiftLeft', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'KeyP', 'KeyM', ...Object.keys(ATTACK_KEYS)]);

  function pressKey(code) {
    Sound.init(); Music.start();
    if (keys.has(code)) return;
    keys.add(code);
    if (code === 'KeyM') { Music.toggle(); return; }
    if (ATTACK_KEYS[code]) buffered.attack = { name: ATTACK_KEYS[code], t: 8 };
    if (code === 'KeyW' || code === 'ArrowUp') buffered.jump = { t: 6 };
    if (code === 'Space' || code === 'ShiftLeft') buffered.evade = { t: 6 };
    // E = front flip (toward where you face), Q = back flip (away)
    if (code === 'KeyE') buffered.flip = { rel: 1, t: 6 };
    if (code === 'KeyQ' && !game.paused) buffered.flip = { rel: -1, t: 6 };
    game.onKey(code);
  }
  function releaseKey(code) { keys.delete(code); }

  // ---- key bindings (desktop): two options. DEFAULT = the original layout, every key
  // as before (A/D or arrows, W, S, Space, E/Q, 1-6, J/K/U/I/L/O). CUSTOM = the player
  // set their own keys on the CONTROLS screen; then a physical key is translated to the
  // code the game already speaks (KeyA = left, Digit1 = punch...), so the fighter, the
  // touch pad and the self-test are unchanged, and in a fight ONLY the player's keys
  // (plus Esc, and P / M when unbound) do anything.
  const BIND_ACTIONS = [
    { id: 'left', label: 'Move left', code: 'KeyA', menu: 'ArrowLeft' },
    { id: 'right', label: 'Move right', code: 'KeyD', menu: 'ArrowRight' },
    { id: 'jump', label: 'Jump', code: 'KeyW', menu: 'ArrowUp' },
    { id: 'block', label: 'Block (hold)', code: 'KeyS', menu: 'ArrowDown' },
    { id: 'roll', label: 'Evade roll', code: 'Space' },
    { id: 'flipF', label: 'Front flip', code: 'KeyE' },
    { id: 'flipB', label: 'Back flip', code: 'KeyQ' },
    { id: 'punch', label: 'Punch (tap twice: combo)', code: 'Digit1', attack: true },
    { id: 'kick', label: 'Kick (in air: dive kick)', code: 'Digit2', attack: true },
    { id: 'heavy', label: 'Uppercut', code: 'Digit3', attack: true },
    { id: 'sweep', label: 'Roundhouse', code: 'Digit4', attack: true },
    { id: 'shoot', label: 'Gun', code: 'Digit5', attack: true },
    { id: 'special', label: 'Special', code: 'Digit6', attack: true },
  ];
  const BIND_BY_ID = Object.fromEntries(BIND_ACTIONS.map((a) => [a.id, a]));
  // the arrows are the standard controls in both modes (user, 2026-09-28): up jump, down block,
  // left / right move. They can't be given to another move.
  const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ArrowDown: 'block' };
  // Esc = pause/back, Enter = confirm, Backspace = step back in setup; the rest would fight the browser
  const RESERVED = /^(Escape|Enter|NumpadEnter|Tab|Backspace|CapsLock|Meta.*|OS.*|ContextMenu|F\d+|PrintScreen|ScrollLock|Pause)$/;
  const KEY_NAMES = {
    Space: 'SPACE', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Insert: 'INS', Delete: 'DEL', PageUp: 'PG UP', PageDown: 'PG DN',
    NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -', NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
  };
  const keyName = (code) => {
    if (!code) return '?';
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    let m = code.match(/^(?:Key|Digit)(.)$/); if (m) return m[1];
    m = code.match(/^Numpad(\d)$/); if (m) return `NUM ${m[1]}`;
    return code.toUpperCase();
  };
  const Binds = {
    saved: null,   // { actionId: physical code } in custom mode; null = default layout
    load() {
      try {
        const b = JSON.parse(localStorage.getItem('antcombat.keys') || 'null');
        if (b && BIND_ACTIONS.every((a) => typeof b[a.id] === 'string')) this.saved = b;
      } catch (e) { /* private mode or junk */ }
      this.rebuild();
    },
    save(b) {
      this.saved = { ...b };
      try { localStorage.setItem('antcombat.keys', JSON.stringify(this.saved)); } catch (e) { /* private mode */ }
      this.rebuild();
    },
    // back to the default layout (the CONTROLS screen's USE DEFAULT KEYS)
    clear() {
      this.saved = null;
      try { localStorage.removeItem('antcombat.keys'); } catch (e) { /* private mode */ }
      this.rebuild();
    },
    get custom() { return !!this.saved; },
    key(id) { return this.saved ? this.saved[id] : BIND_BY_ID[id].code; },
    rebuild() { this.byPhys = {}; for (const a of BIND_ACTIONS) this.byPhys[this.key(a.id)] = a; },
    // physical key -> the code to press, or null to ignore it
    translate(phys, fighting) {
      if (!this.saved) return phys;   // default layout: every original key works as itself
      const a = this.byPhys[phys];
      if (fighting) {
        if (a) return a.code;
        if (ARROWS[phys]) return BIND_BY_ID[ARROWS[phys]].code;   // arrows are standard in both modes
        return phys === 'Escape' || phys === 'KeyP' || phys === 'KeyM' ? phys : null;
      }
      // menus: every key works as itself, and your movement keys also steer the menus
      return a && a.menu ? a.menu : phys;
    },
  };
  Binds.load();
  let BINDABLE = !TOUCH && !DEMO && !params.has('selftest');   // the self-test switches it on for its binding checks

  const physDown = new Map();   // physical key -> the code it pressed, so keyup releases the same one
  addEventListener('keydown', (e) => {
    if (BINDABLE && game.screen === 'controls') {
      e.preventDefault();
      if (!e.repeat) { Sound.init(); Music.start(); game.bindKey(e.code); }
      return;
    }
    const code = BINDABLE ? Binds.translate(e.code, game.screen === 'fight' && !game.paused) : e.code;
    if (code == null) return;
    if (GAME_KEYS.has(code) || (Binds.custom && Binds.byPhys[e.code])) e.preventDefault();
    if (e.repeat) return;
    physDown.set(e.code, code);
    pressKey(code);
  });
  addEventListener('keyup', (e) => {
    const code = physDown.has(e.code) ? physDown.get(e.code) : e.code;
    physDown.delete(e.code);
    releaseKey(code);
  });
  addEventListener('blur', () => { keys.clear(); physDown.clear(); });

  function tickBuffers() {
    for (const k in buffered) if (--buffered[k].t <= 0) delete buffered[k];
  }
  function playerIntent() {
    const L = keys.has('KeyA') || keys.has('ArrowLeft');
    const R = keys.has('KeyD') || keys.has('ArrowRight');
    return {
      dir: (R ? 1 : 0) - (L ? 1 : 0),
      jump: !!buffered.jump,
      block: keys.has('KeyS') || keys.has('ArrowDown'),
      evade: !!buffered.evade,
      flip: buffered.flip ? buffered.flip.rel : 0,
      attack: buffered.attack ? buffered.attack.name : null,
    };
  }
  function consumeIntent(f) {
    // clear buffered presses the fighter acted on this tick
    if (f.acted.flip) delete buffered.flip;
    if (f.acted.attack) delete buffered.attack;
    if (f.acted.jump) delete buffered.jump;
    if (f.acted.evade) delete buffered.evade;
  }

  // ---------------------------------------------------------------- fighter
  class Fighter {
    constructor(id, x, facing, game, team = 0) {
      this.id = id; this.c = CHARACTERS[id]; this.game = game;
      this.team = team; this.uid = Fighter.next = (Fighter.next || 0) + 1;
      this.ai = null; this.entering = false; this.gone = false;
      this.k = charScale(this.c);
      this.x = x; this.y = 0; this.vx = 0; this.vy = 0; this.facing = facing;
      this.hp = this.c.hp; this.shownHp = this.hp;
      this.state = 'idle'; this.t = 0; this.animT = 0;
      this.move = null; this.moveName = null; this.hitDone = new Set(); this.shotDone = new Set();
      this.cool = {}; this.invuln = 0; this.flash = 0; this.combo = 0; this.stun = 0;
      this.kdGround = false; this.ko = false; this.airUsed = false;
      this.acted = {};
    }
    get airborne() { return this.y < 0; }
    get feetY() { return FLOOR + this.y; }
    setState(s) {
      this.state = s; this.t = 0;
      if (s === 'idle') { this.combo = 0; this.move = null; }
    }
    update(inp, opp) {
      const g = this.game;
      this.acted = {};
      this.t++; this.animT++;
      for (const k in this.cool) if (this.cool[k] > 0) this.cool[k]--;
      if (this.invuln > 0) this.invuln--;
      if (this.flash > 0) this.flash--;

      const free = this.state === 'idle' || this.state === 'walk' || this.state === 'block';
      // AI fighters auto-face their foe; the player turns with the arrows
      // (manualFacing) in every fight, so ←/→ always mean "face and walk that way"
      if (free && opp && !this.manualFacing) this.facing = opp.x >= this.x ? 1 : -1;

      switch (this.state) {
        case 'idle': case 'walk': case 'block': {
          if (this.manualFacing && inp.dir) this.facing = inp.dir;
          if (inp.evade) { this.acted.evade = true; this.startEvade(inp.dir || -this.facing); break; }
          if (inp.flip && (inp.flip > 0 ? this.c.frames.flipF : this.c.frames.flipB)) {
            this.acted.flip = true; this.startFlip(inp.flip); break;
          }
          if (inp.attack && this.tryMove(inp.attack)) { this.acted.attack = true; break; }
          if (inp.jump) {
            this.acted.jump = true;
            this.vy = -this.c.jump; this.y = -1; this.vx = inp.dir * this.c.speed * 1.15;
            this.airUsed = false; this.setState('jump'); Sound.play('jump');
            break;
          }
          if (inp.block) { if (this.state !== 'block') this.setState('block'); this.vx = 0; break; }
          if (inp.dir) {
            const back = inp.dir !== this.facing;
            this.vx = inp.dir * this.c.speed * (back ? 0.75 : 1);
            if (this.state !== 'walk') this.setState('walk');
          } else {
            this.vx = 0;
            if (this.state !== 'idle') this.setState('idle');
          }
          break;
        }
        case 'jump':
          if (inp.attack && !this.airUsed && this.c.moves.air) { this.acted.attack = true; this.airUsed = true; this.startMove('air'); }
          break;
        case 'attack': this.updateMove(inp); break;
        case 'hitstun': case 'blockstun':
          this.vx *= 0.82;
          if (this.t >= this.stun) this.setState('idle');
          break;
        case 'knockdown':
          if (this.kdGround) {
            this.vx *= 0.8;
            if (!this.ko && this.t >= 42) { this.setState('getup'); this.invuln = 32; }
            // beaten goons fade out and leave the fight
            if (this.ko && this.c.goon && this.t >= 100) this.gone = true;
          }
          break;
        case 'getup':
          if (this.t >= 28) this.setState('idle');
          break;
        case 'evade':
          this.vx *= 0.96;
          if (this.t >= 26) { this.vx = 0; this.setState('idle'); }
          break;
      }

      // physics
      if (this.airborne || this.vy < 0) {
        this.vy += GRAV;
        this.y += this.vy;
        if (this.y >= 0) { this.y = 0; this.land(); }
      }
      this.x += this.vx;
      // goons walking in from off-screen aren't clamped until they're inside
      if (this.entering && this.x > ARENA_L + 40 && this.x < ARENA_R - 40) this.entering = false;
      if (!this.entering) this.x = clamp(this.x, ARENA_L, ARENA_R);
    }
    land() {
      const g = this.game;
      const falling = this.vy;
      this.vy = 0;
      if (this.state === 'jump') { this.setState('idle'); g.dust(this.x, 6); }
      else if (this.state === 'flip') { this.invuln = 0; this.vx = 0; this.setState('idle'); g.dust(this.x, 10); }
      else if (this.state === 'attack' && this.move && this.move.air) { this.vx = 0; this.setState('idle'); g.dust(this.x, 10); }
      else if (this.state === 'knockdown' && !this.kdGround) {
        this.kdGround = true; this.t = 0; this.vx *= 0.4;
        g.dust(this.x, 18); g.shake = Math.max(g.shake, 8); Sound.play('thud');
      } else if (falling > 0 && this.state !== 'knockdown') { this.setState('idle'); }
    }
    tryMove(name) {
      const mv = this.c.moves[name];
      if (!mv || mv.air || (this.cool[name] || 0) > 0) return false;
      this.startMove(name);
      return true;
    }
    startMove(name) {
      const mv = this.c.moves[name];
      this.move = mv; this.moveName = name;
      this.setState('attack');
      this.hitDone = new Set(); this.shotDone = new Set();
      if (mv.cool) this.cool[name] = mv.cool;
      if (mv.dive) { this.vx = this.facing * mv.dive[0]; this.vy = Math.max(this.vy, mv.dive[1] * 0.3); }
      else if (mv.lunge) this.vx = this.facing * mv.lunge;
      else if (!this.airborne) this.vx = 0;
      const sfx = mv.sfx === undefined ? 'swing' : mv.sfx;
      if (sfx) Sound.play(sfx);
    }
    updateMove(inp) {
      const mv = this.move, t = this.t;
      if (mv.dive && this.airborne && t > 3) this.vy = Math.max(this.vy, mv.dive[1]);
      if (mv.lunge) this.vx *= 0.9;
      mv.shots.forEach((s, i) => {
        if (!this.shotDone.has(i) && t >= s.at) { this.shotDone.add(i); this.game.spawnShot(this, s); }
      });
      if (mv.chain && inp.attack === mv.chain.on && t >= mv.chain.from && this.hitDone.size > 0) {
        this.acted.attack = true;
        this.startMove(mv.chain.to);
        return;
      }
      if (t >= mv.total) {
        if (mv.air && this.airborne) return; // hold the last frame until landing
        this.setState('idle');
      }
    }
    // Acrobatic dodge: rel 1 = front flip over/past whoever is in front,
    // rel -1 = back flip away. Untouchable for the whole airtime.
    startFlip(rel) {
      this.setState('flip');
      this.flipRel = rel;
      this.vy = -this.c.jump * 1.05; this.y = -1;
      this.vx = this.facing * rel * 7.5;
      this.invuln = 999;   // cleared on landing
      this.airUsed = true;
      Sound.play('jump');
    }
    startEvade(dir) {
      this.setState('evade');
      this.invuln = 18;
      this.vx = dir * 9;
      Sound.play('swing');
    }
    knock(dir, h) {
      this.setState('knockdown');
      this.kdGround = false;
      this.vy = -(h.launch || 11);
      this.y = Math.min(this.y, -1);
      this.vx = dir * (h.push || 6) * 1.3;
    }
    activeHitboxes() {
      if (this.state !== 'attack' || !this.move) return [];
      const out = [];
      // hitDone holds "hitIndex:targetUid", so one swing can connect with
      // several goons but never twice with the same one
      this.move.hits.forEach((h, i) => {
        if (this.t < h.from || this.t >= h.to) return;
        const a = this.x + this.facing * h.x[0], b = this.x + this.facing * h.x[1];
        out.push({ i, h, x0: Math.min(a, b), x1: Math.max(a, b), y0: this.feetY - h.y[1], y1: this.feetY - h.y[0] });
      });
      return out;
    }
    hurtbox() {
      const low = this.state === 'knockdown' && this.kdGround;
      const hgt = low ? 70 : this.state === 'evade' ? 150 : 235;
      return { x0: this.x - 40, x1: this.x + 40, y0: this.feetY - hgt, y1: this.feetY };
    }
    frame() {
      const F = this.c.frames;
      switch (this.state) {
        case 'walk': {
          // moving away from the way we face = backing up, not a flipped walk
          const seq = this.vx * this.facing < 0 && F.back ? F.back : F.walk;
          return seq[((this.animT / 9) | 0) % seq.length];
        }
        case 'jump': return this.vy < 0 ? F.jump[0] : F.jump[1];
        case 'flip': {
          // pick the rotation pose from how far through the airtime we are
          const seq = this.flipRel > 0 ? F.flipF : F.flipB;
          const air = (2 * this.c.jump * 1.05) / GRAV;
          return seq[clamp(Math.floor((this.t / air) * seq.length), 0, seq.length - 1)];
        }
        case 'attack': {
          const tl = this.move.timeline, t = Math.min(this.t, this.move.total - 1);
          for (const e of tl) if (t < e.end) return e.f;
          return tl[tl.length - 1].f;
        }
        case 'block': return F.block;
        case 'blockstun': return F.blockHit || F.block;
        case 'hitstun': return F.hit;
        case 'knockdown': return this.kdGround ? F.knockdown[1] : F.knockdown[0];
        case 'getup': return this.t < 14 ? F.getup[0] : F.getup[1];
        case 'evade': return F.evade[Math.min(F.evade.length - 1, (this.t / 9) | 0)];
        case 'win': return F.win;
        default: return F.idle[0];
      }
    }
    draw(extra = {}) {
      const f = this.frame();
      const o = { alias: this.c.alias, filter: this.c.tint, ...extra };
      if (this.state === 'idle' || this.state === 'block') o.squash = 1 + Math.sin(this.animT / 11) * 0.012;
      if (this.flash > 0) o.filter = 'brightness(2.2) saturate(0.4)';
      if (this.state === 'evade' && this.c.teleport) o.alpha = 0.25 + 0.25 * Math.sin(this.t * 1.3);
      else if (this.invuln > 0 && this.state === 'getup') o.alpha = (this.t >> 2) % 2 ? 0.55 : 1;
      if (this.ko && this.c.goon && this.kdGround && this.t > 60) o.alpha = clamp(1 - (this.t - 60) / 40, 0, 1);
      drawFrame(this.c.sprite, f, this.x, this.feetY, this.k, this.facing, o);
    }
  }

  // ---------------------------------------------------------------- AI
  class AI {
    // profile: an AI_LEVELS index, or a ready profile object (goons)
    constructor(level, charId) {
      const p = typeof level === 'object' ? { ...level } : { ...AI_LEVELS[Math.min(level, AI_LEVELS.length - 1)] };
      const style = AI_STYLE[charId] || {};
      for (const k in style) p[k] = clamp(p[k] + style[k], 0, 0.95);
      this.p = p; this.plan = 'wait'; this.think = Math.round(rand(10, 40)); this.planT = 0;
    }
    intent(me, opp, g) {
      const out = { dir: 0, jump: false, block: false, evade: false, attack: null };
      if (--this.think <= 0) {
        this.decide(me, opp, g);
        this.think = Math.round(this.p.react * rand(0.7, 1.4));
      }
      const toward = Math.sign(opp.x - me.x) || 1;
      if (me.state === 'attack' && me.move && me.move.chain && me.hitDone.size && Math.random() < this.p.combo * 0.2) {
        out.attack = me.move.chain.on;
      }
      switch (this.plan) {
        case 'approach': out.dir = toward; break;
        case 'retreat': out.dir = -toward; break;
        case 'block': out.block = true; break;
        case 'evade': out.evade = true; out.dir = -toward; this.plan = 'wait'; break;
        case 'jumpin': out.jump = true; out.dir = toward; this.plan = 'airattack'; break;
        case 'airattack':
          if (me.airborne && me.vy > -6 && Math.abs(opp.x - me.x) < 230) { out.attack = 'air'; this.plan = 'wait'; }
          break;
        default:
          if (this.plan.startsWith('atk:')) { out.attack = this.plan.slice(4); this.plan = 'wait'; }
      }
      return out;
    }
    decide(me, opp, g) {
      const p = this.p, d = Math.abs(opp.x - me.x), r = Math.random(), mv = me.c.moves;
      const incoming = g.shots.some((s) => s.owner !== me && Math.sign(me.x - s.x) === Math.sign(s.vx) && Math.abs(s.x - me.x) < 340);
      const threat = incoming || (opp.state === 'attack' && d < 240) || (opp.airborne && d < 260 && opp.state === 'attack');
      if (threat) {
        if (r < p.block) return (this.plan = 'block');
        if (r < p.block + p.evade) return (this.plan = 'evade');
      }
      if (opp.state === 'knockdown' || opp.state === 'getup') return (this.plan = d < 190 ? 'retreat' : 'wait');
      const ready = (n) => mv[n] && !(me.cool[n] > 0);
      if (me.c.goon) {
        // goons take turns: only a couple swing at once, the rest circle
        if (d < 260 && g.busyAttackers(me) >= QUALIFY.maxAttackers) return (this.plan = d < 200 ? 'retreat' : 'wait');
        if (d > 170) return (this.plan = r < 0.85 ? 'approach' : 'wait');
        if (r < p.aggression) return (this.plan = r < p.aggression * 0.6 ? 'atk:punch' : 'atk:kick');
        return (this.plan = r < p.aggression + 0.2 ? 'wait' : 'retreat');
      }
      if (d > 330) {
        if (ready('shoot') && mv.shoot.shots.length && r < p.ranged) return (this.plan = 'atk:shoot');
        if (ready('special') && mv.special.shots.length && r < p.ranged * 0.5) return (this.plan = 'atk:special');
        if (r < p.jumpin * 0.4) return (this.plan = 'jumpin');
        return (this.plan = 'approach');
      }
      if (d > 175) {
        if (r < p.aggression * 0.35) return (this.plan = pick(['atk:kick', 'atk:sweep']));
        if (ready('special') && !mv.special.shots.length && r < p.aggression * 0.5) return (this.plan = 'atk:special');
        if (r < p.aggression * 0.35 + p.jumpin) return (this.plan = 'jumpin');
        if (ready('shoot') && mv.shoot.shots.length && r < p.ranged) return (this.plan = 'atk:shoot');
        return (this.plan = 'approach');
      }
      if (r < p.aggression) {
        return (this.plan = pickWeighted({
          'atk:punch': 3, 'atk:kick': 2, 'atk:heavy': mv.heavy ? 1.2 : 0, 'atk:sweep': mv.sweep ? 1 : 0,
          'atk:shoot': ready('shoot') && !mv.shoot.shots.length ? 1.2 : 0,
          'atk:special': ready('special') && !mv.special.shots.length ? 0.6 : 0,
        }));
      }
      if (r < p.aggression + 0.15) return (this.plan = 'block');
      return (this.plan = 'retreat');
    }
  }

  // ---------------------------------------------------------------- stages
  function imageStage(im) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(im, 0, 0, W, H);
    return c;
  }

  function paintStage(kind) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = (y0, y1, stops) => {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      stops.forEach(([o, col]) => gr.addColorStop(o, col));
      return gr;
    };
    const ridge = (base, amp, seed, color) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) {
        const y = base - amp * (0.5 + 0.5 * Math.sin(x * 0.004 + seed) * Math.cos(x * 0.011 + seed * 2));
        g.lineTo(x, y);
      }
      g.lineTo(W, H); g.fill();
    };
    if (kind === 'street') {
      g.fillStyle = grad(0, FLOOR, [[0, '#2b1d4a'], [0.45, '#c2436a'], [0.8, '#f59a4a'], [1, '#ffd27a']]);
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,230,160,0.9)'; g.beginPath(); g.arc(W * 0.62, 430, 70, 0, Math.PI * 2); g.fill();
      ridge(470, 90, 1, '#7a3450');
      // storefronts
      const fronts = [[20, 230, 'SALOON'], [270, 190, 'BANK'], [880, 210, 'HOTEL'], [1110, 180, 'JAIL']];
      for (const [x, w, label] of fronts) {
        const top = FLOOR - 250 - (w % 40);
        g.fillStyle = '#3a2130'; g.fillRect(x, top, w, FLOOR - top);
        g.fillStyle = '#4b2b3c'; g.fillRect(x - 8, top - 30, w + 16, 34);
        g.fillStyle = '#f7c46b'; g.font = `28px ${FONT}`; g.textAlign = 'center'; g.fillText(label, x + w / 2, top - 5);
        g.fillStyle = 'rgba(255,190,90,0.55)';
        for (let i = 0; i < 2; i++) g.fillRect(x + 25 + i * (w - 90), top + 50, 40, 55);
        g.fillStyle = '#26151f'; g.fillRect(x + w / 2 - 28, FLOOR - 110, 56, 110);
      }
      g.fillStyle = grad(FLOOR - 20, H, [[0, '#b0703e'], [1, '#6e3f24']]);
      g.fillRect(0, FLOOR - 20, W, H);
    } else if (kind === 'canyon') {
      g.fillStyle = grad(0, FLOOR, [[0, '#4f8fd0'], [0.7, '#b9d7ea'], [1, '#f2dcb4']]);
      g.fillRect(0, 0, W, H);
      ridge(420, 160, 3, '#c9775a');
      ridge(500, 120, 7, '#a3503a');
      // mesas
      g.fillStyle = '#7d3626';
      g.fillRect(40, 300, 260, FLOOR - 300); g.fillRect(960, 260, 300, FLOOR - 260);
      g.fillStyle = '#93432f'; g.fillRect(40, 300, 260, 18); g.fillRect(960, 260, 300, 18);
      g.fillStyle = 'rgba(60,20,10,0.25)';
      for (let i = 0; i < 12; i++) g.fillRect(50 + i * 21, 330, 6, FLOOR - 340);
      for (let i = 0; i < 14; i++) g.fillRect(975 + i * 21, 290, 6, FLOOR - 300);
      // cacti
      g.fillStyle = '#3f6b3a';
      for (const x of [380, 820]) { g.fillRect(x, FLOOR - 150, 22, 150); g.fillRect(x - 26, FLOOR - 110, 26, 14); g.fillRect(x - 26, FLOOR - 140, 12, 44); g.fillRect(x + 22, FLOOR - 90, 26, 14); g.fillRect(x + 36, FLOOR - 125, 12, 49); }
      g.fillStyle = grad(FLOOR - 20, H, [[0, '#d49a64'], [1, '#8e5634']]);
      g.fillRect(0, FLOOR - 20, W, H);
    } else if (kind === 'depot') {
      g.fillStyle = grad(0, FLOOR, [[0, '#6aa0c8'], [0.6, '#f0c890'], [1, '#f6dcb0']]);
      g.fillRect(0, 0, W, H);
      ridge(440, 110, 2, '#c08868');
      // water tower
      g.fillStyle = '#5a3a26';
      g.fillRect(120, 250, 14, FLOOR - 250); g.fillRect(230, 250, 14, FLOOR - 250);
      g.fillStyle = '#7a4e30'; g.fillRect(100, 170, 164, 90);
      g.fillStyle = '#5a3a26'; g.beginPath(); g.moveTo(92, 172); g.lineTo(182, 120); g.lineTo(272, 172); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 6; i++) g.fillRect(108 + i * 27, 172, 4, 86);
      // locomotive silhouette
      g.fillStyle = '#2a2a33';
      g.fillRect(720, 430, 380, 120); g.fillRect(1010, 360, 100, 190); g.fillRect(760, 380, 40, 60);
      g.fillRect(740, 360, 80, 24);
      g.fillStyle = '#1a1a20';
      for (const x of [780, 880, 980, 1070]) { g.beginPath(); g.arc(x, 560, 34, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(780 - i * 26, 340 - i * 30, 22 + i * 8, 0, Math.PI * 2); g.fill(); }
      // platform + corral fence
      g.fillStyle = '#6e4a2c'; g.fillRect(0, FLOOR - 70, 330, 70);
      g.fillStyle = '#8a5e38';
      for (let x = 350; x < 700; x += 70) g.fillRect(x, FLOOR - 110, 12, 110);
      g.fillRect(340, FLOOR - 100, 370, 10); g.fillRect(340, FLOOR - 60, 370, 10);
      g.fillStyle = '#d8b050';
      for (const [x, y] of [[560, FLOOR - 56], [610, FLOOR - 56], [585, FLOOR - 98]]) g.fillRect(x, y, 46, 40);
      g.fillStyle = grad(FLOOR - 20, H, [[0, '#c89060'], [1, '#7a5030']]);
      g.fillRect(0, FLOOR - 20, W, H);
    } else {
      g.fillStyle = grad(0, FLOOR, [[0, '#05060f'], [0.6, '#15203d'], [1, '#2c3f55']]);
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 90; i++) { const x = (i * 137) % W, y = (i * 71) % 380; g.fillRect(x, y, 2, 2); }
      g.fillStyle = '#e8ecd8'; g.beginPath(); g.arc(W * 0.28, 150, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#15203d'; g.beginPath(); g.arc(W * 0.28 + 22, 138, 54, 0, Math.PI * 2); g.fill();
      ridge(520, 110, 5, '#101a2c');
      // dead tree + graves
      g.strokeStyle = '#0b0f19'; g.lineWidth = 14; g.lineCap = 'round';
      g.beginPath(); g.moveTo(1050, FLOOR); g.lineTo(1040, 380); g.lineTo(980, 320); g.moveTo(1040, 430); g.lineTo(1120, 360); g.lineTo(1150, 370); g.stroke();
      g.fillStyle = '#1e2838';
      for (const [x, h] of [[120, 90], [230, 70], [330, 100], [760, 80], [880, 95]]) {
        g.fillRect(x, FLOOR - h, 16, h); g.fillRect(x - 22, FLOOR - h + 22, 60, 14);
      }
      g.fillStyle = grad(FLOOR - 20, H, [[0, '#2d3a2e'], [1, '#101611']]);
      g.fillRect(0, FLOOR - 20, W, H);
      g.fillStyle = 'rgba(120,255,160,0.07)';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(i * 240 + 60, FLOOR - 10, 220, 30, 0, 0, Math.PI * 2); g.fill(); }
    }
    return c;
  }

  // ---------------------------------------------------------------- text helpers
  function text(str, x, y, size, color = '#fff', align = 'center', stroke = '#1a0d05', lw = null) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw || Math.max(3, size / 9);
    if (stroke) { ctx.strokeStyle = stroke; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function portrait(c, x, y, size, flip, silhouette) {
    const m = SPRITES[c.sprite].idle, im = IMG[c.sprite].idle;
    const sh = m.h * 0.42, sw = sh;
    const sx = clamp(m.ax - sw / 2, 0, m.w - sw);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, size, size, 12); ctx.clip();
    ctx.fillStyle = '#1c1426'; ctx.fillRect(x, y, size, size);
    if (flip) { ctx.translate(x * 2 + size, 0); ctx.scale(-1, 1); }
    if (silhouette) ctx.filter = 'brightness(0)';
    else if (c.tint) ctx.filter = c.tint;
    ctx.drawImage(im, sx, 0, sw, sh, x, y + 4, size, size);
    ctx.restore();
    ctx.strokeStyle = c.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(x, y, size, size, 12); ctx.stroke();
  }

  // ---------------------------------------------------------------- unlocks
  const Store = {
    get() { try { return JSON.parse(localStorage.getItem('antcombat.unlocked') || '["ant"]'); } catch (e) { return ['ant']; } },
    set(list) { try { localStorage.setItem('antcombat.unlocked', JSON.stringify(list)); } catch (e) { /* private mode */ } },
  };

  // ---------------------------------------------------------------- game
  const ROSTER = ['ant', 'competitor1', 'competitor2', 'competitor3', 'competitor4', 'competitor5', 'competitor6', 'competitor7',
    'competitor8', 'competitor9', 'competitor10'];
  const SEL_COLS = 6;   // select screen: 2 rows of up to 6 cards (the short row is centred)
  const SEL_ROWS = Math.ceil(ROSTER.length / SEL_COLS);
  const selRowLen = (row) => Math.min(SEL_COLS, ROSTER.length - row * SEL_COLS);

  const game = {
    screen: 'loading', t: 0,
    selIndex: 0, unlocked: ROSTER.slice(),   // everyone selectable from the start
    playerId: 'ant', opponents: [], stageIdx: 0,
    p1: null, p2: null, fighters: [], ai1: null,
    mode: 'duel',            // 'duel' = gauntlet fight, 'qualify' = 6-goon brawl
    bench: [], attempt: 1, goonTotal: 0, spawnWait: 0,
    shots: [], parts: [], shake: 0, hitstop: 0, slowmo: 0,
    phase: null, phaseT: 0, round: 1, wins: [0, 0], timer: ROUND_TICKS, stageCanvas: null,
    banner: null, paused: false, continues: 0, fightStart: 0, totalTicks: 0,

    get enemies() { return this.fighters.filter((f) => f.team === 1); },

    start() {
      if (params.get('as') && CHARACTERS[params.get('as')]) this.playerId = params.get('as');
      if (params.has('qualify')) {
        this.beginGauntlet(this.playerId);
        this.startQualify();
      } else if (params.has('fight') || DEMO) {
        this.beginGauntlet(this.playerId);
        this.stageIdx = clamp(parseInt(params.get('fight') || '0', 10) || 0, 0, this.opponents.length - 1);
        // ?stage=N forces the arena (STAGES index) for screenshots
        if (params.has('stage')) this.fightStages[this.stageIdx] = clamp(+params.get('stage') || 0, 0, STAGES.length - 1);
        this.startFight();
      } else if (params.get('screen')) {
        this.screen = params.get('screen');
        this.beginGauntlet(this.playerId);
        if (this.screen === 'disqualified') this.attempt = QUALIFY.attempts;
        // screenshots: ?screen=controls (edit, default keys) [&ctl=capture&step=N] or &ctl=setup&step=N (N keys in)
        if (this.screen === 'controls') {
          this.openControls('title');
          const c = this.ctl, step = +params.get('step') || 0;
          if (params.get('ctl') === 'setup') {
            c.mode = 'setup'; c.step = clamp(step, 0, BIND_ACTIONS.length - 1);
            c.draft = {}; BIND_ACTIONS.slice(0, c.step).forEach((a) => { c.draft[a.id] = a.code; });
          } else if (params.get('ctl')) { c.mode = params.get('ctl'); c.sel = step; }
        }
      } else this.screen = 'title';
    },

    beginGauntlet(pid) {
      this.playerId = pid;
      // every other fighter, shuffled fresh each run; each fight gets an arena,
      // shuffled too, cycling through all of them before any repeats
      this.opponents = shuffle(GAUNTLET_ORDER.filter((id) => id !== pid));
      let pool = [];
      this.fightStages = this.opponents.map(() => {
        if (!pool.length) pool = shuffle(STAGES.map((_, i) => i));
        return pool.pop();
      });
      this.stageIdx = 0; this.continues = 0; this.totalTicks = 0; this.attempt = 1;
    },

    onKey(code) {
      const confirm = code === 'Enter' || code === 'Space' || code === 'KeyJ';
      switch (this.screen) {
        case 'title':
          // desktop: the default keys work right away; C opens CONTROLS to set your own
          if (confirm) { Sound.play('confirm'); this.screen = 'select'; }
          else if (BINDABLE && code === 'KeyC') { Sound.play('select'); this.openControls('title'); }
          break;
        case 'select':
          {
            // rows can differ in length: left/right wrap within the row, up/down
            // keep the column (clamped to the shorter row)
            const row = Math.floor(this.selIndex / SEL_COLS), col = this.selIndex % SEL_COLS, len = selRowLen(row);
            const go = (r, c) => { this.selIndex = r * SEL_COLS + Math.min(c, selRowLen(r) - 1); Sound.play('select'); };
            if (code === 'KeyA' || code === 'ArrowLeft') go(row, (col + len - 1) % len);
            if (code === 'KeyD' || code === 'ArrowRight') go(row, (col + 1) % len);
            if (code === 'KeyW' || code === 'ArrowUp') go((row + SEL_ROWS - 1) % SEL_ROWS, col);
            if (code === 'KeyS' || code === 'ArrowDown') go((row + 1) % SEL_ROWS, col);
          }
          if (code === 'Escape') this.screen = 'title';
          if (confirm) {
            const id = ROSTER[this.selIndex];
            if (this.unlocked.includes(id)) { Sound.play('confirm'); this.beginGauntlet(id); this.screen = 'qualifyIntro'; this.t = 0; }
            else Sound.play('block');
          }
          break;
        case 'qualifyIntro':
          if (confirm && this.t > 20) { Sound.play('confirm'); this.startQualify(); }
          if (code === 'Escape') this.screen = 'select';
          break;
        case 'disqualified':
          if (confirm && this.t > 60) this.screen = 'title';
          break;
        case 'bracket':
          if (confirm && this.t > 20) { Sound.play('confirm'); this.startFight(); }
          if (code === 'Escape') this.screen = 'select';
          break;
        case 'fight':
          if (code === 'Escape' || code === 'KeyP') { this.paused = !this.paused; Sound.play('select'); }
          else if (this.paused && code === 'KeyQ') { this.paused = false; this.screen = 'title'; }
          else if (this.paused && BINDABLE && code === 'KeyC') { Sound.play('select'); this.openControls('fight'); }
          break;
        case 'continue':
          if (confirm && this.t > 30) { this.continues++; Sound.play('confirm'); this.startFight(); }
          if (code === 'Escape') this.screen = 'title';
          break;
        case 'champion':
          if (confirm && this.t > 60) { this.screen = 'select'; }
          break;
      }
    },

    // ---- controls screen (desktop). setup = walk through every action in order;
    // edit = pick one to change; capture = waiting for that one's new key.
    // `after` is where DONE goes: the title or back to the paused fight.
    // Changing any key (or SET ALL KEYS) switches to custom; USE DEFAULT KEYS switches back.
    openControls(after) {
      keys.clear(); physDown.clear();
      for (const k in buffered) delete buffered[k];
      this.ctl = { after, mode: 'edit', step: 0, sel: 0, draft: this.currentKeys(), msg: '', msgT: 0 };
      this.screen = 'controls'; this.t = 0;
    },
    currentKeys() { return Object.fromEntries(BIND_ACTIONS.map((a) => [a.id, Binds.key(a.id)])); },
    ctlSetupAll() {
      const c = this.ctl;
      c.mode = 'setup'; c.step = 0; c.draft = {}; c.msg = ''; Sound.play('select');
    },
    ctlUseDefaults() {
      const c = this.ctl;
      Binds.clear(); c.draft = this.currentKeys(); c.mode = 'edit';
      Sound.play('confirm'); this.ctlSay('Default keys restored (arrows, J K U I L O and the number pad work too).');
    },
    closeControls() {
      this.screen = this.ctl.after; this.ctl = null; this.t = 0;
    },
    ctlSay(msg) { this.ctl.msg = msg; this.ctl.msgT = this.t; },
    bindKey(code) {
      const c = this.ctl, n = BIND_ACTIONS.length;
      if (c.mode === 'edit') {
        const col = BIND_ACTIONS.findIndex((a) => a.attack);   // first FIGHT row
        if (code === 'Escape') { Sound.play('confirm'); this.closeControls(); }
        else if (code === 'Enter' || code === 'NumpadEnter') { c.mode = 'capture'; c.msg = ''; Sound.play('select'); }
        else if (code === 'KeyR' && Binds.custom) this.ctlUseDefaults();
        else if (code === 'ArrowUp') { c.sel = (c.sel + n - 1) % n; Sound.play('select'); }
        else if (code === 'ArrowDown') { c.sel = (c.sel + 1) % n; Sound.play('select'); }
        else if (code === 'ArrowLeft' || code === 'ArrowRight') { c.sel = c.sel < col ? Math.min(n - 1, c.sel + col) : c.sel - col; Sound.play('select'); }
        return;
      }
      const setup = c.mode === 'setup', act = BIND_ACTIONS[setup ? c.step : c.sel];
      if (code === 'Escape') {
        Sound.play('select');
        if (!setup) { c.mode = 'edit'; c.msg = ''; }
        else { c.draft = this.currentKeys(); c.mode = 'edit'; this.ctlSay('Kept your old keys'); }
        return;
      }
      if (setup && code === 'Backspace') {
        if (c.step > 0) { c.step--; delete c.draft[BIND_ACTIONS[c.step].id]; Sound.play('select'); }
        return;
      }
      if (ARROWS[code]) { Sound.play('block'); this.ctlSay('The arrows always move, jump (↑) and block (↓). Pick another key.'); return; }
      if (RESERVED.test(code)) { Sound.play('block'); this.ctlSay(`${keyName(code)} is saved for the menus. Pick another key.`); return; }
      const other = BIND_ACTIONS.find((a) => a !== act && c.draft[a.id] === code);
      if (setup) {
        if (other) { Sound.play('block'); this.ctlSay(`${keyName(code)} is already ${other.label.toUpperCase()}. Pick another key.`); return; }
        c.draft[act.id] = code; c.step++; c.msg = ''; Sound.play('select');
        if (c.step === n) { Binds.save(c.draft); c.mode = 'edit'; c.sel = 0; Sound.play('confirm'); this.ctlSay('All set! Click any key to change it.'); }
        return;
      }
      // changing one key: taking another action's key swaps the two
      if (other) { c.draft[other.id] = c.draft[act.id]; this.ctlSay(`Swapped: ${other.label.toUpperCase()} is now ${keyName(c.draft[other.id])}`); }
      else c.msg = '';
      c.draft[act.id] = code;
      Binds.save(c.draft); c.mode = 'edit'; Sound.play('confirm');
    },

    startFight() {
      this.screen = 'fight'; this.mode = 'duel';
      this.round = 1; this.wins = [0, 0];
      const st = this.stage();
      this.stageCanvas = IMG['stage_' + st.img] ? imageStage(IMG['stage_' + st.img]) : paintStage(st.kind);
      this.ai1 = DEMO ? new AI(2, this.playerId) : null;
      this.startRound();
    },
    stage(i = this.stageIdx) { return STAGES[this.fightStages ? this.fightStages[i] : i % STAGES.length]; },
    // AI sharpness ramps across the run: 3 levels spread over however many fights
    aiLevel(i = this.stageIdx) { return Math.min(AI_LEVELS.length - 1, Math.floor((i * AI_LEVELS.length) / this.opponents.length)); },
    startRound() {
      const oppId = this.opponents[this.stageIdx];
      this.p1 = new Fighter(this.playerId, W / 2 - 230, 1, this, 0);
      this.p1.manualFacing = !this.ai1;   // ←/→ turn you in the duels too, same as the brawl (user, 2026-09-29)
      this.p2 = new Fighter(oppId, W / 2 + 230, -1, this, 1);
      this.p2.ai = new AI(this.aiLevel(), oppId);
      this.fighters = [this.p1, this.p2];
      this.resetArena();
      this.timer = ROUND_TICKS;
    },
    resetArena() {
      this.shots = []; this.parts = [];
      this.phase = 'intro'; this.phaseT = 0;
      this.hitstop = 0; this.slowmo = 0; this.banner = null; this.paused = false;
    },

    // ---- qualifying round: player vs 6 goons, QUALIFY.attempts tries
    startQualify() {
      this.screen = 'fight'; this.mode = 'qualify';
      this.stageCanvas = null;
      if (!IMG.stage_qualify) this.stageCanvas = paintStage('depot');
      this.ai1 = DEMO ? new AI(2, this.playerId) : null;
      this.startQualifyAttempt();
    },
    startQualifyAttempt() {
      this.p1 = new Fighter(this.playerId, W / 2, 1, this, 0);
      this.p1.manualFacing = !this.ai1;
      this.p2 = null;
      this.fighters = [this.p1];
      this.goonTotal = QUALIFY.goons.length;
      // waiting goons stand in the background, alternating sides
      this.bench = QUALIFY.goons.map((id, i) => ({
        id, side: i % 2 ? 1 : -1,
        x: i % 2 ? W - 60 - ((i / 2) | 0) * 70 : 60 + ((i / 2) | 0) * 70,
      }));
      for (let i = 0; i < QUALIFY.maxActive; i++) this.activateGoon(true);
      this.resetArena();
      this.spawnWait = 0;
    },
    activateGoon(atStart) {
      const b = this.bench.shift();
      if (!b) return;
      // at the start goons are already in the arena; later ones walk in from their side
      const x = atStart ? W / 2 + b.side * rand(260, 480) : (b.side < 0 ? -90 : W + 90);
      const g = new Fighter(b.id, x, -b.side, this, 1);
      g.ai = new AI(AI_GOON, b.id);
      g.entering = !atStart;
      this.fighters.push(g);
    },
    busyAttackers(me) {
      return this.fighters.filter((f) => f !== me && f.team === me.team && !f.ko &&
        (f.state === 'attack' || (f.ai && f.ai.plan.startsWith('atk:')))).length;
    },
    goonsDown() { return this.goonTotal - this.bench.length - this.enemies.filter((f) => !f.ko).length; },
    nearestFoe(f) {
      let best = null, bd = Infinity;
      for (const o of this.fighters) {
        if (o.team === f.team || o.ko || o.gone) continue;
        const d = Math.abs(o.x - f.x);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    },

    // ---- combat helpers
    spawnShot(owner, s) {
      const dir = owner.facing;
      this.shots.push({
        owner, dir, x: owner.x + dir * s.dx, y: owner.feetY - s.dy, vx: dir * s.vx,
        r: s.r, kind: s.kind, dmg: s.dmg, stun: s.stun, push: s.push, kd: s.kd, t: 0,
      });
      Sound.play(s.kind === 'bullet' ? 'shot' : 'magic');
      if (s.kind === 'bullet') this.burst(owner.x + dir * (s.dx - 10), owner.feetY - s.dy, 8, ['#fff3b0', '#ffb347'], 5);
    },
    applyHit(att, def, h, dir) {
      if (def.invuln > 0 || def.ko) return false;
      const blocking = (def.state === 'block' || def.state === 'blockstun') && !def.airborne && def.facing === -dir;
      const hx = def.x - dir * 30, hy = def.feetY - 170;
      if (blocking) {
        def.hp = Math.max(1, def.hp - Math.round(h.dmg * 0.08));
        def.setState('blockstun'); def.stun = Math.max(8, Math.round((h.stun || 18) * 0.7));
        def.vx = dir * (h.push || 5) * 0.9;
        this.burst(hx, hy, 10, ['#9fd8ff', '#ffffff'], 6);
        Sound.play('block'); this.hitstop = 4;
        return true;
      }
      const scale = Math.max(0.5, 1 - def.combo * 0.12);
      def.combo++;
      def.hp = Math.max(0, def.hp - Math.round(h.dmg * scale));
      def.flash = 6;
      const heavy = h.kd || h.dmg >= 80;
      if (def.hp <= 0) { def.ko = true; def.knock(dir, { launch: 13, push: 7 }); }
      else if (h.kd || def.airborne) def.knock(dir, h);
      else { def.setState('hitstun'); def.stun = h.stun; def.vx = dir * h.push; }
      this.burst(hx, hy, heavy ? 22 : 12, ['#fff6c8', '#ffd24a', '#ff7b2e'], heavy ? 10 : 7);
      this.ring(hx, hy, heavy ? 60 : 36);
      Sound.play(heavy ? 'heavy' : 'hit');
      this.hitstop = heavy ? 10 : 6;
      this.shake = Math.max(this.shake, heavy ? 12 : 5);
      return true;
    },
    burst(x, y, n, colors, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = rand(0.3, 1) * speed;
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: rand(14, 26), max: 26, color: pick(colors), size: rand(2, 5), g: 0.25 });
      }
    },
    ring(x, y, r) { this.parts.push({ ring: true, x, y, r: 4, max: r, life: 10 }); },
    dust(x, n) {
      for (let i = 0; i < n; i++) {
        this.parts.push({ x: x + rand(-30, 30), y: FLOOR - 4, vx: rand(-2.5, 2.5), vy: rand(-2.2, -0.4), life: rand(18, 34), max: 34, color: 'rgba(210,170,120,0.7)', size: rand(4, 9), g: 0.04 });
      }
    },

    // ---- per-tick
    update() {
      this.t++;
      tickBuffers();
      if (this.screen !== 'fight' || this.paused) return;
      this.phaseT++;
      if (this.shake > 0) this.shake *= 0.86;
      if (this.shake < 0.3) this.shake = 0;
      for (const p of this.parts) {
        p.life--;
        if (p.ring) p.r += (p.max - p.r) * 0.35;
        else { p.x += p.vx; p.y += p.vy; p.vy += p.g; }
      }
      this.parts = this.parts.filter((p) => p.life > 0);

      if (this.hitstop > 0) { this.hitstop--; return; }
      if (this.slowmo > 0) { this.slowmo--; if (this.slowmo % 3) return; }

      const p1 = this.p1;
      const idle = { dir: 0, jump: false, block: false, evade: false, attack: null };
      const fighting = this.phase === 'fight';
      if (fighting) {
        this.totalTicks++;
        if (this.mode === 'duel' && --this.timer <= 0) this.endRound(null, 'TIME');
      }
      for (const f of this.fighters) {
        const foe = this.nearestFoe(f);
        let inp = idle;
        if (f.entering) inp = { ...idle, dir: f.x < W / 2 ? 1 : -1 };
        else if (fighting && foe) {
          if (f === p1) inp = this.ai1 ? this.ai1.intent(p1, foe, this) : playerIntent();
          else if (f.ai) inp = f.ai.intent(f, foe, this);
        }
        f.update(inp, foe);
      }
      if (!this.ai1) consumeIntent(p1);
      this.separate();

      // melee: every attacker against every fighter on the other team
      for (const a of this.fighters) {
        const boxes = a.activeHitboxes();
        if (!boxes.length) continue;
        for (const d of this.fighters) {
          if (d.team === a.team || d.ko) continue;
          const hb = d.hurtbox();
          for (const box of boxes) {
            const key = box.i + ':' + d.uid;
            if (a.hitDone.has(key)) continue;
            if (box.x0 < hb.x1 && box.x1 > hb.x0 && box.y0 < hb.y1 && box.y1 > hb.y0) {
              if (this.applyHit(a, d, box.h, a.facing)) a.hitDone.add(key);
            }
          }
        }
      }
      // projectiles hit the first opposing fighter they overlap
      for (const s of this.shots) {
        s.x += s.vx; s.t++;
        for (const target of this.fighters) {
          if (s.dead || target.team === s.owner.team || target.ko) continue;
          const hb = target.hurtbox();
          if (s.x + s.r > hb.x0 && s.x - s.r < hb.x1 && s.y + s.r > hb.y0 && s.y - s.r < hb.y1) {
            if (this.applyHit(s.owner, target, s, s.dir)) s.dead = true;
          }
        }
        for (const o of this.shots) {
          if (o !== s && !o.dead && !s.dead && o.owner !== s.owner && Math.abs(o.x - s.x) < o.r + s.r && Math.abs(o.y - s.y) < o.r + s.r + 20) {
            o.dead = s.dead = true;
            this.burst(s.x, s.y, 14, ['#ffffff', '#9fd8ff', '#ffd24a'], 6);
            Sound.play('block');
          }
        }
        if (s.x < -60 || s.x > W + 60) s.dead = true;
      }
      this.shots = this.shots.filter((s) => !s.dead);

      for (const f of this.fighters) f.shownHp += (f.hp - f.shownHp) * 0.08;
      if (this.mode === 'qualify') this.fighters = this.fighters.filter((f) => !f.gone);

      // round flow
      if (this.phase === 'intro') {
        if (this.phaseT === 1) Sound.play('bell');
        if (this.phaseT >= 130) { this.phase = 'fight'; this.phaseT = 0; }
      } else if (this.phase === 'fight') {
        if (this.mode === 'qualify') this.updateQualify();
        else if (p1.ko || this.p2.ko) this.endRound(p1.ko && this.p2.ko ? null : p1.ko ? this.p2 : p1, 'K.O.');
      } else if (this.mode === 'qualify' && this.phase === 'ko') {
        if (this.phaseT === 110 && !p1.ko && !p1.airborne) { p1.setState('win'); p1.vx = 0; }
        if (this.phaseT >= 220) this.finishQualifyAttempt();
      } else if (this.phase === 'ko') {
        const winner = this.roundWinner;
        if (this.phaseT === 110 && winner && !winner.ko && !winner.airborne) { winner.setState('win'); winner.vx = 0; }
        if (this.phaseT >= 220) this.nextRound();
      }
    },
    updateQualify() {
      const alive = this.enemies.filter((f) => !f.ko);
      // refill: when a goon drops, the next one waiting walks in after a beat
      if (alive.length < QUALIFY.maxActive && this.bench.length) {
        if (++this.spawnWait >= 45) { this.spawnWait = 0; this.activateGoon(false); }
      }
      if (this.p1.ko) {
        this.qualified = false; this.roundWinner = null;
        this.phase = 'ko'; this.phaseT = 0; this.banner = 'K.O.';
        this.slowmo = 60; Sound.play('ko');
      } else if (!alive.length && !this.bench.length) {
        this.qualified = true; this.roundWinner = this.p1;
        this.phase = 'ko'; this.phaseT = 0; this.banner = 'QUALIFIED!';
        this.slowmo = 40; Sound.play('bell');
      }
    },
    finishQualifyAttempt() {
      this.t = 0;
      if (this.qualified) { this.screen = 'bracket'; this.stageIdx = 0; return; }
      if (this.attempt >= QUALIFY.attempts) {
        if (DEMO) { this.attempt = 1; this.startQualifyAttempt(); return; }
        this.screen = 'disqualified';
        return;
      }
      this.attempt++;
      this.startQualifyAttempt();
    },
    endRound(winner, label) {
      if (this.phase !== 'fight') return;
      if (!winner) {
        const { p1, p2 } = this;
        winner = p1.hp === p2.hp ? null : p1.hp > p2.hp ? p1 : p2;
      }
      this.roundWinner = winner;
      if (winner) this.wins[winner === this.p1 ? 0 : 1]++;
      this.phase = 'ko'; this.phaseT = 0;
      this.banner = label;
      if (label === 'K.O.') { this.slowmo = 60; Sound.play('ko'); } else Sound.play('bell');
    },
    nextRound() {
      if (this.wins[0] >= 2 || this.wins[1] >= 2) {
        const won = this.wins[0] >= 2;
        this.t = 0;
        if (DEMO) { this.stageIdx = (this.stageIdx + 1) % this.opponents.length; this.startFight(); return; }
        if (won) {
          this.stageIdx++;
          if (this.stageIdx >= this.opponents.length) {
            this.screen = 'champion';
            const u = new Set(this.unlocked); ROSTER.forEach((id) => u.add(id));
            this.newUnlock = u.size > this.unlocked.length;
            this.unlocked = [...u]; Store.set(this.unlocked);
          } else this.screen = 'bracket';
        } else this.screen = 'continue';
        return;
      }
      this.round++;
      this.startRound();
    },
    separate() {
      // bodies push apart; downed fighters and rolls pass through
      const solid = this.fighters.filter((f) => !f.airborne && f.state !== 'evade' && !f.ko && !f.entering);
      for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i], b = solid[j];
          const min = a.team === b.team ? 56 : 72;
          const d = b.x - a.x;
          if (Math.abs(d) < min) {
            const push = (min - Math.abs(d)) / 2 * (Math.sign(d) || (a.uid < b.uid ? 1 : -1));
            a.x = clamp(a.x - push, ARENA_L, ARENA_R);
            b.x = clamp(b.x + push, ARENA_L, ARENA_R);
          }
        }
      }
    },

    // ---- render
    render() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#120b18'; ctx.fillRect(0, 0, W, H);
      this.taps = [];
      if (TOUCH) syncTouchPad();
      Music.update(this.screen, this.paused);
      switch (this.screen) {
        case 'loading': text('LOADING…', W / 2, H / 2, 48); break;
        case 'title': this.drawTitle(); break;
        case 'select': this.drawSelect(); break;
        case 'bracket': this.drawBracket(); break;
        case 'fight': this.drawFight(); break;
        case 'continue': this.drawContinue(); break;
        case 'champion': this.drawChampion(); break;
        case 'qualifyIntro': this.drawQualifyIntro(); break;
        case 'disqualified': this.drawDisqualified(); break;
        case 'controls': this.drawControlsScreen(); break;
      }
    },
    // a tappable pill drawn on the canvas; onTap() checks these rects first
    tapButton(label, x, y, w, h, fn, color = '#b3202a') {
      ctx.fillStyle = color; ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
      text(label, x, y + 2, h * 0.5, '#fff', 'center', '#2a0505');
      this.taps.push({ x: x - w / 2, y: y - h / 2, w, h, fn });
    },
    // speaker toggle for music + sfx (M on a keyboard)
    drawMuteIcon(x = W - 52, y = 48) {
      const r = 32, off = Sound.muted;
      ctx.fillStyle = 'rgba(20,0,0,0.55)'; ctx.strokeStyle = off ? 'rgba(255,255,255,0.5)' : '#ffcf5a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x - 16, y - 7); ctx.lineTo(x - 8, y - 7); ctx.lineTo(x + 3, y - 16); ctx.lineTo(x + 3, y + 16);
      ctx.lineTo(x - 8, y + 7); ctx.lineTo(x - 16, y + 7); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = off ? '#ff5a5a' : '#fff'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.beginPath();
      if (off) { ctx.moveTo(x + 9, y - 8); ctx.lineTo(x + 20, y + 8); ctx.moveTo(x + 20, y - 8); ctx.lineTo(x + 9, y + 8); }
      else { ctx.arc(x + 4, y, 9, -0.9, 0.9); ctx.moveTo(x + 4 + 16 * Math.cos(-0.9), y + 16 * Math.sin(-0.9)); ctx.arc(x + 4, y, 16, -0.9, 0.9); }
      ctx.stroke(); ctx.lineCap = 'butt';
      this.taps.push({ x: x - r - 8, y: y - r - 8, w: 2 * r + 16, h: 2 * r + 16, fn: () => Music.toggle() });
    },
    onTap(x, y) {
      const hit = (this.taps || []).find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      Sound.init(); Music.start();
      if (hit) { hit.fn(); return; }
      if (this.screen === 'fight' || this.screen === 'select' || this.screen === 'continue' || this.screen === 'controls') return;
      pressKey('Enter'); releaseKey('Enter');
    },
    drawBackdrop(top, bottom) {
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, top); gr.addColorStop(1, bottom);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let i = 0; i < 14; i++) {
        ctx.save(); ctx.translate(W / 2, H * 1.1); ctx.rotate(-1.2 + i * 0.18 + Math.sin(this.t / 200) * 0.03);
        ctx.fillRect(-20, -1400, 40, 1400); ctx.restore();
      }
    },
    drawTitle() {
      const art = IMG.keyart;
      if (art) {
        // cover-fit the key art; the logo sits in the open sky above Ant's hat
        const k = Math.max(W / art.width, H / art.height);
        ctx.drawImage(art, (W - art.width * k) / 2, (H - art.height * k) / 2, art.width * k, art.height * k);
        let g = ctx.createLinearGradient(0, 0, 0, 230);
        g.addColorStop(0, 'rgba(20,0,0,0.55)'); g.addColorStop(1, 'rgba(20,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, 230);
        g = ctx.createLinearGradient(0, H - 120, 0, H);
        g.addColorStop(0, 'rgba(15,0,0,0)'); g.addColorStop(1, 'rgba(15,0,0,0.85)');
        ctx.fillStyle = g; ctx.fillRect(0, H - 120, W, 120);
        ctx.font = `104px ${FONT}`;
        const wAnt = ctx.measureText("ANT'S ").width, wAll = ctx.measureText("ANT'S COMBAT").width;
        const x0 = W / 2 - wAll / 2;
        text("ANT'S", x0, 78, 104, '#ffcf5a', 'left', '#2a0505', 14);
        text('COMBAT', x0 + wAnt, 78, 104, '#fff', 'left', '#2a0505', 14);
        text('GAUNTLET', W / 2, 166, 68, '#ffb070', 'center', '#2a0505', 10);
        if ((this.t >> 5) % 2) text(prompt('PRESS ENTER', 'TAP TO START'), W / 2, 666, 40, '#fff', 'center', '#2a0505');
        if (!TOUCH) this.drawTitleKeys(W / 2, 704, 17);
        this.drawMuteIcon();
        return;
      }
      this.drawBackdrop('#3b1530', '#e0703a');
      const ant = CHARACTERS.ant;
      drawFrame('ant', 'getup_2', W * 0.72, 690, charScale(ant) * 1.9, -1, {});
      drawFrame('competitor3', 'portal', W * 0.12, 700, charScale(CHARACTERS.competitor3) * 1.2, 1, { filter: 'brightness(0.35)' });
      text("ANT'S", 380, 170, 130, '#ffcf5a', 'center', '#2a0d05', 16);
      text('COMBAT', 380, 290, 120, '#fff', 'center', '#2a0d05', 16);
      text('GAUNTLET', 380, 395, 72, '#ffb070', 'center', '#2a0d05', 10);
      if ((this.t >> 5) % 2) text(prompt('PRESS ENTER', 'TAP TO START'), 380, 560, 44, '#fff');
      if (!TOUCH) this.drawTitleKeys(380, 650, 20);
      this.drawMuteIcon();
    },
    // desktop title: a CONTROLS button (top left, like the speaker top right) and a one-line hint
    drawTitleKeys(x, y, size) {
      if (!BINDABLE) return;
      this.tapButton('CONTROLS  (C)', 142, 48, 230, 52, () => { Sound.play('select'); this.openControls('title'); }, 'rgba(40,10,10,0.8)');
      text(Binds.custom ? 'Playing with YOUR keys   ·   C  controls   ·   M  music' : 'Default keys   ·   C  set your own controls   ·   M  music',
        x, y, size, 'rgba(255,255,255,0.8)', 'center', null);
    },
    drawSelect() {
      this.drawBackdrop('#1b1030', '#4a1f3a');
      text('CHOOSE YOUR FIGHTER', W / 2, 70, 58, '#ffcf5a');
      this.drawMuteIcon(W - 46, 52);
      const cw = 192, gap = 14;
      ROSTER.forEach((id, i) => {
        const row = Math.floor(i / SEL_COLS), n = selRowLen(row), x0 = (W - (cw * n + gap * (n - 1))) / 2;
        const c = CHARACTERS[id], x = x0 + (i % SEL_COLS) * (cw + gap), y = 105 + row * 263, sel = i === this.selIndex;
        const locked = !this.unlocked.includes(id);
        ctx.fillStyle = sel ? 'rgba(255,207,90,0.18)' : 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.roundRect(x, y, cw, 248, 16); ctx.fill();
        ctx.lineWidth = sel ? 5 : 2; ctx.strokeStyle = sel ? '#ffcf5a' : 'rgba(255,255,255,0.2)'; ctx.stroke();
        const bob = sel ? Math.sin(this.t / 10) * 4 : 0;
        drawFrame(c.sprite, 'idle', x + cw / 2, y + 172 + bob, charScale(c) * 0.62, 1, locked ? { filter: 'brightness(0)', alpha: 0.85 } : {});
        text(locked ? '???' : c.name, x + cw / 2, y + 201, 29, locked ? '#888' : c.color);
        text(locked ? 'beat the gauntlet to unlock' : c.title, x + cw / 2, y + 226, 14, '#ddd', 'center', null);
        if (locked) text('LOCKED', x + cw / 2, y + 108, 34, '#ff5a5a');
        // touch: first tap picks the card, a second tap on it starts
        this.taps.push({ x, y, w: cw, h: 248, fn: () => {
          if (this.selIndex === i) this.onKey('Enter');
          else { this.selIndex = i; Sound.play('select'); }
        } });
      });
      if (TOUCH) {
        this.tapButton(`FIGHT AS ${CHARACTERS[ROSTER[this.selIndex]].name}`, W / 2, 668, 460, 76, () => this.onKey('Enter'));
        return;
      }
      text('← → ↑ ↓  choose     ENTER  select', W / 2, 650, 24, '#fff', 'center', null);
      this.drawControls(W / 2, 690);
    },
    drawControls(cx, y) {
      // the player's own keys, on two lines (one line is too long)
      const arrow = { left: ' / ←', right: ' / →', jump: ' / ↑', block: ' / ↓' };
      const items = [...BIND_ACTIONS.map((a) => `${keyName(Binds.key(a.id))}${arrow[a.id] || ''} ${a.label}`), 'Esc Pause'], half = Math.ceil(items.length / 2);
      text(items.slice(0, half).join('   ·   '), cx, y - 10, 14, 'rgba(255,255,255,0.7)', 'center', null);
      text(items.slice(half).join('   ·   '), cx, y + 10, 14, 'rgba(255,255,255,0.7)', 'center', null);
    },
    drawBracket() {
      this.drawBackdrop('#101a2c', '#3b1f3a');
      text('THE GAUNTLET', W / 2, 64, 64, '#ffcf5a');
      // You on the left, then every opponent in this run's random order along a
      // gently waving path. Opponents stay hidden until you reach them.
      const me = CHARACTERS[this.playerId], n = this.opponents.length;
      portrait(me, 40, 250, 150, false);
      text(me.name, 115, 430, 32, me.color);
      text('YOU', 115, 462, 20, '#fff', 'center', null);
      text(`FIGHT ${Math.min(this.stageIdx + 1, n)} OF ${n}`, W / 2, 118, 26, '#fff', 'center', null);
      const x0 = 230, span = (W - 30 - x0) / n;
      const slot = (i) => ({ x: x0 + i * span + span / 2, y: 330 + (i % 2 ? 40 : -40) });
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4; ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(190, 325);
      for (let i = 0; i < n; i++) { const s = slot(i); ctx.lineTo(s.x, s.y); }
      ctx.stroke(); ctx.setLineDash([]);
      this.opponents.forEach((id, i) => {
        const c = CHARACTERS[id], s = slot(i);
        const done = i < this.stageIdx, cur = i === this.stageIdx, reveal = done || cur;
        const size = cur ? 128 : 100, x = s.x - size / 2, y = s.y - size / 2;
        portrait(c, x, y, size, true, !reveal);
        text(reveal ? c.name : '???', s.x, y + size + 20, cur ? 24 : 18, reveal ? c.color : '#999');
        if (done) {
          ctx.strokeStyle = '#ff4a4a'; ctx.lineWidth = 8;
          ctx.beginPath(); ctx.moveTo(x + 12, y + 12); ctx.lineTo(x + size - 12, y + size - 12);
          ctx.moveTo(x + size - 12, y + 12); ctx.lineTo(x + 12, y + size - 12); ctx.stroke();
        }
        if (cur) {
          const pulse = 1 + Math.sin(this.t / 8) * 0.04;
          ctx.save(); ctx.translate(s.x, y - 20); ctx.scale(pulse, pulse);
          text('NEXT', 0, 0, 26, '#ffcf5a'); ctx.restore();
        }
      });
      if (this.stageIdx < n) {
        const c = CHARACTERS[this.opponents[this.stageIdx]];
        text(`${c.name} awaits at ${this.stage().name}`, W / 2, 560, 30, '#ffd9b0', 'center', null);
      }
      if ((this.t >> 5) % 2 && this.t > 20) text(prompt('PRESS ENTER TO FIGHT', 'TAP TO FIGHT'), W / 2, 680, 36, '#fff');
    },
    drawFight() {
      const p1 = this.p1;
      ctx.save();
      if (this.shake) ctx.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake) * 0.6);
      // overdraw so shake never shows an edge
      ctx.drawImage(this.stageCanvas || IMG.stage_qualify, -16, -9, W + 32, H + 18);
      if (this.mode === 'qualify') this.drawBench();
      // shadows
      for (const f of this.fighters) {
        const s = clamp(1 + f.y / 300, 0.4, 1) * (f.c.size || 1);
        ctx.fillStyle = `rgba(0,0,0,${f.ko && f.c.goon ? 0.2 : 0.35})`;
        ctx.beginPath(); ctx.ellipse(f.x, FLOOR + 2, 62 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      }
      // downed fighters underneath, attackers on top
      const rank = (f) => (f.ko ? 0 : f.state === 'attack' ? 2 : 1);
      [...this.fighters].sort((a, b) => rank(a) - rank(b)).forEach((f) => f.draw());
      if (this.mode === 'qualify') this.drawGoonBars();
      for (const s of this.shots) this.drawShot(s);
      for (const p of this.parts) {
        if (p.ring) {
          ctx.strokeStyle = `rgba(255,240,190,${p.life / 10})`; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
          ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          ctx.globalAlpha = 1;
        }
      }
      if (params.has('boxes')) {
        this.drawBoxes();
        const foes = this.enemies.map((f) => `${f.c.name}:${f.state}:${f.hp}`).join('  ');
        text(`${this.mode} stage ${this.stageIdx} round ${this.round} attempt ${this.attempt} phase ${this.phase} | ${p1.state} ${p1.hp} vs ${foes}`, W / 2, 160, 16, '#0f0', 'center', '#000', 3);
      }
      ctx.restore();
      this.drawHud();
      if (!TOUCH && !DEMO && !this.paused) { this.drawKeyStrip(); this.drawPauseButton(); }
      this.drawBanner();
      if (this.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
        if (TOUCH) {
          text('PAUSED', W / 2, 250, 90, '#ffcf5a');
          this.tapButton('RESUME', W / 2 - 170, 400, 300, 96, () => { this.paused = false; Sound.play('select'); });
          this.tapButton('QUIT', W / 2 + 170, 400, 300, 96, () => { this.paused = false; this.screen = 'title'; }, '#3a2a30');
          this.tapButton(Sound.muted ? 'SOUND: OFF' : 'SOUND: ON', W / 2, 530, 300, 76, () => Music.toggle(), '#3a2a30');
        } else this.drawPauseMenu();
      }
    },
    drawShot(s) {
      if (s.kind === 'bullet') {
        const gr = ctx.createLinearGradient(s.x - s.dir * 60, 0, s.x, 0);
        gr.addColorStop(0, 'rgba(255,200,80,0)'); gr.addColorStop(1, 'rgba(255,240,180,1)');
        ctx.strokeStyle = gr; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x - s.dir * 60, s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        const r = s.r * (1 + Math.sin(s.t / 3) * 0.12);
        const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 1.8);
        const core = s.kind === 'missile' ? '200,170,255' : '150,210,255';
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, `rgba(${core},0.95)`); gr.addColorStop(1, `rgba(${core},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.8, 0, Math.PI * 2); ctx.fill();
        if (s.t % 2 === 0) this.parts.push({ x: s.x - s.dir * r, y: s.y + rand(-r / 2, r / 2), vx: -s.dir * rand(0.5, 2), vy: rand(-0.5, 0.5), life: 16, max: 16, color: `rgba(${core},0.8)`, size: rand(3, 7), g: 0 });
      }
    },
    drawBoxes() {
      for (const f of this.fighters) {
        const h = f.hurtbox(); ctx.strokeStyle = '#0f0'; ctx.lineWidth = 2; ctx.strokeRect(h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0);
        for (const b of f.activeHitboxes()) { ctx.strokeStyle = '#f00'; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      }
    },
    drawHud() {
      const p1 = this.p1, barW = 480, barH = 30, y = 38;
      const bar = (f, x, rtl) => {
        const frac = f.hp / f.c.hp, shown = f.shownHp / f.c.hp;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 4, y - 4, barW + 8, barH + 8);
        ctx.fillStyle = '#5a1010'; ctx.fillRect(x, y, barW, barH);
        const drawSeg = (w, col) => { ctx.fillStyle = col; rtl ? ctx.fillRect(x + barW - w, y, w, barH) : ctx.fillRect(x, y, w, barH); };
        drawSeg(barW * shown, '#ff4b3a');
        const gr = ctx.createLinearGradient(0, y, 0, y + barH);
        gr.addColorStop(0, frac > 0.3 ? '#ffe36a' : '#ff8a4a'); gr.addColorStop(1, frac > 0.3 ? '#e0a020' : '#d0401a');
        drawSeg(barW * frac, gr);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, barW, barH);
      };
      const ready = (f, name, label, x, align) => {
        const mv = f.c.moves[name]; if (!mv || !mv.cool) return;
        const left = f.cool[name] || 0;
        text(`${label} ${left ? Math.ceil(left / 60) + 's' : 'READY'}`, x, 128, 16, left ? '#aaa' : '#7dff9a', align, '#000', 3);
      };
      if (this.mode === 'qualify') {
        bar(p1, 130, false);
        portrait(p1.c, 24, 18, 94, false);
        text(p1.c.name, 136, 92, 30, p1.c.color, 'left');
        ready(p1, 'shoot', 'GUN', 136, 'left'); ready(p1, 'special', 'SPEC', 250, 'left');
        text('QUALIFYING', W / 2 + 95, 36, 30, '#ffcf5a');
        // attempts left as hearts-style pips
        for (let i = 0; i < QUALIFY.attempts; i++) {
          const left = QUALIFY.attempts - this.attempt + 1;
          ctx.fillStyle = i < left ? '#ff5a5a' : 'rgba(0,0,0,0.5)';
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(W / 2 + 40 + i * 30, 76, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        text(`TRY ${this.attempt}/${QUALIFY.attempts}`, W / 2 + 140, 76, 20, '#fff', 'left', '#000', 3);
        // goon roster: one tile per goon, crossed out when beaten
        const down = this.goonsDown();
        QUALIFY.goons.forEach((id, i) => {
          const x = W - 60 - (QUALIFY.goons.length - 1 - i) * 62, yy = 20;
          portrait(CHARACTERS[id], x - 26, yy, 52, true, false);
          if (i < down) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 26, yy, 52, 52);
            ctx.strokeStyle = '#ff4a4a'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(x - 20, yy + 6); ctx.lineTo(x + 20, yy + 46); ctx.moveTo(x + 20, yy + 6); ctx.lineTo(x - 20, yy + 46); ctx.stroke();
          }
        });
        text(`GOONS LEFT ${this.goonTotal - down}`, W - 30, 96, 24, '#fff', 'right');
        return;
      }
      const p2 = this.p2;
      // bars are anchored at the outer edge and drain toward the timer
      bar(p1, 130, false);
      bar(p2, W - 130 - barW, true);
      portrait(p1.c, 24, 18, 94, false);
      portrait(p2.c, W - 118, 18, 94, true);
      text(p1.c.name, 136, 92, 30, p1.c.color, 'left');
      text(p2.c.name, W - 136, 92, 30, p2.c.color, 'right');
      for (let i = 0; i < 2; i++) {
        for (const [side, won] of [[-1, this.wins[0]], [1, this.wins[1]]]) {
          const cx = W / 2 + side * (70 + i * 26);
          ctx.fillStyle = i < won ? '#ffcf5a' : 'rgba(0,0,0,0.5)';
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, 96, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      const secs = Math.ceil(this.timer / 60);
      text(String(secs), W / 2, 54, 58, secs <= 10 ? '#ff5a5a' : '#fff');
      ready(p1, 'shoot', 'GUN', 136, 'left'); ready(p1, 'special', 'SPEC', 250, 'left');
    },
    // desktop only: a keycap strip under the fighters so the controls are always on screen.
    // Caps light up while held; GUN/SPEC show their recharge like the touch pad does.
    drawKeyStrip() {
      const p1 = this.p1, y = 694, capH = 34;
      const held = (codes) => codes.some((c) => keys.has(c));
      // caps show the player's keys; `codes` are what those keys press, so holding lights them
      const k = (...ids) => ids.map((id) => keyName(Binds.key(id))).join(' ');
      const items = [
        { k: `${k('left', 'right')} ←→`, l: 'MOVE', codes: ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'] },
        { k: `${k('jump')} ↑`, l: 'JUMP', codes: ['KeyW', 'ArrowUp'] },
        { k: `${k('block')} ↓`, l: 'BLOCK', codes: ['KeyS', 'ArrowDown'] },
        { k: k('roll'), l: 'ROLL', codes: ['Space'] },
        { k: k('flipF', 'flipB'), l: 'FLIP', codes: ['KeyE', 'KeyQ'] },
        ...['PUNCH', 'KICK', 'UPPER', 'ROUND', 'GUN', 'SPEC'].map((l, i) => {
          const name = ATTACK_ORDER[i], left = p1.cool[name] || 0;
          return { k: k(name), l: left ? `${Math.ceil(left / 60)}s` : l, codes: [BIND_BY_ID[name].code], attack: true, off: !p1.c.moves[name] || left > 0 };
        }),
      ];
      // measure first so the whole strip can be centred
      const gap = 18, groupGap = 44;
      for (const it of items) {
        ctx.font = `${it.attack ? 22 : 17}px ${FONT}`; it.capW = Math.max(capH, ctx.measureText(it.k).width + 18);
        ctx.font = `17px ${FONT}`; it.w = it.capW + 7 + ctx.measureText(it.l).width;
      }
      const total = items.reduce((s, it) => s + it.w, 0) + gap * (items.length - 2) + groupGap;
      let x = W / 2 - total / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.roundRect(x - 16, y - capH / 2 - 7, total + 32, capH + 14, 12); ctx.fill();
      items.forEach((it, i) => {
        const on = held(it.codes);
        ctx.globalAlpha = it.off && !on ? 0.45 : 1;
        this.keycap(it.k, x, y, it.capW, capH, it.attack, on);
        text(it.l, x + it.capW + 7, y + 1, 17, it.attack ? '#ffe6b0' : 'rgba(255,255,255,0.8)', 'left', '#000', 3);
        ctx.globalAlpha = 1;
        x += it.w + (i === 4 ? groupGap : gap);
      });
    },
    keycap(k, x, y, w, h, attack, on) {
      ctx.fillStyle = on ? 'rgba(255,90,60,0.9)' : attack ? 'rgba(150,20,20,0.85)' : 'rgba(40,30,45,0.9)';
      ctx.strokeStyle = on || attack ? '#ffcf5a' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 7); ctx.fill(); ctx.stroke();
      text(k, x + w / 2, y + 1, attack ? 22 : 17, '#fff', 'center', null);
    },
    // desktop: an always-visible pause button under the timer (click it or press ESC / P)
    drawPauseButton() {
      const x = W / 2, y = 134, w = 150, h = 36;
      const on = keys.has('Escape') || keys.has('KeyP');
      ctx.fillStyle = on ? 'rgba(255,90,60,0.9)' : 'rgba(0,0,0,0.55)'; ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
      // two bars = the universal pause icon
      ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2 + 18, y - 9, 5, 18); ctx.fillRect(x - w / 2 + 27, y - 9, 5, 18);
      text('PAUSE', x - w / 2 + 42, y + 1, 18, '#fff', 'left', '#000', 3);
      text('ESC', x + w / 2 - 14, y + 1, 14, '#ffcf5a', 'right', null);
      this.taps.push({ x: x - w / 2, y: y - h / 2, w, h, fn: () => this.onKey('Escape') });
    },
    // desktop pause: a small controls card plus clickable resume / quit / sound
    drawPauseMenu() {
      text('PAUSED', W / 2, 92, 76, '#ffcf5a');
      const px = 250, py = 150, pw = W - 500, ph = 380;
      ctx.fillStyle = 'rgba(20,10,24,0.92)'; ctx.strokeStyle = 'rgba(255,207,90,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18); ctx.fill(); ctx.stroke();
      text('CONTROLS', W / 2, py + 34, 30, '#fff');
      const key = (id) => keyName(Binds.key(id));
      const cols = [
        { x: px + 50, head: 'MOVE', rows: [[`${key('left')} ${key('right')} ←→`, 'Walk left / right'], [`${key('jump')} ↑`, 'Jump'], [`${key('block')} ↓`, 'Block (hold)'], [key('roll'), 'Evade roll'], [key('flipF'), 'Front flip'], [key('flipB'), 'Back flip']] },
        { x: px + pw / 2 + 30, head: 'FIGHT', attack: true, rows: BIND_ACTIONS.filter((a) => a.attack).map((a) => [key(a.id), a.label]) },
      ];
      for (const col of cols) {
        text(col.head, col.x, py + 80, 20, col.attack ? '#ff8a6a' : '#9ad0ff', 'left', null);
        col.rows.forEach(([k, l], i) => {
          const y = py + 120 + i * 42;
          ctx.font = `${col.attack ? 22 : 17}px ${FONT}`;
          const w = Math.max(36, ctx.measureText(k).width + 18);
          this.keycap(k, col.x, y, w, 34, col.attack, false);
          text(l, col.x + Math.max(84, w + 14), y + 1, 19, '#fff', 'left', '#000', 3);
        });
      }
      this.tapButton('RESUME  (ESC)', W / 2 - 438, 600, 262, 58, () => this.onKey('Escape'));
      this.tapButton('CONTROLS  (C)', W / 2 - 146, 600, 262, 58, () => this.onKey('KeyC'), '#3a2a30');
      this.tapButton(`SOUND ${Sound.muted ? 'OFF' : 'ON'}  (M)`, W / 2 + 146, 600, 262, 58, () => Music.toggle(), '#3a2a30');
      this.tapButton('QUIT  (Q)', W / 2 + 438, 600, 262, 58, () => this.onKey('KeyQ'), '#3a2a30');
    },
    drawControlsScreen() {
      const c = this.ctl, n = BIND_ACTIONS.length;
      this.drawBackdrop('#1b1030', '#4a1f3a');
      const setup = c.mode === 'setup', capture = c.mode === 'capture', blink = (this.t >> 4) % 2;
      const cur = setup ? c.step : c.sel;
      text(setup ? 'SET YOUR CONTROLS' : 'CONTROLS', W / 2, 62, 58, '#ffcf5a');
      if (setup || capture) {
        const act = BIND_ACTIONS[cur];
        text(setup ? 'PRESS A KEY FOR' : 'PRESS A NEW KEY FOR', W / 2, 124, 26, '#fff', 'center', null);
        text(act.label.toUpperCase(), W / 2, 168, 46, act.attack ? '#ff8a6a' : '#9ad0ff');
        text(setup ? `${c.step + 1} of ${n}   ·   BACKSPACE go back   ·   ESC cancel` : 'ESC cancel', W / 2, 208, 17, 'rgba(255,255,255,0.7)', 'center', null);
      } else {
        // the two options: the original layout, or keys the player picked
        const pill = (label, x, on, fn) => {
          const w = 250, h = 50;
          ctx.fillStyle = on ? '#b3202a' : 'rgba(40,30,45,0.9)'; ctx.strokeStyle = on ? '#ffcf5a' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = on ? 4 : 2;
          ctx.beginPath(); ctx.roundRect(x - w / 2, 128 - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
          text((on ? '✓ ' : '') + label, x, 130, 24, on ? '#fff' : 'rgba(255,255,255,0.7)', 'center', on ? '#2a0505' : null);
          this.taps.push({ x: x - w / 2, y: 128 - h / 2, w, h, fn });
        };
        pill('DEFAULT KEYS', W / 2 - 140, !Binds.custom, () => { if (Binds.custom) this.ctlUseDefaults(); });
        pill('MY KEYS', W / 2 + 140, Binds.custom, () => { if (!Binds.custom) this.ctlSetupAll(); });
        text(Binds.custom ? 'Click a key to change it (or ↑ ↓ ← → and ENTER). R = back to default keys.'
          : 'Click any key to change it, or MY KEYS to set them all. J K U I L O and the num pad also attack.',
        W / 2, 180, 18, 'rgba(255,255,255,0.8)', 'center', null);
        text('Arrows always work:  ← → move   ·   ↑ jump   ·   ↓ block', W / 2, 206, 18, '#9ad0ff', 'center', null);
      }
      if (c.msg && this.t - c.msgT < 240) text(c.msg, W / 2, 238, 22, '#ffcf5a', 'center', '#000', 3);

      // two columns: MOVE on the left, FIGHT on the right; every row is clickable in edit mode
      const px = 170, py = 262, pw = W - 340, ph = 340, rowH = 40, col = BIND_ACTIONS.findIndex((a) => a.attack);
      ctx.fillStyle = 'rgba(20,10,24,0.92)'; ctx.strokeStyle = 'rgba(255,207,90,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18); ctx.fill(); ctx.stroke();
      text('MOVE', px + 40, py + 28, 20, '#9ad0ff', 'left', null);
      text('FIGHT', px + pw / 2 + 20, py + 28, 20, '#ff8a6a', 'left', null);
      BIND_ACTIONS.forEach((a, i) => {
        const right = i >= col, x = right ? px + pw / 2 + 20 : px + 40, y = py + 66 + (right ? i - col : i) * rowH;
        const rw = pw / 2 - 60, here = i === cur;
        if (here) {
          ctx.fillStyle = 'rgba(255,207,90,0.16)'; ctx.strokeStyle = '#ffcf5a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(x - 10, y - rowH / 2 + 2, rw, rowH - 4, 8); ctx.fill(); ctx.stroke();
        }
        const code = c.draft[a.id], waiting = here && (setup || capture);
        const label = waiting ? (blink ? '_' : ' ') : code ? keyName(code) : '';
        ctx.font = `${a.attack ? 22 : 17}px ${FONT}`;
        const w = Math.max(44, ctx.measureText(label).width + 18);
        ctx.globalAlpha = !code && !waiting ? 0.4 : 1;
        this.keycap(label, x, y, w, 32, a.attack, waiting);
        ctx.globalAlpha = 1;
        text(a.label, x + Math.max(100, w + 14), y + 1, 19, '#fff', 'left', '#000', 3);
        if (c.mode === 'edit') {
          this.taps.push({ x: x - 10, y: y - rowH / 2, w: rw, h: rowH, fn: () => { c.sel = i; c.mode = 'capture'; c.msg = ''; Sound.play('select'); } });
        }
      });
      if (c.mode === 'edit') {
        this.tapButton('DONE  (ESC)', W / 2 - 170, 662, 300, 60, () => this.bindKey('Escape'));
        this.tapButton('SET ALL KEYS', W / 2 + 170, 662, 300, 60, () => this.ctlSetupAll(), '#3a2a30');
      }
    },
    // goons still waiting their turn, standing along the back of the stage
    drawBench() {
      this.bench.forEach((b, i) => {
        const c = CHARACTERS[b.id];
        const bob = Math.sin((this.t + i * 23) / 9) * 3;
        drawFrame(c.sprite, 'idle', b.x, FLOOR - 70 + bob, charScale(c) * 0.72, -b.side,
          { alias: c.alias, filter: `${c.tint || ''} brightness(0.45) blur(0.6px)` });
      });
    },
    drawGoonBars() {
      for (const f of this.enemies) {
        if (f.ko || f.entering) continue;
        const w = 70, x = f.x - w / 2, y = f.feetY - TARGET_H * (f.c.size || 1) - 26;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 2, y - 2, w + 4, 10);
        ctx.fillStyle = '#ff5a3a'; ctx.fillRect(x, y, w * (f.shownHp / f.c.hp), 6);
        ctx.fillStyle = '#ffe36a'; ctx.fillRect(x, y, w * (f.hp / f.c.hp), 6);
        text(f.c.name, f.x, y - 12, 15, f.c.color, 'center', '#000', 3);
      }
    },
    drawQualifyIntro() {
      this.drawBackdrop('#2a1408', '#a0542a');
      text('QUALIFYING ROUND', W / 2, 80, 72, '#ffcf5a');
      text(`Beat all ${QUALIFY.goons.length} goons to earn your place in the gauntlet.`, W / 2, 150, 28, '#fff', 'center', null);
      text(`You get ${QUALIFY.attempts} tries. Lose all ${QUALIFY.attempts} and you're out.`, W / 2, 188, 24, '#ffd9b0', 'center', null);
      const n = QUALIFY.goons.length, cw = 180, x0 = W / 2 - (n * cw) / 2 + cw / 2;
      QUALIFY.goons.forEach((id, i) => {
        const c = CHARACTERS[id], x = x0 + i * cw;
        const bob = Math.sin((this.t + i * 17) / 10) * 3;
        drawFrame(c.sprite, 'idle', x, 540 + bob, charScale(c) * 0.95, -1, { alias: c.alias, filter: c.tint });
        text(c.name, x, 580, 24, c.color);
        text(c.title, x, 606, 15, '#eee', 'center', null);
      });
      if (CHARACTERS[QUALIFY.goons[0]].isPlaceholder) {
        text('stand-in goon art: run tools/generate_all.py for the real goons', W / 2, 250, 16, 'rgba(255,255,255,0.55)', 'center', null);
      }
      if (this.t > 20 && (this.t >> 5) % 2) text(prompt('PRESS ENTER TO FIGHT', 'TAP TO FIGHT'), W / 2, 680, 36, '#fff');
    },
    drawDisqualified() {
      this.drawBackdrop('#1a0508', '#3a0a12');
      text('DISQUALIFIED', W / 2, 220, 110, '#ff4a4a');
      text(`The goons beat you ${QUALIFY.attempts} times. The gauntlet will have to wait.`, W / 2, 330, 28, '#fff', 'center', null);
      if (this.t > 60 && (this.t >> 5) % 2) text(prompt('PRESS ENTER', 'TAP TO CONTINUE'), W / 2, 520, 40, '#fff');
    },
    drawBanner() {
      if (this.phase === 'intro') {
        const t = this.phaseT;
        if (t < 80) {
          const s = clamp(t / 12, 0, 1);
          const q = this.mode === 'qualify';
          const head = q ? `TRY ${this.attempt} OF ${QUALIFY.attempts}` : this.round === 3 ? 'FINAL ROUND' : `ROUND ${this.round}`;
          ctx.save(); ctx.translate(W / 2, H / 2 - 60); ctx.scale(s, s);
          text(head, 0, 0, 96, '#ffcf5a'); ctx.restore();
          if (q) text(`QUALIFYING · ${QUALIFY.stage}`, W / 2, H / 2 + 20, 30, '#fff');
          else if (this.round === 1) text(this.stage().name, W / 2, H / 2 + 20, 30, '#fff');
        } else {
          const s = 1 + Math.max(0, (95 - t) / 15);
          ctx.save(); ctx.translate(W / 2, H / 2 - 60); ctx.scale(s, s);
          text('FIGHT!', 0, 0, 120, '#ff5a3a'); ctx.restore();
        }
      } else if (this.phase === 'ko') {
        const t = this.phaseT;
        if (t < 110) {
          const s = clamp(t / 10, 0, 1) * (1 + Math.sin(t / 5) * 0.03);
          ctx.save(); ctx.translate(W / 2, H / 2 - 60); ctx.scale(s, s);
          text(this.banner, 0, 0, 150, '#ff3a3a', 'center', '#fff', 10); ctx.restore();
        } else if (this.mode === 'qualify') {
          if (this.qualified) text('ON TO THE GAUNTLET', W / 2, H / 2 - 60, 80, '#ffcf5a');
          else {
            const left = QUALIFY.attempts - this.attempt;
            text(left ? `${left} ${left === 1 ? 'TRY' : 'TRIES'} LEFT` : 'OUT OF TRIES', W / 2, H / 2 - 60, 90, '#ff6a5a');
          }
        } else {
          const w = this.roundWinner;
          const msg = !w ? 'DRAW' : w === this.p1 ? (DEMO ? `${w.c.name} WINS` : 'YOU WIN') : `${w.c.name} WINS`;
          text(msg, W / 2, H / 2 - 60, 96, w === this.p1 ? '#ffcf5a' : '#ff6a5a');
        }
      }
    },
    drawContinue() {
      this.drawBackdrop('#1a0508', '#3a0a12');
      const opp = CHARACTERS[this.opponents[this.stageIdx]];
      drawFrame(opp.sprite, opp.frames.win, W * 0.7, 660, charScale(opp) * 1.6, -1, {});
      text('DEFEATED', 420, 200, 110, '#ff4a4a');
      text(`${opp.name} stands over you.`, 420, 300, 32, '#fff', 'center', null);
      const secs = Math.max(0, 10 - Math.floor(this.t / 60));
      if (secs === 0 && this.t > 600) { this.screen = 'title'; return; }
      text('CONTINUE?', 420, 420, 64, '#ffcf5a');
      text(String(secs), 420, 510, 80, '#fff');
      if (TOUCH) {
        this.tapButton('RETRY', 280, 620, 240, 84, () => this.onKey('Enter'));
        this.tapButton('GIVE UP', 560, 620, 240, 84, () => this.onKey('Escape'), '#3a2a30');
      } else text('ENTER retry this fight   ·   ESC give up', 420, 610, 24, '#ddd', 'center', null);
    },
    drawChampion() {
      this.drawBackdrop('#3a2a08', '#e0a030');
      const me = CHARACTERS[this.playerId];
      drawFrame(me.sprite, me.frames.win, W * 0.72, 690, charScale(me) * 1.9, -1, {});
      text('GAUNTLET', 420, 170, 110, '#fff');
      text('CHAMPION', 420, 290, 110, '#ffcf5a', 'center', '#3a1a00', 14);
      const secs = Math.round(this.totalTicks / 60);
      text(`${me.name} beat all ${this.opponents.length} challengers`, 420, 390, 30, '#fff', 'center', null);
      text(`fight time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}   ·   continues used ${this.continues}`, 420, 430, 24, '#fff', 'center', null);
      if (this.newUnlock) text('ALL FIGHTERS UNLOCKED!', 420, 510, 44, '#7dff9a');
      if (this.t > 60 && (this.t >> 5) % 2) text(prompt('PRESS ENTER', 'TAP TO CONTINUE'), 420, 610, 36, '#fff');
    },
  };
  window.__ANT = game;

  // ---------------------------------------------------------------- touch controls
  function setupTouch() {
    if (!TOUCH) {
      // desktop: mouse clicks work too (speaker icon, fighter cards, menus)
      canvas.addEventListener('pointerdown', (e) => {
        const r = canvas.getBoundingClientRect();
        game.onTap((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height));
      });
      return;
    }
    const pad = document.getElementById('touch');
    pad.hidden = false;
    addEventListener('contextmenu', (e) => e.preventDefault());   // long-press menu
    const portrait = matchMedia('(orientation: portrait)');
    const orient = () => document.body.classList.toggle('portrait', portrait.matches);
    portrait.addEventListener ? portrait.addEventListener('change', orient) : portrait.addListener(orient);
    orient();

    // capture keeps a held button pressed when the thumb drifts off it; it can throw, and must never eat the press
    const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* keep going */ } };
    let held = new Set(), dpadId = null;
    pad.querySelectorAll('button[data-key]').forEach((b) => {
      let code = b.dataset.key;
      const down = (e) => {
        e.preventDefault(); capture(b, e); b.classList.add('on');
        // one FLIP button = a front flip the way you hold (the d-pad turns you first) or face,
        // the same as E on desktop. (It used to be a back flip when held away from the foe,
        // but the arrows turn you in every fight now, so "away" is just the way you face.)
        if (b.dataset.key === 'flip') code = 'KeyE';
        pressKey(code);
        navigator.vibrate?.(8);
      };
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); releaseKey(code); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });

    // D-pad: one pad you can slide a thumb across (not four separate buttons), diagonals allowed,
    // so walking into a jump or from left to right never needs a lift.
    const dp = document.getElementById('dpad'), knob = dp.querySelector('.knob');
    const arrows = {}; dp.querySelectorAll('.arrow').forEach((a) => { arrows[a.dataset.dir] = a; });
    const DIRKEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' };
    const setDirs = (next) => {
      for (const d of held) if (!next.has(d)) { releaseKey(DIRKEYS[d]); arrows[d].classList.remove('on'); }
      for (const d of next) if (!held.has(d)) { pressKey(DIRKEYS[d]); arrows[d].classList.add('on'); }
      held = next;
    };
    const track = (e) => {
      const r = dp.getBoundingClientRect(), rad = r.width / 2;
      const dx = e.clientX - (r.left + rad), dy = e.clientY - (r.top + rad);
      const dist = Math.hypot(dx, dy), next = new Set();
      if (dist > rad * 0.18) {
        const nx = dx / dist, ny = dy / dist;
        if (nx < -0.38) next.add('left');
        if (nx > 0.38) next.add('right');
        if (ny < -0.6) next.add('up');
        if (ny > 0.6) next.add('down');
      }
      const k = Math.min(1, (rad * 0.55) / (dist || 1));
      knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      setDirs(next);
    };
    const endDpad = (e) => {
      if (e.pointerId !== dpadId) return;
      dpadId = null; knob.style.transform = ''; setDirs(new Set());
    };
    dp.addEventListener('pointerdown', (e) => {
      e.preventDefault(); dpadId = e.pointerId; capture(dp, e); track(e);
    });
    dp.addEventListener('pointermove', (e) => { if (e.pointerId === dpadId) track(e); });
    dp.addEventListener('pointerup', endDpad);
    dp.addEventListener('pointercancel', endDpad);

    // taps on the canvas: menus, fighter cards, pause/continue buttons
    let wentFull = false;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!wentFull && !params.has('touch')) {
        // phones: go fullscreen + landscape on the first tap where the browser allows it (Android; iPhone ignores it)
        wentFull = true;
        try {
          const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
          p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
        } catch (err) { /* not allowed */ }
      }
      const r = canvas.getBoundingClientRect();
      game.onTap((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height));
    });
    // a phone call or app switch must not leave a direction stuck down
    addEventListener('blur', () => { setDirs(new Set()); pad.querySelectorAll('.on').forEach((b) => b.classList.remove('on')); });
  }

  // show the pad only while fighting; grey out GUN/SPEC while they recharge
  let padShown = null;
  const cdButtons = [...document.querySelectorAll('#touch [data-move]')];
  function syncTouchPad() {
    const show = game.screen === 'fight' && !game.paused && !DEMO;
    if (show !== padShown) { document.getElementById('touch').classList.toggle('show', show); padShown = show; }
    if (!show || !game.p1) return;
    for (const b of cdButtons) {
      const left = game.p1.cool[b.dataset.move] || 0;
      const label = left ? `${Math.ceil(left / 60)}s` : b.dataset.label;
      if (b.textContent !== label) { b.textContent = label; b.classList.toggle('cd', !!left); }
    }
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(100, now - last);
    last = now;
    while (acc >= 1000 / 60) { game.update(); acc -= 1000 / 60; }
    game.render();
    requestAnimationFrame(frame);
  }
  // ?selftest drives the real keyboard path (pressKey -> buffer -> intent ->
  // fighter) and prints pass/fail on screen, since headless runs can't type.
  function selfTest() {
    const results = [];
    const run = (n) => { for (let i = 0; i < n; i++) game.update(); };
    const still = { intent: () => ({ dir: 0, jump: false, block: false, evade: false, attack: null }) };
    const fresh = () => {
      game.screen = 'fight'; game.mode = 'duel';
      game.startRound(); game.phase = 'fight';
      game.p1.x = 500; game.p2.x = 640;
      game.p2.ai = still;
    };
    const tap = (code, hold = 1) => { pressKey(code); run(hold); releaseKey(code); };
    const check = (name, ok, info = '') => results.push([name, !!ok, info]);
    game.beginGauntlet('ant'); game.startFight();

    fresh(); tap('KeyJ'); run(2);
    check('J starts punch', game.p1.moveName === 'punch', game.p1.state);
    run(8); check('punch lands on adjacent foe', game.p2.hp < game.p2.c.hp, `p2 hp ${game.p2.hp}`);
    // pressed early: the 8-tick input buffer must carry it into the chain window
    tap('KeyJ'); run(6); check('J again chains power punch', game.p1.moveName === 'power', game.p1.moveName);

    fresh(); tap('KeyK'); run(2); check('K starts kick', game.p1.moveName === 'kick');
    fresh(); tap('KeyU'); run(20); check('U uppercut knocks down', game.p2.state === 'knockdown', game.p2.state);
    fresh(); tap('KeyI'); run(20); check('I roundhouse knocks down', game.p2.state === 'knockdown', game.p2.state);
    fresh(); game.p2.x = 1000; tap('KeyL'); run(16);
    check('L fires a bullet', game.shots.length === 1, `shots ${game.shots.length}`);
    run(40); check('bullet hits at range', game.p2.hp < game.p2.c.hp, `p2 hp ${game.p2.hp}`);
    tap('KeyL'); run(3); check('L on cooldown', game.p1.state !== 'attack', game.p1.state);
    fresh(); game.p2.x = 1000; tap('KeyO'); run(40); check('O fires two bullets', game.shots.length + (game.p2.hp < game.p2.c.hp ? 1 : 0) >= 2, `shots ${game.shots.length}`);

    fresh(); pressKey('KeyD'); run(10); check('D walks right', game.p1.x > 500, `x ${game.p1.x.toFixed(0)}`); releaseKey('KeyD');
    fresh(); tap('KeyW'); run(5); check('W jumps', game.p1.airborne, `y ${game.p1.y.toFixed(0)}`);
    tap('KeyK'); run(2); check('attack in air = dive kick', game.p1.moveName === 'air', game.p1.moveName);
    run(60); check('lands back to idle', !game.p1.airborne && ['idle', 'walk'].includes(game.p1.state), game.p1.state);

    fresh(); pressKey('KeyS'); run(3); check('S blocks', game.p1.state === 'block');
    game.p2.startMove('punch'); run(12);
    check('block takes chip only', game.p1.hp > game.p1.c.hp - 10, `p1 hp ${game.p1.hp}`); releaseKey('KeyS');
    fresh(); tap('Space'); run(2); check('Space evades (invulnerable)', game.p1.state === 'evade' && game.p1.invuln > 0);

    fresh(); game.p2.hp = 10; tap('KeyJ'); run(12); check('KO ends round', game.phase === 'ko' && game.wins[0] === 1, `phase ${game.phase} wins ${game.wins}`);
    run(240); check('next round starts', game.round === 2 && game.phase === 'intro', `round ${game.round} phase ${game.phase}`);
    game.phase = 'fight'; game.p2.hp = 10; game.p1.x = 500; game.p2.x = 640; tap('KeyJ'); run(12); run(240);
    check('2 round wins -> bracket stage 2', game.screen === 'bracket' && game.stageIdx === 1, `${game.screen} ${game.stageIdx}`);

    // duels turn like the brawl: A (away from the foe) turns you left and walks left
    fresh(); pressKey('KeyA'); run(12);
    check('duel: A turns and walks left', game.p1.state === 'walk' && game.p1.vx < 0 && game.p1.facing === -1,
      `${game.p1.state} vx ${game.p1.vx.toFixed(1)} facing ${game.p1.facing}`);
    const seen = new Set(); for (let i = 0; i < 40; i++) { run(1); seen.add(game.p1.frame()); }
    releaseKey('KeyA');
    check('duel: walking left plays the forward walk', [...seen].every((f) => game.p1.c.frames.walk.includes(f)), [...seen].join(','));
    run(2); check('duel: no auto-turn back to the foe', game.p1.facing === -1, `facing ${game.p1.facing}`);
    pressKey('KeyD'); run(2); releaseKey('KeyD');
    check('duel: D turns back to the right', game.p1.facing === 1, `facing ${game.p1.facing}`);
    // the AI opponent still auto-faces and backs up with its guarded back-step
    fresh(); game.p1.x = 800; game.p2.x = 640; run(1);
    check('duel: AI still auto-faces the player', game.p2.facing === 1, `facing ${game.p2.facing}`);

    // qualifying round
    game.beginGauntlet('ant'); game.startQualify();
    check('qualify: 3 goons in, 3 waiting', game.enemies.length === QUALIFY.maxActive && game.bench.length === QUALIFY.goons.length - QUALIFY.maxActive,
      `in ${game.enemies.length} bench ${game.bench.length}`);
    game.phase = 'fight';
    game.enemies.forEach((f) => { f.ai = still; });
    const g0 = game.enemies[0];
    game.p1.x = g0.x - 110; g0.hp = 5; game.p1.facing = 1;
    tap('KeyJ'); run(14);
    check('qualify: punch drops a goon', g0.ko, `${g0.state} hp ${g0.hp}`);
    run(200); check('qualify: beaten goon leaves, next walks in', game.enemies.length === QUALIFY.maxActive && game.goonsDown() === 1,
      `in ${game.enemies.length} down ${game.goonsDown()}`);
    game.bench = []; game.enemies.forEach((f) => { f.hp = 0; f.ko = true; f.setState('knockdown'); f.kdGround = true; });
    run(3); check('qualify: all goons down -> QUALIFIED', game.banner === 'QUALIFIED!', `${game.phase} ${game.banner}`);
    run(240); check('qualify: then the gauntlet bracket', game.screen === 'bracket' && game.stageIdx === 0, `${game.screen}`);

    // gauntlet: every other fighter once, random order, an arena for each fight
    {
      const orders = new Set();
      for (let k = 0; k < 6; k++) { game.beginGauntlet('competitor3'); orders.add(game.opponents.join()); }
      const opp = game.opponents, n = ROSTER.length - 1;
      check(`gauntlet = all ${n} other fighters, no repeats`, opp.length === n && new Set(opp).size === n && !opp.includes('competitor3'), opp.length);
      check('gauntlet order is randomized', orders.size > 1, `${orders.size} distinct of 6`);
      check('each fight has an arena', game.fightStages.length === n && game.fightStages.every((s) => STAGES[s]), game.fightStages.join());
      check('first 6 fights use 6 different arenas', new Set(game.fightStages.slice(0, 6)).size === 6, game.fightStages.join());
      check('AI ramps from level 0 to 2', game.aiLevel(0) === 0 && game.aiLevel(n - 1) === 2, `${game.aiLevel(0)}..${game.aiLevel(n - 1)}`);
      for (const id of ['competitor8', 'competitor9', 'competitor10']) {
        game.beginGauntlet(id); game.startFight(); fresh();
        const seenF = new Set(), seenB = new Set();
        pressKey('KeyD'); for (let i = 0; i < 40; i++) { run(1); seenF.add(game.p1.frame()); } releaseKey('KeyD');
        game.p1.x = 500; game.p2.x = 900;
        pressKey('KeyA'); for (let i = 0; i < 40; i++) { run(1); seenB.add(game.p1.frame()); } releaseKey('KeyA');
        check(`${CHARACTERS[id].name} walks both ways`, seenF.size >= 3 && seenB.size >= 3, `${[...seenF].join(',')} | ${[...seenB].join(',')}`);
      }
      game.beginGauntlet('ant'); game.startFight();
      check('new fighters have their art', ['competitor8', 'competitor9', 'competitor10'].every((id) => SPRITES[id] && Object.keys(SPRITES[id]).length >= 13 &&
        Object.values(CHARACTERS[id].moves).every((mv) => mv.frames.every(([f]) => SPRITES[id][f])) &&
        Object.values(CHARACTERS[id].frames).flat().every((f) => SPRITES[id][f])), 'STARLA, KAI, ICE COLE');
      check('every fighter selectable', ROSTER.every((id) => game.unlocked.includes(id)), game.unlocked.length);
      const stiff = ROSTER.filter((id) => { const w = CHARACTERS[id].frames.walk; return w.includes('idle') || new Set(w).size < 3 || !w.every((f) => SPRITES[id][f]); });
      check('every fighter strides (3+ poses, no standing frame, art exists)', !stiff.length, stiff.join(',') || 'all 11');
      game.beginGauntlet('ant'); game.startFight();
    }

    // flips: E front flip toward the facing side, Q back flip away; untouchable in the air
    if (game.p1.c.frames.flipF) {
      fresh(); game.p2.x = 1000; tap('KeyE'); run(3);
      check('E starts a front flip', game.p1.state === 'flip' && game.p1.flipRel === 1, game.p1.state);
      check('front flip travels forward, untouchable', game.p1.vx > 0 && game.p1.invuln > 0, `vx ${game.p1.vx}`);
      const f0 = game.p1.frame(); run(20); const f1 = game.p1.frame();
      check('flip plays rotation poses', f0 !== f1 && game.p1.c.frames.flipF.includes(f1), `${f0} -> ${f1}`);
      run(60);
      check('flip lands back to idle, hittable again', game.p1.state === 'idle' && !game.p1.airborne && game.p1.invuln === 0, game.p1.state);
      fresh(); game.p2.x = 1000; tap('KeyQ'); run(3);
      check('Q starts a back flip away', game.p1.state === 'flip' && game.p1.vx < 0, `vx ${game.p1.vx}`);
      fresh(); game.p2.x = 700; game.p2.startMove('kick'); tap('KeyE'); run(25);
      check('attack passes under a flip', game.p1.hp === game.p1.c.hp, `hp ${game.p1.hp}`);
      fresh(); pressKey('KeyD'); run(12);
      check('walking forward uses the sheet walk', game.p1.c.frames.walk.includes(game.p1.frame()) && !game.p1.frame().startsWith('fwd_'), game.p1.frame()); releaseKey('KeyD');
    }

    // brawl turning: the arrows turn the player to fight goons on either side
    game.beginGauntlet('ant'); game.startQualify(); game.phase = 'fight';
    game.enemies.forEach((f) => { f.ai = still; });
    const [gl, gr] = [game.enemies[0], game.enemies[1]];
    game.p1.x = 640; gl.x = 520; gr.x = 1100; game.p1.facing = 1;   // nearest goon is BEHIND (left)
    tap('KeyA'); run(1);
    check('brawl: ← turns to face left', game.p1.facing === -1, `facing ${game.p1.facing}`);
    const hpL = gl.hp; tap('KeyJ'); run(14);
    check('brawl: punch hits the goon on the left', gl.hp < hpL, `hp ${hpL} -> ${gl.hp}`);
    run(30); tap('KeyD'); run(1);
    check('brawl: → turns back to the right', game.p1.facing === 1, `facing ${game.p1.facing}`);
    game.p1.x = 640; gl.x = 520; gr.x = 1100; run(2);
    check('brawl: no auto-turn toward the nearer goon', game.p1.facing === 1, `facing ${game.p1.facing}`);

    game.beginGauntlet('ant'); game.startQualify(); game.phase = 'fight';
    game.enemies.forEach((f) => { f.ai = still; });
    const loseTry = () => { game.p1.hp = 0; game.p1.ko = true; run(3); run(240); };
    loseTry(); check('qualify: KO costs a try', game.attempt === 2 && game.screen === 'fight' && game.enemies.length === QUALIFY.maxActive, `try ${game.attempt}`);
    game.phase = 'fight'; game.enemies.forEach((f) => { f.ai = still; });
    loseTry(); game.phase = 'fight'; game.enemies.forEach((f) => { f.ai = still; });
    loseTry(); check('qualify: 3 KOs -> disqualified', game.screen === 'disqualified', game.screen);

    // key bindings: default keys out of the box; custom keys are an option on the
    // CONTROLS screen, and then only the player's keys work in a fight
    if (!TOUCH) {
      let stash = null; try { stash = localStorage.getItem('antcombat.keys'); } catch (e) { /* private mode */ }
      const savedBefore = Binds.saved;
      BINDABLE = true; Binds.saved = null; Binds.rebuild();
      const key = (code, type = 'keydown') => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      game.screen = 'title'; key('Enter'); key('Enter', 'keyup');
      check('binds: default keys, no setup: title -> select', game.screen === 'select' && !Binds.custom, game.screen);
      game.beginGauntlet('ant'); game.startFight(); fresh();
      key('Digit1'); run(2); key('Digit1', 'keyup');
      check('binds: default 1 punches', game.p1.moveName === 'punch', game.p1.state);
      fresh(); key('KeyJ'); run(2); key('KeyJ', 'keyup');
      check('binds: default J alias still punches', game.p1.moveName === 'punch', game.p1.state);
      game.screen = 'title'; key('KeyC');
      check('binds: C on the title opens controls (default keys shown)', game.screen === 'controls' && game.ctl.mode === 'edit' && game.ctl.draft.punch === 'Digit1', game.screen);
      game.ctlSetupAll();
      key('KeyJ'); key('KeyJ', 'keyup'); key('KeyJ');
      check('binds: a key already used is refused', game.ctl.step === 1, `step ${game.ctl.step}`);
      key('Enter'); check('binds: reserved keys are refused', game.ctl.step === 1, `step ${game.ctl.step}`);
      key('Backspace'); check('binds: backspace steps back', game.ctl.step === 0 && !game.ctl.draft.left, `step ${game.ctl.step}`);
      const mine = ['KeyJ', 'KeyL', 'KeyI', 'KeyK', 'ShiftLeft', 'KeyO', 'KeyU', 'KeyF', 'KeyG', 'KeyH', 'KeyR', 'KeyT', 'KeyY'];
      for (const c of mine) key(c);
      check('binds: all 13 set -> saved', Binds.custom && game.ctl.mode === 'edit' && Binds.key('punch') === 'KeyF', Binds.key('punch'));
      check('binds: fight keys translate', Binds.translate('KeyJ', true) === 'KeyA' && Binds.translate('KeyF', true) === 'Digit1', Binds.translate('KeyJ', true));
      check('binds: old default keys do nothing in a fight', ['KeyA', 'KeyW', 'Digit1', 'Space', 'KeyE'].every((c) => Binds.translate(c, true) === null), '');
      check('binds: arrows stay standard with custom keys', Binds.translate('ArrowLeft', true) === 'KeyA' && Binds.translate('ArrowRight', true) === 'KeyD' &&
        Binds.translate('ArrowUp', true) === 'KeyW' && Binds.translate('ArrowDown', true) === 'KeyS', Binds.translate('ArrowUp', true));
      check('binds: your move keys steer menus', Binds.translate('KeyJ', false) === 'ArrowLeft', Binds.translate('KeyJ', false));
      game.ctl.sel = BIND_ACTIONS.findIndex((a) => a.id === 'punch'); key('Enter'); key('KeyJ');
      check('binds: taking a used key swaps the two', Binds.key('punch') === 'KeyJ' && Binds.key('left') === 'KeyF', `punch ${Binds.key('punch')} left ${Binds.key('left')}`);
      key('Escape'); check('binds: done -> back to the title', game.screen === 'title', game.screen);
      game.beginGauntlet('ant'); game.startFight(); fresh();
      key('KeyJ'); run(2); key('KeyJ', 'keyup');
      check('binds: your punch key punches', game.p1.moveName === 'punch', game.p1.state);
      fresh(); key('Digit1'); run(2); key('Digit1', 'keyup');
      check('binds: 1 no longer punches', game.p1.state !== 'attack', game.p1.state);
      fresh(); key('KeyL'); run(10); check('binds: your right key walks right', game.p1.x > 500, `x ${game.p1.x.toFixed(0)}`);
      key('KeyL', 'keyup'); check('binds: releasing your key stops it', !keys.has('KeyD'), [...keys].join(','));
      game.paused = true; key('KeyC'); check('binds: C in the pause menu opens controls', game.screen === 'controls', game.screen);
      key('Escape'); check('binds: done returns to the paused fight', game.screen === 'fight' && game.paused, `${game.screen} paused ${game.paused}`);
      key('KeyC'); game.ctl.sel = 0; key('Enter'); key('ArrowUp');
      check('binds: arrows cannot be given to another move', Binds.key('left') === 'KeyF' && game.ctl.mode === 'capture', Binds.key('left'));
      key('Escape'); key('KeyR');
      check('binds: R -> back to the default keys', !Binds.custom && Binds.translate('Digit1', true) === 'Digit1' && Binds.translate('KeyA', true) === 'KeyA', `custom ${Binds.custom}`);
      key('Escape');
      game.paused = false;
      BINDABLE = false; Binds.saved = savedBefore; Binds.rebuild(); keys.clear(); physDown.clear();
      try { if (stash == null) localStorage.removeItem('antcombat.keys'); else localStorage.setItem('antcombat.keys', stash); } catch (e) { /* private mode */ }
    }

    // music: one player on rotation, calm first, then hype, then back to calm; mute stops it
    const order = [Music.track];
    Music.next(); order.push(Music.track); Music.next(); order.push(Music.track);
    check('music: calm -> hype -> calm rotation', order.join() === 'late_night_heat.mp3,cold_pavement.mp3,late_night_heat.mp3', order.join(' > '));
    check('music: one player, so songs never overlap', Music.el instanceof HTMLAudioElement && !('tracks' in Music), 'single <audio>');
    Sound.muted = false; Music.gesture = true; Music.toggle();
    check('music: mute stops it', Sound.muted && Music.el.paused, `muted ${Sound.muted}`);
    Music.toggle(); Music.el.pause(); Music.gesture = false;
    try { localStorage.removeItem('antcombat.muted'); } catch (e) { /* private mode */ }

    // touch pad (only with ?touch&selftest): real pointer events on the real DOM pad
    if (TOUCH) {
      document.getElementById('touch').classList.add('show');
      const dp = document.getElementById('dpad'), r = dp.getBoundingClientRect();
      const ptr = (el, type, x, y, id = 1) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      game.beginGauntlet('ant'); game.startFight(); fresh();
      ptr(dp, 'pointerdown', r.right - 4, cy);
      check('touch: d-pad right holds D', keys.has('KeyD') && !keys.has('KeyW'), [...keys].join(','));
      ptr(dp, 'pointermove', r.right - r.width * 0.2, r.top + r.height * 0.1);
      check('touch: slide to up-right adds jump', keys.has('KeyD') && keys.has('KeyW'), [...keys].join(','));
      ptr(dp, 'pointerup', cx, cy);
      run(10);   // let the jump the slide buffered play out
      check('touch: lifting releases every direction', !['KeyA', 'KeyD', 'KeyW', 'KeyS'].some((k) => keys.has(k)), [...keys].join(',') || 'none');
      fresh(); run(2);
      const flip = document.querySelector('#touch [data-key="flip"]');
      ptr(dp, 'pointerdown', r.left + 4, cy, 2);   // hold left, away from the foe on the right
      ptr(flip, 'pointerdown', 0, 0, 3); run(2); ptr(flip, 'pointerup', 0, 0, 3); ptr(dp, 'pointerup', cx, cy, 2);
      check('touch: FLIP + left = turns and flips left', game.p1.state === 'flip' && game.p1.vx < 0 && game.p1.facing === -1,
        `${game.p1.state} vx ${game.p1.vx} facing ${game.p1.facing}`);
      fresh(); run(2);
      ptr(flip, 'pointerdown', 0, 0, 4); run(2); ptr(flip, 'pointerup', 0, 0, 4);
      check('touch: FLIP alone = front flip', game.p1.state === 'flip' && game.p1.vx > 0, `${game.p1.state} vx ${game.p1.vx}`);
      game.screen = 'select'; game.selIndex = 0; game.render();
      const card = game.taps.filter((t) => t.h === 248)[2]; game.onTap(card.x + 10, card.y + 10);
      check('touch: tapping a card selects it', game.selIndex === 2 && game.screen === 'select', `sel ${game.selIndex}`);
      game.render(); game.onTap(card.x + 10, card.y + 10);
      check('touch: tapping it again starts', game.screen === 'qualifyIntro', game.screen);
      document.getElementById('touch').classList.remove('show');
    }

    game.screen = 'selftest';
    game.render = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
      const pass = results.filter((r) => r[1]).length;
      text(`SELF-TEST ${pass}/${results.length}`, W / 2, 40, 40, pass === results.length ? '#7dff9a' : '#ff5a5a');
      const per = Math.ceil(results.length / 2);
      results.forEach(([n, ok, info], i) => text(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${info}`,
        30 + ((i / per) | 0) * 630, 80 + (i % per) * 24, 15, ok ? '#7dff9a' : '#ff5a5a', 'left', null));
    };
    window.__SELFTEST = results;
  }

  // headless screenshot runs can starve rAF; ?ticks=N fast-forwards the sim
  loadImages().then(() => {
    if (params.has('selftest')) { setupTouch(); selfTest(); game.render(); return; }
    game.start();
    setupTouch();
    const ff = parseInt(params.get('ticks') || '0', 10);
    for (let i = 0; i < ff; i++) game.update();
    if (params.has('paused') && game.screen === 'fight') game.paused = true; // screenshot the pause menu
    game.render();
    requestAnimationFrame(frame);
  });
})();
