// The 3D plaza: every row of the dataset's population is a thermal silhouette standing by its pylon
// (department or city). A query result is staged in the middle:
//   entities  - matching people walk onto the stage, coloured by the first numeric column
//   aggregate - one pillar per result row, at its pylon when the group key is one
//   spawn     - new figures or crates drop in for rows that aren't people
// When an answer is wrong, rows that shouldn't be there get amber rings and missing rows show up
// as flickering red ghosts.
import * as THREE from "three";
import { Orbit } from "./orbit.js";
import { figureGeometry, crateGeometry, pillarGeometry, thermalMaterial, groundMaterial, heat, COLORS, makeLabel, disposeLabel } from "./parts.js";
import { analyze, indexPopulation, matchRows, heatRange, norm, fmt, stripSql } from "./adapt.js";
import { cellKey } from "../engine/grader.js";
import { Crew, buildRoom, makeRegionDesk, START, APPROACH } from "./office.js";
import { Walker } from "./walk.js";

const STAGE_R = 7.5;
const ANCHOR_R = 15.5;
const DIM_GLOW = 0.85;
const CATEGORY = ["#39ff6e", "#9dff5a", "#2fffb0", "#c4ff86", "#21d36a", "#7dffd8", "#b0ffb0", "#4ade80"].map((c) => new THREE.Color(c));

function clip(s) { return s.length > 18 ? s.slice(0, 17) + "…" : s; }

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _qFlat = new THREE.Quaternion();

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------------------------------------------------------------- instanced pool

class Pool {
  constructor(scene, geo, cap, mat, ringGeo, ringMat) {
    this.cap = cap;
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aColor", this.aColor);
    geo.setAttribute("aState", this.aState);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, cap);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    scene.add(this.mesh, this.rings);
    this.items = [];
    this.labels = scene;
  }

  add(o) {
    if (this.items.length >= this.cap) return null;
    const it = {
      p: new THREE.Vector3(), t: new THREE.Vector3(), c: COLORS.dim.clone(), tc: COLORS.dim.clone(),
      glow: DIM_GLOW, tglow: DIM_GLOW, state: 0, yaw: 0, yawGoal: 0, tyaw: 0, s: 1, ts: 1, h: 1, th: 1,
      delay: 0, phase: Math.random() * 6, speed: 5.2, moving: false, label: null, labelY: 1.95, labelOff: 0.12,
      ringScale: 1, faceMove: true, pop: false
    };
    Object.assign(it, o);
    this.items.push(it);
    return it;
  }

  setLabel(it, sprite) {
    if (it.label) disposeLabel(it.label);
    it.label = sprite;
    if (sprite) this.labels.add(sprite);
  }

  clear() {
    this.items.forEach((it) => { if (it.label) disposeLabel(it.label); });
    this.items = [];
    this.mesh.count = 0;
    this.rings.count = 0;
  }

  update(dt, time) {
    const k = 1 - Math.exp(-dt * 5);
    let r = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      let bob = 0;
      if (it.delay > 0) {
        it.delay -= dt;
        if (it.pop) it.s = 0;
      } else {
        const dx = it.t.x - it.p.x;
        const dz = it.t.z - it.p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.02) {
          const step = Math.min(d, it.speed * dt);
          it.p.x += dx / d * step;
          it.p.z += dz / d * step;
          if (it.faceMove && d > 0.1) it.yawGoal = Math.atan2(dx, dz);
          it.moving = d > 0.12;
          it.phase += dt * 11;
        } else {
          it.moving = false;
          it.yawGoal = it.tyaw;
        }
        it.p.y += (it.t.y - it.p.y) * (1 - Math.exp(-dt * 4.5));
        it.h += (it.th - it.h) * (1 - Math.exp(-dt * 3));
        if (it.moving) bob = Math.abs(Math.sin(it.phase)) * 0.09;
      }
      it.yaw = lerpAngle(it.yaw, it.yawGoal, 1 - Math.exp(-dt * 8));
      it.c.lerp(it.tc, k);
      it.glow += (it.tglow - it.glow) * k;
      if (!(it.pop && it.delay > 0)) it.s += (it.ts - it.s) * k;

      _e.set(it.moving ? 0.1 : 0, it.yaw, 0);
      _q.setFromEuler(_e);
      _m.compose(_v.set(it.p.x, it.p.y + bob, it.p.z), _q, _s.set(it.s, it.s * it.h, it.s));
      this.mesh.setMatrixAt(i, _m);
      this.aColor.setXYZ(i, it.c.r, it.c.g, it.c.b);
      this.aState.setXY(i, it.glow, it.state);

      if (it.state) {
        const pulse = it.ringScale * (1 + 0.14 * Math.sin(time * 6 + i));
        _m.compose(_v.set(it.p.x, 0.03, it.p.z), _qFlat, _s.set(pulse, 1, pulse));
        this.rings.setMatrixAt(r, _m);
        this.rings.setColorAt(r, it.state === 1 ? COLORS.missing : COLORS.extra);
        r++;
      }
      if (it.label) { it.label.position.set(it.p.x, it.p.y + bob + (it.labelY * it.h + it.labelOff) * it.s, it.p.z); it.label.visible = it.s > 0.3 * it.ts; }
    }
    this.mesh.count = this.items.length;
    this.rings.count = r;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aState.needsUpdate = true;
    if (r) {
      this.rings.instanceMatrix.needsUpdate = true;
      this.rings.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- layouts

function stageGrid(n, sp) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.5)));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    const c = i % cols;
    out.push(new THREE.Vector3((c - (inRow - 1) / 2) * sp, 0, (r - (rows - 1) / 2) * sp + 0.6));
  }
  return out;
}

