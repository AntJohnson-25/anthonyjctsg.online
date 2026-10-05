// The match: players, ball, rules, AI and the swipe timing. Pure: no DOM, no
// three.js. The view and HUD only read this state and drain `events`.
import { DT, COURT, makeBall, stepBall, predict } from "./physics.js";
import { shotVelocity, shotTarget, solve } from "./shots.js";
import { Rules, other, rightX } from "./rules.js";
import { LEVELS, aiHome, aiShot, aiServe, aiLetGo, aiRollNet } from "./ai.js";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Swipe timing windows, seconds relative to the moment of contact.
export const TIMING = { early: 0.3, perfect: 0.06, good: 0.13, late: 0.2 };
export const PLAYER_SPEED = 5.0;   // the human's auto-move, faster than every AI level
const REACH = 1.05;                // how far from the ideal spot a hit still connects
const BASE_Z = 6.95, KITCHEN_Z = 2.45;

function makePlayer(side, lv) {
  const s = side === "p" ? 1 : -1;
  return {
    side, s, x: 0, z: s * BASE_Z, vx: 0, vz: 0,
    speed: lv ? lv.speed : PLAYER_SPEED, lv,
    plan: null, planAt: 0, letGo: false,
    swing: null,      // { kind, t } the last swing (t = contact time)
    netUp: false, mood: null, moodT: 0,
    tx: 0, tz: s * BASE_Z
  };
}

export class Game {
  constructor(opts = {}) {
    this.level = opts.level || "medium";
    this.demo = !!opts.demo;
    this.rng = mulberry32(opts.seed == null ? (Date.now() & 0xffffffff) : opts.seed);
    this.p = makePlayer("p", this.demo ? LEVELS.medium : null);
    this.c = makePlayer("c", LEVELS[this.level]);
    this.rules = new Rules(opts.first || "p", opts.target || 11);
    this.ball = makeBall();
    this.ballLive = false;
    this.time = 0;
    this.phase = "setup";
    this.phaseT = 0;
    this.events = [];
    this.depthPref = "base";
    this.swipe = null;
    this.pred = null;
    this.rally = 0;
    this.stats = { rallies: [], perfect: 0, hits: 0 };
    this.setupServe();
  }

  get(side) { return side === "p" ? this.p : this.c; }
  emit(e) { e.time = this.time; this.events.push(e); }
  drain() { const e = this.events; this.events = []; return e; }
  human() { return !this.demo; }
  aiControlled(pl) { return pl.side === "c" || this.demo; }

  setupServe() {
    const R = this.rules;
    R.startRally();
    this.phase = "setup";
    this.phaseT = 0;
    this.ballLive = false;
    this.rally = 0;
    this.pred = null;
    this.swipe = null;
    const server = this.get(R.server), recv = this.get(other(R.server));
    const sx = R.serveXSign();
    server.tx = sx * 0.9; server.tz = server.s * BASE_Z;
    recv.tx = -sx * 1.4; recv.tz = recv.s * BASE_Z;
    for (const pl of [this.p, this.c]) {
      pl.plan = null; pl.letGo = false; pl.swing = null;
      if (pl.lv) pl.netUp = aiRollNet(pl.lv, this.rng);
    }
    this.emit({ type: "setup", server: R.server, call: R.call() });
  }

  // Where the server holds the ball before the serve.
  heldBall() {
    const pl = this.get(this.rules.server), r = rightX(pl.side);
    return { x: pl.x + r * 0.32, y: 0.62, z: pl.z - pl.s * 0.42 };
  }

  // Human input: a swipe already turned into an intent by input.js.
  input(intent) {
    if (this.demo) return;
    if (this.phase === "serve" && this.rules.server === "p") {
      this.serve(this.p, { ...intent, kind: "serve" });
      return;
    }
    if (this.phase === "rally") this.swipe = { intent, t: this.time };
  }

  setDepth(pref) { this.depthPref = pref; }

