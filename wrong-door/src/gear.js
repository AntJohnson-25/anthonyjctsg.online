// What the driver carries: the canvas courier sack over the left shoulder (it fills and empties with the
// parcels), the handheld scanner, and the parcels themselves (a smooth-edged cardboard box with tape and a
// label). All built here from code, smooth enough to hold up close to the over-the-shoulder camera.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const THREE = globalThis.THREE;
  const G = {};

  // ---- canvas textures
  function canvasTex(w, h, paint, repeat) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  // woven canvas: a fine cross-hatch over a base colour, a little uneven, with a hi-vis band and a stencilled mark
  let sackTex = null;
  function sackTexture() {
    if (sackTex) return sackTex;
    sackTex = canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = "#b8a47e"; g.fillRect(0, 0, w, h);
      const rnd = WD.rngFrom(7);
      for (let i = 0; i < 9000; i++) { g.fillStyle = "rgba(" + (rnd() < 0.5 ? "255,255,255," : "0,0,0,") + (0.03 + rnd() * 0.05) + ")"; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 1); }
      g.globalAlpha = 0.09; g.fillStyle = "#000";
      for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
      for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
      g.globalAlpha = 1;
      // the band round the sack, and the van's stripe colour
      g.fillStyle = "#ff8a1f"; g.fillRect(0, h * 0.56, w, h * 0.07);
      g.fillStyle = "#e9edf0"; g.fillRect(0, h * 0.545, w, h * 0.012); g.fillRect(0, h * 0.632, w, h * 0.012);
      g.fillStyle = "rgba(60,48,36,0.75)"; g.font = "900 54px Trebuchet MS, Segoe UI, sans-serif"; g.textAlign = "center";
      g.fillText("PARCEL", w * 0.25, h * 0.45); g.fillText("PARCEL", w * 0.75, h * 0.45);
      // grime toward the bottom
      const gr = g.createLinearGradient(0, h * 0.7, 0, h);
      gr.addColorStop(0, "rgba(40,32,24,0)"); gr.addColorStop(1, "rgba(40,32,24,0.35)");
      g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
    });
    return sackTex;
  }
  let boxTex = null;
  function cardboardTexture() {
    if (boxTex) return boxTex;
    boxTex = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#c8925a"; g.fillRect(0, 0, w, h);
      const rnd = WD.rngFrom(11);
      for (let i = 0; i < 2500; i++) { g.fillStyle = "rgba(90,55,25," + (0.03 + rnd() * 0.06) + ")"; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1); }
      // corrugation lines, very faint
      g.fillStyle = "rgba(120,80,40,0.06)"; for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
    });
    return boxTex;
  }
  let labelT = null;
  function shipLabel() {
    if (labelT) return labelT;
    labelT = canvasTex(128, 96, function (g, w, h) {
      g.fillStyle = "#f7f5ef"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#1d1a16";
      for (let i = 0; i < 4; i++) g.fillRect(8, 10 + i * 9, 50 + (i * 23) % 40, 4);
      for (let x = 8; x < w - 8; x += 3) if ((x * 7) % 5 > 1) g.fillRect(x, 54, (x % 3) + 1, 30);   // a barcode
    });
    return labelT;
  }

  // ---- a box with rounded edges (r) in one geometry: a subdivided cube pushed out to a rounded shape
  const rbCache = {};
  function roundedBox(w, h, d, r, seg) {
    const key = [w, h, d, r, seg].join(",");
    if (rbCache[key]) return rbCache[key];
    seg = seg || 3;
    const g = new THREE.BoxGeometry(1, 1, 1, seg * 2 + 2, seg * 2 + 2, seg * 2 + 2);
    const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.set(v.x * w, v.y * h, v.z * d);
      c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
      const o = v.clone().sub(c);
      if (o.lengthSq() > 1e-10) { o.normalize(); v.copy(c).addScaledVector(o, r); n.setXYZ(i, o.x, o.y, o.z); }
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    rbCache[key] = g;
    return g;
  }
  G.roundedBox = roundedBox;

  // ---- a parcel: rounded cardboard, a tape strip over the top and down two sides, a shipping label
  const parcelMats = {};
  G.parcel = function (w, h, d) {
    if (!parcelMats.box) {
      parcelMats.box = new THREE.MeshLambertMaterial({ map: cardboardTexture() });
      parcelMats.tape = new THREE.MeshLambertMaterial({ color: 0xd9c08c, transparent: true, opacity: 0.85 });
      parcelMats.label = new THREE.MeshLambertMaterial({ map: shipLabel() });
    }
    const g = new THREE.Group();
    const b = new THREE.Mesh(roundedBox(w, h, d, Math.min(w, h, d) * 0.08, 2), parcelMats.box); b.castShadow = true; b.receiveShadow = true; g.add(b);
    const tape = new THREE.Mesh(roundedBox(w * 0.22, h + 0.006, d + 0.006, 0.01, 1), parcelMats.tape); g.add(tape);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.32, w * 0.24), parcelMats.label);
    lab.rotation.x = -Math.PI / 2; lab.position.set(w * 0.27, h / 2 + 0.004, d * 0.1); g.add(lab);
    return g;
  };

  // ---- the sack. Its neck (where the hand grips it, over the shoulder) is the origin; the bag hangs down
  // the back along -Y and bulges toward +Z (behind the driver, whose group faces -Z). A lathe profile,
  // lumpy where parcels press against the canvas, a cinched neck, a rope tie and a shoulder strap.
  G.sack = function () {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const mat = new THREE.MeshLambertMaterial({ map: sackTexture() });
    // profile: (radius, y) from the bottom up to the neck
    const prof = [[0.0, -0.78], [0.12, -0.775], [0.21, -0.75], [0.27, -0.69], [0.30, -0.6], [0.31, -0.48], [0.3, -0.36],
      [0.27, -0.25], [0.21, -0.16], [0.13, -0.09], [0.07, -0.05], [0.055, -0.02], [0.06, 0.02], [0.09, 0.07], [0.11, 0.12], [0.08, 0.15], [0.0, 0.14]];
    const pts = [];
    for (let i = 0; i < prof.length - 1; i++) for (let s = 0; s < 3; s++) {   // smooth the profile (Catmull-Rom through the points)
      const a = prof[Math.max(0, i - 1)], b = prof[i], c = prof[i + 1], d = prof[Math.min(prof.length - 1, i + 2)], t = s / 3;
      const cr = (p0, p1, p2, p3) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      pts.push(new THREE.Vector2(Math.max(0, cr(a[0], b[0], c[0], d[0])), cr(a[1], b[1], c[1], d[1])));
    }
    pts.push(new THREE.Vector2(0, 0.14));
    const geo = new THREE.LatheGeometry(pts, 40);
    // lumps (parcels inside) and a flattening on the side that lies against the back
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z);
      if (r < 1e-4) continue;
      const a = Math.atan2(v.z, v.x), belly = Math.max(0, Math.min(1, (-v.y - 0.12) / 0.3));
      let k = 1 + belly * (0.07 * Math.sin(a * 3 + v.y * 9) + 0.05 * Math.sin(a * 5 - v.y * 13 + 1.3) + 0.03 * Math.cos(a * 7 + v.y * 21));
      if (v.z < 0) k *= 1 - 0.38 * belly * Math.min(1, -v.z / r);   // the back side: flat against the driver
      if (Math.abs(v.y - 0.035) < 0.05) k *= 1 + 0.18 * Math.sin(a * 12);   // gathered canvas at the neck
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    geo.computeVertexNormals();
    const bag = new THREE.Mesh(geo, mat); bag.castShadow = true; bag.receiveShadow = true;
    bag.position.z = 0.16;   // the bulk sits behind the shoulder
    body.add(bag);
    // the rope tie round the neck, and its loose end
    const ropeM = new THREE.MeshLambertMaterial({ color: 0xd8c9a2 });
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.016, 8, 28), ropeM);
    tie.rotation.x = Math.PI / 2; tie.position.set(0, -0.005, 0.16); body.add(tie);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.06, -0.005, 0.16), new THREE.Vector3(0.1, -0.06, 0.2), new THREE.Vector3(0.09, -0.16, 0.23), new THREE.Vector3(0.12, -0.24, 0.24)]), 16, 0.011, 6), ropeM);
    body.add(tail);
    // the strap over the shoulder, from the neck down across the chest (a flat band)
    const strapM = new THREE.MeshLambertMaterial({ color: 0x2a2f36 });
    const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0.12), new THREE.Vector3(-0.02, 0.02, -0.02), new THREE.Vector3(0.08, -0.15, -0.16), new THREE.Vector3(0.24, -0.42, -0.14), new THREE.Vector3(0.3, -0.62, 0.0)]), 24, 0.022, 6), strapM);
    strap.scale.set(1, 1, 0.55);
    strap.castShadow = true;
    root.add(strap);
    root.userData = { body: body, bag: bag, fill: 0.5, shown: 0.5, swing: 0, swingV: 0, strap: strap };
    return root;
  };
  // fill 0 (one or two parcels rattling about) .. 1 (stuffed)
  G.sackUpdate = function (sack, fill, dt, accel) {
    const u = sack.userData;
    u.shown += (fill - u.shown) * Math.min(1, 5 * dt);
    const f = u.shown, sx = 0.5 + 0.34 * f, sy = 0.68 + 0.4 * f;
    u.bag.scale.set(sx, sy, sx * 0.9);
    u.bag.position.z = 0.08 + 0.07 * f;
    // a pendulum: it swings back when you speed up and forward when you stop
    u.swingV += (-u.swing * 38 - u.swingV * 5 + (accel || 0) * 0.06) * dt;
    u.swing += u.swingV * dt;
    u.body.rotation.x = Math.max(-0.5, Math.min(0.5, u.swing));
  };

  // ---- the handheld scanner: rounded body, a lit screen with a map pin, a scan window at the top
  G.handheld = function () {
    const g = new THREE.Group();
    const body = new THREE.Mesh(roundedBox(0.078, 0.155, 0.024, 0.008, 2), new THREE.MeshLambertMaterial({ color: 0x23262b })); g.add(body);
    const grip = new THREE.Mesh(roundedBox(0.082, 0.05, 0.028, 0.01, 2), new THREE.MeshLambertMaterial({ color: 0xff8a1f })); grip.position.y = -0.055; g.add(grip);
    const screenTex = canvasTex(64, 96, function (c, w, h) {
      c.fillStyle = "#0e2a3a"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#2f6f8f"; c.lineWidth = 2; for (let i = 8; i < w; i += 14) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); }
      c.fillStyle = "#7fd8ff"; c.beginPath(); c.arc(w / 2, h * 0.42, 9, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(w / 2 - 7, h * 0.46); c.lineTo(w / 2, h * 0.6); c.lineTo(w / 2 + 7, h * 0.46); c.fill();
      c.fillStyle = "#0e2a3a"; c.beginPath(); c.arc(w / 2, h * 0.42, 3.5, 0, Math.PI * 2); c.fill();
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.088), new THREE.MeshBasicMaterial({ map: screenTex }));
    screen.position.set(0, 0.018, 0.0125); g.add(screen);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.012), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
    win.position.set(0, 0.0775, 0.002); win.rotation.x = -Math.PI / 2; g.add(win);
    return g;
  };

  WD.Gear = G;
})(globalThis.WD);
