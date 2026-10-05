// Swipes -> shot intents, mouse and touch alike. A swipe is judged when it
// is released (that moment is the swing for the timing windows).
//   swipe up      -> a drive: the angle aims it, a faster swipe hits harder,
//                    a longer one goes deeper; short and slow = a soft drop
//   swipe down    -> a lob (scoop under the ball)
//   tap           -> a dink, aimed toward the side of the screen you tap
// Also draws a fading trail of the finger on the #fx overlay.
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

export function swipeIntent(x0, y0, x1, y1, ms, W, H) {
  const m = Math.min(W, H);
  const dx = (x1 - x0) / m, dy = (y1 - y0) / m;
  const len = Math.hypot(dx, dy), sec = Math.max(0.04, ms / 1000);
  if (len < 0.06) return { kind: "dink", aim: clamp((x1 - W / 2) / (W * 0.32)), depth: 0.35, pace: 0.3, tap: true };
  const up = dy < 0;
  const ang = Math.atan2(dx, up ? -dy : dy);
  return {
    kind: up ? "drive" : "lob",
    aim: clamp(ang / 0.6),
    depth: clamp((len - 0.06) / 0.4, 0, 1),
    pace: clamp((len / sec - 0.8) / 3.2, 0, 1)
  };
}

export class Swipe {
  constructor(el, fx, onIntent) {
    this.el = el; this.fx = fx; this.onIntent = onIntent;
    this.cur = null;
    this.trails = [];
    this.enabled = false;
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", () => { this.cur = null; });
  }

  down(e) {
    if (!this.enabled) return;
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
    this.cur = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), pts: [[e.clientX, e.clientY]] };
  }

  move(e) {
    const c = this.cur;
    if (!c || c.id !== e.pointerId) return;
    c.pts.push([e.clientX, e.clientY]);
    if (c.pts.length > 40) c.pts.shift();
  }

  up(e) {
    const c = this.cur;
    if (!c || c.id !== e.pointerId) return;
    this.cur = null;
    if (!this.enabled) return;
    c.pts.push([e.clientX, e.clientY]);
    const it = swipeIntent(c.x0, c.y0, e.clientX, e.clientY, performance.now() - c.t0, innerWidth, innerHeight);
    this.trails.push({ pts: c.pts, t: 0, tap: !!it.tap });
    this.onIntent(it);
  }

  draw(dt) {
    const cv = this.fx, g = cv.getContext("2d");
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(innerWidth * dpr)) { cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    const live = this.cur ? [{ pts: this.cur.pts, t: 0 }] : [];
    for (const tr of [...this.trails, ...live]) {
      const a = 1 - tr.t / 0.35;
      if (a <= 0) continue;
      g.lineCap = "round"; g.lineJoin = "round";
      if (tr.tap) {
        const p = tr.pts[tr.pts.length - 1];
        g.strokeStyle = `rgba(228,255,58,${a})`; g.lineWidth = 4;
        g.beginPath(); g.arc(p[0], p[1], 18 + (1 - a) * 30, 0, Math.PI * 2); g.stroke();
        continue;
      }
      g.strokeStyle = `rgba(228,255,58,${0.85 * a})`; g.lineWidth = 10 * a + 2;
      g.beginPath();
      tr.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.stroke();
    }
    for (const tr of this.trails) tr.t += dt;
    this.trails = this.trails.filter((tr) => tr.t < 0.35);
  }
}
