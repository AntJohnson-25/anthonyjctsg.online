// Shot solver: an intent (aim, depth, pace, kind) -> a launch velocity that
// lands where it was aimed and clears the net. Pure.
import { BALL, COURT, DT, netHeight, stepBall, copyBall } from "./physics.js";

// Fly from p0 with velocity v until the ball comes down to ball height.
// Returns { x, z, t, netY, netX } (netY: the ball's height where it crossed z = 0).
function fly(p0, v, spin) {
  const b = { x: p0.x, y: p0.y, z: p0.z, vx: v.x, vy: v.y, vz: v.z, spin };
  let netY = null, netX = 0;
  for (let t = DT; t < 6; t += DT) {
    const z0 = b.z, x0 = b.x, y0 = b.y;
    // Plain flight (no net, no bounce): copy of stepBall's air part.
    const sp = Math.hypot(b.vx, b.vy, b.vz), k = BALL.drag * sp;
    b.vx -= b.vx * k * DT; b.vz -= b.vz * k * DT;
    b.vy -= (BALL.g + b.vy * k + BALL.spinK * b.spin * sp) * DT;
    b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    if (netY === null && (z0 > 0) !== (b.z > 0)) {
      const u = z0 / (z0 - b.z);
      netY = y0 + (b.y - y0) * u; netX = x0 + (b.x - x0) * u;
    }
    if (b.y <= BALL.r && b.vy < 0) return { x: b.x, z: b.z, t, netY, netX };
  }
  return { x: b.x, z: b.z, t: 6, netY, netX };
}

// Velocity that lands on (tx, tz) from p0 in about T seconds.
export function solve(p0, tx, tz, T, spin = 0) {
  const g = BALL.g;
  const v = { x: (tx - p0.x) / T, z: (tz - p0.z) / T, y: (BALL.r - p0.y + 0.5 * g * T * T) / T };
  for (let i = 0; i < 14; i++) {
    const land = fly(p0, v, spin);
    const ex = tx - land.x, ez = tz - land.z;
    if (Math.abs(ex) < 0.01 && Math.abs(ez) < 0.01) break;
    const tt = Math.max(0.25, land.t);
    v.x += ex / tt; v.z += ez / tt;
  }
  return v;
}

// Launch velocity for a shot to (tx, tz) at horizontal speed hs (m/s).
// Lengthens the flight until the ball clears the net by `clear` metres.
export function shotVelocity(p0, tx, tz, hs, spin = 0, clear = 0.08) {
  const dist = Math.hypot(tx - p0.x, tz - p0.z);
  let T = Math.max(0.3, dist / hs);
  let v = null;
  for (let i = 0; i < 18; i++) {
    v = solve(p0, tx, tz, T, spin);
    const land = fly(p0, v, spin);
    if (land.netY === null || land.netY - BALL.r > netHeight(land.netX) + clear) break;
    T *= 1.1;
  }
  return v;
}

// Intent -> target and pace. side: the hitter's z sign (+1 human, -1 computer).
// right: world x of the hitter's right (+1 or -1). aim is in the hitter's frame
// (+1 = their right). Returns { tx, tz, hs, spin, kind }.
export function shotTarget(intent, side, right, contactY) {
  const aim = Math.max(-1, Math.min(1, intent.aim || 0));
  const depth = Math.max(0, Math.min(1, intent.depth == null ? 0.6 : intent.depth));
  const pace = Math.max(0, Math.min(1, intent.pace == null ? 0.5 : intent.pace));
  let kind = intent.kind || "drive", dz, hs, spin = 0, ax = 2.6;
  if (kind === "dink") { dz = 0.9 + depth * 0.9; hs = 4.6 + pace * 1.2; ax = 2.4; }
  else if (kind === "lob") { dz = 5.0 + depth * 1.2; hs = 6.0 + pace * 1.5; }
  else if (kind === "serve") { dz = 3.6 + depth * 2.6; hs = 9 + pace * 7; }
  else if (contactY > 1.65 && pace > 0.35) { kind = "smash"; dz = 3.2 + depth * 3; hs = 18 + pace * 8; }
  else if (pace < 0.22 && depth < 0.35) { kind = "drop"; dz = 1.2 + depth * 1.6; hs = 6 + pace * 6; }
  else { kind = "drive"; dz = 1.9 + depth * 4.5; hs = 8 + pace * 12; spin = 0.2 + pace * 0.6; }
  return { tx: aim * right * ax, tz: -side * dz, hs, spin, kind };
}

export { copyBall, stepBall, COURT };
