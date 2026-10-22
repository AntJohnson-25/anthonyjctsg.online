// Your truck's crew, inside your truck (HS.Truck3D kitchen): you and your employees.
//  - Kitchen view: YOU walk the line with the arrow keys / the thumb wheel. Stand at a station and
//    press E (or tap the prompt) to fire the next ticket item that belongs there; stand at the
//    window when an order is bagged and E hands it over (the game's "HAND IT OVER", +tip bonus).
//    Clicking items on the paper chits still works exactly as before.
//  - Your employees walk to whichever station the game has them cooking on (Kitchen.auto) and
//    work it; when nothing's on they wait by the window.
//  - Park view: you stand in the window, serving.
// Everything here is local to the truck group, so the truck can sit anywhere in the park.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const KEYS = ["grill", "fryer", "prep"];
  const C = { g: null, truck: null, me: null, staff: [], prompt: null, near: null, clock: 0 };
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

  function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
  function turn(a, target, dt, k) {
    let d = target - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.yaw += d * Math.min(1, dt * (k || 9));
  }
  function mk(id) {
    if (!HS.Body.ready(id)) return null;
    const a = HS.makeActor(id);
    a.pos = new THREE.Vector3(); a.yaw = 0; a.vel = 0; a.ik = 0; a.ikWant = 0; a.at = null; a.phase = Math.random() * 9;
    return a;
  }
  function place(a) { a.root.position.copy(a.pos); a.root.rotation.y = a.yaw; }

  // Put the crew into (a freshly built) home truck group.
  C.attach = function (g, truck) {
    C.detach();
    C.g = g; C.truck = truck;
    const K = g.userData.k;
    C.me = mk(HS.PLAYER);
    if (C.me) { C.me.pos.copy(K.window); C.me.yaw = Math.PI; g.add(C.me.root); place(C.me); }
    C.syncStaff();
  };
  C.detach = function () {
    if (C.g) {
      if (C.me) C.g.remove(C.me.root);
      C.staff.forEach(function (s) { C.g.remove(s.root); });
    }
    C.me = null; C.staff = []; C.g = null; C.truck = null;
  };
  // One body per employee on the books (up to two: three stations, and you're the third).
  C.syncStaff = function () {
    if (!C.g || !C.truck) return;
    const K = C.g.userData.k;
    const want = Math.min(2, C.truck.staff.length);
    while (C.staff.length > want) C.g.remove(C.staff.pop().root);
    while (C.staff.length < want) {
      const a = mk(HS.STAFF[C.staff.length]);
      if (!a) break;
      a.pos.copy(K.rest[C.staff.length]); a.yaw = Math.PI;
      C.g.add(a.root); place(a);
      C.staff.push(a);
    }
    // the player body may have finished downloading after the truck was built
    if (!C.me) { C.me = mk(HS.PLAYER); if (C.me) { C.me.pos.copy(K.window); C.me.yaw = Math.PI; C.g.add(C.me.root); place(C.me); } }
  };

  // Keep inside the truck and out of the fridge.
  function collide(K, p) {
    p.x = THREE.MathUtils.clamp(p.x, K.bounds.x0, K.bounds.x1);
    p.z = THREE.MathUtils.clamp(p.z, K.bounds.z0, K.bounds.z1);
    K.solids.forEach(function (s) {
      if (p.x > s.x0 - 0.3 && p.x < s.x1 + 0.3 && p.z > s.z0 - 0.3 && p.z < s.z1 + 0.3) {
        const dx = Math.min(p.x - (s.x0 - 0.3), (s.x1 + 0.3) - p.x), dz = Math.min(p.z - (s.z0 - 0.3), (s.z1 + 0.3) - p.z);
        if (dx < dz) p.x = p.x - (s.x0 - 0.3) < (s.x1 + 0.3) - p.x ? s.x0 - 0.3 : s.x1 + 0.3;
        else p.z = p.z - (s.z0 - 0.3) < (s.z1 + 0.3) - p.z ? s.z0 - 0.3 : s.z1 + 0.3;
      }
    });
  }
  // Walk an actor straight to a local point (the aisle is clear); true while moving.
  function walk(a, to, dt, speed) {
    const dx = to.x - a.pos.x, dz = to.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.08) return false;
    const st = Math.min(d, speed * dt);
    a.pos.x += dx / d * st; a.pos.z += dz / d * st;
    turn(a, yawTo(dx, dz), dt, 10);
    return true;
  }
  // Cooking hands over a station top: one hand working (flip / stir / chop), the other steadying.
  function workHands(a, key, dt) {
    a.ik += ((a.ikWant || 0) - a.ik) * Math.min(1, dt * 6);
    if (a.ik < 0.01 || !key) return;
    const K = C.g.userData.k;
    a.root.updateMatrixWorld(true);
    const top = C.g.localToWorld(_v.copy(K.top[key]));
    const t = C.clock * 7 + a.phase;
    const fwd = _w.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).transformDirection(C.g.matrixWorld);
    const right = _u.set(-fwd.z, 0, fwd.x);
    const scale = HS.U;
    const R = top.clone().addScaledVector(right, (0.18 + Math.sin(t * 0.37) * 0.12) * scale)
      .addScaledVector(fwd, -0.1 * scale).add(new THREE.Vector3(0, (0.06 + Math.abs(Math.sin(t)) * (key === "prep" ? 0.09 : 0.05)) * scale, 0));
    const L = top.clone().addScaledVector(right, -0.22 * scale).addScaledVector(fwd, -0.14 * scale).add(new THREE.Vector3(0, 0.04 * scale, 0));
    HS.Rig.reach(a, "Right", R, new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.7), a.ik);
    HS.Rig.reach(a, "Left", L, new THREE.Vector3(0, -1, 0).addScaledVector(right, -0.7), a.ik * 0.85);
  }
  // Handing a bag out of the window: both hands forward.
  function serveHands(a, w) {
    if (w < 0.01) return;
    a.root.updateMatrixWorld(true);
    const fwd = _w.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)).transformDirection(C.g.matrixWorld);
    const right = _u.set(-fwd.z, 0, fwd.x);
    const chest = a.b.bonePos("Spine2", new THREE.Vector3());
    const at = chest.addScaledVector(fwd, 0.55 * HS.U).add(new THREE.Vector3(0, -0.1 * HS.U, 0));
    HS.Rig.reach(a, "Right", at.clone().addScaledVector(right, 0.12 * HS.U), new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.6), w);
    HS.Rig.reach(a, "Left", at.clone().addScaledVector(right, -0.12 * HS.U), new THREE.Vector3(0, -1, 0).addScaledVector(right, -0.6), w);
  }

  /* ------------------------------------------------------------------ what E does right here */
  function nearest(K) {
    if (!C.me) return null;
    let best = null, bd = 1.25;
    KEYS.forEach(function (k) { const d = Math.hypot(C.me.pos.x - K.work[k].x, C.me.pos.z - K.work[k].z); if (d < bd) { bd = d; best = k; } });
    const dw = Math.hypot(C.me.pos.x - K.window.x, C.me.pos.z - K.window.z);
    if (dw < Math.min(bd, 1.6)) best = "window";
    return best;
  }
  // The ticket item E would fire at station `key`, if any.
  function nextFor(key) {
    if (Kitchen.stations[key]) return null;
    for (const tk of Kitchen.tickets) for (const o of tk.items) if (o.status === "wait" && o.it.station === key) return { tk: tk, o: o };
    // nothing that belongs here: improvise with anything whose own station is busy (as the rail does)
    for (const tk of Kitchen.tickets) for (const o of tk.items) if (o.status === "wait" && Kitchen.stations[o.it.station]) return { tk: tk, o: o };
    return null;
  }
  function readyTicket() { return Kitchen.tickets.find(function (tk) { return tk.ready; }) || null; }
  C.act = function () {
    if (World.mode !== "kitchen" || !C.near) return false;
    if (C.near === "window") {
      const tk = readyTicket();
      if (!tk) return false;
      C.me.serveT = 0.6;
      Kitchen.serve(tk, 0.12);
      return true;
    }
    const n = nextFor(C.near);
    if (!n) return false;
    Kitchen.assign(n.tk, n.o);
    return true;
  };
  function updatePrompt(mode) {
    if (!C.prompt) {
      C.prompt = document.createElement("button");
      C.prompt.className = "interact"; C.prompt.hidden = true;
      C.prompt.addEventListener("click", function () { C.act(); });
      document.getElementById("hud").appendChild(C.prompt);
    }
    let label = "";
    if (mode === "kitchen" && C.near) {
      const tap = HS.Input.touch;
      if (C.near === "window") {
        const tk = readyTicket();
        if (tk) label = (tap ? "" : "<kbd>E</kbd> ") + "Hand over · " + money(tk.total, 1);
      } else {
        const n = nextFor(C.near);
        if (n) label = (tap ? "" : "<kbd>E</kbd> ") + "Cook " + (n.o.qty > 1 ? n.o.qty + "× " : "") + n.o.it.name;
        else if (Kitchen.stations[C.near]) label = "<span>" + Kitchen.stations[C.near].o.it.name + " cooking…</span>";
      }
    }
    C.prompt.hidden = !label;
    if (label && C.prompt.dataset.l !== label) { C.prompt.innerHTML = label; C.prompt.dataset.l = label; }
  }

  /* ------------------------------------------------------------------ per frame */
  C.update = function (dt, mode, camYaw) {
    C.clock += dt;
    if (!C.g || !C.g.parent) { updatePrompt(null); return; }
    const K = C.g.userData.k;
    if (C.me && C.me.id !== HS.PLAYER) { C.g.remove(C.me.root); C.me = null; }     // a new character was picked
    if (C.staff.length !== Math.min(2, C.truck.staff.length) || !C.me) C.syncStaff();
    const busy = {};
    KEYS.forEach(function (k) { if (Kitchen.stations[k]) busy[k] = true; });

    // ---- you
    const me = C.me;
    if (me) {
      const px = me.pos.x, pz = me.pos.z;
      if (mode === "kitchen") {
        const I = HS.Input.read();
        const m = Math.min(1, Math.hypot(I.x, I.z));
        me.vel += (m * (I.brisk ? 5.2 : 3.6) - me.vel) * Math.min(1, dt * 8);
        if (m > 0.05) {
          // the stick is relative to the camera; the truck may be turned any way in the park
          const cy = camYaw - C.g.rotation.y;
          const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
          turn(me, yawTo(fx * -I.z + rx * I.x, fz * -I.z + rz * I.x), dt, 12);
        }
        if (me.vel > 0.05) { me.pos.x += -Math.sin(me.yaw) * me.vel * dt; me.pos.z += -Math.cos(me.yaw) * me.vel * dt; collide(K, me.pos); }
      } else {
        // park view: you go back to the window and serve
        if (!walk(me, K.window, dt, 3.2)) turn(me, Math.PI, dt, 6);
      }
      C.near = mode === "kitchen" ? nearest(K) : null;
      // at a busy station (or one you just fired) your hands work it; face the station
      const at = C.near && C.near !== "window" ? C.near : null;
      me.ikWant = at && busy[at] && me.vel < 0.4 ? 1 : 0;
      if (me.ikWant) turn(me, 0, dt, 8);
      me.at = me.ikWant ? at : null;
      place(me);
      me.gait(Math.hypot(me.pos.x - px, me.pos.z - pz), dt);
      me.b.update(dt);
      workHands(me, me.at || me.lastAt, dt);
      if (me.at) me.lastAt = me.at;
      me.serveT = Math.max(0, (me.serveT || 0) - dt);
      serveHands(me, Math.min(1, me.serveT * 4));
    }

    // ---- your employees: one to each busy station you're not working
    const free = KEYS.filter(function (k) { return busy[k] && !(me && me.at === k); });
    const taken = {};
    C.staff.forEach(function (s) { if (s.job && free.indexOf(s.job) >= 0 && !taken[s.job]) taken[s.job] = s; else s.job = null; });
    free.forEach(function (k) {
      if (taken[k]) return;
      let best = null, bd = 1e9;
      C.staff.forEach(function (s) { if (s.job) return; const d = Math.hypot(s.pos.x - K.work[k].x, s.pos.z - K.work[k].z); if (d < bd) { bd = d; best = s; } });
      if (best) { best.job = k; taken[k] = best; }
    });
    C.staff.forEach(function (s, i) {
      const px = s.pos.x, pz = s.pos.z;
      let moving;
      if (s.job) {
        const w = K.work[s.job];
        // shuffle aside if you're standing on the spot
        const to = me && Math.hypot(me.pos.x - w.x, me.pos.z - w.z) < 0.6 ? new THREE.Vector3(w.x + 0.7, w.y, w.z) : w;
        moving = walk(s, to, dt, 3.4);
        if (!moving) turn(s, 0, dt, 8);
      } else {
        moving = walk(s, K.rest[i], dt, 2.6);
        if (!moving) turn(s, Math.PI, dt, 5);
      }
      s.ikWant = s.job && !moving ? 1 : 0;
      place(s);
      s.gait(Math.hypot(s.pos.x - px, s.pos.z - pz), dt);
      s.b.update(dt);
      workHands(s, s.job || s.lastJob, dt);
      if (s.job) s.lastJob = s.job;
    });

    updatePrompt(mode);
  };

  // Where you are, in the world (the kitchen camera follows this).
  C.mePos = function (out) {
    if (!C.me || !C.g) return null;
    return C.g.localToWorld((out || new THREE.Vector3()).copy(C.me.pos));
  };
  HS.Crew = C;
})(globalThis.HS);
