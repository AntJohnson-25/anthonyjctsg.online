// Mouse + keyboard (pointer lock does the aiming): WASD moves, Space jumps (again in the air = a flip), Shift
// dodges the way you're pushing, hold the left button to wind up and let go to throw, the right button catches
// (or blocks with the ball you're holding). sample() hands the sim one frame of controls.
// Forked from Trick Shot's input.js.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const I = { yaw: 0, pitch: 0.05, keys: {}, down: false, locked: false, free: false, sens: 1, invertY: false, jumpQ: false, dodgeQ: false, catchQ: false };

  function look(dx, dy) {
    const C = SB.CFG;
    I.yaw = (I.yaw - dx) % (Math.PI * 2);
    I.pitch = Math.max(C.PITCH_MIN, Math.min(C.PITCH_MAX, I.pitch - (I.invertY ? -dy : dy)));
  }

  // ---- touch (phones and tablets): a floating joystick under the left thumb, drag the right side to look, and buttons:
  // THROW (hold to wind up, let go to throw; the same thumb can keep sliding to aim), CATCH, JUMP (again in the air = flip), DODGE.
  I.touchMode = false;
  I.stick = { x: 0, y: 0 };
  I.initTouch = function () {
    I.touchMode = true;
    const $ = (id) => document.getElementById(id);
    const zoneL = $("tzL"), zoneR = $("tzR"), ring = $("stick"), knob = $("knob");
    const R = 56, TS = 0.0052;                             // joystick radius (px), look: radians per px at sensitivity 1
    let stickId = null, sx = 0, sy = 0, lookId = null, lx = 0, ly = 0, throwId = null, tx = 0, ty = 0;
    const lookBy = (dx, dy) => look(dx * TS * I.sens, dy * TS * I.sens);
    const stop = () => { stickId = lookId = throwId = null; I.stick.x = I.stick.y = 0; I.down = false; ring.classList.remove("on"); ring.style.left = ring.style.top = ""; knob.style.transform = ""; };
    I.touchReset = stop;

    zoneL.addEventListener("pointerdown", function (e) {
      if (stickId !== null || !I.active) return;
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      ring.style.left = (sx - 70) + "px"; ring.style.top = (sy - 70) + "px"; ring.classList.add("on");
      try { zoneL.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
      e.preventDefault();
    });
    zoneL.addEventListener("pointermove", function (e) {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      knob.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
      const m = Math.min(1, d / R), dead = 0.14;
      const k = m < dead ? 0 : (m - dead) / (1 - dead);   // a dead zone, then the full range
      I.stick.x = d > 0 ? (e.clientX - sx) / d * k : 0;   // direction (unit) times the adjusted magnitude
      I.stick.y = d > 0 ? (e.clientY - sy) / d * k : 0;
    });
    const stickEnd = function (e) {
      if (e.pointerId !== stickId) return;
      stickId = null; I.stick.x = I.stick.y = 0;
      ring.classList.remove("on"); ring.style.left = ring.style.top = ""; knob.style.transform = "";
    };
    zoneL.addEventListener("pointerup", stickEnd); zoneL.addEventListener("pointercancel", stickEnd);

    zoneR.addEventListener("pointerdown", function (e) {
      if (lookId !== null || !I.active) return;
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
      try { zoneR.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
      e.preventDefault();
    });
    zoneR.addEventListener("pointermove", function (e) {
      if (e.pointerId !== lookId) return;
      lookBy(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY;
    });
    const lookEnd = function (e) { if (e.pointerId === lookId) lookId = null; };
    zoneR.addEventListener("pointerup", lookEnd); zoneR.addEventListener("pointercancel", lookEnd);

    // buttons
    const press = (el, on) => el.classList.toggle("press", on);
    const tap = function (id, fn) {
      const el = $(id);
      el.addEventListener("pointerdown", function (e) { if (!I.active) return; fn(); press(el, true); e.preventDefault(); e.stopPropagation(); });
      const up = function () { press(el, false); };
      el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("pointerleave", up);
    };
    tap("bCatch", function () { I.catchQ = true; });
    tap("bJump", function () { I.jumpQ = true; });
    tap("bDodge", function () { I.dodgeQ = true; });
    const bt = $("bThrow");
    bt.addEventListener("pointerdown", function (e) {
      if (throwId !== null || !I.active) return;
      throwId = e.pointerId; tx = e.clientX; ty = e.clientY; I.down = true; press(bt, true);
      try { bt.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
      e.preventDefault(); e.stopPropagation();
    });
    bt.addEventListener("pointermove", function (e) {      // keep sliding the thumb to aim while winding up
      if (e.pointerId !== throwId) return;
      lookBy(e.clientX - tx, e.clientY - ty); tx = e.clientX; ty = e.clientY;
    });
    const throwEnd = function (e) { if (e.pointerId === throwId) { throwId = null; I.down = false; press(bt, false); } };
    bt.addEventListener("pointerup", throwEnd); bt.addEventListener("pointercancel", throwEnd);
    // the page must never scroll, zoom or select while a match is on
    document.addEventListener("touchmove", function (e) { if (I.active) e.preventDefault(); }, { passive: false });
  };

  I.init = function (canvas, onLock) {
    I.canvas = canvas;
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === canvas;
      if (!I.locked) { I.down = false; I.keys = {}; }
      if (onLock) onLock(I.locked);
    });
    document.addEventListener("pointerlockerror", function () { I.locked = false; if (I.onFail) I.onFail(); });
    canvas.addEventListener("click", function () { if (!I.locked && I.wantLock && !I.free) I.lock(); });
    document.addEventListener("mousemove", function (e) {
      if (I.touchMode || (!I.locked && !I.free)) return;
      look(e.movementX * 0.0021 * I.sens, e.movementY * 0.0021 * I.sens);
    });
    document.addEventListener("mousedown", function (e) {
      if (I.touchMode || (!I.locked && !I.free)) return;       // (a phone's compatibility mouse events are not the player)
      if (e.button === 0) I.down = true;
      if (e.button === 2) I.catchQ = true;
    });
    document.addEventListener("mouseup", function (e) { if (e.button === 0) I.down = false; });
    // the keyboard works whenever a match is on (I.active), even before the click that captures the mouse
    document.addEventListener("keydown", function (e) {
      if (!I.locked && !I.free && !I.active) return;
      if (!e.repeat) {
        if (e.code === "Space") I.jumpQ = true;
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") I.dodgeQ = true;
        if (e.code === "KeyF" || e.code === "KeyE") I.catchQ = true;
      }
      I.keys[e.code] = true;
      if (e.code === "Space" || e.code === "Tab" || e.code.indexOf("Arrow") === 0) e.preventDefault();
    });
    document.addEventListener("keyup", function (e) { I.keys[e.code] = false; });
    document.addEventListener("contextmenu", function (e) { if (I.locked || I.free) e.preventDefault(); });
    addEventListener("blur", function () { I.keys = {}; I.down = false; });
  };
  I.lock = function () {
    if (!I.canvas || !I.canvas.requestPointerLock) return;
    try {
      const r = I.canvas.requestPointerLock();
      if (r && r.catch) r.catch(function () { if (I.onFail) I.onFail(); });
    } catch (e) { if (I.onFail) I.onFail(); }
  };
  I.sample = function () {
    const k = I.keys;
    const cl = (v) => Math.max(-1, Math.min(1, v));
    const mz = cl((k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) - I.stick.y);     // stick up = forward
    const mx = cl((k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + I.stick.x);
    const out = { yaw: I.yaw, pitch: I.pitch, mx: mx, mz: mz, jump: I.jumpQ, dodge: I.dodgeQ, fire: I.down, catchQ: I.catchQ };
    I.jumpQ = false; I.dodgeQ = false; I.catchQ = false;
    return out;
  };
  I.clearEdges = function () { I.jumpQ = false; I.dodgeQ = false; I.catchQ = false; };
  SB.Input = I;
})(globalThis.SB);
