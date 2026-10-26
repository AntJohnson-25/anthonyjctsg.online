// Mouse + keyboard (pointer lock does the looking) or touch (left thumb moves, drag the right side to look,
// buttons on the right). sample() hands the sim one frame of controls. (Headless tests drive it through
// WD.Input.synthetic.)
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const I = { yaw: 0, pitch: -0.12, keys: {}, locked: false, sens: 1, synthetic: null, touch: false };
  let edge = { act: false, next: false, prev: false, scan: false, pick: null };
  const PITCH_MIN = -1.05, PITCH_MAX = 0.65;
  const T = { stickId: null, ox: 0, oy: 0, sx: 0, sy: 0, lookId: null, lx: 0, ly: 0, run: false };

  I.init = function (canvas, onLock) {
    I.canvas = canvas;
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === canvas;
      if (!I.locked) I.keys = {};
      if (onLock) onLock(I.locked);
    });
    document.addEventListener("mousemove", function (e) { if (I.locked) look(e.movementX * 0.0022 * I.sens, e.movementY * 0.0022 * I.sens); });
    document.addEventListener("mousedown", function (e) { if (I.locked && e.button === 0) edge.act = true; if (I.locked && e.button === 2) edge.scan = true; });
    document.addEventListener("wheel", function (e) { if (!I.locked) return; if (e.deltaY > 0) edge.next = true; else if (e.deltaY < 0) edge.prev = true; }, { passive: true });
    document.addEventListener("keydown", function (e) {
      const k = e.code;
      if (k === "Tab" || k === "Space") e.preventDefault();
      if (e.repeat) return;
      I.keys[k] = true;
      if (!I.locked && !I.free) return;
      if (k === "KeyE" || k === "Space") edge.act = true;
      else if (k === "KeyQ" || k === "Tab") edge.next = true;
      else if (k === "KeyF") edge.scan = true;
      else if (/^Digit[1-9]$/.test(k)) edge.pick = +k.slice(5) - 1;
    });
    document.addEventListener("keyup", function (e) { I.keys[e.code] = false; });
    document.addEventListener("contextmenu", function (e) { if (I.locked) e.preventDefault(); });
  };
  function look(dx, dy) {
    I.yaw -= dx;
    I.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, I.pitch - dy));
  }

  // ------------------------------------------------------------------ touch
  // ui: { canvas, stickBase, stickKnob, dropBtn, nextBtn, scanBtn, runBtn, active() -> is a shift being played }
  I.initTouch = function (ui) {
    I.touch = true;
    const half = () => innerWidth * 0.46, R = 62;
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
          if (d > R) { dx *= R / d; dy *= R / d; }
          if (d > R * 1.6) { T.ox += (t.clientX - T.ox) * 0.15; T.oy += (t.clientY - T.oy) * 0.15; }
          T.sx = dx / R; T.sy = dy / R;
          place(T.ox, T.oy, dx, dy);
        } else if (t.identifier === T.lookId) { look((t.clientX - T.lx) * 0.0058 * I.sens, (t.clientY - T.ly) * 0.0058 * I.sens); T.lx = t.clientX; T.ly = t.clientY; }
      }
    }, { passive: false });
    function end(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stickId) { T.stickId = null; T.sx = T.sy = 0; ui.stickBase.style.display = "none"; }
        if (t.identifier === T.lookId) T.lookId = null;
      }
    }
    ui.canvas.addEventListener("touchend", end);
    ui.canvas.addEventListener("touchcancel", end);
    function tap(el, fn) {
      el.addEventListener("touchstart", function (e) { e.preventDefault(); e.stopPropagation(); el.classList.add("on"); fn(); }, { passive: false });
      const up = function (e) { e.preventDefault(); el.classList.remove("on"); };
      el.addEventListener("touchend", up, { passive: false }); el.addEventListener("touchcancel", up, { passive: false });
    }
    tap(ui.dropBtn, function () { edge.act = true; });
    tap(ui.nextBtn, function () { edge.next = true; });
    tap(ui.scanBtn, function () { edge.scan = true; });
    tap(ui.runBtn, function () { T.run = !T.run; ui.runBtn.classList.toggle("lit", T.run); });   // a toggle: thumbs are busy
    let lastEnd = 0;
    document.addEventListener("touchend", function (e) { const now = Date.now(); if (ui.active() && now - lastEnd < 350) e.preventDefault(); lastEnd = now; }, { passive: false });
    document.addEventListener("gesturestart", function (e) { if (ui.active()) e.preventDefault(); });
  };
  I.touchReset = function () { T.stickId = T.lookId = null; T.sx = T.sy = 0; };

  I.lock = function () {
    if (I.touch || !I.canvas || !I.canvas.requestPointerLock) return;
    try { const r = I.canvas.requestPointerLock(); if (r && r.catch) r.catch(function () {}); } catch (e) { /* ignore */ }
  };
  I.reset = function (yaw) { I.yaw = yaw || 0; I.pitch = -0.12; edge = { act: false, next: false, prev: false, scan: false, pick: null }; };

  I.sample = function () {
    let out;
    if (I.synthetic) {
      const s = I.synthetic;
      if (s.yaw != null) I.yaw = s.yaw;
      if (s.pitch != null) I.pitch = s.pitch;
      out = { mx: s.mx || 0, mz: s.mz || 0, sprint: !!s.sprint, act: !!s.act || edge.act, next: !!s.next || edge.next, prev: false, scan: !!s.scan || edge.scan, pick: s.pick != null ? s.pick : edge.pick };
      s.act = s.next = s.scan = false; s.pick = null;
    } else if (I.touch) {
      const mag = Math.hypot(T.sx, T.sy), dead = mag < 0.12;
      out = { mx: dead ? 0 : T.sx, mz: dead ? 0 : -T.sy, sprint: T.run || mag > 0.95, act: edge.act, next: edge.next, prev: edge.prev, scan: edge.scan, pick: edge.pick };
    } else {
      const K = I.keys;
      out = { mx: (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0), mz: (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0),
        sprint: !!(K.ShiftLeft || K.ShiftRight), act: edge.act, next: edge.next, prev: edge.prev, scan: edge.scan, pick: edge.pick };
    }
    out.yaw = I.yaw; out.pitch = I.pitch;
    edge = { act: false, next: false, prev: false, scan: false, pick: null };
    return out;
  };
  WD.Input = I;
})(globalThis.WD);