  serve(pl, intent) {
    const R = this.rules, r = rightX(pl.side), sx = R.serveXSign();
    const p0 = this.heldBall();
    const aim = Math.max(-1, Math.min(1, intent.aim || 0));
    const depth = Math.max(0, Math.min(1, intent.depth == null ? 0.6 : intent.depth));
    const pace = Math.max(0, Math.min(1, intent.pace == null ? 0.5 : intent.pace));
    // Diagonal service court: centre x = -sx * halfW / 2; aim moves it within the box.
    let tx = -sx * COURT.halfW / 2 + aim * r * 1.25;
    let tz = -pl.s * (3.5 + depth * 2.7);
    const sig = pl.lv ? pl.lv.err * 0.35 : 0.2;
    tx += gauss(this.rng) * sig;
    tz += gauss(this.rng) * sig * 1.2;
    const v = shotVelocity(p0, tx, tz, 9 + pace * 7, 0, 0.14);
    Object.assign(this.ball, p0, { vx: v.x, vy: v.y, vz: v.z, spin: 0 });
    this.ballLive = true;
    R.hit(pl.side, false, pl.z);
    this.rally = 1;
    pl.swing = { kind: "serve", t: this.time };
    this.phase = "rally";
    this.phaseT = 0;
    this.emit({ type: "hit", who: pl.side, kind: "serve", speed: Math.hypot(v.x, v.y, v.z) });
    this.afterHit(pl);
  }

  // A new trajectory: plan the receiver's contact.
  afterHit(hitter) {
    this.pred = predict(this.ball, 3.4, 2);
    this.predTime = this.time;
    hitter.plan = null;
    hitter.letGo = false;
    const recv = this.get(other(hitter.side));
    recv.plan = null;
    recv.letGo = false;
    recv.planAt = this.time + (recv.lv ? recv.lv.reaction : 0);
    recv.needPlan = true;
    this.swipe = null;
    const fb = this.pred.bounces[0];
    this.emit({ type: "predict", bounce: fb || null, out: fb ? !this.landsIn(fb) : true });
  }

  landsIn(b) {
    const R = this.rules;
    if (Math.abs(b.x) > COURT.halfW + 0.02 || Math.abs(b.z) > COURT.halfL + 0.02) return false;
    if (R.shots === 1) return Math.abs(b.z) > COURT.kitchen && b.x * R.serveXSign() <= 0.02;
    return (b.z > 0 ? "p" : "c") !== R.lastHitter;
  }

  // Best reachable contact on the predicted path, or null.
  choose(pl, delay) {
    const pred = this.pred;
    if (!pred || pred.net) return null;
    const R = this.rules, r = rightX(pl.side), mb = R.mustBounce();
    let best = null, bestScore = 1e9;
    const t0 = this.time - this.predTime;   // samples are timed from the prediction
    for (const smp of pred.samples) {
      if (smp.t < t0) continue;
      if (smp.b >= 2) break;
      if (smp.z * pl.s < 0.3) continue;
      const volley = smp.b === 0;
      if (volley && mb) continue;
      const h = smp.y;
      if (h < 0.2 || h > 2.45) continue;
      const over = h > 1.6;
      const fh = over || (smp.x - pl.x) * r > -0.2;
      const off = over ? 0.3 : fh ? 0.62 : -0.5;
      const sx = smp.x - r * off;
      const sz = smp.z + pl.s * (over ? 0.2 : 0.35);
      if (volley && Math.abs(sz) < COURT.kitchen + 0.12) continue;
      const left = smp.t - t0;
      const need = Math.hypot(sx - pl.x, sz - pl.z) / pl.speed + delay;
      if (need > left + 0.04) continue;
      let sc = Math.abs(h - (over ? 2.0 : 0.85)) + left * 0.3;
      if (volley && Math.abs(pl.z) < 3.6) sc -= 0.6;
      if (sc < bestScore) {
        bestScore = sc;
        best = { t: this.time + left, x: smp.x, y: h, z: smp.z, standX: sx, standZ: sz, kind: over ? "oh" : fh ? "fh" : "bh", volley };
      }
    }
    return best;
  }

  step(dt = DT) {
    this.time += dt;
    this.phaseT += dt;
    const ph = this.phase;
    if (ph === "setup") {
      let ready = true;
      for (const pl of [this.p, this.c]) {
        this.move(pl, pl.tx, pl.tz, pl.speed * 1.3, dt);
        if (Math.hypot(pl.x - pl.tx, pl.z - pl.tz) > 0.12) ready = false;
      }
      if ((ready && this.phaseT > 0.6) || this.phaseT > 3) {
        this.phase = "serve";
        this.phaseT = 0;
        this.emit({ type: "serveReady", server: this.rules.server, call: this.rules.call(), human: !this.aiControlled(this.get(this.rules.server)) });
      }
    } else if (ph === "serve") {
      for (const pl of [this.p, this.c]) this.move(pl, pl.tx, pl.tz, pl.speed, dt);
      const server = this.get(this.rules.server);
      if (this.aiControlled(server) && this.phaseT > 1.1) this.serve(server, aiServe(server.lv, this.rng));
    } else if (ph === "rally" || ph === "point") {
      this.stepBallAndRules();
      if (this.phase === "rally") this.stepPlayers(dt);
      else this.idlePlayers(dt);
      if (this.phase === "point" && this.phaseT > 2.3) {
        if (this.rules.winner) {
          this.phase = "over";
          this.phaseT = 0;
          const w = this.get(this.rules.winner);
          w.mood = "twirl"; w.moodT = this.time;
          this.get(other(this.rules.winner)).mood = "shake";
          this.emit({ type: "gameOver", winner: this.rules.winner, score: { ...this.rules.score } });
        } else this.setupServe();
      }
    } else if (ph === "over") {
      this.idlePlayers(dt);
      if (this.ballLive) this.stepBallAndRules();
    }
    for (const pl of [this.p, this.c]) if (pl.mood && this.phase !== "over" && this.time - pl.moodT > 2.2) pl.mood = null;
  }

