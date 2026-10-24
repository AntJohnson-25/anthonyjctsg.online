// Dodge It: the match as pure logic (no three.js, no DOM), so Node can run it too (tools/sim-test.js).
//
// Online model (PLAN.md "Network design"):
//  - every screen runs this sim; each screen OWNS its own player (and the host owns the bots) and streams poses;
//  - a throw is an EVENT (origin, velocity, shared-clock time): every screen flies the same ball in fixed steps
//    from that time, so a late message fast-forwards instead of teleporting;
//  - the VICTIM's screen decides hits and catches (what you see is what counts) and tells the host;
//  - the HOST owns ball pickups, outs, revives, rounds and the score, and tells everyone (`net` queue -> main.js).
// Court: team 0 on +z (faces -z), team 1 on -z (faces +z). Yaw 0 looks along -z.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const CFG = SB.CFG = {
    COURT_W: 12, COURT_L: 24, WALL_X: 11, WALL_Z: 16, CEIL: 11,
    CENTER_GAP: 0.3, BACK_ROOM: 2.6, BENCH_X: 7.6,
    RUN: 5.4, RUN_HOLD: 4.9, ACCEL: 32, AIR_CTRL: 0.4,
    G_P: 18, JUMP_V: 6.2, FLIP_V: 6.6, FLIP_INV: 0.62,
    DODGE_T: 0.36, DODGE_V: 7.4, DODGE_INV: 0.2,
    STAM: 100, FLIP_COST: 40, DODGE_COST: 25, REGEN: 24,
    BALL_R: 0.11, G_B: 9.8, BOUNCE: 0.55, ROLL: 2.2, STEP: 1 / 120,
    THROW_MIN: 16, THROW_MAX: 26, CHARGE_T: 0.7, AIR_BONUS: 1.18, THROW_T: 0.42, THROW_CD: 0.3,
    CATCH_WIN: 0.4, CATCH_CD: 1.0, CATCH_REACH: 0.8, GRAB_R: 0.95,
    BODY_R: 0.32, BODY_H: 1.75,
    HIT_T: 1.6, REVIVE_INV: 1.3, OUT_RETURN: 1.2,
    READY_T: 3, ROUNDOVER_T: 3.5,
    PITCH_MIN: -0.65, PITCH_MAX: 0.8, INTERP: 0.11
  };
  // Player states (also the pose code on the wire).
  const ST = { free: 0, charge: 1, throw: 2, catch: 3, dodge: 4, flip: 5, hit: 6, out: 7 };
  const ST_NAME = Object.keys(ST);
  SB.ST = ST;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  function rng(seed) { let s = seed >>> 0 || 1; return function () { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const fwdX = (yaw) => -Math.sin(yaw), fwdZ = (yaw) => -Math.cos(yaw);
  const rightX = (yaw) => Math.cos(yaw), rightZ = (yaw) => -Math.sin(yaw);
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  // opts: { players: [{ name, team, kind: "local"|"remote"|"bot", body }], host, seed, rounds, difficulty, balls }
  SB.createSim = function (opts) {
    const R = rng(opts.seed || 1);
    const sim = {
      isHost: !!opts.host, clock: 0, phase: "wait", phaseT: 0, round: 0, rounds: opts.rounds || 3,
      score: [0, 0], winner: -1, roundWinner: -1, difficulty: opts.difficulty === undefined ? 1 : opts.difficulty,
      players: [], balls: [], events: [], net: [], claimed: new Map(), predicted: new Map(), outN: 0, me: -1,
      stats: { rejected: 0, claims: 0, predicted: 0, disagree: 0 }
    };
    opts.players.forEach(function (o, i) {
      const p = { id: i, name: o.name || "Player", team: o.team | 0, kind: o.kind, bot: o.kind === "bot", body: o.body,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, ground: true, st: ST.free, stT: 0,
        hold: -1, pend: false, charge: 0, stam: CFG.STAM, inv: 0, catchT: 0, catchCd: 0, throwCd: 0, airJump: false,
        flipN: 0, flipKind: 0, dodgeDir: 0, out: false, outN: 0, left: false, hits: 0, catches: 0,
        fireWas: false, grabT: 0, buf: [], ai: { t: 0, mode: "", tx: 0, tz: 0, target: -1, seen: new Set(), wind: 0 }, hitClaim: null };
      if (o.kind === "local") sim.me = i;
      sim.players.push(p);
    });
    const nBalls = opts.balls || clamp(Math.ceil(sim.players.length / 2) + 1, 3, 7);
    for (let b = 0; b < nBalls; b++) sim.balls.push({ id: b, st: "rest", x: 0, y: CFG.BALL_R, z: 0, vx: 0, vy: 0, vz: 0, live: false, holder: -1, thrower: -1, team: -1, tid: 0, simT: 0, air: false, outT: 0, touchT: -9 });

    // ------------------------------------------------------------------ who controls whom
    // A player this screen moves itself: our own, and the bots while we're the host.
    sim.owns = (p) => p.kind === "local" || (p.bot && sim.isHost);
    sim.human = () => sim.players[sim.me] || null;
    sim.alive = (team) => sim.players.filter((p) => p.team === team && !p.out && !p.left);
    sim.ev = function (e) { sim.events.push(e); };
    sim.send = function (m) { sim.net.push(m); };
    sim.takeEvents = function () { const e = sim.events; sim.events = []; return e; };
    sim.takeNet = function () { const n = sim.net; sim.net = []; return n; };

    // ------------------------------------------------------------------ setting up a round
    function spawnOf(p) {
      const mates = sim.players.filter((q) => q.team === p.team);
      const k = mates.indexOf(p), n = mates.length;
      const x = n > 1 ? lerp(-CFG.COURT_W / 2 + 1.4, CFG.COURT_W / 2 - 1.4, k / (n - 1)) : 0;
      const s = p.team === 0 ? 1 : -1;
      return { x: x * s, z: s * (CFG.COURT_L / 2 - 2.2), yaw: p.team === 0 ? 0 : Math.PI };
    }
    function placeAll() {
      sim.players.forEach(function (p) {
        const s = spawnOf(p);
        p.x = s.x; p.z = s.z; p.y = 0; p.vx = p.vy = p.vz = 0; p.yaw = s.yaw; p.pitch = 0.05; p.ground = true;
        p.st = ST.free; p.stT = 0; p.hold = -1; p.pend = false; p.charge = 0; p.stam = CFG.STAM; p.inv = 0; p.catchT = 0; p.catchCd = 0;
        p.out = !!p.left; p.outN = 0; p.hitClaim = null; p.buf.length = 0; p.ai.seen.clear(); p.ai.mode = ""; p.ai.t = 0;
        if (p.left) { p.st = ST.out; benchSpot(p); }
      });
      const n = sim.balls.length;
      sim.balls.forEach(function (B, k) {
        Object.assign(B, { st: "rest", x: n > 1 ? lerp(-CFG.COURT_W / 2 + 1.2, CFG.COURT_W / 2 - 1.2, k / (n - 1)) : 0, y: CFG.BALL_R, z: 0, vx: 0, vy: 0, vz: 0, live: false, holder: -1, thrower: -1, team: -1, tid: 0, outT: 0, touchT: -9 });
      });
    }
    function benchSpot(p) {
      const s = p.team === 0 ? 1 : -1;
      const k = sim.players.filter((q) => q.team === p.team && q.out && q.outN < p.outN).length;
      p.benchX = s * CFG.BENCH_X; p.benchZ = s * (2 + (k % 8) * 1.1);
      if (p.left) { p.x = p.benchX; p.z = p.benchZ; }
    }
    sim.startRound = function (round) {
      sim.round = round; sim.phase = "ready"; sim.phaseT = CFG.READY_T; sim.roundWinner = -1;
      placeAll();
      sim.ev({ t: "ready", round: round });
    };
    // Host only: start the match / the next round, and tell everyone.
    sim.hostStart = function () {
      if (!sim.isHost) return;
      sim.startRound(sim.round + 1);
      sim.send({ k: "phase", ph: "ready", rd: sim.round, sc: sim.score.slice() });
    };

    // ------------------------------------------------------------------ helpers
    sim.chest = (p) => ({ x: p.x + fwdX(p.yaw) * 0.22, y: p.y + 1.2, z: p.z + fwdZ(p.yaw) * 0.22 });
    sim.handPos = function (p) {
      return { x: p.x + rightX(p.yaw) * 0.32 + fwdX(p.yaw) * 0.3, y: p.y + 1.55, z: p.z + rightZ(p.yaw) * 0.32 + fwdZ(p.yaw) * 0.3 };
    };
    // The over-the-shoulder camera (the throw is aimed through it, so what you see is what you throw at).
    sim.cameraOf = function (p, out) {
      out = out || {};
      const cp = Math.cos(p.pitch), dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
      const px = p.x + rightX(p.yaw) * 0.62, py = p.y + 1.62, pz = p.z + rightZ(p.yaw) * 0.62;
      const dist = 3.3;
      out.x = px - dx * dist; out.y = Math.max(0.35, py - dy * dist); out.z = pz - dz * dist;
      out.dx = dx; out.dy = dy; out.dz = dz;
      return out;
    };
    // Where the crosshair is: the first enemy, floor or wall along the camera ray.
    sim.aimPoint = function (p) {
      const c = sim.cameraOf(p, {});
      let best = 40;
      sim.players.forEach(function (q) {
        if (q.team === p.team || q.out || q.left) return;
        // sphere round the enemy's chest, generous
        const ox = q.x - c.x, oy = q.y + 1.1 - c.y, oz = q.z - c.z;
        const t = ox * c.dx + oy * c.dy + oz * c.dz;
        if (t < 1) return;
        const d2 = ox * ox + oy * oy + oz * oz - t * t;
        if (d2 < 0.55 * 0.55 && t < best) best = t;
      });
      if (c.dy < -0.01) best = Math.min(best, (0 - c.y) / c.dy);
      [[1, 0, CFG.WALL_X], [-1, 0, CFG.WALL_X], [0, 1, CFG.WALL_Z], [0, -1, CFG.WALL_Z]].forEach(function (w) {
        const d = w[0] * c.dx + w[1] * c.dz;
        if (d > 1e-3) best = Math.min(best, (w[2] - (w[0] * c.x + w[1] * c.z)) / d);
      });
      if (c.dy > 1e-3) best = Math.min(best, (CFG.CEIL - c.y) / c.dy);
      best = Math.max(best, 4);
      return { x: c.x + c.dx * best, y: c.y + c.dy * best, z: c.z + c.dz * best };
    };
    // Launch velocity from H through T at speed s (the low arc); straight along the aim if T is out of reach.
    sim.launch = function (H, T, s, fallback) {
      const dx = T.x - H.x, dz = T.z - H.z, dy = T.y - H.y, d = Math.hypot(dx, dz), g = CFG.G_B;
      const disc = s * s * s * s - g * (g * d * d + 2 * dy * s * s);
      if (d < 0.5 || disc < 0) return { vx: fallback.x * s, vy: fallback.y * s, vz: fallback.z * s };
      const th = Math.atan((s * s - Math.sqrt(disc)) / (g * d));
      const h = Math.cos(th) * s;
      return { vx: dx / d * h, vy: Math.sin(th) * s, vz: dz / d * h };
    };
    function onCourt(B) { return Math.abs(B.x) <= CFG.COURT_W / 2 && Math.abs(B.z) <= CFG.COURT_L / 2 + CFG.BACK_ROOM; }
    function canReach(p, B) {
      if (B.st !== "rest" && B.st !== "loose") return false;
      if (B.y > 1.3) return false;
      if (Math.hypot(B.x - p.x, B.z - p.z) > CFG.GRAB_R) return false;
      // a ball on the other team's side is theirs (the centre line counts for both)
      return p.team === 0 ? B.z > -0.45 : B.z < 0.45;
    }

    // ------------------------------------------------------------------ a player's own controls
    // c: { yaw, pitch, mx, mz (local), jump, dodge, fire (held), catchQ, aimAt? (bots) }
    function control(p, c, dt) {
      p.stT += dt;
      p.inv = Math.max(0, p.inv - dt);
      p.catchT = Math.max(0, p.catchT - dt);
      p.catchCd = Math.max(0, p.catchCd - dt);
      p.throwCd = Math.max(0, p.throwCd - dt);
      p.stam = Math.min(CFG.STAM, p.stam + CFG.REGEN * dt * (p.st === ST.flip || p.st === ST.dodge ? 0 : 1));
      const play = sim.phase === "play";
      if (p.out) { benchWalk(p, dt); return; }
      if (p.st === ST.hit) {
        // knocked back, waiting for the host to say "out" (or that the hit didn't count)
        p.vx *= Math.max(0, 1 - dt * 4); p.vz *= Math.max(0, 1 - dt * 4);
        physics(p, dt);
        if (p.hitClaim && sim.clock - p.hitClaim.t > 3) { p.hitClaim = null; p.st = ST.free; }   // never answered: carry on
        return;
      }
      if (c) { p.yaw = c.yaw; p.pitch = clamp(c.pitch, CFG.PITCH_MIN, CFG.PITCH_MAX); }
      const frozen = sim.phase === "ready" || sim.phase === "wait";
      // movement wish, in the world
      let mx = 0, mz = 0;
      if (c && !frozen) {
        if (c.wx !== undefined) { mx = c.wx; mz = c.wz; }
        else { mx = rightX(p.yaw) * c.mx + fwdX(p.yaw) * c.mz; mz = rightZ(p.yaw) * c.mx + fwdZ(p.yaw) * c.mz; }
        const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      }
      // state timers
      if (p.st === ST.throw && p.stT > CFG.THROW_T) setSt(p, ST.free);
      if (p.st === ST.catch && p.catchT <= 0) setSt(p, ST.free);
      if (p.st === ST.dodge && p.stT > CFG.DODGE_T) setSt(p, ST.free);
      if (p.st === ST.flip && p.ground && p.stT > 0.15) setSt(p, ST.free);

      if (c && !frozen) {
        // jump; again in the air = a flip (invulnerable for a moment)
        if (c.jump) {
          if (p.ground && (p.st === ST.free || p.st === ST.charge)) { p.vy = CFG.JUMP_V; p.ground = false; p.airJump = true; sim.ev({ t: "jump", id: p.id }); }
          else if (!p.ground && p.airJump && p.stam >= CFG.FLIP_COST && p.st !== ST.flip && p.st !== ST.dodge) {
            p.airJump = false; p.vy = CFG.FLIP_V; p.stam -= CFG.FLIP_COST; p.inv = CFG.FLIP_INV;
            p.flipKind = (p.flipN++) % 2; setSt(p, ST.flip);
            if (p.st !== ST.charge) p.charge = 0;
            sim.ev({ t: "flip", id: p.id, kind: p.flipKind });
          }
        }
        // a dodge: a quick step whichever way you're pushing (back if nothing), a moment untouchable
        if (c.dodge && p.ground && p.stam >= CFG.DODGE_COST && (p.st === ST.free || p.st === ST.charge)) {
          let dx = mx, dz = mz;
          if (Math.hypot(dx, dz) < 0.2) { dx = -fwdX(p.yaw); dz = -fwdZ(p.yaw); }
          const l = Math.hypot(dx, dz); dx /= l; dz /= l;
          p.vx = dx * CFG.DODGE_V; p.vz = dz * CFG.DODGE_V; p.stam -= CFG.DODGE_COST; p.inv = CFG.DODGE_INV;
          const f = dx * fwdX(p.yaw) + dz * fwdZ(p.yaw), r = dx * rightX(p.yaw) + dz * rightZ(p.yaw);
          p.dodgeDir = Math.abs(f) >= Math.abs(r) ? (f >= 0 ? 0 : 1) : (r >= 0 ? 3 : 2);   // 0 f, 1 b, 2 l, 3 r
          p.charge = 0; setSt(p, ST.dodge);
          sim.ev({ t: "dodge", id: p.id, dir: p.dodgeDir });
        }
        // catch (empty hands) or block (holding a ball)
        if (c.catchQ && p.catchCd <= 0 && (p.st === ST.free || p.st === ST.flip || p.st === ST.charge)) {
          p.catchT = CFG.CATCH_WIN; p.catchCd = CFG.CATCH_CD; p.charge = 0;
          if (p.st !== ST.flip) setSt(p, ST.catch);
          sim.ev({ t: "catchTry", id: p.id, block: p.hold >= 0 });
        }
        // throw: hold to wind up, let go to throw (only once the host has given us the ball)
        if (p.hold >= 0 && play) {
          if (c.fire && (p.st === ST.free || p.st === ST.charge || p.st === ST.flip) && p.throwCd <= 0) {
            if (p.st === ST.free) setSt(p, ST.charge);
            p.charge = Math.min(1, p.charge + dt / CFG.CHARGE_T);
          } else if (!c.fire && p.fireWas && (p.st === ST.charge || (p.st === ST.flip && p.charge > 0))) {
            if (!p.pend) throwBall(p, c);
            else p.throwQ = sim.clock;             // let go before the host answered: throw the moment it does
          }
        }
        if (p.throwQ && !p.pend && p.hold >= 0) { p.throwQ = 0; throwBall(p, c); }
        if (p.throwQ && sim.clock - p.throwQ > 0.6) { p.throwQ = 0; if (p.st === ST.charge) setSt(p, ST.free); p.charge = 0; }
        p.fireWas = !!(c && c.fire);
      }
      // run
      const speed = p.st === ST.dodge ? 0 : (p.hold >= 0 ? CFG.RUN_HOLD : CFG.RUN) * (p.st === ST.charge ? 0.7 : p.st === ST.catch ? 0.45 : 1);
      if (p.st !== ST.dodge) {
        const k = Math.min(1, CFG.ACCEL * dt / Math.max(speed, 1) * (p.ground ? 1 : CFG.AIR_CTRL));
        p.vx += (mx * speed - p.vx) * k; p.vz += (mz * speed - p.vz) * k;
      }
      physics(p, dt);
      // pick up a ball by walking over it
      if (p.hold < 0 && play && p.st !== ST.hit && sim.clock - p.grabT > 0.35) {
        for (const B of sim.balls) if (canReach(p, B)) { grab(p, B); break; }
      }
    }
    function setSt(p, s) { p.st = s; p.stT = 0; }
    function physics(p, dt) {
      if (!p.ground || p.vy > 0) { p.vy -= CFG.G_P * dt; p.y += p.vy * dt; }
      if (p.y <= 0) { if (!p.ground) { sim.ev({ t: "land", id: p.id }); } p.y = 0; p.vy = 0; p.ground = true; p.airJump = false; }
      else p.ground = false;
      p.x += p.vx * dt; p.z += p.vz * dt;
      confine(p);
    }
    function confine(p) {
      const hw = CFG.COURT_W / 2 - 0.3;
      p.x = clamp(p.x, -hw, hw);
      const back = CFG.COURT_L / 2 + CFG.BACK_ROOM;
      if (p.team === 0) p.z = clamp(p.z, CFG.CENTER_GAP, back); else p.z = clamp(p.z, -back, -CFG.CENTER_GAP);
    }
    // Out: walk to the bench along your sideline and wait to be caught back in.
    function benchWalk(p, dt) {
      if (p.st !== ST.out) { if (p.stT > CFG.HIT_T) setSt(p, ST.out); else { p.vx *= Math.max(0, 1 - dt * 4); p.vz *= Math.max(0, 1 - dt * 4); p.x += p.vx * dt; p.z += p.vz * dt; return; } }
      const dx = p.benchX - p.x, dz = p.benchZ - p.z, d = Math.hypot(dx, dz);
      if (d > 0.15) { const s = Math.min(3.6, d * 4); p.vx = dx / d * s; p.vz = dz / d * s; p.x += p.vx * dt; p.z += p.vz * dt; p.yaw = Math.atan2(-p.vx, -p.vz); }
      else { p.vx = p.vz = 0; p.yaw += angDiff(p.team === 0 ? -Math.PI / 2 : Math.PI / 2, p.yaw) * Math.min(1, dt * 5); }
      p.y = 0; p.ground = true;
    }

    // ------------------------------------------------------------------ balls
    function grab(p, B) {
      p.grabT = sim.clock;
      if (sim.isHost) { giveBall(B, p); sim.send(ballMsg(B, "own")); return; }
      // ask the host; hold it at once (it shows in your hands) but don't throw until the host agrees
      giveBall(B, p); p.pend = true;
      sim.send({ k: "grab", i: p.id, b: B.id });
    }
    function giveBall(B, p) {
      if (B.holder >= 0 && B.holder !== p.id) { const o = sim.players[B.holder]; if (o.hold === B.id) { o.hold = -1; o.pend = false; } }
      if (p.hold >= 0 && p.hold !== B.id) return;     // already holding another ball
      B.st = "held"; B.holder = p.id; B.live = false; B.vx = B.vy = B.vz = 0; B.touchT = sim.clock;
      p.hold = B.id; p.pend = false;
      sim.ev({ t: "pickup", id: p.id, b: B.id });
    }
    function dropBall(p) {
      if (p.hold < 0) return;
      const B = sim.balls[p.hold];
      p.hold = -1; p.pend = false; p.charge = 0;
      if (B.holder === p.id) { Object.assign(B, { st: "loose", holder: -1, live: false, x: p.x, y: 1.0, z: p.z, vx: 0, vy: 0.5, vz: 0, simT: sim.clock, touchT: sim.clock }); }
    }
    function throwBall(p, c) {
      const B = sim.balls[p.hold];
      if (!B || B.holder !== p.id) { p.hold = -1; return; }
      const air = !p.ground;
      const s = lerp(CFG.THROW_MIN, CFG.THROW_MAX, p.charge) * (air ? CFG.AIR_BONUS : 1);
      const H = sim.handPos(p);
      const T = c.aimAt || sim.aimPoint(p);
      const cp = Math.cos(p.pitch);
      const v = sim.launch(H, T, s, { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp });
      const tid = (Math.floor(R() * 2147483646) + 1) ^ (sim.clock * 1000 | 0) || 1;
      fly(B, { x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, t0: sim.clock, thrower: p.id, tid: tid, air: air });
      p.hold = -1; p.charge = 0; p.throwCd = CFG.THROW_CD;
      if (p.st !== ST.flip) setSt(p, ST.throw);
      sim.send({ k: "th", i: p.id, b: B.id, tid: tid, x: H.x, y: H.y, z: H.z, vx: v.vx, vy: v.vy, vz: v.vz, t0: sim.clock, air: air ? 1 : 0 });
      sim.ev({ t: "throw", id: p.id, b: B.id, speed: s, air: air });
    }
    function fly(B, m) {
      const th = sim.players[m.thrower];
      if (B.holder >= 0 && B.holder !== m.thrower) { const o = sim.players[B.holder]; if (o.hold === B.id) { o.hold = -1; o.pend = false; } }
      if (th && th.hold === B.id) th.hold = -1;
      Object.assign(B, { st: "fly", live: !sim.claimed.has(m.tid), holder: -1, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz,
        simT: m.t0, thrower: m.thrower, team: th ? th.team : -1, tid: m.tid, air: !!m.air, touchT: sim.clock });
    }
    // A throw from another screen (its t0 already on our clock).
    sim.fireRemote = function (m) {
      const B = sim.balls[m.b], th = sim.players[m.i];
      if (!B || !th) return;
      fly(B, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, t0: Math.min(m.t0, sim.clock), thrower: m.i, tid: m.tid, air: m.air });
      if (th.st !== ST.flip) { th.st = ST.throw; th.stT = 0; }
      sim.ev({ t: "throw", id: th.id, b: B.id, remote: true, air: !!m.air });
    };
    function ballStep(B, h) {
      const r = CFG.BALL_R;
      B.vy -= CFG.G_B * h;
      B.x += B.vx * h; B.y += B.vy * h; B.z += B.vz * h;
      let bounced = false;
      if (B.y < r) {
        B.y = r;
        if (B.vy < 0) {
          bounced = Math.abs(B.vy) > 1.2;
          B.vy = -B.vy * CFG.BOUNCE; B.vx *= 0.82; B.vz *= 0.82;
          if (B.vy < 0.7) B.vy = 0;
          if (B.live) { B.live = false; sim.ev({ t: "floor", b: B.id, x: B.x, z: B.z }); }
        }
      }
      if (B.y <= r + 1e-6 && B.vy === 0) {
        const sp = Math.hypot(B.vx, B.vz), dec = CFG.ROLL * h;
        if (sp <= dec) { B.vx = 0; B.vz = 0; B.st = "rest"; }
        else { B.vx *= (sp - dec) / sp; B.vz *= (sp - dec) / sp; }
      }
      const wx = CFG.WALL_X - r, wz = CFG.WALL_Z - r;
      if (B.x > wx || B.x < -wx) { B.x = clamp(B.x, -wx, wx); B.vx = -B.vx * 0.6; B.live = false; bounced = true; }
      if (B.z > wz || B.z < -wz) { B.z = clamp(B.z, -wz, wz); B.vz = -B.vz * 0.6; B.live = false; bounced = true; }
      if (B.y > CFG.CEIL - r) { B.y = CFG.CEIL - r; B.vy = -Math.abs(B.vy) * 0.5; B.live = false; }
      if (bounced) sim.ev({ t: "bounce", b: B.id, v: Math.hypot(B.vx, B.vy, B.vz) });
      if (B.st === "fly" && !B.live) B.st = "loose";
    }
    // Did this live ball reach a player this screen speaks for?
    function touch(B) {
      if (!B.live) return false;
      for (const p of sim.players) {
        if (!sim.owns(p) || p.out || p.left || p.team === B.team || p.st === ST.hit) continue;
        const C = sim.chest(p);
        const toP = { x: C.x - B.x, y: C.y - B.y, z: C.z - B.z };
        const sp = Math.hypot(B.vx, B.vy, B.vz) || 1;
        const coming = (toP.x * B.vx + toP.y * B.vy + toP.z * B.vz) / sp;
        // catch / block: hands up, ball within reach, coming at you from the front
        if (p.catchT > 0 && Math.hypot(toP.x, toP.y, toP.z) < CFG.CATCH_REACH && coming > -0.15) {
          const facing = -(fwdX(p.yaw) * B.vx + fwdZ(p.yaw) * B.vz) / (Math.hypot(B.vx, B.vz) || 1);
          if (facing > (B.air ? 0.55 : 0.1)) {
            if (p.hold >= 0) block(p, B); else catchBall(p, B);
            return true;
          }
        }
        if (p.inv > 0) continue;
        // body: a capsule from the shins to the top of the head
        const y0 = p.y + 0.15, y1 = p.y + CFG.BODY_H - 0.2;
        const cy = clamp(B.y, y0, y1);
        const d = Math.hypot(B.x - p.x, B.y - cy, B.z - p.z);
        if (d < CFG.BODY_R + CFG.BALL_R) { hitBy(p, B); return true; }
      }
      return false;
    }
    function hitBy(p, B) {
      // on our screen it's a hit: knocked back now; the host makes it official (first word on a throw wins)
      const tid = B.tid, by = B.thrower;
      sim.stats.claims++;
      Object.assign(B, { st: "loose", live: false, vx: -B.vx * 0.22 + (R() - 0.5), vy: 2.6, vz: -B.vz * 0.22 + (R() - 0.5), touchT: sim.clock });
      const kb = Math.hypot(B.vx, B.vz) || 1;
      p.vx = -B.vx / kb * 1.5; p.vz = -B.vz / kb * 1.5;
      setSt(p, ST.hit); p.charge = 0;
      p.hitClaim = { t: sim.clock, tid: tid, b: B.id, by: by };
      dropBall(p);
      sim.ev({ t: "hit", id: p.id, by: by, b: B.id });
      const m = { k: "hit", i: p.id, b: B.id, tid: tid, by: by, ...ballFields(B) };
      if (sim.isHost) hostClaim(m); else sim.send(m);
    }
    function catchBall(p, B) {
      const tid = B.tid, by = B.thrower;
      sim.stats.claims++;
      giveBall(B, p);
      setSt(p, ST.catch); p.catchT = 0.3;
      sim.ev({ t: "caught", id: p.id, by: by, b: B.id });
      const m = { k: "catch", i: p.id, b: B.id, tid: tid, by: by };
      if (sim.isHost) hostClaim(m); else { p.pend = true; sim.send(m); }
    }
    function block(p, B) {
      const tid = B.tid;
      Object.assign(B, { st: "loose", live: false, vx: -B.vx * 0.3, vy: 3, vz: -B.vz * 0.3, touchT: sim.clock });
      sim.ev({ t: "block", id: p.id, b: B.id });
      const m = { k: "blk", i: p.id, b: B.id, tid: tid, ...ballFields(B) };
      if (sim.isHost) hostClaim(m); else sim.send(m);
    }
    // A live ball going clean through another screen's player: on our screen it bounces off them as their screen
    // will most likely say (only their screen decides; if it never does, that's a "disagreement" in the stats).
    function ghostTouch(B) {
      for (const p of sim.players) {
        if (sim.owns(p) || p.out || p.left || p.team === B.team || p.st === ST.hit || p.st === ST.flip || p.st === ST.dodge || p.catchT > 0) continue;
        // (we see them ~0.2 s late: only someone nearly standing still is where we see them)
        if (Math.hypot(p.vx, p.vz) > 1.2 || !p.ground) continue;
        const cy = clamp(B.y, p.y + 0.25, p.y + CFG.BODY_H - 0.3);
        if (Math.hypot(B.x - p.x, B.y - cy, B.z - p.z) < CFG.BODY_R * 0.8 + CFG.BALL_R) {
          sim.predicted.set(B.tid, { t: sim.clock, i: p.id });
          sim.stats.predicted++;
          Object.assign(B, { st: "loose", live: false, vx: -B.vx * 0.22, vy: 2.6, vz: -B.vz * 0.22, touchT: sim.clock });
          return true;
        }
      }
      return false;
    }
    function stepBalls() {
      for (const B of sim.balls) {
        if (B.st !== "fly" && B.st !== "loose") { B.simT = sim.clock; continue; }
        let n = 0;
        while (B.simT + CFG.STEP <= sim.clock && n < 2400) {
          B.simT += CFG.STEP; n++;
          ballStep(B, CFG.STEP);
          if (B.live && (touch(B) || ghostTouch(B))) { B.simT = sim.clock; break; }
          if (B.st === "rest") { B.simT = sim.clock; break; }
        }
      }
      // predicted hits that no "out" ever confirmed
      sim.predicted.forEach(function (v, tid) {
        if (sim.clock - v.t > 1.5) { sim.predicted.delete(tid); if (!sim.claimed.has(tid)) { sim.stats.disagree++; sim.ev({ t: "disagree", id: v.i }); } }
      });
    }

    // ------------------------------------------------------------------ the host's word
    const ballFields = (B) => ({ st: B.st, x: B.x, y: B.y, z: B.z, vx: B.vx, vy: B.vy, vz: B.vz, h: B.holder, t: sim.clock });
    function ballMsg(B, why) { return Object.assign({ k: "b", b: B.id, why: why }, ballFields(B)); }
    // A ball's state from the host (t on our clock): put it there and fast-forward to now.
    sim.applyBall = function (m) {
      const B = sim.balls[m.b];
      if (!B) return;
      if (m.tid) { sim.claimed.set(m.tid, sim.clock); sim.predicted.delete(m.tid); }
      const was = B.holder;
      if (was >= 0 && was !== m.h) { const o = sim.players[was]; if (o.hold === B.id) { o.hold = -1; o.pend = false; if (o.st === ST.charge) { o.st = ST.free; o.charge = 0; } } }
      Object.assign(B, { st: m.st, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, holder: m.h, live: false, simT: Math.min(m.t, sim.clock), touchT: sim.clock });
      if (m.h >= 0) { const p = sim.players[m.h]; if (p) { if (p.hold >= 0 && p.hold !== B.id) { /* two in hand: keep the newest */ } p.hold = B.id; p.pend = false; } }
    };
    // Host: a player's screen says a ball hit / was caught by / was blocked by its player. First word on a throw wins.
    function hostClaim(m) {
      const p = sim.players[m.i];
      if (!p) return;
      const done = sim.claimed.has(m.tid) || sim.phase !== "play" || p.out;
      if (done) {
        sim.stats.rejected++;
        sim.send({ k: "rej", i: m.i, tid: m.tid });
        rejected(m.i, m.tid);
        sim.send(ballMsg(sim.balls[m.b], "fix"));
        return;
      }
      sim.claimed.set(m.tid, sim.clock);
      const B = sim.balls[m.b];
      if (m.k === "hit") {
        Object.assign(B, { st: m.st, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, holder: -1, live: false, simT: Math.min(m.t, sim.clock) });
        eliminate(m.i, m.by, "hit", -1, B, m.tid);
      } else if (m.k === "catch") {
        const th = sim.players[m.by];
        giveBall(B, p);
        p.catches++;
        if (th && !th.out) eliminate(th.id, p.id, "caught", revive(p.team), B, m.tid); else sim.send(ballMsg(B, "own"));
      } else if (m.k === "blk") {
        Object.assign(B, { st: m.st, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, holder: -1, live: false, simT: Math.min(m.t, sim.clock) });
        sim.send(Object.assign(ballMsg(B, "blk"), { tid: m.tid }));
      }
    }
    sim.hostClaim = function (m) { if (sim.isHost) hostClaim(m); };
    function rejected(i, tid) {
      const p = sim.players[i];
      if (p && p.hitClaim && p.hitClaim.tid === tid) { p.hitClaim = null; p.st = ST.free; p.stT = 0; }
      if (p && p.pend && !sim.isHost) p.pend = false;
    }
    sim.applyRej = function (m) { sim.stats.rejected += m.i === sim.me ? 1 : 0; rejected(m.i, m.tid); };
    function revive(team) {
      const back = sim.players.filter((q) => q.team === team && q.out && !q.left).sort((a, b) => a.outN - b.outN)[0];
      return back ? back.id : -1;
    }
    // Host: player i is out (B = the ball that did it, as it is now).
    function eliminate(i, by, kind, rev, B, tid) {
      const p = sim.players[i];
      const drop = [];
      // the out player's ball drops where they stand
      if (p.hold >= 0) { const hb = sim.balls[p.hold]; dropBall(p); drop.push(Object.assign({ b: hb.id }, ballFields(hb))); }
      applyOutLocal(i, by, kind, rev);
      sim.send({ k: "out", i: i, by: by, kind: kind, rev: rev, n: p.outN, tid: tid, drop: drop, ball: Object.assign({ b: B.id }, ballFields(B)) });
      checkRoundEnd();
    }
    function applyOutLocal(i, by, kind, rev, n) {
      const p = sim.players[i];
      if (!p.out) {
        p.out = true; p.outN = n || ++sim.outN; if (n) sim.outN = Math.max(sim.outN, n);
        if (p.st !== ST.hit) { p.st = ST.hit; p.stT = 0; }
        p.hitClaim = null;
        dropBall(p);
        benchSpot(p);
        const t = sim.players[by]; if (t && kind === "hit") t.hits++;
      }
      if (rev >= 0) {
        const q = sim.players[rev];
        if (q.out) {
          q.out = false; q.outN = 0; q.st = ST.free; q.stT = 0; q.inv = CFG.REVIVE_INV;
          const s = spawnOf(q); q.x = s.x; q.z = s.z; q.yaw = s.yaw; q.y = 0; q.vx = q.vz = 0; q.buf.length = 0;
        }
      }
      sim.ev({ t: "out", id: i, by: by, kind: kind, rev: rev });
    }
    // A non-host screen hears who is out.
    sim.applyOut = function (m) {
      if (m.tid) { sim.claimed.set(m.tid, sim.clock); sim.predicted.delete(m.tid); }
      applyOutLocal(m.i, m.by, m.kind, m.rev, m.n);
      (m.drop || []).forEach((d) => sim.applyBall(d));
      if (m.ball) sim.applyBall(m.ball);
      if (m.kind === "caught") { const c = sim.players[m.by]; if (c) c.catches++; }
    };
    function checkRoundEnd() {
      if (!sim.isHost || sim.phase !== "play") return;
      const a = sim.alive(0).length, b = sim.alive(1).length;
      if (a && b) return;
      const w = a ? 0 : b ? 1 : -1;
      endRound(w);
      sim.send({ k: "phase", ph: "roundover", rd: sim.round, w: w, sc: sim.score.slice(), mw: sim.winner });
    }
    function endRound(w) {
      sim.phase = "roundover"; sim.phaseT = CFG.ROUNDOVER_T; sim.roundWinner = w;
      if (w >= 0) sim.score[w]++;
      const need = Math.floor(sim.rounds / 2) + 1;
      if (sim.score[0] >= need || sim.score[1] >= need) sim.winner = sim.score[0] > sim.score[1] ? 0 : 1;
      sim.ev({ t: "roundover", w: w, score: sim.score.slice(), matchWinner: sim.winner });
    }
    // Phase changes from the host.
    sim.applyPhase = function (m) {
      if (m.ph === "ready") { if (m.sc) sim.score = m.sc.slice(); if (m.rd !== sim.round || sim.phase !== "ready") sim.startRound(m.rd); }
      else if (m.ph === "play") { if (sim.phase !== "play") { sim.phase = "play"; sim.phaseT = 0; sim.ev({ t: "go" }); } }
      else if (m.ph === "roundover") {
        if (sim.phase === "roundover" || sim.phase === "matchover") return;
        sim.phase = "roundover"; sim.phaseT = CFG.ROUNDOVER_T; sim.roundWinner = m.w; sim.score = m.sc.slice(); sim.winner = m.mw;
        sim.ev({ t: "roundover", w: m.w, score: sim.score.slice(), matchWinner: sim.winner });
      } else if (m.ph === "matchover") {
        if (sim.phase === "matchover") return;
        sim.phase = "matchover"; sim.winner = m.mw; sim.score = m.sc.slice();
        sim.ev({ t: "matchover", winner: sim.winner });
      }
    };
    // Host: a grab request.
    sim.hostGrab = function (m) {
      if (!sim.isHost) return;
      const p = sim.players[m.i], B = sim.balls[m.b];
      if (!p || !B) return;
      // (lenient on distance: on the host's screen the player is shown a little in the past)
      const free = B.st === "rest" || B.st === "loose";
      const near = Math.hypot(B.x - p.x, B.z - p.z) < 3.5;
      if (free && near && !p.out && p.hold < 0 && sim.phase === "play") giveBall(B, p);
      sim.send(ballMsg(B, "own"));
    };
    // Someone left the lobby: out of the game for good (their ball drops; the host checks the round).
    sim.drop = function (i) {
      const p = sim.players[i];
      if (!p || p.left) return;
      p.left = true;
      dropBall(p);
      if (!p.out) { p.out = true; p.outN = ++sim.outN; benchSpot(p); p.st = ST.out; }
      sim.ev({ t: "left", id: i });
      if (sim.isHost) { sim.balls.forEach((B) => { if (B.holder === i) { B.holder = -1; B.st = "loose"; } }); checkRoundEnd(); }
    };
    // A player whose claim the old host never answered: ask the new one.
    sim.resendClaims = function () {
      sim.players.forEach(function (p) {
        if (!sim.owns(p) || !p.hitClaim) return;
        const B = sim.balls[p.hitClaim.b];
        const m = { k: "hit", i: p.id, b: p.hitClaim.b, tid: p.hitClaim.tid, by: p.hitClaim.by, ...ballFields(B) };
        if (sim.isHost) hostClaim(m); else sim.send(m);
      });
    };

    // ------------------------------------------------------------------ snapshots (late screens, and a safety net)
    sim.snap = function () {
      return { ph: sim.phase, pt: sim.phaseT, rd: sim.round, sc: sim.score.slice(), w: sim.winner, rw: sim.roundWinner, on: sim.outN,
        pl: sim.players.map((p) => [p.out ? 1 : 0, p.outN, p.hits, p.catches, p.left ? 1 : 0]),
        bl: sim.balls.map((B) => [B.st, B.holder, r3(B.x), r3(B.y), r3(B.z), r3(B.vx), r3(B.vy), r3(B.vz)]), t: sim.clock };
    };
    const r3 = (v) => Math.round(v * 1000) / 1000;
    sim.applySnap = function (s) {
      if (!s || !s.pl) return;
      if (s.rd !== sim.round || (s.ph !== sim.phase && !(s.ph === "play" && sim.phase === "ready"))) {
        if (s.rd !== sim.round && (s.ph === "ready" || s.ph === "play")) sim.startRound(s.rd);
        sim.phase = s.ph; sim.phaseT = s.pt;
      }
      if (s.ph === "play" && sim.phase === "ready") { sim.phase = "play"; sim.ev({ t: "go" }); }
      sim.score = s.sc.slice(); sim.winner = s.w; sim.roundWinner = s.rw; sim.outN = Math.max(sim.outN, s.on || 0);
      s.pl.forEach(function (a, i) {
        const p = sim.players[i];
        if (!p) return;
        p.hits = a[2]; p.catches = a[3];
        if (a[4] && !p.left) sim.drop(i);
        if (a[0] && !p.out && !p.hitClaim) { p.out = true; p.outN = a[1]; p.st = ST.out; benchSpot(p); dropBall(p); }
        else if (!a[0] && p.out && !p.left) { p.out = false; p.outN = 0; p.st = ST.free; const sp = spawnOf(p); p.x = sp.x; p.z = sp.z; }
      });
      s.bl.forEach(function (a, b) {
        const B = sim.balls[b];
        if (!B) return;
        // (a ball that moved here in the last moments knows better than a snapshot that may be older)
        if (sim.clock - B.touchT < 1.5 || B.st === "fly") return;
        if (B.st === a[0] && B.holder === a[1] && Math.hypot(B.x - a[2], B.z - a[4]) < 0.3) return;
        sim.applyBall({ b: b, st: a[0], h: a[1], x: a[2], y: a[3], z: a[4], vx: a[5], vy: a[6], vz: a[7], t: s.t });
      });
    };

    // ------------------------------------------------------------------ other screens' players
    // pose: [i, x, y, z, yaw, pitch, st, stT, hold, charge, flipKind/dodgeDir, vx, vz, catchT>0] with t on our clock
    sim.poseOf = function (p) {
      return [p.id, r3(p.x), r3(p.y), r3(p.z), r3(p.yaw), r3(p.pitch), p.st, r3(p.stT), p.hold, Math.round(p.charge * 100),
        p.st === ST.dodge ? p.dodgeDir : p.flipKind, r3(p.vx), r3(p.vz), p.catchT > 0 ? 1 : 0, p.ground ? 1 : 0];
    };
    sim.setRemote = function (a, t) {
      const p = sim.players[a[0]];
      if (!p || sim.owns(p)) return;
      const buf = p.buf;
      if (buf.length && t <= buf[buf.length - 1].t) t = buf[buf.length - 1].t + 0.001;
      buf.push({ t: t, a: a });
      if (buf.length > 30) buf.shift();
    };
    // Show other screens' players a little in the past, between two poses we have (smooth whatever the jitter).
    function remote(p, dt) {
      p.stT += dt;
      const buf = p.buf;
      if (!buf.length) return;
      const rt = sim.clock - CFG.INTERP;
      while (buf.length > 2 && buf[1].t <= rt) buf.shift();
      let A = buf[0], B = buf[1] || buf[0], u = 0;
      if (B !== A) u = clamp((rt - A.t) / Math.max(1e-3, B.t - A.t), 0, 1.25);
      if (rt < A.t) u = 0;
      const a = A.a, b = B.a;
      const px = p.x, pz = p.z;
      p.x = lerp(a[1], b[1], u); p.y = Math.max(0, lerp(a[2], b[2], u)); p.z = lerp(a[3], b[3], u);
      p.yaw = a[4] + angDiff(b[4], a[4]) * u; p.pitch = lerp(a[5], b[5], u);
      const cur = u < 0.5 ? a : b;
      if (!p.out && cur[6] !== ST.out) {
        if (p.st !== cur[6]) { p.st = cur[6]; p.stT = cur[7]; }
      }
      // remote's ball in hand follows them (the host's word on who holds what still decides)
      p.charge = cur[9] / 100;
      if (cur[6] === ST.dodge) p.dodgeDir = cur[10]; else p.flipKind = cur[10];
      p.catchT = cur[13] ? 0.1 : 0;
      p.ground = !!cur[14] || p.y < 0.02;
      if (dt > 0) { p.vx = lerp(p.vx, (p.x - px) / dt, 0.3); p.vz = lerp(p.vz, (p.z - pz) / dt, 0.3); }
      if (p.out && p.st !== ST.hit) p.st = ST.out;
    }

    // ------------------------------------------------------------------ bots (run on the host)
    sim.botControl = function (p, dt) {
      const ai = p.ai, D = sim.difficulty;
      ai.t -= dt;
      const enemies = sim.players.filter((q) => q.team !== p.team && !q.out && !q.left);
      const c = { yaw: p.yaw, pitch: 0.05, mx: 0, mz: 0, wx: 0, wz: 0, jump: false, dodge: false, fire: false, catchQ: false };
      if (sim.phase !== "play") { c.yaw = p.team === 0 ? 0 : Math.PI; return c; }
      // defence: a live ball coming our way
      for (const B of sim.balls) {
        if (!B.live || B.team === p.team || ai.seen.has(B.tid)) continue;
        const dx = p.x - B.x, dz = p.z - B.z, vh = Math.hypot(B.vx, B.vz) || 1;
        const tca = (dx * B.vx + dz * B.vz) / (vh * vh);
        if (tca < 0 || tca > 0.5) continue;
        const mx = B.x + B.vx * tca - p.x, mz = B.z + B.vz * tca - p.z;
        if (Math.hypot(mx, mz) > 0.9) continue;
        ai.seen.add(B.tid);
        const roll = R(), react = [0.45, 0.65, 0.82][D];
        if (roll > react) break;                                      // too slow
        const pick = R();
        // face the ball to catch it
        const faceYaw = Math.atan2(B.vx, B.vz);
        if (pick < [0.15, 0.3, 0.42][D] && tca > 0.12) { c.catchQ = true; c.yaw = faceYaw; p.yaw = faceYaw; }
        else if (pick < 0.75) { c.dodge = true; const s = R() < 0.5 ? 1 : -1; c.wx = -B.vz / vh * s; c.wz = B.vx / vh * s; }
        else { c.jump = true; ai.flipSoon = 0.12; }
        break;
      }
      if (ai.flipSoon !== undefined) { ai.flipSoon -= dt; if (ai.flipSoon <= 0 && !p.ground) { c.jump = true; ai.flipSoon = undefined; } }
      if (c.catchQ || c.dodge) return c;
      const s = p.team === 0 ? 1 : -1;
      if (p.hold >= 0) {
        // armed: pick a target, wind up, throw
        if (ai.target < 0 || !enemies.includes(sim.players[ai.target])) { ai.target = enemies.length ? enemies[Math.floor(R() * enemies.length)].id : -1; ai.wind = lerp([1.3, 0.9, 0.55][D], [2.2, 1.5, 1.0][D], R()); ai.chargeTo = 0.3 + R() * 0.7; }
        const T = sim.players[ai.target];
        if (!T) return c;
        const dist = Math.hypot(T.x - p.x, T.z - p.z);
        // step up toward the line a little while winding up
        const wantZ = s * clamp(Math.abs(p.z) - 1, 2.2, CFG.COURT_L / 2);
        c.wx = clamp(T.x * 0.2 - p.x * 0.2, -0.5, 0.5); c.wz = clamp(wantZ - p.z, -1, 1) * 0.6;
        const flight = dist / lerp(CFG.THROW_MIN, CFG.THROW_MAX, ai.chargeTo);
        const lead = [0.3, 0.7, 0.95][D];
        const err = [1.1, 0.65, 0.35][D];
        const ax = T.x + T.vx * flight * lead + (R() - 0.5) * err, az = T.z + T.vz * flight * lead + (R() - 0.5) * err;
        c.yaw = Math.atan2(-(ax - p.x), -(az - p.z));
        ai.wind -= dt;
        if (ai.wind < CFG.CHARGE_T * ai.chargeTo + 0.05 && ai.wind > 0) c.fire = true;
        else if (ai.wind <= 0) { c.fire = false; c.aimAt = { x: ax, y: T.y + 0.9 + (R() - 0.5) * err * 0.6, z: az }; ai.target = -1; }
        if (c.fire && R() < 0.004 * (D + 1) && p.ground && p.stam > 60) { c.jump = true; ai.flipSoon = 0.15; }
        return c;
      }
      // unarmed: go for the nearest free ball on our side, else keep moving at the back
      let best = null, bd = 1e9;
      for (const B of sim.balls) {
        if (B.st !== "rest" && B.st !== "loose") continue;
        if (s > 0 ? B.z < -0.4 : B.z > 0.4) continue;
        if (Math.abs(B.x) > CFG.COURT_W / 2) continue;
        const taken = sim.players.some((q) => q !== p && q.bot && q.team === p.team && q.ai.ball === B.id && q.hold < 0);
        const d = Math.hypot(B.x - p.x, B.z - p.z) + (taken ? 6 : 0);
        if (d < bd) { bd = d; best = B; }
      }
      p.ai.ball = best ? best.id : -1;
      let tx, tz;
      if (best && bd < 14) { tx = best.x; tz = best.z; }
      else {
        if (ai.t <= 0 || ai.mode !== "roam") { ai.mode = "roam"; ai.t = 0.8 + R() * 1.6; ai.tx = (R() - 0.5) * (CFG.COURT_W - 2); ai.tz = s * (CFG.COURT_L / 2 - 1 - R() * 5); }
        tx = ai.tx; tz = ai.tz;
      }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.2) { c.wx = dx / d; c.wz = dz / d; }
      // look at the other team (the middle of it)
      const ex = enemies.length ? enemies.reduce((a, q) => a + q.x, 0) / enemies.length : 0, ez = enemies.length ? enemies.reduce((a, q) => a + q.z, 0) / enemies.length : -s * 8;
      c.yaw = p.yaw + angDiff(Math.atan2(-(ex - p.x), -(ez - p.z)), p.yaw) * Math.min(1, dt * 6);
      return c;
    };

    // ------------------------------------------------------------------ the frame
    // input: the local player's controls (null = none). clock: the shared clock in seconds (omit to count dt).
    sim.step = function (dt, input, clock) {
      sim.clock = clock === undefined ? sim.clock + dt : Math.max(sim.clock, clock);
      // phases (timers run everywhere; only the host moves to the next phase)
      if (sim.phase === "ready") {
        sim.phaseT -= dt;
        if (sim.phaseT <= 0 && sim.isHost) { sim.phase = "play"; sim.ev({ t: "go" }); sim.send({ k: "phase", ph: "play", rd: sim.round }); }
      } else if (sim.phase === "roundover") {
        sim.phaseT -= dt;
        if (sim.phaseT <= 0 && sim.isHost) {
          if (sim.winner >= 0) { sim.phase = "matchover"; sim.ev({ t: "matchover", winner: sim.winner }); sim.send({ k: "phase", ph: "matchover", mw: sim.winner, sc: sim.score.slice() }); }
          else sim.hostStart();
        }
      }
      for (const p of sim.players) {
        if (p.left) { if (p.out) benchWalk(p, dt); continue; }
        if (sim.owns(p)) {
          let c = null;
          if (p.kind === "local") c = input;
          else c = sim.botControl(p, dt);
          control(p, c, dt);
        } else remote(p, dt);
      }
      stepBalls();
      if (sim.isHost) {
        // balls that stop outside the court come back in after a moment
        for (const B of sim.balls) {
          if (B.st === "rest" && !onCourt(B)) {
            B.outT += dt;
            if (B.outT > CFG.OUT_RETURN) {
              B.outT = 0;
              B.x = clamp(B.x, -CFG.COURT_W / 2 + 0.5, CFG.COURT_W / 2 - 0.5);
              B.z = clamp(B.z, -CFG.COURT_L / 2 - CFG.BACK_ROOM + 0.5, CFG.COURT_L / 2 + CFG.BACK_ROOM - 0.5);
              if (Math.abs(B.z) < 0.5) B.z = B.z < 0 ? -0.5 : 0.5;
              B.touchT = sim.clock;
              sim.send(ballMsg(B, "return"));
            }
          } else B.outT = 0;
        }
        // forget old throws
        if ((sim.gcT = (sim.gcT || 0) + dt) > 5) { sim.gcT = 0; sim.claimed.forEach((t, k) => { if (sim.clock - t > 20) sim.claimed.delete(k); }); }
        checkRoundEnd();
      }
    };

    sim.ST_NAME = ST_NAME;
    sim.stName = (p) => ST_NAME[p.st];
    sim.placeAll = placeAll;
    placeAll();
    return sim;
  };

  // The teams, the same on every screen: humans (sorted ids) alternate between the two sides, then bots fill each
  // side up to `size` (bots on), or only even up the sides (bots off; alone = one bot to play against).
  SB.buildTeams = function (humanIds, size, bots) {
    const ids = humanIds.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, 10);
    const out = ids.map((id, k) => ({ hid: id, team: k % 2, bot: false }));
    const n = [0, 1].map((t) => out.filter((o) => o.team === t).length);
    const want = bots ? Math.max(size, n[0], n[1]) : Math.max(n[0], n[1], 1);
    for (let t = 0; t < 2; t++) for (let k = n[t]; k < want; k++) out.push({ hid: null, team: t, bot: true });
    return out;
  };
})(globalThis.SB);
