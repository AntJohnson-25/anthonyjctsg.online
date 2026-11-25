// Xbox / standard gamepad. Play: left stick walks / drives, right stick looks, RT gas, LT brake (when driving), L3 sprint.
// Buttons fire the same key events the keyboard does, so main.js has one code path: A = E, Y = Tab (phone), Menu/B = Escape.
// Menus: when any overlay is up, D-pad / left stick move a focus ring over its buttons, A clicks, LB/RB switch phone tabs.
const DEAD = 0.22, TRIG = 0.45;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const OVERLAYS = ["card", "pause", "talk", "phone", "select", "loading"];

export const Pad = { on: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, sprint: false, menu: false, host: null,
  init(host) {
    this.host = host;
    const off = (e) => { if (e.isTrusted) setOn(false); };
    addEventListener("keydown", off, true);
    addEventListener("mousedown", off, true);
    addEventListener("mousemove", (e) => { if (e.isTrusted && Math.abs(e.movementX) + Math.abs(e.movementY) > 3) setOn(false); }, true);
    addEventListener("gamepaddisconnected", () => { releaseAll(); setOn(false); });
  },
  poll(dt) { try { poll(dt); } catch (e) { console.warn("[pad] " + e.message); } }
};
let prev = [], held = new Set(), navT = 0, navDir = "", focusEl = null, focusKey = "";

function setOn(v) { if (Pad.on === v) return; Pad.on = v; document.body.classList.toggle("using-pad", v); if (!v) clearFocus(); }
function key(code, down) {
  if (down) { if (held.has(code)) return; held.add(code); } else { if (!held.has(code)) return; held.delete(code); }
  const k = code.startsWith("Key") ? code.slice(3).toLowerCase() : code === "Space" ? " " : code;
  document.body.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: k, bubbles: true, cancelable: true }));
}
const tap = (code) => { key(code, true); key(code, false); };
function releaseAll() { for (const c of [...held]) key(c, false); Pad.sprint = false; Pad.lx = Pad.ly = Pad.rx = Pad.ry = Pad.lt = Pad.rt = 0; }
function readPad() { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of l) if (g && g.connected && g.buttons && g.buttons.length >= 10) return g; return null; }
function clearFocus() { if (focusEl) focusEl.classList.remove("pad-focus"); focusEl = null; }
function activeOverlay() { for (const id of OVERLAYS) { const e = document.getElementById(id); if (e && !e.hidden) return e; } return null; }
function buttonsIn(root) { return [...root.querySelectorAll("button, .row[data-a]")].filter((b) => !b.disabled && b.getClientRects().length); }
function setFocus(el) { clearFocus(); focusEl = el; if (el) { el.classList.add("pad-focus"); el.scrollIntoView({ block: "nearest" }); } }
function nav(root, dir) {
  const list = buttonsIn(root); if (!list.length) return;
  let i = focusEl ? list.indexOf(focusEl) : -1;
  if (i < 0) { setFocus(list.find((b) => b.classList.contains("primary")) || list[0]); return; }
  const r0 = list[i].getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bd = 1e9;
  list.forEach((b, j) => {
    if (j === i) return;
    const r = b.getBoundingClientRect(), x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
    const ok = dir === "up" ? y < -4 : dir === "down" ? y > 4 : dir === "left" ? x < -4 : x > 4;
    if (!ok) return;
    const along = dir === "up" || dir === "down" ? Math.abs(y) : Math.abs(x), across = dir === "up" || dir === "down" ? Math.abs(x) : Math.abs(y);
    const d = along + across * 2.2;
    if (d < bd) { bd = d; best = b; }
  });
  if (best) setFocus(best);
}

function poll(dt) {
  const g = readPad();
  if (!g) { if (prev.length) { prev = []; releaseAll(); } return; }
  const down = (i) => !!(g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > TRIG));
  const now = []; for (let i = 0; i < 17; i++) now[i] = down(i);
  const edge = (i) => now[i] && !prev[i];
  const rad = (x, y) => { const m = Math.hypot(x, y); if (m < DEAD) return [0, 0]; const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; return [x * k, y * k]; };
  const [lx, ly] = rad(g.axes[0] || 0, g.axes[1] || 0), [rx, ry] = rad(g.axes[2] || 0, g.axes[3] || 0);
  Pad.lx = lx; Pad.ly = ly; Pad.rx = rx; Pad.ry = ry;
  Pad.lt = g.buttons[BTN.LT] ? g.buttons[BTN.LT].value : 0; Pad.rt = g.buttons[BTN.RT] ? g.buttons[BTN.RT].value : 0;
  if (now.some(Boolean) || lx || ly || rx || ry) setOn(true);
  const ov = activeOverlay();
  Pad.menu = !!ov;
  if (ov) {
    // menus: focus ring
    for (const c of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft"]) key(c, false);
    const ids = ov.id + (ov.id === "phone" ? document.querySelector("#ph-tabs .on")?.textContent : "");
    if (focusKey !== ov.id) { clearFocus(); focusKey = ov.id; }
    if (focusEl && !focusEl.isConnected) clearFocus();
    if (!focusEl && Pad.on) { const l = buttonsIn(ov); setFocus(l.find((b) => b.classList.contains("primary")) || l[0]); }
    let dir = "";
    if (now[BTN.UP] || ly < -0.6) dir = "up"; else if (now[BTN.DOWN] || ly > 0.6) dir = "down"; else if (now[BTN.LEFT] || lx < -0.6) dir = "left"; else if (now[BTN.RIGHT] || lx > 0.6) dir = "right";
    if (dir) { if (dir !== navDir) { navDir = dir; navT = 0.36; nav(ov, dir); } else { navT -= dt; if (navT <= 0) { navT = 0.14; nav(ov, dir); } } } else navDir = "";
    if (edge(BTN.A)) { if (focusEl) focusEl.click(); else nav(ov, "down"); }
    if (edge(BTN.B) || edge(BTN.MENU)) tap("Escape");
    if (ov.id === "phone") {
      const tabs = [...document.querySelectorAll("#ph-tabs button")], on = tabs.findIndex((b) => b.classList.contains("on"));
      if (edge(BTN.RB) && tabs[on + 1]) { tabs[on + 1].click(); clearFocus(); }
      if (edge(BTN.LB) && tabs[on - 1]) { tabs[on - 1].click(); clearFocus(); }
      if (edge(BTN.Y) || edge(BTN.VIEW)) tap("Tab");
    }
    if (ov.id === "talk") for (let n = 1; n <= 8; n++) { /* numbers are keyboard only */ }
    prev = now; return;
  }
  clearFocus(); focusKey = "";
  // play
  Pad.sprint = now[BTN.L3] || Pad.sprint && (lx || ly);
  if (!now[BTN.L3] && !(lx || ly)) Pad.sprint = false;
  if (edge(BTN.A)) tap("KeyE");
  if (edge(BTN.Y) || edge(BTN.VIEW)) tap("Tab");
  if (edge(BTN.MENU)) tap("Escape");
  if (edge(BTN.R3) || edge(BTN.X)) tap("KeyR");
  if (edge(BTN.B)) tap("KeyF");
  prev = now;
}