  stepBallAndRules() {
    if (!this.ballLive) return;
    // A ball nobody can call (rolled dead, stuck): the last hitter loses it.
    if (this.phase === "rally" && this.time - this.predTime > 6) {
      this.pointOver(this.rules.end(this.rules.lastHitter || this.rules.server, "dead ball"));
      return;
    }
    const ev = stepBall(this.ball, DT);
    if (!ev) return;
    if (ev.type === "net") this.emit({ type: "net", cord: ev.cord });
    if (ev.type === "bounce") {
      this.emit({ type: "bounce", x: ev.x, z: ev.z, hard: Math.abs(this.ball.vy) });
      if (this.phase === "rally") {
        const res = this.rules.bounce(ev.x, ev.z);
        if (res) this.pointOver(res);
      }
      if (this.ball.vy === 0 && Math.hypot(this.ball.vx, this.ball.vz) < 0.3) this.ballLive = this.phase === "rally";
    }
  }

  pointOver(res) {
    if (this.phase !== "rally") return;
    const R = this.rules;
    const callBefore = R.call();
    const a = R.award();
    this.phase = "point";
    this.phaseT = 0;
    this.stats.rallies.push(this.rally);
    const w = this.get(a.winner), l = this.get(other(a.winner));
    w.mood = "win"; w.moodT = this.time;
    l.mood = "lose"; l.moodT = this.time;
    w.plan = l.plan = null;
    this.emit({ type: "point", winner: a.winner, reason: a.reason, scored: a.scored, sideOut: a.sideOut,
      call: R.call(), callBefore, score: { ...R.score }, server: R.server, rally: this.rally });
  }

  stepPlayers(dt) {
    const R = this.rules;
    for (const pl of [this.p, this.c]) {
      const opp = this.get(other(pl.side));
      // Plan once the reaction time has passed (immediately for the human).
      if (pl.needPlan && this.time >= pl.planAt) {
        pl.needPlan = false;
        pl.plan = this.choose(pl, 0);
        if (pl.plan && pl.lv) {
          const fb = this.pred.bounces[0];
          const own = fb && fb.z * pl.s > 0 ? fb : null;
          if (aiLetGo(pl.lv, own, pl.plan.volley, this.rng)) { pl.plan = null; pl.letGo = true; }
        }
        if (!pl.plan && !pl.letGo) this.emit({ type: "noReach", who: pl.side });
      }
      let tx, tz;
      if (pl.plan) { tx = pl.plan.standX; tz = pl.plan.standZ; }
      else if (pl.lv) { const h = aiHome(pl.lv, pl, this.ball.x, R.shots, this.rng); tx = h.x; tz = h.z; }
      else { tx = this.ball.x * 0.4; tz = pl.s * (this.depthPref === "kitchen" && R.shots >= 2 ? KITCHEN_Z : BASE_Z); }
      // Chasing a ball it cannot reach: run at the bounce anyway.
      if (!pl.plan && R.lastHitter === opp.side && !pl.letGo && !pl.needPlan && this.pred && this.pred.bounces[0]) {
        const b = this.pred.bounces[0];
        if (b.z * pl.s > 0) { tx = b.x; tz = b.z + pl.s * 0.6; }
      }
      this.move(pl, tx, tz, pl.speed, dt);
      if (pl.plan) this.tryHit(pl, opp);
    }
  }

  idlePlayers(dt) {
    for (const pl of [this.p, this.c]) this.move(pl, pl.x, pl.z, pl.speed, dt);
  }