// Ordered results: rank 1 front and centre-left, reading like a table.
function lineup(n, sp, per) {
  per = per || (n > 40 ? 14 : Math.min(10, n));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / per);
    const inRow = Math.min(per, n - r * per);
    const c = i % per;
    out.push(new THREE.Vector3((c - (inRow - 1) / 2) * sp, 0, 4.2 - r * (sp + 0.45)));
  }
  return out;
}

// ---------------------------------------------------------------- the world

export class Plaza {
  constructor(canvas) {
    this.canvas = canvas;
    const small = Math.min(innerWidth, innerHeight) < 700;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = COLORS.bg.clone();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
    this.orbit = new Orbit(this.camera, canvas);

    this.uniforms = {
      uTime: { value: 0 },
      uFog: { value: COLORS.bg.clone() },
      uStageR: { value: STAGE_R },
      uPulse: { value: 0 },
      uHolo: { value: 0 },
      uStageColor: { value: new THREE.Color("#2dff6a") }
    };
    this.stageBase = new THREE.Color("#2dff6a");
    this.holo = false;
    this.stageFlash = null;

    const ground = new THREE.Mesh(new THREE.CircleGeometry(95, 96).rotateX(-Math.PI / 2), groundMaterial(this.uniforms));
    this.scene.add(ground);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3040, 1.7));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);
    this.room = buildRoom(this.scene);
    this.crew = new Crew(this.scene, this.orbit, this.room);
    this.mode = "desk";   // "walk": third-person in the lab | "desk": seated at the laptop (orbit camera + SQL panels)
    this.walker = new Walker(canvas, this.orbit, this.crew, {
      onNear: (it) => this.onNear && this.onNear(it),
      onUse: (it) => this.onUse && this.onUse(it)
    });
    this.setMode("walk");

    const thermal = thermalMaterial(this.uniforms);
    const ringGeo = new THREE.RingGeometry(0.42, 0.56, 40).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.pop = new Pool(this.scene, figureGeometry(), 80, thermal, ringGeo, ringMat);
    this.spawnFig = new Pool(this.scene, figureGeometry(), 540, thermal, ringGeo, ringMat);
    this.crates = new Pool(this.scene, crateGeometry(), 540, thermal, ringGeo, ringMat);
    this.pillars = new Pool(this.scene, pillarGeometry(), 140, thermal, ringGeo, ringMat);

    this.anchorGroup = new THREE.Group();
    this.scene.add(this.anchorGroup);
    this.anchors = [];
    this.capGeo = new THREE.OctahedronGeometry(0.26);

    this.beamPos = new Float32Array(400 * 6);
    this.beamCol = new Float32Array(400 * 6);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(this.beamPos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute("color", new THREE.BufferAttribute(this.beamCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.beams = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beams.frustumCulled = false;
    this.beamList = [];
    this.scene.add(this.beams);

    this._makeDust();
    this._makeConfetti();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.shift = 0;
    this.shiftGoal = 0;
    const host = canvas.parentElement;
    new ResizeObserver(() => this._resize()).observe(host);
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _resize() {
    const host = this.canvas.parentElement;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 62 : 48;
    this.size = { w, h };
    this._applyShift();
  }

  // Slide the picture sideways (in CSS pixels) so a card over the right of the view doesn't hide the stage.
  setShift(px) { this.shiftGoal = px; }

  _applyShift() {
    const { w, h } = this.size;
    if (Math.abs(this.shift) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, this.shift, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  _makeDust() {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 110;
      pos[i * 3 + 1] = Math.random() * 16 + 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 110;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x2fb6ff, size: 0.07, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.dust);
  }

  _makeConfetti() {
    const n = 420;
    this.conf = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), col: new Float32Array(n * 3), life: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.conf.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.conf.col, 3));
    this.confPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.confPoints.frustumCulled = false;
    this.confPoints.visible = false;
    this.scene.add(this.confPoints);
  }

  // ------------------------------------------------------------ dataset

  setDataset(ds, popResult, anchorResult) {
    this.ds = ds;
    this._clearStage();
    this.pop.clear();
    this.anchors.forEach((a) => { if (a.label) disposeLabel(a.label); });
    this.anchorGroup.clear();
    this.anchors = [];

    this._holoVis();
    this.popIndex = indexPopulation(popResult);
    const aCol = this.popIndex.cols.indexOf(ds.anchorColumn.toLowerCase());
    const labelCol = this.popIndex.cols.indexOf(ds.populationLabel.toLowerCase());
    const list = anchorResult.rows.map((r) => ({ key: r[0], label: r[1] }));
    if (popResult.rows.some((r) => r[aCol] === null)) list.push({ key: null, label: "No " + ds.anchorNoun });

    const n = list.length;
    list.forEach((a, i) => {
      const ang = THREE.MathUtils.degToRad(-72 + (n === 1 ? 72 : 144 * i / (n - 1)));
      a.pos = new THREE.Vector3(Math.sin(ang) * ANCHOR_R, 0, -Math.cos(ang) * ANCHOR_R);
      a.out = a.pos.clone().setY(0).normalize();
      a.side = new THREE.Vector3(-a.out.z, 0, a.out.x);
      a.top = a.pos.clone().setY(2.9);
      a.members = [];
      // A regional desk that rises out of the floor (staggered), facing the evidence table. When a result touches
      // its country/port the desktop rises further, like a sit-stand desk going up.
      const pylon = makeRegionDesk();
      pylon.scale.setScalar(1.55);
      pylon.position.copy(a.pos).setY(-1.6);
      pylon.rotation.y = Math.atan2(-a.pos.x, -a.pos.z);
      a.desk = pylon;
      a.rise = { y: -1.6, delay: 0.15 * i, up: 0, upGoal: 0 };
      const cap = new THREE.Mesh(this.capGeo, new THREE.MeshBasicMaterial({ color: a.key === null ? 0x3f8f58 : 0x39ff6e }));
      cap.position.copy(a.top);
      a.cap = cap;
      a.label = makeLabel(String(a.label), { height: 0.85, size: 34, color: a.key === null ? "#3f8f58" : "#39ff6e" });
      a.label.position.copy(a.top).setY(3.35);
      this.anchorGroup.add(pylon, cap, a.label);
      this.anchors.push(a);
    });

    this.popById = new Map();
    popResult.rows.forEach((r, idx) => {
      const k = Math.max(0, list.findIndex((a) => cellKey(a.key) === cellKey(r[aCol])));
      const a = list[k];
      const j = a.members.length;
      const home = a.pos.clone()
        .addScaledVector(a.out, 1.7 + Math.floor(j / 4) * 1.05)
        .addScaledVector(a.side, ((j % 4) - 1.5) * 1.05 + (Math.random() - 0.5) * 0.2);
      const face = Math.atan2(-home.x, -home.z);
      const it = this.pop.add({ id: r[this.popIndex.idIdx], name: String(r[labelCol]), anchor: k, home, yaw: face, yawGoal: face, tyaw: face, delay: 0, s: 0, ts: 0, pop: true });
      it.p.copy(home);
      it.t.copy(home);
      a.members.push(it);
      this.popById.set(it.id, it);
      void idx;
    });
    this.overview();
  }

  overview() {
    if (this.mode === "desk" && !this.holo) this.zoomScreen();
  }

  // Zoom into the laptop screen (the analyst steps out of the shot: it is their point of view).
  zoomScreen() {
    this.crew.screenView();
    clearTimeout(this.heroTimer);
    this.heroTimer = setTimeout(() => this.crew.setHeroVisible(false), 700);
  }

  // Everything that is the hologram (and nothing else) is only visible while it is up.
  _holoVis() {
    const on = this.holo;
    [this.anchorGroup, this.beams, this.pop.mesh, this.pop.rings, this.spawnFig.mesh, this.spawnFig.rings, this.crates.mesh, this.crates.rings, this.pillars.mesh, this.pillars.rings]
      .forEach((o) => { o.visible = on; });
  }

  // The hologram: the office goes away, green on black takes over. The desks rise out of the floor again.
  setHolo(on) {
    this.holo = on;
    clearTimeout(this.heroTimer);
    if (this.room) this.room.visible = !on;
    this.crew.furn.visible = !on;
    this.crew.hidden = on;
    this.dust.visible = on;
    this._holoVis();
    if (on && !this.holoMat) this.holoMat = new THREE.MeshBasicMaterial({ color: 0x2dff6a, wireframe: true, transparent: true, opacity: 0.5 });
    this.anchors.forEach((a, i) => {
      a.desk.traverse((m) => {
        if (!m.isMesh) return;
        if (on) { if (!m.userData.orig) m.userData.orig = m.material; m.material = this.holoMat; }
        else if (m.userData.orig) m.material = m.userData.orig;
      });
      if (on && a.rise) { a.rise.y = -1.6; a.rise.delay = 0.12 * i; }
    });
    if (on) {
      // you walk the hologram yourself; the crew and two detectives stand together off to the side
      this.crew.enterHolo();
      this.setMode("walk");   // glide the camera out of the room first...
      this.walker.place(0, 10.5, Math.PI);   // ...then stand behind the stage looking at it
      this.walker.camPitch = 0.3;
      this.walker.locked = false;
    } else {
      this._clearStage();
      this.crew.exitHolo();
      this.crew.startSeated();
      this.walker.locked = true;
      this.setMode("desk");
    }
  }

  // ------------------------------------------------------------ walking / sitting

  setMode(m) {
    this.mode = m;
    if (m === "desk") this.orbit.rate = 2.6;
    if (this.room) this.room.userData.ceiling.visible = m === "walk";
    if (m === "walk") this.walker.takeCamera();
  }

  // Input on/off (off behind the title screen and the case board).
  setWalking(on) { this.walker.enabled = !!on; if (!on) { this.walker.keys.clear(); this.walker.stick.x = this.walker.stick.y = 0; } }

  // The analyst starts on their feet by the door.
  startStanding() {
    this.crew.startStanding();
    this.walker.locked = false;
    this.walker.place(START.x, START.z, START.yaw);
    this.walker.camPitch = 0.3;
    this.setMode("walk");
  }

  // ...or already in the chair (links with a #question, tests).
  startSeated() {
    this.crew.startSeated();
    this.walker.locked = true;
    this.setMode("desk");
    this.zoomScreen();
  }

  // Walk to the chair, sit, and hand the view to the laptop. Resolves when seated.
  async sitAtDesk() {
    const w = this.walker;
    await w.goTo(APPROACH.x, APPROACH.z, APPROACH.yaw);
    w.locked = true;
    await this.crew.sitDown();
    this.setMode("desk");
    // over the shoulder first: the analyst typing, seen from behind, then the push in to the screen
    this.crew.shoulderView();
    this.crew.startTyping();
    await new Promise((r) => setTimeout(r, 1700));
  }

  // Back on your feet, camera gliding in behind you. Resolves when you can walk.
  async standFromDesk() {
    this.setMode("walk");
    this.setHolo(false);
    this.crew.setHeroVisible(true);
    this.walker.locked = true;
    await this.crew.standUp();
    this.walker.place(APPROACH.x, APPROACH.z, APPROACH.yaw, this.orbit.theta - Math.PI);
    this.walker.locked = false;
  }

  // Safety net for standFromDesk: finish standing right now (no animation) and hand the controls back.
  forceStand() {
    const c = this.crew;
    c.slide = null; c.after = null; c.heroState = "stand"; c.state = "idle";
    if (c.hero) { c.hero.clear(); c.hero.hold(null); }
    this.setMode("walk");
    this.walker.auto = null;
    this.walker.place(APPROACH.x, APPROACH.z, APPROACH.yaw, this.orbit.theta - Math.PI);
    this.walker.locked = false;
  }

  // Which desks a result touches (their desktops rise, the rest settle back down).
  _raiseDesks(keys) {
    this.anchors.forEach((a, i) => { if (a.rise) a.rise.upGoal = keys && keys.has(i) ? 0.34 : 0; });
  }

  // The analyst goes to the laptop. Resolves when the typing beat is done.
  beginWork() { return this.crew.beginWork(); }
  finishWork(kind) { this.crew.finishWork(kind); }

  // ------------------------------------------------------------ staging

  _clearStage() {
    this.spawnFig.clear();
    this.crates.clear();
    this.pillars.clear();
    this.beamList = [];
    this._raiseDesks(null);
    this.pop.items.forEach((it) => {
      this.pop.setLabel(it, null);
      // no walking back: the hologram just re-forms where it belongs
      it.p.copy(it.home);
      it.t.copy(it.home);
      it.tyaw = it.yawGoal = it.yaw = Math.atan2(-it.home.x, -it.home.z);
      it.tc.copy(COLORS.dim);
      it.c.copy(COLORS.dim);
      it.tglow = it.glow = DIM_GLOW;
      it.state = 0;
      it.pop = true;
      it.s = 0;
      it.ts = 0;   // nobody is on show until a result calls them up
      it.delay = Math.random() * 0.5;
    });
  }

  home() {
    this._clearStage();
    this.overview();
  }

  showError() {
    this._clearStage();
    this._flashStage("#ff3048", 1.6);
    this.overview();
  }

  // view: { result, sql, grade?, expected?, vis? }. Returns what the HUD should say.
  show(view) {
    this._clearStage();
    const res = view.result;
    const plan = analyze(res, view.sql, this.popIndex);
    const g = view.grade && !view.grade.correct && !view.grade.colMismatch && !view.grade.orderWrong ? view.grade : null;
    const range = heatRange(res.rows, plan.heatCol);
    const colorFor = (row) => {
      const t = norm(row[plan.heatCol], range);
      return t === null ? COLORS.lit.clone() : heat(0.08 + 0.92 * t);
    };
    const info = { mode: plan.mode, rows: res.rows.length, more: 0, legend: null, joined: false };
    if (range && plan.heatCol >= 0) info.legend = { col: res.columns[plan.heatCol], min: range.min, max: range.max };

    if (plan.mode === "entities") this._showEntities(res, plan, g, colorFor, view, info);
    else if (plan.mode === "aggregate") this._showAggregate(res, plan, g, range, view, info);
    else this._showSpawn(res, plan, g, colorFor, view, info);

    this.uniforms.uPulse.value = 1;
    this.pulseT = 0;
    return info;
  }

  _rowLabel(row, plan, fallback) {
    if (plan.labelCol >= 0 && row[plan.labelCol] !== null && row[plan.labelCol] !== undefined) return fmt(row[plan.labelCol]);
    return fallback || "";
  }

  _showEntities(res, plan, g, colorFor, view, info) {
    const seen = new Map();
    const strays = [];
    plan.ids.forEach((id, i) => {
      const extra = g ? g.extra.has(i) : false;
      if (id === null || !this.popById.has(id)) { strays.push({ row: res.rows[i], extra }); return; }
      if (seen.has(id)) { if (extra) seen.get(id).extra = true; return; }
      seen.set(id, { it: this.popById.get(id), row: res.rows[i], extra });
    });
    const entries = Array.from(seen.values());
    if (g && g.missing.length && view.expected) {
      const m = matchRows(view.expected.columns, g.missing, this.popIndex);
      m.ids.forEach((id) => {
        if (id === null || seen.has(id)) return;
        seen.set(id, true);
        entries.push({ it: this.popById.get(id), missing: true });
      });
    }

    const n = entries.length + strays.length;
    const sp = n > 60 ? 0.95 : 1.3;
    const pos = plan.ordered ? lineup(n, sp) : stageGrid(n, sp);
    const showLabels = n <= 26;
    entries.forEach((e, i) => {
      const it = e.it;
      it.t.copy(pos[i]);
      it.p.copy(pos[i]);   // the figure materialises on the stage; it never walks there
      it.yaw = it.yawGoal = it.tyaw = 0;
      it.pop = true;
      it.s = 0;
      it.ts = 1;
      it.delay = i * 0.035 + Math.random() * 0.12;
      it.tglow = 1;
      if (e.missing) { it.tc.copy(COLORS.missing); it.state = 1; }
      else {
        // No number to heat-map: colour people by their department/city instead.
        it.tc.copy(plan.heatCol >= 0 ? colorFor(e.row) : this._anchorColor(it.anchor));
        it.state = e.extra ? 2 : 0;
      }
      it.labelOff = 0.12 + (plan.ordered ? (i % 2) * 0.5 : 0);
      if (showLabels) {
        const rank = plan.ordered && !e.missing ? "#" + (i + 1) + " " : "";
        const sub = e.missing ? "missing" : plan.heatCol >= 0 ? res.columns[plan.heatCol] + " " + fmt(e.row[plan.heatCol]) : null;
        const text = e.missing ? it.name : rank + this._rowLabel(e.row, plan, it.name);
        this.pop.setLabel(it, makeLabel(clip(text), { sub, color: e.missing ? "#ff3048" : e.extra ? "#ffb020" : "#" + it.tc.getHexString() }));
      }
    });
    // Rows that didn't map to anyone (rare) still get a body so the count on stage is honest.
    strays.forEach((s, j) => {
      const at = pos[entries.length + j];
      const it = this.spawnFig.add({ tyaw: 0, yaw: 0, faceMove: false, delay: (entries.length + j) * 0.035 });
      if (!it) return;
      it.t.copy(at);
      it.p.copy(at);
      it.pop = true;
      it.s = 0;
      it.tc.copy(colorFor(s.row));
      it.c.copy(it.tc);
      it.tglow = 1;
      it.state = s.extra ? 2 : 0;
    });

    this._raiseDesks(new Set(entries.filter((e) => !e.missing).map((e) => e.it.anchor)));
    if (plan.heatCol < 0) info.colorBy = this.ds.anchorNoun;
    if (/\bjoin\b/i.test(stripSql(view.sql))) {
      info.joined = true;
      entries.forEach((e) => { if (!e.missing && this.anchors[e.it.anchor].key !== null) this.beamList.push({ it: e.it, a: this.anchors[e.it.anchor] }); });
    }
    const cam = 12 + Math.min(n, 60) * 0.13;
    this.orbit.flyTo(new THREE.Vector3(0, 0.9, plan.ordered ? 2 : 0.6), cam, 1.0);
  }

  _anchorColor(k) {
    const a = this.anchors[k];
    return a && a.key !== null ? CATEGORY[k % CATEGORY.length].clone() : new THREE.Color("#8d9ab3");
  }

  _anchorFor(row, skip) {
    for (let c = 0; c < row.length; c++) {
      if (c === skip || row[c] === null) continue;
      const k = cellKey(row[c]);
      const i = this.anchors.findIndex((a) => a.key !== null && (cellKey(a.key) === k || cellKey(a.label) === k));
      if (i >= 0) return i;
    }
    return -1;
  }

  _showAggregate(res, plan, g, range, view, info) {
    const mc = plan.measureCol;
    const bars = res.rows.map((row, i) => ({ row, extra: g ? g.extra.has(i) : false }));
    if (g && g.missing.length) g.missing.slice(0, 40).forEach((row) => bars.push({ row, missing: true }));
    let lo = Math.min(0, range ? range.min : 0);
    let hi = range ? range.max : 1;
    bars.forEach((b) => { const v = b.row[mc]; if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    const scale = (v) => (typeof v === "number" && hi > lo ? 0.25 + 5.5 * (v - lo) / (hi - lo) : 0.25);

    const used = new Set();
    bars.forEach((b) => {
      const a = this._anchorFor(b.row, mc);
      b.anchor = a >= 0 && !used.has(a + (b.missing ? "m" : "")) ? a : -1;
      if (b.anchor >= 0) used.add(a + (b.missing ? "m" : ""));
    });
    this._raiseDesks(new Set(bars.filter((b) => b.anchor >= 0 && !b.missing).map((b) => b.anchor)));
    const loose = bars.filter((b) => b.anchor < 0);
    const single = bars.length === 1;
    // Up to 24 loose bars stand in one row, so a trend (like a running total) reads left to right.
    const crowded = loose.length > 12;
    const pos = lineup(loose.length, single ? 1 : crowded ? 1.15 : 1.55, loose.length <= 24 ? loose.length : 12);
    let li = 0;
    const every = crowded ? Math.ceil(loose.length / 6) : 1;
    bars.forEach((b, i) => {
      let at;
      if (b.anchor >= 0) {
        const a = this.anchors[b.anchor];
        at = a.pos.clone().addScaledVector(a.out, b.missing ? -4.6 : -3.2);
      } else {
        at = pos[li++].clone();
        if (single) at.set(0, 0, 0.5);
      }
      const v = b.row[mc];
      const color = b.missing ? COLORS.missing.clone() : typeof v === "number" ? heat(0.08 + 0.92 * (hi > lo ? (v - lo) / (hi - lo) : 1)) : COLORS.lit.clone();
      const it = this.pillars.add({ tyaw: 0, yaw: 0, faceMove: false, h: 0.01, th: scale(v), s: single ? 1.7 : 1, ts: single ? 1.7 : 1, delay: i * 0.06, labelY: 1, labelOff: 0.2, ringScale: 1.4 });
      if (!it) return;
      it.p.copy(at);
      it.t.copy(at);
      it.tc.copy(color);
      it.c.copy(color).multiplyScalar(0.3);
      it.tglow = 1;
      it.state = b.missing ? 1 : b.extra ? 2 : 0;
      // When crowded, label every few bars, the last one and anything flagged right or wrong.
      const loneIdx = b.anchor < 0 ? li - 1 : -1;
      const labelled = !crowded || b.anchor >= 0 || b.missing || b.extra || loneIdx % every === 0 || loneIdx === loose.length - 1;
      if (labelled && bars.length <= 60) {
        const title = plan.labelCol >= 0 ? fmt(b.row[plan.labelCol]) : res.columns[mc];
        const sub = (b.missing ? "missing  " : "") + res.columns[mc] + " " + fmt(v);
        this.pillars.setLabel(it, makeLabel(title, { sub, height: single ? 0.75 : 0.58, color: b.missing ? "#ff3048" : b.extra ? "#ffb020" : "#" + color.getHexString() }));
      }
      // The people behind an anchored bar light up in its colour: they're the rows being counted.
      if (b.anchor >= 0 && !b.missing) {
        this.anchors[b.anchor].members.forEach((m) => { m.tc.copy(color); m.tglow = 0.95; m.ts = 1; m.s = 0; m.pop = true; m.delay = Math.random() * 0.5; });
      }
    });
    if (used.size) this.orbit.flyTo(new THREE.Vector3(0, 1.8, -8), 21, 0.95);
    else this.orbit.flyTo(new THREE.Vector3(0, 2, 2), Math.min(26, 12 + loose.length * 0.6), 1.1);
  }

  _showSpawn(res, plan, g, colorFor, view, info) {
    const pool = (view.vis || this.ds.spawnMesh) === "crate" ? this.crates : this.spawnFig;
    const cap = 480;
    const rows = res.rows.slice(0, cap);
    info.more = res.rows.length - rows.length;
    const list = rows.map((row, i) => ({ row, extra: g ? g.extra.has(i) : false }));
    if (g && g.missing.length) g.missing.slice(0, 50).forEach((row) => list.push({ row, missing: true }));
    const n = list.length;
    const sp = n > 200 ? 0.62 : n > 80 ? 0.85 : n > 30 ? 1.05 : 1.4;
    const size = Math.min(1, sp / 1.2);
    const pos = plan.ordered && n <= 40 ? lineup(n, sp) : stageGrid(n, sp);
    const showLabels = n <= 30;
    list.forEach((e, i) => {
      const crate = pool === this.crates;
      const yaw = crate ? (Math.random() - 0.5) * 0.5 : 0;
      const it = pool.add({ tyaw: yaw, yaw, yawGoal: yaw, faceMove: false, s: size, ts: size, delay: i * (n > 100 ? 0.006 : 0.03), labelY: crate ? 0.95 : 1.95, ringScale: crate ? 1.2 : 1 });
      if (!it) return;
      it.t.copy(pos[i]);
      it.p.copy(pos[i]);
      it.pop = true;
      it.s = 0;
      it.tc.copy(e.missing ? COLORS.missing : colorFor(e.row));
      it.c.copy(it.tc);
      it.tglow = 1;
      it.glow = 1;
      it.state = e.missing ? 1 : e.extra ? 2 : 0;
      if (showLabels) {
        const rank = plan.ordered && !e.missing ? "#" + (i + 1) + " " : "";
        const sub = e.missing ? "missing" : plan.heatCol >= 0 && plan.heatCol !== plan.labelCol ? res.columns[plan.heatCol] + " " + fmt(e.row[plan.heatCol]) : null;
        it.labelOff = 0.12 + (plan.ordered ? (i % 2) * 0.55 : 0);
        pool.setLabel(it, makeLabel(clip(rank + this._rowLabel(e.row, plan, "row " + (i + 1))), { sub, color: e.missing ? "#ff3048" : e.extra ? "#ffb020" : "#" + it.tc.getHexString() }));
      }
    });
    this.orbit.flyTo(new THREE.Vector3(0, 0.8, plan.ordered ? 2 : 0.6), Math.min(30, 12 + Math.sqrt(n) * 1.6), 1.0);
  }

  // ------------------------------------------------------------ effects

  celebrate() {
    const c = this.conf;
    const tmp = new THREE.Color();
    for (let i = 0; i < c.n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * STAGE_R;
      c.pos[i * 3] = Math.cos(a) * r;
      c.pos[i * 3 + 1] = 0.2;
      c.pos[i * 3 + 2] = Math.sin(a) * r;
      c.vel[i * 3] = (Math.random() - 0.5) * 3;
      c.vel[i * 3 + 1] = 5 + Math.random() * 7;
      c.vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      heat(Math.random(), tmp);
      c.col[i * 3] = tmp.r;
      c.col[i * 3 + 1] = tmp.g;
      c.col[i * 3 + 2] = tmp.b;
    }
    this.confPoints.geometry.attributes.color.needsUpdate = true;
    c.life = 3;
    this.confPoints.visible = true;
    this._flashStage("#3dff9a", 2.5);
  }

  _flashStage(hex, secs) {
    this.stageFlash = { color: new THREE.Color(hex), t: secs, total: secs };
  }

  // ------------------------------------------------------------ frame

  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    const t = this.time;
    this.uniforms.uTime.value = t;
    if (this.uniforms.uPulse.value > 0) {
      this.pulseT += dt;
      if (this.pulseT > 4.5) this.uniforms.uPulse.value = Math.max(0, this.uniforms.uPulse.value - dt);
    }
    if (this.stageFlash) {
      const f = this.stageFlash;
      f.t -= dt;
      const w = Math.max(0, f.t / f.total);
      this.uniforms.uStageColor.value.copy(this.stageBase).lerp(f.color, Math.min(1, w * 1.6));
      if (f.t <= 0) { this.stageFlash = null; this.uniforms.uStageColor.value.copy(this.stageBase); }
    }

    if (this.shift !== this.shiftGoal) {
      this.shift += (this.shiftGoal - this.shift) * (1 - Math.exp(-dt * 5));
      if (Math.abs(this.shift - this.shiftGoal) < 0.5) this.shift = this.shiftGoal;
      this._applyShift();
    }
    if (this.mode === "walk") this.walker.update(dt, t);
    this.orbit.update(dt, t);
    if (this.mode === "walk") this.walker.afterCamera();
    this.crew.update(dt);
    this.anchors.forEach((a) => {
      const r = a.rise;
      if (!r || !a.desk) return;
      if (r.delay > 0) r.delay -= dt;
      else {
        r.y += (0 - r.y) * (1 - Math.exp(-dt * 2.6));
        r.up += (r.upGoal - r.up) * (1 - Math.exp(-dt * 4));
      }
      a.desk.position.y = r.y;
      a.desk.userData.top.position.y = r.up;
    });
    this.uniforms.uHolo.value += ((this.holo ? 1 : 0) - this.uniforms.uHolo.value) * (1 - Math.exp(-dt * 3));
    this.pop.update(dt, t);
    this.spawnFig.update(dt, t);
    this.crates.update(dt, t);
    this.pillars.update(dt, t);
    this.anchors.forEach((a, i) => { a.cap.rotation.y = t * 1.2 + i; a.cap.position.y = a.top.y + Math.sin(t * 2 + i) * 0.08; });

    for (let i = 0; i < this.beamList.length && i < 400; i++) {
      const b = this.beamList[i];
      this.beamPos.set([b.it.p.x, b.it.p.y + 1.25, b.it.p.z, b.a.top.x, b.a.top.y, b.a.top.z], i * 6);
      const c = b.it.c;
      this.beamCol.set([c.r, c.g, c.b, c.r * 0.35, c.g * 0.35, c.b * 0.35], i * 6);
    }
    this.beams.geometry.setDrawRange(0, Math.min(400, this.beamList.length) * 2);
    this.beams.geometry.attributes.position.needsUpdate = true;
    this.beams.geometry.attributes.color.needsUpdate = true;
    this.beams.material.opacity = 0.65 + 0.25 * Math.sin(t * 3);

    this.dust.rotation.y = t * 0.01;
    this.dust.position.y = Math.sin(t * 0.3) * 0.3;

    const c = this.conf;
    if (c.life > 0) {
      c.life -= dt;
      for (let i = 0; i < c.n; i++) {
        c.vel[i * 3 + 1] -= 7 * dt;
        c.pos[i * 3] += c.vel[i * 3] * dt;
        c.pos[i * 3 + 1] = Math.max(0.05, c.pos[i * 3 + 1] + c.vel[i * 3 + 1] * dt);
        c.pos[i * 3 + 2] += c.vel[i * 3 + 2] * dt;
      }
      this.confPoints.geometry.attributes.position.needsUpdate = true;
      this.confPoints.material.opacity = Math.min(1, c.life);
      if (c.life <= 0) this.confPoints.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
