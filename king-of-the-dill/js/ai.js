// Computer opponent decisions (also drives the human's side in #demo). Pure.
// Difficulty sets speed, reaction time, aim error and how clever the shots are.
// The AI is beatable on purpose: it is never faster than the human's auto-move.
import { COURT } from "./physics.js";
import { rightX } from "./rules.js";

export const LEVELS = {
  // pNet: chance of an unforced error into the net on any shot.
  easy:   { name: "Easy",   speed: 3.3, reaction: 0.40, err: 0.85, pace: [0.15, 0.45], smart: 0,   net: 0,   pNet: 0.09 },
  medium: { name: "Medium", speed: 4.0, reaction: 0.26, err: 0.55, pace: [0.3, 0.7],   smart: 0.5, net: 0.5, pNet: 0.05 },
  hard:   { name: "Hard",   speed: 4.6, reaction: 0.17, err: 0.32, pace: [0.45, 0.9],  smart: 1,   net: 1,   pNet: 0.03 }
};

const rnd = (rng, a, b) => a + (b - a) * rng();

// Where to wait between shots.
export function aiHome(lv, me, ballX, shots, rng) {
  const s = me.s;
  // After the third shot a clever player moves up to the kitchen line.
  const up = shots >= 3 && me.netUp;
  return { x: ballX * 0.45, z: s * (up ? 2.45 : 6.95) };
}

// Decide once per rally whether this player will come to the net.
export function aiRollNet(lv, rng) {
  return rng() < lv.net * 0.8;
}

// Should the AI let this ball go because it will land out?
export function aiLetGo(lv, firstBounce, volley, rng) {
  if (!firstBounce || volley) return false;
  const out = Math.abs(firstBounce.x) - COURT.halfW, deep = Math.abs(firstBounce.z) - COURT.halfL;
  const by = Math.max(out, deep);
  if (by <= 0.05) return false;
  return rng() < Math.min(1, lv.smart * 0.6 + 0.3) * Math.min(1, by / 0.4);
}

// The shot: { kind, aim, depth, pace } (aim in the hitter's frame, +1 = their right).
export function aiShot(lv, me, opp, contactY, shots, rng) {
  const r = rightX(me.side);
  const aimAt = (worldX) => Math.max(-1, Math.min(1, worldX / (2.6 * r)));
  const pace = rnd(rng, lv.pace[0], lv.pace[1]);
  const oppAtNet = Math.abs(opp.z) < 3.4;
  const meAtNet = Math.abs(me.z) < 3.4;

  if (contactY > 1.75 && lv.smart > 0) {
    return { kind: "drive", aim: aimAt(-opp.x * 0.8 + rnd(rng, -0.5, 0.5)), depth: rnd(rng, 0.3, 0.8), pace: 0.9 };
  }
  if (meAtNet && contactY < 0.7 && rng() < 0.4 + lv.smart * 0.4) {
    return { kind: "dink", aim: rnd(rng, -0.7, 0.7), depth: rnd(rng, 0.1, 0.6), pace: 0.3 };
  }
  // Third shot drop.
  if (shots === 2 && rng() < lv.smart * 0.6) {
    return { kind: "drive", aim: rnd(rng, -0.5, 0.5), depth: rnd(rng, 0, 0.25), pace: rnd(rng, 0, 0.15) };
  }
  if (oppAtNet && lv.smart > 0) {
    if (rng() < 0.18 * lv.smart) return { kind: "lob", aim: aimAt(-opp.x * 0.6), depth: rnd(rng, 0.4, 0.9), pace: 0.4 };
    // At the feet.
    return { kind: "drive", aim: aimAt(opp.x + rnd(rng, -0.4, 0.4)), depth: rnd(rng, 0.0, 0.25), pace: Math.max(pace, 0.6) };
  }
  if (lv.smart === 0) {
    return { kind: "drive", aim: rnd(rng, -0.45, 0.45), depth: rnd(rng, 0.45, 0.9), pace };
  }
  // Away from the opponent.
  const away = -Math.sign(opp.x || rnd(rng, -1, 1)) * rnd(rng, 1.0, 2.5) * (0.5 + lv.smart * 0.5);
  return { kind: "drive", aim: aimAt(away), depth: rnd(rng, 0.5, 1.0), pace };
}

// A serve: aim within the service court, deep, moderate pace.
export function aiServe(lv, rng) {
  return { kind: "serve", aim: rnd(rng, -0.8, 0.8), depth: rnd(rng, 0.35, 0.95), pace: rnd(rng, lv.pace[0], lv.pace[1]) };
}
