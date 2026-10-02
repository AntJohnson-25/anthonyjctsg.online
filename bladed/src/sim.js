// The match: players, movement, knife combat, scoring, spawns and bot AI.
// Pure logic, no three.js, so tools/check.js can run whole bot matches in Node.
//
// Combat rules (knives only):
//  - Melee is always available and kills in one hit. Pressing it near an
//    enemy you are facing (within ~3.4 m) LUNGES at them; otherwise it's a
//    short slash.
//  - Each life starts with 2 throwing knives. A thrown knife flies on an arc,
//    kills in one hit, and then lies where it landed (or sticks in the wall
//    it hit) until anyone walks over it to pick it back up. Max 2 carried.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const U = HK.U;

  const C = {
    gravity: 20, jumpV: 6.4, walk: 5.4, sprint: 7.9, backMul: 0.78, waterMul: 0.6,
    accelGround: 14, accelAir: 2.5,
    radius: 0.35, height: 1.8, eye: 1.62,
    lungeRange: 3.4, lungeCone: 0.6, lungeTime: 0.2, lungeSpeed: 15, lungeHit: 1.2,
    swingRange: 1.8, swingCone: 0.85, swingTime: 0.34, swingHitAt: 0.09, meleeCd: 0.55,
    throwWind: 0.1, throwTime: 0.32, throwCd: 0.7, throwSpeed: 34, knifeGravity: 6, maxKnives: 2,
    smartCone: 0.26,   // one-button attack throws at an enemy within ~15 deg of where you face
    // Kill streak reward: every 5 kills without dying calls a Rogue Wave. A horn,
    // then it hits from starboard: the caller's enemies stagger and slide to port
    // (toward the pirate boat and the open sea); go overboard and it's their kill.
    // waveLift peaks ~0.96 m: over the boat's 0.5 m gunwale, never the yacht's 1.1 m rails.
    waveStreak: 5, waveWarn: 1.6, waveDur: 2.4, stagger: 1.3, wavePush: 10, waveLift: 6.2,
    pickupR: 1.45, respawn: 3.5, knifeLife: 60, prematch: 3, maxLoose: 30
  };
  HK.CFG = C;

  const DIFF = {
    recruit:  { react: 0.85, turn: 3.0, err: 0.14,  throwRate: 0.30, lunge: 2.5,  strafe: 0.15, hear: 8,  hunt: 0.2,  fov: 1.0 },
    regular:  { react: 0.55, turn: 4.6, err: 0.09,  throwRate: 0.55, lunge: 2.9,  strafe: 0.4,  hear: 11, hunt: 0.3,  fov: 1.15 },
    hardened: { react: 0.35, turn: 6.5, err: 0.06,  throwRate: 0.8,  lunge: 3.15, strafe: 0.65, hear: 14, hunt: 0.4,  fov: 1.25 },
    veteran:  { react: 0.22, turn: 9.0, err: 0.035, throwRate: 1.05, lunge: 3.3,  strafe: 0.85, hear: 17, hunt: 0.5,  fov: 1.35 }
  };
  HK.DIFF = DIFF;

  const NAMES_A = ["Reyes", "Okafor", "Lindqvist", "Brennan", "Tanaka", "Duarte", "Petrov"];
  const NAMES_B = ["Viktor", "Draven", "Mako", "Sable", "Kruger", "Vex", "Ortega", "Rook"];

  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15; }
  function dirFrom(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: Math.cos(yaw) * cp, y: Math.sin(pitch), z: Math.sin(yaw) * cp };
  }

  function createSim(o) {
    const S = {
      C: C, mode: o.mode || "tdm", diffName: o.difficulty || "regular", D: DIFF[o.difficulty || "regular"],
      W: o.world, nav: o.nav, map: o.map,
      t: 0, timeLimit: o.timeLimit || 600, timeLeft: o.timeLimit || 600,
      scoreLimit: o.scoreLimit || ((o.mode || "tdm") === "tdm" ? 75 : 30),
      teamScore: [0, 0], players: [], knives: [], events: [], over: false, winner: null,
      phase: "pre", preT: o.prematch !== undefined ? o.prematch : C.prematch, firstBlood: false,
      nextKnife: 1, humanId: -1,
      input: { mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false, melee: false, throw: false, attack: false, assist: 0.06 },
      stats: { throws: 0, throwKills: 0, meleeKills: 0, lunges: 0, swings: 0, pickups: 0, splashes: 0, fell: 0 }
    };

    const human = o.human !== false;
    const namesA = U.shuffle(NAMES_A.slice()), namesB = U.shuffle(NAMES_B.slice());
    function add(name, team, bot) {
      const p = makePlayer(S.players.length, name, team, bot);
      S.players.push(p);
      return p;
    }
    if (S.mode === "tdm") {
      if (human) S.humanId = add(o.humanName || "You", 0, false).id;
      while (S.players.length < 4) add(namesA.pop(), 0, true);
      for (let i = 0; i < 4; i++) add(namesB.pop(), 1, true);
    } else {
      const pool = U.shuffle(namesA.concat(namesB));
      if (human) S.humanId = add(o.humanName || "You", 0, false).id;
      while (S.players.length < 8) add(pool.pop(), S.players.length, true);
    }
    if (S.humanId >= 0) S.players[S.humanId].bot = false;

    // Opening spawns: TDM teams start on their own end, FFA spread out.
    const used = new Set();
    S.players.forEach(function (p) {
      let list;
      if (S.mode === "tdm") list = S.map.spawns.filter(function (s) { return s.side === p.team; });
      else list = S.map.spawns.slice();
      list = U.shuffle(list.slice()).filter(function (s) { return !used.has(s); });
      const s = list[0];
      used.add(s);
      placeAt(S, p, s);
    });
    if (S.humanId >= 0) {
      const h = S.players[S.humanId];
      S.input.yaw = h.yaw; S.input.pitch = 0;
    }

    S.step = function (dt) { step(S, dt); };
    S.isEnemy = function (a, b) { return isEnemy(S, a, b); };
    return S;
  }

  function makePlayer(id, name, team, bot) {
    return {
      id: id, name: name, team: team, bot: bot, alive: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: C.radius, h: C.height, onGround: true,
      yaw: 0, pitch: 0, knives: C.maxKnives, meleeCd: 0, throwCd: 0,
      state: "idle", stateT: 0, lungeTarget: -1, throwDir: null, swingDone: false, thrown: false,
      kills: 0, deaths: 0, score: 0, streak: 0, bestStreak: 0, lastKillT: -99, multi: 0, lastKiller: -1,
      respawnT: 0, recycled: 0, killedBy: -1, deathT: 0, stabT: -9,
      wishX: 0, wishZ: 0, wantSprint: false, wantJump: false, sprinting: false, inWater: false,
      noiseT: -99, attackT: -99, spawnT: 0, airT: 0,
      ai: bot ? newAI() : null
    };
  }

  function newAI() {
    return {
      thinkT: Math.random() * 0.1, target: -1, visible: false, react: 0, lostT: -9, lastSeen: null,
      direct: false, path: null, pi: 0, repathT: 0, pathGoal: null, goal: null, goalT: 0, skipT: 0,
      strafeT: 0, strafeDir: 1, stuckT: 0, chkX: 0, chkZ: 0, unstuck: 0, unstuckYaw: 0,
      throwing: false, throwT: 0,
      waitT: 0, lookYaw: 0,
      pers: { throwy: Math.random(), hunt: 0.6 + Math.random() * 0.8 }
    };
  }

  function emit(S, e) { e.t = S.t; S.events.push(e); }
  function isEnemy(S, a, b) { return a !== b && (S.mode === "ffa" || a.team !== b.team); }

  function placeAt(S, p, s) {
    p.x = s.x; p.y = s.y; p.z = s.z; p.vx = p.vy = p.vz = 0;
    p.yaw = s.yaw; p.pitch = 0; p.alive = true; p.knives = C.maxKnives; p.state = "idle"; p.stateT = 0;
    p.onGround = true; p.spawnT = 0; p.recycled = 0; p.meleeCd = 0.3; p.throwCd = 0.3; p.inWater = false;
    p.staggerT = 0; p.waveBy = -1;
    if (p.ai) {
      const pers = p.ai.pers;
      p.ai = newAI();
      p.ai.pers = pers;
      p.ai.chkX = p.x; p.ai.chkZ = p.z;
    }
    if (S.humanId === p.id) { S.input.yaw = p.yaw; S.input.pitch = 0; }
  }

  // ------------------------------------------------------------------ spawning
  function chooseSpawn(S, p) {
    let best = null, bs = -1e9;
    S.map.spawns.forEach(function (s) {
      let minE = 99, seen = false, mates = 0, blocked = false;
      S.players.forEach(function (e) {
        if (!e.alive || e === p) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z);
        if (d < 1.2) blocked = true;
        if (isEnemy(S, p, e)) {
          if (d < minE) minE = d;
          if (d < 40 && S.W.los(e.x, e.y + C.eye, e.z, s.x, s.y + 1.4, s.z)) seen = true;
        } else if (d < 15) mates++;
      });
      if (blocked) return;
      let sc = Math.min(minE, 28) + Math.random() * 5;
      if (minE < 7) sc -= 60;
      if (seen) sc -= 25;
      if (S.mode === "tdm") {
        sc += Math.min(mates, 2) * 2;
        if (s.side === p.team) sc += 5;
        else if (s.side >= 0) sc -= 4;
      }
      if (sc > bs) { bs = sc; best = s; }
    });
    return best || S.map.spawns[0];
  }

  function spawn(S, p) {
    placeAt(S, p, chooseSpawn(S, p));
    emit(S, { type: "spawn", p: p.id });
  }

  // ------------------------------------------------------------------ the step
  function step(S, dt) {
    if (S.over) return;
    S.t += dt;
    if (S.phase === "pre") {
      S.preT -= dt;
      if (S.preT <= 0) { S.phase = "live"; emit(S, { type: "go" }); }
    } else {
      S.timeLeft -= dt;
      if (S.timeLeft <= 0) { S.timeLeft = 0; endMatch(S); return; }
    }
    if (S.wave) updateWave(S, dt);
    for (let i = 0; i < S.players.length; i++) updatePlayer(S, S.players[i], dt);
    separate(S);
    updateKnives(S, dt);
    pickups(S);
  }

  // The Rogue Wave: warning, then one hit that staggers the caller's enemies.
  function updateWave(S, dt) {
    const w = S.wave;
    w.t += dt;
    if (!w.hit && w.t >= C.waveWarn) {
      w.hit = true;
      const owner = S.players[w.owner];
      let n = 0;
      S.players.forEach(function (p) {
        if (!p.alive || !owner || !isEnemy(S, owner, p)) return;
        p.staggerT = C.stagger;
        p.state = "idle"; p.stateT = 0;
        p.vz -= C.wavePush * (0.85 + Math.random() * 0.3);
        p.vx += (Math.random() - 0.5) * 2;
        if (p.onGround) { p.vy = C.waveLift; p.onGround = false; }
        p.waveBy = w.owner; p.waveT = S.t;
        n++;
      });
      S.stats.waves = (S.stats.waves || 0) + 1;
      S.stats.waveHits = (S.stats.waveHits || 0) + n;
      emit(S, { type: "wavehit", p: w.owner, n: n });
    }
    if (w.t >= C.waveWarn + C.waveDur) S.wave = null;
  }

  function updatePlayer(S, p, dt) {
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0 && !S.over) spawn(S, p);
      return;
    }
    p.meleeCd -= dt; p.throwCd -= dt; p.spawnT += dt;
    if (p.staggerT > 0) {
      // Knocked off your feet by a Rogue Wave: no control, you slide.
      p.staggerT -= dt;
      p.wishX = 0; p.wishZ = 0; p.wantJump = false; p.wantSprint = false;
      if (!p.bot) { const I = S.input; I.melee = I.throw = I.attack = I.jump = false; p.yaw = I.yaw; p.pitch = I.pitch; }
    } else if (p.bot) botThink(S, p, dt);
    else humanInput(S, p);
    if (S.phase !== "live") { p.wishX = 0; p.wishZ = 0; p.wantJump = false; }

    if (p.state === "lunge") { updateLunge(S, p, dt); }
    else {
      if (p.state === "swing") {
        p.stateT += dt;
        if (!p.swingDone && p.stateT >= C.swingHitAt) { p.swingDone = true; swingHit(S, p); }
        if (p.stateT >= C.swingTime) p.state = "idle";
      } else if (p.state === "throw") {
        p.stateT += dt;
        if (!p.thrown && p.stateT >= C.throwWind) { p.thrown = true; releaseKnife(S, p); }
        if (p.stateT >= C.throwTime) p.state = "idle";
      }
      locomotion(S, p, dt);
    }
    // Water (pool, hot tub) slows you down.
    p.inWater = false;
    for (let i = 0; i < S.map.water.length; i++) {
      const w = S.map.water[i];
      if (p.x > w.x0 && p.x < w.x1 && p.z > w.z0 && p.z < w.z1 && p.y < w.y - 0.1 && p.y > w.y - 1.5) p.inWater = true;
    }
    if (p.y < -6) {
      S.stats.fell++;
      // Washed overboard by someone's Rogue Wave: their kill.
      const by = p.waveBy >= 0 && S.t - p.waveT < 5 ? S.players[p.waveBy] : null;
      if (by) S.stats.waveKills = (S.stats.waveKills || 0) + 1;
      kill(S, by, p, by ? "wave" : "fall");
    }
  }

  function humanInput(S, p) {
    const I = S.input;
    p.yaw = I.yaw; p.pitch = I.pitch;
    let mx = I.mx, mz = I.mz;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    p.wishX = fx * mz - fz * mx;
    p.wishZ = fz * mz + fx * mx;
    p.wantSprint = I.sprint && mz > 0.5;
    if (I.jump) { p.wantJump = true; I.jump = false; }
    if (S.phase !== "live") { I.melee = false; I.throw = false; I.attack = false; return; }
    if (I.attack) { I.attack = false; smartAttack(S, p, Math.max(I.assist, C.smartCone)); }
    if (I.melee) { I.melee = false; tryMelee(S, p); }
    if (I.throw) {
      I.throw = false;
      tryThrow(S, p, assistedAim(S, p, I.assist));
    }
  }

  // One-button attack (keyboard Enter/Space): knife anyone in reach, else throw
  // at the enemy you're facing, else slash. Never throws a knife at nothing.
  function smartAttack(S, p, cone) {
    if (findLungeTarget(S, p, C.lungeRange) || swingTarget(S, p)) return tryMelee(S, p);
    if (p.knives > 0 && aimTarget(S, p, cone)) return tryThrow(S, p, assistedAim(S, p, cone));
    return tryMelee(S, p);
  }

  // Throw aim assist for the human: if an enemy is close to the crosshair,
  // correct for drop and lead. Off-target throws fly exactly where you aim.
  function assistedAim(S, p, cone) {
    const d = dirFrom(p.yaw, p.pitch);
    const best = cone ? aimTarget(S, p, cone) : null;
    if (!best) return d;
    const ex = p.x, ey = p.y + C.eye, ez = p.z;
    const sol = ballistic(ex, ey - 0.08, ez, best.x, best.y + 1.25, best.z, best.vx, best.vz);
    return dirFrom(sol.yaw, sol.pitch);
  }

  // The enemy nearest the crosshair within `cone` radians (in sight, < 40 m).
  function aimTarget(S, p, cone) {
    const d = dirFrom(p.yaw, p.pitch);
    const ex = p.x, ey = p.y + C.eye, ez = p.z;
    let best = null, ba = cone;
    S.players.forEach(function (e) {
      if (!e.alive || !isEnemy(S, p, e)) return;
      const tx = e.x - ex, ty = e.y + 1.3 - ey, tz = e.z - ez, tl = Math.hypot(tx, ty, tz);
      if (tl > 40 || tl < 1) return;
      const a = S.input.flat ?
        (Math.abs(ty) < 4.5 ? Math.abs(U.wrap(Math.atan2(tz, tx) - p.yaw)) : 9) :
        Math.acos(U.clamp((tx * d.x + ty * d.y + tz * d.z) / tl, -1, 1));
      // Wider cone up close: a 6-degree cone is only ~1 m wide at 10 m.
      if (a < ba && S.W.los(ex, ey, ez, e.x, e.y + 1.3, e.z)) { ba = a; best = e; }
    });
    return best;
  }

  function ballistic(sx, sy, sz, tx, ty, tz, tvx, tvz) {
    let ax = tx, az = tz;
    for (let i = 0; i < 2; i++) {
      const R0 = Math.hypot(ax - sx, az - sz), tf = R0 / C.throwSpeed;
      ax = tx + tvx * tf; az = tz + tvz * tf;
    }
    const R = Math.max(0.1, Math.hypot(ax - sx, az - sz)), h = ty - sy, v = C.throwSpeed, g = C.knifeGravity;
    const v2 = v * v, disc = v2 * v2 - g * (g * R * R + 2 * h * v2);
    const pitch = disc < 0 ? Math.atan2(h, R) + 0.2 : Math.atan((v2 - Math.sqrt(disc)) / (g * R));
    return { yaw: Math.atan2(az - sz, ax - sx), pitch: pitch };
  }
  HK.ballistic = ballistic;

  function locomotion(S, p, dt) {
    let wx = p.wishX, wz = p.wishZ;
    const m = Math.hypot(wx, wz);
    if (m > 1) { wx /= m; wz /= m; }
    const fwd = Math.cos(p.yaw) * wx + Math.sin(p.yaw) * wz;
    let speed = C.walk;
    p.sprinting = p.wantSprint && m > 0.3 && fwd > 0.55 * Math.min(1, m) && p.state === "idle";
    if (p.sprinting) speed = C.sprint;
    else if (fwd < -0.3 * m) speed *= C.backMul;
    if (p.state === "throw") speed *= 0.8;
    if (S.t - p.stabT < 0.25) speed *= 0.5;
    if (p.inWater) speed *= C.waterMul;
    const tx = wx * speed, tz = wz * speed;
    // Staggered players keep their slide: little grip, almost no air control.
    const k = Math.min(1, (p.onGround ? (p.staggerT > 0 ? 1.6 : C.accelGround) : C.accelAir * (p.staggerT > 0 ? 0.25 : 1)) * dt);
    p.vx += (tx - p.vx) * k; p.vz += (tz - p.vz) * k;
    if (p.wantJump && p.onGround) {
      p.vy = p.inWater ? C.jumpV * 0.75 : C.jumpV; p.onGround = false;
      emit(S, { type: "jump", p: p.id });
    }
    p.wantJump = false;
    const wasGround = p.onGround, vyBefore = p.vy;
    S.W.moveChar(p, dt, C.gravity);
    if (!p.onGround) p.airT += dt;
    else {
      if (!wasGround && p.airT > 0.25) emit(S, { type: "land", p: p.id, v: -vyBefore });
      p.airT = 0;
    }
    if (p.sprinting) p.noiseT = S.t;
  }

  // ------------------------------------------------------------------ melee
  function tryMelee(S, p) {
    if (p.meleeCd > 0 || p.state !== "idle" || S.phase !== "live") return false;
    p.meleeCd = C.meleeCd; p.attackT = S.t; p.noiseT = S.t;
    const tgt = findLungeTarget(S, p, p.bot ? S.D.lunge : C.lungeRange);
    if (tgt) {
      p.state = "lunge"; p.stateT = 0; p.lungeTarget = tgt.id;
      S.stats.lunges++;
      emit(S, { type: "lunge", p: p.id, target: tgt.id });
    } else {
      p.state = "swing"; p.stateT = 0; p.swingDone = false;
      S.stats.swings++;
      emit(S, { type: "swing", p: p.id });
    }
    return true;
  }

  function findLungeTarget(S, p, range) {
    let best = null, bs = 1e9;
    for (let i = 0; i < S.players.length; i++) {
      const e = S.players[i];
      if (!e.alive || !isEnemy(S, p, e)) continue;
      const dx = e.x - p.x, dz = e.z - p.z, dy = e.y - p.y, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(dy) > 1.4) continue;
      const ang = Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw));
      if (ang > (d < 1.1 ? 1.3 : C.lungeCone)) continue;
      if (!S.W.los(p.x, p.y + 1.3, p.z, e.x, e.y + 1.3, e.z)) continue;
      const sc = d + ang * 3;
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }

  function updateLunge(S, p, dt) {
    p.stateT += dt;
    const t = S.players[p.lungeTarget];
    if (!t || !t.alive) { p.state = "idle"; return; }
    const dx = t.x - p.x, dz = t.z - p.z, dy = t.y - p.y, d = Math.hypot(dx, dz);
    p.yaw = Math.atan2(dz, dx);
    if (!p.bot) S.input.yaw = p.yaw;
    if (d <= C.lungeHit && Math.abs(dy) < 1.5) { stab(S, p, t); return; }
    if (p.stateT >= C.lungeTime) {
      if (d <= 1.8 && Math.abs(dy) < 1.5 && S.W.los(p.x, p.y + 1.2, p.z, t.x, t.y + 1.2, t.z)) stab(S, p, t);
      else { p.state = "idle"; emit(S, { type: "whiff", p: p.id }); }
      return;
    }
    p.vx = dx / d * C.lungeSpeed; p.vz = dz / d * C.lungeSpeed;
    S.W.moveChar(p, dt, C.gravity);
  }

  function stab(S, p, t) {
    p.state = "idle"; p.stabT = S.t;
    p.vx *= 0.25; p.vz *= 0.25;
    kill(S, p, t, "melee");
  }

  function swingHit(S, p) {
    const best = swingTarget(S, p);
    if (best) { p.stabT = S.t; kill(S, p, best, "melee"); }
    else emit(S, { type: "whiff", p: p.id });
  }

  function swingTarget(S, p) {
    let best = null, bd = 1e9;
    S.players.forEach(function (e) {
      if (!e.alive || !isEnemy(S, p, e)) return;
      const dx = e.x - p.x, dz = e.z - p.z, dy = e.y - p.y, d = Math.hypot(dx, dz);
      if (d > C.swingRange || Math.abs(dy) > 1.4) return;
      if (Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw)) > C.swingCone) return;
      if (!S.W.los(p.x, p.y + 1.3, p.z, e.x, e.y + 1.3, e.z)) return;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }

  // ------------------------------------------------------------------ throwing
  function tryThrow(S, p, dir) {
    if (S.phase !== "live" || p.state !== "idle" || p.throwCd > 0) return false;
    if (p.knives <= 0) { if (!p.bot) emit(S, { type: "dry", p: p.id }); p.throwCd = 0.3; return false; }
    p.state = "throw"; p.stateT = 0; p.thrown = false; p.throwDir = dir; p.throwCd = C.throwCd;
    emit(S, { type: "throwstart", p: p.id });
    return true;
  }

  function releaseKnife(S, p) {
    if (p.knives <= 0) return;
    p.knives--;
    const d = p.throwDir || dirFrom(p.yaw, p.pitch);
    const ex = p.x, ey = p.y + C.eye, ez = p.z;
    const rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    let sx = ex + d.x * 0.35 + rx * 0.16, sy = ey - 0.08 + d.y * 0.35, sz = ez + d.z * 0.35 + rz * 0.16;
    if (!S.W.los(ex, ey, ez, sx, sy, sz)) { sx = ex; sy = ey; sz = ez; }
    const k = {
      id: S.nextKnife++, owner: p.id, team: p.team, x: sx, y: sy, z: sz,
      vx: d.x * C.throwSpeed + p.vx * 0.25, vy: d.y * C.throwSpeed, vz: d.z * C.throwSpeed + p.vz * 0.25,
      st: "fly", t: 0, rest: null, restT: 0, recycled: p.recycled > 0, fromX: sx, fromZ: sz,
      dx: d.x, dy: d.y, dz: d.z, px: 0, py: 0, pz: 0, spin: Math.random() * 6
    };
    if (p.recycled > 0) p.recycled--;
    S.knives.push(k);
    S.stats.throws++;
    p.noiseT = S.t; p.attackT = S.t;
    emit(S, { type: "throw", p: p.id, k: k.id });
  }

  function updateKnives(S, dt) {
    const W = S.W, g = C.knifeGravity;
    for (let i = S.knives.length - 1; i >= 0; i--) {
      const k = S.knives[i];
      if (k.st === "fly") {
        k.t += dt;
        const nx = k.x + k.vx * dt, ny = k.y + k.vy * dt - 0.5 * g * dt * dt, nz = k.z + k.vz * dt;
        k.vy -= g * dt;
        const sx = nx - k.x, sy = ny - k.y, sz = nz - k.z, l2 = sx * sx + sz * sz;
        let hitP = null, hu = 2;
        for (let j = 0; j < S.players.length; j++) {
          const e = S.players[j];
          if (!e.alive || e.id === k.owner) continue;
          if (S.mode === "tdm" && e.team === k.team) continue;
          let u = l2 > 1e-9 ? ((e.x - k.x) * sx + (e.z - k.z) * sz) / l2 : 0;
          u = U.clamp(u, 0, 1);
          const px = k.x + sx * u, pz = k.z + sz * u, py = k.y + sy * u;
          const dd = (px - e.x) * (px - e.x) + (pz - e.z) * (pz - e.z);
          if (dd < 0.45 * 0.45 && py > e.y + 0.05 && py < e.y + 1.95 && u < hu) { hu = u; hitP = e; }
        }
        const wh = W.raycast(k.x, k.y, k.z, sx, sy, sz, 1);
        if (hitP && (!wh || hu <= wh.t)) {
          const owner = S.players[k.owner];
          k.x = hitP.x; k.z = hitP.z; k.y = hitP.y + 1.1;
          k.st = "drop"; k.vx = 0; k.vz = 0; k.vy = 0;
          kill(S, owner && owner.alive !== undefined ? owner : null, hitP, "throw", k);
          continue;
        }
        if (wh) { landKnife(S, k, wh); continue; }
        k.x = nx; k.y = ny; k.z = nz;
        const sp = Math.hypot(k.vx, k.vy, k.vz);
        k.dx = k.vx / sp; k.dy = k.vy / sp; k.dz = k.vz / sp;
        if (k.y < S.map.WATER) {
          S.stats.splashes++;
          emit(S, { type: "splash", x: k.x, y: S.map.WATER, z: k.z });
          S.knives.splice(i, 1);
        } else if (k.t > 6) S.knives.splice(i, 1);
      } else if (k.st === "drop") {
        k.vy -= 20 * dt;
        const ny = k.y + k.vy * dt;
        const gy = W.groundAt(k.x, k.z, k.y, 0.05);
        if (ny <= gy + 0.02) {
          k.y = gy + 0.02; k.st = "rest"; k.rest = "floor"; k.restT = S.t;
          k.px = k.x; k.py = k.y + 0.1; k.pz = k.z;
          emit(S, { type: "clatter", x: k.x, y: k.y, z: k.z });
        } else k.y = ny;
        if (k.y < S.map.WATER) S.knives.splice(i, 1);
      } else if (S.t - k.restT > C.knifeLife) {
        S.knives.splice(i, 1);
      }
    }
    // Cap loose knives (oldest resting ones go first).
    let loose = 0;
    for (let i = 0; i < S.knives.length; i++) if (S.knives[i].st === "rest") loose++;
    for (let i = 0; loose > C.maxLoose && i < S.knives.length; i++) {
      if (S.knives[i].st === "rest") { S.knives.splice(i, 1); i--; loose--; }
    }
  }

  function landKnife(S, k, wh) {
    const surf = wh.box.surf;
    emit(S, { type: "impact", x: wh.x, y: wh.y, z: wh.z, surf: surf, k: k.id, nx: wh.nx, ny: wh.ny, nz: wh.nz });
    if (wh.ny > 0.6) {
      k.x = wh.x; k.y = wh.y + 0.02; k.z = wh.z;
      k.st = "rest"; k.rest = "floor"; k.restT = S.t;
      k.px = k.x; k.py = k.y + 0.1; k.pz = k.z;
      return;
    }
    if (surf === "glass" || surf === "soft" || surf === "tile") {
      // Bounces off and drops to the floor in front of what it hit.
      k.x = wh.x + wh.nx * 0.18; k.y = wh.y; k.z = wh.z + wh.nz * 0.18;
      k.st = "drop"; k.vx = 0; k.vz = 0; k.vy = 1.5;
      return;
    }
    const sp = Math.hypot(k.vx, k.vy, k.vz) || 1;
    k.dx = k.vx / sp; k.dy = k.vy / sp; k.dz = k.vz / sp;
    k.x = wh.x + k.dx * 0.07; k.y = wh.y + k.dy * 0.07; k.z = wh.z + k.dz * 0.07;
    k.st = "rest"; k.rest = "wall"; k.restT = S.t;
    k.px = wh.x + wh.nx * 0.12; k.py = wh.y + wh.ny * 0.12; k.pz = wh.z + wh.nz * 0.12;
  }

  function pickups(S) {
    for (let i = 0; i < S.players.length; i++) {
      const p = S.players[i];
      if (!p.alive || p.knives >= C.maxKnives) continue;
      for (let j = S.knives.length - 1; j >= 0 && p.knives < C.maxKnives; j--) {
        const k = S.knives[j];
        if (k.st !== "rest") continue;
        const dy = k.py - p.y;
        if (dy < -0.7 || dy > 3.0) continue;
        if (Math.hypot(k.px - p.x, k.pz - p.z) > C.pickupR) continue;
        if (!S.W.los(p.x, p.y + 1.0, p.z, k.px, k.py, k.pz)) continue;
        p.knives++; p.recycled++;
        S.knives.splice(j, 1);
        S.stats.pickups++;
        emit(S, { type: "pickup", p: p.id, own: k.owner === p.id });
      }
    }
  }

  // ------------------------------------------------------------------ kills
  function kill(S, killer, victim, how, knife) {
    if (!victim.alive) return;
    victim.alive = false; victim.deaths++; victim.streak = 0;
    victim.respawnT = victim.bot ? C.respawn : C.respawn + 0.5;
    victim.state = "dead"; victim.killedBy = killer ? killer.id : -1; victim.deathT = S.t;
    victim.deathHow = how;
    if (killer) { victim.deathFromX = killer.x; victim.deathFromZ = killer.z; }
    const medals = [];
    if (killer && killer !== victim) {
      killer.kills++; killer.streak++; killer.score += 100;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      if (S.t - killer.lastKillT < 4) killer.multi++; else killer.multi = 1;
      killer.lastKillT = S.t;
      if (!S.firstBlood) { S.firstBlood = true; medals.push("FIRST BLOOD"); }
      if (killer.multi === 2) medals.push("DOUBLE KILL");
      else if (killer.multi === 3) medals.push("TRIPLE KILL");
      else if (killer.multi >= 4) medals.push("FURY KILL");
      if (killer.streak === 5) medals.push("BLOODTHIRSTY");
      else if (killer.streak === 10) medals.push("MERCILESS");
      else if (killer.streak === 15) medals.push("RUTHLESS");
      if (killer.streak % C.waveStreak === 0 && !S.wave && !S.over) {
        S.wave = { owner: killer.id, t: 0, hit: false };
        emit(S, { type: "wavewarn", p: killer.id });
      }
      if (how === "wave") medals.push("WASHED OUT");
      else if (how === "throw") {
        S.stats.throwKills++;
        const d = knife ? Math.hypot(victim.x - knife.fromX, victim.z - knife.fromZ) : 0;
        if (d > 20) medals.push("LONGSHOT");
        if (knife && knife.recycled) medals.push("RECYCLER");
        if (victim.airT > 0.2) medals.push("MID-AIR");
      } else if (how === "melee") {
        S.stats.meleeKills++;
        const vf = Math.cos(victim.yaw) * (killer.x - victim.x) + Math.sin(victim.yaw) * (killer.z - victim.z);
        if (vf < -0.3) medals.push("BACKSTAB");
      }
      if (killer.lastKiller === victim.id) { medals.push("REVENGE"); killer.lastKiller = -1; }
      killer.score += medals.length * 50;
      victim.lastKiller = killer.id;
      if (S.mode === "tdm") S.teamScore[killer.team]++;
    }
    emit(S, {
      type: "kill", killer: killer ? killer.id : -1, victim: victim.id, how: how, medals: medals,
      x: victim.x, y: victim.y, z: victim.z, dist: killer ? Math.hypot(victim.x - killer.x, victim.z - killer.z) : 0
    });
    if (killer && !S.over) {
      if (S.mode === "tdm" && S.teamScore[killer.team] >= S.scoreLimit) endMatch(S);
      if (S.mode === "ffa" && killer.kills >= S.scoreLimit) endMatch(S);
    }
  }

  function endMatch(S) {
    if (S.over) return;
    S.over = true;
    if (S.mode === "tdm") S.winner = S.teamScore[0] === S.teamScore[1] ? -1 : (S.teamScore[0] > S.teamScore[1] ? 0 : 1);
    else {
      const top = S.players.slice().sort(function (a, b) { return b.kills - a.kills || b.score - a.score; });
      S.winner = top[0].kills === (top[1] && top[1].kills) && top[0].score === top[1].score ? -1 : top[0].id;
    }
    emit(S, { type: "end", winner: S.winner });
  }

  // Characters don't overlap each other.
  function separate(S) {
    const P = S.players, min = C.radius * 2;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (!b.alive || Math.abs(a.y - b.y) > 1.6) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        S.W.resolve(a); S.W.resolve(b);
      }
    }
  }

  // ------------------------------------------------------------------ bots
  // Clear, flat walk from p to q: knee-height ray plus ground under the line.
  function groundLine(S, p, q) {
    if (Math.abs(q.y - p.y) > 0.35) return false;
    if (!S.W.los(p.x, p.y + 0.55, p.z, q.x, q.y + 0.55, q.z)) return false;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    for (let s = 0.6; s < d; s += 0.7) {
      const u = s / d, x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u;
      if (S.W.groundAt(x, z, p.y + 0.1, 0.12) < p.y - 0.35) return false;
    }
    return true;
  }

  function perceive(S, p) {
    const ai = p.ai, D = S.D;
    const ex = p.x, ey = p.y + C.eye, ez = p.z;
    let best = null, bd = 1e9;
    for (let i = 0; i < S.players.length; i++) {
      const e = S.players[i];
      if (!e.alive || !isEnemy(S, p, e)) continue;
      const dx = e.x - p.x, dz = e.z - p.z, dy = e.y - p.y, d = Math.hypot(dx, dy, dz);
      if (d > 55) continue;
      const ang = Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw));
      const heard = (S.t - e.noiseT < 0.5 && d < D.hear) || (S.t - e.attackT < 0.6 && d < D.hear * 1.6) || d < 2.5;
      const fov = ang < D.fov || d < 2.5;
      const tracking = e.id === ai.target && ai.visible;
      if (!fov && !heard && !tracking) continue;
      const vis = S.W.los(ex, ey, ez, e.x, e.y + 1.3, e.z) || S.W.los(ex, ey, ez, e.x, e.y + 1.7, e.z);
      if (vis && (fov || tracking)) {
        const sc = d - (e.id === ai.target ? 4 : 0);
        if (sc < bd) { bd = sc; best = e; }
      } else if (heard && !ai.visible) {
        ai.lastSeen = { x: e.x, y: e.y, z: e.z, t: S.t };
      }
    }
    if (best) {
      if (best.id !== ai.target || (!ai.visible && S.t - ai.lostT > 1.0)) ai.react = D.react * (0.7 + Math.random() * 0.6);
      ai.target = best.id; ai.visible = true;
      ai.lastSeen = { x: best.x, y: best.y, z: best.z, t: S.t };
      ai.direct = groundLine(S, p, best);
    } else {
      if (ai.visible) ai.lostT = S.t;
      ai.visible = false; ai.throwing = false; ai.direct = false;
    }
  }

  function setWish(p, dx, dz) {
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { p.wishX = 0; p.wishZ = 0; return; }
    const m = Math.min(1, d / 0.6);
    p.wishX = dx / d * m; p.wishZ = dz / d * m;
  }

  function navTo(S, p, goal, direct, dt) {
    const ai = p.ai;
    if (direct) { setWish(p, goal.x - p.x, goal.z - p.z); ai.path = null; return; }
    ai.repathT -= dt;
    const gm = ai.pathGoal ? Math.hypot(goal.x - ai.pathGoal.x, goal.y - ai.pathGoal.y, goal.z - ai.pathGoal.z) : 99;
    if (!ai.path || ai.repathT <= 0 || gm > 2.5) {
      const a = S.nav.nearest(p.x, p.y, p.z), b = S.nav.nearest(goal.x, goal.y, goal.z);
      ai.path = S.nav.path(a, b) || [];
      ai.pi = 0; ai.repathT = 1.0 + Math.random() * 0.5; ai.skipT = 0;
      ai.pathGoal = { x: goal.x, y: goal.y, z: goal.z };
    }
    const path = ai.path;
    while (ai.pi < path.length) {
      const n = path[ai.pi];
      if (Math.hypot(n.x - p.x, n.z - p.z) < 0.6 && Math.abs(n.y - p.y) < 1.0) ai.pi++;
      else break;
    }
    ai.skipT -= dt;
    if (ai.skipT <= 0) {
      ai.skipT = 0.25;
      for (let k = 0; k < 4 && ai.pi + 1 < path.length && groundLine(S, p, path[ai.pi + 1]); k++) ai.pi++;
    }
    if (ai.pi >= path.length) { setWish(p, goal.x - p.x, goal.z - p.z); return; }
    const n = path[ai.pi];
    setWish(p, n.x - p.x, n.z - p.z);
  }

  function botThink(S, p, dt) {
    const ai = p.ai, D = S.D;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) { ai.thinkT = 0.1; perceive(S, p); }
    let tgt = ai.target >= 0 ? S.players[ai.target] : null;
    if (tgt && !tgt.alive) { tgt = null; ai.target = -1; ai.visible = false; ai.throwing = false; }
    p.wantJump = false;
    if (S.phase !== "live") { p.wishX = 0; p.wishZ = 0; return; }

    let faceYaw = null, facePitch = 0, goal = null, direct = false, sprint = false, strafe = 0, close = false;
    if (tgt && ai.visible) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dy = tgt.y - p.y, d = Math.hypot(dx, dz);
      close = d < 5;
      faceYaw = Math.atan2(dz, dx); facePitch = Math.atan2(dy, d) * 0.8;
      if (ai.react > 0) ai.react -= dt;
      else if (p.state === "idle") {
        if (d < D.lunge && Math.abs(dy) < 1.3) {
          if (Math.abs(U.wrap(faceYaw - p.yaw)) < C.lungeCone * 0.8) tryMelee(S, p);
        } else if (!ai.throwing && p.knives > 0 && p.throwCd <= 0 && d > 4.5 && d < 28 &&
          Math.random() < D.throwRate * dt * (0.6 + ai.pers.throwy) * (d < 14 ? 1.3 : 0.8)) {
          ai.throwing = true; ai.throwT = 0;
        }
      }
      if (ai.throwing) {
        ai.throwT += dt;
        const sol = ballistic(p.x, p.y + C.eye - 0.08, p.z, tgt.x, tgt.y + 1.25, tgt.z, tgt.vx, tgt.vz);
        faceYaw = sol.yaw; facePitch = sol.pitch;
        const aligned = Math.abs(U.wrap(p.yaw - sol.yaw)) < 0.05 && Math.abs(p.pitch - sol.pitch) < 0.06;
        if (aligned || ai.throwT > 0.9) {
          const e = D.err * (d > 15 ? 1.3 : 1);
          if (tryThrow(S, p, dirFrom(sol.yaw + gauss() * e, sol.pitch + gauss() * e * 0.6))) ai.throwing = false;
        }
        if (d < D.lunge + 0.4) ai.throwing = false;
      }
      goal = tgt; direct = ai.direct; sprint = d > 4.5 && !ai.throwing;
      if (d > 3.2 && d < 16) strafe = D.strafe;
    } else if (ai.lastSeen && S.t - ai.lastSeen.t < 5) {
      goal = ai.lastSeen; sprint = true;
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 1.5 && Math.abs(goal.y - p.y) < 1.5) ai.lastSeen = null;
    } else {
      if (p.knives < C.maxKnives) {
        let bk = null, bd = 16;
        S.knives.forEach(function (k) {
          if (k.st !== "rest" || Math.abs(k.py - p.y) > 4) return;
          const d = Math.hypot(k.px - p.x, k.pz - p.z) + Math.abs(k.py - p.y) * 2;
          if (d < bd) { bd = d; bk = k; }
        });
        if (bk) { goal = { x: bk.px, y: bk.rest === "wall" ? Math.max(p.y - 4, bk.py - 1.5) : bk.y, z: bk.pz }; sprint = true; }
      }
      if (!goal) {
        const arrived = ai.goal && Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < 1.6 && Math.abs(ai.goal.y - p.y) < 1.2;
        ai.goalT -= dt;
        // Hold a corner for a moment on arrival, looking around.
        if (arrived && ai.waitT <= 0 && !ai.waited) { ai.waitT = U.rand(0.8, 3.2); ai.waited = true; ai.lookYaw = p.yaw + U.rand(-1.6, 1.6); }
        if (ai.waitT > 0) {
          ai.waitT -= dt;
          p.wishX = 0; p.wishZ = 0;
          if (Math.random() < dt * 0.8) ai.lookYaw = p.yaw + U.rand(-1.8, 1.8);
          p.yaw = U.turnTo(p.yaw, ai.lookYaw, 2.2 * dt);
          p.pitch *= 0.9;
          return;
        }
        if (!ai.goal || ai.goalT <= 0 || arrived) {
          ai.waited = false;
          const enemies = S.players.filter(function (e) { return e.alive && isEnemy(S, p, e); });
          let g;
          if (enemies.length && Math.random() < D.hunt * ai.pers.hunt) {
            const e = U.pick(enemies);
            const n = S.nav.nearest(e.x + U.rand(-4, 4), e.y, e.z + U.rand(-3, 3));
            g = n ? { x: n.x, y: n.y, z: n.z } : { x: e.x, y: e.y, z: e.z };
          } else g = U.pick(S.map.hotspots);
          ai.goal = { x: g.x, y: g.y, z: g.z };
          ai.goalT = 9 + Math.random() * 6;
        }
        goal = ai.goal;
        sprint = Math.hypot(goal.x - p.x, goal.z - p.z) > 12 && ai.pers.throwy > 0.3;
      }
    }

    if (goal) navTo(S, p, goal, direct, dt);
    else { p.wishX = 0; p.wishZ = 0; }

    if (strafe > 0 && (p.wishX || p.wishZ)) {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.3 + Math.random() * 0.5; ai.strafeDir = Math.random() < 0.5 ? -1 : 1; }
      const s = strafe * 0.75 * ai.strafeDir;
      const wx = p.wishX - p.wishZ * s, wz = p.wishZ + p.wishX * s;
      const m = Math.hypot(wx, wz) || 1;
      p.wishX = wx / m; p.wishZ = wz / m;
    }

    // Stuck? Hop and take a step sideways, then re-plan.
    ai.stuckT += dt;
    if (ai.stuckT > 1.0) {
      const moved = Math.hypot(p.x - ai.chkX, p.z - ai.chkZ);
      if (moved < 0.35 && Math.hypot(p.wishX, p.wishZ) > 0.5 && p.state === "idle") {
        p.wantJump = true; ai.path = null; ai.unstuck = 0.5; ai.unstuckYaw = Math.random() * Math.PI * 2;
        ai.goal = null;
      }
      ai.stuckT = 0; ai.chkX = p.x; ai.chkZ = p.z;
    }
    if (ai.unstuck > 0) {
      ai.unstuck -= dt;
      p.wishX = Math.cos(ai.unstuckYaw); p.wishZ = Math.sin(ai.unstuckYaw);
    }
    p.wantSprint = sprint;

    if (faceYaw === null && (p.wishX || p.wishZ)) { faceYaw = Math.atan2(p.wishZ, p.wishX); facePitch = 0; }
    const turn = D.turn * (close ? 1.8 : 1) * dt;
    if (faceYaw !== null) p.yaw = U.turnTo(p.yaw, faceYaw, turn);
    p.pitch += U.clamp(facePitch - p.pitch, -turn, turn);
  }

  HK.createSim = createSim;
  HK.dirFrom = dirFrom;
})(globalThis.HK);
