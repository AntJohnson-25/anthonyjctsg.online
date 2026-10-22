// Walking your barber. Desktop: the ARROW keys (Shift = brisk). Phone: the Spades thumb wheel:
// put a thumb anywhere on the left 40% of the shop and a stick appears under it (full speed at
// 55 px, the knob travels 38 px; same numbers and look as Spades). E (or the CUT button) starts
// on the client you're standing at; V swaps the follow camera for the whole-shop overview.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const I = { x: 0, z: 0, brisk: false, keys: {}, stick: null, sx: 0, sz: 0 };
  const MAP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  function typing(e) { const t = e.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); }

  I.init = function (stage, onAct, onView) {
    document.addEventListener("keydown", function (e) {
      if (typing(e)) return;
      if (MAP[e.code]) { I.keys[e.code] = 1; e.preventDefault(); }
      if (e.key === "Shift") I.brisk = true;
      // only E: Space / Enter would also click whichever dock button has focus
      if (!e.repeat && e.code === "KeyE") { if (onAct()) e.preventDefault(); }
      if (!e.repeat && e.code === "KeyV") onView();
    });
    document.addEventListener("keyup", function (e) { delete I.keys[e.code]; if (e.key === "Shift") I.brisk = false; });
    window.addEventListener("blur", function () { I.keys = {}; I.brisk = false; });

    // the thumb wheel (touch only): the left 40% of the stage; the rest of the screen still drags the camera
    const pad = document.createElement("div"); pad.className = "stick-zone"; stage.appendChild(pad);
    const ring = document.createElement("div"); ring.className = "stick"; ring.hidden = true;
    ring.innerHTML = '<div class="stick-knob"></div>';
    document.body.appendChild(ring);
    const knob = ring.firstChild;
    pad.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      I.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px";
      ring.hidden = false; knob.style.transform = "";
    });
    pad.addEventListener("pointermove", function (e) {
      const s = I.stick;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y, L = Math.hypot(dx, dy), k = Math.min(1, L / 55) / Math.max(1, L);
      I.sx = dx * k; I.sz = dy * k;
      knob.style.transform = "translate(" + (I.sx * 38) + "px," + (I.sz * 38) + "px)";
    });
    const end = function (e) {
      if (!I.stick || I.stick.id !== e.pointerId) return;
      I.stick = null; I.sx = I.sz = 0; ring.hidden = true; knob.style.transform = "";
    };
    pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end);
  };

  // Current move, -1..1 each axis (x right, z toward the camera), relative to the camera.
  I.read = function () {
    let x = I.sx, z = I.sz;
    Object.keys(I.keys).forEach(function (k) { x += MAP[k][0]; z += MAP[k][1]; });
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    I.x = x; I.z = z;
    return I;
  };
  I.touch = matchMedia("(pointer: coarse)").matches;
  HS.Input = I;
})(globalThis.HS);
