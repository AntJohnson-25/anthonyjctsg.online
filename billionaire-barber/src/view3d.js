// The renderer and the camera. Two modes:
//  - "follow" (default, as in Spades): a chase camera over your barber; drag to turn it, wheel /
//    pinch to zoom. Arrow keys and the thumb wheel walk relative to where it looks (View.camYaw).
//    During a cut it closes in on the client's head (View.focus / unfocus).
//  - "overview": the whole shop from its open front, like a doll's house (V toggles).
// The camera is held inside the room's walls (the front is open, so it can back out of it).
// Quality steps down on its own if the frame rate sags (pixel ratio, then shadows).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const V = { scene: null, camera: null, renderer: null, S: null, w: 1, h: 1, mode: "follow", camYaw: 0 };
  const rig = { yaw: 0, pitchOff: 0, zoom: 1, idle: 0, dist: 10, pitch: 0.5, home: new THREE.Vector3(),
                cur: { yaw: 0, pitch: 0.5, dist: 10, tgt: new THREE.Vector3() } };
  const followAt = new THREE.Vector3();
  let focusAt = null, intro = 0;
  const debug = /[?&]debug=1/.test(location.search);
  let fpsAcc = 0, fpsN = 0, fpsLow = 0, quality = 2, fpsEl = null;

  V.init = function (canvas, stage) {
    V.stage = stage;
    const r = V.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia("(pointer: coarse)").matches ? 1.25 : 1.5));
    V.scene = new THREE.Scene();
    V.scene.background = new THREE.Color(0x07060a);
    V.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 120);
    V.scene.environment = envMap(r);
    V.actors = new THREE.Group(); V.scene.add(V.actors);
    resize();
    window.addEventListener("resize", resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    input(canvas);
    if (debug) { fpsEl = document.createElement("div"); fpsEl.style.cssText = "position:fixed;left:6px;bottom:70px;z-index:9999;font:11px monospace;color:#9f9;background:#000a;padding:2px 5px"; document.body.appendChild(fpsEl); }
  };

  // A soft studio environment for the chrome, gold and mirrors to reflect.
  function envMap(r) {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x2a221c, side: THREE.BackSide })));
    [[0, 4.8, 0, 8, 6, 0xfff0d8, -Math.PI / 2, 0], [-9.8, 2, 0, 6, 3, 0xffd9a8, 0, Math.PI / 2], [9.8, 2.5, -3, 4, 3, 0xbcd4ff, 0, -Math.PI / 2], [0, 2, 9.8, 10, 2, 0xffe6c4, 0, Math.PI]].forEach(function (p) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p[3], p[4]), new THREE.MeshBasicMaterial({ color: p[5] }));
      m.position.set(p[0], p[1], p[2]); m.rotation.set(p[6], p[7], 0); s.add(m);
    });
    const pm = new THREE.PMREMGenerator(r);
    const t = pm.fromScene(s, 0.04).texture;
    pm.dispose();
    return t;
  }

  function resize(force) {
    const w = V.stage.clientWidth || 1, h = V.stage.clientHeight || 1;
    if (force !== true && w === V.w && h === V.h) return;
    V.w = w; V.h = h;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
    fit();
  }

  // The overview's home: far enough back to take in the whole room.
  function fit() {
    const S = V.S;
    if (!S) return;
    const a = V.camera.aspect, vf = THREE.MathUtils.degToRad(36);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * a);
    const fitW = a < 0.95 ? Math.min(S.W, 4.6 + S.W * 0.12) : S.W + 1.0;
    rig.dist = Math.max((fitW / 2) / Math.tan(hf / 2) + S.D * 0.32, (S.D * 0.62) / Math.tan(vf / 2)) * 0.94;
    rig.pitch = S.kind === "large" ? 0.56 : 0.52;
    rig.home.set(0, 0.8, S.D * 0.06);
  }

  V.setShop = function (S, sweep) {
    if (V.S) V.scene.remove(V.S.group);
    V.S = S;
    V.scene.add(S.group);
    fit();
    // walking into a new shop: open on the overview from high up, then swing down behind you
    intro = sweep ? 2.2 : 0;
    rig.cur.yaw = sweep ? 0.45 : 0; rig.cur.pitch = rig.pitch + (sweep ? 0.25 : 0); rig.cur.dist = rig.dist * (sweep ? 1.4 : 1);
    rig.cur.tgt.copy(rig.home);
    rig.yaw = 0; rig.zoom = 1; rig.pitchOff = 0;
  };

  V.focus = function (p) { focusAt = p ? p.clone() : null; };
  V.unfocus = function () { focusAt = null; };
  V.follow = function (p) { followAt.copy(p); };
  V.toggleMode = function () {
    V.mode = V.mode === "follow" ? "overview" : "follow";
    rig.zoom = 1; rig.pitchOff = 0;
    if (V.mode === "overview") rig.yaw = 0;
    return V.mode;
  };

  // ------------------------------------------------------------------ input (drag to look)
  function input(c) {
    const pts = new Map();
    let pinch0 = 0, zoom0 = 1;
    c.style.touchAction = "none";
    c.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    c.addEventListener("pointerdown", function (e) { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { c.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } if (pts.size === 2) { pinch0 = spread(); zoom0 = rig.zoom; } });
    c.addEventListener("pointermove", function (e) {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      rig.idle = 0;
      if (pts.size === 1) {
        const k = e.pointerType === "touch" ? 0.008 : 0.005;
        rig.yaw -= dx * k;
        if (V.mode === "overview") rig.yaw = THREE.MathUtils.clamp(rig.yaw, -0.62, 0.62);
        rig.pitchOff = THREE.MathUtils.clamp(rig.pitchOff + dy * 0.003, -0.25, 0.5);
      } else if (pts.size === 2 && pinch0) rig.zoom = THREE.MathUtils.clamp(zoom0 * pinch0 / Math.max(20, spread()), 0.55, 1.6);
    });
    const up = function (e) { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", function (e) { e.preventDefault(); rig.idle = 0; rig.zoom = THREE.MathUtils.clamp(rig.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 1.6); }, { passive: false });
    function spread() { const a = Array.from(pts.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  }

  // ------------------------------------------------------------------ per frame
  const _p = new THREE.Vector3(), _t = new THREE.Vector3();
  V.frame = function (dt, t) {
    const S = V.S;
    if (!S) return;
    rig.idle += dt;
    let tyaw = rig.yaw, tpitch, tdist, fov;
    if (V.mode === "overview" || intro > 1.2) {
      if (rig.idle > 6 && V.mode === "overview") { const k = Math.min(1, dt * 0.6); rig.yaw *= 1 - k; rig.zoom += (1 - rig.zoom) * k; rig.pitchOff *= 1 - k; }
      _t.copy(rig.home);
      tpitch = rig.pitch + rig.pitchOff; tdist = rig.dist * rig.zoom; fov = 36;
      if (V.mode !== "overview") tyaw = 0;
    } else {
      // follow: over the barber's shoulder, a little above head height
      _t.copy(followAt); _t.y = 1.45;
      tpitch = 0.3 + rig.pitchOff; tdist = 3.3 * rig.zoom; fov = 50;
    }
    if (focusAt) {
      _t.copy(focusAt); _t.y -= 0.1;
      tdist = V.mode === "overview" ? 3.6 : 2.2; tpitch = 0.28; fov = V.mode === "overview" ? 36 : 46;
    }
    V.camYaw = V.mode === "overview" ? 0 : rig.cur.yaw;
    const k = Math.min(1, dt * (intro > 0 ? 1.4 : 4));
    intro = Math.max(0, intro - dt);
    const c = rig.cur;
    c.yaw += (tyaw - c.yaw) * k; c.pitch += (tpitch - c.pitch) * k; c.dist += (tdist - c.dist) * k;
    c.tgt.lerp(_t, k);
    if (Math.abs(V.camera.fov - fov) > 0.05) { V.camera.fov += (fov - V.camera.fov) * k; V.camera.updateProjectionMatrix(); }
    const cp = Math.cos(c.pitch);
    const pos = V.camera.position.set(c.tgt.x + Math.sin(c.yaw) * cp * c.dist, c.tgt.y + Math.sin(c.pitch) * c.dist, c.tgt.z + Math.cos(c.yaw) * cp * c.dist);
    if (V.mode === "follow" && intro <= 1.2) {
      // stay inside the side walls and the storefront, and under the top of the walls
      const hw = S.W / 2 - 0.2, hd = S.D / 2;
      pos.x = THREE.MathUtils.clamp(pos.x, -hw, hw);
      pos.z = Math.max(pos.z, -hd + 0.25);
      pos.y = THREE.MathUtils.clamp(pos.y, 0.6, S.H + 1.2);
    }
    V.camera.lookAt(c.tgt);
    // test hook: View.lock = { pos, tgt, fov } pins the camera (headless close-ups)
    if (V.lock) { V.camera.position.copy(V.lock.pos); V.camera.lookAt(V.lock.tgt); if (V.lock.fov) { V.camera.fov = V.lock.fov; V.camera.updateProjectionMatrix(); } }
    HS.Shop.update(S, t, dt);
    V.renderer.render(V.scene, V.camera);
    watchFps(dt);
  };

  // Stage pixels for a world point ({ x, y, behind, depth }).
  V.project = function (v, out) {
    out = out || {};
    _p.copy(v).project(V.camera);
    out.x = (_p.x + 1) / 2 * V.w; out.y = (1 - _p.y) / 2 * V.h; out.behind = _p.z > 1 || _p.z < -1; out.depth = _p.z;
    return out;
  };

  function watchFps(dt) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc < 2) return;
    const fps = fpsN / fpsAcc;
    if (fpsEl) fpsEl.textContent = fps.toFixed(0) + " fps  q" + quality + "  " + V.renderer.info.render.triangles + " tris";
    fpsAcc = 0; fpsN = 0;
    if (document.hidden || intro > 0) return;
    // three slow readings in a row (6 s under 22 fps) before giving anything up
    fpsLow = fps < 22 ? fpsLow + 1 : 0;
    if (fpsLow >= 3 && quality > 0) {
      fpsLow = 0; quality--;
      if (quality === 1) V.renderer.setPixelRatio(1);
      if (quality === 0) { V.renderer.shadowMap.enabled = false; V.scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach(function (m) { m.needsUpdate = true; }); }); }
      resize(true);
    }
  }

  HS.View = V;
})(globalThis.HS);
