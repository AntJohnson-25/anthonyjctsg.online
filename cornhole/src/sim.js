// Cornhole: the whole game as pure logic (no THREE, no DOM), so Node can test it and every screen runs the same code.
//
// The lane runs along Z. Two regulation boards face each other 27 ft apart; each round the bags fly toward ONE of them
// (`dir` = +1 or -1, the side of the lane its z is on) and the next round swaps ends. Bag physics is deterministic
// at a fixed 1/240 s step, so every screen flies the same bag from the same throw message; the HOST then sends the
// settled state (`snap`) and everyone snaps to it, so a tiny floating-point difference can never split the score.
//
// Rules: two sides (even seats vs odd seats), 4 bags each per round, throws alternate between sides. After the round:
// bag in the hole = 3, bag on the board = 1, anywhere else = 0, and the points CANCEL (6 vs 4 -> 2 for the higher
// side). First to the target wins. The side that scored throws first next round.
(function (root) {
  "use strict";
  const SB = root.SB || (root.SB = {});

  const G = 9.81;
  const C = {
    LANE: 4.115,                     // z of each board's front edge (27 ft between the two front edges)
    BL: 1.2192, BW: 0.6096,          // board 4 ft x 2 ft
    HF: 0.0762, HB: 0.3048,          // front 3 in, back 12 in
    HOLE_U: 0.9144, HOLE_R: 0.0762,  // hole centre 12 in from the back edge, 6 in across
    BAG_R: 0.082, BAG_T: 0.04,
    PER_SIDE: 4,
    STAND: 3.72,                     // thrower stands this far from the lane centre, in front of the near board
    REL_Y: 1.02,                     // release height
    VMIN: 6.4, VMAX: 11.2,           // release speed at power 0 .. 1 (a narrow span keeps the timing fair)
    PIT_MIN: 0.38, PIT_MAX: 1.12,    // launch angle limits (rad)
    YAW_MAX: 0.30,
    X_MAX: 0.85,                     // how far along the box the thrower may shift
    SWING: 0.16,                     // from the click to the bag leaving the hand
    TURN_TIME: 30                    // a silent thrower forfeits the bag after this
  };
  const TA = (C.HB - C.HF) / C.BL, AL = Math.atan(TA), SIN = Math.sin(AL), COS = Math.cos(AL);
  const M = { HAND: 0, AIR: 1, BOARD: 2, GROUND: 3, FALL: 4, HOLE: 5, VOID: 6 };
  // style 0 = slider (flat, keeps sliding), 1 = flipper (tumbles, stops dead). e = bounce, mi = grip on landing, mk = sliding friction.
  const STY = [{ e: 0.02, mi: 0.34, mk: 0.40, flr: 0 }, { e: 0.10, mi: 0.85, mk: 0.82, flr: 5.2 }];
  const H = 1 / 240;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hAt = (u) => C.HF + clamp(u, 0, C.BL) * TA;

  function rngOf(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = (r) => (r() + r() + r() + r() - 2) * 1.7;

  function newBag(side, who, id) {
    return { id: id, side: side, who: who, dir: 1, mode: M.HAND, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, u: 0, vu: 0, yaw: 0, wy: 0, fl: 0, flr: 0, style: 0, touched: false, air: false, hit: false, ev: null };
  }
  const moving = (b) => b.mode === M.AIR || b.mode === M.FALL || (b.mode === M.BOARD && Math.hypot(b.vx, b.vu) > 0.02) || (b.mode === M.GROUND && Math.hypot(b.vx, b.vz) > 0.05);

  // ---------------------------------------------------------------- one bag, one fixed step
  function stepBag(b, dir, ev) {
    switch (b.mode) {
      case M.AIR: {
        b.vy -= G * H; b.x += b.vx * H; b.y += b.vy * H; b.z += b.vz * H; b.fl += b.flr * H; b.yaw += b.wy * H;
        const u = dir * b.z - C.LANE;
        if (b.vy < 0 && u > -0.03 && u < C.BL + 0.03 && Math.abs(b.x) < C.BW / 2 + 0.03 && b.y <= hAt(u) + C.BAG_T / 2) land(b, dir, u, ev);
        else if (b.vy < 0 && b.y <= C.BAG_T / 2) {
          b.y = C.BAG_T / 2; b.vy = 0; b.mode = M.GROUND; b.touched = true; b.fl = 0; b.flr = 0;
          if (ev) ev({ t: "ground", bag: b });
        }
        break;
      }
      case M.BOARD: {
        const st = STY[b.style];
        const dh = Math.hypot(b.x, b.u - C.HOLE_U);
        const sp0 = Math.hypot(b.vx, b.vu);
        if (dh < 0.068 && sp0 < 3.6) { toHole(b, dir, false, ev); break; }
        if (dh < 0.118 && sp0 < 1.3) {             // hanging over the edge: the hole pulls it in
          const k = 14 * (1 - (dh - 0.068) / 0.05);
          b.vx -= (b.x / dh) * k * H; b.vu -= ((b.u - C.HOLE_U) / dh) * k * H;
        }
        const sp = Math.hypot(b.vx, b.vu);
        if (sp > 0.015) {
          const f = Math.min(sp, st.mk * G * COS * H);
          b.vx -= (b.vx / sp) * f; b.vu -= (b.vu / sp) * f; b.vu -= G * SIN * H;
        } else { b.vx = 0; b.vu = 0; }
        b.x += b.vx * H; b.u += b.vu * H; b.yaw += b.wy * H; b.wy *= 1 - 4 * H;
        b.z = dir * (C.LANE + b.u); b.y = hAt(b.u) + C.BAG_T / 2;
        if (Math.abs(b.x) > C.BW / 2 + 0.005 || b.u > C.BL + 0.005 || b.u < -0.005) {      // over the edge
          b.mode = M.AIR; b.vz = dir * b.vu; b.vy = b.vu * TA * 0.5; b.touched = true; b.fl = 0; b.flr = 0;
          if (ev) ev({ t: "off", bag: b });
        }
        break;
      }
      case M.GROUND: {
        const d = 1 - 7 * H;
        b.vx *= d; b.vz *= d; b.x += b.vx * H; b.z += b.vz * H; b.yaw += b.wy * H; b.wy *= d;
        if (Math.hypot(b.vx, b.vz) < 0.03) { b.vx = 0; b.vz = 0; }
        break;
      }
      case M.FALL: {                                  // through the hole
        b.vy -= G * H; b.y += b.vy * H;
        const hz = dir * (C.LANE + C.HOLE_U);
        if (b.y > 0.1) {                              // stay inside the hole until clear of the board
          const dx = b.x, dz = b.z - hz, d = Math.hypot(dx, dz), lim = C.HOLE_R - 0.035;
          if (d > lim) { b.x = dx / d * lim; b.z = hz + dz / d * lim; }
        }
        b.yaw += b.wy * H;
        if (b.y <= C.BAG_T / 2) { b.y = C.BAG_T / 2; b.vy = 0; b.vx = 0; b.vz = 0; b.mode = M.HOLE; if (ev) ev({ t: "drop", bag: b }); }
        break;
      }
    }
  }

  function land(b, dir, u, ev) {
    const st = STY[b.style];
    const first = !b.touched;
    const nz = -dir * SIN;                           // surface normal (0, COS, nz)
    const vn = b.vy * COS + b.vz * nz;
    let vx = b.vx, vy = b.vy, vz = b.vz;
    if (vn < 0) {
      vy -= (1 + st.e) * vn * COS; vz -= (1 + st.e) * vn * nz;
      const dn = vy * COS + vz * nz;
      let tx = vx, ty = vy - dn * COS, tz = vz - dn * nz;
      const tm = Math.hypot(tx, ty, tz), jn = (1 + st.e) * -vn, fr = Math.min(tm, st.mi * jn);
      if (tm > 1e-6) { const k = (tm - fr) / tm; tx *= k; ty *= k; tz *= k; }
      b.vx = tx; b.vu = dir * tz;
    } else { b.vu = dir * b.vz; }
    b.mode = M.BOARD; b.u = clamp(u, 0, C.BL); b.touched = true; b.fl = 0; b.flr = 0; b.vy = 0;
    b.z = dir * (C.LANE + b.u); b.y = hAt(b.u) + C.BAG_T / 2;
    if (ev) ev({ t: "land", bag: b, first: first, speed: -vn });
    if (Math.hypot(b.x, b.u - C.HOLE_U) < C.HOLE_R - 0.004) toHole(b, dir, first, ev);
  }
  function toHole(b, dir, air, ev) {
    b.mode = M.FALL; b.air = air; b.vx *= 0.2; b.vz = dir * b.vu * 0.2; b.vy = -0.6; b.vu = 0; b.touched = true;
    if (ev) ev({ t: "hole", bag: b, air: air });
  }

  // Bags lying on the board push each other (equal mass, a little bounce).
  function collide(bags, ev) {
    for (let i = 0; i < bags.length; i++) {
      const a = bags[i];
      if (a.mode !== M.BOARD) continue;
      for (let j = i + 1; j < bags.length; j++) {
        const b = bags[j];
        if (b.mode !== M.BOARD) continue;
        if (a.dir !== b.dir) continue;               // bags on different boards never touch
        const dx = b.x - a.x, du = b.u - a.u, d2 = dx * dx + du * du, R2 = (C.BAG_R * 2) * (C.BAG_R * 2);
        if (d2 >= R2 || d2 < 1e-10) continue;
        const d = Math.sqrt(d2), nx = dx / d, nu = du / d, ov = C.BAG_R * 2 - d;
        a.x -= nx * ov / 2; a.u -= nu * ov / 2; b.x += nx * ov / 2; b.u += nu * ov / 2;
        const vr = (b.vx - a.vx) * nx + (b.vu - a.vu) * nu;
        if (vr < 0) {
          const j2 = -(1 + 0.30) * vr / 2;
          a.vx -= j2 * nx; a.vu -= j2 * nu; b.vx += j2 * nx; b.vu += j2 * nu;
          if (ev && -vr > 0.25) ev({ t: "bump", bag: a, other: b, speed: -vr });
        }
      }
    }
  }

  // ---------------------------------------------------------------- release geometry (shared by throws, probes, bots)
  const standZ = (dir) => -dir * C.STAND;
  function release(dir, p) {
    const yaw = clamp(+p.yaw || 0, -C.YAW_MAX, C.YAW_MAX), pit = clamp(+p.pit || 0.8, C.PIT_MIN, C.PIT_MAX), pw = clamp(+p.p || 0, 0, 1);
    const x0 = clamp(+p.x || 0, -C.X_MAX, C.X_MAX), v = C.VMIN + pw * (C.VMAX - C.VMIN), st = p.st ? 1 : 0;
    const cp = Math.cos(pit);
    return {
      x: x0 - dir * 0.16, y: C.REL_Y, z: standZ(dir) + dir * 0.30,
      vx: -dir * Math.sin(yaw) * cp * v, vy: Math.sin(pit) * v, vz: dir * Math.cos(yaw) * cp * v,
      st: st, yaw: yaw, pit: pit, p: pw, x0: x0
    };
  }
  function launch(b, dir, r, spinSeed) {
    b.mode = M.AIR; b.x = r.x; b.y = r.y; b.z = r.z; b.vx = r.vx; b.vy = r.vy; b.vz = r.vz;
    b.style = r.st; b.flr = STY[r.st].flr; b.fl = 0; b.yaw = 0; b.wy = r.st ? 0 : ((spinSeed % 7) - 3) * 0.7;
  }
  // Fly one bag alone over an empty board and say where it ends (for the power-meter marks and the bots).
  function probe(dir, p) {
    const b = newBag(0, 0, -1);
    launch(b, dir, release(dir, p), 3);
    for (let i = 0; i < 240 * 7; i++) {
      stepBag(b, dir, null);
      if (b.mode === M.HOLE) break;
      if (i > 60 && !moving(b)) break;
    }
    const inHole = b.mode === M.HOLE || b.mode === M.FALL;
    return { mode: b.mode, inHole: inHole, air: b.air, u: inHole ? C.HOLE_U : dir * b.z - C.LANE, x: inHole ? 0 : b.x, onBoard: b.mode === M.BOARD };
  }

  // ---------------------------------------------------------------- the match
  function createSim(o) {
    const players = o.players.map((p, i) => ({ name: p.name, bot: !!p.bot, side: i % 2, left: false, end: 0 }));
    const team = [[], []];
    players.forEach((p, i) => team[p.side].push(i));
    // Which end of the lane each player stands at (official layout): opponents in a 1v1 stand at opposite ends; in 2v2
    // each team has a player at each end, so one opponent shares your end. Nobody walks during a round (ends swap between rounds).
    players.forEach((p) => { p.end = team[p.side].length === 1 ? p.side : team[p.side].indexOf(players.indexOf(p)) % 2; });
    const sim = {
      C: C, M: M, players: players, team: team, target: o.target || 15, difficulty: o.difficulty === undefined ? 1 : o.difficulty,
      isHost: !!o.host, me: o.me === undefined ? -1 : o.me, rng: rngOf(o.seed || 1),
      phase: "wait", round: 0, dir: 1, first: 0, nThrown: 0, scores: [0, 0], roundPts: [0, 0], winner: -1, lastNet: null, summary: null,
      bags: [], turnT: 0, phaseT: 0, flightT: 0, quiet: 0, swingT: 0, pending: null, events: [], acc: 0, t: 0,
      aim: { x: 0, yaw: 0, pit: 0.8, ch: -1, st: 0 }, think: null, introHold: false
    };

    // The throwing direction of player i (+1 = toward the +z board): the board at the far end from where they stand.
    sim.dirOf = function (i) { const p = players[i]; return p ? (p.end === 0 ? sim.dir : -sim.dir) : sim.dir; };

    sim.emit = function (e) { sim.events.push(e); };
    sim.takeEvents = function () { const e = sim.events; sim.events = []; return e; };
    const onEv = function (e) { sim.emit(e); };

    // Whose throw is number k of the round (0..7)?  Sides alternate; inside a side the players take turns.
    sim.slot = function (k) {
      const side = (sim.first + k) % 2, t = team[side], j = Math.floor(k / 2);
      return { side: side, who: t[j % t.length] };
    };
    sim.cur = function () { return sim.nThrown < C.PER_SIDE * 2 ? sim.slot(sim.nThrown) : null; };
    sim.bagsLeft = function (side) { return C.PER_SIDE - sim.bags.filter(function (b) { return b.side === side; }).length; };
    // Who is on the mat right now (the thrower of the bag in the air stays there until the next turn starts).
    sim.activeWho = function () {
      if (sim.phase === "aim") { const c = sim.cur(); return c ? c.who : -1; }
      if (sim.phase === "swing" && sim.pending) return sim.pending.who;
      if (sim.phase === "flight" && sim.bags.length) return sim.bags[sim.bags.length - 1].who;
      return -1;
    };
    sim.human = function () { return sim.me; };
    sim.myTurn = function () { const c = sim.cur(); return sim.phase === "aim" && !!c && c.who === sim.me; };

    // ---- turn flow (the host runs it; the others follow `snap`s)
    sim.start = function () {
      if (sim.phase !== "wait") return;
      sim.newRound(0, 1);
    };
    sim.newRound = function (first, dir) {
      sim.round++; sim.first = first; sim.dir = dir; sim.nThrown = 0; sim.bags = []; sim.roundPts = [0, 0]; sim.summary = null;
      sim.beginTurn();
      sim.emit({ t: "round", round: sim.round, dir: dir, snap: sim.snap() });
    };
    sim.beginTurn = function () {
      sim.phase = "aim"; sim.turnT = 0; sim.flightT = 0; sim.quiet = 0; sim.pending = null;
      const c = sim.cur();
      sim.aim = { x: 0, yaw: 0, pit: 0.8, ch: -1, st: 0 };
      sim.think = null;
      if (c && players[c.who].bot) sim.planBot(c.who);
      sim.emit({ t: "turn", cur: c, snap: sim.snap() });
    };

    // ---- a throw. `p` = { x, yaw, pit, p, st }.  Returns false if it isn't allowed now.
    sim.throw = function (p, who, remote) {
      const c = sim.cur();
      if (sim.phase !== "aim" || !c || (who !== undefined && who !== c.who)) return false;
      const dir = sim.dirOf(c.who);
      const r = release(dir, p);
      sim.pending = { r: r, who: c.who, side: c.side, dir: dir };
      sim.swingT = C.SWING; sim.phase = "swing";
      sim.aim = { x: r.x0, yaw: r.yaw, pit: r.pit, ch: r.p, st: r.st, thrown: true };
      sim.emit({ t: "swing", who: c.who, r: r, remote: !!remote, n: sim.nThrown });
      return true;
    };
    sim.forfeit = function () {
      const c = sim.cur();
      if (!c || sim.phase !== "aim") return;
      const b = newBag(c.side, c.who, sim.bags.length); b.mode = M.VOID;
      sim.bags.push(b); sim.nThrown++;
      sim.emit({ t: "forfeit", who: c.who });
      sim.afterThrow();
    };
    function spawn() {
      const pd = sim.pending; sim.pending = null;
      const b = newBag(pd.side, pd.who, sim.bags.length);
      b.dir = pd.dir;
      launch(b, pd.dir, pd.r, sim.round * 5 + sim.nThrown);
      sim.bags.push(b); sim.nThrown++;
      sim.phase = "flight"; sim.flightT = 0; sim.quiet = 0;
      sim.emit({ t: "release", bag: b, who: pd.who, r: pd.r });
    }
    // The bag has stopped: next throw, or the round is over.
    sim.afterThrow = function () {
      if (sim.nThrown < C.PER_SIDE * 2) { sim.beginTurn(); return; }
      sim.endRound();
    };
    sim.score = function () {
      const pts = [0, 0];
      sim.bags.forEach(function (b) { pts[b.side] += b.mode === M.HOLE || b.mode === M.FALL ? 3 : b.mode === M.BOARD ? 1 : 0; });
      return pts;
    };
    sim.endRound = function () {
      const pts = sim.score();
      sim.roundPts = pts;
      const net = Math.abs(pts[0] - pts[1]), win = pts[0] === pts[1] ? -1 : pts[0] > pts[1] ? 0 : 1;
      if (win >= 0) sim.scores[win] += net;
      sim.summary = { pts: pts, net: net, win: win, round: sim.round };
      sim.phase = "scored"; sim.phaseT = 5.2;
      if (win >= 0) sim.first = win;
      const top = sim.scores[0] >= sim.target || sim.scores[1] >= sim.target;
      if (top) sim.winner = sim.scores[0] >= sim.scores[1] ? 0 : 1;
      sim.emit({ t: "roundEnd", summary: sim.summary, snap: sim.snap() });
    };
    sim.finishScored = function () {
      if (sim.winner >= 0) { sim.phase = "over"; sim.phaseT = 4.5; sim.emit({ t: "matchover", winner: sim.winner, snap: sim.snap() }); return; }
      sim.newRound(sim.first, -sim.dir);
    };
    // A player left: their throws are forfeited; a side with nobody left loses.
    sim.drop = function (i) {
      const p = players[i];
      if (!p || p.left) return;
      p.left = true;
      const alive = [0, 1].map(function (s) { return team[s].some(function (k) { return !players[k].left; }); });
      if (sim.phase !== "over" && (!alive[0] || !alive[1])) {
        sim.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
        sim.phase = "over"; sim.phaseT = 3;
        sim.emit({ t: "matchover", winner: sim.winner, snap: sim.snap(), forfeit: true });
      }
    };

    // ---- the host's state, for everyone else
    const R3 = (v) => Math.round(v * 1000) / 1000;
    sim.snap = function () {
      return {
        r: sim.round, d: sim.dir, f: sim.first, n: sim.nThrown, sc: sim.scores.slice(), rp: sim.roundPts.slice(), w: sim.winner,
        ph: sim.phase === "scored" ? "scored" : sim.phase === "over" ? "over" : sim.phase === "wait" ? "wait" : "aim", sum: sim.summary,
        b: sim.bags.map(function (b) { return [b.mode, R3(b.x), R3(b.y), R3(b.z), R3(b.yaw), b.side, b.who, b.air ? 1 : 0, b.style, R3(b.u)]; })
      };
    };
    sim.applySnap = function (s) {
      if (!s || typeof s !== "object" || !Array.isArray(s.b)) return false;
      const newRound = s.r !== sim.round || s.n < sim.nThrown;
      sim.round = s.r | 0; sim.dir = s.d < 0 ? -1 : 1; sim.first = s.f ? 1 : 0; sim.nThrown = s.n | 0; sim.scores = [s.sc[0] | 0, s.sc[1] | 0]; sim.roundPts = s.rp ? [s.rp[0] | 0, s.rp[1] | 0] : [0, 0];
      sim.winner = typeof s.w === "number" ? s.w : -1; sim.summary = s.sum || null;
      sim.bags = s.b.map(function (a, i) {
        const b = newBag(a[5] | 0, a[6] | 0, i);
        b.dir = sim.dirOf(b.who);
        b.mode = a[0] | 0; b.x = a[1]; b.y = a[2]; b.z = a[3]; b.yaw = a[4]; b.air = !!a[7]; b.style = a[8] | 0; b.u = a[9]; b.touched = true;
        if (b.mode === M.FALL) { b.mode = M.HOLE; b.y = C.BAG_T / 2; }
        return b;
      });
      sim.pending = null; sim.flightT = 0; sim.quiet = 0; sim.turnT = 0;
      if (s.ph === "scored") { sim.phase = "scored"; sim.phaseT = 5.2; }
      else if (s.ph === "over") { sim.phase = "over"; sim.phaseT = 4.5; }
      else if (s.ph === "aim") {
        sim.phase = "aim";
        const c = sim.cur();
        if (c && players[c.who].bot) sim.planBot(c.who);
        sim.aim = { x: 0, yaw: 0, pit: 0.8, ch: -1, st: 0 };
      }
      sim.emit({ t: newRound ? "synced-round" : "synced", snap: s });
      return true;
    };

    // ---- remote pose of the thrower (aim/charge), so every screen sees them wind up
    sim.setAim = function (a) {
      if (sim.phase !== "aim" || !a) return;
      const f = (v, lo, hi, d) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : d);
      sim.aim = { x: f(a.x, -C.X_MAX, C.X_MAX, 0), yaw: f(a.yaw, -C.YAW_MAX, C.YAW_MAX, 0), pit: f(a.pit, C.PIT_MIN, C.PIT_MAX, 0.8), ch: f(a.ch, -1, 1, -1), st: a.st ? 1 : 0 };
    };

    // ---- computer players (the host throws for them)
    sim.planBot = function (who) {
      const rnd = sim.rng, dir = sim.dirOf(who), d = sim.difficulty;
      const hole = rnd() < [0.22, 0.42, 0.62][d];
      const tu = hole ? C.HOLE_U : 0.45 + rnd() * 0.45, tx = hole ? 0 : (rnd() - 0.5) * 0.24;
      const st = rnd() < (hole ? 0.4 : 0.5) ? 1 : 0;
      const x0 = (rnd() - 0.5) * 1.0, pit = 0.70 + rnd() * 0.2;
      const rx = x0 - dir * 0.16, rz = standZ(dir) + dir * 0.30, tz = dir * (C.LANE + tu);
      const yaw0 = Math.atan2(-dir * (tx - rx), dir * (tz - rz));
      // power: scan, keep every power that ends near the target, take the middle one
      const good = [];
      for (let p = 0.2; p <= 1.0001; p += 0.01) {
        const r = probe(dir, { x: x0, yaw: yaw0, pit: pit, p: p, st: st });
        if (r.mode === M.VOID) continue;
        if (Math.abs(r.u - tu) < (hole ? 0.03 : 0.14) && Math.abs(r.x - tx) < 0.18) good.push(p);
      }
      let pw = good.length ? good[Math.floor(good.length / 2)] : 0.5 + rnd() * 0.2;
      const sy = [0.022, 0.012, 0.0065][d], sp = [0.05, 0.026, 0.013][d];
      sim.think = { who: who, t: 0, dur: 1.3 + rnd() * 1.0, p: { x: x0, yaw: yaw0 + gauss(rnd) * sy, pit: pit, p: clamp(pw + gauss(rnd) * sp, 0, 1), st: st } };
    };
    function runBot(dt) {
      const th = sim.think;
      if (!th) return;
      th.t += dt;
      const a = th.p, k = clamp(th.t / (th.dur * 0.7), 0, 1), cw = clamp((th.t - th.dur * 0.75) / (th.dur * 0.25), 0, 1);
      sim.aim = { x: a.x * k, yaw: a.yaw * k, pit: 0.8 + (a.pit - 0.8) * k, ch: cw > 0 ? a.p * cw : -1, st: a.st };
      if (th.t >= th.dur && sim.isHost) { sim.think = null; sim.throw(a, th.who); }
    }

    // ---- the frame
    sim.step = function (dt) {
      sim.t += dt;
      sim.acc += dt;
      let n = 0;
      while (sim.acc >= H && n < 60) {
        sim.acc -= H; n++;
        for (let i = 0; i < sim.bags.length; i++) stepBag(sim.bags[i], sim.bags[i].dir, onEv);
        collide(sim.bags, onEv);
      }
      if (n >= 60) sim.acc = 0;
      switch (sim.phase) {
        case "wait": if (sim.isHost && !sim.introHold) sim.start(); break;
        case "aim": {
          sim.turnT += dt;
          const c = sim.cur();
          if (c && players[c.who].bot) runBot(dt);
          if (sim.isHost && c && (players[c.who].left || sim.turnT > C.TURN_TIME)) sim.forfeit();
          break;
        }
        case "swing": sim.swingT -= dt; if (sim.swingT <= 0) spawn(); break;
        case "flight": {
          sim.flightT += dt;
          const live = sim.bags.some(moving);
          sim.quiet = live ? 0 : sim.quiet + dt;
          if (sim.isHost && (sim.quiet > 0.8 || sim.flightT > 10)) { sim.bags.forEach(function (b) { if (b.mode === M.FALL) { b.mode = M.HOLE; b.y = C.BAG_T / 2; } }); sim.afterThrow(); }
          break;
        }
        case "scored": sim.phaseT -= dt; if (sim.isHost && sim.phaseT <= 0) sim.finishScored(); break;
        case "over": sim.phaseT -= dt; break;
      }
    };
    return sim;
  }

  SB.Cornhole = { C: C, M: M, createSim: createSim, probe: probe, release: release, newBag: newBag, stepBag: stepBag, hAt: hAt, rngOf: rngOf, STY: STY };
  SB.createSim = createSim;
  if (typeof module !== "undefined") module.exports = SB;
})(typeof globalThis !== "undefined" ? globalThis : this);
