// Keyboard + mouse (pointer lock), and touch. P opens the settings (Esc only
// frees the mouse).
//   WASD / arrows move (Left/Right arrows turn), mouse looks
//   Left mouse / Enter fire, right mouse (hold) / Right Shift aim down the sights
//   R reload, 1-6 or the wheel pick a weapon, G grenades, V rifle-butt strike
//   C / Left Ctrl crouch (toggle), Q dive roll, E climb a ladder or vault a wall
//   F (hold) weapon wheel: point the mouse at a gun, let go to take it
//   Space jump, Left Shift sprint, X quick turn, Tab scores, P settings, M sound
// (From Summit Protocol's input, gadgets taken out, right mouse held to aim.)
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const I = {
    keys: {}, locked: false, touch: false, active: false, sens: 1, invert: false, turnSpeed: 1,
    lookX: 0, lookY: 0, fire: false, firePressed: false, reload: false, sel: -1, next: 0,
    melee: false, grab: false, jump: false, flip: false, scores: false, mouseFire: false, mouseAim: false,
    tFire: false, tAim: false, fireTouch: null, stick: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, look: { id: null, x: 0, y: 0 },
    on: {}
  };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem("sp.input") || "{}");
      if (s.sens) I.sens = s.sens;
      if (s.invert) I.invert = true;
      if (s.turn) I.turnSpeed = s.turn;
    } catch (e) { /* storage unavailable */ }
  }
  I.save = function () {
    try { localStorage.setItem("sp.input", JSON.stringify({ sens: I.sens, invert: I.invert, turn: I.turnSpeed })); } catch (e) { /* ignore */ }
  };

  I.init = function (canvas, on) {
    load();
    I.on = on || {};
    I.canvas = canvas;
    const GAME_KEYS = { Tab: 1, Space: 1, Enter: 1, NumpadEnter: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Slash: 1, ShiftRight: 1 };
    window.addEventListener("keydown", function (e) {
      // Space/Enter must never "click" a focused menu button mid-game.
      if (I.active && GAME_KEYS[e.code]) e.preventDefault();
      if (e.repeat) return;
      I.keys[e.code] = true;
      if (!I.active) { if (e.code === "KeyP" && I.on.escape) I.on.escape(); return; }
      I.kbT = performance.now();
      switch (e.code) {
        case "Enter": case "NumpadEnter": I.firePressed = true; break;
        case "Space": I.jump = true; break;
        case "KeyR": I.reload = true; break;
        case "KeyV": I.melee = true; break;
        case "KeyB": I.grab = true; break;
        case "KeyC": case "ControlLeft": I.crouch = true; break;
        case "KeyQ": I.roll = true; break;
        case "KeyE": I.use = true; break;
        case "KeyG": I.sel = 5; break;
        case "Digit1": case "Digit2": case "Digit3": case "Digit4": case "Digit5": case "Digit6":
          I.sel = parseInt(e.code.slice(5), 10) - 1; break;
        case "Slash": case "KeyX": I.flip = true; break;
        case "Tab": I.scores = true; e.preventDefault(); break;
        case "KeyP": if (I.on.pause) I.on.pause(); break;
        case "KeyM": if (I.on.mute) I.on.mute(); break;
      }
    });
    window.addEventListener("keyup", function (e) {
      I.keys[e.code] = false;
      if (e.code === "Tab") { I.scores = false; e.preventDefault(); }
    });
    window.addEventListener("blur", function () { I.keys = {}; I.scores = false; I.mouseFire = false; I.mouseAim = false; });

    canvas.addEventListener("click", function () { if (I.active) I.lock(); });
    document.addEventListener("pointerlockchange", function () {
      I.locked = document.pointerLockElement === canvas;
      if (!I.locked) { I.mouseFire = false; I.mouseAim = false; }
      if (!I.locked && I.active && I.on.unlocked) I.on.unlocked();
    });
    document.addEventListener("mousemove", function (e) {
      if (!I.locked) return;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) I.mouseT = performance.now();
      const zoomK = I.zoomSens || 1;
      I.lookX += e.movementX * 0.0022 * I.sens * zoomK;
      I.lookY += e.movementY * 0.0022 * I.sens * zoomK * (I.invert ? -1 : 1);
    });
    document.addEventListener("mousedown", function (e) {
      if (!I.locked || !I.active) return;
      if (e.button === 0) { I.mouseFire = true; I.firePressed = true; }
      else if (e.button === 2) I.mouseAim = true;
      else if (e.button === 1) { I.melee = true; e.preventDefault(); }
    });
    document.addEventListener("mouseup", function (e) { if (e.button === 0) I.mouseFire = false; else if (e.button === 2) I.mouseAim = false; });
    document.addEventListener("wheel", function (e) {
      if (!I.locked || !I.active) return;
      I.next = e.deltaY > 0 ? 1 : -1;
    }, { passive: true });
    document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // ---------------------------------------------------------------- touch
    // Left 42% of the screen: a floating stick where the thumb lands. Anywhere
    // else: drag to look. FIRE fires while held and also looks as it's dragged,
    // so one thumb can aim and shoot.
    const R = 56;
    const stickEl = document.getElementById("stick"), knob = document.getElementById("knob");
    const fireEl = document.getElementById("tFire");
    function inUi(el) { return el && el.closest && el.closest(".topbtns, .overlay, .menu, .scores, .rotate, button.tb"); }
    function firstTouch() {
      if (I.touch) return;
      I.touch = true;
      document.body.classList.add("touchui");
      if (I.on.touchMode) I.on.touchMode();
    }
    function lookMove(t, k) {
      const zoomK = I.zoomSens || 1;
      I.lookX += (t.clientX - k.x) * 0.0062 * I.sens * zoomK;
      I.lookY += (t.clientY - k.y) * 0.0062 * I.sens * zoomK * (I.invert ? -1 : 1);
      k.x = t.clientX; k.y = t.clientY;
    }
    window.addEventListener("touchstart", function (e) {
      firstTouch();
      if (!I.active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.target === fireEl) {
          I.tFire = true; I.firePressed = true; fireEl.classList.add("down");
          I.fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
          continue;
        }
        if (inUi(t.target)) continue;
        if (t.clientX < window.innerWidth * 0.42 && I.stick.id === null) {
          I.stick.id = t.identifier; I.stick.ox = t.clientX; I.stick.oy = t.clientY; I.stick.x = 0; I.stick.y = 0;
          stickEl.style.left = (t.clientX - 65) + "px"; stickEl.style.top = (t.clientY - 65) + "px"; stickEl.style.bottom = "auto";
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
        } else if (t.identifier === I.look.id) lookMove(t, I.look);
        else if (I.fireTouch && t.identifier === I.fireTouch.id) lookMove(t, I.fireTouch);
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
        else if (I.fireTouch && t.identifier === I.fireTouch.id) { I.fireTouch = null; I.tFire = false; fireEl.classList.remove("down"); }
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
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
      document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
    });
    function btn(id, down, up) {
      const el = document.getElementById(id);
      el.addEventListener("touchstart", function (e) { e.preventDefault(); el.classList.add("down"); if (I.active) down(); }, { passive: false });
      el.addEventListener("touchend", function (e) { e.preventDefault(); el.classList.remove("down"); if (up) up(); }, { passive: false });
      el.addEventListener("touchcancel", function () { el.classList.remove("down"); if (up) up(); });
    }
    btn("tAim", function () { I.tAim = !I.tAim; document.getElementById("tAim").classList.toggle("on", I.tAim); });
    btn("tJump", function () { I.jump = true; });
    btn("tReload", function () { I.reload = true; });
    btn("tSwap", function () { I.next = 1; });
    btn("tNade", function () { I.sel = 5; });
    btn("tMelee", function () { I.melee = true; });
    btn("tThrow", function () { I.grab = true; });
    btn("tCrouch", function () { I.crouch = true; });
    btn("tRoll", function () { I.roll = true; });
    btn("tUse", function () { I.use = true; });
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches) firstTouch();
  };

  I.lock = function () {
    if (I.touch || !I.canvas.requestPointerLock) return;
    try { const p = I.canvas.requestPointerLock(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ }
  };
  I.unlock = function () { if (document.pointerLockElement) document.exitPointerLock(); };

  // Movement intent: mx = strafe right, mz = forward.
  I.move = function () {
    const k = I.keys;
    let mx = 0, mz = 0;
    if (k.KeyW || k.ArrowUp) mz += 1;
    if (k.KeyS || k.ArrowDown) mz -= 1;
    if (k.KeyD) mx += 1;
    if (k.KeyA) mx -= 1;
    let sprint = !!k.ShiftLeft;
    if (I.stick.id !== null) {
      mx = I.stick.x; mz = -I.stick.y;
      const m = Math.hypot(mx, mz);
      sprint = m > 0.92 && mz > 0.6;
      if (m < 0.12) { mx = 0; mz = 0; }
    }
    return { mx: mx, mz: mz, sprint: sprint };
  };
  I.fireHeld = function () { return I.mouseFire || I.tFire || !!I.keys.Enter || !!I.keys.NumpadEnter; };
  I.wheelHeld = function () { return !!I.keys.KeyF; };
  I.aimHeld = function () { return I.mouseAim || I.tAim || !!I.keys.ShiftRight; };
  // Keyboard turning: Left/Right arrows (-1..1), PageUp/PageDown look up/down.
  I.turn = function () {
    const k = I.keys;
    return { yaw: (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0), pitch: (k.PageUp ? 1 : 0) - (k.PageDown ? 1 : 0) };
  };
  // True while the player steers with the keyboard rather than the mouse.
  I.keyboardAim = function () { return (I.kbT || 0) > (I.mouseT || 0); };
  I.clearEdges = function () {
    I.firePressed = I.reload = I.melee = I.grab = I.jump = I.flip = I.crouch = I.roll = I.use = false;
    I.sel = -1; I.next = 0; I.lookX = 0; I.lookY = 0; I.mouseFire = false; I.mouseAim = false; I.tFire = false;
  };

  SP.Input = I;
})(globalThis.SP);
