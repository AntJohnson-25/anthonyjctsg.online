// Mouse + keyboard (pointer lock does the looking) or touch (left thumb moves, drag the right side to look,
// buttons on the right). sample() hands the sim one frame of controls. (Headless tests drive it through
// SB.Input.synthetic.)
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const I = { yaw: 0, pitch: 0, keys: {}, down: false, locked: false, sens: 1, synthetic: null, wantLock: false, touch: false };
  let edge = { roll: false, crouch: false, build: false };
  const PITCH_MIN = -1.15, PITCH_MAX = 0.6;   // over-the-shoulder camera: not under the snow
  const T = { stickId: null, ox: 0, oy: 0, sx: 0, sy: 0, lookId: null, lx: 0, ly: 0, fire: false, fireId: null, pack: false, packId: null };

  I.init = function (canvas, onLock) {
    I.canvas = canvas;
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === canvas;
      if (!I.locked) { I.down = false; I.keys = {}; }
      if (onLock) onLock(I.locked);
    });
    document.addEventListener("mousemove", function (e) {
      if (!I.locked) return;
      look(e.movementX * 0.0022 * I.sens, e.movementY * 0.0022 * I.sens);
    });
    document.addEventListener("mousedown", function (e) { if (I.locked && e.button === 0) I.down = true; });
    document.addEventListener("mouseup", function (e) { if (e.button === 0) I.down = false; });
    document.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      const k = e.code;
      I.keys[k] = true;
      if (!I.locked) return;
      if (k === "KeyQ" || k === "Space") { edge.roll = true; e.preventDefault(); }
      else if (k === "KeyC" || k === "ControlLeft") edge.crouch = true;
      else if (k === "KeyE") edge.build = true;
      if (k === "Tab" || k === "Space") e.preventDefault();
    });
    document.addEventListener("keyup", function (e) { I.keys[e.code] = false; });
    document.addEventListener("contextmenu", function (e) { if (I.locked) e.preventDefault(); });
  };
  function look(dx, dy) {
    I.yaw -= dx;
    I.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, I.pitch - dy));
  }

  // ------------------------------------------------------------------ touch
  // ui: { canvas, stickBase, stickKnob, throwBtn, rollBtn, packBtn, crouchBtn, buildBtn, active() -> is a match being played }
  I.initTouch = function (ui) {
    I.touch = true;
    const half = () => innerWidth * 0.46, R = 62;   // the stick can start in the left ~46% of the screen; its reach in px
    let lastEnd = 0;
    function hideStick() { ui.stickBase.style.display = "none"; }
    function place(x, y, kx, ky) {
      ui.stickBase.style.display = "block"; ui.stickBase.style.left = x + "px"; ui.stickBase.style.top = y + "px";
      ui.stickKnob.style.transform = "translate(" + kx + "px," + ky + "px)";
    }
    ui.canvas.addEventListener("touchstart", function (e) {
      if (!ui.active()) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < half() && T.stickId === null) { T.stickId = t.identifier; T.ox = t.clientX; T.oy = t.clientY; T.sx = T.sy = 0; place(T.ox, T.oy, 0, 0); }
        else if (T.lookId === null && t.clientX >= half()) { T.lookId = t.identifier; T.lx = t.clientX; T.ly = t.clientY; }
      }
    }, { passive: false });
    ui.canvas.addEventListener("touchmove", function (e) {
      if (!ui.active()) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === T.stickId) {
          let dx = t.clientX - T.ox, dy = t.clientY - T.oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }   // the knob stops at the rim; the stick's origin follows if you go past it
          if (d > R * 1.6) { T.ox += (t.clientX - T.ox) * 0.15; T.oy += (t.clientY - T.oy) * 0.15; }
          T.sx = dx / R; T.sy = dy / R;
          place(T.ox, T.oy, dx, dy);
        } else if (t.identifier === T.lookId || t.identifier === T.fireId) {
          const px = t.identifier === T.lookId ? "l" : "f";
          if (px === "l") { look((t.clientX - T.lx) * 0.0058 * I.sens, (t.clientY - T.ly) * 0.0058 * I.sens); T.lx = t.clientX; T.ly = t.clientY; }
          else { look((t.clientX - T.fx) * 0.0058 * I.sens, (t.clientY - T.fy) * 0.0058 * I.sens); T.fx = t.clientX; T.fy = t.clientY; }
        }
      }
    }, { passive: false });
    function end(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stickId) { T.stickId = null; T.sx = T.sy = 0; hideStick(); }
        if (t.identifier === T.lookId) T.lookId = null;
      }
    }
    ui.canvas.addEventListener("touchend", end);
    ui.canvas.addEventListener("touchcancel", end);
    // Buttons: hold THROW (and slide the thumb to aim), tap ROLL / CROUCH / BUILD, hold PACK.
    function hold(el, down, up, drag) {
      el.addEventListener("touchstart", function (e) {
        e.preventDefault(); e.stopPropagation();
        const t = e.changedTouches[0];
        el.classList.add("on");
        down(t);
      }, { passive: false });
      const rel = function (e) { e.preventDefault(); el.classList.remove("on"); up(); };
      el.addEventListener("touchend", rel, { passive: false });
      el.addEventListener("touchcancel", rel, { passive: false });
      if (drag) el.addEventListener("touchmove", function (e) { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === T.fireId) drag(t); }, { passive: false });
    }
    hold(ui.throwBtn, function (t) { T.fire = true; T.fireId = t.identifier; T.fx = t.clientX; T.fy = t.clientY; },
      function () { T.fire = false; T.fireId = null; },
      function (t) { look((t.clientX - T.fx) * 0.0058 * I.sens, (t.clientY - T.fy) * 0.0058 * I.sens); T.fx = t.clientX; T.fy = t.clientY; });
    hold(ui.packBtn, function (t) { T.pack = true; T.packId = t.identifier; }, function () { T.pack = false; });
    hold(ui.rollBtn, function () { edge.roll = true; }, function () {});
    hold(ui.crouchBtn, function () { edge.crouch = true; }, function () {});
    hold(ui.buildBtn, function () { edge.build = true; }, function () {});
    // No double-tap zoom while playing (Safari ignores user-scalable=no).
    document.addEventListener("touchend", function (e) {
      const now = Date.now();
      if (ui.active() && now - lastEnd < 350) e.preventDefault();
      lastEnd = now;
    }, { passive: false });
    document.addEventListener("gesturestart", function (e) { if (ui.active()) e.preventDefault(); });
  };
  I.touchReset = function () { T.stickId = T.lookId = T.fireId = T.packId = null; T.sx = T.sy = 0; T.fire = T.pack = false; };

  I.lock = function () {
    if (I.touch || !I.canvas || !I.canvas.requestPointerLock) return;
    try { const r = I.canvas.requestPointerLock(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* ignore */ }
  };
  I.reset = function (yaw) { I.yaw = yaw || 0; I.pitch = 0; edge = { roll: false, crouch: false, build: false }; };

  I.sample = function () {
    if (I.synthetic) {
      const s = I.synthetic;
      const out = { mx: s.mx || 0, mz: s.mz || 0, yaw: s.yaw != null ? s.yaw : I.yaw, pitch: s.pitch != null ? s.pitch : I.pitch, sprint: !!s.sprint,
        fire: !!s.fire, pack: !!s.pack, roll: !!s.roll, crouchEdge: !!s.crouchEdge, build: !!s.build };
      if (s.yaw != null) I.yaw = s.yaw;
      if (s.pitch != null) I.pitch = s.pitch;
      s.roll = false; s.crouchEdge = false; s.build = false;
      return out;
    }
    if (I.touch) {
      const mag = Math.hypot(T.sx, T.sy), dead = mag < 0.12;
      const out = { mx: dead ? 0 : T.sx, mz: dead ? 0 : -T.sy, yaw: I.yaw, pitch: I.pitch, sprint: mag > 0.92,
        fire: T.fire, pack: T.pack, roll: edge.roll, crouchEdge: edge.crouch, build: edge.build };
      edge = { roll: false, crouch: false, build: false };
      return out;
    }
    const K = I.keys;
    const out = {
      mx: (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0),
      mz: (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0),
      yaw: I.yaw, pitch: I.pitch, sprint: !!(K.ShiftLeft || K.ShiftRight),
      fire: I.down, pack: !!K.KeyR, roll: edge.roll, crouchEdge: edge.crouch, build: edge.build
    };
    edge = { roll: false, crouch: false, build: false };
    return out;
  };
  SB.Input = I;
})(globalThis.SB);
