// Snowball Squabble: the whole game as pure logic (no three.js), so Node can play it too
// (tools/sim-test.js). Team elimination: one snowball and you're out; a round ends
// when a team has nobody left standing. First team to cfg.winRounds takes the match.
//
// World: flat snow field, x east-west, z north-south, y up. Yaw 0 looks along -z
// (the same as a three.js camera), pitch + looks up. Team 0 (blue, the human's)
// starts at +z, team 1 (red) at -z.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";

  const CFG = SB.CFG = {
    HX: 40, HZ: 62,                    // field half sizes
    G: 9.0,                            // snowball gravity, m/s^2
    BALL_R: 0.11,
    SPEED_MIN: 20, SPEED_MAX: 34,      // throw speed by charge, m/s
    CHARGE_T: 0.85,                    // seconds to a full charge
    THROW_CD: 0.42,
    WIND_BOT: 0.28,                    // a bot's wind-up before the ball leaves the hand
    WIND_HUMAN: 0.22,                  // the player's, after release (the throw animation plays through it)
    CAM_DIST: 3.4, CAM_SIDE: 0.65, CAM_UP: 0.3,   // over-the-shoulder camera
    CHARGE_POSE: [0.22, 0],            // the frame of the throw clip the wind-up holds: where the throw itself starts (body.js)
    MAX_AMMO: 8, PACK_T: 1.5,
    RUN: 5.2, SPRINT: 7.0, CROUCH: 2.3,
    ROLL_T: 0.95, ROLL_SPEED: 6.8, ROLL_CD: 1.8,
    R: 0.34,                           // body radius
    H_STAND: 1.78, H_CROUCH: 1.08, H_ROLL: 0.62,
    EYE_STAND: 1.62, EYE_CROUCH: 0.98,
    MOUND_HP: 6,
    MERLON: { h: 0.5, pitch: 1.5, w: 0.85 },       // castle battlements: block height, spacing, block width
    TOWER_R: 1.35, TOWER_H: 4.6,                   // castle towers
    POND: { x: 0, z: 0, r: 8.5 },
    COUNTDOWN: 3.2, OVER_T: 4.2
  };

  const NAMES = ["Frost", "Blizzard", "Flurry", "Sleet", "Icicle", "Mittens", "Yeti", "Slush", "Drift", "Chill", "Gale", "Powder", "Hail", "Nippy"];

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ------------------------------------------------------------------ the field
  // Everything is laid out for team 1 (the +z half) and mirrored through the centre,
  // so neither side has the better ground.
  function buildField(seed) {
    const rnd = rngFrom(seed);
    const F = { mounds: [], circles: [], boxes: [], forts: [] };   // circles = trees + snowmen (solid, permanent)
    const HX = CFG.HX, HZ = CFG.HZ;
    const taken = [];
    const far = (x, z, d) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > d + t.r);
    const pondOk = (x, z, r) => Math.hypot(x - CFG.POND.x, z - CFG.POND.z) > CFG.POND.r + r + 0.5;
    function place(count, kind, rmin, rmax, zmin, zmax, spacing) {
      let tries = 0;
      while (count > 0 && tries++ < 4000) {
        const r = rmin + rnd() * (rmax - rmin);
        const x = (rnd() * 2 - 1) * (HX - 5), z = zmin + rnd() * (zmax - zmin);
        if (!far(x, z, r + spacing) || !pondOk(x, z, r)) continue;
        taken.push({ x: x, z: z, r: r });
        // Mirror: the same thing the other way round.
        taken.push({ x: -x, z: -z, r: r });
        if (kind === "mound") {
          F.mounds.push({ x: x, z: z, r0: r, hp: CFG.MOUND_HP });
          F.mounds.push({ x: -x, z: -z, r0: r, hp: CFG.MOUND_HP });
        } else F.circles.push({ x: x, z: z, r: r, h: kind === "snowman" ? 1.85 : 6, kind: kind }, { x: -x, z: -z, r: r, h: kind === "snowman" ? 1.85 : 6, kind: kind });
        count--;
      }
    }
    // Forts first (walls), so nothing grows inside them.
    function fort(sign) {
      const z0 = sign * (HZ - 4.2), zf = sign * (HZ - 15);
      const lo = (a, b) => Math.min(a, b), hi = (a, b) => Math.max(a, b);
      // Every castle wall is crenellated: blocks along the top (CFG.MERLON), gaps between them.
      const box = (x0, x1, za, zb, h) => {
        const b = { x0: x0, x1: x1, z0: lo(za, zb), z1: hi(za, zb), h: h };
        b.ax = (b.x1 - b.x0) >= (b.z1 - b.z0) ? "x" : "z";
        return b;
      };
      const walls = [
        box(-14, 14, z0, z0 + sign * 0.9, 1.7),            // back wall
        box(-14, -13.2, z0, zf, 1.25), box(13.2, 14, z0, zf, 1.25),   // side walls
        box(-13.2, -7, zf - sign * 0.4, zf, 1.1), box(7, 13.2, zf - sign * 0.4, zf, 1.1)   // front barricades, gap between
      ];
      walls.forEach((w) => { F.boxes.push(w); });
      // Round towers at the four corners and either side of the gate.
      [[-14, z0], [14, z0], [-14, zf], [14, zf], [-7, zf], [7, zf]].forEach((t) => {
        F.circles.push({ x: t[0], z: t[1] - sign * 0.2, r: CFG.TOWER_R, h: CFG.TOWER_H, kind: "tower" });
      });
      F.forts.push({ sign: sign, zc: sign * (HZ - 9.5) });
    }
    fort(1); fort(-1);
    taken.push({ x: 0, z: HZ - 9, r: 17 }, { x: 0, z: -(HZ - 9), r: 17 });
    // Mounds: a few right on the middle, the rest scattered through the half.
    place(3, "mound", 0.9, 1.3, 5, 20, 2.2);
    place(9, "mound", 0.75, 1.4, 14, HZ - 20, 3.2);
    place(3, "snowman", 0.5, 0.6, 10, HZ - 22, 4);
    place(6, "tree", 0.4, 0.55, 8, HZ - 20, 5);
    // A ring of pines round the field edge (solid).
    for (let x = -HX + 1; x <= HX - 1; x += 5) { F.circles.push({ x: x, z: -HZ + 0.6, r: 0.5, h: 6, kind: "tree" }, { x: x, z: HZ - 0.6, r: 0.5, h: 6, kind: "tree" }); }
    for (let z = -HZ + 5; z <= HZ - 5; z += 5) { F.circles.push({ x: -HX + 0.6, z: z, r: 0.5, h: 6, kind: "tree" }, { x: HX - 0.6, z: z, r: 0.5, h: 6, kind: "tree" }); }
    return F;
  }

  // ------------------------------------------------------------------ the sim
  SB.createSim = function (opt) {
    opt = opt || {};
    const seed = opt.seed || ((Math.random() * 1e9) | 0);
    const rnd = rngFrom(seed ^ 0x9e3779b9);
    const F = buildField(seed);
    const sim = {
      cfg: CFG, field: F, mounds: F.mounds, circles: F.circles, boxes: F.boxes,
      players: [], balls: [], events: [], time: 0,
      teamSize: opt.teamSize || 4, winRounds: opt.winRounds || 3, difficulty: opt.difficulty == null ? 1 : opt.difficulty,
      humanId: opt.human === false ? -1 : 0, humanTeam: 0,
      phase: "menu", phaseT: 0, playT: 0, round: 0, score: [0, 0], winner: -1, roundWinner: -1, spectateId: -1
    };

    // --- geometry queries
    const moundR = (m) => m.r0 * (0.45 + 0.55 * (m.hp / CFG.MOUND_HP));
    const moundH = (m) => m.r0 * 0.95 * (0.45 + 0.55 * (m.hp / CFG.MOUND_HP));
    sim.moundR = moundR; sim.moundH = moundH;

    // Does a ball of radius br at (x,y,z) touch a solid thing? Returns {kind, ref} or null.
    function solidAt(x, y, z, br) {
      for (const c of F.circles) {
        if (y < c.h && (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < (c.r + br) * (c.r + br)) return { kind: "circle", ref: c };
      }
      for (const m of F.mounds) {
        if (m.hp <= 0) continue;
        const r = moundR(m);
        const dx = x - m.x, dz = z - m.z, d2 = dx * dx + dz * dz;
        if (d2 < (r + br) * (r + br)) {
          // Dome: height falls off towards the rim.
          const k = Math.sqrt(Math.max(0, 1 - d2 / ((r + br) * (r + br))));
          if (y < moundH(m) * (0.35 + 0.65 * k) + br) return { kind: "mound", ref: m };
        }
      }
      for (const b of F.boxes) {
        if (x > b.x0 - br && x < b.x1 + br && z > b.z0 - br && z < b.z1 + br) {
          if (y < b.h) return { kind: "box", ref: b };
          // The battlements: blocks along the top with open gaps between them.
          if (y < b.h + CFG.MERLON.h) {
            const u = (b.ax === "x" ? x - b.x0 : z - b.z0) / CFG.MERLON.pitch;
            if (u - Math.floor(u) < CFG.MERLON.w / CFG.MERLON.pitch) return { kind: "box", ref: b };
          }
        }
      }
      return null;
    }
    sim.solidAt = solidAt;

    function capsuleY(p) { return p.roll > 0 ? CFG.H_ROLL : CFG.H_STAND + (CFG.H_CROUCH - CFG.H_STAND) * p.crouch; }
    sim.heightOf = capsuleY;
    sim.eyeOf = (p) => (p.roll > 0 ? 0.7 : CFG.EYE_STAND + (CFG.EYE_CROUCH - CFG.EYE_STAND) * p.crouch);

    // First thing a ray meets (static stuff, ground, and optionally enemy bodies).
    // Returns {d, kind, player}. Marches in 0.25 m steps; fine for a snowball's scale.
    function ray(ox, oy, oz, dx, dy, dz, max, ignoreTeam) {
      const step = 0.25;
      for (let d = step; d <= max; d += step) {
        const x = ox + dx * d, y = oy + dy * d, z = oz + dz * d;
        if (y <= 0.05) return { d: d, kind: "ground" };
        if (Math.abs(x) > CFG.HX || Math.abs(z) > CFG.HZ) return { d: d, kind: "edge" };
        if (solidAt(x, y, z, 0.02)) return { d: d, kind: "solid" };
        if (ignoreTeam != null) {
          for (const p of sim.players) {
            if (!p.alive || p.team === ignoreTeam) continue;
            if (y > 0 && y < capsuleY(p) && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < CFG.R * CFG.R) return { d: d, kind: "player", player: p };
          }
        }
      }
      return { d: max, kind: "none" };
    }
    sim.ray = ray;
    // Clear line between two points (static blockers only)?
    function los(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
      if (L < 0.01) return true;
      const r = ray(ax, ay, az, dx / L, dy / L, dz / L, L - 0.2, null);
      return r.kind === "none";
    }
    sim.los = los;

    // --- players
    function makePlayer(id, team, human, name) {
      return { id: id, team: team, human: human, name: name, x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0, crouch: 0, crouchWant: false,
        alive: true, ammo: CFG.MAX_AMMO, charge: 0, fireDown: false, cd: 0, windT: 0, wind: null, packT: 0, roll: 0, rollCd: 0, rollDx: 0, rollDz: 0,
        sprint: false, moving: 0, hitT: 9, throwT: 9, outBy: -1, outAt: 0, kills: 0, score: 0,
        ai: { mode: "advance", cover: -1, modeT: 0, target: -1, react: 0, strafe: 1, strafeT: 0, thinkT: rnd() * 0.3, aimT: 0, stuck: 0, lastX: 0, lastZ: 0, dodgeT: 0, hold: 0 } };
    }
    function spawnAll() {
      sim.players.length = 0;
      let id = 0;
      const n = sim.teamSize;
      for (let team = 0; team < 2; team++) {
        for (let i = 0; i < n; i++) {
          const human = sim.humanId >= 0 && team === sim.humanTeam && i === 0;
          const nm = human ? (opt.name || "You") : NAMES[(id * 5 + 3) % NAMES.length];
          sim.players.push(makePlayer(id++, team, human, nm));
        }
      }
    }
    function resetRound() {
      sim.balls.length = 0;
      F.mounds.forEach((m) => { m.hp = CFG.MOUND_HP; });
      F.mounds = F.mounds.filter((m) => !m.built); sim.mounds = F.mounds;
      const n = sim.teamSize;
      sim.players.forEach((p) => {
        const idx = p.id % n, team = p.team, sign = team === 0 ? 1 : -1;
        p.x = (idx - (n - 1) / 2) * 5.5 + (rnd() - 0.5) * 1.2;
        p.z = sign * (CFG.HZ - 9) + (rnd() - 0.5);
        p.y = 0; p.vx = p.vz = 0;
        p.yaw = team === 0 ? 0 : Math.PI; p.pitch = 0;
        p.crouch = 0; p.crouchWant = false; p.alive = true; p.ammo = CFG.MAX_AMMO; p.charge = 0; p.fireDown = false;
        p.cd = 0; p.windT = 0; p.wind = null; p.packT = 0; p.roll = 0; p.rollCd = 0; p.hitT = 9; p.throwT = 9; p.outBy = -1;
        const a = p.ai;
        a.mode = "advance"; a.cover = -1; a.modeT = 0; a.target = -1; a.react = 0; a.thinkT = rnd() * 0.3; a.stuck = 0; a.dodgeT = 0; a.hold = 0;
      });
      sim.spectateId = -1;
    }
    sim.start = function () {
      sim.score = [0, 0]; sim.round = 0; sim.winner = -1; sim.time = 0;
      spawnAll();
      sim.nextRound();
    };
    sim.nextRound = function () {
      sim.round++;
      resetRound();
      sim.phase = "countdown"; sim.phaseT = CFG.COUNTDOWN; sim.roundWinner = -1; sim.playT = 0;
      sim.events.push({ t: "round", round: sim.round });
    };
    sim.human = () => sim.players.find((p) => p.human) || null;
    sim.alive = (team) => sim.players.filter((p) => p.team === team && p.alive).length;

    // --- throwing
    // Launch angle so the ball lands on (tx,ty,tz) at the given speed (low arc; 45 degrees if out of reach).
    function launch(fx, fy, fz, tx, ty, tz, v) {
      const dx = tx - fx, dz = tz - fz, d = Math.hypot(dx, dz) || 0.001, dy = ty - fy, g = CFG.G;
      const disc = v * v * v * v - g * (g * d * d + 2 * dy * v * v);
      const th = disc >= 0 ? Math.atan2(v * v - Math.sqrt(disc), g * d) : Math.PI / 4;
      return { vx: dx / d * Math.cos(th) * v, vy: Math.sin(th) * v, vz: dz / d * Math.cos(th) * v, th: th };
    }
    sim.launch = launch;
    function spawnBall(p, tx, ty, tz, v) {
      const ex = p.x, ez = p.z, ey = sim.eyeOf(p) - 0.12;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const sx = ex + fx * 0.55 + Math.cos(p.yaw) * 0.22, sz = ez + fz * 0.55 - Math.sin(p.yaw) * 0.22;
      const L = launch(sx, ey, sz, tx, ty, tz, v);
      sim.balls.push({ x: sx, y: ey, z: sz, vx: L.vx, vy: L.vy, vz: L.vz, team: p.team, by: p.id, age: 0, alive: true });
      p.ammo--; p.cd = CFG.THROW_CD;
      sim.events.push({ t: "throw", id: p.id, x: sx, y: ey, z: sz });
    }
    // The over-the-shoulder camera: behind and to the right of the player, pulled in when something is in the way.
    // The view draws from it and throws are aimed through its crosshair, so both use this one function.
    sim.cameraOf = function (p, out) {
      out = out || {};
      const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
      const fx = -Math.sin(p.yaw) * cp, fy = sp, fz = -Math.cos(p.yaw) * cp;
      const px = p.x + Math.cos(p.yaw) * CFG.CAM_SIDE, py = sim.eyeOf(p) + CFG.CAM_UP, pz = p.z - Math.sin(p.yaw) * CFG.CAM_SIDE;
      let dx = -fx * CFG.CAM_DIST, dy = -fy * CFG.CAM_DIST, dz = -fz * CFG.CAM_DIST, L = Math.hypot(dx, dy, dz), d = L;
      const r = ray(px, py, pz, dx / L, dy / L, dz / L, L, null);
      if (r.kind !== "none") d = Math.max(0.5, r.d - 0.3);
      out.x = px + dx / L * d; out.y = Math.max(0.25, py + dy / L * d); out.z = pz + dz / L * d;
      out.fx = fx; out.fy = fy; out.fz = fz; out.dist = d;
      return out;
    };
    // The human's throw: a wind-up (the throw animation plays), then the ball leaves the hand
    // aimed to arrive where the crosshair points.
    function humanThrow(p) {
      p.wind = { human: true, v: CFG.SPEED_MIN + (CFG.SPEED_MAX - CFG.SPEED_MIN) * p.charge };
      p.windT = CFG.WIND_HUMAN; p.throwT = 0; p.cd = CFG.THROW_CD + CFG.WIND_HUMAN;
    }
    function humanSpawn(p, v) {
      const c = sim.cameraOf(p, {});
      const r = ray(c.x, c.y, c.z, c.fx, c.fy, c.fz, 80, p.team);
      // Aimed at open sky or far scenery, the ball is thrown for 40 m instead of lobbing to the horizon;
      // never at something nearer than the player's own feet.
      const reach = r.kind === "none" || r.kind === "edge" ? Math.min(r.d, c.dist + 40) : r.d;
      const d = Math.max(reach, c.dist + 3);
      spawnBall(p, c.x + c.fx * d, c.y + c.fy * d, c.z + c.fz * d, v);
    }
    // A bot throws at a point (already with its aim error added).
    function botThrow(p, tx, ty, tz) {
      const d = Math.hypot(tx - p.x, tz - p.z);
      const v = clamp(16 + d * 0.55, CFG.SPEED_MIN, CFG.SPEED_MAX);
      p.wind = { tx: tx, ty: ty, tz: tz, v: v };
      p.windT = CFG.WIND_BOT; p.throwT = 0; p.cd = CFG.THROW_CD + CFG.WIND_BOT;
      p.yawAtWind = p.yaw;
    }

    function eliminate(p, by, x, y, z) {
      if (!p.alive) return;
      p.alive = false; p.outBy = by; p.outAt = sim.time; p.hitT = 0; p.charge = 0; p.fireDown = false; p.wind = null; p.windT = 0; p.roll = 0;
      const k = sim.players[by];
      if (k) { k.kills++; k.score += 100; }
      // Fall away from the shot: onto the back if they were facing the thrower.
      p.fall = k && (-Math.sin(p.yaw) * (k.x - p.x) - Math.cos(p.yaw) * (k.z - p.z)) < 0 ? "death_forward" : "death_back";
      sim.events.push({ t: "out", id: p.id, by: by, x: x, y: y, z: z });
    }

    // --- movement + collision for one player
    function collide(p) {
      const R = CFG.R;
      for (const c of F.circles) {
        if (c.h < 0.5) continue;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = R + c.r;
        if (d < min) { const k = d > 1e-4 ? (min - d) / d : 1; p.x += (d > 1e-4 ? dx : 1) * k; p.z += (d > 1e-4 ? dz : 0) * k; }
      }
      for (const m of F.mounds) {
        if (m.hp <= 0) continue;
        const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz), min = R + moundR(m) * 0.85;
        if (d < min) { const k = d > 1e-4 ? (min - d) / d : 1; p.x += (d > 1e-4 ? dx : 1) * k; p.z += (d > 1e-4 ? dz : 0) * k; }
      }
      for (const b of F.boxes) {
        const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < R) {
          if (d > 1e-4) { p.x = cx + dx / d * R; p.z = cz + dz / d * R; }
          else { // centre inside the box: push out the nearest side
            const l = p.x - b.x0, r = b.x1 - p.x, t = p.z - b.z0, bt = b.z1 - p.z, mn = Math.min(l, r, t, bt);
            if (mn === l) p.x = b.x0 - R; else if (mn === r) p.x = b.x1 + R; else if (mn === t) p.z = b.z0 - R; else p.z = b.z1 + R;
          }
        }
      }
      for (const o of sim.players) {
        if (o === p || !o.alive || !p.alive) continue;
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = R * 2;
        if (d < min && d > 1e-4) { const k = (min - d) / d * 0.5; p.x += dx * k; p.z += dz * k; o.x -= dx * k; o.z -= dz * k; }
      }
      p.x = clamp(p.x, -CFG.HX + R + 0.3, CFG.HX - R - 0.3);
      p.z = clamp(p.z, -CFG.HZ + R + 0.3, CFG.HZ - R - 0.3);
    }
    const onPond = (p) => Math.hypot(p.x - CFG.POND.x, p.z - CFG.POND.z) < CFG.POND.r;

    function move(p, dt, mx, mz, keep) {   // keep: a bot that already set its own velocity
      // mx: +1 strafes right, mz: +1 forward (in the player's own facing)
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const fx = -sy, fz = -cy, rx = cy, rz = -sy;
      let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      if (p.roll > 0) {
        p.roll -= dt;
        const k = Math.max(0, p.roll / CFG.ROLL_T);
        p.vx = p.rollDx * CFG.ROLL_SPEED * (0.35 + 0.65 * k); p.vz = p.rollDz * CFG.ROLL_SPEED * (0.35 + 0.65 * k);
        if (p.roll <= 0) { p.roll = 0; p.crouchWant = true; }
      } else if (!keep) {
        const crouched = p.crouch > 0.5;
        const top = crouched ? CFG.CROUCH : (p.sprint && mz > 0 && p.charge === 0 ? CFG.SPRINT : CFG.RUN);
        const tx = wx * top, tz = wz * top;
        const pond = onPond(p), acc = pond ? 2.2 : 28;
        const a = Math.min(1, acc * dt);
        p.vx += (tx - p.vx) * a; p.vz += (tz - p.vz) * a;
      }
      p.rollCd = Math.max(0, p.rollCd - dt);
      p.x += p.vx * dt; p.z += p.vz * dt;
      collide(p);
      p.moving = Math.hypot(p.vx, p.vz);
      p.crouch += ((p.crouchWant || p.roll > 0 ? 1 : 0) - p.crouch) * Math.min(1, 14 * dt);
    }
    function startRoll(p, mx, mz) {
      if (p.roll > 0 || p.rollCd > 0 || !p.alive) return false;
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;
      let l = Math.hypot(wx, wz);
      if (l < 0.1) { wx = -sy; wz = -cy; l = 1; }
      p.rollDx = wx / l; p.rollDz = wz / l; p.roll = CFG.ROLL_T; p.rollCd = CFG.ROLL_CD + CFG.ROLL_T; p.charge = 0; p.packT = 0;
      p.wind = null; p.windT = 0;
      sim.events.push({ t: "roll", id: p.id });
      return true;
    }
    sim.startRoll = startRoll;

    // --- the bots
    const diff = () => ({ react: [0.55, 0.38, 0.22][sim.difficulty] || 0.38, err: [0.4, 0.27, 0.16][sim.difficulty] || 0.27,
      dodge: [0.15, 0.35, 0.6][sim.difficulty] || 0.35, turn: [3.2, 4.4, 5.8][sim.difficulty] || 4.4,
      range: [24, 29, 34][sim.difficulty] || 29 });
    function enemiesOf(p) { return sim.players.filter((o) => o.team !== p.team && o.alive); }
    function seeing(p, o) {
      const ex = sim.eyeOf(p), tx = o.x, tz = o.z;
      const d = Math.hypot(tx - p.x, tz - p.z);
      if (d > 46) return false;
      const ang = Math.abs(wrap(Math.atan2(-(tx - p.x), -(tz - p.z)) - p.yaw));
      if (ang > 1.25 && d > 5) return false;
      return los(p.x, ex, p.z, tx, Math.max(0.5, capsuleY(o) * 0.7), tz);
    }
    function pickCover(p) {
      // The mound that gets us closer to the enemy fort without being wide open.
      const dir = p.team === 0 ? -1 : 1;
      let best = -1, bestS = -1e9;
      F.mounds.forEach((m, i) => {
        if (m.hp <= 1) return;
        const ahead = (m.z - p.z) * dir;
        if (ahead < 3 || ahead > 26) return;
        const taken = sim.players.some((o) => o !== p && o.alive && o.team === p.team && o.ai.cover === i);
        if (taken) return;
        const s = -Math.abs(ahead - 13) * 0.6 - Math.hypot(m.x - p.x, 0) * 0.15 + rnd() * 3 + m.r0;
        if (s > bestS) { bestS = s; best = i; }
      });
      return best;
    }
    function coverSpot(p, m) {
      // Behind the mound as seen from the enemy side: towards our own fort.
      const dir = p.team === 0 ? 1 : -1;
      return { x: m.x + 0.25 * (p.id % 3 - 1), z: m.z + dir * (moundR(m) + 0.55) };
    }
    const blockedAt = (x, z) => Math.abs(x) > CFG.HX - 1 || Math.abs(z) > CFG.HZ - 1 || !!solidAt(x, 0.5, z, 0.45);
    function steer(p, gx, gz, dt, speedScale, mode) {
      // Walk towards (gx,gz), feeling ahead for things in the way and bending round them.
      const a = p.ai;
      const sign = p.team === 0 ? 1 : -1, zf = CFG.HZ - 15;
      // Inside the fort pen with the goal outside it: out through the gap first.
      if (p.z * sign > zf + 0.6 && Math.abs(p.x) < 14.5 && gz * sign < zf - 0.5) { gx = clamp(p.x, -3, 3) * 0.2; gz = sign * (zf - 1.8); }
      const dx = gx - p.x, dz = gz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { p.vx *= 0.6; p.vz *= 0.6; return true; }
      const want = Math.atan2(-dx, -dz);
      a.moveYaw = want;
      let ang = want;
      const look = Math.min(1.7, d);
      const devs = [a.dev || 0, 0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
      if (a.strafe < 0) { devs[2] = -0.5; devs[3] = 0.5; devs[4] = -1.0; devs[5] = 1.0; devs[6] = -1.6; devs[7] = 1.6; }
      for (const dev of devs) {
        if (!blockedAt(p.x - Math.sin(want + dev) * look, p.z - Math.cos(want + dev) * look)) { ang = want + dev; a.dev = dev * 0.8; break; }
      }
      if (Math.hypot(p.x - a.lastX, p.z - a.lastZ) < 0.35 * dt * 4) a.stuck += dt; else a.stuck = 0;
      a.lastX = p.x; a.lastZ = p.z;
      if (a.stuck > 1.2) ang += a.strafe * 1.4;
      const speed = p.crouch > 0.5 ? CFG.CROUCH : (mode === "sprint" ? CFG.SPRINT : CFG.RUN) * speedScale;
      const tx = -Math.sin(ang) * speed, tz = -Math.cos(ang) * speed;
      const k = Math.min(1, 12 * dt);
      p.vx += (tx - p.vx) * k; p.vz += (tz - p.vz) * k;
      return false;
    }
    function botStep(p, dt) {
      const a = p.ai, D = diff();
      a.modeT += dt; a.thinkT -= dt; a.strafeT -= dt; a.dodgeT -= dt;
      p.sprint = false;
      if (p.roll > 0) { move(p, dt, 0, 0); return; }
      // Incoming snowball? Duck or roll.
      if (a.dodgeT <= 0) {
        for (const b of sim.balls) {
          if (!b.alive || b.team === p.team) continue;
          const dx = p.x - b.x, dz = p.z - b.z, dy = 1.1 - b.y;
          const vv = b.vx * b.vx + b.vz * b.vz + b.vy * b.vy;
          const t = (dx * b.vx + dz * b.vz + dy * b.vy) / vv;
          if (t < 0.05 || t > 0.55) continue;
          const cx = b.x + b.vx * t - p.x, cz = b.z + b.vz * t - p.z, cy = b.y + b.vy * t - 0.9 * 1.1;
          if (Math.hypot(cx, cz) < 0.9 && Math.abs(cy) < 1.3) {
            a.dodgeT = 1.4;
            if (rnd() < D.dodge) {
              if (rnd() < 0.55 && p.rollCd <= 0) startRoll(p, rnd() < 0.5 ? 1 : -1, 0);
              else { a.strafe = -a.strafe; a.strafeT = 0.5; p.crouchWant = true; a.hold = 0.8; }
            }
            break;
          }
        }
      }
      if (p.roll > 0) return;
      // Think: pick a target and a mode.
      let tgt = a.target >= 0 ? sim.players[a.target] : null;
      if (a.thinkT <= 0) {
        a.thinkT = 0.18 + rnd() * 0.1;
        if (tgt && (!tgt.alive || !seeing(p, tgt))) { a.lostT = (a.lostT || 0) + 0.25; if (!tgt.alive || a.lostT > 1.2) { a.target = -1; tgt = null; a.lostT = 0; } } else a.lostT = 0;
        if (!tgt || rnd() < 0.2) {
          let best = null, bd = 1e9;
          for (const o of enemiesOf(p)) {
            const d = Math.hypot(o.x - p.x, o.z - p.z);
            if (d < bd && seeing(p, o)) { bd = d; best = o; }
          }
          if (best && (!tgt || best.id !== tgt.id)) { a.target = best.id; a.react = D.react * (0.7 + rnd() * 0.7); tgt = best; }
        }
      }
      const visible = tgt && tgt.alive && seeing(p, tgt);
      const empty = p.ammo <= 0;
      // Mode logic
      if (empty && a.mode !== "pack") { a.mode = "pack"; a.modeT = 0; p.crouchWant = true; }
      if (a.mode === "pack") {
        p.crouchWant = true;
        const slow = p.moving < 0.6;
        if (a.cover >= 0 && F.mounds[a.cover] && F.mounds[a.cover].hp > 0) {
          const s = coverSpot(p, F.mounds[a.cover]);
          steer(p, s.x, s.z, dt, 0.8);
        } else { p.vx *= 0.8; p.vz *= 0.8; }
        if (slow) p.packT += dt; else p.packT = Math.max(0, p.packT - dt);
        if (p.packT >= CFG.PACK_T) { p.ammo = CFG.MAX_AMMO; p.packT = 0; a.mode = "advance"; a.cover = -1; a.modeT = 0; sim.events.push({ t: "pack", id: p.id }); }
        faceTarget(p, visible ? tgt : null, dt, D);
        move(p, dt, 0, 0, true);
        return;
      }
      p.packT = 0;
      if (a.mode === "advance") {
        p.crouchWant = false;
        const rush = sim.playT > 40;   // a slow round: stop hopping between mounds, go and find them
        if (a.cover < 0 || !F.mounds[a.cover] || F.mounds[a.cover].hp <= 1) a.cover = rush ? -1 : pickCover(p);
        if (rush && !visible) {
          let near = null, nd = 1e9;
          for (const o of enemiesOf(p)) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < nd) { nd = d; near = o; } }
          if (near) { p.sprint = true; steer(p, near.x, near.z, dt, 1, "sprint"); }
        } else if (a.cover >= 0) {
          const s = coverSpot(p, F.mounds[a.cover]);
          p.sprint = true;
          const arrived = steer(p, s.x, s.z, dt, 1, "sprint");
          if (arrived || Math.hypot(s.x - p.x, s.z - p.z) < 0.8) { a.mode = "cover"; a.modeT = 0; a.hold = (0.5 + rnd() * 1.5) * (sim.playT > 60 ? 0.2 : 1); }
        } else {
          const dir = p.team === 0 ? -1 : 1;
          steer(p, p.x + (rnd() - 0.5) * 6, p.z + dir * 8, dt, 1);
        }
        // Throw on the move if we've a clear shot.
        if (visible && a.react <= 0) fireAt(p, tgt, D);
        a.react -= dt;
        if (visible) faceTarget(p, tgt, dt, D); else if (a.moveYaw !== undefined) p.yaw += clamp(wrap(a.moveYaw - p.yaw), -D.turn * dt, D.turn * dt);
        if (a.modeT > 14) { a.cover = -1; a.modeT = 0; }
      } else if (a.mode === "cover") {
        // Crouch behind it, then pop up and throw.
        a.hold -= dt;
        const m = F.mounds[a.cover];
        if (!m || m.hp <= 0) { a.mode = "advance"; a.cover = -1; a.modeT = 0; }
        else {
          const s = coverSpot(p, m);
          steer(p, s.x, s.z, dt, 0.5);
          const peek = a.modeT % 3.2 > 1.5;
          p.crouchWant = !(peek || (visible && a.react <= 0));
          if (visible) { a.react -= dt; faceTarget(p, tgt, dt, D); if (a.react <= 0 && p.crouch < 0.35) fireAt(p, tgt, D); }
          else p.yaw += clamp(wrap((p.team === 0 ? 0 : Math.PI) - p.yaw), -D.turn * 0.5 * dt, D.turn * 0.5 * dt);
          if (a.hold <= 0 && !visible) { a.mode = "advance"; a.cover = rnd() < 0.5 ? -1 : a.cover; a.modeT = 0; if (a.cover >= 0) a.cover = -1; }
          if (a.modeT > 9 && rnd() < 0.01) { a.mode = "advance"; a.cover = -1; a.modeT = 0; }
        }
      }
      if (a.strafeT <= 0) { a.strafeT = 0.8 + rnd() * 1.4; a.strafe = rnd() < 0.5 ? 1 : -1; }
      move(p, dt, 0, 0, true);
    }
    function faceTarget(p, tgt, dt, D) {
      if (!tgt) return;
      const want = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z));
      p.yaw += clamp(wrap(want - p.yaw), -D.turn * dt, D.turn * dt);
      const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
      p.pitch = clamp(Math.atan2(1.0 - sim.eyeOf(p), d), -0.5, 0.5);
    }
    function fireAt(p, tgt, D) {
      if (p.cd > 0 || p.ammo <= 0 || p.wind) return;
      const want = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z));
      if (Math.abs(wrap(want - p.yaw)) > 0.2) return;
      const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
      if (d > D.range) return;
      // Lead the target by the flight time, then miss by an amount that grows with range.
      const v = clamp(16 + d * 0.55, CFG.SPEED_MIN, CFG.SPEED_MAX), t = d / (v * 0.92);
      const sig = (D.err + d * 0.022) * (tgt.moving > 1 ? 1.35 : 1);
      const g = () => (rnd() + rnd() + rnd() - 1.5) * 1.15 * sig;
      const lead = tgt.roll > 0 ? 0.6 : 0.85;
      botThrow(p, tgt.x + tgt.vx * t * lead + g(), 0.2 + capsuleY(tgt) * 0.62 + g() * 0.6, tgt.z + tgt.vz * t * lead + g());
    }

    // --- the step
    sim.step = function (dt, inp) {
      dt = Math.min(dt, 0.05);
      sim.time += dt;
      sim.phaseT -= dt;
      const hum = sim.human();
      if (sim.phase === "countdown") {
        if (sim.phaseT <= 0) { sim.phase = "play"; sim.phaseT = 0; sim.events.push({ t: "go" }); }
        else {
          // Frozen on the line, but the human can still look round.
          if (hum && inp) { hum.yaw = inp.yaw; hum.pitch = inp.pitch; }
          return;
        }
      }
      if (sim.phase === "roundover") {
        if (sim.phaseT <= 0) { if (sim.winner >= 0) { sim.phase = "matchover"; sim.phaseT = 1e9; } else sim.nextRound(); }
      }
      if (sim.phase === "menu" || sim.phase === "matchover") return;

      // players
      for (const p of sim.players) {
        p.cd = Math.max(0, p.cd - dt); p.hitT += dt; p.throwT += dt;
        if (!p.alive) continue;
        if (p.human) {
          if (inp) {
            p.yaw = inp.yaw; p.pitch = clamp(inp.pitch, -1.15, 0.6);
            p.sprint = !!inp.sprint;
            if (inp.crouchEdge) p.crouchWant = !p.crouchWant;
            if (inp.crouch != null) p.crouchWant = !!inp.crouch;
            if (inp.roll) startRoll(p, inp.mx || 0, inp.mz || 0);
            // pack
            if (inp.pack && p.roll <= 0 && p.ammo < CFG.MAX_AMMO && p.moving < 1.2) { p.packT += dt; if (p.packT >= CFG.PACK_T) { p.ammo = CFG.MAX_AMMO; p.packT = 0; sim.events.push({ t: "pack", id: p.id }); } }
            else p.packT = 0;
            // charge + throw
            if (inp.fire && p.roll <= 0 && p.packT === 0) {
              if (p.ammo > 0) { p.charge = Math.min(1, p.charge + dt / CFG.CHARGE_T); p.fireDown = true; }
              else if (!p.fireDown) { p.fireDown = true; sim.events.push({ t: "empty", id: p.id }); }
            } else {
              if (p.fireDown && p.charge > 0 && p.cd <= 0 && p.ammo > 0 && p.roll <= 0) humanThrow(p);
              p.charge = 0; p.fireDown = !!inp.fire && p.fireDown;
              if (!inp.fire) p.fireDown = false;
            }
            if (inp.build) sim.build(p);
          }
          move(p, dt, inp ? inp.mx || 0 : 0, inp ? inp.mz || 0 : 0);
        } else botStep(p, dt);
        if (p.wind) {
          p.windT -= dt;
          if (p.windT <= 0) {
            const w = p.wind; p.wind = null;
            if (p.alive && p.ammo > 0) { if (w.human) humanSpawn(p, w.v); else spawnBall(p, w.tx, w.ty, w.tz, w.v); }
          }
        }
      }
      stepBalls(dt);

      if (sim.phase === "play") {
        sim.playT += dt;
        const a0 = sim.alive(0), a1 = sim.alive(1);
        // A round nobody can finish is a draw.
        if (sim.playT > 120 && a0 > 0 && a1 > 0) sim.drawn = true;
        if (a0 === 0 || a1 === 0 || sim.drawn) {
          sim.drawn = false;
          sim.roundWinner = (a0 === 0 && a1 === 0) || (a0 > 0 && a1 > 0) ? -2 : a0 === 0 ? 1 : 0;
          if (sim.roundWinner >= 0) sim.score[sim.roundWinner]++;
          sim.winner = sim.score[0] >= sim.winRounds ? 0 : sim.score[1] >= sim.winRounds ? 1 : -1;
          sim.phase = "roundover"; sim.phaseT = CFG.OVER_T;
          sim.events.push({ t: "roundover", winner: sim.roundWinner, match: sim.winner });
        }
      }
    };

    function stepBalls(dt) {
      const n = Math.ceil(dt / (1 / 120)), h = dt / n;
      for (const b of sim.balls) {
        if (!b.alive) continue;
        for (let s = 0; s < n && b.alive; s++) {
          b.vy -= CFG.G * h; b.age += h;
          b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
          if (b.age > 5 || Math.abs(b.x) > CFG.HX + 12 || Math.abs(b.z) > CFG.HZ + 12) { b.alive = false; break; }
          // Enemy bodies first (a ball is in the player's capsule: radius R, height by pose).
          for (const p of sim.players) {
            if (!p.alive || p.team === b.team) continue;
            const dx = b.x - p.x, dz = b.z - p.z, rr = CFG.R + CFG.BALL_R;
            if (dx * dx + dz * dz < rr * rr && b.y > 0 && b.y < capsuleY(p) + CFG.BALL_R) {
              b.alive = false;
              sim.events.push({ t: "splat", x: b.x, y: b.y, z: b.z, n: 9, on: "player" });
              if (sim.phase === "play") eliminate(p, b.by, b.x, b.y, b.z);
              break;
            }
          }
          if (!b.alive) break;
          const hit = solidAt(b.x, b.y, b.z, CFG.BALL_R);
          if (hit) {
            b.alive = false;
            if (hit.kind === "mound") {
              hit.ref.hp--;
              sim.events.push({ t: "moundhit", i: F.mounds.indexOf(hit.ref), x: b.x, y: b.y, z: b.z, gone: hit.ref.hp <= 0 });
            }
            sim.events.push({ t: "splat", x: b.x, y: b.y, z: b.z, n: hit.kind === "mound" ? 7 : 5, on: hit.kind });
            break;
          }
          if (b.y < CFG.BALL_R) { b.alive = false; sim.events.push({ t: "splat", x: b.x, y: 0.05, z: b.z, n: 4, on: "ground" }); break; }
        }
      }
      for (let i = sim.balls.length - 1; i >= 0; i--) if (!sim.balls[i].alive) sim.balls.splice(i, 1);
    }

    // Pack a mound in front of you (costs 4 snowballs' worth of snow).
    sim.build = function (p) {
      if (!p.alive || p.ammo < 4 || p.roll > 0 || sim.phase !== "play") return false;
      const x = p.x - Math.sin(p.yaw) * 1.7, z = p.z - Math.cos(p.yaw) * 1.7, r = 0.95;
      if (Math.abs(x) > CFG.HX - 3 || Math.abs(z) > CFG.HZ - 3) return false;
      for (const m of F.mounds) if (m.hp > 0 && Math.hypot(m.x - x, m.z - z) < moundR(m) + r) return false;
      for (const c of F.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false;
      for (const b of F.boxes) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false;
      for (const o of sim.players) if (o.alive && Math.hypot(o.x - x, o.z - z) < r + CFG.R) return false;
      F.mounds.push({ x: x, z: z, r0: r, hp: 4, built: true });
      p.ammo -= 4;
      sim.events.push({ t: "built", i: F.mounds.length - 1, x: x, z: z });
      return true;
    };

    sim.takeEvents = function () { const e = sim.events; sim.events = []; return e; };
    return sim;
  };
})(globalThis.SB);
