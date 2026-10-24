// Pointer only. Move the mouse (or a finger) left/right to aim; press and pull DOWN like drawing back an underhand
// swing, then let go to toss. How far you pull sets the power; pull back to where you started to cancel. There is no
// pointer lock and no meter, so it works the same in any frame and on touch. The stance is fixed (centre of the
// box, slider throw, one arc).
(function (SB) {
  "use strict";
  const CH = SB.Cornhole, C = CH.C;
  const I = {
    enabled: false, mx: 0, x: 0, style: 0, charging: false, p: 0, dirSign: 1,
    gain: 0.17, released: null, y0: 0, x0: 0,
    P0: 0.25, SPAN: 0.45,        // pull 0..1 -> bag power P0..P0+SPAN (short of the board up to over the back)
    SNAP: 0.025                  // a pull this close to a hole's power sinks it: the toss is about feel, not pixels
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // How far the pull-back has to go for full power: a comfortable thumb drag on a phone (not half of a tall screen).
  const pullPx = () => (I.touch ? clamp(innerHeight * 0.3, 130, 240) : Math.max(220, innerHeight * 0.5));

  I.yaw = () => clamp(I.mx * I.gain, -C.YAW_MAX, C.YAW_MAX);
  I.pit = () => 0.8;
  I.cancel = function () { I.charging = false; I.p = 0; pullUi(false); };
  I.power = () => I.P0 + I.SPAN * I.p;

  // The power that sinks a bag for this aim (the middle of the run of powers that drop in), or -1.
  function holePower() {
    const hs = [];
    for (let p = 0.2; p <= 0.8001; p += 0.005) { if (CH.probe(I.dirSign, { x: I.x, yaw: I.yaw(), pit: I.pit(), p: p, st: I.style }).inHole) hs.push(p); }
    return hs.length ? hs[Math.floor(hs.length / 2)] : -1;
  }

  // a thin line from where the pull began to the pointer, so the pull is visible without any scale
  let pullEl = null;
  function pullUi(show, py) {
    if (!pullEl) { pullEl = document.getElementById("pull"); }
    if (!pullEl) return;
    if (!show) { pullEl.style.display = "none"; return; }
    pullEl.style.display = "block";
    pullEl.style.left = I.x0 + "px"; pullEl.style.top = I.y0 + "px";
    pullEl.style.height = Math.max(0, py - I.y0) + "px";
  }

  I.init = function (el) {
    const isUi = (t) => t && t.closest && t.closest(".ui");
    addEventListener("pointermove", function (e) {
      if (!I.charging) { if (!I.touch) I.mx = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1); return; }
      I.p = clamp((e.clientY - I.y0) / pullPx(), 0, 1);
      // Touch: one slide of the thumb does both. Sideways steers the aim (a thumb's reach across ~45% of the screen sweeps the
      // whole range), down draws back; the mouse keeps the aim locked at the press.
      if (I.touch) I.mx = clamp(I.mx0 + (e.clientX - I.x0) / (innerWidth * 0.45), -1, 1);
      pullUi(true, e.clientY);
    });
    addEventListener("pointerdown", function (e) {
      I.touch = e.pointerType === "touch" || e.pointerType === "pen";
      if (e.button !== 0 || isUi(e.target) || !I.enabled) { if (e.button === 2) I.cancel(); return; }
      if (!I.touch) I.mx = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);   // mouse: the aim is locked at the press
      I.mx0 = I.mx;                                                          // touch: the aim carries on from the last throw, then slides
      I.charging = true; I.p = 0; I.x0 = e.clientX; I.y0 = e.clientY;
      pullUi(true, e.clientY);
    });
    addEventListener("pointerup", function (e) {
      if (!I.charging) return;
      const frac = I.p;
      I.cancel();
      if (e.button !== 0 || !I.enabled || frac < 0.06) return;        // pulled back to the start: no throw
      let p = I.P0 + I.SPAN * frac;
      const h = holePower();
      if (h >= 0 && Math.abs(p - h) < I.SNAP) p = h;
      I.released = { x: I.x, yaw: I.yaw(), pit: I.pit(), p: p, st: I.style };
    });
    addEventListener("pointercancel", I.cancel);
    addEventListener("contextmenu", function (e) { e.preventDefault(); });
    addEventListener("blur", I.cancel);
  };

  // Keyboard aiming too: ← → or A D nudge the aim like moving the mouse (not while drawing back: the aim is locked then).
  const keys = { l: false, r: false };
  const keyOf = (e) => (e.code === "ArrowLeft" || e.code === "KeyA" ? "l" : e.code === "ArrowRight" || e.code === "KeyD" ? "r" : null);
  addEventListener("keydown", function (e) { const k = keyOf(e); if (k) { keys[k] = true; if (I.enabled) e.preventDefault(); } });
  addEventListener("keyup", function (e) { const k = keyOf(e); if (k) keys[k] = false; });
  addEventListener("blur", function () { keys.l = keys.r = false; });

  // Called every frame while it is this player's turn; returns the throw if one was let go.
  I.update = function (dt) {
    if (!I.enabled) { if (I.charging) I.cancel(); I.released = null; return null; }
    if (!I.charging && (keys.l || keys.r)) I.mx = clamp(I.mx + ((keys.r ? 1 : 0) - (keys.l ? 1 : 0)) * 1.3 * dt, -1, 1);
    const r = I.released; I.released = null;
    return r;
  };
  I.meterP = () => (I.charging ? I.p : -1);        // how far back the thrower's arm is drawn (0..1), -1 = not winding up
  SB.Input = I;
})(globalThis.SB);
