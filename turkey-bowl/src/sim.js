// Turkey Bowl 3D — simulation. Entities, steering AI, collision, downs, state machine.
// Knows nothing about three.js, canvas or the DOM.
//
// Forked from the 2D game's sim.js. Gameplay is deliberately unchanged; the
// fork only (a) drops the 2D camera, (b) publishes an event feed (gs.events)
// for sound and effects, (c) keeps the velocity each player had at the whistle
// so a tackle can fall the way it was going, and (d) huddles in a ring.
(function () {
  const G = typeof window !== "undefined" ? window : globalThis;
  const D = G.TBData || (typeof require !== "undefined" ? require("./data.js") : null);
  const W = G.TBWorld || (typeof require !== "undefined" ? require("./util.js") : null);

  // The renderer drains this every frame; anything else (tools/check.js) must
  // drain it too. Capped so a consumer that never drains cannot leak.
  function emit(gs, type, data) {
    const ev = data || {};
    ev.type = type;
    if (!gs.events) gs.events = [];
    gs.events.push(ev);
    if (gs.events.length > 64) gs.events.shift();
  }

  const PHASE = {
    HUDDLE: "HUDDLE",
    HUDDLE_BREAK: "HUDDLE_BREAK",
    PRE_SNAP: "PRE_SNAP",
    LIVE: "LIVE",
    DEAD_BALL: "DEAD_BALL",
    BETWEEN_DOWNS: "BETWEEN_DOWNS",
    TOUCHDOWN: "TOUCHDOWN",
    SAFETY: "SAFETY",
    TURNOVER: "TURNOVER",
    QUARTER_BREAK: "QUARTER_BREAK",
    HALFTIME: "HALFTIME",
    GAME_OVER: "GAME_OVER"
  };

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function newGame(humanTeam) {
    const gs = {
      phase: PHASE.PRE_SNAP,
      phaseT: 0,
      clock: D.QUARTER_SECONDS,
      quarter: 1,
      quarterExpired: false,
      score: [0, 0],
      humanTeam: humanTeam === undefined ? 0 : humanTeam,
      startedWith: 0,
      offense: 0,
      ballOn: D.TOUCHBACK_SPOT,
      down: 1,
      toGo: 10,
      firstDownMark: D.TOUCHBACK_SPOT + 10,
      los: D.TOUCHBACK_SPOT,
      entities: [],
      carrier: null,
      ball: { x: 0, y: 0, z: 0, inFlight: false },
      pendingTurnover: false,
      spot: D.TOUCHBACK_SPOT,
      message: "",
      events: [],
      playClockT: 0,
      cpuThrew: false,
      // Index into D.PLAYBOOK — the human's, or the CPU's pick. Opens on FLOOD,
      // a pass: opening on DIVE handed the ball off at the snap, so a new
      // player's first press of 1/2 did nothing at all.
      playCall: 3,
      defCall: 0,         // index into D.DEFENSES — the CPU's pick, or the human's on defense
      callPending: false, // the human still has to make this down's call (in the huddle)
      callT: 0,           // seconds on the play-call clock (D.PLAY_CALL_SECONDS)
      suggest: [],        // this down's SUGGESTED calls for the human's side, best first
      pitchBackT: 0,      // flea-flicker: seconds until the ball returns to the QB
      brokenTackles: 0,
      clockRunning: false, // the clock keeps running between plays (D.CLOCK_RUNOFF_MAX)
      runoff: 0,           // seconds run off since the last whistle
      humanFlip: false,    // the human's call is flipped (mirrored) this down
      looseControlId: null, // human offense's nearest available fumble chaser
      controlSlot: null   // the defensive slot ("D0".."D6") the human is driving
                           // when the CPU has the ball; null = full defensive AI
    };
    toPreSnap(gs);
    return gs;
  }

  function humanHasBall(gs) {
    return gs.offense === gs.humanTeam;
  }

  // A person is playing (team 0 or 1), not CPU vs CPU (tools/check.js, ?demo).
  function humanPlaying(gs) {
    return gs.humanTeam === 0 || gs.humanTeam === 1;
  }

  // The linebacker's sideways offset toward the tight end (D.LB_SHADE). The
  // strong side moves on a flipped CPU call, so this is decided per down.
  function lbShade(gs, f) {
    if (f.ai !== "LB") return 0;
    const te = D.FORMATION.offense.find(function (o) { return o.slot === "TE"; });
    return Math.sign(te.dx * (gs.cpuFlip ? -1 : 1) * (gs.humanFlip ? -1 : 1)) * D.LB_SHADE;
  }

  // A flipped human call mirrors the whole formation, so the corners swap
  // which receiver they line up over.
  function coverFor(gs, f) {
    if (!f.covers || !gs.humanFlip) return f.covers || null;
    return f.covers === "WR1" ? "WR2" : f.covers === "WR2" ? "WR1" : f.covers;
  }

  // Entities are destroyed and respawned from the formation table at every snap,
  // so no player position is ever transformed between possessions.
  function setupFormation(gs) {
    const team = D.TEAMS[gs.offense];
    const defTeam = D.TEAMS[1 - gs.offense];
    const ents = [];
    let id = 0;

    D.FORMATION.offense.forEach(function (f) {
      // A flipped CPU call also moves the tight end to the left, so the strong
      // side (two receivers) is not always the right.
      // A flipped human call mirrors everyone (sim.js flipPlay).
      const dx = (gs.cpuFlip && f.slot === "TE" ? -f.dx : f.dx) * (gs.humanFlip ? -1 : 1);
      ents.push({
        id: id++,
        side: "off",
        role: f.role,
        char: f.char,
        slot: f.slot,
        team: gs.offense,
        color: team.primary,
        accent: team.accent,
        pants: team.pants,
        number: team.numbers[f.slot],
        x: D.FIELD_MID + dx,
        y: gs.ballOn + f.dy,
        px: D.FIELD_MID + dx,
        py: gs.ballOn + f.dy,
        vx: 0,
        vy: 0,
        speed: D.SPEED[f.role],
        speedCap: 1,
        scrambleDownT: 0,
        route: null,
        wp: 0,
        engagedWith: null,
        engageT: 0,
        commitT: 0,
        action: "stance_" + f.role,
        frameT: 0,
        lockT: 0,
        facing: "away",   // the offense lines up looking downfield, away from us
        mirror: false
      });
    });

    D.DEFENSES[gs.defCall].units.forEach(function (f, i) {
      const dx = f.dx + lbShade(gs, f);
      ents.push({
        id: id++,
        side: "def",
        role: "def",
        char: f.char,
        slot: "D" + i,
        ai: f.ai,
        covers: coverFor(gs, f),
        tackleCd: 0,
        downT: 0,
        scrambleDownT: 0,
        homeX: D.FIELD_MID + dx,   // where they lined up, for the rush count
        team: 1 - gs.offense,
        color: defTeam.primary,
        accent: defTeam.accent,
        pants: defTeam.pants,
        number: defTeam.numbers[D.CHAR_SLOT[f.char]],
        x: D.FIELD_MID + dx,
        y: gs.ballOn + f.dy,
        px: D.FIELD_MID + dx,
        py: gs.ballOn + f.dy,
        vx: 0,
        vy: 0,
        speed: rand(D.DEF_SPEED_MIN, D.DEF_SPEED_MAX),
        speedCap: 1,
        reactT: 0,
        claimed: false,
        engagedWith: null,
        action: "stance_" + (f.ai === "PURSUE" ? "rush" : f.ai === "COVER" ? "cover" : f.ai === "LB" ? "lb" : "contain"),
        frameT: 0,
        lockT: 0,
        facing: "toward",   // the defense lines up facing the offense, i.e. us
        mirror: false
      });
    });

    gs.entities = ents;
    gs.carrier = ents.find(function (e) { return e.slot === "QB"; });
    gs.los = gs.ballOn;
    gs.ball.x = gs.carrier.x;
    gs.ball.y = gs.carrier.y;
    gs.ball.z = 0;
    gs.ball.inFlight = false;
    gs.pendingTurnover = false;
    gs.cpuThrew = false;
    gs.passThrown = false;
    gs.switchWr = null;
    gs.loose = null;
    gs.looseControlId = null;
    gs.jukeT = 0;
    gs.jukeCd = 0;
    gs.spinT = 0;
    gs.spinCd = 0;
    gs.pitchBackT = 0;
    gs.drawT = 0;
    gs.hurdleT = 0;
    gs.hurdleCd = 0;
    gs.flipT = 0;
    gs.hurdleAt = -1;
    gs.ball.thrower = null;
    gs.ball.target = null;
    gs.ball.kind = "normal";
    gs.ball.highPoint = false;
    gs.ball.defPlay = null;
    gs.interceptor = null;
    gs.recoveredBy = null;
    gs.whistleCarrier = null;
    gs.scoredBy = null;
    applyPlay(gs);
  }

  // ---- play calling --------------------------------------------------------

  function currentPlay(gs) {
    return D.PLAYBOOK[W.clamp(gs.playCall, 0, D.PLAYBOOK.length - 1)];
  }

  // Assignments only — never positions. Alignment is identical for all nine
  // calls, so this can be re-run any number of times during PRE_SNAP as the
  // player flips through the playbook, and the defense gets no pre-snap tell.
  function applyPlay(gs) {
    const play = currentPlay(gs);

    gs.entities.forEach(function (e) {
      if (e.side !== "off") return;
      e.assignment = null;
      e.route = null;
      e.wp = 0;

      // A flipped CPU call trades the two receivers' routes (see toPreSnap).
      const wrKey = gs.cpuFlip && e.role === "wr" ? (e.slot === "WR1" ? "WR2" : "WR1") : e.slot;
      const name = e.role === "wr" ? (play.wr && play.wr[wrKey])
        : e.role === "te" ? play.te
        : e.role === "rb" ? play.rb
          : null;
      if (!name) return;

      if (name === "block") { e.assignment = "block"; return; }
      e.assignment = "route";
      e.routeName = name;
      // Routes are authored for a left-side receiver; mirror for the right so
      // an in-breaking route breaks in on both sides.
      const flip = e.x > D.FIELD_MID ? -1 : 1;
      e.route = D.ROUTES[name].map(function (p) {
        return { x: W.clamp(e.x + p.dx * flip, 1.5, D.FIELD_W - 1.5), y: e.y + p.dy, stop: !!p.stop };
      });
    });
  }

  // The CPU's defensive call. Down and distance only — it never peeks at the
  // offense's pick, which is what keeps a single "best play" from existing.
  function pickDefense(gs) {
    const long = gs.toGo >= 7;
    const short = gs.toGo <= 3;
    const lateDown = gs.down >= 3;
    const r = Math.random();

    if (lateDown && long) return r < 0.45 ? 2 : (r < 0.8 ? 1 : 0);   // deep, else blitz
    if (short) return r < 0.5 ? 1 : 0;                                // sell out to stop it
    if (long) return r < 0.35 ? 2 : (r < 0.6 ? 1 : 0);
    return r < 0.2 ? 1 : (r < 0.35 ? 2 : 0);
  }

  // SUGGESTED calls for the human's call screen, best first. Offense: the three
  // calls the CPU itself makes most often in this down and distance. Defense:
  // a short situational list that can include the human-only looks.
  function suggestPlays(gs) {
    const n = new Array(D.PLAYBOOK.length).fill(0);
    for (let i = 0; i < 400; i++) n[pickCpuPlay(gs)]++;
    return n.map(function (c, i) { return { i: i, c: c }; })
      .sort(function (a, b) { return b.c - a.c || a.i - b.i; })
      .slice(0, 3).map(function (o) { return o.i; });
  }
  function suggestDefenses(gs) {
    const long = gs.toGo >= 7;
    const short = gs.toGo <= 3;
    const lateDown = gs.down >= 3;
    const ids = lateDown && long ? ["deep", "prevent", "blitz"]
      : short ? ["zero", "blitz", "press"]
      : long ? ["deep", "base", "blitz"]
      : ["base", "press", "blitz"];
    return ids.map(function (id) { return D.DEFENSES.findIndex(function (d) { return d.id === id; }); })
      .filter(function (i) { return i >= 0; });
  }

  // The CPU's offensive call, by the same logic a person uses: run when it is
  // short, throw when it is long, and take a shot occasionally so it is not
  // predictable.
  // Weights by playbook id. TE SEAM only on long yardage: CPU-driven it is 53%
  // incomplete (the QB gets one late look), which is a wasted down on 2nd-and-5.
  // MESH, HB DRAW, QB SNEAK and HAIL MARY joined on 2026-10-24.
  const CPU_CALLS = {
    short: { dive: 0.42, sweep: 0.18, sneak: 0.12, slants: 0.16, tescreen: 0.12 },
    long: { flood: 0.24, postwheel: 0.2, slants: 0.12, teseam: 0.12, ycorner: 0.1, flea: 0.07, draw: 0.08, mesh: 0.07 },
    mid: { dive: 0.15, sweep: 0.11, draw: 0.06, slants: 0.2, flood: 0.2, mesh: 0.08, ycorner: 0.08, tescreen: 0.08, postwheel: 0.025, flea: 0.025 }
  };
  function pickCpuPlay(gs) {
    // Last snap of the half from deep: throw it up.
    if ((gs.quarter === 2 || gs.quarter === 4) && gs.clock < 7 && gs.ballOn < 70 && gs.ballOn > 30) {
      const hm = D.PLAYBOOK.findIndex(function (p) { return p.id === "hailmary"; });
      if (hm >= 0) return hm;
    }
    const table = gs.toGo <= 2 ? CPU_CALLS.short : gs.toGo >= 8 ? CPU_CALLS.long : CPU_CALLS.mid;
    const ids = Object.keys(table);
    let sum = 0;
    ids.forEach(function (id) { sum += table[id]; });
    let r = Math.random() * sum;
    for (let i = 0; i < ids.length; i++) {
      r -= table[ids[i]];
      if (r <= 0) return D.PLAYBOOK.findIndex(function (p) { return p.id === ids[i]; });
    }
    return 3;
  }

  function snap(gs) {
    if (gs.phase !== PHASE.PRE_SNAP) return;
    gs.phase = PHASE.LIVE;
    gs.phaseT = 0;
    gs.message = "";
    gs.entities.forEach(function (e) {
      if (e.side === "def") e.reactT = rand(D.REACT_MIN, D.REACT_MAX);
    });

    const play = currentPlay(gs);
    gs.clockRunning = false;   // the live clock takes over
    gs.runoff = 0;
    emit(gs, "snap", { los: gs.los });
    // A draw: the QB sells the pass first and hands off on a timer.
    gs.drawT = play.handoff && play.handoffAfter ? play.handoffAfter : 0;
    if (play.handoff && !play.handoffAfter) {
      const to = gs.entities.find(function (e) { return e.slot === play.handoff; });
      if (to) {
        const qb = gs.entities.find(function (e) { return e.slot === "QB"; });
        gs.carrier = to;
        if (qb) lockPose(qb, "handoff", D.ACTION_HOLD.handoff);
        emit(gs, "handoff", { from: qb, to: to });
      }
    }
    // Flea-flicker: the pitch back is on a timer from the snap, not from where
    // the runner gets to, so the QB knows when to expect it.
    gs.pitchBackT = play.pitchBackAfter || 0;
    gs.cpuRead = pickRead(gs);
  }

  // The CPU QB's first read: any receiver whose route ends more than 4 yards
  // downfield, at random, so the same play does not go to the same man.
  function pickRead(gs) {
    const reads = gs.entities.filter(function (e) {
      return e.side === "off" && e.route && (e.slot === "WR1" || e.slot === "WR2" || e.slot === "TE") &&
        e.route[e.route.length - 1].y - gs.los > 4;
    });
    return reads.length ? reads[Math.floor(Math.random() * reads.length)].slot : null;
  }

  function steerToward(e, tx, ty, spd, dt) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : 0;
    const uy = len > 1e-6 ? dy / len : 0;
    applyDesired(e, ux * spd, uy * spd, dt);
  }

  function applyDesired(e, dvx, dvy, dt) {
    const a = 1 - Math.exp(-dt / D.TAU_ACCEL);
    e.vx += (dvx - e.vx) * a;
    e.vy += (dvy - e.vy) * a;
  }

  // Hold a pose for a while, immune to the locomotion state below. Without
  // this, integrate() overwrites `action` on the very next frame and a caught
  // ball or a touchdown celebration is never actually seen.
  // A short-lived banner message that clears itself.
  function flash(gs, msg) {
    gs.message = msg;
    gs.flashMsg = msg;
    gs.flashT = 1.1;
  }

  function lockPose(e, action, secs) {
    e.action = action;
    e.frameT = 0;
    e.lockT = secs;
  }

  function integrate(e, dt) {
    e.px = e.x;
    e.py = e.y;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.x = W.clamp(e.x, -3, D.FIELD_W + 3);
    e.y = W.clamp(e.y, -12, 112);
    e.frameT += dt;
    if (e.stumbleT > 0) e.stumbleT -= dt;
    if (e.downT > 0) e.downT -= dt;
    if (e.scrambleDownT > 0) e.scrambleDownT -= dt;

    if (e.lockT > 0) {
      e.lockT -= dt;
      return;
    }

    // Which way a player is facing decides which sheet render.js reaches for —
    // rear, side or front — so it has to be derived from velocity rather than
    // reduced to a horizontal mirror flag. Running sideways used to be drawn
    // with mirrored rear-view art, which is what read most obviously as a
    // sprite game rather than as people on a lawn.
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > 0.6) {
      e.action = "run";
      const backpedalingQb = e.role === "qb" && e.side === "off" && e.vy < -0.3;
      e.facing = backpedalingQb ? "away" : (Math.abs(e.vx) > Math.abs(e.vy) ? "side" : (e.vy > 0 ? "away" : "toward"));
      e.mirror = e.vx < 0;
    } else {
      e.action = "idle";
      e.facing = e.side === "def" ? "toward" : "away";
      e.mirror = false;
    }
  }

  // ---- offense -------------------------------------------------------------

  function driveHumanCarrier(gs, input, dt) {
    const c = gs.carrier;
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }

    gs.jukeCd = Math.max(0, gs.jukeCd - dt);
    gs.jukeT = Math.max(0, gs.jukeT - dt);
    gs.spinCd = Math.max(0, gs.spinCd - dt);
    gs.spinT = Math.max(0, gs.spinT - dt);
    if (input.juke && gs.jukeCd <= 0 && (ix || iy)) {
      gs.jukeT = D.JUKE_DURATION;
      gs.jukeCd = D.JUKE_COOLDOWN;
      const side = Math.abs(ix) > 0.15 ? Math.sign(ix) : (c.jukeDir || 1) * -1;
      c.jukeDir = side;
      c.vx += side * D.JUKE_BURST;
      emit(gs, "juke", { who: c, side: side });
    }
    if (input.spin && gs.spinCd <= 0 && (ix || iy)) {
      gs.spinT = D.SPIN_DURATION;
      gs.spinCd = D.SPIN_COOLDOWN;
      const side = Math.abs(ix) > 0.15 ? Math.sign(ix) : (c.spinDir || 1) * -1;
      c.spinDir = side;
      c.vx += side * D.SPIN_BURST;
      emit(gs, "spin", { who: c, side: side });
    }
    // Hurdle; a second tap while still going up turns it into the front
    // corkscrew flip. Not for a QB still in the pocket (that tap is a snap).
    const H = D.HURDLE;
    gs.hurdleCd = Math.max(0, gs.hurdleCd - dt);
    if (input.hurdle && !(c.role === "qb" && c.y < gs.los + 0.5)) {
      if (gs.hurdleT > 0 && gs.flipT <= 0 && H.DURATION - gs.hurdleT <= H.DOUBLE_TAP) {
        gs.flipT = H.FLIP_DURATION;
        gs.hurdleT = 0;
        gs.hurdleCd = H.COOLDOWN + 0.6;
        emit(gs, "corkscrew", { who: c });
      } else if (gs.hurdleT <= 0 && gs.flipT <= 0 && gs.hurdleCd <= 0) {
        gs.hurdleT = H.DURATION;
        gs.hurdleCd = H.COOLDOWN;
        emit(gs, "hurdle", { who: c });
      }
    }
    if (gs.flipT > 0) {
      gs.flipT -= dt;
      if (gs.flipT <= 0) {   // stick the landing, mostly
        c.stumbleT = H.FLIP_STUMBLE;
        lockPose(c, "stumble", H.FLIP_STUMBLE);
      }
    }
    if (gs.hurdleT > 0) gs.hurdleT -= dt;
    let spd = gs.spinT > 0 ? D.SPIN_SPEED : (gs.jukeT > 0 ? D.JUKE_SPEED : c.speed);
    if (gs.flipT > 0) spd = c.speed * H.FLIP_SPEED;
    else if (gs.hurdleT > 0) spd = c.speed * H.SPEED;
    if (c.stumbleT > 0) spd *= D.TACKLE.STUMBLE_SPEED;   // the price of breaking one
    applyDesired(c, ix * spd, iy * spd, dt);
  }

  // Off the ground mid-hurdle or mid-flip: how much harder a lone tackle is.
  function airBonus(gs) {
    const H = D.HURDLE;
    if (gs.flipT > 0) {
      const u = H.FLIP_DURATION - gs.flipT;
      return u > H.AIR_FROM && u < H.FLIP_AIR_TO ? H.FLIP_BREAK : 0;
    }
    if (gs.hurdleT > 0) {
      const u = H.DURATION - gs.hurdleT;
      return u > H.AIR_FROM && u < H.AIR_TO ? H.BREAK : 0;
    }
    return 0;
  }

  function driveHumanLooseRunner(e, input, dt) {
    let ix = input.x || 0;
    let iy = input.y || 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    applyDesired(e, ix * e.speed, iy * e.speed, dt);
  }

  // The CPU quarterback on a pass call: set up in the pocket and give the
  // routes time to develop. He used to run the greedy-gap logic below from the
  // snap and cross the line in ~0.7s, so the throw decision (which needs him
  // behind the line) only ever came late or desperate. Returns false once he
  // should give up and scramble: the pass is gone, he's past the line, the
  // pocket has collapsed, or he has held it well past the rush count.
  function dropBack(gs, c, defs, dt) {
    const play = currentPlay(gs);
    if (c.role !== "qb" || gs.passThrown || c.y >= gs.los + 0.5) return false;
    // A run call's QB only has the ball again after a flea-flicker pitch back
    // (or for the drop that sells a draw); a sneak is his own run.
    if (play.qbRun) return false;
    if (play.handoff && !play.pitchBackAfter && !(play.handoffAfter && gs.drawT > 0)) return false;
    // A screen wants a slow backpedal that draws the rush, not a set pocket:
    // measured, the full drop halved the screen's gain (3.4yd -> 1.0yd).
    if (play.quick) {
      if (gs.phaseT >= 1.6) return false;
      applyDesired(c, 0, -c.speed * 0.35, dt);
      return true;
    }
    const count = D.DEFENSES[gs.defCall].rushCount;
    const hold = (count === undefined ? D.RUSH_COUNT : count) + D.QB_POCKET.HOLD_PAST_COUNT;
    const near = defs[0];
    if (gs.phaseT > hold || (near && near.r < D.QB_POCKET.PANIC_RADIUS)) {
      // Scramble: roll out to the open side, then turn upfield. Handing him
      // straight to the greedy-gap runner stalled him behind two engaged
      // rushers — their repulsion cancels his forward pull — and the play
      // never ended while the receivers ran on for sixty yards.
      if (c.scrambleDir === undefined) {
        const left = gs.entities.filter(function (e) { return e.side === "def" && e.x < c.x && e.y < gs.los + 8; }).length;
        const right = gs.entities.filter(function (e) { return e.side === "def" && e.x >= c.x && e.y < gs.los + 8; }).length;
        c.scrambleDir = left < right ? -1 : 1;
      }
      const edge = c.scrambleDir < 0 ? c.x : D.FIELD_W - c.x;
      const out = edge > 10 ? 0.8 : 0.2;
      applyDesired(c, c.scrambleDir * c.speed * out, c.speed * (edge > 10 ? 0.6 : 1), dt);
      return true;
    }
    c.scrambleDir = undefined;

    // Never drop into the end zone: backed up, the pocket is shallower.
    const depth = W.clamp(gs.los - 1.5, 1, D.QB_POCKET.DEPTH);
    const dy = (gs.los - depth) - c.y;
    let vy = W.clamp(dy * 3, -1, 1) * c.speed * 0.75;
    let vx = 0;
    // Slide away from the closest pressure instead of standing in its path.
    if (near && near.r < D.QB_POCKET.SLIDE_RADIUS) {
      const side = c.x >= near.d.x ? 1 : -1;
      vx = side * c.speed * 0.45 * (1 - near.r / D.QB_POCKET.SLIDE_RADIUS);
    }
    if (c.x < 6) vx = Math.max(vx, 1.5);
    if (c.x > D.FIELD_W - 6) vx = Math.min(vx, -1.5);
    applyDesired(c, vx, vy, dt);
    return true;
  }

  // Greedy gap: run downfield, pushed sideways by the two nearest defenders.
  function driveCpuCarrier(gs, dt) {
    const c = gs.carrier;
    const defs = gs.entities
      .filter(function (e) { return e.side === "def"; })
      .map(function (d) { return { d: d, r: W.dist(c.x, c.y, d.x, d.y) }; })
      .sort(function (a, b) { return a.r - b.r; })
      .slice(0, 2);

    if (dropBack(gs, c, defs, dt)) return;

    let ax = 0;
    let ay = 1;
    defs.forEach(function (o) {
      const r = Math.max(o.r, 0.8);
      const w = 14 / (r * r);
      ax += ((c.x - o.d.x) / r) * w;
      ay += ((c.y - o.d.y) / r) * w * 0.35;
    });
    // A run call tells the CPU which way to take it; a sweep that drifts back
    // to the middle is just a slow dive.
    const play = currentPlay(gs);
    if (play.runBias && gs.phaseT < 1.6) ax += play.runBias * 1.8;

    // Respect the sideline, harder the closer it is. A flat +-1.5 inside 4
    // yards lost to the defender repulsion above, and once the CPU QB could
    // complete passes, receivers caught near the edge ran out of bounds on 39%
    // of all plays.
    const edge = Math.min(c.x, D.FIELD_W - c.x);
    if (edge < 8) {
      const push = 3 * Math.pow(1 - edge / 8, 2) * 4;
      ax += c.x < D.FIELD_MID ? push : -push;
      if (edge < 3) ay = Math.max(ay, 0.6);
    }
    const len = Math.hypot(ax, ay) || 1;
    const spd = c.stumbleT > 0 ? c.speed * D.TACKLE.STUMBLE_SPEED : c.speed;
    applyDesired(c, (ax / len) * spd, (ay / len) * spd, dt);
  }

  function runRoute(e, dt) {
    // A screen's last waypoint is a spot to wait on, not a place to run past.
    if (e.route && e.wp >= e.route.length && e.route[e.route.length - 1].stop) {
      applyDesired(e, 0, 0, dt);
      return;
    }
    if (!e.route || e.wp >= e.route.length) {
      applyDesired(e, e.vx * 0.98, e.speed * 0.9, dt);
      return;
    }
    const t = e.route[e.wp];
    if (W.dist(e.x, e.y, t.x, t.y) < 1.2) {
      e.wp++;
      return;
    }
    steerToward(e, t.x, t.y, e.speed, dt);
  }

  // The point the play is converging on. With a pass in the air there is no
  // carrier, and chasing the ball's current position leaves the defence trailing
  // the catch by a full second — defenders break on where it will land.
  function protectPoint(gs) {
    if (gs.carrier) return gs.carrier;
    if (gs.ball.inFlight) return { x: gs.ball.tx, y: gs.ball.ty, vx: 0, vy: 0, role: "ball" };
    return gs.ball;
  }

  // Blockers interpose between the carrier and the nearest unclaimed defender.
  function driveBlocker(gs, ol, dt) {
    ol.commitT -= dt;
    if (ol.engagedWith) {
      const d = ol.engagedWith;
      ol.engageT -= dt;
      if (ol.engageT <= 0 || W.dist(ol.x, ol.y, d.x, d.y) > 2.5) {
        d.speedCap = 1;
        d.engagedWith = null;
        ol.engagedWith = null;
      } else {
        // Refresh rather than re-lock: the hold keeps the blocking pose up for
        // as long as the shove lasts without restarting its animation.
        ol.action = "block";
        ol.lockT = D.ACTION_HOLD.block;
        d.speedCap = D.BLOCK_SPEED_CAP;
        steerToward(ol, d.x, d.y, ol.speed, dt);
        return;
      }
    }

    if (!ol.target || ol.commitT <= 0) {
      const c = protectPoint(gs);
      let best = null;
      let bestR = Infinity;
      gs.entities.forEach(function (d) {
        if (d.side !== "def" || d.claimed || d.engagedWith) return;
        const r = W.dist(c.x, c.y, d.x, d.y);
        if (r < bestR) { bestR = r; best = d; }
      });
      ol.target = best;
      ol.commitT = D.BLOCK_COMMIT;
    }

    const d = ol.target;
    const c = protectPoint(gs);
    if (!d) {
      steerToward(ol, c.x, c.y + 3, ol.speed, dt);
      return;
    }
    d.claimed = true;
    const dx = c.x - d.x;
    const dy = c.y - d.y;
    const len = Math.hypot(dx, dy) || 1;
    steerToward(ol, d.x + (dx / len) * 1.0, d.y + (dy / len) * 1.0, ol.speed, dt);
    if (W.dist(ol.x, ol.y, d.x, d.y) < D.BLOCK_ENGAGE_DIST) {
      ol.engagedWith = d;
      d.engagedWith = ol;
      ol.engageT = D.BLOCK_HOLD_MIN + Math.random() * D.BLOCK_HOLD_VAR;
      lockPose(ol, "block", D.ACTION_HOLD.block);
    }
  }

  // ---- defense -------------------------------------------------------------

  // The one defender the human has selected (button-over-the-head, see
  // app.js) when the CPU has the ball. Movement only — the tackle check in
  // checkTackle already runs against every defender regardless of who is
  // driving them, so closing distance on the carrier is all this needs to do.
  // `speedCap` still applies, so a block still slows a human-driven defender
  // exactly like an AI one.
  function driveHumanDefender(gs, d, input, dt) {
    if (d.downT > 0) { applyDesired(d, 0, 0, dt); return; }
    // `tackle` is a one-frame key press; the lunge used to last exactly that
    // one frame, so F did nothing visible. Hold the burst for a beat instead.
    if (input.tackle) d.lungeT = 0.35;
    if (d.lungeT > 0) d.lungeT -= dt;
    // With the ball in the air, DIVE near the landing spot plays the ball.
    const b = gs.ball;
    if (input.tackle && b.inFlight && W.dist(d.x, d.y, b.tx, b.ty) < D.CATCH.PLAY_BALL_RADIUS) b.defPlay = d;
    const chase = gs.carrier || (b.inFlight ? { x: b.tx, y: b.ty } : null);
    if (d.lungeT > 0 && chase) {
      const dx = chase.x - d.x;
      const dy = chase.y - d.y;
      const r = Math.hypot(dx, dy) || 1;
      applyDesired(d, dx / r * d.speed * 1.45, dy / r * d.speed * 1.45, dt);
      d.action = "run";
      return;
    }
    let ix = input.x;
    let iy = input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    applyDesired(d, ix * d.speed * d.speedCap, iy * d.speed * d.speedCap, dt);
  }

  // Man coverage: trail the receiver, but never closer to the line than
  // D.COVER_FLOOR. Trailing all the way down let the wheel (out flat along the
  // line, then up the sideline) leave its corner behind: 99% complete
  // (tools/pass-mix.js, 2026-10-03).
  function steerCover(gs, d, wr, dt) {
    steerToward(d, wr.x, Math.max(wr.y - D.COVER_TRAIL, gs.los + D.COVER_FLOOR), d.speed * d.speedCap, dt);
  }

  // The corner and linebacker switch men when the tight end releases outside
  // the receiver on his side (slant-flat, flea-flicker's flat): the corner is
  // already out there, the linebacker is already inside. Chasing their own men
  // across each other left the flat open on 99-100% of throws to it
  // (tools/pass-mix.js, 2026-10-03). Returns the receiver slot the linebacker
  // takes over, or null. Once made, the switch holds for the play.
  function coverSwitch(gs) {
    if (gs.switchWr !== undefined && gs.switchWr !== null) return gs.switchWr;
    const te = gs.entities.find(function (e) { return e.side === "off" && e.slot === "TE"; });
    if (!te || te.assignment !== "route" || !te.route || te.route[te.route.length - 1].stop) return null;
    const side = Math.sign(te.x - D.FIELD_MID);
    const wr = gs.entities.find(function (e) {
      return e.side === "off" && e.role === "wr" && e.assignment === "route" &&
        Math.sign(e.x - D.FIELD_MID) === side;
    });
    if (!wr || Math.abs(te.x - D.FIELD_MID) <= Math.abs(wr.x - D.FIELD_MID)) return null;
    gs.switchWr = wr.slot;
    return gs.switchWr;
  }

  function driveDefender(gs, d, dt) {
    const c = protectPoint(gs);
    // Beaten on a tackle: on the floor and out of the play until they get up.
    if (d.downT > 0) {
      applyDesired(d, 0, 0, dt);
      return;
    }
    if (d.engagedWith) {
      // Shoving with a blocker: lateral scramble only.
      applyDesired(d, (c.x - d.x) * 0.6, 0, dt);
      return;
    }
    d.reactT -= dt;
    if (d.reactT > 0) {
      applyDesired(d, 0, d.ai === "COVER" ? -1.5 : 0, dt);
      return;
    }

    // Cover breaks off the moment the ball crosses the line — otherwise both
    // corners chase receivers for the whole scramble and the runner faces three
    // defenders instead of five.
    const covering = d.ai === "COVER" && !gs.pendingTurnover &&
      (gs.ball.inFlight || (c.role === "qb" && c.y <= gs.los + 1));
    // The linebacker carries the tight end whenever he releases on a route.
    // With only two corners, a spying LB left the TE uncovered on every pass
    // call; it went unnoticed only while the CPU QB could not get a throw off,
    // and cost 17% touchdowns once he could.
    const lbCovering = d.ai === "LB" && !gs.pendingTurnover &&
      (gs.ball.inFlight || (c.role === "qb" && c.y <= gs.los + 1));
    const te = lbCovering ? gs.entities.find(function (e) { return e.slot === "TE"; }) : null;
    // ...except a screen release: slipping out behind the line is exactly the
    // move a linebacker reading the QB doesn't carry, and the play depends on it.
    const teScreen = te && te.route && te.route[te.route.length - 1].stop;
    if (te && te.assignment === "route" && !teScreen && gs.carrier !== te) {
      const sw = coverSwitch(gs);
      steerCover(gs, d, sw ? gs.entities.find(function (e) { return e.slot === sw; }) : te, dt);
      return;
    }
    if (covering) {
      const wr = gs.entities.find(function (e) {
        return e.slot === (d.covers === coverSwitch(gs) ? "TE" : d.covers);
      });
      if (wr) {
        steerCover(gs, d, wr, dt);
        return;
      }
    }

    // The rush count: hold at the line and shadow until the count is up, or
    // until the ball crosses the line of scrimmage. Each defensive look can set
    // its own count — that is the whole of what BLITZ and DEEP trade.
    const count = D.DEFENSES[gs.defCall].rushCount;
    if (d.ai === "PURSUE" && gs.phaseT < (count === undefined ? D.RUSH_COUNT : count) &&
        c.y <= gs.los + 0.5) {
      // Hold the alignment spot, NOT the carrier's x. Mirroring him sideways
      // parked both rushers directly in the path of any run — a handoff walked
      // straight into them and the run game averaged a yard and a half LOST
      // per carry. Counting means standing still, not shadowing.
      steerToward(d, d.homeX, gs.los + 1.5, d.speed * 0.7, dt);
      return;
    }

    let tx;
    let ty;
    if (d.ai === "LB") {
      // The tight end becomes the middle linebacker on defense: spy the
      // quarterback from a few yards off the line, then fill the first run
      // lane or break directly on a thrown ball.
      if (gs.ball.inFlight) {
        tx = c.x;
        ty = c.y;
      } else if (c.y > gs.los + 0.5) {
        tx = c.x;
        ty = c.y;
      } else {
        tx = d.homeX;
        ty = gs.los + 5;
      }
    } else if (d.ai === "CONTAIN") {
      // Free safety: stay deeper than every receiver so nothing gets behind it,
      // break on a ball in the air, and attack only once the play has come to it.
      if (gs.ball.inFlight) {
        tx = c.x;
        ty = c.y;
      } else {
        let deepest = gs.los;
        gs.entities.forEach(function (e) {
          if (e.side === "off" && e.y > deepest) deepest = e.y;
        });
        const floor = Math.max(gs.los + 12, deepest + 2);
        const side = c.x >= D.FIELD_MID ? 1 : -1;
        const lined = Math.abs(c.x - d.x) < D.CONTAIN_CLOSE && c.y > gs.los;
        tx = W.clamp(c.x + (lined ? 0 : side * D.CONTAIN_OUTSIDE), 0, D.FIELD_W);
        ty = lined ? c.y : Math.max(c.y + D.CONTAIN_CUSHION, floor);
        // Two-deep: while the QB is still in the pocket, a safety aligned to
        // one side keeps HIS half, over the deepest receiver there. Keying on
        // the QB's x sent both safeties to the same side of a QB standing on
        // the middle stripe, and WR1 scored 115 of 181 CPU touchdowns down the
        // empty left half once the QB could stand in and throw.
        const half = Math.sign(d.homeX - D.FIELD_MID);
        if (half !== 0 && c.role === "qb" && c.y <= gs.los + 0.5) {
          let deepX = d.homeX;
          let deepY = -Infinity;
          gs.entities.forEach(function (e) {
            if (e.side === "off" && e.role !== "qb" && Math.sign(e.x - D.FIELD_MID) === half && e.y > deepY) {
              deepY = e.y;
              deepX = e.x;
            }
          });
          tx = W.clamp((deepX + d.homeX) / 2, 0, D.FIELD_W);
          ty = floor;
        }
      }
    } else {
      const r = W.dist(d.x, d.y, c.x, c.y);
      const lead = Math.min(r / Math.max(d.speed, 0.1), D.LEAD_CAP);
      tx = c.x + (c.vx || 0) * lead;
      ty = c.y + (c.vy || 0) * lead;
    }
    steerToward(d, tx, ty, d.speed * d.speedCap, dt);
  }

  // ---- passing -------------------------------------------------------------

  // The CPU's rule: only its QB throws, which is what tools/balance.js measured.
  function canThrow(gs) {
    return gs.phase === PHASE.LIVE && !gs.ball.inFlight &&
      gs.carrier && gs.carrier.role === "qb" && gs.carrier.y < gs.los + 0.5;
  }

  // The human's rule is looser — sandlot: whoever has it behind the line can
  // throw it, so a halfback pass off DIVE or a throw after a pitch works too.
  // Restricting it to the QB made 1/2 silently dead on half the playbook.
  function canHumanThrow(gs) {
    // One forward pass per play, as in the real game.
    return gs.phase === PHASE.LIVE && !gs.ball.inFlight && !gs.passThrown &&
      !!gs.carrier && gs.carrier.y < gs.los + 0.5;
  }

  // kind: "normal" (the CPU), or the human's "touch" / "bullet" (D.PASS_KIND).
  function throwTo(gs, slot, shoulder, kind) {
    if (!canHumanThrow(gs)) return false;
    const wr = gs.entities.find(function (e) { return e.slot === slot; });
    if (!wr || wr === gs.carrier) return false;
    const qb = gs.carrier;
    const K = D.PASS_KIND[kind] || D.PASS_KIND.normal;
    const r = W.dist(qb.x, qb.y, wr.x, wr.y);
    const T = Math.max(r / K.speed, kind === "bullet" ? 0.18 : 0.25);
    gs.ball.kind = D.PASS_KIND[kind] ? kind : "normal";
    gs.ball.catchR = K.catchR;
    gs.ball.highPoint = false;
    gs.ball.defPlay = null;
    gs.ball.tipChecked = [];
    gs.ball.los = gs.los;
    gs.ball.inFlight = true;
    gs.ball.x0 = qb.x;
    gs.ball.y0 = qb.y;
    const lead = W.clamp(shoulder || 0, -1, 1) * D.PASS_SHOULDER_LEAD;
    gs.ball.tx = W.clamp(wr.x + wr.vx * T + lead, 0, D.FIELD_W);
    gs.ball.ty = wr.y + wr.vy * T;
    gs.ball.t = 0;
    gs.ball.T = T;
    gs.ball.target = wr;
    gs.ball.catchSide = lead || (qb.x - gs.ball.tx);
    gs.ball.spin = 0;
    gs.pitchBackT = 0;   // the ball is gone; there is nothing to pitch back
    gs.passThrown = true;
    lockPose(qb, "throw", D.ACTION_HOLD.throw);
    gs.ball.thrower = qb;
    gs.carrier = null;
    emit(gs, "throw", { from: qb, to: wr, kind: gs.ball.kind });
    return true;
  }

  function pitchToRb(gs) {
    if (!canThrow(gs)) return false;
    const rb = gs.entities.find(function (e) { return e.slot === "RB"; });
    if (!rb || rb === gs.carrier) return false;
    const qb = gs.carrier;
    gs.carrier = rb;
    lockPose(qb, "handoff", D.ACTION_HOLD.handoff);
    emit(gs, "pitch", { from: qb, to: rb });
    return true;
  }

  // A catch's view is about the receiver's direction of travel at the arrival
  // point, not their roster slot.  This lets a seam, curl and crossing route
  // each use the pose that matches what the camera can actually see.
  function ballArrivalAction(prefix, ent) {
    if (ent.facing === "side") return prefix + "_side";
    return prefix + (ent.facing === "toward" ? "_toward" : "_away");
  }

  function stepBall(gs, dt) {
    const b = gs.ball;
    if (!b.inFlight) {
      if (gs.carrier) {
        b.x = gs.carrier.x;
        b.y = gs.carrier.y;
        b.z = 0.9;
      }
      return;
    }
    b.t += dt;
    const u = W.clamp(b.t / b.T, 0, 1);
    b.x = b.x0 + (b.tx - b.x0) * u;
    b.y = b.y0 + (b.ty - b.y0) * u;
    b.z = 4 * D.PASS_ARC_H * u * (1 - u) + 0.9;
    // For the spiral art: `spin` drives which frame of the cycle shows, `tilt`
    // is the nose angle, up out of the hand and down into the receiver.
    b.spin = (b.spin || 0) + dt;
    b.tilt = (0.5 - u) * 0.85;
    const K = D.PASS_KIND[b.kind] || D.PASS_KIND.normal;
    // A bullet goes through the underneath zone low: a defender in the
    // throwing lane gets one chance at it (D.PASS_KIND.bullet.tip).
    if (K.tip && u > 0.18 && u < 0.82) {
      for (let i = 0; i < gs.entities.length; i++) {
        const d = gs.entities[i];
        if (d.side !== "def" || d.downT > 0 || b.tipChecked.indexOf(d.id) >= 0) continue;
        if (W.dist(b.x, b.y, d.x, d.y) > K.tipR) continue;
        b.tipChecked.push(d.id);
        if (Math.random() >= K.tip) continue;
        b.inFlight = false;
        b.z = 0;
        if (Math.random() < K.tipInt) pickOff(gs, d, b);
        else {
          lockPose(d, "swat", D.ACTION_HOLD.catch);
          emit(gs, "incomplete", { x: b.x, y: b.y, by: d, tipped: true });
          endPlay(gs, gs.los, "INCOMPLETE");
        }
        return;
      }
    }
    if (u < 1) return;

    b.inFlight = false;
    b.z = 0;
    const C = D.CATCH;
    const tgt = b.target;
    const reach = (b.catchR || D.CATCH_RADIUS) + (b.highPoint ? C.HIGH_POINT_REACH : 0);
    const rt = tgt ? W.dist(b.x, b.y, tgt.x, tgt.y) : Infinity;

    // Out of bounds is not a catch: the ball came down past a touchline, or the
    // receiver (steered by the human) had stepped out before he got his hands on it.
    if (b.x < 0 || b.x > D.FIELD_W || (tgt && (tgt.x < 0 || tgt.x > D.FIELD_W))) {
      gs.oobCatch = true;
      emit(gs, "incomplete", { x: b.x, y: b.y, oob: true });
      endPlay(gs, gs.los, "INCOMPLETE");
      return;
    }

    // An overthrow: the target never got anywhere near it.
    if (rt > C.DIVE_RADIUS + (b.highPoint ? C.HIGH_POINT_REACH : 0)) {
      emit(gs, "incomplete", { x: b.x, y: b.y, overthrow: true });
      endPlay(gs, gs.los, "INCOMPLETE");
      return;
    }

    let nearest = null;
    let nr = Infinity;
    gs.entities.forEach(function (d) {
      if (d.side !== "def") return;
      const r = W.dist(b.x, b.y, d.x, d.y);
      if (r < nr) { nr = r; nearest = d; }
    });

    // Graded coverage: the closer the nearest defender is to where the ball
    // comes down, the likelier they are to break it up. A defender merely in
    // the area no longer guarantees a dead ball. Going up for it (high point)
    // wins more of these; a human defender who played the ball wins more.
    let contest = nr < D.CONTEST_RADIUS ? (1 - nr / D.CONTEST_RADIUS) * (K.contestMul || 1) : 0;
    if (b.highPoint) contest *= C.HIGH_POINT_CONTEST;
    const played = b.defPlay && b.defPlay === nearest;
    if (played) contest = Math.min(0.95, contest * C.PLAY_BALL_CONTEST);
    if (contest > 0 && Math.random() < contest) {
      const intP = D.INT_CHANCE * (K.intMul || 1) * (played ? C.PLAY_BALL_INT : 1);
      if (Math.random() < intP) {
        pickOff(gs, nearest, b);
      } else {
        // Broken up: the defender who got there gets a swat, the ball dies.
        lockPose(nearest, "swat", D.ACTION_HOLD.catch);
        if (rt > reach) diveFor(tgt, b);
        emit(gs, "incomplete", { x: b.x, y: b.y, by: nearest });
        endPlay(gs, gs.los, "INCOMPLETE");
      }
      return;
    }

    const air = b.y - (b.los === undefined ? gs.los : b.los);
    const contested = nr < D.CONTEST_RADIUS * 0.6;
    // Just out of reach: lay out for it. Caught or not, he is on the ground.
    if (rt > reach) {
      const p = C.DIVE_CHANCE * (1 - (rt - reach) / Math.max(0.1, C.DIVE_RADIUS - reach));
      diveFor(tgt, b);
      if (Math.random() >= p || b.y > 100 + D.END_ZONE) {
        emit(gs, "incomplete", { x: b.x, y: b.y, dive: true });
        endPlay(gs, gs.los, "INCOMPLETE");
        return;
      }
      gs.carrier = tgt;
      emit(gs, "catch", { who: tgt, from: b.thrower, air: air, contested: contested, diving: true, kind: b.kind });
      if (b.y >= 100) endPlay(gs, 100, "TOUCHDOWN");
      else endPlay(gs, b.y, "DIVING CATCH");
      return;
    }
    // Caught beyond the back of the end zone: no catch.
    if (b.y > 100 + D.END_ZONE) {
      emit(gs, "incomplete", { x: b.x, y: b.y, overthrow: true });
      endPlay(gs, gs.los, "INCOMPLETE");
      return;
    }
    gs.carrier = tgt;
    tgt.mirror = b.catchSide < 0;
    // Going up for it is the leaping catch, and he lands off balance.
    lockPose(tgt, b.highPoint ? "catch_away" : ballArrivalAction("catch", tgt), D.ACTION_HOLD.catch);
    if (b.highPoint) tgt.stumbleT = 0.3;
    emit(gs, "catch", { who: tgt, from: b.thrower, air: air, contested: contested, highPoint: b.highPoint, kind: b.kind });
  }

  // The play dies at the interception spot. A return would be the only thing
  // in this codebase running toward -y; not worth the coordinate risk.
  function pickOff(gs, d, b) {
    gs.pendingTurnover = true;
    lockPose(d, ballArrivalAction("intercept", d), D.ACTION_HOLD.intercept);
    gs.interceptor = d;
    emit(gs, "intercept", { who: d, x: b.x, y: b.y, by: b.thrower });
    endPlay(gs, b.y, "INTERCEPTED");
  }

  // A receiver laying out toward the ball (view: the tackle dive, toward hitWho).
  function diveFor(e, b) {
    if (!e) return;
    e.hitWho = { x: b.x, y: b.y };
    e.lastVx = e.vx;
    e.lastVy = e.vy;
    lockPose(e, "dive", D.PHASE_TIME.DEAD_BALL);
  }

  // ---- collision and whistle ----------------------------------------------

  // tackledEnt/tacklerEnt: set when the whistle came from a tackle, so those
  // two play the tackle pair instead of standing up. Every other whistle (out
  // of bounds, incomplete, touchdown) has no one to tackle and leaves both
  // undefined. In 3D the pair is a real hit: the tackler dives through the
  // runner, both go down the way the runner was moving (lastVx/lastVy).
  function endPlay(gs, spotY, reason, tackledEnt, tacklerEnt) {
    gs.phase = PHASE.DEAD_BALL;
    gs.phaseT = 0;
    gs.spot = spotY;
    gs.message = reason;
    gs.ball.inFlight = false;
    gs.whistleCarrier = gs.carrier;
    // Down in bounds after a run or a completed catch: the clock keeps
    // running (stopped again by a score or a change of possession, resolveDown).
    gs.clockRunning = reason === "TACKLED" || reason === "DIVING CATCH" || reason === "FUMBLE — OFFENSE RECOVERS";
    gs.runoff = 0;
    emit(gs, "whistle", { reason: reason, carrier: gs.carrier, tackled: tackledEnt || null, tackler: tacklerEnt || null, gain: spotY - gs.los });
    gs.entities.forEach(function (e) {
      // The renderer needs to know which way everyone was moving when the
      // whistle froze them: a tackle falls along it, a runner skids to a stop.
      e.lastVx = e.vx;
      e.lastVy = e.vy;
      e.vx = 0;
      e.vy = 0;
      if (e === tackledEnt) {
        e.hitBy = tacklerEnt || null;
        lockPose(e, "tackled", D.PHASE_TIME.DEAD_BALL);
        return;
      }
      if (e === tacklerEnt) {
        e.hitWho = tackledEnt || null;
        lockPose(e, "tackle", D.PHASE_TIME.DEAD_BALL);
        return;
      }
      if (e.lockT > 0) return;   // let a catch or a celebration finish
      e.action = "idle";
      e.facing = e.side === "def" ? "toward" : "away";
      e.mirror = false;
    });
  }

  // How likely this carrier is to run through this tackler, right now.
  // Exported so the harness can assert the rules rather than infer them from
  // the outcome of a few thousand random rolls.
  function breakChance(gs, c, d) {
    const T = D.TACKLE;

    // Two men on you is always a stop. Checked first: nothing else can rescue
    // it, and it is the rule that stops the juke button from being a cheat code.
    let support = 0;
    gs.entities.forEach(function (o) {
      if (o.side !== "def" || o === d || o.downT > 0) return;
      if (W.dist(c.x, c.y, o.x, o.y) < T.GANG_RADIUS) support++;
    });
    if (support > 0) return 0;

    let p = T.BREAK_BASE;
    if (gs.jukeT > 0) p += T.BREAK_JUKE;
    if (gs.spinT > 0) p += T.BREAK_JUKE * 0.65;
    p += airBonus(gs);
    // +y is downfield, so a tackler at a lower y is chasing from behind and has
    // a worse angle than one squaring the runner up.
    if (d.y < c.y) p += T.BREAK_FROM_BEHIND;
    return W.clamp(p, 0, 0.95);
  }

  // Contact no longer ends the play on its own. A lone tackler can be run
  // through; the runner pays for it with a stumble and the tackler ends up on
  // the floor, so breaking one is a real gain and not free.
  function checkTackle(gs, dt) {
    const c = gs.carrier;
    if (!c) return false;
    const T = D.TACKLE;

    for (let i = 0; i < gs.entities.length; i++) {
      const d = gs.entities[i];
      if (d.side !== "def") continue;
      if (d.tackleCd > 0) { d.tackleCd -= dt; continue; }
      if (d.downT > 0) continue;

      const r = W.sweptDistance(c.px, c.py, c.x, c.y, d.px, d.py, d.x, d.y);
      if (r >= T.RADIUS) continue;

      if (Math.random() < breakChance(gs, c, d)) {
        c.stumbleT = T.STUMBLE_TIME;
        lockPose(c, "stumble", D.ACTION_HOLD.stumble);
        d.downT = T.TACKLER_DOWN_TIME;
        d.tackleCd = T.COOLDOWN + T.TACKLER_DOWN_TIME;
        d.lastVx = d.vx;
        d.lastVy = d.vy;
        d.vx = 0;
        d.vy = 0;
        // "whiffed": the beaten tackler dives and eats grass, face down.
        lockPose(d, "whiffed", D.ACTION_HOLD.tackled);
        gs.message = "BROKEN TACKLE";
        gs.brokenTackles++;
        emit(gs, "broken", { runner: c, tackler: d });
        continue;   // another defender in range this frame may still make it
      }

      if (Math.random() < T.FUMBLE_CHANCE) {
        fumble(gs, c, d);
        return true;
      }
      // Brought down in his own end zone: that is the safety.
      endPlay(gs, c.y, c.y <= 0 ? "SAFETY" : "TACKLED", c, d);
      return true;
    }
    return false;
  }

  // The hit knocks it loose. The play is already dead at the carrier's spot —
  // no live scramble, which would be the only thing in this codebase that has
  // to hand the ball to the defense mid-play — but the ball visibly bounces
  // away and who comes up with it is decided on the spot.
  function fumble(gs, c, d) {
    const T = D.TACKLE;
    const goingLeft = c.vx < 0;
    // No whistle here. The loose ball remains live until someone reaches it.
    lockPose(c, "fumble", T.FUMBLE_STUN);
    c.facing = "side";
    c.mirror = goingLeft;
    c.scrambleDownT = T.FUMBLE_STUN;
    d.scrambleDownT = T.FUMBLE_STUN * 0.72;
    d.tackleCd = Math.max(d.tackleCd || 0, T.FUMBLE_STUN);
    lockPose(d, "tackle", T.FUMBLE_STUN * 0.72);
    // Pop it forward-ish and off to one side, away from the tackler.
    const side = c.x >= d.x ? 1 : -1;
    gs.loose = {
      x0: c.x, y0: c.y,
      vx: side * (2 + Math.random() * 3),
      vy: 2 + Math.random() * 4,
      t: 0
    };
    gs.ball.x = c.x;
    gs.ball.y = c.y;
    gs.ball.z = 0.9;
    gs.carrier = null;
    // Recovery is settled by checkLooseRecovery(), not a weighted coin flip.
    gs.looseControlId = null;
    gs.pendingTurnover = false;
    gs.turnoverMsg = null;
    gs.message = "FUMBLE!";
    emit(gs, "fumble", { who: c, by: d });
  }

  // The loose ball after a fumble: slides out and bounces to rest.
  function stepLoose(gs, dt) {
    const L = gs.loose;
    if (!L) return;
    L.t += dt;
    const k = 2.2;                                   // friction
    const travel = (1 - Math.exp(-k * L.t)) / k;
    gs.ball.x = W.clamp(L.x0 + L.vx * travel, -2, D.FIELD_W + 2);
    gs.ball.y = L.y0 + L.vy * travel;
    gs.ball.z = Math.abs(Math.sin(L.t * 9)) * 0.9 * Math.exp(-2.5 * L.t);
    gs.ball.tilt = L.t * 7 * (L.vx < 0 ? -1 : 1) * Math.exp(-1.5 * L.t);
  }

  function eligibleForRecovery(e) {
    return (e.scrambleDownT || 0) <= 0 && (e.downT || 0) <= 0;
  }

  function checkLooseRecovery(gs) {
    const L = gs.loose;
    if (!L || L.t < D.TACKLE.FUMBLE_RECOVERY_DELAY) return false;
    let closest = null;
    let distance = Infinity;
    gs.entities.forEach(function (e) {
      if (!eligibleForRecovery(e)) return;
      const r = W.dist(e.x, e.y, gs.ball.x, gs.ball.y);
      if (r < distance) { distance = r; closest = e; }
    });
    if (!closest || (distance > D.TACKLE.FUMBLE_RECOVERY_RADIUS && L.t < D.TACKLE.FUMBLE_TIMEOUT)) return false;

    const defenseRecovered = closest.team !== gs.offense;
    gs.loose = null;
    gs.looseControlId = null;
    gs.carrier = null;
    gs.ball.z = 0;
    gs.recoveredBy = closest;
    lockPose(closest, "recover", D.PHASE_TIME.DEAD_BALL);
    emit(gs, "recover", { who: closest, defense: defenseRecovered });
    if (defenseRecovered) {
      gs.pendingTurnover = true;
      gs.turnoverMsg = "FUMBLE — DEFENSE RECOVERS";
      endPlay(gs, gs.ball.y, "FUMBLE — DEFENSE RECOVERS");
    } else {
      endPlay(gs, gs.ball.y, "FUMBLE — OFFENSE RECOVERS");
    }
    return true;
  }

  function flipPossession(gs) {
    gs.ballOn = 100 - gs.ballOn;   // the ONLY coordinate that survives a flip
    gs.offense = 1 - gs.offense;
    gs.down = 1;
    gs.toGo = Math.min(10, 100 - gs.ballOn);
    gs.firstDownMark = gs.ballOn + gs.toGo;
  }

  function newDrive(gs, offenseIdx, spot) {
    gs.offense = offenseIdx;
    gs.ballOn = spot;
    gs.down = 1;
    gs.toGo = Math.min(10, 100 - spot);
    gs.firstDownMark = spot + gs.toGo;
  }

  // Runs once when the DEAD_BALL timer expires. The only router in the game.
  function resolveDown(gs) {
    const spot = W.clamp(gs.spot, -D.END_ZONE, 100 + D.END_ZONE);
    let next;

    // Any score or change of possession stops the clock until the next snap.
    gs.clockRunning = gs.clockRunning && !gs.pendingTurnover && spot > 0 && spot < 100;

    if (gs.pendingTurnover && spot <= 0) {
      // Taken away in the offense's own end zone: a touchdown for the defense,
      // which then kicks off to the team it scored on (who keep the ball).
      const scoring = 1 - gs.offense;
      const who = gs.interceptor || gs.recoveredBy || null;
      gs.entities.forEach(function (e) {
        lockPose(e, e.team === scoring ? "celebrate" : "dejected", D.PHASE_TIME.TOUCHDOWN);
      });
      gs.score[scoring] += 7;
      gs.scoredBy = scoring;
      gs.whistleCarrier = who;
      emit(gs, "touchdown", { team: scoring, scorer: who, defensive: true });
      newDrive(gs, gs.offense, D.TOUCHBACK_SPOT);
      gs.message = "DEFENSIVE TOUCHDOWN";
      next = PHASE.TOUCHDOWN;
    } else if (gs.pendingTurnover && spot >= 100) {
      // Picked off in the end zone: a touchback for the defense. This used to
      // fall into the touchdown branch and give the OFFENSE seven points.
      newDrive(gs, 1 - gs.offense, D.TOUCHBACK_SPOT);
      gs.message = "INTERCEPTED — TOUCHBACK";
      next = PHASE.TURNOVER;
      emit(gs, "turnover", { reason: gs.message, team: gs.offense });
    } else if (spot >= 100) {
      // Celebrate before newDrive flips possession — `gs.offense` is still the
      // side that just scored, and these entities live until toPreSnap rebuilds
      // the formation.
      const scoring = gs.offense;
      gs.entities.forEach(function (e) {
        if (e.team === scoring) lockPose(e, "celebrate", D.PHASE_TIME.TOUCHDOWN);
        else lockPose(e, "dejected", D.PHASE_TIME.TOUCHDOWN);
      });
      gs.score[gs.offense] += 7;      // 6 + automatic extra point
      gs.scoredBy = scoring;
      emit(gs, "touchdown", { team: scoring, scorer: gs.whistleCarrier || null });
      newDrive(gs, 1 - gs.offense, D.TOUCHBACK_SPOT);
      gs.message = "TOUCHDOWN — XP GOOD";
      next = PHASE.TOUCHDOWN;
    } else if (spot <= 0) {
      gs.score[1 - gs.offense] += 2;
      emit(gs, "safety", { team: 1 - gs.offense });
      newDrive(gs, 1 - gs.offense, D.TOUCHBACK_SPOT);
      gs.message = "SAFETY";
      next = PHASE.SAFETY;
    } else if (gs.pendingTurnover) {
      gs.ballOn = spot;
      flipPossession(gs);
      gs.message = gs.turnoverMsg || "INTERCEPTED";
      next = PHASE.TURNOVER;
      emit(gs, "turnover", { reason: gs.message, team: gs.offense });
    } else {
      gs.ballOn = spot;
      if (gs.ballOn >= gs.firstDownMark) {
        gs.down = 1;
        gs.toGo = Math.min(10, 100 - gs.ballOn);
        gs.firstDownMark = gs.ballOn + gs.toGo;
        gs.message = "FIRST DOWN";
        next = PHASE.BETWEEN_DOWNS;
        emit(gs, "firstdown", {});
      } else {
        gs.down++;
        gs.toGo = gs.firstDownMark - gs.ballOn;
        if (gs.down > 4) {
          flipPossession(gs);
          gs.message = "TURNOVER ON DOWNS";
          next = PHASE.TURNOVER;
          emit(gs, "turnover", { reason: gs.message, team: gs.offense });
        } else {
          next = PHASE.BETWEEN_DOWNS;
        }
      }
    }

    gs.pendingTurnover = false;
    gs.turnoverMsg = null;
    gs.deadBallTime = 0;

    if (gs.quarterExpired) {
      advanceQuarter(gs);
      return;
    }
    gs.phase = next;
    gs.phaseT = 0;
  }

  function advanceQuarter(gs) {
    gs.quarterExpired = false;
    gs.clockRunning = false;
    gs.quarter++;
    if (gs.quarter > D.QUARTERS) {
      gs.phase = PHASE.GAME_OVER;
      gs.phaseT = 0;
      gs.message = "FINAL";
      return;
    }
    gs.clock = D.QUARTER_SECONDS;
    if (gs.quarter === 3) {
      newDrive(gs, 1 - gs.startedWith, D.TOUCHBACK_SPOT);
      gs.phase = PHASE.HALFTIME;
      gs.message = "HALFTIME";
    } else {
      gs.phase = PHASE.QUARTER_BREAK;
      gs.message = "END OF QUARTER " + (gs.quarter - 1);
    }
    gs.phaseT = 0;
  }

  // Test hook: tools/balance.js pins a single call so one play or one defensive
  // look can be measured on its own. -1 means "let the AI decide", which is
  // always the case in the game itself.
  const forced = { play: -1, def: -1 };
  function forceCall(play, def) {
    forced.play = play === undefined ? -1 : play;
    forced.def = def === undefined ? -1 : def;
  }

  function toPreSnap(gs) {
    // The CPU's calls are made before the formation is built, and never shown:
    // from the human's side the CPU's call is a secret until the snap.
    const human = humanPlaying(gs);
    gs.suggest = !human ? [] : humanHasBall(gs) ? suggestPlays(gs) : suggestDefenses(gs);
    // A human defense lines up in its top suggestion until it makes its call.
    gs.defCall = forced.def >= 0 ? forced.def
      : (human && !humanHasBall(gs) && gs.suggest.length ? gs.suggest[0] : pickDefense(gs));
    // The playbook gives WR1 (left) the vertical clear-outs and WR2 (right) the
    // breaking routes, so a CPU running it as drawn threw 94% of its passes to
    // the right and never once to WR1 (tools/pass-mix.js, 2026-10-03). The CPU
    // flips half its calls; the human's calls always run as the art shows.
    gs.cpuFlip = false;
    gs.humanFlip = false;
    gs.flipShift = false;
    if (!humanHasBall(gs)) {
      gs.playCall = forced.play >= 0 ? forced.play : pickCpuPlay(gs);
      gs.cpuFlip = Math.random() < 0.5;
    }
    setupFormation(gs);
    emit(gs, "formation", {});

    // Every down starts in the huddle. When a person is playing, the huddle
    // waits for their call — offense or defense, Madden-style — with a play
    // clock (D.PLAY_CALL_SECONDS) that makes the top suggested call if it runs out.
    gs.callPending = human;
    gs.callT = 0;
    enterHuddle(gs);
  }

  // The human's call. Offense: just the call — routes are laid out when the
  // huddle breaks onto the formation spots (applyPlay works from where each
  // player stands, which in the huddle is the middle of the field).
  function callPlay(gs, index) {
    if (!humanPlaying(gs) || !humanHasBall(gs)) return false;
    gs.playCall = W.clamp(index | 0, 0, D.PLAYBOOK.length - 1);
    gs.callPending = false;
    emit(gs, "call", { side: "off", index: gs.playCall });
    return true;
  }

  // Defense: the new look's assignments take effect at once and each defender
  // jogs to his new spot (stepShift). The CPU will not snap on a moving defense.
  function callDefense(gs, index) {
    if (!humanPlaying(gs) || humanHasBall(gs)) return false;
    const i = W.clamp(index | 0, 0, D.DEFENSES.length - 1);
    gs.callPending = false;
    emit(gs, "call", { side: "def", index: i });
    if (i === gs.defCall) return true;
    gs.defCall = i;
    D.DEFENSES[i].units.forEach(function (f, n) {
      const e = gs.entities.find(function (x) { return x.side === "def" && x.char === f.char; });
      if (!e) return;
      e.slot = "D" + n;
      e.ai = f.ai;
      e.covers = coverFor(gs, f);
      e.homeX = D.FIELD_MID + f.dx + lbShade(gs, f);
      e.shiftX = e.homeX;
      e.shiftY = gs.ballOn + f.dy;
      e.stanceAction = "stance_" + (f.ai === "PURSUE" ? "rush" : f.ai === "COVER" ? "cover" : f.ai === "LB" ? "lb" : "contain");
    });
    return true;
  }

  // Defenders jogging to a new alignment. Returns true while anyone is moving.
  function stepShift(gs, dt) {
    let moving = false;
    gs.entities.forEach(function (e) {
      if (e.side !== "def" || e.shiftX === undefined) return;
      if (W.dist(e.x, e.y, e.shiftX, e.shiftY) > 0.14) {
        steerToward(e, e.shiftX, e.shiftY, e.speed * 0.8, dt);
        integrate(e, dt);
        moving = true;
        return;
      }
      e.x = e.px = e.shiftX;
      e.y = e.py = e.shiftY;
      e.vx = e.vy = 0;
      e.shiftX = e.shiftY = undefined;
      e.action = e.stanceAction;
      e.lockT = 0;
    });
    return moving;
  }

  // The play clock in the huddle, and the human's call arriving.
  function stepCall(gs, dt, input) {
    if (!gs.callPending) return;
    gs.callT += dt;
    if (humanHasBall(gs)) {
      if (input.play >= 0) callPlay(gs, input.play);
    } else if (input.defPlay >= 0) {
      callDefense(gs, input.defPlay);
    }
    if (gs.callPending && gs.callT >= D.PLAY_CALL_SECONDS) {
      const pick = gs.suggest.length ? gs.suggest[0] : (humanHasBall(gs) ? gs.playCall : gs.defCall);
      if (humanHasBall(gs)) callPlay(gs, pick); else callDefense(gs, pick);
      emit(gs, "autocall", {});
    }
  }

  // Cluster the offense a few yards behind the ball for the huddle. Positions
  // are stashed on each entity (`hx`/`hy`) so breakHuddle can put them back on
  // their exact formation spot rather than re-deriving it.
  // A real ring now, everyone facing the middle with the QB's back to the
  // defense — the 2D game stood them in a line because a sprite cannot face
  // inward. `huddleCx/Cy` is what the renderer turns them toward.
  function enterHuddle(gs) {
    const huddleY = W.clamp(gs.ballOn - 6, -D.END_ZONE + 2, 100 + D.END_ZONE - 2);
    gs.huddleCx = D.FIELD_MID;
    gs.huddleCy = huddleY;
    gs.entities.forEach(function (e, i) {
      if (e.side !== "off") return;
      e.hx = e.x;
      e.hy = e.y;
      const order = ["QB", "RB", "WR1", "TE", "OL", "OL2", "WR2"].indexOf(e.slot);
      // The QB stands on the downfield side of the ring, calling the play.
      const a = Math.PI / 2 + ((order === -1 ? i : order) / 7) * Math.PI * 2;
      e.x = D.FIELD_MID + Math.cos(a) * 1.35;
      e.y = huddleY + Math.sin(a) * 1.35;
      e.px = e.x;
      e.py = e.y;
      e.action = "huddle";
      e.facing = "toward";
    });
    gs.ball.x = D.FIELD_MID;
    gs.ball.y = huddleY;
    gs.message = "HUDDLE";
    gs.phase = PHASE.HUDDLE;
    gs.phaseT = 0;
  }

  // Begin the jog from the clustered huddle to the line.  The old version
  // assigned hx/hy straight back to x/y here, which made five people visibly
  // teleport the instant the huddle timer expired.
  function breakHuddle(gs) {
    gs.entities.forEach(function (e) {
      if (e.side !== "off") return;
      e.huddleTargetX = e.hx;
      e.huddleTargetY = e.hy;
      e.vx = 0;
      e.vy = 0;
      e.action = "run";
      e.facing = "away";
    });
    gs.message = "BREAK!";
    gs.phase = PHASE.HUDDLE_BREAK;
    gs.phaseT = 0;
  }

  function stepHuddleBreak(gs, dt) {
    let set = true;
    gs.entities.forEach(function (e) {
      if (e.side !== "off" || e.huddleTargetX === undefined) return;
      const r = W.dist(e.x, e.y, e.huddleTargetX, e.huddleTargetY);
      if (r > 0.14) {
        // This is deliberately a brisk jog rather than a football-speed
        // sprint: it reads as a team breaking the huddle, and the short phase
        // still keeps the game moving.
        steerToward(e, e.huddleTargetX, e.huddleTargetY, e.speed * 1.32, dt);
        set = false;
      } else {
        applyDesired(e, 0, 0, dt);
      }
      integrate(e, dt);
    });
    if (gs.carrier) {
      gs.ball.x = gs.carrier.x;
      gs.ball.y = gs.carrier.y;
      gs.ball.z = 0;
    }

    // A flip at the line is a whole-formation shift across the field: give it time.
    if (!set && gs.phaseT < (gs.flipShift ? 3.2 : D.PHASE_TIME.HUDDLE_BREAK)) return;
    gs.flipShift = false;
    gs.entities.forEach(function (e) {
      if (e.side !== "off" || e.huddleTargetX === undefined) return;
      // Land exactly on the authored formation so assignments, blockers and
      // the pre-snap camera all begin from their deterministic positions.
      e.x = e.px = e.huddleTargetX;
      e.y = e.py = e.huddleTargetY;
      e.vx = 0;
      e.vy = 0;
      e.huddleTargetX = e.huddleTargetY = undefined;
      e.action = "stance_" + e.role;
      e.facing = "away";
    });
    // Lay the routes out from the formation spots: a human call made in the
    // huddle has not been applied yet (and for the CPU this is a no-op redo).
    applyPlay(gs);
    if (gs.carrier) { gs.ball.x = gs.carrier.x; gs.ball.y = gs.carrier.y; }
    gs.message = "";
    gs.huddleCx = gs.huddleCy = undefined;
    gs.phase = PHASE.PRE_SNAP;
    gs.phaseT = 0;
  }

  // Which defender the human is driving when the CPU has the ball. Callable
  // any time — PRE_SNAP, HUDDLE or LIVE — so a switch mid-play works too.
  function setControlSlot(gs, slot) {
    gs.controlSlot = slot;
  }

  // Flipping through the playbook at the line. Only assignments change, so this
  // is free and can happen as many times as the player likes before the snap.
  function setPlay(gs, index) {
    if (gs.phase !== PHASE.PRE_SNAP || !humanHasBall(gs)) return false;
    const i = W.clamp(index | 0, 0, D.PLAYBOOK.length - 1);
    if (i === gs.playCall) return false;
    gs.playCall = i;
    applyPlay(gs);
    return true;
  }

  // FLIP: mirror the human's call to the other side of the field (every
  // offensive spot, so WR1 lines up right and the routes break the other
  // way). In the huddle it just changes where the break goes; at the line the
  // whole offense shifts across, and the defense re-aligns its corners and
  // linebacker to match. Toggles; a new down starts unflipped.
  function flipPlay(gs) {
    if (!humanPlaying(gs) || !humanHasBall(gs)) return false;
    const ph = gs.phase;
    if (ph !== PHASE.HUDDLE && ph !== PHASE.HUDDLE_BREAK && ph !== PHASE.PRE_SNAP) return false;
    gs.humanFlip = !gs.humanFlip;
    const mir = function (x) { return 2 * D.FIELD_MID - x; };
    gs.entities.forEach(function (e) {
      if (e.side !== "off") return;
      e.hx = mir(e.hx);
      if (ph !== PHASE.HUDDLE) {
        e.huddleTargetX = e.hx;
        e.huddleTargetY = e.hy;
      }
    });
    if (ph === PHASE.PRE_SNAP) {
      gs.entities.forEach(function (e) {
        if (e.side !== "off" || Math.abs(e.x - e.hx) < 0.2) return;
        e.action = "run";
      });
      gs.flipShift = true;
      gs.phase = PHASE.HUDDLE_BREAK;
      gs.phaseT = 0;
    }
    // The defense answers the shift: corners swap men, the backer re-shades.
    D.DEFENSES[gs.defCall].units.forEach(function (f, n) {
      const e = gs.entities.find(function (x) { return x.side === "def" && x.slot === "D" + n; });
      if (!e) return;
      // Corners stay on their side and take whoever is now over them.
      e.covers = coverFor(gs, f);
      e.homeX = D.FIELD_MID + f.dx + lbShade(gs, f);
      if (Math.abs(e.homeX - e.x) > 0.2) {
        e.shiftX = e.homeX;
        e.shiftY = gs.ballOn + f.dy;
        e.stanceAction = "stance_" + (f.ai === "PURSUE" ? "rush" : f.ai === "COVER" ? "cover" : f.ai === "LB" ? "lb" : "contain");
      }
    });
    emit(gs, "flip", { flipped: gs.humanFlip });
    return true;
  }

  // ---- main update ---------------------------------------------------------

  // The running clock between plays (gs.clockRunning, set at the whistle).
  // Runs out the quarter if it gets there; mid-whistle the down still resolves.
  function runClock(gs, dt) {
    if (!gs.clockRunning || gs.runoff >= D.CLOCK_RUNOFF_MAX) return;
    const ph = gs.phase;
    if (ph !== PHASE.DEAD_BALL && ph !== PHASE.BETWEEN_DOWNS && ph !== PHASE.HUDDLE &&
        ph !== PHASE.HUDDLE_BREAK && ph !== PHASE.PRE_SNAP) return;
    gs.runoff += dt;
    gs.clock -= dt;
    if (gs.clock > 0) return;
    gs.clock = 0;
    gs.clockRunning = false;
    if (ph === PHASE.DEAD_BALL) gs.quarterExpired = true;
    else advanceQuarter(gs);
  }

  function update(gs, dt, input) {
    gs.phaseT += dt;
    const P = D.PHASE_TIME;
    runClock(gs, dt);
    if (input.flip) flipPlay(gs);

    switch (gs.phase) {
      case PHASE.LIVE:
        stepLive(gs, dt, input);
        break;
      case PHASE.DEAD_BALL:
        stepLoose(gs, dt);
        if (gs.phaseT >= (gs.deadBallTime || P.DEAD_BALL)) resolveDown(gs);
        break;
      case PHASE.BETWEEN_DOWNS:
        if (gs.phaseT >= P.BETWEEN_DOWNS) toPreSnap(gs);
        break;
      case PHASE.HUDDLE:
        stepShift(gs, dt);
        stepCall(gs, dt, input);
        if (!gs.callPending && gs.phaseT >= P.HUDDLE) breakHuddle(gs);
        break;
      case PHASE.HUDDLE_BREAK:
        // A defensive audible is allowed until the snap.
        if (input.defPlay >= 0) callDefense(gs, input.defPlay);
        stepShift(gs, dt);
        stepHuddleBreak(gs, dt);
        break;
      case PHASE.TOUCHDOWN:
      case PHASE.SAFETY:
        if (gs.phaseT >= P.TOUCHDOWN) toPreSnap(gs);
        break;
      case PHASE.TURNOVER:
        if (gs.phaseT >= P.TURNOVER) toPreSnap(gs);
        break;
      case PHASE.QUARTER_BREAK:
        if (gs.phaseT >= P.QUARTER_BREAK) toPreSnap(gs);
        break;
      case PHASE.HALFTIME:
        if (gs.phaseT >= P.HALFTIME || input.snap) toPreSnap(gs);
        break;
      case PHASE.PRE_SNAP: {
        if (input.play >= 0) setPlay(gs, input.play);
        if (input.defPlay >= 0) callDefense(gs, input.defPlay);
        const shifting = stepShift(gs, dt);
        // The CPU offense snaps itself, once the defense is set. It used to sit
        // at the line until the human, playing defense, pressed Space for it.
        // Space from a human defense still hurries it, but not mid-shift either.
        if (shifting) gs.phaseT = Math.min(gs.phaseT, D.CPU_SNAP_DELAY * 0.6);
        else if (input.snap || (!humanHasBall(gs) && gs.phaseT >= D.CPU_SNAP_DELAY)) snap(gs);
        break;
      }
      default:
        break;
    }

    // Only stepLive integrates, so a held pose set at the whistle — a catch, a
    // touchdown celebration — would freeze on its first frame without this.
    if (gs.phase !== PHASE.LIVE && gs.phase !== PHASE.PRE_SNAP) {
      gs.entities.forEach(function (e) {
        e.frameT += dt;
        if (e.lockT > 0) e.lockT -= dt;
      });
    }
  }

  function stepLive(gs, dt, input) {
    // The ONLY line in this codebase that decrements the clock.
    gs.clock -= dt;
    if (gs.clock <= 0) {
      gs.clock = 0;
      gs.quarterExpired = true;   // let the play finish; DEAD_BALL routes it
    }

    // Flea-flicker: hand it back. Done on a timer rather than on the runner
    // reaching a spot, so the QB is set and looking downfield when it arrives.
    if (gs.pitchBackT > 0) {
      gs.pitchBackT -= dt;
      // Only from the back it was pitched to, and only behind the line. This
      // used to fire for ANY carrier who was not the QB — so a pass completed
      // inside the timer teleported the ball out of the receiver's hands.
      const back = currentPlay(gs).handoff;
      if (gs.pitchBackT <= 0 && gs.carrier && gs.carrier.slot === back &&
          gs.carrier.y < gs.los + 0.5) {
        const qb = gs.entities.find(function (e) { return e.slot === "QB"; });
        if (qb) {
          lockPose(gs.carrier, "handoff", D.ACTION_HOLD.handoff);
          gs.carrier = qb;
          gs.message = "PITCH BACK";
        }
      }
    }

    // HB DRAW: the QB has sold the pass; now slip it to the back.
    if (gs.drawT > 0) {
      gs.drawT -= dt;
      const play = currentPlay(gs);
      const c = gs.carrier;
      if (gs.drawT <= 0 && c && c.role === "qb" && c.y < gs.los + 0.5 && !gs.ball.inFlight && !gs.passThrown) {
        const to = gs.entities.find(function (e) { return e.slot === play.handoff; });
        if (to) {
          lockPose(c, "handoff", D.ACTION_HOLD.handoff);
          gs.carrier = to;
          emit(gs, "handoff", { from: c, to: to, late: true });
        }
      }
    }

    const human = humanHasBall(gs);
    const humanDefends = gs.humanTeam === 1 - gs.offense;
    // Ball in the air to the human's receiver: HIGH-POINT (the juke button).
    if (human && gs.ball.inFlight && input.juke) gs.ball.highPoint = true;

    // When the player's offense puts it on the turf, temporarily hand the
    // movement stick to the closest available teammate. Letting go hands them
    // back to the chase AI, just like the normal defensive auto-select.
    if (gs.loose && human) {
      let nearest = null;
      let distance = Infinity;
      gs.entities.forEach(function (e) {
        if (e.side !== "off" || !eligibleForRecovery(e)) return;
        const r = W.dist(e.x, e.y, gs.ball.x, gs.ball.y);
        if (r < distance) { distance = r; nearest = e; }
      });
      gs.looseControlId = nearest ? nearest.id : null;
    } else if (!gs.loose) {
      gs.looseControlId = null;
    }

    // Throw/pitch keys are the human offense's only. On defense they used to
    // throw FOR the CPU quarterback.
    if (!gs.loose && human && (input.throw1 || input.throw2 || input.throw3)) {
      const slot = input.throw1 ? "WR1" : input.throw2 ? "WR2" : "TE";
      if (!throwTo(gs, slot, input.x, input.throwKind || "normal")) {
        // Say why, rather than a key press silently doing nothing.
        if (gs.ball.inFlight) flash(gs, "BALL'S IN THE AIR");
        else if (gs.passThrown) flash(gs, "ONE PASS PER PLAY");
        else if (gs.carrier && gs.carrier.slot === slot) flash(gs, "YOU HAVE IT — RUN!");
        else if (gs.carrier) flash(gs, "PAST THE LINE — NO THROW");
      }
    } else if (!gs.loose && human && input.pitch) {
      pitchToRb(gs);
    }
    if (gs.flashT > 0) {
      gs.flashT -= dt;
      if (gs.flashT <= 0 && gs.message === gs.flashMsg) gs.message = "";
    }

    gs.entities.forEach(function (e) { e.claimed = false; });

    // On defense, hand control to the defender with the shortest path to the
    // ball carrier. This avoids a click/selection delay right when a tackle is
    // needed, while retaining the cyan marker that shows who movement steers.
    // Only when a person really is on defense: tools/balance.js runs CPU vs
    // CPU, and handing its best-placed tackler to a "human" pressing nothing
    // froze him and pushed the measured touchdown rate from 10% to 58%.
    if (humanDefends && (gs.carrier || gs.loose)) {
      const target = gs.carrier || gs.ball;
      let nearest = null;
      let distance = Infinity;
      gs.entities.forEach(function (e) {
        if (e.side !== "def" || !eligibleForRecovery(e)) return;
        const r = W.dist(e.x, e.y, target.x, target.y);
        if (r < distance) { distance = r; nearest = e; }
      });
      if (nearest) gs.controlSlot = nearest.slot;
    }
    // A screen goes to its man as soon as he has settled behind the line —
    // before the blitz arrives, which is the whole point of calling one.
    const quickSlot = currentPlay(gs).quick;
    if (quickSlot && !human && !gs.cpuThrew && gs.phaseT > 0.5 && canThrow(gs)) {
      const q = gs.entities.find(function (e) { return e.slot === quickSlot; });
      if (q && q.route && q.wp >= q.route.length) {
        gs.cpuThrew = true;
        throwTo(gs, quickSlot);
      }
    }
    if (!human && !gs.cpuThrew && gs.phaseT > 1.0 && canThrow(gs)) {
      const qb = gs.carrier;
      const opts = ["WR1", "WR2", "TE"].map(function (slot) {
        const wr = gs.entities.find(function (e) { return e.slot === slot; });
        // Separation where the ball will come DOWN, not where the receiver is
        // now. Defenders break on the landing spot while the ball is in the
        // air, so once the QB had time to set up in the pocket, "open right
        // now" turned into a broken-up pass on 74% of throws.
        const T = Math.max(W.dist(qb.x, qb.y, wr.x, wr.y) / D.PASS_SPEED, 0.25);
        const lx = wr.x + wr.vx * T;
        const ly = wr.y + wr.vy * T;
        let nr = Infinity;
        gs.entities.forEach(function (d) {
          if (d.side !== "def") return;
          const closing = d.speed * Math.max(0, T - D.QB_POCKET.DEF_BREAK_DELAY);
          nr = Math.min(nr, Math.max(0, W.dist(lx, ly, d.x, d.y) - closing));
        });
        return { slot: slot, open: nr, downfield: wr.y - gs.los };
      }).filter(function (o) {
        // Read the first man alone for a beat, then everyone. Scanning for the
        // most open man from the first frame always found the same quick
        // sideways route — the tight end's flat on SLANTS was thrown 265 times
        // in 12 games and the slants once (tools/pass-mix.js, 2026-10-03).
        return o.downfield > 3 && (gs.phaseT >= D.QB_POCKET.READ_FIRST || o.slot === gs.cpuRead);
      }).sort(function (a, b) { return b.open - a.open; });
      // Take the open man; once the rush is free, let it go rather than eat a
      // sack. The window is measured against CONTEST_RADIUS: holding out for
      // more separation than coverage can punish meant the CPU only ever threw
      // passes that could not be broken up, and incompletions fell to 0.4%.
      const count = D.DEFENSES[gs.defCall].rushCount;
      const desperate = gs.phaseT > (count === undefined ? D.RUSH_COUNT : count) + 0.5;
      if (currentPlay(gs).quick) {
        // Handled above; a screen is never thrown anywhere else.
      } else if (opts.length && (opts[0].open > D.CONTEST_RADIUS * D.QB_POCKET.THROW_OPEN ||
          (desperate && opts[0].open > D.CONTEST_RADIUS * D.QB_POCKET.DESPERATE_OPEN))) {
        // Nobody even close to open under pressure: tuck it and run (the
        // pocket gives up at HOLD_PAST_COUNT) rather than throw into coverage.
        gs.cpuThrew = true;
        throwTo(gs, opts[0].slot);
      }
    }

    gs.entities.forEach(function (e) {
      if (e.side === "def") return;
      if (gs.loose) {
        if (!eligibleForRecovery(e)) {
          applyDesired(e, 0, 0, dt);
        } else if (human && e.id === gs.looseControlId &&
          (Math.abs(input.x || 0) > 0.05 || Math.abs(input.y || 0) > 0.05)) {
          driveHumanLooseRunner(e, input, dt);
        } else {
          steerToward(e, gs.ball.x, gs.ball.y, e.speed, dt);
        }
        return;
      }
      if (e === gs.carrier) {
        if (human) driveHumanCarrier(gs, input, dt);
        else driveCpuCarrier(gs, dt);
      } else if (gs.ball.inFlight && gs.ball.target === e) {
        // Come back to the ball. Routes bend after the throw is released, so
        // leading the receiver's velocity alone left the landing spot yards
        // from anyone. A person with the stick can run him under it instead.
        const r = W.dist(e.x, e.y, gs.ball.tx, gs.ball.ty);
        if (human && (Math.abs(input.x || 0) > 0.05 || Math.abs(input.y || 0) > 0.05)) driveHumanLooseRunner(e, input, dt);
        else steerToward(e, gs.ball.tx, gs.ball.ty, e.speed * Math.min(1, r * 1.5), dt);
      } else if (gs.drawT > 0 && e.slot === currentPlay(gs).handoff) {
        // The draw's back sets up beside the QB as if to pass-protect.
        const qb = gs.carrier;
        if (qb) steerToward(e, qb.x + 1.1, qb.y + 0.2, e.speed * 0.6, dt);
        else applyDesired(e, 0, 0, dt);
      } else if (e.role === "ol" || e.assignment === "block") {
        // The play call can turn a receiver or the back into a blocker; that is
        // what makes a run call look different from a pass call.
        driveBlocker(gs, e, dt);
      } else if (e.assignment === "route") {
        runRoute(e, dt);
      } else if (e.role === "rb") {
        steerToward(e, gs.carrier ? gs.carrier.x - 3 : e.x, e.y + 2, e.speed * 0.8, dt);
      } else {
        applyDesired(e, 0, 0, dt);
      }
    });

    const controlled = humanDefends && gs.controlSlot
      ? gs.entities.find(function (e) { return e.side === "def" && e.slot === gs.controlSlot; })
      : null;
    gs.entities.forEach(function (d) {
      if (d.side !== "def") return;
      if (gs.loose) {
        const steeringLoose = d === controlled &&
          (Math.abs(input.x || 0) > 0.05 || Math.abs(input.y || 0) > 0.05);
        if (!eligibleForRecovery(d)) applyDesired(d, 0, 0, dt);
        else if (steeringLoose) driveHumanDefender(gs, d, input, dt);
        else steerToward(d, gs.ball.x, gs.ball.y, d.speed * d.speedCap, dt);
        return;
      }
      // Hands off the keys, the selected defender plays his normal AI; he was
      // frozen in place, and he is by construction the one closest to a tackle.
      const steering = d === controlled &&
        (Math.abs(input.x || 0) > 0.05 || Math.abs(input.y || 0) > 0.05 || input.tackle || d.lungeT > 0);
      if (steering) driveHumanDefender(gs, d, input, dt);
      else driveDefender(gs, d, dt);
    });

    gs.entities.forEach(function (e) { integrate(e, dt); });
    if (gs.loose) {
      stepLoose(gs, dt);
      if (checkLooseRecovery(gs)) return;
    } else {
      stepBall(gs, dt);
    }

    const c = gs.carrier;
    if (c) {
      if (c.x < 0 || c.x > D.FIELD_W) { endPlay(gs, c.y, c.y <= 0 ? "SAFETY" : "OUT OF BOUNDS"); return; }
      if (c.y >= 100) { endPlay(gs, 100, "TOUCHDOWN"); return; }
      // Backed into his own end zone is not a safety by itself any more: he
      // can still throw it or run it out. Tackled in there (checkTackle) or
      // out the back of it, it is.
      if (c.y <= -D.END_ZONE) { endPlay(gs, 0, "SAFETY"); return; }
      checkTackle(gs, dt);
    }
  }

  const TBSim = {
    PHASE: PHASE,
    newGame: newGame,
    update: update,
    snap: snap,
    throwTo: throwTo,
    canHumanThrow: canHumanThrow,
    pitchToRb: pitchToRb,
    resolveDown: resolveDown,
    flipPossession: flipPossession,
    setupFormation: setupFormation,
    endPlay: endPlay,
    integrate: integrate,
    lockPose: lockPose,
    humanHasBall: humanHasBall,
    advanceQuarter: advanceQuarter,
    setPlay: setPlay,
    flipPlay: flipPlay,
    callPlay: callPlay,
    callDefense: callDefense,
    suggestPlays: suggestPlays,
    suggestDefenses: suggestDefenses,
    humanPlaying: humanPlaying,
    setControlSlot: setControlSlot,
    applyPlay: applyPlay,
    currentPlay: currentPlay,
    pickDefense: pickDefense,
    pickCpuPlay: pickCpuPlay,
    breakChance: breakChance,
    checkTackle: checkTackle,
    enterHuddle: enterHuddle,
    breakHuddle: breakHuddle,
    forceCall: forceCall
  };

  G.TBSim = TBSim;
  if (typeof module !== "undefined") module.exports = TBSim;
})();
