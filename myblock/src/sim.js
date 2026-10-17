// The battle: players, movement, guns, pickups, capture points, scoring,
// spawns and bot AI. Pure logic, no three.js, so tools/sim-test.js runs whole
// battles in Node. (Forked from Summit Protocol's sim with the netcode, spy
// gadgets and alt-fire modes taken out; right mouse now aims down the sights.)
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const U = SP.U, WP = SP.WEAPONS, MEL = SP.MELEE;

  const C = {
    gravity: 20, jumpV: 5.8, walk: 4.6, sprint: 6.6, backMul: 0.8, aimMul: 0.6,
    accelGround: 13, accelAir: 2.5,
    radius: 0.36, height: 1.8, eye: 1.62,
    bodyR: 0.36, bodyTop: 1.42, headY: 1.62, headR: 0.2,
    maxHp: 100, maxArmor: 100, armorAbsorb: 0.6,
    respawn: 4, prematch: 3, spawnProtect: 1.5,
    loadTime: 5, restock: 35, dropLife: 30, carryMul: 0.9, bagReach: 1.1, fallY: -20, nadeG: 14,
    // Crouching: slower, steadier, and a smaller target (head and body sit this much lower).
    crouchMul: 0.45, crouchSpread: 0.7, crouchDrop: 0.45, crouchEye: 1.15,
    // Dive roll: how long, how fast along the ground, the wait before another.
    rollT: 1.1, rollSpeed: 3.4, rollCd: 1.0,
    // Ladders (climb speed) and vaulting walls, cars and fences up to vaultMax high.
    climbSpeed: 1.4, overT: 1.1, vaultMax: 3.1, vaultT: 1.0,
  // Bodies: how close you stand to search one, and how much longer a bot's lies there.
  lootReach: 2.0, corpseLinger: 5,
  // Burning barrels: how near the flame has to be (just past a body touching the drum), the damage a
  // tick while you stand in it, the seconds between ticks and how long you keep burning after.
  fireReach: 0.72, fireDmg: 10, fireTick: 0.5, burnTime: 1.5,
    // The dead: hit points, how far they sense the living (and hear gunfire),
    // reach, bite, swing time, walker / runner / drifting speeds, how long
    // climbing out of a grave takes, and the wait before a grave fills again.
    zHp: 150, zHeadMul: 1.5, zSense: 38, zHear: 60, zReach: 1.35, zDmg: 26, zSwing: 0.55, zAtkCd: 1.3,
    zWalk: 1.25, zRun: 4.1, zDrift: 0.55, zRunners: 0.5, zRise: 2.6, zRespawn: [6, 13]
  };
  SP.CFG = C;

  const MODES = {
    tdm: { limit: 40, time: 600, name: "STREET WAR" },
    turf: { limit: 10, time: 600, name: "TURF" }
  };
  SP.MODES = MODES;

  // The sides fighting over the city. body: the Mixamo body they wear
  // (SP.FACTION_BODY, tools/pack-bodies.py); color: rings, minimap, HUD.
  SP.FACTIONS = {
    crew: { name: "ALEX'S CREW", color: 0x3aa0ff, names: ["Dre", "Tank", "Smoke", "Rico", "Juice", "Boogie", "Ty", "Lil Mike", "Deuce", "Hawk"] },
    iron: { name: "IRON WATCH", color: 0xff5a3a, names: ["Vasquez", "Kowal", "Brandt", "Okoro", "Lindgren", "Haldane", "Petrov", "Stroud", "Crane", "Novak"] },
    vanguard: { name: "VANGUARD", color: 0xffc93a, names: ["Ryker", "Voss", "Kane", "Orion", "Talon", "Mercer", "Jax", "Steele", "Grady", "Wolfe"] },
    dead: { name: "THE DEAD", color: 0x7dd36a, names: ["Walker", "Shambler", "Rotter", "Biter", "Lurker", "Crawler", "Moaner", "Gnasher", "Groaner", "Ghoul"] }
  };

  // err: aim wobble (radians, 1 sigma). burst: how long they hold an automatic.
  const DIFF = {
    recruit:  { react: 0.8,  turn: 2.6, err: 0.07,  hear: 14, fov: 1.0,  burst: 0.35, nade: 0.03, strafe: 0.2,  hunt: 0.25, head: 0.0 },
    regular:  { react: 0.5,  turn: 4.0, err: 0.045, hear: 18, fov: 1.15, burst: 0.55, nade: 0.06, strafe: 0.45, hunt: 0.35, head: 0.1 },
    hardened: { react: 0.33, turn: 5.6, err: 0.03,  hear: 22, fov: 1.25, burst: 0.75, nade: 0.09, strafe: 0.65, hunt: 0.45, head: 0.2 },
    veteran:  { react: 0.2,  turn: 7.5, err: 0.019, hear: 26, fov: 1.35, burst: 0.95, nade: 0.12, strafe: 0.85, hunt: 0.55, head: 0.3 }
  };
  SP.DIFF = DIFF;

  function newInput() {
    return { mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false, fire: false, firePressed: false, aim: false,
      reload: false, sel: -1, next: 0, melee: false, grab: false, crouch: false, roll: false, use: false };
  }
  function newAct() {
    return { fire: false, firePressed: false, aim: false, reload: false, sel: -1, next: 0, melee: false, grab: false };
  }
  function clearAct(A) {
    A.fire = A.firePressed = A.aim = A.reload = A.melee = A.grab = false;
    A.sel = -1; A.next = 0;
  }

  // Who fights: you (the first seat, leading team 0) and bots filling `seats`,
  // split evenly over the factions.
  function makeRoster(factions, seats, human, humanName) {
    seats = seats || 8;
    const per = Math.ceil(seats / factions.length);
    const roster = [];
    factions.forEach(function (f, team) {
      const names = U.shuffle(SP.FACTIONS[f].names.slice());
      for (let n = 0; n < per; n++) {
        const me = human && team === 0 && n === 0;
        roster.push({ name: me ? humanName || "Alex" : names.pop() || "Bot", team: team, bot: !me });
      }
    });
    return roster;
  }
  SP.makeRoster = makeRoster;

  function createSim(o) {
    const mode = MODES[o.mode] ? o.mode : "tdm";
    let factions = (o.factions || ["crew", "iron"]).slice();
    // The dead join as one more side (they fight everyone) when the map has
    // graves for them; they never score and can't win.
    const sides = factions.length;
    const zCount = o.zombies === undefined ? 6 : o.zombies;
    const graves = o.map.spawns.some(function (s) { return s.side === "dead"; });
    if (zCount > 0 && graves) factions = factions.concat(["dead"]);
    const S = {
      C: C, mode: mode, diffName: o.difficulty || "regular", D: DIFF[o.difficulty || "regular"] || DIFF.regular,
      W: o.world, nav: o.nav, map: o.map, factions: factions, sides: sides, zTeam: factions.length > sides ? sides : -1,
      t: 0, timeLimit: o.timeLimit || MODES[mode].time, timeLeft: o.timeLimit || MODES[mode].time,
      scoreLimit: o.scoreLimit || MODES[mode].limit,
      teamScore: factions.map(function () { return 0; }), players: [], proj: [], events: [], over: false, winner: null,
      phase: "pre", preT: o.prematch !== undefined ? o.prematch : C.prematch, firstBlood: false,
      nextProj: 1, humanId: -1, input: null, upT: 0,
      pick: o.map.pickups.map(function () { return { up: true, t: 0 }; }),
      pt: o.map.points.map(newStash), drops: [], nextDrop: 1,
      stats: { shots: 0, hits: 0, kills: 0, heads: 0, rockets: 0, nades: 0, pickups: 0, caps: 0, packs: 0, melee: 0, zkills: 0, bites: 0, rises: 0 }
    };
    const roster = o.roster || makeRoster(factions.slice(0, sides), o.seats, o.human !== false, o.humanName);
    roster.forEach(function (r) {
      const p = makePlayer(S.players.length, r.name, r.team, !!r.bot);
      if (!r.bot && S.humanId < 0) S.humanId = p.id;
      S.players.push(p);
    });
    // The dead start in the ground and climb out over the first few seconds.
    if (S.zTeam >= 0) {
      const names = U.shuffle(SP.FACTIONS.dead.names.slice());
      for (let k = 0; k < zCount; k++) {
        const z = makePlayer(S.players.length, names[k % names.length], S.zTeam, true);
        z.zombie = true;
        z.respawnT = 1 + k * 1.6 + Math.random() * 2;
        S.players.push(z);
      }
    }
    S.input = S.humanId >= 0 ? S.players[S.humanId].inp : newInput();

    // Opening spawns: every side starts on its own spawns.
    const used = new Set();
    S.players.forEach(function (p) {
      if (p.zombie) return;
      const list = U.shuffle(S.map.spawns.filter(function (s) { return s.side === p.team && !used.has(s); }));
      const s = list[0] || chooseSpawn(S, p);
      used.add(s);
      placeAt(S, p, s);
    });
    if (S.humanId >= 0) { const h = S.players[S.humanId]; S.input.yaw = h.yaw; S.input.pitch = 0; }

    S.step = function (dt) { step(S, dt); };
    S.isEnemy = function (a, b) { return isEnemy(a, b); };
    return S;
  }
  SP.createSim = createSim;

  function makePlayer(id, name, team, bot) {
    const p = {
      id: id, name: name, team: team, bot: bot, alive: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: C.radius, h: C.height, onGround: true,
      yaw: 0, pitch: 0, hp: C.maxHp, armor: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, bestStreak: 0, lastKillT: -99, multi: 0, lastKiller: -1, caps: 0,
      respawnT: 0, killedBy: -1, deathT: 0, deathHow: "", spawnT: 0, airT: 0, burnT: 0, burnCd: 0, carry: false, carryFrom: -1,
      wishX: 0, wishZ: 0, wantSprint: false, wantJump: false, sprinting: false, aiming: false,
      crouch: false, rollT: 0, rollCd: 0, rollX: 0, rollZ: 0, climb: null,
      noiseT: -99, attackT: -99, hurtT: -99, meleeCd: 0, meleeT: 9, throwCd: 0, mv: null, down: null, combo: 0, comboT: -99,
      inv: null, cur: 1, fireCd: 0, reloadT: 0, switchT: 0, bloom: 0,
      shots: 0, lastFireT: -9,
      act: newAct(),
      ai: bot ? newAI() : null,
      inp: bot ? null : newInput()
    };
    resetLoadout(p);
    return p;
  }

  // Bots start with the pistol, rifle and frags (the rest are pickups); you
  // spawn with the whole armoury.
  function resetLoadout(p) {
    p.inv = WP.map(function (w) { const has = !!w.start || !p.bot; return { have: has, mag: has ? w.mag : 0, res: has ? w.reserve : 0 }; });
    p.cur = 1; p.fireCd = 0.2; p.reloadT = 0; p.switchT = 0; p.bloom = 0; p.aiming = false;
    p.hp = C.maxHp; p.armor = 0; p.meleeCd = 0;
  }
  SP.resetLoadout = resetLoadout;

  function newAI() {
    return {
      thinkT: Math.random() * 0.1, target: -1, visible: false, react: 0, lostT: -9, lastSeen: null, hurtBy: -1,
      direct: false, path: null, pi: 0, repathT: Math.random() * 0.6, pathGoal: null, goal: null, goalT: Math.random() * 0.5, skipT: 0,
      strafeT: 0, strafeDir: 1, stuckT: 0, chkX: 0, chkZ: 0, unstuck: 0, unstuckYaw: 0,
      ex: 0, ey: 0, errT: 0, burstT: 0, restT: 0, cadT: 0, nadeT: 0, waitT: 0, lookYaw: 0, waited: false,
      pers: { aggro: Math.random(), hunt: 0.6 + Math.random() * 0.8, loot: Math.random() }
    };
  }

  function emit(S, e) { e.t = S.t; S.events.push(e); }
  function isEnemy(a, b) { return a !== b && a.team !== b.team; }

  function placeAt(S, p, s) {
    p.x = s.x; p.y = s.y; p.z = s.z; p.vx = p.vy = p.vz = 0;
    p.yaw = s.yaw; p.pitch = 0; p.alive = true;
    p.onGround = true; p.spawnT = 0; p.airT = 0;
    p.crouch = false; p.rollT = 0; p.climb = null; p.burnT = 0; p.burnCd = 0; p.carry = false; p.mv = null; p.down = null;
    resetLoadout(p);
    if (p.zombie) {
      // A fresh corpse: walker or runner, climbing out of the grave.
      p.hp = C.zHp; p.rise = C.zRise; p.zAtkCd = 0; p.zHit = null; p.zMove = 0;
      p.runner = Math.random() < C.zRunners;
      p.yaw = Math.random() * Math.PI * 2;
    }
    if (p.ai) { const pers = p.ai.pers; p.ai = newAI(); p.ai.pers = pers; p.ai.chkX = p.x; p.ai.chkZ = p.z; }
    if (p.inp) { p.inp.yaw = p.yaw; p.inp.pitch = 0; }
  }

  // ------------------------------------------------------------------ spawning
  // Your own side's spawns, plus any capture point your side holds; away from
  // enemies and out of their sight.
  function spawnPoints(S, p) {
    if (p.zombie) return S.map.spawns.filter(function (s) { return s.side === "dead"; });
    const list = S.map.spawns.filter(function (s) { return s.side === p.team; });
    return list.length ? list : S.map.spawns;
  }
  function chooseSpawn(S, p) {
    let best = null, bs = -1e9;
    spawnPoints(S, p).forEach(function (s) {
      let minE = 99, seen = false, mates = 0, blocked = false;
      S.players.forEach(function (e) {
        if (!e.alive || e === p) return;
        const d = Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z);
        if (d < 1.2) blocked = true;
        if (isEnemy(p, e)) {
          if (d < minE) minE = d;
          if (d < 50 && S.W.los(e.x, e.y + C.eye, e.z, s.x, s.y + 1.4, s.z)) seen = true;
        } else if (d < 15) mates++;
      });
      if (blocked) return;
      let sc = Math.min(minE, 30) + Math.random() * 6 + Math.min(mates, 2) * 2;
      if (minE < 9) sc -= 60;
      if (seen) sc -= 30;
      if (sc > bs) { bs = sc; best = s; }
    });
    return best || S.map.spawns[0];
  }

  function spawn(S, p) {
    placeAt(S, p, chooseSpawn(S, p));
    if (p.zombie) S.stats.rises++;
    emit(S, { type: "spawn", p: p.id, rise: p.zombie ? 1 : 0 });
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
    for (let i = 0; i < S.players.length; i++) updatePlayer(S, S.players[i], dt);
    separate(S);
    updateProj(S, dt);
    pickups(S, dt);
    if (S.mode === "turf") points(S, dt);
  }

  function updatePlayer(S, p, dt) {
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0 && !S.over) spawn(S, p);
      return;
    }
    p.spawnT += dt;
    fireStep(S, p, dt);
    if (!p.alive) return;
    if (p.zombie) { zombieStep(S, p, dt); return; }
    if (p.climb) {
      if (p.inp && p.inp.jump && p.climb.ph === "up") { p.climb = null; p.inp.jump = false; }   // let go of the ladder
      else { climbStep(S, p, dt); p.inp && (p.inp.firePressed = p.inp.reload = p.inp.melee = p.inp.use = p.inp.roll = p.inp.crouch = false); return; }
    }
    if (p.down) { downStep(S, p, dt); return; }
    if (p.mv) { mvStep(S, p, dt); return; }
    if (p.bot) botThink(S, p, dt);
    else humanInput(S, p);
    if (S.phase !== "live") { p.wishX = 0; p.wishZ = 0; p.wantJump = false; }
    weaponStep(S, p, p.act, dt);
    locomotion(S, p, dt);
    if (p.y < C.fallY) kill(S, null, p, "fall", -1, false);
  }

  function humanInput(S, p) {
    const I = p.inp, A = p.act;
    p.yaw = I.yaw; p.pitch = I.pitch;
    let mx = I.mx, mz = I.mz;
    const m = Math.hypot(mx, mz);
    if (m > 1) { mx /= m; mz /= m; }
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    p.wishX = fx * mz - fz * mx;
    p.wishZ = fz * mz + fx * mx;
    p.wantSprint = I.sprint && mz > 0.5 && !I.aim;
    if (p.wantSprint && p.crouch) p.crouch = false;          // sprinting stands you up
    if (I.jump) { p.wantJump = true; I.jump = false; }
    if (I.crouch) p.crouch = !p.crouch;
    if (I.roll) startRoll(S, p);
    if (I.use && S.phase === "live") {
      const body = corpseNear(S, p);
      if (body) lootBody(S, p, body); else startClimb(S, p, climbAt(S, p));
    }
    clearAct(A);
    A.fire = I.fire; A.firePressed = I.firePressed; A.aim = I.aim; A.reload = I.reload; A.sel = I.sel; A.next = I.next;
    A.melee = I.melee; A.grab = I.grab;
    I.firePressed = I.reload = I.melee = I.grab = I.crouch = I.roll = I.use = false; I.sel = -1; I.next = 0;
  }

  // ------------------------------------------------------------------ fire barrels
  // Bump into a burning drum and the flame catches you: a hit at once, another every half second
  // while you're against it, then a short burn after you pull away. The dead burn too.
  function fireStep(S, p, dt) {
    const F = S.map.fires;
    if (!F || !F.length) return;
    let touching = false;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (Math.abs(p.y - f.y) < 1.1 && Math.hypot(p.x - f.x, p.z - f.z) < C.fireReach) { touching = true; if (p.burnT <= 0) emit(S, { type: "burn", p: p.id, x: r2(f.x), z: r2(f.z) }); break; }
    }
    if (touching) { if (p.burnT <= 0) p.burnCd = 0; p.burnT = C.burnTime; }
    if (p.burnT <= 0) return;
    p.burnT -= dt; p.burnCd -= dt;
    if (p.burnCd <= 0) {
      p.burnCd = C.fireTick;
      damage(S, null, p, touching ? C.fireDmg : C.fireDmg * 0.5, "fire", -1, false);
    }
  }
  // ------------------------------------------------------------------ looting
  // A fallen fighter (not the dead, not yourself) lies where they dropped until they respawn;
  // press E beside one, once, to take half of what they were carrying.
  function corpseNear(S, p) {
    if (!p.alive || p.zombie || p.climb || p.rollT > 0) return null;
    let best = null, bd = C.lootReach;
    S.players.forEach(function (v) {
      if (v === p || v.alive || v.zombie || v.looted || v.respawnT < 0.5) return;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bd && Math.abs(v.y - p.y) < 1.2) { bd = d; best = v; }
    });
    return best;
  }
  SP.corpseNear = corpseNear;

  function lootBody(S, p, v) {
    v.looted = true;
    let ammo = 0, nades = 0, guns = 0;
    WP.forEach(function (w, i) {
      const from = v.inv[i], to = p.inv[i];
      if (!from.have) return;
      if (i === 5) {
        if (from.mag > 0 && to.mag < w.maxMag) { const n = Math.min(w.maxMag - to.mag, Math.max(1, from.mag)); to.have = true; to.mag += n; nades += n; }
        return;
      }
      const give = Math.max(1, Math.ceil((from.mag + from.res) * 0.5));
      if (!to.have) { to.have = true; to.mag = w.mag; to.res = Math.ceil(w.reserve / 2); guns++; ammo += to.mag + to.res; return; }
      const n = Math.min(w.maxRes - to.res, give);
      if (n > 0) { to.res += n; ammo += n; }
    });
    // Pockets: some bandages and plates now and then.
    let hp = 0, armor = 0;
    if (Math.random() < 0.45 && p.hp < C.maxHp) { hp = Math.min(C.maxHp - p.hp, 25); p.hp += hp; }
    if (Math.random() < 0.3 && p.armor < C.maxArmor) { armor = Math.min(C.maxArmor - p.armor, 25); p.armor += armor; }
    p.score += 10;
    S.stats.loots = (S.stats.loots || 0) + 1;
    emit(S, { type: "loot", p: p.id, victim: v.id, ammo: ammo, nades: nades, guns: guns, hp: hp, armor: armor });
  }

  // ------------------------------------------------------------------ crouch, roll, climb
  function eyeOf(p) { return p.y + (p.crouch ? C.crouchEye : C.eye); }
  SP.eyeOf = eyeOf;
  // Where a shot meets a body: crouched, the body and head sit lower.
  function bodyY(e) { return e.y - (e.crouch ? C.crouchDrop : 0); }

  function startRoll(S, p) {
    if (!p.onGround || p.rollCd > 0 || p.climb || S.phase !== "live") return;
    let dx = p.wishX, dz = p.wishZ;
    const m = Math.hypot(dx, dz);
    if (m < 0.2) { dx = Math.cos(p.yaw); dz = Math.sin(p.yaw); } else { dx /= m; dz /= m; }
    p.rollX = dx; p.rollZ = dz; p.rollT = C.rollT; p.rollCd = C.rollT + C.rollCd;
    p.crouch = false; p.reloadT = 0;
    emit(S, { type: "roll", p: p.id });
  }

  // A ladder you're at and facing, or a wall / car / fence low enough to get
  // over, in front of you. Returns what climbAt found, or null.
  function climbAt(S, p) {
    if (!p.alive || !p.onGround || p.rollT > 0 || p.climb) return null;
    const L = S.map.climbs || [];
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (Math.abs(p.y - c.y0) < 0.6 && Math.hypot(p.x - c.x, p.z - c.z) < 1.4 && Math.abs(U.wrap(p.yaw - c.yaw)) < 1.1) return { kind: "ladder", i: i };
    }
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    const h = S.W.raycast(p.x, p.y + 0.6, p.z, fx * 1.3, 0, fz * 1.3, 1, false, false);
    if (!h || h.box.perim) return null;
    const bx = h.x + fx * 0.06, bz = h.z + fz * 0.06;
    const top = S.W.groundAt(bx, bz, p.y + C.vaultMax - 0.45, 0.14);
    if (top < p.y + 0.55 || top > p.y + C.vaultMax || !S.W.clear(bx, top, bz, 0.12, 1.5)) return null;
    // Land on top if there's room up there, else on the far side.
    for (let s = 0.4; s <= 2.9; s += 0.3) {
      const x = h.x + fx * s, z = h.z + fz * s;
      const g = S.W.groundAt(x, z, top + 0.05, C.radius * 0.7);
      if (g < p.y - 3.5) continue;
      if (S.W.clear(x, g, z, C.radius, C.height) && S.W.los(bx, top + 1.0, bz, x, g + 1.0, z)) return { kind: "vault", x: x, y: g, z: z, top: top };
    }
    return null;
  }
  SP.climbAt = climbAt;

  function startClimb(S, p, c) {
    if (!c) return;
    p.crouch = false; p.reloadT = 0; p.vx = p.vz = p.vy = 0; p.aiming = false;
    if (c.kind === "ladder") {
      const L = S.map.climbs[c.i];
      // On the ladder, a hand's reach from the wall.
      p.x = L.x + Math.cos(L.yaw) * 0.15; p.z = L.z + Math.sin(L.yaw) * 0.15; p.yaw = L.yaw;
      if (p.inp) p.inp.yaw = L.yaw;
      p.climb = { kind: "ladder", i: c.i, ph: "up", t: 0 };
    } else {
      p.climb = { kind: "vault", ph: "over", t: 0, from: { x: p.x, y: p.y, z: p.z }, to: { x: c.x, y: c.y, z: c.z }, top: c.top };
    }
    emit(S, { type: "climb", p: p.id, k: c.kind });
  }

  function climbStep(S, p, dt) {
    const c = p.climb;
    c.t += dt;
    p.vx = p.vz = p.vy = 0; p.onGround = false; p.airT = 0;
    p.yaw = p.inp ? p.inp.yaw : p.yaw;
    if (c.kind === "ladder") {
      const L = S.map.climbs[c.i];
      p.yaw = L.yaw;
      if (c.ph === "up") {
        p.y += C.climbSpeed * dt;
        if (p.y >= L.y1 - 1.1) { c.ph = "over"; c.t = 0; c.from = { x: p.x, y: p.y, z: p.z }; c.to = { x: L.tx, y: L.y1, z: L.tz }; c.top = L.y1; }
        return;
      }
    }
    // Over the top: up first, then across, onto the landing.
    const T = c.kind === "vault" ? C.vaultT : C.overT, u = Math.min(1, c.t / T);
    const up = Math.min(1, u / 0.5), across = U.clamp((u - 0.25) / 0.75, 0, 1), e = across * across * (3 - 2 * across);
    const peak = Math.max(c.top + 0.12, c.to.y);
    p.x = c.from.x + (c.to.x - c.from.x) * e; p.z = c.from.z + (c.to.z - c.from.z) * e;
    p.y = u < 0.6 ? c.from.y + (peak - c.from.y) * Math.sin(up * Math.PI / 2) : peak + (c.to.y - peak) * ((u - 0.6) / 0.4);
    if (u >= 1) {
      p.x = c.to.x; p.y = c.to.y; p.z = c.to.z; p.climb = null; p.onGround = true;
      emit(S, { type: "land", p: p.id, v: 3 });
    }
  }

  function locomotion(S, p, dt) {
    p.rollCd -= dt;
    if (p.rollT > 0) {
      // Mid-roll: carried along the roll's line whatever the keys say.
      p.rollT -= dt;
      p.vx = p.rollX * C.rollSpeed; p.vz = p.rollZ * C.rollSpeed;
      p.sprinting = false; p.wantJump = false;
      S.W.moveChar(p, dt, C.gravity);
      return;
    }
    let wx = p.wishX, wz = p.wishZ;
    const m = Math.hypot(wx, wz);
    if (m > 1) { wx /= m; wz /= m; }
    const fwd = Math.cos(p.yaw) * wx + Math.sin(p.yaw) * wz;
    let speed = C.walk;
    p.sprinting = !p.zombie && !p.crouch && p.wantSprint && m > 0.3 && fwd > 0.55 * Math.min(1, m) && p.reloadT <= 0 && !p.aiming;
    if (p.zombie) speed = p.zMove;
    else if (p.sprinting) speed = C.sprint;
    else if (fwd < -0.3 * m) speed *= C.backMul;
    if (p.aiming) speed *= C.aimMul;
    if (p.carry) speed *= C.carryMul;
    if (p.crouch) speed *= C.crouchMul;
    const tx = wx * speed, tz = wz * speed;
    const k = Math.min(1, (p.onGround ? C.accelGround : C.accelAir) * dt);
    p.vx += (tx - p.vx) * k; p.vz += (tz - p.vz) * k;
    if (p.wantJump && p.onGround) {
      p.vy = C.jumpV; p.onGround = false;
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

  // ------------------------------------------------------------------ weapons
  function owned(p, i) { return p.inv[i].have && (i !== 5 || p.inv[5].mag > 0); }
  function hasAmmo(p, i) { return owned(p, i) && p.inv[i].mag + p.inv[i].res > 0; }
  function nextOwned(p, dir) {
    for (let k = 1; k <= WP.length; k++) {
      const i = ((p.cur + dir * k) % WP.length + WP.length) % WP.length;
      if (owned(p, i)) return i;
    }
    return p.cur;
  }
  function bestWithAmmo(p) {
    const order = [1, 3, 2, 4, 0];
    for (let k = 0; k < order.length; k++) if (hasAmmo(p, order[k])) return order[k];
    return 0;
  }
  function switchTo(S, p, i) {
    if (i === p.cur || !owned(p, i)) return;
    p.cur = i; p.switchT = 0.45; p.reloadT = 0;
    emit(S, { type: "switch", p: p.id, w: i });
  }
  SP.switchTo = switchTo;

  function spreadOf(p, w) {
    let s = w.spread;
    const sp = Math.hypot(p.vx, p.vz);
    s += Math.min(1, sp / C.sprint) * w.moveSpread;
    if (!p.onGround) s += 0.03;
    s += p.bloom;
    if (p.aiming) s *= w.adsSpread;
    if (p.crouch) s *= C.crouchSpread;
    if (p.bot && w.scope) s = Math.min(s, 0.004);   // bots "scope" when they shoot it
    return s;
  }
  SP.spreadOf = spreadOf;

  function weaponStep(S, p, A, dt) {
    p.fireCd -= dt; p.meleeCd -= dt; p.throwCd -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 0.09);
    p.meleeT += dt;
    if (S.phase !== "live" || p.rollT > 0 || p.climb) { p.aiming = false; return; }
    let want = A.sel;
    if (A.next) want = nextOwned(p, A.next);
    if (want >= 0 && want < WP.length && want !== p.cur && owned(p, want)) switchTo(S, p, want);
    if (A.grab) grab(S, p);
    if (A.melee && p.meleeCd <= 0) melee(S, p);
    const w = WP[p.cur], st = p.inv[p.cur];
    p.aiming = !!A.aim && !p.sprinting && w.kind !== "grenade";
    if (p.switchT > 0) { p.switchT -= dt; return; }
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const n = Math.min(w.mag - st.mag, st.res);
        st.mag += n; st.res -= n;
        emit(S, { type: "reloaded", p: p.id, w: p.cur });
      }
      return;
    }
    if (A.reload && st.mag < w.mag && st.res > 0 && w.kind !== "grenade") { startReload(S, p); return; }
    const pull = w.auto ? A.fire : A.firePressed;
    if (pull && p.fireCd <= 0) {
      if (st.mag <= 0) {
        if (st.res > 0) startReload(S, p);
        else {
          emit(S, { type: "dry", p: p.id });
          p.fireCd = 0.3;
          const b = bestWithAmmo(p);
          if (b !== p.cur) switchTo(S, p, b);
        }
      } else shoot(S, p, w);
    }
    // Empty magazine: reload on its own once the trigger is let go.
    if (!A.fire && st.mag <= 0 && st.res > 0 && w.kind !== "grenade" && p.fireCd <= 0) startReload(S, p);
  }

  function startReload(S, p) {
    const w = WP[p.cur];
    if (w.reload <= 0) return;
    p.reloadT = w.reload;
    emit(S, { type: "reload", p: p.id, w: p.cur });
  }

  // Fire weapon w once.
  function shoot(S, p, w) {
    const st = p.inv[w.id];
    st.mag -= 1;
    p.fireCd = w.rate; p.shots++; p.lastFireT = S.t;
    p.noiseT = S.t; p.attackT = S.t;
    p.spawnT = Math.max(p.spawnT, C.spawnProtect);   // firing ends spawn protection
    p.bloom = Math.min(w.bloomMax, p.bloom + w.bloom);
    S.stats.shots++;
    const ex = p.x, ey = eyeOf(p), ez = p.z;
    emit(S, { type: "fire", p: p.id, w: w.id });
    if (w.kind === "hitscan") {
      const n = w.pellets, spread = spreadOf(p, w);
      const dmg = new Map();    // victimId -> {d, head}
      let endX = 0, endY = 0, endZ = 0;
      for (let k = 0; k < n; k++) {
        const d = cone(p.yaw, p.pitch, spread);
        const tr = trace(S, p, ex, ey, ez, d, w.range, null);
        if (k === 0) { endX = tr.x; endY = tr.y; endZ = tr.z; }
        if (tr.p) {
          const e = dmg.get(tr.p.id) || { d: 0, head: false };
          e.d += w.dmg * (tr.head ? w.head : 1); e.head = e.head || tr.head;
          dmg.set(tr.p.id, e);
          if (k < 3) emit(S, { type: "blood", x: r2(tr.x), y: r2(tr.y), z: r2(tr.z), v: tr.p.id });
        } else if (tr.box && (k < 3 || n <= 3)) emit(S, { type: "imp", x: tr.x, y: tr.y, z: tr.z, nx: tr.nx, ny: tr.ny, nz: tr.nz, surf: tr.box.surf });
      }
      emit(S, { type: "shot", p: p.id, w: w.id, x: r2(endX), y: r2(endY), z: r2(endZ) });
      dmg.forEach(function (e, id) { S.stats.hits++; damage(S, p, S.players[id], e.d, "gun", w.id, e.head); });
    } else {
      launch(S, p, w.id, ex, ey, ez, p.yaw, p.pitch);
      if (w.kind === "grenade" && st.mag <= 0) {
        // Out of grenades: back to a gun.
        p.fireCd = 0.5;
        p.cur = bestWithAmmo(p); p.switchT = 0.45;
      }
    }
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // A random direction within ~spread of (yaw, pitch).
  function cone(yaw, pitch, spread) {
    if (spread <= 0) return U.dir(yaw, pitch);
    return U.dir(yaw + U.gauss() * spread / Math.max(0.2, Math.cos(pitch)), pitch + U.gauss() * spread);
  }

  // Bullet from (ox,oy,oz) along unit d: the first enemy (head or body) or
  // wall it meets. skip: a player it can't hit. Teammates don't block shots.
  function trace(S, shooter, ox, oy, oz, d, range, skip) {
    const wh = S.W.raycast(ox, oy, oz, d.x * range, d.y * range, d.z * range, 1, true, false);
    let maxT = wh ? wh.t * range : range;
    let hitP = null, head = false;
    for (let i = 0; i < S.players.length; i++) {
      const e = S.players[i];
      if (!e.alive || e === shooter || e === skip || !isEnemy(shooter, e)) continue;
      const h = rayBody(ox, oy, oz, d, e.x, bodyY(e), e.z, 0, maxT);
      if (h) { maxT = h.t; hitP = e; head = h.head; }
    }
    if (hitP) return { p: hitP, head: head, x: ox + d.x * maxT, y: oy + d.y * maxT, z: oz + d.z * maxT, t: maxT };
    if (wh) return { p: null, box: wh.box, x: wh.x, y: wh.y, z: wh.z, nx: wh.nx, ny: wh.ny, nz: wh.nz, t: maxT };
    return { p: null, box: null, x: ox + d.x * range, y: oy + d.y * range, z: oz + d.z * range, t: range };
  }
  SP.trace = trace;

  // Ray vs a standing character at (x,y,z): a vertical cylinder for the body
  // and a sphere for the head, both inflated by `pad`. Returns {t, head} or null.
  function rayBody(ox, oy, oz, d, x, y, z, pad, maxT) {
    let best = null;
    const hr = C.headR + pad, cx = ox - x, cy = oy - (y + C.headY), cz = oz - z;
    const b = cx * d.x + cy * d.y + cz * d.z, c = cx * cx + cy * cy + cz * cz - hr * hr, disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxT) best = { t: t, head: true };
    }
    const r = C.bodyR + pad, a2 = d.x * d.x + d.z * d.z;
    if (a2 > 1e-8) {
      const bx = ox - x, bz = oz - z;
      const bb = bx * d.x + bz * d.z, cc = bx * bx + bz * bz - r * r, dd = bb * bb - a2 * cc;
      if (dd >= 0) {
        const sq = Math.sqrt(dd);
        for (let k = 0; k < 2; k++) {
          const t = (-bb + (k ? sq : -sq)) / a2;
          if (t <= 0 || t >= maxT || (best && t >= best.t)) continue;
          const yy = oy + d.y * t;
          if (yy >= y - pad && yy <= y + C.bodyTop + pad) { best = { t: t, head: false }; break; }
        }
      }
    }
    return best;
  }
  SP.rayBody = rayBody;

  // ------------------------------------------------------------------ hand to hand
  // A move (p.mv) takes over the body for its duration: you can't shoot or steer, and it lands at
  // its `hit` moment. V throws a punch, then a kick, then a punch...; B is the flying shoulder
  // throw. A fighter who's been thrown (p.down) lies there, then gets up.
  function startMove(S, p, kind, tgt) {
    const spec = kind === "throw" ? SP.THROW : MEL[kind];
    p.mv = { kind: kind, t: 0, dur: spec.dur, hit: false, tgt: tgt ? tgt.id : -1, dx: Math.cos(p.yaw), dz: Math.sin(p.yaw) };
    p.crouch = false; p.reloadT = 0; p.aiming = false; p.climb = null;
    p.noiseT = S.t; p.attackT = S.t;
    p.spawnT = Math.max(p.spawnT, C.spawnProtect);
    emit(S, { type: kind === "throw" ? "grab" : "melee", p: p.id, k: kind });
  }
  function melee(S, p) {
    if (p.mv || p.down) return;
    p.combo = S.t - p.comboT < MEL.window ? (p.combo + 1) % 2 : 0;
    p.comboT = S.t;
    const kind = p.combo === 0 ? "punch" : "kick";
    p.meleeCd = MEL[kind].dur + 0.1; p.meleeT = 0;
    startMove(S, p, kind, null);
  }
  function grab(S, p) {
    if (p.mv || p.down || p.throwCd > 0 || !p.onGround || S.phase !== "live") return;
    const t = throwTarget(S, p);
    if (!t) return;
    p.throwCd = SP.THROW.cd;
    p.yaw = Math.atan2(t.z - p.z, t.x - p.x);
    if (p.inp) p.inp.yaw = p.yaw;
    startMove(S, p, "throw", t);
  }
  function throwTarget(S, p) {
    const TH = SP.THROW;
    let best = null, bd = 1e9;
    S.players.forEach(function (e) {
      if (!e.alive || e.zombie || e.down || !isEnemy(p, e)) return;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d > TH.range || Math.abs(e.y - p.y) > 1.2) return;
      if (d > 0.5 && Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw)) > TH.cone) return;
      if (!S.W.los(p.x, p.y + 1.2, p.z, e.x, e.y + 1.2, e.z)) return;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  function mvStep(S, p, dt) {
    const m = p.mv;
    m.t += dt;
    p.fireCd -= dt; p.meleeCd -= dt; p.throwCd -= dt;
    if (p.inp) p.inp.firePressed = p.inp.reload = p.inp.use = p.inp.roll = p.inp.crouch = p.inp.jump = false;   // (a queued V or B is kept)
    if (m.kind === "throw") {
      const TH = SP.THROW, t = m.tgt >= 0 ? S.players[m.tgt] : null;
      if (!m.hit && m.t < TH.hit) {
        // Leap at them: head for a point just short of where they are now.
        if (t && t.alive) {
          const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
          p.yaw = Math.atan2(dz, dx); m.dx = dx / d; m.dz = dz / d;
          const sp = d > TH.reach * 0.7 ? Math.min(10, (d - TH.reach * 0.7) / Math.max(0.1, TH.hit - m.t)) : 0;
          p.vx = m.dx * sp; p.vz = m.dz * sp;
        } else { p.vx = m.dx * 3; p.vz = m.dz * 3; }
      } else {
        if (!m.hit) { m.hit = true; throwHit(S, p, t); }
        const k = Math.max(0, 1 - (m.t - TH.hit) / 0.8);        // follow-through: a short slide, then still
        p.vx = m.dx * 1.6 * k; p.vz = m.dz * 1.6 * k;
      }
    } else {
      p.vx *= 0.8; p.vz *= 0.8;
      if (!m.hit && m.t >= MEL[m.kind].hit) {
        m.hit = true;
        const t = meleeTarget(S, p, MEL.range);
        if (t) meleeHit(S, p, t, m.kind);
      }
    }
    S.W.moveChar(p, dt, C.gravity);
    if (m.t >= m.dur) p.mv = null;
  }
  function throwHit(S, p, t) {
    const TH = SP.THROW;
    if (!t || !t.alive || t.zombie || t.down || Math.hypot(t.x - p.x, t.z - p.z) > TH.reach + 0.8) return;   // slipped away
    const dx = t.x - p.x, dz = t.z - p.z, n = Math.hypot(dx, dz) || 1, ux = dx / n, uz = dz / n;
    t.yaw = Math.atan2(-uz, -ux); if (t.inp) t.inp.yaw = t.yaw;           // lands facing the way they came from
    t.vx = ux * 4.4; t.vz = uz * 4.4; t.vy = 3.4; t.onGround = false;
    t.down = { t: 0, dur: TH.down };
    t.mv = null; t.climb = null; t.rollT = 0; t.reloadT = 0; t.aiming = false; t.crouch = false;
    if (t.carry) dropBag(S, t);
    S.stats.melee++;
    emit(S, { type: "throw", p: p.id, v: t.id });
    damage(S, p, t, TH.dmg, "throw", -1, false);
  }
  function downStep(S, p, dt) {
    const d = p.down;
    d.t += dt;
    const k = Math.pow(0.03, dt);
    p.vx *= k; p.vz *= k;
    S.W.moveChar(p, dt, C.gravity);
    p.fireCd -= dt; p.meleeCd -= dt; p.throwCd -= dt;
    p.reloadT = 0; p.aiming = false; p.wishX = p.wishZ = 0;
    if (p.inp) p.inp.firePressed = p.inp.reload = p.inp.use = p.inp.roll = p.inp.crouch = p.inp.jump = p.inp.melee = p.inp.grab = false;
    if (d.t >= d.dur) p.down = null;
  }  function meleeTarget(S, p, range) {
    let best = null, bd = 1e9;
    S.players.forEach(function (e) {
      if (!e.alive || !isEnemy(p, e)) return;
      const dx = e.x - p.x, dz = e.z - p.z, dy = e.y - p.y, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(dy) > 1.5) return;
      if (Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw)) > MEL.cone) return;
      if (!S.W.los(p.x, p.y + 1.3, p.z, e.x, e.y + 1.3, e.z)) return;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  function meleeHit(S, p, t, kind) {
    // From behind (within ~60 degrees of their back) it's a takedown.
    const vf = Math.cos(t.yaw) * (p.x - t.x) + Math.sin(t.yaw) * (p.z - t.z);
    const back = vf < -0.5 * Math.hypot(p.x - t.x, p.z - t.z);
    S.stats.melee++;
    emit(S, { type: "smack", p: p.id, v: t.id });
    damage(S, p, t, back ? MEL.back : (MEL[kind] || MEL).dmg, back ? "backstrike" : kind || "melee", -1, false);
  }

  // ------------------------------------------------------------------ projectiles
  // kind 4 = rocket, 5 = grenade.
  function launch(S, p, kind, ex, ey, ez, yaw, pitch) {
    let d, sp, k;
    if (kind === 4) { d = U.dir(yaw, pitch); sp = WP[4].speed; k = "rocket"; S.stats.rockets++; }
    else { d = U.dir(yaw, Math.min(1.2, pitch + 0.2)); sp = WP[5].speed; k = "nade"; S.stats.nades++; }
    // Start just in front of the eye (pulled back if that's inside a wall).
    let sx = ex + d.x * 0.5, sy = ey - 0.1 + d.y * 0.5, sz = ez + d.z * 0.5;
    if (!S.W.los(ex, ey, ez, sx, sy, sz)) { sx = ex; sy = ey - 0.1; sz = ez; }
    const q = {
      id: S.nextProj++, k: k, owner: p.id, team: p.team, x: sx, y: sy, z: sz,
      vx: d.x * sp + (kind === 5 ? p.vx * 0.4 : 0), vy: d.y * sp, vz: d.z * sp + (kind === 5 ? p.vz * 0.4 : 0),
      t: 0, fuse: kind === 5 ? WP[5].fuse : 0, rest: false
    };
    S.proj.push(q);
    emit(S, { type: "launch", p: p.id, k: k, id: q.id });
    return q;
  }

  function updateProj(S, dt) {
    for (let i = S.proj.length - 1; i >= 0; i--) {
      const q = S.proj[i];
      q.t += dt;
      const owner = S.players[q.owner];
      if (q.k === "rocket") {
        q.vy -= 1.2 * dt;     // a slight drop over long range
        if (moveHit(S, q, dt, 0.12) || q.t > 6) { explode(S, owner, q.x, q.y, q.z, WP[4], "rocket"); S.proj.splice(i, 1); }
      } else {
        q.fuse -= dt;
        if (!q.rest) nadeMove(S, q, dt);
        if (q.fuse <= 0) { explode(S, owner, q.x, q.y + 0.15, q.z, WP[5], "nade"); S.proj.splice(i, 1); }
      }
    }
  }

  // Move a rocket; returns {p} for a player hit, true for a wall, or null.
  function moveHit(S, q, dt, pad) {
    const sx = q.vx * dt, sy = q.vy * dt, sz = q.vz * dt, len = Math.hypot(sx, sy, sz);
    if (len < 1e-6) return null;
    const d = { x: sx / len, y: sy / len, z: sz / len };
    const wh = S.W.raycast(q.x, q.y, q.z, sx, sy, sz, 1, true, false);
    let maxT = wh ? wh.t * len : len, hitP = null;
    const owner = S.players[q.owner];
    for (let i = 0; i < S.players.length; i++) {
      const e = S.players[i];
      if (!e.alive) continue;
      if (e.id === q.owner && q.t < 0.3) continue;
      if (owner && e !== owner && !isEnemy(owner, e)) continue;
      const h = rayBody(q.x, q.y, q.z, d, e.x, bodyY(e), e.z, pad, maxT);
      if (h) { maxT = h.t; hitP = e; }
    }
    if (hitP || wh) {
      const back = Math.max(0, maxT - 0.15);
      q.x += d.x * back; q.y += d.y * back; q.z += d.z * back;
      return hitP ? { p: hitP } : true;
    }
    q.x += sx; q.y += sy; q.z += sz;
    return null;
  }

  function nadeMove(S, q, dt) {
    q.vy -= C.nadeG * dt;
    const sx = q.vx * dt, sy = q.vy * dt, sz = q.vz * dt;
    const wh = S.W.raycast(q.x, q.y, q.z, sx, sy, sz, 1, true, false);
    if (!wh) { q.x += sx; q.y += sy; q.z += sz; return; }
    q.x = wh.x + wh.nx * 0.08; q.y = wh.y + wh.ny * 0.08; q.z = wh.z + wh.nz * 0.08;
    // Bounce: reflect off the face, lose energy.
    const vn = q.vx * wh.nx + q.vy * wh.ny + q.vz * wh.nz;
    q.vx -= 1.45 * vn * wh.nx; q.vy -= 1.45 * vn * wh.ny; q.vz -= 1.45 * vn * wh.nz;
    q.vx *= 0.7; q.vz *= 0.7; q.vy *= 0.7;
    if (Math.abs(vn) > 2) emit(S, { type: "bounce", x: q.x, y: q.y, z: q.z, surf: wh.box.surf });
    if (wh.ny > 0.6 && Math.hypot(q.vx, q.vy, q.vz) < 1.2) { q.rest = true; q.vx = q.vy = q.vz = 0; }
  }

  function explode(S, owner, x, y, z, w, how) {
    emit(S, { type: "boom", x: r2(x), y: r2(y), z: r2(z), r: w.splash, k: how });
    S.players.forEach(function (e) {
      if (!e.alive) return;
      if (owner && e !== owner && !isEnemy(owner, e)) return;
      const cy = e.y + 0.9, d = Math.hypot(e.x - x, cy - y, e.z - z);
      if (d > w.splash) return;
      if (!S.W.los(x, y + 0.2, z, e.x, cy, e.z) && !S.W.los(x, y + 0.2, z, e.x, e.y + C.headY, e.z)) return;
      const k = Math.pow(1 - d / w.splash, 0.75);
      const dmg = Math.max(12, w.dmg * k) * (e === owner ? 0.5 : 1);
      damage(S, owner, e, dmg, how, w.id, false);
    });
  }

  // ------------------------------------------------------------------ damage + kills
  function damage(S, att, v, amount, how, wId, head) {
    if (!v.alive || S.over) return;
    if (v.spawnT < C.spawnProtect && att !== v && !v.zombie) return;
    if (v.zombie && head) amount *= C.zHeadMul;
    const soak = Math.min(v.armor, amount * C.armorAbsorb);
    v.armor -= soak;
    v.hp -= amount - soak;
    v.hurtT = S.t;
    emit(S, { type: "hit", p: att ? att.id : -1, v: v.id, d: Math.round(amount), hs: head ? 1 : 0, ax: att ? r2(att.x) : 0, az: att ? r2(att.z) : 0 });
    if (v.ai && att && att !== v) {
      v.ai.lastSeen = { x: att.x, y: att.y, z: att.z, t: S.t };
      if (!v.ai.visible) v.ai.hurtBy = att.id;
    }
    if (v.hp <= 0) kill(S, att, v, how, wId, head);
  }
  SP.damage = damage;

  function kill(S, killer, victim, how, wId, head) {
    if (!victim.alive) return;
    if (victim.zombie) {
      // Putting one of the dead back down: personal score only, never the war's.
      victim.alive = false; victim.hp = 0; victim.deaths++; victim.zHit = null;
      victim.respawnT = U.rand(C.zRespawn[0], C.zRespawn[1]);
      if (killer && !killer.zombie) { killer.score += 50; killer.zkills = (killer.zkills || 0) + 1; }
      S.stats.zkills++;
      emit(S, { type: "kill", killer: killer ? killer.id : -1, victim: victim.id, how: how, w: wId, hs: head ? 1 : 0, medals: [],
        x: r2(victim.x), y: r2(victim.y), z: r2(victim.z), dist: 0, zombie: 1 });
      return;
    }
    if (killer && killer.zombie) killer = null;     // bitten: nobody's kill
    victim.alive = false; victim.deaths++; victim.streak = 0; victim.hp = 0;
    // Bots lie where they fell a few seconds longer: long enough to be searched.
    victim.respawnT = C.respawn + (victim.bot ? C.corpseLinger : 0.5);
    victim.looted = false;
    victim.killedBy = killer ? killer.id : -1; victim.deathT = S.t; victim.deathHow = how;
    victim.reloadT = 0; victim.aiming = false;
    if (victim.carry) dropBag(S, victim);
    victim.mv = null; victim.down = null;
    const medals = [];
    if (killer && killer !== victim) {
      killer.kills++; killer.streak++; killer.score += 100;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      if (S.t - killer.lastKillT < 4) killer.multi++; else killer.multi = 1;
      killer.lastKillT = S.t;
      S.stats.kills++;
      if (!S.firstBlood) { S.firstBlood = true; medals.push("FIRST BLOOD"); }
      if (killer.multi === 2) medals.push("DOUBLE KILL");
      else if (killer.multi === 3) medals.push("TRIPLE KILL");
      else if (killer.multi >= 4) medals.push("RAMPAGE");
      if (killer.streak === 5) medals.push("UNTOUCHABLE");
      else if (killer.streak === 10) medals.push("ONE-MAN ARMY");
      if (head) { medals.push("HEADSHOT"); S.stats.heads++; }
      const dist = Math.hypot(victim.x - killer.x, victim.z - killer.z);
      if (wId === 3 && dist > 40) medals.push("LONG SHOT");
      if (how === "backstrike") medals.push("FROM BEHIND");
      if (killer.hp > 0 && killer.hp < 20) medals.push("CLOSE CALL");
      if (killer.lastKiller === victim.id) { medals.push("PAYBACK"); killer.lastKiller = -1; }
      killer.score += medals.length * 50;
      victim.lastKiller = killer.id;
      if (S.mode === "tdm") S.teamScore[killer.team]++;
    } else {
      victim.score = Math.max(0, victim.score - 50);
    }
    emit(S, {
      type: "kill", killer: killer ? killer.id : -1, victim: victim.id, how: how, w: wId, hs: head ? 1 : 0, medals: medals,
      x: r2(victim.x), y: r2(victim.y), z: r2(victim.z), dist: killer ? Math.round(Math.hypot(victim.x - killer.x, victim.z - killer.z)) : 0
    });
    if (killer && killer !== victim && !S.over && S.mode === "tdm" && S.teamScore[killer.team] >= S.scoreLimit) endMatch(S);
  }

  function endMatch(S) {
    if (S.over) return;
    S.over = true;
    let best = -1, bs = -1, tie = false;
    S.teamScore.forEach(function (s, i) { if (i >= S.sides) return; if (s > bs) { bs = s; best = i; tie = false; } else if (s === bs) tie = true; });
    S.winner = tie ? -1 : best;
    emit(S, { type: "end", winner: S.winner });
  }

  // ------------------------------------------------------------------ pickups
  function grant(p, q) {
    if (q.kind === "weapon") {
      const w = WP[q.w], st = p.inv[q.w];
      if (!st.have) { st.have = true; st.mag = w.mag; st.res = w.reserve; return "new"; }
      if (st.res >= w.maxRes) return null;
      st.res = Math.min(w.maxRes, st.res + Math.ceil(w.reserve / 2));
      return "ammo";
    }
    if (q.kind === "nades") {
      const st = p.inv[5];
      if (st.mag >= WP[5].maxMag) return null;
      st.have = true; st.mag = Math.min(WP[5].maxMag, st.mag + 2);
      return "ammo";
    }
    if (q.kind === "armor") { if (p.armor >= C.maxArmor) return null; p.armor = Math.min(C.maxArmor, p.armor + 50); return "armor"; }
    if (q.kind === "health") { if (p.hp >= C.maxHp) return null; p.hp = Math.min(C.maxHp, p.hp + 40); return "health"; }
    return null;
  }

  function pickups(S, dt) {
    const L = S.map.pickups;
    for (let i = 0; i < L.length; i++) {
      const st = S.pick[i], q = L[i];
      if (!st.up) {
        st.t -= dt;
        if (st.t <= 0) { st.up = true; emit(S, { type: "respawnpk", id: i }); }
        continue;
      }
      for (let j = 0; j < S.players.length; j++) {
        const p = S.players[j];
        if (!p.alive || p.zombie) continue;
        const dy = p.y - q.y;
        if (dy < -0.8 || dy > 1.4 || Math.hypot(p.x - q.x, p.z - q.z) > 1.15) continue;
        const res = grant(p, q);
        if (!res) continue;
        st.up = false;
        st.t = q.kind === "weapon" ? (q.w === 4 ? SP.RESPAWN.rocket : SP.RESPAWN.weapon) : SP.RESPAWN[q.kind];
        S.stats.pickups++;
        // A new gun goes straight into a bot's hands; you keep yours.
        if (res === "new" && p.bot) switchTo(S, p, q.w);
        emit(S, { type: "pickup", p: p.id, id: i, k: q.kind, w: q.w, res: res });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ the duffle run (turf)
  // Each abandoned house has a stash: a table with two empty duffle bags and a pile of silver-wrapped
  // bricks. Stand at the table and the bricks go into the bags (5 s, one side at a time: an enemy in
  // the room pauses it). Packed, the bags wait on the table for anyone to pick up (walk up to it, one
  // bag each) and carry to their own block (a drop zone at the side's end of the map). A carrier who
  // dies drops the bag where they fell; whoever touches it carries it on, and after 30 s untouched it
  // goes back to its table. A delivered bag is a point; first to scoreLimit wins. A stash restocks
  // 25 s after both its bags have left the table.
  // state: "empty" | "loading" | "packed" | "cool". team: whose crew is (or was) loading it.
  function newStash() { return { state: "empty", prog: 0, team: -1, bags: 0, cool: 0, contested: false }; }
  SP.newStash = newStash;

  function dropBag(S, p) {
    p.carry = false;
    S.drops.push({ id: S.nextDrop++, x: p.x, y: p.y, z: p.z, home: p.carryFrom, t: 0, from: p.team });
    emit(S, { type: "drop", p: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z) });
  }
  function takeBag(S, p, from, steal) {
    p.carry = true; p.carryFrom = from;
    p.noiseT = S.t;
    emit(S, { type: "take", p: p.id, i: from, steal: steal ? 1 : 0 });
  }
  function stashReach(P) { return P.r; }

  function points(S, dt) {
    S.map.points.forEach(function (P, i) {
      const st = S.pt[i];
      if (st.state === "cool") {
        st.cool -= dt;
        if (st.cool <= 0) { st.state = "empty"; st.prog = 0; st.team = -1; st.bags = 0; emit(S, { type: "restock", i: i }); }
      }
      const at = S.factions.map(function () { return 0; });
      S.players.forEach(function (p) {
        if (!p.alive || p.zombie || Math.abs(p.y - P.y) > 1.7 || Math.hypot(p.x - P.x, p.z - P.z) > stashReach(P)) return;
        at[p.team]++;
      });
      const sides = at.filter(function (n) { return n > 0; }).length;
      st.contested = sides > 1;
      if (st.state === "empty" || st.state === "loading") {
        const team = sides === 1 ? at.findIndex(function (n) { return n > 0; }) : -1;
        if (team >= 0) {
          if (st.team !== team) { st.team = team; st.prog = 0; }
          if (st.state === "empty") emit(S, { type: "loading", i: i, team: team });
          st.state = "loading";
          st.prog += dt / C.loadTime;
          if (st.prog >= 1) {
            st.prog = 1; st.state = "packed"; st.bags = 2;
            S.stats.packs++;
            S.players.forEach(function (p) {
              if (p.alive && !p.zombie && p.team === team && Math.hypot(p.x - P.x, p.z - P.z) <= stashReach(P) && Math.abs(p.y - P.y) < 1.7) p.score += 40;
            });
            emit(S, { type: "pack", i: i, team: team });
          }
        } else if (!st.contested && st.state === "loading") {
          st.prog = Math.max(0, st.prog - dt * 0.35);
          if (st.prog <= 0) { st.state = "empty"; st.team = -1; }
        }
      }
      if (st.state === "packed") {
        // Anyone who isn't already carrying one takes a bag from the table (the other side too).
        for (let k = 0; k < S.players.length && st.bags > 0; k++) {
          const p = S.players[k];
          if (!p.alive || p.zombie || p.carry || Math.abs(p.y - P.y) > 1.7 || Math.hypot(p.x - P.x, p.z - P.z) > stashReach(P)) continue;
          st.bags--;
          takeBag(S, p, i, p.team !== st.team);
        }
        if (st.bags <= 0) { st.state = "cool"; st.cool = C.restock; }
      }
    });

    // Bags on the ground: picked up by whoever touches one, or sent home after a while.
    for (let d = S.drops.length - 1; d >= 0; d--) {
      const b = S.drops[d];
      b.t += dt;
      let taker = null;
      for (let k = 0; k < S.players.length; k++) {
        const p = S.players[k];
        if (!p.alive || p.zombie || p.carry || Math.abs(p.y - b.y) > 1.5 || Math.hypot(p.x - b.x, p.z - b.z) > C.bagReach) continue;
        taker = p; break;
      }
      if (taker) { S.drops.splice(d, 1); takeBag(S, taker, b.home, taker.team !== b.from); continue; }
      if (b.t >= C.dropLife) {
        S.drops.splice(d, 1);
        const st = S.pt[b.home];
        if (st && (st.state === "packed" || st.state === "cool")) { st.state = "packed"; st.bags++; st.cool = 0; }
        emit(S, { type: "bagback", i: b.home });
      }
    }

    // Home: a carrier inside their own block's drop zone hands the bag in.
    S.players.forEach(function (p) {
      if (!p.alive || !p.carry) return;
      const Z = S.map.zones[p.team];
      if (!Z || Math.hypot(p.x - Z.x, p.z - Z.z) > Z.r || Math.abs(p.y - (Z.y || 0)) > 1.7) return;
      p.carry = false; p.caps++; p.score += 150;
      S.teamScore[p.team]++;
      S.stats.caps++;
      emit(S, { type: "deliver", p: p.id, team: p.team, n: S.teamScore[p.team] });
      if (!S.over && S.teamScore[p.team] >= S.scoreLimit) endMatch(S);
    });
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
        a.x -= nx * push; a.z -= nz * push; S.W.resolve(a);
        b.x += nx * push; b.z += nz * push; S.W.resolve(b);
      }
    }
  }

  // ------------------------------------------------------------------ the dead
  // Who a zombie goes for: whoever it already has (it chases until it's put
  // down or they are), else the nearest living fighter it can sense, or anyone
  // who just fired a gun within earshot.
  function zombieTarget(S, p) {
    const ai = p.ai;
    const cur = ai.target >= 0 ? S.players[ai.target] : null;
    if (cur && cur.alive && !cur.zombie) return;
    let best = null, bd = 1e9;
    S.players.forEach(function (e) {
      if (!e.alive || e.zombie) return;
      const d = Math.hypot(e.x - p.x, e.z - p.z) + Math.abs(e.y - p.y) * 2;
      const heard = S.t - e.attackT < 1 && d < C.zHear;
      if ((d < C.zSense || heard) && d < bd) { bd = d; best = e; }
    });
    ai.target = best ? best.id : -1;
    if (best) emit(S, { type: "zspot", p: p.id, v: best.id });
  }

  function zombieStep(S, p, dt) {
    const ai = p.ai;
    p.wantJump = false; p.aiming = false;
    if (S.phase !== "live" || p.rise > 0) {
      // Still climbing out of the grave (or the battle hasn't started): no moving.
      p.rise = Math.max(0, (p.rise || 0) - (S.phase === "live" ? dt : 0));
      p.wishX = p.wishZ = 0; p.vx = p.vz = 0; p.zMove = 0;
      S.W.moveChar(p, dt, C.gravity);
      return;
    }
    p.zAtkCd -= dt;
    // A swing lands a beat after it starts, if they're still in reach.
    if (p.zHit && S.t >= p.zHit.t) {
      const v = S.players[p.zHit.v];
      p.zHit = null;
      if (v && v.alive && Math.hypot(v.x - p.x, v.z - p.z) < C.zReach + 0.6 && Math.abs(v.y - p.y) < 1.4) {
        S.stats.bites++;
        damage(S, p, v, C.zDmg, "bite", -1, false);
      }
    }
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) { ai.thinkT = 0.3; zombieTarget(S, p); }
    const tgt = ai.target >= 0 ? S.players[ai.target] : null;
    let goal = null, direct = false, faceYaw = null;
    if (tgt) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz);
      if (d < C.zReach && Math.abs(tgt.y - p.y) < 1.3) {
        p.wishX = p.wishZ = 0;
        faceYaw = Math.atan2(dz, dx);
        if (p.zAtkCd <= 0 && !p.zHit) {
          p.zAtkCd = C.zAtkCd; p.zHit = { t: S.t + C.zSwing, v: tgt.id }; p.attackT = S.t;
          emit(S, { type: "zattack", p: p.id, v: tgt.id });
        }
      } else { goal = tgt; direct = d < 12 && groundLine(S, p, tgt); }
      p.zMove = p.runner ? C.zRun : C.zWalk;
    } else {
      // Nobody about: drift between the graves.
      ai.goalT -= dt;
      if (!ai.goal || ai.goalT <= 0 || Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < 1) {
        const g = U.pick(S.map.spawns.filter(function (s) { return s.side === "dead"; }));
        ai.goal = { x: g.x + U.rand(-3, 3), y: g.y, z: g.z + U.rand(-2, 2) };
        ai.goalT = U.rand(5, 11);
      }
      goal = ai.goal;
      p.zMove = C.zDrift;
    }
    if (goal) navTo(S, p, goal, direct, dt);
    // Stuck on something: a sidestep, then re-plan.
    ai.stuckT += dt;
    if (ai.stuckT > 1.2) {
      if (Math.hypot(p.x - ai.chkX, p.z - ai.chkZ) < 0.3 && Math.hypot(p.wishX, p.wishZ) > 0.5) { ai.path = null; ai.unstuck = 0.6; ai.unstuckYaw = Math.random() * Math.PI * 2; ai.goal = null; }
      ai.stuckT = 0; ai.chkX = p.x; ai.chkZ = p.z;
    }
    if (ai.unstuck > 0) { ai.unstuck -= dt; p.wishX = Math.cos(ai.unstuckYaw); p.wishZ = Math.sin(ai.unstuckYaw); }
    if (faceYaw === null && (p.wishX || p.wishZ)) faceYaw = Math.atan2(p.wishZ, p.wishX);
    if (faceYaw !== null) p.yaw = U.turnTo(p.yaw, faceYaw, (p.runner ? 5 : 3) * dt);
    p.pitch = 0;
    p.wantSprint = false;
    locomotion(S, p, dt);
    if (p.y < C.fallY) kill(S, null, p, "fall", -1, false);
  }

  // ------------------------------------------------------------------ bots
  function groundLine(S, p, q) {
    if (Math.abs(q.y - p.y) > 0.35) return false;
    // Railings and fences let bullets through, but nobody walks through them.
    if (S.W.raycast(p.x, p.y + 0.55, p.z, q.x - p.x, q.y - p.y, q.z - p.z, 1, false, true)) return false;
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
      if (!e.alive || !isEnemy(p, e)) continue;
      const dx = e.x - p.x, dz = e.z - p.z, dy = e.y - p.y, d = Math.hypot(dx, dy, dz);
      if (d > 90) continue;
      const ang = Math.abs(U.wrap(Math.atan2(dz, dx) - p.yaw));
      const heard = (S.t - e.attackT < 0.6 && d < D.hear * 2.2) || (S.t - e.noiseT < 0.5 && d < D.hear) || d < 3;
      const fov = ang < D.fov || d < 3;
      const tracking = e.id === ai.target && ai.visible;
      if (!fov && !heard && !tracking && ai.hurtBy !== e.id) continue;
      const vis = S.W.los(ex, ey, ez, e.x, e.y + 1.2, e.z) || S.W.los(ex, ey, ez, e.x, e.y + C.headY, e.z);
      if (vis && (fov || tracking || ai.hurtBy === e.id)) {
        const sc = d - (e.id === ai.target ? 6 : 0) - (ai.hurtBy === e.id ? 8 : 0);
        if (sc < bd) { bd = sc; best = e; }
      } else if ((heard || ai.hurtBy === e.id) && !ai.visible) {
        ai.lastSeen = { x: e.x, y: e.y, z: e.z, t: S.t };
      }
    }
    if (best) {
      if (best.id !== ai.target || (!ai.visible && S.t - ai.lostT > 1.0)) ai.react = D.react * (0.7 + Math.random() * 0.6);
      ai.target = best.id; ai.visible = true; ai.hurtBy = -1;
      ai.lastSeen = { x: best.x, y: best.y, z: best.z, t: S.t };
      ai.direct = groundLine(S, p, best);
    } else {
      if (ai.visible) ai.lostT = S.t;
      ai.visible = false; ai.direct = false;
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

  // Which gun for a fight at distance d.
  function pickWeapon(p, d) {
    let best = 0, bs = -1;
    for (let i = 0; i < 5; i++) {
      if (!hasAmmo(p, i)) continue;
      let s = 1;
      if (i === 1) s = 2.4;
      else if (i === 2) s = d < 9 ? 3.2 : d < 14 ? 1.5 : 0.3;
      else if (i === 3) s = d > 22 ? 3.3 : 0.8;
      else if (i === 4) s = d > 8 && d < 40 ? 2.0 : 0.2;
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  }

  // Bots can walk to it.
  function reachable(S, x, y, z) {
    const n = S.nav.nearest(x, y, z);
    return n && Math.hypot(n.x - x, n.z - z) < 1.6 && Math.abs(n.y - y) < 0.8;
  }

  function botGoal(S, p) {
    const ai = p.ai, D = S.D;
    // The nearest pickup that passes `want`, within `range` metres.
    const nearestPick = function (range, want) {
      let best = null, bd = range;
      S.map.pickups.forEach(function (q, i) {
        if (!S.pick[i].up || !want(q)) return;
        if (q.reach === undefined) q.reach = reachable(S, q.x, q.y, q.z);
        if (!q.reach) return;
        const d = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 3;
        if (d < bd) { bd = d; best = { x: q.x, y: q.y, z: q.z, kind: "pickup" }; }
      });
      return best;
    };
    let g = null;
    const turf = S.mode === "turf";
    if (p.hp < (turf ? 40 : 55)) g = nearestPick(turf ? 22 : 45, function (q) { return q.kind === "health"; });
    if (g) return g;
    // Turf (the duffle run): a carrier takes the bag home; the rest load a stash, take a packed bag,
    // pick up a dropped one, escort a friendly carrier or hunt an enemy one.
    if (turf) {
      const Z = S.map.zones[p.team];
      if (p.carry && Z) return { x: Z.x + U.rand(-1, 1), y: Z.y || 0, z: Z.z + U.rand(-1, 1), kind: "deliver" };
      if (Math.random() < 0.9) {
        let best = null, bd = 40;
        S.drops.forEach(function (b) { const d = Math.hypot(b.x - p.x, b.z - p.z) + Math.abs(b.y - p.y) * 3; if (d < bd) { bd = d; best = b; } });
        if (best) return { x: best.x, y: best.y, z: best.z, kind: "pickup" };
        let ec = null, ed = 1e9, fc = null, fd = 1e9;
        S.players.forEach(function (e) {
          if (!e.alive || !e.carry) return;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (isEnemy(p, e)) { if (d < ed) { ed = d; ec = e; } } else if (e !== p && d < fd) { fd = d; fc = e; }
        });
        if (ec && (ai.pers.aggro > 0.35 || ed < 25)) return { x: ec.x, y: ec.y, z: ec.z, kind: "hunt" };
        if (fc && ai.pers.aggro < 0.6 && fd < 60) return { x: fc.x + U.rand(-2, 2), y: fc.y, z: fc.z + U.rand(-2, 2), kind: "hunt" };
        let tb = null, ts = 1e9;
        S.map.points.forEach(function (P, i) {
          const st = S.pt[i];
          let s = Math.hypot(P.x - p.x, P.z - p.z) + Math.abs(P.y - p.y) * 3;
          if (st.state === "cool") s += 90;
          else if (st.state === "packed") s -= 20;
          else if (st.state === "loading") s += st.team === p.team ? -12 : -4;
          s += (ai.pers.aggro - 0.5) * 16 * (i === 1 ? -1 : 1) + Math.random() * 14;
          if (s < ts) { ts = s; tb = P; }
        });
        if (tb) return { x: tb.x + U.rand(-1, 1), y: tb.y, z: tb.z + U.rand(-1, 1), kind: "point", P: tb };
      }
    }    // Anything handy nearby: armour, ammo, grenades, a gun we don't have.
    g = nearestPick(20, function (q) {
      return (q.kind === "armor" && p.armor < 60) || (q.kind === "health" && p.hp < 90) ||
        (q.kind === "weapon" && (!p.inv[q.w].have || p.inv[q.w].res < WP[q.w].reserve / 2)) || (q.kind === "nades" && p.inv[5].mag < 2);
    });
    if (g) return g;
    // Scavengers go further for a gun they haven't got (the RPG, the marksman rifle...).
    if (ai.pers.loot > 0.45) g = nearestPick(25 + ai.pers.loot * 30, function (q) { return q.kind === "weapon" && !p.inv[q.w].have; });
    if (g) return g;
    const enemies = S.players.filter(function (e) { return e.alive && isEnemy(p, e); });
    if (enemies.length && Math.random() < D.hunt * ai.pers.hunt) {
      const e = U.pick(enemies);
      const n = S.nav.nearest(e.x + U.rand(-4, 4), e.y, e.z + U.rand(-3, 3));
      return n ? { x: n.x, y: n.y, z: n.z, kind: "hunt" } : { x: e.x, y: e.y, z: e.z, kind: "hunt" };
    }
    const h = U.pick(S.map.hotspots);
    return { x: h.x, y: h.y, z: h.z, kind: "wander" };
  }

  function botThink(S, p, dt) {
    const ai = p.ai, D = S.D, A = p.act;
    clearAct(A);
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) { ai.thinkT = 0.12; perceive(S, p); }
    let tgt = ai.target >= 0 ? S.players[ai.target] : null;
    if (tgt && !tgt.alive) { tgt = null; ai.target = -1; ai.visible = false; }
    p.wantJump = false;
    if (S.phase !== "live") { p.wishX = 0; p.wishZ = 0; return; }
    // The standing objective (a point, a pickup, a place to search) persists
    // through fights: on turf they keep pushing for the point while shooting.
    ai.goalT -= dt;
    if (!ai.goal || ai.goalT <= 0 || (ai.goal.kind === "pickup" && Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < 0.8) ||
        (p.carry && ai.goal.kind !== "deliver") || (!p.carry && ai.goal.kind === "deliver")) {
      ai.goal = botGoal(S, p); ai.goalT = ai.goal.kind === "hunt" ? 3 + Math.random() * 2 : 10 + Math.random() * 6; ai.waited = false;
    }
    const P = ai.goal && ai.goal.P ? ai.goal.P : null;
    const Pst = P ? S.pt[S.map.points.indexOf(P)] : null;
    const inZone = P && Math.hypot(p.x - P.x, p.z - P.z) < P.r - 0.6 && Math.abs(p.y - P.y) < 1.5;
    if (P && (Pst.state === "cool" || p.carry || (Pst.state === "packed" && Pst.bags <= 0))) ai.goalT = 0;

    let faceYaw = null, facePitch = 0, goal = null, direct = false, sprint = false, strafe = 0, close = false, holding = false;
    const w = WP[p.cur], st = p.inv[p.cur];
    if (tgt && ai.visible) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dy = tgt.y - p.y, d = Math.hypot(dx, dz);
      close = d < 6;
      // The right gun for the range; sights up beyond close range.
      const want = pickWeapon(p, d);
      if (want !== p.cur && p.cur !== 5 && p.switchT <= 0 && (p.reloadT <= 0 || st.mag <= 0)) A.sel = want;
      A.aim = d > 10 && p.cur !== 2 && p.cur !== 5;
      // Aim point: chest (sometimes the head), led for slow rockets, feet for splash.
      let ay = tgt.y + (Math.random() < D.head ? C.headY : 1.15), lead = 0;
      if (p.cur === 4) { ay = tgt.y + 0.3; lead = d / WP[4].speed; }
      const ax = tgt.x + tgt.vx * lead, az = tgt.z + tgt.vz * lead;
      const ex = p.x, ey = p.y + C.eye, ez = p.z;
      // Aim wobble that drifts (worse against a target on the move).
      ai.errT -= dt;
      if (ai.errT <= 0) {
        ai.errT = 0.25 + Math.random() * 0.3;
        const k = D.err * (1 + Math.hypot(tgt.vx, tgt.vz) / 6);
        ai.ex = U.gauss() * k; ai.ey = U.gauss() * k * 0.7;
      }
      const hd = Math.hypot(ax - ex, az - ez);
      faceYaw = Math.atan2(az - ez, ax - ex) + ai.ex;
      facePitch = Math.atan2(ay - ey, hd) + ai.ey;
      if (p.cur === 5) facePitch = Math.atan2(ay - ey, hd) + 0.08 + hd * 0.012;
      if (ai.react > 0) ai.react -= dt;
      else {
        const dyaw = Math.abs(U.wrap(faceYaw - p.yaw)), dpit = Math.abs(facePitch - p.pitch);
        const tol = Math.max(0.025, 0.55 / Math.max(1, d));
        const aligned = dyaw < tol * 1.6 && dpit < tol * 1.6;
        if (d < 2.0 && Math.abs(dy) < 1.3 && p.meleeCd <= 0) A.melee = true;
        else if (d > 2.4 && d < 5 && Math.abs(dy) < 1 && p.throwCd <= 0 && Math.random() < dt * (0.15 + ai.pers.aggro * 0.4)) A.grab = true;
        else if (aligned && p.switchT <= 0) {
          if (w.auto) {
            // Short bursts, then a breath (longer for worse bots).
            if (ai.restT > 0) ai.restT -= dt;
            else {
              A.fire = true; ai.burstT += dt;
              if (ai.burstT > 0.25 + D.burst * 0.9) { ai.burstT = 0; ai.restT = 0.2 + (1 - D.burst) * 0.5; }
            }
          } else if (p.fireCd <= 0) {
            ai.cadT -= dt;
            if (ai.cadT <= 0) { A.firePressed = true; ai.cadT = (1 - D.burst) * 0.25 + Math.random() * 0.12; }
          }
        }
        // A grenade now and then when they're at throwing range.
        if (p.cur !== 5 && p.inv[5].mag > 0 && d > 7 && d < 22 && Math.random() < D.nade * dt * (0.5 + ai.pers.aggro)) { A.sel = 5; ai.nadeT = 1.2; }
        if (p.cur === 5 && aligned && p.fireCd <= 0) A.firePressed = true;
      }
      if (p.cur === 5) { ai.nadeT -= dt; if (ai.nadeT <= 0) A.sel = pickWeapon(p, d); }
      // Keep to the gun's range: close in, back off, or strafe. With a point
      // to take, head for it (or hold it) instead.
      const pref = WP[p.cur].pref * (0.8 + ai.pers.aggro * 0.4);
      const grab = ai.goal && ai.goal.kind === "pickup" && Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < 14;
      if (grab) goal = ai.goal;            // gear close by: grab it mid-fight
      else if (p.carry) goal = ai.goal;     // a bag on your back: keep running home while you shoot
      else if (P && !inZone) goal = ai.goal;
      else if (P && inZone) goal = null;
      else if (d > pref + 6) { goal = tgt; direct = ai.direct; sprint = d > pref + 14; }
      else if (d < pref - 5 && p.cur !== 2) {
        const n = S.nav.nearest(p.x - dx / d * 4, p.y, p.z - dz / d * 4);
        if (n) goal = n;
      }
      strafe = p.carry ? D.strafe * 0.3 : D.strafe;
      if (!goal) {
        // Holding ground: careful ones crouch to fight from here.
        holding = d > 12 && ai.pers.aggro < 0.5 && p.cur !== 2 && p.cur !== 5;
        goal = { x: p.x + Math.cos(faceYaw + Math.PI / 2) * ai.strafeDir * 2, y: p.y, z: p.z + Math.sin(faceYaw + Math.PI / 2) * ai.strafeDir * 2 };
        if (inZone && Math.hypot(goal.x - P.x, goal.z - P.z) > P.r - 0.8) { goal.x = P.x; goal.z = P.z; }
        direct = true;
      }
    } else if (ai.lastSeen && S.t - ai.lastSeen.t < 4.5 && !P && !p.carry) {
      goal = ai.lastSeen; sprint = true;
      faceYaw = Math.atan2(goal.z - p.z, goal.x - p.x);
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 1.5 && Math.abs(goal.y - p.y) < 1.5) ai.lastSeen = null;
    } else {
      // Nothing in sight: reload, then go somewhere useful.
      if (st.mag < WP[p.cur].mag * 0.6 && st.res > 0 && p.reloadT <= 0 && w.kind !== "grenade") A.reload = true;
      if (p.cur === 5) A.sel = bestWithAmmo(p);
      // (A pickup is only taken within ~1.1 m: walk right up to it before standing about.)
      const arrived = Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < (ai.goal.kind === "pickup" ? 0.8 : 1.6) && Math.abs(ai.goal.y - p.y) < 1.2;
      if ((arrived || inZone) && ai.waitT <= 0 && !ai.waited) {
        // Hold the spot a moment, looking around (at a point, until it's ours).
        ai.waitT = P ? U.rand(6, 8) : U.rand(0.5, 2.2); ai.waited = true; ai.lookYaw = p.yaw + U.rand(-1.6, 1.6);
      }
      if (ai.waitT > 0) {
        ai.waitT -= dt;
        if (ai.waitT <= 0) ai.goalT = 0;
        p.wishX = 0; p.wishZ = 0;
        if (Math.random() < dt * 0.8) ai.lookYaw = p.yaw + U.rand(-1.8, 1.8);
        p.yaw = U.turnTo(p.yaw, ai.lookYaw, 2.2 * dt);
        p.pitch *= 0.9;
        return;
      }
      if (ai.waited && !P) ai.goalT = 0;
      goal = ai.goal;
      sprint = Math.hypot(goal.x - p.x, goal.z - p.z) > 10;
    }

    if (goal) navTo(S, p, goal, direct, dt);
    else { p.wishX = 0; p.wishZ = 0; }

    if (strafe > 0 && (p.wishX || p.wishZ)) {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.35 + Math.random() * 0.6; ai.strafeDir = Math.random() < 0.5 ? -1 : 1; }
      const s = strafe * 0.8 * ai.strafeDir;
      const wx = p.wishX - p.wishZ * s, wz = p.wishZ + p.wishX * s;
      const m = Math.hypot(wx, wz) || 1;
      p.wishX = wx / m; p.wishZ = wz / m;
    }

    // Stuck? Hop and take a step sideways, then re-plan.
    ai.stuckT += dt;
    if (ai.stuckT > 1.0) {
      const moved = Math.hypot(p.x - ai.chkX, p.z - ai.chkZ);
      if (moved < 0.35 && Math.hypot(p.wishX, p.wishZ) > 0.5) {
        p.wantJump = true; ai.path = null; ai.unstuck = 0.5; ai.unstuckYaw = Math.random() * Math.PI * 2;
        ai.goal = null;
      }
      ai.stuckT = 0; ai.chkX = p.x; ai.chkZ = p.z;
    }
    if (ai.unstuck > 0) {
      ai.unstuck -= dt;
      p.wishX = Math.cos(ai.unstuckYaw); p.wishZ = Math.sin(ai.unstuckYaw);
    }
    p.wantSprint = sprint && !(tgt && ai.visible);
    p.crouch = holding;

    if (faceYaw === null && (p.wishX || p.wishZ)) { faceYaw = Math.atan2(p.wishZ, p.wishX); facePitch = 0; }
    const turn = D.turn * (close ? 1.6 : 1) * dt;
    if (faceYaw !== null) p.yaw = U.turnTo(p.yaw, faceYaw, turn);
    p.pitch += U.clamp(facePitch - p.pitch, -turn, turn);
  }
})(globalThis.SP);
