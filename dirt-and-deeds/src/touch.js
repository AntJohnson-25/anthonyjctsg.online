// Phone / tablet controls (2026-11-24). Left thumb: a floating joystick that walks, and drives when you're in the car
// (up = gas, down = brake/reverse, sideways = steer). Right side: drag to look around. Buttons send the same key
// events as the keyboard (USE = E, PHONE = Tab, OUT = F, menu = Escape); RUN holds sprint. Menus, the phone and
// conversations are ordinary buttons, so they are just tapped.
import { Pad } from "./pad.js";

let host = null, look = [0, 0], stick = null, lookId = null, lastX = 0, lastY = 0, runOn = false;
const R = 58;   // joystick radius, px

function key(code, down) {
  const k = code.startsWith("Key") ? code.slice(3).toLowerCase() : code;
  document.body.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: k, bubbles: true, cancelable: true }));
}
const tap = (code) => { key(code, true); setTimeout(() => key(code, false), 60); };

export const Touch = {
  init(h) {
    host = h;
    const css = document.createElement("style");
    css.textContent = `
#tc { position: fixed; inset: 0; z-index: 30; pointer-events: none; display: none; touch-action: none; }
#tc.on { display: block; }
#tc .zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
#tc .zl { left: 0; width: 45%; } #tc .zr { right: 0; width: 55%; }
#tc .base, #tc .knob { position: absolute; border-radius: 50%; pointer-events: none; display: none; }
#tc .base { width: ${R * 2}px; height: ${R * 2}px; margin: -${R}px 0 0 -${R}px; border: 2px solid rgba(255,255,255,.35); background: rgba(10,14,20,.25); }
#tc .knob { width: 54px; height: 54px; margin: -27px 0 0 -27px; background: rgba(242,207,128,.75); box-shadow: 0 2px 10px rgba(0,0,0,.5); }
#tc .btns { position: absolute; right: max(14px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); display: grid; grid-template-columns: repeat(2, 64px); gap: 10px; pointer-events: auto; }
#tc .btns button { width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); background: rgba(10,14,20,.55); color: #f6eedd; font: 700 12px system-ui, sans-serif; letter-spacing: .04em; touch-action: manipulation; -webkit-user-select: none; user-select: none; }
#tc .btns button.use { background: rgba(217,162,74,.85); color: #1a1409; }
#tc .btns .phone { position: relative; }
#tc .btns .phone i { position: absolute; top: -4px; right: -4px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: #d9402f; color: #fff; font: 700 12px/22px system-ui, sans-serif; font-style: normal; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
#tc .btns button.lit { background: rgba(242,207,128,.9); color: #1a1409; }
#tc .btns .out { display: none; } #tc.drive .btns .out { display: block; } #tc.drive .btns .run { display: none; }
#tc .menu { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); pointer-events: auto; width: 46px; height: 34px; border-radius: 8px; border: 1px solid rgba(255,255,255,.35); background: rgba(10,14,20,.55); color: #f6eedd; font-size: 18px; }
html.mobile #h-keys, html.mobile #h-phone { display: none; }`;
    document.head.appendChild(css);
    const el = document.createElement("div");
    el.id = "tc";
    el.innerHTML = '<div class="zone zl"></div><div class="zone zr"></div><div class="base"></div><div class="knob"></div>' +
      '<button class="menu" aria-label="Pause">&#9776;</button>' +
      '<div class="btns"><button class="run">RUN</button><button class="phone">PHONE<i hidden></i></button><button class="out">OUT</button><button class="use">USE</button></div>';
    document.body.appendChild(el);
    const base = el.querySelector(".base"), knob = el.querySelector(".knob");
    const zl = el.querySelector(".zl"), zr = el.querySelector(".zr");

    zl.addEventListener("touchstart", (e) => {
      e.preventDefault();
      if (stick) return;
      const t = e.changedTouches[0];
      stick = { id: t.identifier, x: t.clientX, y: t.clientY };
      for (const s of [base, knob]) { s.style.display = "block"; s.style.left = t.clientX + "px"; s.style.top = t.clientY + "px"; }
    }, { passive: false });
    const moveStick = (e) => {
      if (!stick) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== stick.id) continue;
        let dx = t.clientX - stick.x, dy = t.clientY - stick.y;
        const m = Math.hypot(dx, dy); if (m > R) { dx *= R / m; dy *= R / m; }
        knob.style.left = stick.x + dx + "px"; knob.style.top = stick.y + dy + "px";
        const nx = dx / R, ny = dy / R, mag = Math.hypot(nx, ny);
        Pad.lx = mag < 0.15 ? 0 : nx; Pad.ly = mag < 0.15 ? 0 : ny;
        Pad.sprint = runOn && mag > 0.15;
      }
    };
    const endStick = (e) => {
      if (!stick) return;
      for (const t of e.changedTouches) if (t.identifier === stick.id) {
        stick = null; Pad.lx = Pad.ly = 0; Pad.sprint = false; base.style.display = knob.style.display = "none";
      }
    };
    zl.addEventListener("touchmove", (e) => { e.preventDefault(); moveStick(e); }, { passive: false });
    zl.addEventListener("touchend", endStick); zl.addEventListener("touchcancel", endStick);

    zr.addEventListener("touchstart", (e) => { e.preventDefault(); if (lookId !== null) return; const t = e.changedTouches[0]; lookId = t.identifier; lastX = t.clientX; lastY = t.clientY; }, { passive: false });
    zr.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === lookId) { look[0] += t.clientX - lastX; look[1] += t.clientY - lastY; lastX = t.clientX; lastY = t.clientY; }
    }, { passive: false });
    const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
    zr.addEventListener("touchend", endLook); zr.addEventListener("touchcancel", endLook);

    const btn = (sel, fn) => el.querySelector(sel).addEventListener("touchstart", (e) => { e.preventDefault(); e.stopPropagation(); fn(e.currentTarget); }, { passive: false });
    btn(".use", () => tap("KeyE"));
    btn(".phone", () => tap("Tab"));
    btn(".out", () => tap("KeyF"));
    btn(".menu", () => tap("Escape"));
    btn(".run", (b) => { runOn = !runOn; b.classList.toggle("lit", runOn); });

    // the unread count: mirror the HUD's phone badge (hidden on phones) onto the PHONE button
    const hb = document.getElementById("h-badge"), pb = el.querySelector(".phone i");
    const tick = () => {
      if (hb) { const show = !hb.hidden && hb.textContent.trim() !== ""; pb.hidden = !show; if (show && pb.textContent !== hb.textContent) pb.textContent = hb.textContent; }
      const on = host.playing();
      el.classList.toggle("on", on);
      el.classList.toggle("drive", on && host.driving());
      if (!on && (stick || Pad.lx || Pad.ly)) { stick = null; lookId = null; Pad.lx = Pad.ly = 0; Pad.sprint = false; base.style.display = knob.style.display = "none"; }
      requestAnimationFrame(tick);
    };
    tick();
  },
  takeLook() { const l = look; look = [0, 0]; return l; }
};
