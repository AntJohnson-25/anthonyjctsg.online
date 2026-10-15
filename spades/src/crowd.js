// Everyone on the terrace when you're not at a table, and you walking about.
//  - Each table's crew (three of the user's characters) sits at it, idling, now and
//    then clapping or throwing their arms up; a game's worth of cards lies on the felt.
//  - A few more people sit round the fire pit and stand at the bar.
//  - You are Ant: walk with WASD / arrows (or the stick on a phone), drag to turn the
//    camera; walk up to a table's empty chair and sit down to play.
// When you sit at table k, that table's crew is handed to the card game (seats.js
// draws them, in the same chairs) and hidden here; they come back when you stand up.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const Room = HS.Room, Body = HS.Body, U = HS.U;
  const C = { people: [], decor: [], ant: null, pos: new THREE.Vector3(), yaw: 0, speed: 0, near: -1, hidden: -1, ready: false };
  const WALK = 1.45, BRISK = 2.1;   // m/s
  const _v = new THREE.Vector3();

  // Seat a body: sitting clip, hips over the chair at (x, z), facing yaw.
  function seat(b, x, z, yaw, seatY) {
    b.play("sit", { fade: 0, t: Math.random() * 4 });
    b.update(0);
    b.root.position.set(x, 0, z);
    b.root.rotation.y = yaw;
    b.root.updateMatrixWorld(true);
    const hp = b.bonePos("Hips", new THREE.Vector3());
    // Line the hips up over the chair, a little back from its middle.
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.06);
    b.root.position.x += x - (hp.x - Room.world.position.x) + back.x;
    b.root.position.z += z - (hp.z - Room.world.position.z) + back.z;
    const want = (seatY + 0.15) - hp.y;
    b.root.position.y = Math.abs(want) < 0.3 ? want : 0;
  }
  function person(id, o) {
    const b = Body.make(id, HS.heightOf(id));
    Room.world.add(b.root);
    const p = { b: b, id: id, kind: o.kind, table: o.table, s: o.s, next: 4 + Math.random() * 12, every: o.kind === "crew" ? 1 : 2, tick: Math.random() };
    if (o.kind === "stand") {
      b.play(o.clip || HS.idleOf(id), { fade: 0, t: Math.random() * 6 });
      b.root.position.set(o.x, 0, o.z); b.root.rotation.y = o.yaw;
    } else seat(b, o.x, o.z, o.yaw, o.seatY || Room.CHAIR_SEAT_Y);
    C.people.push(p);
    return p;
  }

  // A game left mid-way on each table: a deck, a few tricks won, cards in the middle.
  function decor() {
    const geo = new THREE.BoxGeometry(0.08, 0.002, 0.112);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const n = 16;
    Room.TABLES.forEach(function (T, k) {
      const im = new THREE.InstancedMesh(geo, mat, n);
      const d = new THREE.Object3D(), col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        let x, z, h, rot;
        if (i < 4) { const a = i * Math.PI / 2 + 0.3; x = Math.sin(a) * 0.16; z = Math.cos(a) * 0.16; h = 0.002; rot = a + (i * 0.37); col.setHex(0xf6f2e8); }
        else if (i < 10) { const s = (i - 4) % 3 + 1, a = s * Math.PI / 2; x = -Math.sin(a) * 0.48 + Math.cos(a) * 0.2; z = Math.cos(a) * 0.48 + Math.sin(a) * 0.2; h = 0.002 + ((i - 4) / 3 | 0) * 0.004; rot = -a + 0.3; col.setHex([0x8a1c2a, 0x1c3a8a, 0x8a1c2a][s - 1]); }
        else { x = 0.34; z = -0.3; h = 0.002 + (i - 10) * 0.004; rot = 0.6; col.setHex(0x8a1c2a); }
        d.position.set(T.x + x, Room.TABLE_Y + h, T.z + z);
        d.rotation.set(0, rot, 0);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, col);
      }
      im.castShadow = true; im.receiveShadow = true;
      Room.world.add(im);
      C.decor[k] = im;
    });
  }

  // ------------------------------------------------------------------ setting up
  C.ids = function () {
    const ids = { Ant: 1 };   // (every character loads anyway: the character select shows them all)
    HS.CREWS.forEach(function (c) { c.forEach(function (x) { ids[x.id] = 1; }); });
    HS.EXTRAS.forEach(function (x) { ids[x.id] = 1; });
    return Object.keys(ids);
  };
  C.init = function () {
    decor();
    HS.CREWS.forEach(function (crew, k) {
      const T = Room.TABLES[k];
      crew.forEach(function (m, i) {
        const s = i + 1, p = Room.seatPos(s, Room.SEAT_R + 0.12);
        person(m.id, { kind: "crew", table: k, s: s, x: T.x + p.x, z: T.z + p.z, yaw: Room.seatYaw(s) });
      });
    });
    HS.EXTRAS.forEach(function (x) {
      const spot = (x.at === "lounge" ? Room.LOUNGE : Room.BAR)[x.i];
      if (x.at === "lounge") person(x.id, { kind: "lounge", x: spot[0], z: spot[1], yaw: spot[2], seatY: 0.46 });
      else person(x.id, { kind: "stand", x: spot[0], z: spot[1], yaw: spot[2], clip: x.clip });
    });
    C.ant = Body.make(HS.PLAYER, HS.heightOf(HS.PLAYER));
    Room.world.add(C.ant.root);
    C.ant.play(HS.idleOf(HS.PLAYER), { fade: 0 });
    C.place(Room.SPAWN.x, Room.SPAWN.z, 0);
    C.ready = true;
  };
  // Stand Ant at (x, z) facing yaw (villa coordinates).
  C.place = function (x, z, yaw) {
    C.pos.set(x, 0, z); C.yaw = yaw; C.speed = 0;
    C.ant.root.position.copy(C.pos); C.ant.root.rotation.y = yaw;
    C.ant.play(HS.idleOf(HS.PLAYER), { fade: 0.2 });
  };
  // Table k's people go to the card game (hidden here), or come back (k = -1).
  C.handOver = function (k) {
    C.hidden = k;
    C.people.forEach(function (p) { if (p.kind === "crew") p.b.root.visible = p.table !== k; });
    C.decor.forEach(function (d, i) { d.visible = i !== k; });
    C.ant.root.visible = k < 0;
  };

  // ------------------------------------------------------------------ per frame
  // In: { dt, move: {x, z} (-1..1, camera-relative), brisk, camYaw, walking }
  C.update = function (o) {
    if (!C.ready) return;
    const dt = o.dt;
    // The crowd: crews and loungers idle, now and then a reaction.
    C.people.forEach(function (p) {
      if (!p.b.root.visible) return;
      p.next -= dt;
      if (p.next <= 0 && p.kind !== "stand") {
        p.next = 8 + Math.random() * 18;
        const r = Math.random();
        p.b.play(r < 0.65 ? "sitclap" : "sitwin", { fade: 0.4, loop: false });
        p.back = true;
      }
      if (p.back && p.b.done) { p.back = false; p.b.play("sit", { fade: 0.6 }); }
      // Loungers and drinkers animate every other frame (they barely move).
      p.tick += 1;
      if (p.every > 1 && (p.tick | 0) % p.every) { p.acc = (p.acc || 0) + dt; return; }
      p.b.update(dt + (p.acc || 0)); p.acc = 0;
    });
    if (!o.walking) return;
    // Ant.
    const mx = o.move.x, mz = o.move.z, m = Math.min(1, Math.hypot(mx, mz));
    const want = m * (o.brisk ? BRISK : WALK);
    C.speed += (want - C.speed) * Math.min(1, dt * 8);
    if (m > 0.05) {
      // Camera-relative: forward is where the camera looks.
      const fx = -Math.sin(o.camYaw), fz = -Math.cos(o.camYaw), rx = Math.cos(o.camYaw), rz = -Math.sin(o.camYaw);
      const dx = fx * -mz + rx * mx, dz = fz * -mz + rz * mx;
      const target = Math.atan2(-dx, -dz);
      let d = target - C.yaw;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      C.yaw += d * Math.min(1, dt * 10);
    }
    if (C.speed > 0.05) {
      C.pos.x += -Math.sin(C.yaw) * C.speed * dt;
      C.pos.z += -Math.cos(C.yaw) * C.speed * dt;
      Room.collide(C.pos, 0.32);
      // The walk clip's own pace (1.61 m/s on a 1.8 m body), so feet don't slide.
      // The walk clip's own pace: about 1.6 m/s at full size for both the male and female walks.
      C.ant.play(HS.walkOf(HS.PLAYER), { fade: 0.2, rate: C.speed / 1.55 });
    } else C.ant.play(HS.idleOf(HS.PLAYER), { fade: 0.3 });
    C.ant.root.position.copy(C.pos); C.ant.root.rotation.y = C.yaw;
    C.ant.update(dt);
    // Which table's empty chair are we next to?
    C.near = -1;
    let best = 2.4;
    Room.TABLES.forEach(function (T, k) {
      const d = Math.hypot(C.pos.x - T.x, C.pos.z - (T.z + 1.1));
      if (d < best) { best = d; C.near = k; }
    });
  };
  // Where the camera should look (scene coordinates): Ant's head-ish.
  C.focus = function (out) { return (out || _v).set(C.pos.x, 1.45, C.pos.z).add(Room.world.position); };
  // The crew at table k, as the card game's seats ({ name, look }), you in seat 0.
  C.crewSeats = function (k) {
    return [{ name: HS.CAST[HS.PLAYER].name, look: HS.PLAYER }].concat(HS.CREWS[k].map(function (m) { return { name: m.name, look: m.id }; }));
  };
  HS.Crowd = C;
})(globalThis.HS);
