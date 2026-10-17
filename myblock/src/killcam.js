// Kill cam. The game keeps the last ~4 s of every player's movement (30 frames
// a second) and of the shots, flashes, blasts and knockouts. When you're knocked
// out by someone, it replays the 2.6 s before it from over your killer's
// shoulder (you see them line up the shot and you go down), then hands back to
// the live death camera that watches them until you respawn. It fits inside
// the normal respawn time. Click, Space or FIRE skips it.
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const U = SP.U;
  const K = { on: true, frames: [], events: [], cur: null, tick: 0 };
  const F = 16;                       // numbers per player per frame
  const KEEP = 4, LEN = 2.6, DELAY = 0.45, TAIL = 0.35;

  K.reset = function () { K.frames.length = 0; K.events.length = 0; K.cur = null; };

  // Every fixed step during a match.
  K.record = function (sim) {
    if (++K.tick % 2) return;
    const n = sim.players.length, a = new Float32Array(n * F);
    for (let i = 0; i < n; i++) {
      const p = sim.players[i], o = i * F;
      a[o] = p.x; a[o + 1] = p.y; a[o + 2] = p.z; a[o + 3] = p.yaw; a[o + 4] = p.pitch || 0; a[o + 5] = p.vx; a[o + 6] = p.vz;
      a[o + 7] = (p.alive ? 1 : 0) | (p.onGround ? 2 : 0) | (p.sprinting ? 4 : 0) | (p.aiming ? 8 : 0) | (p.reloadT > 0 ? 16 : 0) | (p.crouch ? 32 : 0);
      a[o + 8] = p.cur; a[o + 9] = p.airT || 0; a[o + 10] = 0; a[o + 11] = 0; a[o + 12] = p.attackT;
      a[o + 13] = p.lastFireT !== undefined ? p.lastFireT : -99; a[o + 14] = p.vy || 0; a[o + 15] = p.hp;
    }
    K.frames.push({ t: sim.t, a: a });
    while (K.frames.length && K.frames[0].t < sim.t - KEEP) K.frames.shift();
    while (K.events.length && K.events[0].t < sim.t - KEEP) K.events.shift();
  };
  K.note = function (sim, e) {
    if (e.type === "fire" || e.type === "shot" || e.type === "kill" || e.type === "boom") K.events.push({ t: sim.t, e: e });
  };

  // You were knocked out (event e). Returns true if there's a replay to show.
  K.begin = function (sim, e) {
    K.cur = null;
    if (!K.on || e.killer < 0 || e.killer === e.victim || !sim.players[e.killer] || K.frames.length < 10) return false;
    const kt = sim.t, from = kt - LEN;
    const frames = K.frames.filter(function (f) { return f.t >= from - 0.1 && f.t <= kt + 0.2; });
    if (frames.length < 6) return false;
    const killer = sim.players[e.killer];
    const proxy = {
      t: from, factions: sim.factions, mode: sim.mode, map: sim.map, humanId: -1, isEnemy: sim.isEnemy,
      players: sim.players.map(function (p) {
        return { id: p.id, name: p.name, team: p.team, bot: p.bot, alive: true, x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0,
          vx: 0, vy: 0, vz: 0, onGround: true, sprinting: false, aiming: false, reloadT: 0, cur: 1, airT: 0,
          attackT: -99, lastFireT: -99, spawnT: 9, hp: 100 };
      })
    };
    // The killer's health when it happened (from the last recorded frame).
    const last = frames[frames.length - 1].a;
    K.cur = {
      killer: e.killer, victim: e.victim, w: e.w, how: e.how, hs: e.hs, name: killer.name, team: killer.team,
      hp: Math.max(0, Math.round(last[e.killer * F + 15])),
      from: frames[0].t, to: kt, el: 0, fi: 0, ei: 0, done: false, proxy: proxy, frames: frames,
      events: K.events.filter(function (v) { return v.t >= frames[0].t && v.t <= kt + 0.2; }), cam: null
    };
    return true;
  };
  K.replaying = function () { return !!(K.cur && !K.cur.done && K.cur.el >= DELAY); };
  K.pending = function () { return !!(K.cur && !K.cur.done); };
  K.skip = function () { if (K.cur) K.cur.done = true; };
  K.stop = function () { K.cur = null; };

  // Advance the replay; true while it's showing.
  K.update = function (dt) {
    const c = K.cur;
    if (!c || c.done) return false;
    c.el += dt;
    if (c.el < DELAY) return false;
    const rt = c.from + (c.el - DELAY);
    if (rt > c.to + TAIL) { c.done = true; return false; }
    fill(c, rt);
    // Replay what happened up to now: shots, flashes, blasts, the knockout.
    while (c.ei < c.events.length && c.events[c.ei].t <= rt) { play(c, c.events[c.ei].e); c.ei++; }
    return true;
  };

  function fill(c, rt) {
    const fr = c.frames;
    while (c.fi + 1 < fr.length - 1 && fr[c.fi + 1].t <= rt) c.fi++;
    const A = fr[c.fi], B = fr[Math.min(fr.length - 1, c.fi + 1)];
    const u = B.t > A.t ? U.clamp((rt - A.t) / (B.t - A.t), 0, 1) : 0;
    const P = c.proxy;
    P.t = rt;
    P.players.forEach(function (p, i) {
      const o = i * F, a = A.a, b = B.a;
      if (o + F > a.length || o + F > b.length) return;
      p.x = a[o] + (b[o] - a[o]) * u; p.y = a[o + 1] + (b[o + 1] - a[o + 1]) * u; p.z = a[o + 2] + (b[o + 2] - a[o + 2]) * u;
      p.yaw = a[o + 3] + U.wrap(b[o + 3] - a[o + 3]) * u; p.pitch = a[o + 4] + (b[o + 4] - a[o + 4]) * u;
      p.vx = a[o + 5]; p.vz = a[o + 6]; p.vy = a[o + 14];
      const fl = u < 0.5 ? a[o + 7] : b[o + 7];
      p.alive = !!(fl & 1); p.onGround = !!(fl & 2); p.sprinting = !!(fl & 4); p.aiming = !!(fl & 8); p.reloadT = fl & 16 ? 0.5 : 0; p.crouch = !!(fl & 32);
      p.cur = a[o + 8] | 0; p.airT = a[o + 9]; p.attackT = a[o + 12]; p.lastFireT = a[o + 13];
      p.hp = a[o + 15];
      p._px = p.x; p._py = p.y; p._pz = p.z;
    });
  }

  function muzzle(p) {
    const m = SP.Models.muzzle(p.id);
    if (m) return m;
    const d = U.dir(p.yaw, p.pitch), rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    return { x: p.x + d.x * 0.7 + rx * 0.18, y: p.y + 1.45 + d.y * 0.7, z: p.z + d.z * 0.7 + rz * 0.18 };
  }
  function play(c, e) {
    const V = SP.View, A = SP.Audio, P = c.proxy;
    const p = e.p !== undefined && e.p >= 0 ? P.players[e.p] : null;
    switch (e.type) {
      case "fire":
        if (!p) return;
        SP.Models.event(P, e);
        if (e.w <= 4) { const m = muzzle(p); A.gun(e.w, m.x, m.y, m.z, false); V.flash(m.x, m.y, m.z, e.w === 2 ? 0.75 : 0.5); }
        break;
      case "shot": {
        if (!p) return;
        const m = muzzle(p);
        V.tracer(m.x, m.y, m.z, e.x, e.y, e.z, false);
        break;
      }
      case "boom": V.explosion(e.x, e.y, e.z, e.r); A.emit("boom", e.x, e.y, e.z, { vol: 1.4, far: 1 }); break;
      case "kill": SP.Models.event(P, e); break;
    }
  }

  // Over the killer's shoulder, looking where they aim; pulled in if a wall is behind them.
  K.camera = function (sim, dt) {
    const c = K.cur, k = c.proxy.players[c.killer];
    const yaw = k.yaw, rx = -Math.sin(yaw), rz = Math.cos(yaw);
    const hx = k.x, hy = k.y + 1.7, hz = k.z;
    let tx = hx - Math.cos(yaw) * 3.1 + rx * 0.75, ty = hy + 0.6 - Math.sin(k.pitch) * 0.9, tz = hz - Math.sin(yaw) * 3.1 + rz * 0.75;
    const dx = tx - hx, dy = ty - hy, dz = tz - hz;
    const wh = sim.W.raycast(hx, hy, hz, dx, dy, dz, 1, true, false);
    if (wh) { const s = Math.max(0.15, wh.t - 0.12); tx = hx + dx * s; ty = hy + dy * s; tz = hz + dz * s; }
    // Ease the camera so recorded jitter doesn't shake it.
    if (!c.cam) c.cam = { x: tx, y: ty, z: tz };
    const e = Math.min(1, dt * 10);
    c.cam.x += (tx - c.cam.x) * e; c.cam.y += (ty - c.cam.y) * e; c.cam.z += (tz - c.cam.z) * e;
    const d = U.dir(yaw, k.pitch), ax = hx + d.x * 25, ay = hy + d.y * 25, az = hz + d.z * 25;
    const cx = c.cam.x, cy = c.cam.y, cz = c.cam.z;
    return { x: cx, y: cy, z: cz, yaw: Math.atan2(az - cz, ax - cx), pitch: Math.atan2(ay - cy, Math.hypot(ax - cx, az - cz)), roll: 0, fovAdd: -8 };
  };

  SP.KillCam = K;
})(globalThis.SP);