  tryHit(pl, opp) {
    const plan = pl.plan, t = this.time;
    if (this.aiControlled(pl)) {
      if (t < plan.t) return;
      pl.plan = null;
      if (Math.hypot(pl.x - plan.standX, pl.z - plan.standZ) > REACH) { this.emit({ type: "whiff", who: pl.side }); return; }
      this.hit(pl, aiShot(pl.lv, pl, opp, this.ball.y, this.rules.shots, this.rng), null, plan);
      return;
    }
    const sw = this.swipe;
    if (sw && sw.t < plan.t - TIMING.early) this.swipe = null;   // far too early: ignored
    if (this.swipe && t >= plan.t) {
      const dtw = this.swipe.t - plan.t;   // negative = early
      const q = Math.abs(dtw) <= TIMING.perfect ? "perfect" : Math.abs(dtw) <= TIMING.good ? "good" : dtw < 0 ? "early" : "late";
      const intent = this.swipe.intent;
      this.swipe = null;
      pl.plan = null;
      if (Math.hypot(pl.x - plan.standX, pl.z - plan.standZ) > REACH) {
        this.emit({ type: "timing", who: "p", q: "far" });
        return;
      }
      this.hit(pl, intent, q, plan);
      return;
    }
    if (t > plan.t + TIMING.late) {
      pl.plan = null;
      this.emit({ type: "timing", who: "p", q: "miss" });
    }
  }

  hit(pl, intent, q, plan) {
    const R = this.rules, b = this.ball, r = rightX(pl.side);
    const volley = R.bounces[pl.side] === 0;
    const res = R.hit(pl.side, volley, pl.z);
    const tgt = shotTarget(intent, pl.s, r, b.y);
    let sig, clear, bias = 0, pNet;
    if (pl.lv) {
      sig = pl.lv.err;
      clear = 0.1;
      pNet = pl.lv.pNet;
    } else {
      sig = q === "perfect" ? 0.1 : q === "good" ? 0.3 : 0.6;
      clear = q === "perfect" ? 0.16 : q === "good" ? 0.09 : 0.06;
      pNet = q === "perfect" ? 0 : q === "good" ? 0.03 : 0.16;
      if (q === "early" || q === "late") bias = (q === "early" ? -1 : 1) * (plan.kind === "bh" ? -1 : 1) * 0.75 * r;
      if (q === "perfect") { tgt.hs *= 1.1; this.stats.perfect++; }
      this.stats.hits++;
    }
    if (tgt.kind === "dink" || tgt.kind === "drop") sig *= 0.6;
    if (tgt.kind === "drive") sig *= 1 + (intent.pace || 0) * 0.4;
    const tx = tgt.tx + bias + gauss(this.rng) * sig;
    const tz = tgt.tz + gauss(this.rng) * sig * 1.15;
    const p0 = { x: b.x, y: b.y, z: b.z };
    // Unforced error: a flat ball at the tape (it may still sneak over).
    const v = this.rng() < pNet * (tgt.kind === "dink" ? 0.6 : 1)
      ? solve(p0, tx, -pl.s * 0.9, Math.hypot(tx - b.x, b.z) / (tgt.hs * 1.3), 0)
      : shotVelocity(p0, tx, tz, tgt.hs, tgt.spin, clear);
    b.vx = v.x; b.vy = v.y; b.vz = v.z; b.spin = tgt.spin;
    this.rally++;
    pl.swing = { kind: tgt.kind === "smash" ? "oh" : tgt.kind === "dink" || tgt.kind === "drop" ? plan.kind + "-soft" : plan.kind, t: this.time };
    const speed = Math.hypot(v.x, v.y, v.z);
    if (q) this.emit({ type: "timing", who: pl.side, q });
    this.emit({ type: "hit", who: pl.side, kind: tgt.kind, speed, volley, contactY: b.y });
    this.afterHit(pl);
    if (res) this.pointOver(res);
  }

  move(pl, tx, tz, speed, dt) {
    // Stay on your own side.
    if (tz * pl.s < 0.4) tz = pl.s * 0.4;
    const dx = tx - pl.x, dz = tz - pl.z, d = Math.hypot(dx, dz);
    const want = Math.min(speed, d * 5);
    const vx = d > 1e-4 ? dx / d * want : 0, vz = d > 1e-4 ? dz / d * want : 0;
    const k = Math.min(1, dt * 9);
    pl.vx += (vx - pl.vx) * k;
    pl.vz += (vz - pl.vz) * k;
    pl.x += pl.vx * dt;
    pl.z += pl.vz * dt;
  }

  // For the HUD timing ring: seconds until the human's contact, and where.
  humanContact() {
    const pl = this.p;
    if (this.demo || !pl.plan) return null;
    return { left: pl.plan.t - this.time, x: pl.plan.x, y: pl.plan.y, z: pl.plan.z, kind: pl.plan.kind };
  }
}

export { LEVELS };
