// Court constants, ball physics and trajectory prediction. Pure: no DOM, no three.js.
//
// Coordinates are metres. The net is the plane z = 0, the human player is on
// +z facing -z, the computer on -z facing +z. y is up.

export const COURT = {
  halfW: 3.048,      // 20 ft wide
  halfL: 6.706,      // 44 ft long
  kitchen: 2.134,    // 7 ft non-volley zone each side of the net
  netCenter: 0.864,  // 34 in
  netSide: 0.914,    // 36 in at the sidelines
  netHalfW: 3.353    // posts 1 ft outside the sidelines
};

export const BALL = {
  r: 0.037,          // 74 mm ball
  g: 9.81,
  drag: 0.042,       // quadratic drag, 1/m (a holed ball slows a lot)
  spinK: 0.35,       // topspin dip, per unit spin, per m/s
  e: 0.62,           // vertical restitution (78 in drop -> ~31 in bounce)
  fric: 0.80,        // horizontal speed kept on a bounce
  fricSpin: 0.9      // ... with topspin
};

export const DT = 1 / 120;

export function netHeight(x) {
  return COURT.netCenter + (COURT.netSide - COURT.netCenter) * Math.min(1, Math.abs(x) / COURT.halfW);
}

// Lines are in.
export function inBounds(x, z, eps = 0.02) {
  return Math.abs(x) <= COURT.halfW + eps && Math.abs(z) <= COURT.halfL + eps;
}

export function makeBall() {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
}

export function copyBall(b) {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin };
}

// One fixed step. Returns null, or an event: { type: "bounce", x, z } or { type: "net", cord }.
export function stepBall(b, dt = DT) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const k = BALL.drag * sp;
  b.vx -= b.vx * k * dt;
  b.vz -= b.vz * k * dt;
  b.vy -= (BALL.g + b.vy * k + BALL.spinK * b.spin * sp) * dt;
  const z0 = b.z, x0 = b.x, y0 = b.y;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  let ev = null;
  // Net: did the ball's centre cross z = 0 this step?
  if ((z0 > 0) !== (b.z > 0) && z0 !== 0) {
    const u = z0 / (z0 - b.z);
    const xc = x0 + (b.x - x0) * u, yc = y0 + (b.y - y0) * u;
    const top = netHeight(xc);
    if (Math.abs(xc) < COURT.netHalfW && yc - BALL.r < top) {
      if (yc > top - BALL.r * 0.6) {
        // Clipped the tape: it dribbles over, slowed and popped up.
        b.vz *= 0.35; b.vx *= 0.5; b.vy = Math.abs(b.vy) * 0.25 + 0.6;
        b.y = Math.max(b.y, top + BALL.r);
        ev = { type: "net", cord: true };
      } else {
        // Into the net: it drops on the hitter's side.
        const s = z0 > 0 ? 1 : -1;
        b.z = s * BALL.r * 1.5;
        b.vz = -b.vz * 0.12; b.vx *= 0.3; b.vy = Math.min(b.vy, 0) * 0.3;
        b.spin = 0;
        ev = { type: "net", cord: false };
      }
    }
  }
  if (b.y < BALL.r && b.vy < 0) {
    b.y = BALL.r;
    b.vy = -b.vy * BALL.e;
    const f = b.spin > 0.1 ? BALL.fricSpin : BALL.fric;
    b.vx *= f; b.vz *= f;
    b.spin *= 0.4;
    if (b.vy < 0.25) b.vy = 0;   // rolling
    ev = { type: "bounce", x: b.x, z: b.z };
  }
  return ev;
}

// Fly a copy of the ball forward. Samples every step until the second bounce
// (or maxT). Each sample: { t, x, y, z, b } where b = bounces so far.
export function predict(ball, maxT = 3.2, maxBounces = 2) {
  const b = copyBall(ball);
  const samples = [];
  const bounces = [];
  let n = 0;
  let net = false;
  for (let t = DT; t <= maxT; t += DT) {
    const ev = stepBall(b);
    if (ev && ev.type === "bounce") { n++; bounces.push({ t, x: ev.x, z: ev.z }); }
    if (ev && ev.type === "net" && !ev.cord) net = true;
    samples.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, b: n });
    if (n >= maxBounces) break;
  }
  return { samples, bounces, net };
}
