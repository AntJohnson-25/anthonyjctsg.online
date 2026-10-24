// Rendering: the renderer, the camera director, the players (their avatars on the hidden driver skeletons), the bags,
// dust and confetti, and the floating name tags.
(function (SB) {
  "use strict";
  const T = globalThis.THREE;
  const CH = SB.Cornhole, C = CH.C, M = CH.M;
  const AL = Math.atan((C.HB - C.HF) / C.BL);
  const V = {};
  let renderer, scene, camera, W, sim, players = [], bagMesh = [], handBag = [null, null], tagBox, gfx = null;
  const camPos = new T.Vector3(0, 3, -9), camLook = new T.Vector3(0, 0.3, 4), tmpA = new T.Vector3(), tmpB = new T.Vector3();
  let camFov = 55, fx = null;
  const STATION_SPEED = 2.9;

  V.init = function (canvasEl, antialias) {
    renderer = new T.WebGLRenderer({ canvas: canvasEl, antialias: antialias !== false, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(55, 1.6, 0.1, 260);
    tagBox = document.getElementById("tags");
    addEventListener("resize", V.resize);
    V.resize();
  };
  V.resize = function () {
    if (!renderer) return;
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  V.applyGraphics = function (g) {
    if (!renderer || !g) return;
    gfx = g;
    prCap = pr = Math.min(globalThis.devicePixelRatio || 1, g.pixelRatio || 1); settle = 0; accT = 0; accN = 0; adaptOn = !!g.adaptive;
    renderer.setPixelRatio(pr);
    const on = g.shadows !== "off";
    renderer.shadowMap.enabled = on;
    renderer.shadowMap.type = g.shadows === "soft" ? T.PCFSoftShadowMap : T.PCFShadowMap;
    if (W && W.sun) {
      W.sun.castShadow = on;
      const sz = g.shadows === "soft" ? 2048 : 1024;
      if (W.sun.shadow.mapSize.x !== sz) { W.sun.shadow.mapSize.set(sz, sz); if (W.sun.shadow.map) { W.sun.shadow.map.dispose(); W.sun.shadow.map = null; } }
    }
    camera.far = 260 * Math.max(0.5, g.drawDistance || 1);
    if (scene && scene.fog) { scene.fog.near = 45 * (g.drawDistance || 1); scene.fog.far = 130 * (g.drawDistance || 1); }
    if (fx) fx.factor = g.particles === undefined ? 1 : g.particles;
    scene && scene.traverse(function (o) { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(function (m) { m.needsUpdate = true; }); } });
    camera.updateProjectionMatrix();
    V.resize();
  };

  // ---- set-up for a match
  V.start = function (s, info, imgs) {
    sim = s;
    W = SB.World.build(scene, imgs && imgs.seal, imgs && imgs.hl, gfx ? (gfx.shadows === "off" ? 0 : gfx.shadows === "soft" ? 2 : 1) : 1);
    // players: a driver skeleton each (the avatar hangs from it), stood at their spot already
    s.players.forEach(function (p, i) {
      const rig = SB.Rig.create(SB.World.SIDE_COL[p.side]);
      scene.add(rig.root);
      const st = { rig: rig, pos: new T.Vector3(), yaw: 0, vel: 0, throwT: -1, cheer: 0, slump: 0, look: 0, side: p.side, label: null };
      const el = document.createElement("div");
      el.className = "tag s" + p.side; el.textContent = p.name;
      tagBox.appendChild(el); st.label = el;
      players.push(st);
    });
    // bag meshes for a full round, plus one for each hand
    for (let i = 0; i < C.PER_SIDE * 2; i++) {
      const m = SB.World.makeBag(0); m.visible = false; scene.add(m); bagMesh.push(m);
    }
    handBag = [SB.World.makeBag(0), SB.World.makeBag(1)];
    handBag.forEach(function (m) { m.visible = false; scene.add(m); });
    fx = makeFx(); fx.factor = gfx && gfx.particles !== undefined ? gfx.particles : 1;
    V.snapStations();
    if (gfx) V.applyGraphics(gfx);
  };
  V.chars = () => players;
  V.yardInfo = () => (W && W.yard ? { yardTriangles: Math.round(W.yard.tris), bySection: W.yard.byLab } : null);

  // Put an avatar on player i's driver.  `tint` ({hue}) dresses a computer player in other colours.
  V.useAvatar = function (i, buffer, tint) {
    const st = players[i];
    if (!st || !SB.Avatar) return Promise.resolve(false);
    const p = st.rig.root.position.clone(), ry = st.rig.root.rotation.y;
    st.rig.root.position.set(0, 0, 0); st.rig.root.rotation.set(0, 0, 0); st.rig.root.updateMatrixWorld(true);
    return SB.Avatar.load(buffer, st.rig, tint).then(function (av) {
      if (av) { st.rig.avatar = av; st.rig.mesh.visible = false; st.rig.mesh.parts.forEach(function (m) { m.visible = false; }); }
      return !!av;
    }).finally(function () { st.rig.root.position.copy(p); st.rig.root.rotation.y = ry; st.rig.root.updateMatrixWorld(true); });
  };

  // ---- where everyone stands
  function stationOf(i) {
    // Everyone stands at their own end of the lane and never walks: the active thrower steps into the box (aim.x),
    // anyone else at that end waits beside it, and players at the other end watch from across the lane.
    const dir = sim.dirOf(i), p = sim.players[i], me = sim.activeWho();
    const z0 = -dir * C.STAND;
    if (i === me) return { x: sim.aim.x, z: z0 };
    const sgn = p.side === 0 ? dir : -dir;
    return { x: sgn * 1.75, z: z0 - dir * 0.35 };
  }
  V.snapStations = function () {
    players.forEach(function (st, i) { const s = stationOf(i); st.pos.set(s.x, 0, s.z); st.yaw = facing(0, sim.dirOf(i)); });
  };
  const facing = (yawAim, dir) => Math.atan2(-dir * Math.sin(yawAim), dir * Math.cos(yawAim));

  // ---- the frame
  // Automatic resolution: if frames take too long (a phone, an integrated GPU) the render scale steps down, a little at a
  // time, down to half; when there is headroom it climbs back up to the preset's own scale. Judged over 1.5 s windows.
  // Only for a preset that asks for it (Low, the phone default): Medium and High always render at their own full scale,
  // so characters and textures stay sharp. The floor is 0.7 of the screen.
  let prCap = 1, pr = 1, settle = 0, accT = 0, accN = 0, adaptOn = false;
  V.renderScale = () => pr;
  function adapt(dt) {
    if (!adaptOn || !renderer || document.hidden || dt <= 0) return;
    if ((settle += dt) < 3) return;                         // let the first seconds (shader compiles) pass
    accT += dt; accN++;
    if (accT < 1.5) return;
    const avg = accT / accN; accT = 0; accN = 0;
    let np = pr;
    if (avg > 0.036) np = Math.max(0.7, pr - 0.1);           // under ~28 fps
    else if (avg < 0.019 && pr < prCap) np = Math.min(prCap, pr + 0.1);
    if (np !== pr) { pr = np; renderer.setPixelRatio(pr); V.resize(); }
  }

  V.update = function (s, dt, now, ctx) {
    adapt(dt);
    const me = s.activeWho();
    const scored = s.phase === "scored", over = s.phase === "over";
    players.forEach(function (st, i) {
      const tgt = stationOf(i);
      tmpA.set(tgt.x - st.pos.x, 0, tgt.z - st.pos.z);
      const dist = tmpA.length();
      let moving = 0;
      if (dist > 0.03) {
        const step = Math.min(dist, STATION_SPEED * dt);
        st.pos.addScaledVector(tmpA, step / dist);
        moving = Math.min(1, dist / 0.5);
      }
      const active = i === me;
      let yawT;
      if (moving > 0.2 && dist > 0.4) yawT = Math.atan2(tmpA.x, tmpA.z);
      else if (active) yawT = facing(s.aim.yaw || 0, s.dirOf(i));
      else yawT = facing(0, s.dirOf(i)) + Math.sin(i * 1.7) * 0.12;
      let dy = yawT - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      st.yaw += dy * Math.min(1, dt * 9);
      if (st.throwT >= 0) { st.throwT += dt; if (st.throwT > 2.2) st.throwT = -1; }
      // celebrate / slump
      let cheerT = 0, slumpT = 0;
      if (scored && s.summary && s.summary.win >= 0) { if (st.side === s.summary.win) cheerT = 1; else slumpT = 0.5; }
      if (over) { if (st.side === s.winner) cheerT = 1; else slumpT = 1; }
      st.cheer += (cheerT - st.cheer) * Math.min(1, dt * 6); st.slump += (slumpT - st.slump) * Math.min(1, dt * 4);
      const a = s.aim || {};
      const charging = active && s.phase === "aim" && a.ch >= 0 && st.throwT < 0;
      const pose = {
        walk: moving, charge: charging ? a.ch : -1, throwT: st.throwT, cheer: st.cheer, slump: st.slump,
        aim: active && s.phase === "aim" && !charging && st.throwT < 0, look: active ? 0 : lookAtThrower(st, me)
      };
      st.rig.root.position.copy(st.pos); st.rig.root.rotation.y = st.yaw;
      SB.Rig.pose(st.rig, pose, dt);
    });

    // the bag in the thrower's hand
    handBag.forEach(function (m) { m.visible = false; });
    if (me >= 0 && (s.phase === "aim" || s.phase === "swing")) {
      const st = players[me], m = handBag[s.players[me].side];
      handPos(st, tmpB);
      m.position.copy(tmpB).add(tmpA.set(0, 0.03, 0));
      m.rotation.set(0, st.yaw, 0);
      m.visible = true;
    }
    // bags on the lawn / board / in flight
    for (let i = 0; i < bagMesh.length; i++) {
      const m = bagMesh[i], b = s.bags[i];
      if (!b || b.mode === M.VOID || b.mode === M.HAND) { m.visible = false; continue; }
      if (m.material !== undefined && m.userData.side !== b.side) { m.material = SB.World.makeBag(b.side).material; m.userData.side = b.side; }
      m.visible = true;
      m.position.set(b.x, b.y, b.z);
      m.quaternion.setFromEuler(tmpEuler.set(0, b.yaw, 0));
      if (b.mode === M.AIR) { m.quaternion.multiply(tmpQ.setFromAxisAngle(tmpA.set(1, 0, 0), b.fl)); }
      else if (b.mode === M.BOARD) { m.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpA.set(1, 0, 0), -b.dir * AL)); }
      else if (b.mode === M.FALL) { const k = Math.max(0, Math.min(1, (b.y - 0.05) / 0.3)); m.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpA.set(1, 0, 0), -b.dir * AL * k)); }
    }

    // aim guide: a line on the lawn along the throw (the player's own view)
    const g = W.guide;
    const mine = ctx && ctx.guide && me === s.me && s.phase === "aim";
    g.visible = !!mine;
    if (mine) {
      const r = CH.release(s.dirOf(me), { x: s.aim.x, yaw: s.aim.yaw, pit: s.aim.pit, p: 0.5, st: 0 });
      const len = 9.8;
      const dx = r.vx, dz = r.vz, hl = Math.hypot(dx, dz);
      g.scale.set(1, len, 1);
      g.position.set(r.x + dx / hl * len / 2, 0.012, r.z + dz / hl * len / 2);
      // the strip's length runs along local Y, which lies along -Z once the plane is laid flat
      g.quaternion.setFromEuler(tmpEuler.set(-Math.PI / 2, 0, 0)).premultiply(tmpQ.setFromAxisAngle(tmpA.set(0, 1, 0), Math.atan2(-dx, -dz)));
    }

    cameraStep(s, dt, me);
    if (W.yard) W.yard.update(dt, now);
    fx.update(dt);
    labels(s, me);
  };
  const tmpEuler = new T.Euler(), tmpQ = new T.Quaternion();

  function lookAtThrower(st, me) {
    if (me < 0) return 0;
    const i = players.indexOf(st);
    const dx = (players[me].pos.x - st.pos.x) * sim.dirOf(i);  // the character's left is +X when it faces +Z
    return Math.max(-0.7, Math.min(0.7, dx * 0.5));
  }
  // Where the bag sits: in the palm. A character's hand bone is its wrist, so the bag is pushed along the forearm past
  // it to the middle of the hand (about 9 cm), not left half-way up the forearm.
  const _fa = new T.Vector3();
  function handPos(st, out) {
    const av = st.rig.avatar;
    if (av && av.map && av.map[8] && av.map[7]) {
      av.map[8].getWorldPosition(out);
      av.map[7].getWorldPosition(_fa);
      out.addScaledVector(_fa.sub(out).normalize(), -0.095);       // forearm bone -> wrist, carried on past the wrist
    } else st.rig.B.RightHand.getWorldPosition(out);
    return out;
  }

  // ---- the camera director
  function cameraStep(s, dt, me) {
    // the lane end the camera works at: the active thrower's, or where the bag in flight is headed
    const lastBag = s.bags[s.bags.length - 1];
    const dir = me >= 0 ? s.dirOf(me) : lastBag ? lastBag.dir : s.dir;
    let pos, look, fov = 55;
    if (s.phase === "aim" || s.phase === "swing") {
      const th = me >= 0 ? players[me] : null, x = th ? th.pos.x : 0;
      // over the thrower's right shoulder, looking down the lane at the far board
      // (an upright phone: sit nearer the lane's centre line and a little higher, or the thrower falls off the left edge)
      const port = camera.aspect < 1;
      pos = tmpA.set(x * 0.8 - dir * (port ? 0.2 : 0.95), port ? 3.5 : 2.25, -dir * (C.STAND + (port ? 3.9 : 2.7)));
      look = tmpB.set(x * 0.15 - (s.aim.yaw || 0) * dir * 0.0, 0.12, dir * (C.LANE + 0.55));
      fov = 34;
    } else if (s.phase === "flight") {
      const bag = s.bags[s.bags.length - 1];
      // beside the lane, a few metres short of the board: follow the bag in the air, then the board
      pos = tmpA.set(3.3, 2.0, dir * (C.LANE - 4.2));
      look = tmpB.set(0, 0.28, dir * (C.LANE + 0.5));
      if (bag && bag.mode === M.AIR) look.set(bag.x * 0.7, Math.max(0.3, bag.y * 0.7), bag.z * 0.75 + dir * (C.LANE + 0.5) * 0.25);
      fov = 46;
    } else {
      pos = tmpA.set(8.7, 3.6, 0);
      look = tmpB.set(0, 0.2, 0);
      fov = 56;
    }
    const k = 1 - Math.exp(-dt * (s.phase === "aim" ? 3.2 : 2.6));
    camPos.lerp(pos, k); camLook.lerp(look, Math.min(1, k * 1.6));
    camFov += (fov - camFov) * k;
    const asp = camera.aspect;
    camera.fov = camFov * (asp < 1.45 ? Math.min(asp < 1 ? 1.85 : 1.5, 1.45 / asp) : 1);
    camera.updateProjectionMatrix();
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (W && W.sun) { W.sun.target.position.set(0, 0, 0); }
  }
  V.snapCamera = function () { const d = sim ? sim.dirOf(sim.me >= 0 ? sim.me : 0) : 1; camPos.set(0, 1.9, -d * (C.STAND + 3)); camLook.set(0, 0.25, d * (C.LANE + 0.45)); };

  // ---- name tags
  const proj = new T.Vector3();
  function labels(s, me) {
    players.forEach(function (st, i) {
      proj.set(st.pos.x, 1.98, st.pos.z).project(camera);
      const el = st.label, vis = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
      el.style.display = vis ? "" : "none";
      if (!vis) return;
      el.style.transform = "translate(-50%,-100%) translate(" + ((proj.x * 0.5 + 0.5) * innerWidth).toFixed(1) + "px," + ((-proj.y * 0.5 + 0.5) * innerHeight).toFixed(1) + "px)";
      el.classList.toggle("on", i === me);
      el.classList.toggle("you", i === s.me);
      el.classList.toggle("gone", !!s.players[i].left);
    });
  }

  V.render = function () { renderer.render(scene, camera); };

  // ---- game events -> dust, confetti
  V.event = function (s, e) {
    if (!fx) return;
    switch (e.t) {
      case "swing": { const st = players[e.who]; if (st) st.throwT = 0; break; }
      case "land": { const b = e.bag; fx.dust(b.x, b.y, b.z, Math.min(1, 0.4 + e.speed * 0.12)); break; }
      case "ground": fx.dust(e.bag.x, 0.05, e.bag.z, 0.8, true); break;
      case "bump": fx.dust(e.bag.x, e.bag.y, e.bag.z, 0.4); break;
      case "hole": fx.confetti(e.bag.x, 0.35, e.bag.z, e.air ? 46 : 26, e.bag.side); break;
      case "roundEnd": if (e.summary && e.summary.win >= 0) fx.confetti(0, 2.2, 0, 60, e.summary.win, true); break;
    }
  };

  function makeFx() {
    const N = 220, geo = new T.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("color", new T.BufferAttribute(col, 3));
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d"); const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    const mat = new T.PointsMaterial({ size: 0.16, map: new T.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new T.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    const P = [];
    for (let i = 0; i < N; i++) P.push({ life: 0, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, grav: 0, fade: 1 });
    let head = 0;
    const api = {
      factor: 1,
      emit: function (x, y, z, vx, vy, vz, life, rgb, grav) {
        const p = P[head]; head = (head + 1) % N;
        p.life = life; p.max = life; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.r = rgb[0]; p.g = rgb[1]; p.b = rgb[2]; p.grav = grav;
      },
      dust: function (x, y, z, k, grass) {
        const n = Math.round(10 * k * api.factor), tone = grass ? [0.45, 0.6, 0.3] : [0.85, 0.8, 0.7];
        for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 0.3 + Math.random() * 0.8 * k; api.emit(x, y + 0.03, z, Math.cos(a) * s, 0.3 + Math.random() * 0.7, Math.sin(a) * s, 0.5 + Math.random() * 0.4, tone, -1.2); }
      },
      confetti: function (x, y, z, n, side, wide) {
        n = Math.round(n * api.factor);
        const set = side ? [[1, 0.55, 0.15], [1, 0.85, 0.3], [1, 1, 1]] : [[0.25, 0.55, 1], [0.6, 0.85, 1], [1, 1, 1]];
        for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = (wide ? 3 : 1.2) * (0.4 + Math.random()); api.emit(x + (wide ? (Math.random() - 0.5) * 4 : 0), y, z + (wide ? (Math.random() - 0.5) * 5 : 0), Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, 1.2 + Math.random() * 0.9, set[i % 3], 9); }
      },
      update: function (dt) {
        for (let i = 0; i < N; i++) {
          const p = P[i];
          if (p.life > 0) {
            p.life -= dt; p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
            const f = Math.max(0, p.life / p.max);
            pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
            col[i * 3] = p.r * f + (1 - f) * 0.5; col[i * 3 + 1] = p.g * f + (1 - f) * 0.5; col[i * 3 + 2] = p.b * f + (1 - f) * 0.5;
            if (p.grav < 0) { col[i * 3] *= f; col[i * 3 + 1] *= f; col[i * 3 + 2] *= f; }   // dust fades out against the lawn
          } else { pos[i * 3 + 1] = -50; }
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      }
    };
    return api;
  }

  V.project = function (x, y, z) { proj.set(x, y, z).project(camera); return { x: (proj.x * 0.5 + 0.5) * innerWidth, y: (-proj.y * 0.5 + 0.5) * innerHeight, vis: proj.z < 1 }; };
  V.three = () => ({ renderer: renderer, scene: scene, camera: camera });
  SB.View = V;
})(globalThis.SB);
