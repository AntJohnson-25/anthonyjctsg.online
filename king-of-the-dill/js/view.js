// The 3D world: court, net, park surroundings, lights, the ball and its
// effects (shadow blob, trail, landing marker, timing ring, bounce puffs).
// It only draws; main.js tells it where things are.
import * as THREE from "three";
import { COURT, BALL, netHeight } from "./physics.js";
import { assetURL } from "./assets.js";

const COL = {
  sky0: "#7fb7e8", sky1: "#dbeeff", grass: 0x3e6e3a, apron: 0x3b7a55, court: 0x2c5d9c,
  kitchen: 0x3f7fc4, line: 0xf4f6f8, post: 0x24282e, ball: 0xe4ff3a
};

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class View {
  constructor(mobile) {
    const scene = this.scene = new THREE.Scene();
    scene.background = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, COL.sky0); gr.addColorStop(0.75, COL.sky1); gr.addColorStop(1, "#eef6f0");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    scene.fog = new THREE.Fog(0x8fb08a, 40, 150);   // meadow-green haze, so the far grass meets the mountain foothills

    scene.add(new THREE.HemisphereLight(0xdcefff, 0x3d5a3a, 1.1));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(5, 14, 4);
    sun.castShadow = true;
    const sm = mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 12, bottom: -12, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    this.buildGround();
    this.buildMountains();
    this.buildCourt();
    this.buildNet();
    this.buildPark();
    this.buildBall();
  }

  flat(w, d, color, y, x = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color, roughness: 0.92 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  buildGround() {
    this.flat(160, 160, COL.grass, -0.01);
    this.flat(COURT.halfW * 2 + 6, COURT.halfL * 2 + 8, COL.apron, 0);
  }

  // Snow-capped range on a ring far outside the park. The picture is tiled
  // four times round, every other copy mirrored, so the edges always meet.
  // Unlit and unfogged: it keeps the photo's own colours. The part below y=0
  // is hidden by the ground; the near trees and fence stand in front.
  buildMountains() {
    const R = 70, H = 44, Y0 = -12, TILES = 4;
    const tex = new THREE.TextureLoader().load(assetURL("mountains.jpg"));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.repeat.x = TILES;
    tex.offset.x = 0.5;   // u=0.5 is the far baseline; this puts a tile centre there
    tex.anisotropy = 4;
    const geo = new THREE.CylinderGeometry(R, R, H, 64, 1, true);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = Y0 + H / 2;
    m.renderOrder = -1;
    this.scene.add(m);
  }

  buildCourt() {
    const W = COURT.halfW, L = COURT.halfL, K = COURT.kitchen;
    this.flat(W * 2, (L - K) , COL.court, 0.002, 0, (L + K) / 2);
    this.flat(W * 2, (L - K), COL.court, 0.002, 0, -(L + K) / 2);
    this.flat(W * 2, K * 2, COL.kitchen, 0.002);
    const lw = 0.05, y = 0.004;
    const line = (w, d, x, z) => {
      const m = this.flat(w, d, COL.line, y, x, z);
      m.material.roughness = 0.7;
    };
    // Lines sit inside the court (a ball on the line is in).
    line(lw, L * 2, W - lw / 2, 0); line(lw, L * 2, -W + lw / 2, 0);
    line(W * 2, lw, 0, L - lw / 2); line(W * 2, lw, 0, -L + lw / 2);
    line(W * 2, lw, 0, K); line(W * 2, lw, 0, -K);
    line(lw, L - K, 0, (L + K) / 2); line(lw, L - K, 0, -(L + K) / 2);
  }

  buildNet() {
    const HW = COURT.netHalfW, N = 32;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const x = -HW + (2 * HW * i) / N, top = netHeight(Math.min(Math.abs(x), COURT.halfW));
      pos.push(x, 0.06, 0, x, top, 0);
      uv.push((x + HW) * 9, 0, (x + HW) * 9, top * 9);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = canvasTex(32, 32, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = "rgba(20,22,26,0.95)"; c.lineWidth = 3;
      c.strokeRect(0, 0, w, h);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const net = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 }));
    net.castShadow = true;
    this.scene.add(net);
    const pts = [];
    for (let i = 0; i <= N; i++) { const x = -HW + (2 * HW * i) / N; pts.push(new THREE.Vector3(x, netHeight(Math.min(Math.abs(x), COURT.halfW)) + 0.015, 0)); }
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const tape = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.025, 6), white);
    tape.castShadow = true;
    this.scene.add(tape);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netCenter, 0.012), white);
    strap.position.set(0, COURT.netCenter / 2, 0);
    this.scene.add(strap);
    const postMat = new THREE.MeshStandardMaterial({ color: COL.post, roughness: 0.5, metalness: 0.4 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, COURT.netSide + 0.06, 10), postMat);
      p.position.set(s * (HW + 0.03), (COURT.netSide + 0.06) / 2, 0);
      p.castShadow = true;
      this.scene.add(p);
    }
  }

  buildPark() {
    const S = this.scene;
    // Chain-link fence around the apron.
    const fx = COURT.halfW + 3, fz = COURT.halfL + 4, fh = 3;
    const link = canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = "rgba(40,48,44,0.9)"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
    });
    link.wrapS = link.wrapT = THREE.RepeatWrapping;
    const fenceMat = (len) => {
      const t = link.clone(); t.needsUpdate = true; t.repeat.set(len * 3, fh * 3);
      return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    };
    const panel = (len, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, fh), fenceMat(len));
      m.position.set(x, fh / 2, z); m.rotation.y = ry;
      S.add(m);
    };
    panel(fx * 2, 0, -fz, 0); panel(fx * 2, 0, fz, 0);
    panel(fz * 2, -fx, 0, Math.PI / 2); panel(fz * 2, fx, 0, Math.PI / 2);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a312d, roughness: 0.6, metalness: 0.5 });
    const postG = new THREE.CylinderGeometry(0.035, 0.035, fh, 6);
    for (let x = -fx; x <= fx + 0.01; x += fx / 3) for (const z of [-fz, fz]) { const p = new THREE.Mesh(postG, railMat); p.position.set(x, fh / 2, z); S.add(p); }
    for (let z = -fz; z <= fz + 0.01; z += fz / 4) for (const x of [-fx, fx]) { const p = new THREE.Mesh(postG, railMat); p.position.set(x, fh / 2, z); S.add(p); }

    // Light poles at the corners.
    const poleG = new THREE.CylinderGeometry(0.08, 0.11, 8, 8), headG = new THREE.BoxGeometry(0.9, 0.25, 0.5);
    const headM = new THREE.MeshStandardMaterial({ color: 0xf8f6e8, emissive: 0x555544, roughness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(poleG, railMat); p.position.set(sx * (fx + 0.6), 4, sz * (fz - 1)); p.castShadow = true; S.add(p);
      const h = new THREE.Mesh(headG, headM); h.position.set(sx * (fx + 0.3), 8, sz * (fz - 1)); h.rotation.y = sx * 0.4; S.add(h);
    }

    // Benches by the side fence.
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.8 });
    for (const z of [-3.5, 3.5]) {
      const b = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 1.8), wood); seat.position.y = 0.45; b.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 1.8), wood); back.position.set(0.2, 0.7, 0); b.add(back);
      for (const zz of [-0.8, 0.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.06), railMat); l.position.set(0, 0.22, zz); b.add(l); }
      b.position.set(fx - 0.6, 0, z);
      b.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      S.add(b);
    }

    // Privacy screen: a dark-green windscreen hung on the inside of every fence
    // panel, like on a tennis court. Tile = 1 m wide, full fence height.
    const cloth = canvasTex(128, 384, (c, w, h) => {
      c.fillStyle = "#1d5236"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(0,0,0,0.13)"; c.lineWidth = 1;
      for (let y = 0; y < h; y += 4) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
      c.strokeStyle = "rgba(255,255,255,0.05)";
      for (let x = 0; x < w; x += 4) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
      for (const [y0, y1] of [[0, 30], [h - 30, h]]) {   // hems
        c.fillStyle = "#2b6b47"; c.fillRect(0, y0, w, y1 - y0);
        c.strokeStyle = "rgba(235,240,230,0.55)"; c.setLineDash([5, 4]); c.lineWidth = 1.5;
        c.beginPath(); const sy = y0 === 0 ? y1 - 6 : y0 + 6; c.moveTo(0, sy); c.lineTo(w, sy); c.stroke(); c.setLineDash([]);
      }
      c.fillStyle = "#c9cfc9";   // grommets
      for (const gx of [w * 0.25, w * 0.75]) for (const gy of [13, h - 13]) { c.beginPath(); c.arc(gx, gy, 3.4, 0, Math.PI * 2); c.fill(); c.fillStyle = "#0e2a1b"; c.beginPath(); c.arc(gx, gy, 1.6, 0, Math.PI * 2); c.fill(); c.fillStyle = "#c9cfc9"; }
      c.fillStyle = "rgba(240,244,238,0.9)"; c.fillRect(0, h * 0.5 - 5, w, 10);   // white stripe band
    });
    cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping;
    cloth.anisotropy = 4;
    const screen = (len, x, z, ry) => {
      const t = cloth.clone(); t.needsUpdate = true; t.repeat.set(len, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, fh), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 1 }));
      m.position.set(x, fh / 2, z); m.rotation.y = ry;
      S.add(m);
    };
    const so = 0.05;   // hung just inside the chain link
    screen(fx * 2, 0, -fz + so, 0); screen(fx * 2, 0, fz - so, 0);
    screen(fz * 2, -fx + so, 0, Math.PI / 2); screen(fz * 2, fx - so, 0, Math.PI / 2);

    // A ring of palm trees outside the fence: three photo palms (tools/key-palms.py)
    // as two crossed quads each, one InstancedMesh per kind.
    const KINDS = [{ f: "palm1.png", aspect: 308 / 640, h: [7, 9.5] }, { f: "palm2.png", aspect: 325 / 640, h: [8, 10.5] }, { f: "palm3.png", aspect: 378 / 640, h: [5, 6.5] }];
    const palmGeo = (aspect) => {
      const hw = aspect / 2, pos = [], uv = [], idx = [];
      for (let k = 0; k < 2; k++) {
        const c = k ? 1 : 0, s = k ? 0 : 1;   // second quad is turned 90 degrees
        pos.push(-hw * s, 0, -hw * c, hw * s, 0, hw * c, -hw * s, 1, -hw * c, hw * s, 1, hw * c);
        uv.push(0, 0, 1, 0, 0, 1, 1, 1);
        const o = k * 4; idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots = KINDS.map(() => []);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12, r = 17 + rnd() * 14, k = i % KINDS.length;
      spots[k].push({ x: Math.sin(a) * r * 0.8, z: Math.cos(a) * r, h: KINDS[k].h[0] + rnd() * (KINDS[k].h[1] - KINDS[k].h[0]), ry: rnd() * 6 });
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const blob = canvasTex(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }), n);
    let si = 0;
    KINDS.forEach((K, k) => {
      const tex = new THREE.TextureLoader().load(assetURL("palms/" + K.f));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const mesh = new THREE.InstancedMesh(palmGeo(K.aspect), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xe6ece0 }), spots[k].length);
      spots[k].forEach((s, i) => {
        q.setFromAxisAngle(up, s.ry);
        mesh.setMatrixAt(i, m4.compose(p.set(s.x, 0, s.z), q, sc.set(s.h, s.h, s.h)));
        shadows.setMatrixAt(si++, m4.compose(p.set(s.x, 0.02, s.z), q.identity(), sc.set(s.h * 0.45, 1, s.h * 0.45)));
      });
      S.add(mesh);
    });
    shadows.renderOrder = 1;
    S.add(shadows);
  }

  buildBall() {
    const S = this.scene;
    const R = BALL.r * 1.5;   // drawn a bit large so it reads on a phone
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(R, 18, 12),
      new THREE.MeshStandardMaterial({ color: COL.ball, emissive: 0x4a5a00, roughness: 0.55 }));
    this.ball.castShadow = true;
    S.add(this.ball);
    const blob = canvasTex(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(0,0,0,0.6)"); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    S.add(this.shadow);

    // Trail: a few fading copies of the ball along its recent path.
    this.trail = [];
    this.trailPts = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * 0.9, 8, 6), new THREE.MeshBasicMaterial({ color: COL.ball, transparent: true, depthWrite: false }));
      m.visible = false;
      S.add(m);
      this.trail.push(m);
    }

    // Where the ball will bounce on your side (red if it is going out).
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 32), new THREE.MeshBasicMaterial({ color: 0x7dff6a, transparent: true, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.012;
    this.marker.visible = false;
    this.markerA = 0;
    S.add(this.marker);

    // Timing ring around the contact point: it closes on the ball at the moment to swing.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest: false }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    S.add(this.ring);

    this.puffs = [];
  }

  setBall(x, y, z, live, speed) {
    this.ball.position.set(x, y, z);
    this.shadow.position.set(x, 0.008, z);
    const h = Math.max(0, y);
    this.shadow.scale.setScalar(1 + h * 0.6);
    this.shadow.material.opacity = Math.max(0.15, 0.85 - h * 0.25);
    // Trail.
    if (live && speed > 5) this.trailPts.unshift([x, y, z]);
    else this.trailPts.pop();
    if (this.trailPts.length > this.trail.length) this.trailPts.length = this.trail.length;
    this.trail.forEach((m, i) => {
      const p = this.trailPts[i];
      m.visible = !!p && i > 0;
      if (p) { m.position.set(p[0], p[1], p[2]); m.material.opacity = 0.32 * (1 - i / this.trail.length); m.scale.setScalar(1 - i / (this.trail.length * 1.4)); }
    });
  }

  showMarker(b, out) {
    if (!b) { this.marker.visible = false; return; }
    this.marker.position.x = b.x; this.marker.position.z = b.z;
    this.marker.material.color.set(out ? 0xff4a3a : 0x7dff6a);
    this.marker.visible = true;
    this.markerA = 0;
  }

  // c: { left, x, y, z } or null. perfect: the perfect window half-width (s).
  showRing(c, camera, perfect) {
    const r = this.ring;
    if (!c || c.left > 1.1 || c.left < -0.15) { r.visible = false; return; }
    r.visible = true;
    r.position.set(c.x, c.y, c.z);
    r.quaternion.copy(camera.quaternion);
    const left = Math.max(0, c.left);
    r.scale.setScalar(0.08 + left * 0.55);
    const now = Math.abs(c.left) <= perfect;
    r.material.color.set(now ? 0x7dff6a : c.left < 0.3 ? 0xffe14a : 0xffffff);
    r.material.opacity = now ? 1 : 0.85;
  }

  puff(x, z, color = 0xffffff) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.09, 24), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.userData.t = 0;
    this.scene.add(m);
    this.puffs.push(m);
  }

  update(dt) {
    if (this.marker.visible) {
      this.markerA = Math.min(1, this.markerA + dt * 5);
      this.marker.material.opacity = 0.9 * this.markerA;
      const s = 1 + Math.sin(performance.now() / 120) * 0.08;
      this.marker.scale.set(s, s, s);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const m = this.puffs[i];
      m.userData.t += dt;
      const t = m.userData.t / 0.45;
      m.scale.setScalar(1 + t * 4);
      m.material.opacity = Math.max(0, 0.8 * (1 - t));
      if (t >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.puffs.splice(i, 1); }
    }
  }
}
