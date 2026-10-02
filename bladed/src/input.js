// Keyboard + mouse (pointer lock) and touch (floating stick on the left,
// drag-to-look on the right, KNIFE / THROW / JUMP buttons).
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const I = {
    keys: {}, locked: false, touch: false, active: false, sens: 1, invert: false, turnSpeed: 1,
    lookX: 0, lookY: 0, melee: false, throw: false, attack: false, jump: false, scores: false,
    stick: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, look: { id: null, x: 0, y: 0 },
    on: {}
  };
  const R = 56;

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("hk.settings") || "{}");
      if (s.sens) I.sens = s.sens;
      if (s.invert) I.invert = true;
      if (s.turn) I.turnSpeed = s.turn;
    } catch (e) { /* storage unavailable */ }
  }
  I.save = function () {
    try { localStorage.setItem("hk.settings", JSON.stringify({ sens: I.sens, invert: I.invert, turn: I.turnSpeed })); } catch (e) { /* ignore */ }
  };

  I.init = function (canvas, on) {
    load();
    I.on = on || {};
    I.canvas = canvas;
    window.addEventListener("keydown", function (e) {
      const GAME_KEYS = { Tab: 1, Space: 1, Enter: 1, NumpadEnter: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Slash: 1 };
      // Space/Enter must never "click" a focused menu button mid-game.
      if (I.active && GAME_KEYS[e.code]) e.preventDefault();
      if (e.repeat) return;
      I.keys[e.code] = true;
      if (!I.active) { if (e.code === "Escape" && I.on.escape) I.on.escape(); return; }
      I.kbT = performance.now();
      switch (e.code) {
        // Arrow-key play: Up/Down move, Left/Right turn. Enter or Space is the one
        // attack button: stab if close, throw if they're farther, else slash.
        case "Space": case "Enter": case "NumpadEnter": I.attack = true; break;
        case "ShiftRight": case "KeyJ": I.jump = true; break;
        case "Slash": case "KeyX": case "End": I.flip = true; break;
        case "ArrowUp": {
          // Double-tap Up to sprint (held until Up is released).
          const now = performance.now();
          if (now - (I.upTap || 0) < 320) I.sprintLatch = true;
          I.upTap = now;
          break;
        }
        case "KeyF": case "KeyV": I.melee = true; break;
        case "KeyQ": case "KeyG": case "KeyE": I.throw = true; break;
        case "Tab": I.scores = true; e.preventDefault(); break;
        case "Escape": case "KeyP": if (I.on.pause) I.on.pause(); break;
        case "KeyM": if (I.on.mute) I.on.mute(); break;
      }
    });
    window.addEventListener("keyup", function (e) {
      I.keys[e.code] = false;
      if (e.code === "ArrowUp") I.sprintLatch = false;
      if (e.code === "Tab") { I.scores = false; e.preventDefault(); }
    });
    window.addEventListener("blur", function () { I.keys = {}; I.scores = false; });

    canvas.addEventListener("click", function () { if (I.active && !I.touch) I.lock(); });
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === canvas;
      if (!I.locked && I.active && !I.touch && I.on.unlocked) I.on.unlocked();
    });
    document.addEventListener("mousemove", function (e) {
      if (!I.locked) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) I.mouseT = performance.now();
      I.lookX += e.movementX * 0.0022 * I.sens;
      I.lookY += e.movementY * 0.0022 * I.sens * (I.invert ? -1 : 1);
    });
    document.addEventListener("mousedown", function (e) {
      if (!I.locked || !I.active) return;
      if (e.button === 0) I.melee = true;
      else if (e.button === 2) I.throw = true;
    });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // ---------------------------------------------------------------- touch
    const stickEl = document.getElementById("stick"), knob = document.getElementById("knob");
    function inUi(t) { return t && t.closest && t.closest(".topbtns, .overlay, .menu, .scores, .rotate, button.tb"); }
    function firstTouch() {
      if (I.touch) return;
      I.touch = true;
      document.body.classList.add("touchui");
      if (I.on.touchMode) I.on.touchMode();
    }
    window.addEventListener("touchstart", function (e) {
      firstTouch();
      if (!I.active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (inUi(t.target)) continue;
        if (t.clientX < window.innerWidth * 0.42 && I.stick.id === null) {
          I.stick.id = t.identifier; I.stick.ox = t.clientX; I.stick.oy = t.clientY; I.stick.x = 0; I.stick.y = 0;
          stickEl.style.left = (t.clientX - 65) + "px";
          stickEl.style.top = (t.clientY - 65) + "px";
          stickEl.style.bottom = "auto";
          stickEl.classList.add("on");
          knob.style.transform = "translate(0px,0px)";
        } else if (I.look.id === null) {
          I.look.id = t.identifier; I.look.x = t.clientX; I.look.y = t.clientY;
        }
      }
      if (!inUi(e.target)) e.preventDefault();
    }, { passive: false });
    window.addEventListener("touchmove", function (e) {
      if (!I.active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === I.stick.id) {
          let dx = t.clientX - I.stick.ox, dy = t.clientY - I.stick.oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          I.stick.x = dx / R; I.stick.y = dy / R;
          knob.style.transform = "translate(" + dx + "px," + dy + "px)";
        } else if (t.identifier === I.look.id) {
          I.lookX += (t.clientX - I.look.x) * 0.0062 * I.sens;
          I.lookY += (t.clientY - I.look.y) * 0.0062 * I.sens * (I.invert ? -1 : 1);
          I.look.x = t.clientX; I.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    function end(e) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === I.stick.id) {
          I.stick.id = null; I.stick.x = 0; I.stick.y = 0;
          knob.style.transform = "translate(0px,0px)";
          stickEl.classList.remove("on");
          stickEl.style.left = ""; stickEl.style.top = ""; stickEl.style.bottom = "";
        } else if (t.identifier === I.look.id) I.look.id = null;
      }
    }
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    // iOS Safari ignores user-scalable=no: block the double-tap zoom.
    let lastEnd = 0;
    document.addEventListener("touchend", function (e) {
      const now = Date.now();
      if (now - lastEnd < 320 && !(e.target.closest && e.target.closest("input, select"))) e.preventDefault();
      lastEnd = now;
    }, { passive: false });

    function btn(id, fn) {
      const el = document.getElementById(id);
      el.addEventListener("touchstart", function (e) { e.preventDefault(); el.classList.add("down"); fn(); }, { passive: false });
      el.addEventListener("touchend", function (e) { e.preventDefault(); el.classList.remove("down"); }, { passive: false });
      el.addEventListener("mousedown", function (e) { e.preventDefault(); fn(); });
    }
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) firstTouch();
    btn("tKnife", function () { I.melee = true; });
    btn("tThrow", function () { I.throw = true; });
    btn("tJump", function () { I.jump = true; });
  };

  I.lock = function () {
    if (I.touch || !I.canvas.requestPointerLock) return;
    try { const p = I.canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
  };
  I.unlock = function () { if (document.pointerLockElement) document.exitPointerLock(); };

  // Movement intent: mx = strafe right, mz = forward.
  I.move = function () {
    const k = I.keys;
    let mx = 0, mz = 0, sprint = false;
    if (k.KeyW || k.ArrowUp) mz += 1;
    if (k.KeyS || k.ArrowDown) mz -= 1;
    if (k.KeyD) mx += 1;
    if (k.KeyA) mx -= 1;
    sprint = !!(k.ShiftLeft || I.sprintLatch);
    if (I.stick.id !== null) {
      mx = I.stick.x; mz = -I.stick.y;
      const m = Math.hypot(mx, mz);
      sprint = m > 0.9 && mz > 0.55;
      if (m < 0.12) { mx = 0; mz = 0; }
    }
    return { mx: mx, mz: mz, sprint: sprint };
  };

  // Keyboard turning: Left/Right arrows (-1..1), PageUp/PageDown look up/down.
  I.turn = function () {
    const k = I.keys;
    return { yaw: (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0), pitch: (k.PageUp ? 1 : 0) - (k.PageDown ? 1 : 0) };
  };
  // True while the player steers with the keyboard rather than the mouse.
  I.keyboardAim = function () { return (I.kbT || 0) > (I.mouseT || 0) && !I.touch; };

  I.clearEdges = function () { I.melee = false; I.throw = false; I.attack = false; I.jump = false; I.flip = false; I.lookX = 0; I.lookY = 0; };

  HK.Input = I;
})(globalThis.HK);
