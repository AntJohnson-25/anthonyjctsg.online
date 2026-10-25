// Turkey Bowl 3D — the view: turns sim state into animated people, a ball,
// markers and a camera. Reads the sim; never writes to it.
//
// The sim is the 2D game's, so it knows positions, velocities and an `action`
// word per player. Everything that makes it look like football in 3D is
// inferred here: which way a player faces (a corner backpedals facing the
// ball, a QB drops facing downfield), which arm carries the ball, where the
// ball travels between hands, how a tackle falls, and the players coasting to
// a stop after the whistle instead of freezing.
(function () {
  const THREE = window.THREE;
  const D = window.TBData;
  const Sim = window.TBSim;
  const A = window.TBAnim;
  const RIG = window.TBRig;
  const PH = Sim.PHASE;
  const B = A.B;
  const MID = D.FIELD_MID;
  const PI = Math.PI;
  const TAU = PI * 2;

  // Sim (x across, y downfield) -> world (X, Z). The offense attacks -Z.
  function wx(x) { return x - MID; }
  function wz(y) { return 50 - y; }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function angDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > PI) d -= TAU;
    if (d < -PI) d += TAU;
    return d;
  }
  function damp(k, dt) { return 1 - Math.exp(-k * dt); }

  const CHARS = ["lineman", "lineman_2", "tight_end", "utility_1", "utility_2", "utility_3", "utility_4"];
  const STANCE = {
    stance_qb: "qb", stance_rb: "rb", stance_wr: "wr", stance_te: "te", stance_ol: "ol",
    stance_rush: "rush", stance_cover: "cover", stance_lb: "lb", stance_contain: "contain"
  };
  const RELEASE = 0.13;   // the ball stays in the thrower's hand this long

  // ---- particles: grass, dust, confetti --------------------------------------

  function Particles(scene, n) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 4));
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.6, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ size: 0.28, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.n = n;
    this.next = 0;
    this.geo = geo;
  }
  Particles.prototype.burst = function (x, y, z, count, colors, speed, up, life, grav) {
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.4;
      this.pos[i * 3 + 1] = y + Math.random() * 0.2;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random());
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      c.set(colors[(Math.random() * colors.length) | 0]);
      this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = 1;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.8);
      this.grav[i] = grav === undefined ? 6 : grav;
    }
  };
  Particles.prototype.update = function (dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 4 + 3] = Math.min(1, this.life[i] / this.max[i] * 1.5) * 0.85;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  };

  // ---- the ball -----------------------------------------------------------------

  function buildBall() {
    const g = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: "#7a3b1c", roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), leather);
    body.scale.set(1, 1, 1.75);
    body.castShadow = true;
    g.add(body);
    // Laces on top, stripes near each tip.
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.1), white);
    lace.position.set(0, 0.1, 0);
    g.add(lace);
    for (let i = -2; i <= 2; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.01), white);
      l.position.set(0, 0.1, i * 0.018);
      g.add(l);
    }
    [-1, 1].forEach(function (s) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.008, 5, 18), white);
      ring.position.z = s * 0.115;
      g.add(ring);
    });
    return g;
  }

  function blob(color, r, opacity) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({
      color: color, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: opacity, depthWrite: false
    }));
    m.rotation.x = -PI / 2;
    m.renderOrder = 3;
    return m;
  }

  function ring(color, r0, r1) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
    }));
    m.rotation.x = -PI / 2;
    m.renderOrder = 4;
    return m;
  }

  // ---- the view --------------------------------------------------------------------

  function View(canvas, opts) {
    const quality = opts.quality || "high";
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: quality !== "low", powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== "low";
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    // Clamp the low end too: some Windows displays report a ratio below 1,
    // which rendered soft for no gain.
    this.pixelRatio = Math.max(0.85, Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : quality === "medium" ? 1.5 : 1));

    const world = window.TBWorld3D.create(renderer, quality);
    this.world = world;
    this.scene = world.scene;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 1400);
    this.camera.position.set(0, 10, 30);
    this.cam = { mode: "chase", focus: new THREE.Vector3(0, 0, 30), dist: 20, yaw: 0, pitch: 0.42, fov: 50, shake: 0, orbit: 0, init: false };

    // The fourteen players, built once. rigs[team][char].
    this.rigs = [{}, {}];
    this.states = [];
    const self = this;
    // The Mixamo bodies when their data is loaded, otherwise the procedural athletes.
    const MX = window.TBMx && window.TBMx.available() ? window.TBMx : null;
    if (MX) MX.deal(D);
    D.TEAMS.forEach(function (team, ti) {
      CHARS.forEach(function (c, ci) {
        const number = team.numbers[D.CHAR_SLOT[c]];
        const mxRig = MX ? MX.build(D.CHARACTERS[team.id][c], team, number, team.id + ":" + c) : null;
        const rig = mxRig || RIG.build(D.CHARACTERS[team.id][c], team, number, team.id + ":" + c);
        const st = {
          rig: rig, team: ti, char: c,
          anim: mxRig ? new MX.Animator(rig, ti * 7 + ci * 1.37) : new A.Animator(rig, ti * 7 + ci * 1.37),
          heading: 0, phase: Math.random() * TAU, lastHeading: 0, turnRate: 0,
          coast: null, spin: null, juke: null, carryArm: -1, actKey: "", actT: 0, lastFrameT: 0,
          variant: (RIG.hash(team.id + c) % 6),
          pos: new THREE.Vector3()
        };
        rig.root.userData.state = st;
        self.scene.add(rig.root);
        self.rigs[ti][c] = st;
        self.states.push(st);
      });
    });

    this.ball = buildBall();
    this.scene.add(this.ball);
    // A short fading trail behind a ball in the air: at game distance the
    // ball itself is a few pixels, and the eye needs the streak to track it.
    this.trail = [];
    const tg = new THREE.SphereGeometry(0.07, 8, 6);
    for (let i = 0; i < 8; i++) {
      const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.5 * (1 - i / 8), depthWrite: false }));
      tm.scale.setScalar(1 - i / 10);
      tm.visible = false;
      this.scene.add(tm);
      this.trail.push(tm);
    }
    this.trailPts = [];
    this.ballShadow = blob("#000000", 0.35, 0.45);
    this.scene.add(this.ballShadow);
    this.landing = ring("#ffffff", 0.5, 0.62);
    this.scene.add(this.landing);
    this.ctlRing = ring("#39e0ff", 0.55, 0.7);
    this.scene.add(this.ctlRing);
    this.carrierRing = ring("#ffd34a", 0.55, 0.7);
    this.scene.add(this.carrierRing);
    this.particles = new Particles(this.scene, quality === "low" ? 200 : 500);

    this.bv = {                  // ball visual state
      pos: new THREE.Vector3(0, 0.1, 0), holder: null, arm: "R",
      toss: null, queue: [], quat: new THREE.Quaternion(), spin: 0, lastInFlight: false
    };
    this.t = 0;
    this.lastEntities = null;
    this.lineup = null;
    this.spectators = [];
    this.buildSpectators();
    this.resize();
  }

  View.prototype.resize = function () {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w;
    this.h = h;
  };

  View.prototype.setPixelRatio = function (r) {
    this.pixelRatio = r;
    this.resize();
  };

  // ---- spectators: the family at the Thanksgiving table ----------------------------

  View.prototype.buildSpectators = function () {
    const self = this;
    const tp = this.world.tablePos;
    const fans = [
      { spec: { skin: "#f0cdb0", hair: "bun", hairColor: "#c9c6c2", brows: "#a09a94", eyes: "#4d6b80", height: 0.9, width: 0.95, belly: 0.3, face: "round" }, top: "#6b3f7a", pants: "#3b3a44", pose: "sit", x: 1.4, z: -2.4, h: 1.3 },
      { spec: { skin: "#d9a07a", hair: "receding", hairColor: "#b9b4ad", beard: "short", beardColor: "#c9c3bb", brows: "#8a847d", eyes: "#3b2a1a", height: 0.97, width: 1.12, belly: 0.8, face: "broad" }, top: "#9e3327", pants: "#9a8a6a", pose: "sit", x: 1.5, z: -3.4, h: 1.4 },
      { spec: { skin: "#8d5b3e", hair: "bun", hairColor: "#1d1410", brows: "#1d1410", eyes: "#2a1a10", height: 0.93, width: 0.9, belly: 0, face: "oval" }, top: "#3f6f4a", pants: "#34465e", pose: "stand", x: 2.6, z: 0.8, h: 1.6 },
      { spec: { skin: "#f2cfb0", hair: "short", hairColor: "#9a6a3a", brows: "#7a5230", eyes: "#4a6a3a", height: 0.66, width: 0.85, belly: 0, face: "young" }, top: "#e07a26", pants: "#3d4e6b", pose: "stand", x: 3.0, z: 2.1, h: 1.5 },
      { spec: { skin: "#c68a62", hair: "short_curly", hairColor: "#20160f", beard: "full", beardColor: "#20160f", brows: "#20160f", eyes: "#2e1e12", height: 1.02, width: 1.1, belly: 0.4, face: "broad" }, top: "#6b6e73", pants: "#2f3a4a", pose: "stand", x: 2.2, z: 4.6, h: 1.8 },
      { spec: { skin: "#e9bd98", hair: "bun", hairColor: "#7a3f22", brows: "#6a3a22", eyes: "#3e5a3a", height: 0.9, width: 0.92, belly: 0.1, face: "oval" }, top: "#2f6f8f", pants: "#3a3230", pose: "sit", x: 1.3, z: 3.2, h: 1.8 }
    ];
    fans.forEach(function (f, i) {
      const team = { id: "fan", primary: f.top, accent: "#ffffff", pants: f.pants, stripe: f.pants };
      const rig = RIG.build(f.spec, team, null, "fan" + i);
      rig.root.position.set(tp.x + f.x, 0, tp.z + f.z);
      rig.root.rotation.y = f.h;
      if (f.pose === "sit") rig.root.position.y = 0;
      self.scene.add(rig.root);
      self.spectators.push({ rig: rig, anim: new A.Animator(rig, i * 2.3), pose: f.pose, cheerT: 0, variant: i % 2 });
    });
  };

  View.prototype.cheer = function (secs) {
    this.spectators.forEach(function (s) { s.cheerT = secs * (0.7 + Math.random() * 0.4); });
  };

  View.prototype.updateSpectators = function (dt) {
    this.spectators.forEach(function (s) {
      s.cheerT = Math.max(0, s.cheerT - dt);
      if (s.pose === "sit") {
        s.anim.update(dt, { base: "sit", key: "sit", params: { cheer: s.cheerT > 0 } });
      } else if (s.cheerT > 0) {
        s.anim.update(dt, { base: "celebrate", key: "cheer", params: { variant: s.variant ? 0 : 4 } });
      } else {
        s.anim.update(dt, { base: "idle", key: "idle", params: {} });
      }
    });
  };

  // ---- team-select lineup: two team photos on the lawn ------------------------------

  const LINEUP_X = 4.3;
  const PHOTO = {
    wildcats: { back: ["lineman_2", "utility_1", "tight_end", "lineman"], front: ["utility_4", "utility_3", "utility_2"], ball: "utility_3" },
    turkeys: { back: ["lineman", "lineman_2", "tight_end", "utility_3"], front: ["utility_1", "utility_2", "utility_4"], ball: "utility_2" }
  };

  View.prototype.showLineup = function (on) {
    if (this.mvp) this.hideMvp();
    this.lineup = on ? { focus: -1, t: 0 } : null;
    if (!on) return;
    const self = this;
    D.TEAMS.forEach(function (team, ti) {
      const p = PHOTO[team.id];
      const cx = ti === 0 ? -LINEUP_X : LINEUP_X;
      p.back.forEach(function (c, i) {
        const st = self.rigs[ti][c];
        st.pos.set(cx + (i - 1.5) * 1.05, 0, -1.1);
        st.lineupPose = "idle";
      });
      p.front.forEach(function (c, i) {
        const st = self.rigs[ti][c];
        st.pos.set(cx + (i - 1) * 1.15, 0, 0.1);
        st.lineupPose = c === p.ball ? "kneelBall" : "kneel";
      });
    });
    this.ball.visible = true;
  };

  View.prototype.focusTeam = function (ti) {
    if (this.lineup) this.lineup.focus = ti;
  };

  // Screen position of a point, in CSS pixels (for HTML labels).
  View.prototype.project = function (x, y, z) {
    const v = _v1.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, behind: v.z > 1 };
  };

  View.prototype.renderLineup = function (dt) {
    const L = this.lineup;
    L.t += dt;
    this.t += dt;
    const self = this;
    this.states.forEach(function (st) {
      st.rig.root.position.copy(st.pos);
      // Turn a little toward the camera from the ends of the row.
      st.rig.root.rotation.y = -st.pos.x * 0.03;
      const kneel = st.lineupPose !== "idle";
      const ls = { base: kneel ? "kneel" : "idle", key: st.lineupPose, params: { ball: st.lineupPose === "kneelBall", look: 0 },
        clip: !kneel && st.rig.mx ? self.idleClip(st, L.t) : null };
      if (st.dbg) Object.assign(ls, st.dbg);   // test hook: pose a player from the console
      st.anim.update(dt, ls);
      if (st.lineupPose === "kneelBall") {
        st.rig.mesh.updateMatrixWorld(true);
        const a = _v1.setFromMatrixPosition(st.rig.handL.matrixWorld);
        const b = _v2.setFromMatrixPosition(st.rig.handR.matrixWorld);
        self.ball.position.copy(a).add(b).multiplyScalar(0.5);
        self.ball.position.z += 0.06;
        self.ball.rotation.set(0, PI / 2, 0.2);
      }
    });
    this.hideGameMarkers();
    this.updateSpectators(dt);
    // Camera: both teams, or push in on the one being chosen.
    const f = L.focus;
    this.camera.clearViewOffset();
    this.camera.aspect = this.w / this.h;
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.9;
    const tx = f < 0 ? 0 : (f === 0 ? -LINEUP_X : LINEUP_X);
    const dist = (f < 0 ? (portrait ? 24 : 11.2) : (portrait ? 11 : 6.4)) + Math.sin(L.t * 0.3) * 0.3;
    const want = _v1.set(tx + Math.sin(L.t * 0.21) * 0.5, 1.25 + (portrait ? 0.5 : 0), dist);
    const k = damp(2.2, dt);
    if (!this.cam.lineupInit) { this.camera.position.copy(want); this.cam.lineupInit = true; }
    this.camera.position.lerp(want, k);
    this.camera.fov = portrait ? 48 : 38;
    this.camera.updateProjectionMatrix();
    this.cam.look = this.cam.look || new THREE.Vector3(tx, 1, -0.5);
    this.cam.look.lerp(_v2.set(tx, 0.95, -0.5), k);
    this.camera.lookAt(this.cam.look);
    this.world.setLines(0, 0, false, false);
    this.world.update(this.t, dt, this.camera.position);
    if (!this.noDraw) this.renderer.render(this.scene, this.camera);
  };

  // ---- postgame: the MVP with a turkey leg, his team behind him ------------------------

  // A glazed roast drumstick: meat up, bone and paper frill down into the hand.
  function buildTurkeyLeg() {
    const g = new THREE.Group();
    // Golden roast skin (the generated leg art's colours), a long white bone.
    const meat = new THREE.MeshStandardMaterial({ color: "#c97a34", roughness: 0.28, metalness: 0.05, emissive: "#5a2408", emissiveIntensity: 0.3 });
    const crisp = new THREE.MeshStandardMaterial({ color: "#a65a22", roughness: 0.4 });
    const bone = new THREE.MeshStandardMaterial({ color: "#f3ead6", roughness: 0.5 });
    const paper = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, side: THREE.DoubleSide });
    // Drumstick profile: fat at the top, tapering to the knuckle.
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const r = 0.012 + 0.085 * Math.pow(Math.sin(Math.min(1, u * 1.12) * PI * 0.5), 1.6) * (u > 0.82 ? Math.sqrt(Math.max(0, 1 - (u - 0.82) / 0.18)) : 1);
      prof.push(new THREE.Vector2(Math.max(0.004, r), 0.08 + u * 0.26));
    }
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), meat);
    body.castShadow = true;
    g.add(body);
    // A few roasted bumps so it doesn't read as an egg.
    [[0.06, 0.26, 0.04], [-0.06, 0.22, 0.03], [0.02, 0.3, -0.06], [-0.035, 0.28, -0.055], [0.05, 0.18, -0.03]].forEach(function (p) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), crisp);
      b.position.set(p[0], p[1], p[2]);
      g.add(b);
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.16, 10), bone);
    shaft.position.y = 0.03;
    g.add(shaft);
    [-1, 1].forEach(function (s) {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), bone);
      k.position.set(s * 0.013, -0.055, 0);
      g.add(k);
    });
    const frill = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.02, 0.05, 12, 1, true), paper);
    frill.position.y = -0.02;
    g.add(frill);
    return g;
  }

  View.prototype.showMvp = function (team, char) {
    const self = this;
    if (!this.turkeyLeg) { this.turkeyLeg = buildTurkeyLeg(); this.scene.add(this.turkeyLeg); }
    this.turkeyLeg.visible = true;
    this.cine = null;
    this.mvp = { team: team, char: char, t: 0, confT: 0, st: this.rigs[team][char] };
    let n = 0;
    this.states.forEach(function (st) {
      st.rig.root.visible = st.team === team;
      st.mvpRole = st.char === char ? "mvp" : "mate";
      if (st.team !== team || st.char === char) return;
      const i = n++;
      const k = i - 2.5;
      st.mvpSpot = { x: k * 1.15, z: -1.9 - Math.abs(k) * 0.35 };
      st.mvpVariant = [0, D.TEAMS[team].id === "turkeys" ? 2 : 3, 4, 5, 0, 4][i];
    });
    this.hideGameMarkers();
    this.ball.visible = false;
    this.cam.mvpInit = false;
  };

  View.prototype.hideMvp = function () {
    this.mvp = null;
    if (this.turkeyLeg) this.turkeyLeg.visible = false;
    this.states.forEach(function (st) { st.rig.root.visible = true; });
  };

  View.prototype.renderMvp = function (dt) {
    const M = this.mvp;
    M.t += dt;
    this.t += dt;
    const self = this;
    const portrait = this.w / this.h < 0.9;
    const cx = portrait ? 0 : -1.0;   // the MVP stands left of the stat card on a wide screen
    this.states.forEach(function (st) {
      if (st.team !== M.team) return;
      if (st === M.st) {
        st.pos.set(cx, 0, 0);
        st.rig.root.position.copy(st.pos);
        st.rig.root.rotation.y = 0.18 * Math.sin(M.t * 0.6);
        st.anim.update(dt, { base: "idle", key: "mvp", params: {}, over: "showball", overT: M.t, fade: 0.3, clip: null });
        return;
      }
      st.pos.set(cx + st.mvpSpot.x, 0, st.mvpSpot.z);
      st.rig.root.position.copy(st.pos);
      st.rig.root.rotation.y = Math.atan2(cx - st.pos.x, 0 - st.pos.z) * 0.5;
      st.anim.update(dt, { base: "celebrate", key: "celebrate" + st.mvpVariant, t: M.t, params: { variant: st.mvpVariant }, fade: 0.3, clip: null });
    });
    // The leg in his raised right hand, meat up.
    const rig = M.st.rig;
    rig.root.updateMatrixWorld(true);
    // Gripped by the bone (the knuckle at the fist), meat up, tipped toward the camera.
    this.turkeyLeg.position.setFromMatrixPosition(rig.handR.matrixWorld);
    this.turkeyLeg.position.y -= 0.02;
    this.turkeyLeg.rotation.set(0.35, 0.3 * Math.sin(M.t * 0.7), -0.45 + 0.1 * Math.sin(M.t * 3));
    this.turkeyLeg.scale.setScalar(1.3);
    // Confetti in the team colours.
    M.confT -= dt;
    if (M.confT <= 0) {
      M.confT = 0.55;
      const team = D.TEAMS[M.team];
      this.particles.burst(cx + (Math.random() - 0.5) * 6, 3.5 + Math.random(), -1 + (Math.random() - 0.5) * 3, 40, [team.primary, team.accent, "#ffffff", "#f2c233"], 2.5, 2, 3.5, 1.4);
    }
    this.particles.update(dt);
    this.updateSpectators(dt);
    if (M.t < dt * 2) this.cheer(6);
    // Camera: low and close, the MVP and the leg filling the frame, a slow push in.
    this.camera.clearViewOffset();
    this.camera.aspect = this.w / this.h;
    const push = Math.max(0, 1 - M.t / 6);
    const want = _v1.set(cx + (portrait ? 0.2 : 0.9) + Math.sin(M.t * 0.25) * 0.3, 1.2, (portrait ? 6.2 : 3.6) + push * 1.6);
    if (!this.cam.mvpInit) { this.camera.position.copy(want); this.cam.mvpInit = true; }
    this.camera.position.lerp(want, damp(2.5, dt));
    this.camera.fov = portrait ? 50 : 40;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(cx + (portrait ? 0 : 0.55), portrait ? 1.0 : 1.25, -0.4);
    this.world.setLines(0, 0, false, false);
    this.world.update(this.t, dt, this.camera.position);
    if (!this.noDraw) this.renderer.render(this.scene, this.camera);
  };

  View.prototype.hideGameMarkers = function () {
    this.trail.forEach(function (t) { t.visible = false; });
    this.ball.scale.setScalar(1);
    this.landing.visible = false;
    this.ctlRing.visible = false;
    this.carrierRing.visible = false;
    this.ballShadow.visible = false;
  };

  // ---- per-player animation state from the sim ---------------------------------------

  // Where a player wants to face, when he is moving at speed `sp` along `mv`.
  View.prototype.lookHeading = function (gs, e) {
    const b = gs.ball;
    // An offensive QB with the ball behind the line keeps his eyes downfield.
    if (e.side === "off" && e === gs.carrier && e.role === "qb" && e.y < gs.los + 0.5 && !gs.passThrown) return PI;
    if (e.engagedWith) return Math.atan2(wx(e.engagedWith.x) - wx(e.x), wz(e.engagedWith.y) - wz(e.y));
    if (e.side === "def" && (e.ai === "COVER" || e.ai === "CONTAIN" || e.ai === "LB")) {
      const t = b.inFlight ? { x: b.tx, y: b.ty } : (gs.carrier || b);
      return Math.atan2(wx(t.x) - wx(e.x), wz(t.y) - wz(e.y));
    }
    if (e.side === "off" && e.role === "ol") return PI;
    return null;
  };

  View.prototype.updatePlayers = function (gs, dt, reset) {
    const self = this;
    const live = gs.phase === PH.LIVE;
    const dead = !live && gs.phase !== PH.PRE_SNAP && gs.phase !== PH.HUDDLE && gs.phase !== PH.HUDDLE_BREAK;
    gs.entities.forEach(function (e) {
      const st = self.rigs[e.team][e.char];
      st.e = e;
      st.live = live;
      // Coasting after the whistle: the sim froze everyone, the view lets them
      // run on and slow down over a few yards.
      let ox = 0, oz = 0;
      let vx = e.vx, vz = -e.vy;
      if (st.coast) {
        st.coast.t += dt;
        const c = st.coast;
        const k = 2.4;
        const f = (1 - Math.exp(-k * c.t)) / k;
        ox = c.vx * f;
        oz = c.vz * f;
        const decay = Math.exp(-k * c.t);
        vx = c.vx * decay;
        vz = c.vz * decay;
      }
      const X = wx(e.x) + ox;
      const Z = wz(e.y) + oz;
      st.pos.set(X, 0, Z);
      const sp = Math.hypot(vx, vz);

      // Which clip, and for how long it has been running.
      const act = e.action || "idle";
      if (reset) { st.coast = null; st.spin = null; st.juke = null; }
      if (act !== st.actName || e.frameT < st.lastFrameT - 1e-6) { st.actT = 0; st.actName = act; }
      else st.actT += dt;
      st.lastFrameT = e.frameT;

      const P = st.params || (st.params = {});
      P.speed = sp;
      P.fwd = 1; P.side = 0; P.lean = 0; P.bank = 0;
      let base = "loco", key = "loco", over = null, overT = 0, fade = 0.2, t;
      let wantHeading = null;
      let hold = null;      // "R" | "L" | "2": how the ball is carried, when this is the carrier

      const def = e.side === "def";
      const defaultHeading = def ? 0 : PI;
      const isCarrier = gs.carrier === e;

      // A defender jogging to a new alignment after a defensive call runs like
      // anyone else instead of sliding across the grass in his stance.
      const shifting = def && e.shiftX !== undefined;
      if (gs.phase === PH.HUDDLE && !shifting) {
        if (e.side === "off") {
          base = "huddle"; key = "huddle";
          P.caller = e.slot === "QB";
          wantHeading = Math.atan2(wx(gs.huddleCx) - X, wz(gs.huddleCy) - Z);
        } else {
          base = "idle"; key = "idle"; wantHeading = 0;
        }
      } else if (!shifting && (gs.phase === PH.PRE_SNAP || (gs.phase === PH.HUDDLE_BREAK && sp < 0.5 && STANCE[act]))) {
        base = "stance"; key = "stance" + act;
        P.stance = STANCE[act] || (def ? "cover" : "wr");
        if (e.slot === "OL2") P.stance = "rush";
        wantHeading = defaultHeading;
        fade = reset ? 0 : 0.3;
      } else if (act === "celebrate") {
        base = "celebrate"; key = "celebrate"; t = st.actT;
        const team = D.TEAMS[e.team].id;
        const scorer = gs.whistleCarrier === e || gs.scoredBy === e;
        P.variant = scorer ? 1 : (st.variant % 3 === 0 ? (team === "turkeys" ? 2 : 3) : [0, 4, 5, 0, 4, 5][st.variant]);
        wantHeading = Math.atan2(self.camera.position.x - X, self.camera.position.z - Z);
        fade = 0.35;
      } else if (act === "dejected") {
        base = "dejected"; key = "dejected"; P.variant = st.variant; fade = 0.5;
      } else if (act === "tackled" && e.hitBy !== undefined && !live) {
        // The runner, brought down: falls the way the hit drives him.
        base = "fall"; key = "fall"; t = st.actT;
        const hb = e.hitBy;
        const rv = Math.hypot(e.lastVx || 0, e.lastVy || 0);
        let forward = true;
        if (hb) {
          // Hit square from the front by a man coming the other way: back he goes.
          const hx = hb.x - e.x, hy = hb.y - e.y;
          const dot = rv > 0.5 ? (hx * e.lastVx + hy * e.lastVy) / (Math.hypot(hx, hy) * rv + 1e-6) : 0;
          forward = !(dot > 0.35 && (hb.lastVx * e.lastVx + hb.lastVy * e.lastVy) < 0);
        }
        P.dir = forward ? 1 : -1;
        P.dist = forward ? 0.4 + Math.min(0.8, rv * 0.08) : 0.5;
        P.rise = 1.4;
        fade = 0.08;
      } else if ((act === "tackle" && !live) || act === "whiffed" || act === "dive" || (act === "tackle" && live)) {
        // "dive": a receiver laying out for a ball just out of reach.
        base = "tackle"; key = "tackle"; t = st.actT;
        P.dist = act === "whiffed" || act === "dive" ? 1.3 : 0.9;
        P.rise = act === "whiffed" ? 0.75 : act === "dive" ? 1.4 : (live ? 0.3 : 1.25);
        fade = 0.06;
      } else if (act === "fumble") {
        base = "fall"; key = "fumble"; t = st.actT; P.dir = 1; P.dur = 0.3; P.dist = 0.5; P.rise = 0.45; fade = 0.06;
      } else if (act === "recover") {
        base = "fall"; key = "recover"; t = st.actT; P.dir = 1; P.dur = 0.3; P.dist = 0.7; P.rise = 0.9; fade = 0.06;
        over = st.actT > 0.9 ? "showball" : null; overT = st.actT - 0.9;
        hold = "R";
      } else {
        // Locomotion, with an upper-body action on top.
        if (e.lockT > 0 || !live) {
          if (act === "throw") { over = "throw"; overT = st.actT; }
          else if (act === "handoff") { over = "handoff"; overT = st.actT; }
          else if (act.indexOf("catch") === 0) { over = act; overT = st.actT; P.catchSide = e.mirror ? -1 : 1; }
          else if (act.indexOf("intercept") === 0) {
            over = st.actT < 0.45 ? act.replace("intercept", "catch") : "showball";
            overT = st.actT < 0.45 ? st.actT : st.actT - 0.45;
            hold = "R";
          }
          else if (act === "block") { over = "block"; overT = self.t; }
          else if (act === "stumble") { over = "stumble"; overT = st.actT; }
          else if (act === "swat") { over = "swat"; overT = st.actT; }
        }
        if (!over && e.engagedWith) { over = "block"; overT = self.t; }
        if (!over && e.lungeT > 0) over = "reach";
        if (isCarrier && !over) {
          if (e.role === "qb" && e.y < gs.los + 0.5 && sp < 6.5 && !gs.passThrown) hold = "Q";
          else {
            // Outside arm: the one nearer the closer touchline, with hysteresis.
            const lx = Math.cos(st.heading), lz = -Math.sin(st.heading);
            const sideline = e.x < MID ? -1 : 1;
            const d = sideline * lx;
            if (st.carryArm === 0 || Math.abs(d) > 0.45) st.carryArm = d > 0 ? 1 : (d < 0 ? -1 : (st.carryArm || -1));
            hold = st.carryArm > 0 ? "L" : "R";
            void lz;
          }
          over = hold === "Q" ? "carryQB" : (hold === "2" ? "carry2" : (hold === "L" ? "carryL" : "carryR"));
        } else if (isCarrier) {
          hold = over === "handoff" ? "R" : (st.carryArm > 0 ? "L" : "R");
        }
        if (over && over.indexOf("catch") === 0 && isCarrier) hold = "2";

        // Facing: along the run, unless the player is backpedalling or
        // shuffling to keep his eyes on something.
        const look = self.lookHeading(gs, e);
        if (sp > 0.8) {
          const move = Math.atan2(vx, vz);
          wantHeading = move;
          if (look !== null) {
            const dd = Math.abs(angDiff(look, move));
            const canPedal = (def && e.ai !== "PURSUE") || e.role === "qb" || e.engagedWith || e.role === "ol";
            if (canPedal && dd > 1.75 && sp < 7.2) wantHeading = look;
            else if (canPedal && dd > 0.95 && sp < 5.5) wantHeading = look;
          }
        } else {
          wantHeading = look !== null ? look : (dead && st.coast ? st.heading : defaultHeading);
          if (live && !isCarrier && look === null) {
            const tb = gs.ball.inFlight ? { x: gs.ball.tx, y: gs.ball.ty } : (gs.carrier || gs.ball);
            wantHeading = Math.atan2(wx(tb.x) - X, wz(tb.y) - Z);
          }
          if (dead && !st.coast) wantHeading = null;
        }
        base = "loco"; key = "loco";
      }

      // How long this base animation has been running (drives Mixamo clip time).
      if (reset || key !== st.keyName) { st.keyName = key; st.keyT = 0; } else st.keyT += dt;

      // Spin move and juke, from the sim's events.
      let spinOff = 0;
      if (st.spin) {
        st.spin.t += dt;
        const u = clamp(st.spin.t / D.SPIN_DURATION, 0, 1);
        spinOff = st.spin.dir * TAU * (u * u * (3 - 2 * u));
        if (u >= 1) st.spin = null;
      }
      if (st.leap) {
        st.leap.t += dt;
        const dur = st.leap.kind === "corkscrew" ? D.HURDLE.FLIP_DURATION : D.HURDLE.DURATION;
        if (st.leap.t > dur || !live || !isCarrier) st.leap = null;
      }
      if (st.juke) {
        st.juke.t += dt;
        P.bank = st.juke.dir * 0.4 * Math.max(0, 1 - st.juke.t / 0.3);
        if (st.juke.t > 0.3) st.juke = null;
      }

      // Turn toward the wanted heading at a human rate.
      if (reset) {
        st.heading = wantHeading === null ? defaultHeading : wantHeading;
      } else if (wantHeading !== null && base !== "fall" && base !== "tackle") {
        const d = angDiff(wantHeading, st.heading);
        const rate = (sp > 3 ? 11 : 7) * dt;
        const step = clamp(d * damp(14, dt), -rate, rate);
        st.heading += step;
      }
      if ((base === "tackle") && st.actT < dt * 1.5 && e.hitWho) {
        st.heading = Math.atan2(wx(e.hitWho.x) - X, wz(e.hitWho.y) - Z);
      }
      const turn = angDiff(st.heading, st.lastHeading) / Math.max(dt, 1e-4);
      st.lastHeading = st.heading;
      st.turnRate += (turn - st.turnRate) * damp(8, dt);

      // Local direction of travel for the leg cycle.
      if (sp > 0.05) {
        const h = st.heading;
        P.fwd = (vx * Math.sin(h) + vz * Math.cos(h)) / sp;
        P.side = (vx * Math.cos(h) - vz * Math.sin(h)) / sp;
      }
      P.bank += clamp(st.turnRate * sp * 0.012, -0.28, 0.28);
      const cycle = 1.8 + 0.24 * sp;
      st.phase += (sp / cycle) * TAU * dt;
      P.phase = st.phase;

      // The ball in the air: everybody near it tracks it with his head.
      let lookYaw = 0;
      st.ballRel = null;    // where the ball in the air is, relative to his facing (Look Behind Run)
      if (live && gs.ball.inFlight && !isCarrier) {
        const bx = self.bv.pos.x - X, bz = self.bv.pos.z - Z;
        lookYaw = angDiff(Math.atan2(bx, bz), st.heading);
        st.ballRel = lookYaw;
        if (Math.abs(lookYaw) > 2.2) lookYaw = 0;
      }

      st.anim.update(dt, {
        base: base, key: key, t: t, params: P, over: over, overT: overT,
        fade: reset ? 0 : fade, lookYaw: lookYaw * 0.8,
        clip: st.rig.mx ? self.mxClip(st, base, key, over, overT, P, sp, dt) : null
      });
      st.rig.root.position.copy(st.pos);
      st.rig.root.rotation.y = st.heading + spinOff;
      st.hold = isCarrier || act === "recover" || (act.indexOf("intercept") === 0) ? (hold || "R") : null;
      st.rig.root.visible = true;
    });
  };

  // Which Mixamo clip (if any) plays over the retargeted procedural pose this frame.
  // Clip windows were picked from contact sheets (tools/clipview.html): see
  // Notes/2026-10-02 mixamo players.md.
  View.prototype.mxClip = function (st, base, key, over, overT, P, sp, dt) {
    const C = window.TBChars.clips;
    // The three-point stance of the linemen: stand, then settle into the crouch and hold it.
    if (base === "stance" && (P.stance === "ol" || P.stance === "rush")) {
      return { name: "stance", t: Math.min(st.keyT * 0.95, 2.5), part: "all", hips: true, fadeIn: 0.3, fadeOut: 0.3 };
    }
    // A defender's lunging tackle, and the runner's fall.
    if (base === "tackle") return { name: "defA", t: Math.min(0.55 + st.keyT * 1.3, 2.1), part: "all", hips: true, fadeIn: 0.08, fadeOut: 0.3 };
    // Brought down: forward falls keep the Dying take; a runner knocked back
    // (P.dir < 0) gets the library's backward death fall.
    if (base === "fall" && key === "fall" && P.dir < 0 && C.deathB) return { name: "deathB", t: Math.min(DEATHB.t0 + st.keyT * DEATHB.rate, DEATHB.t1), part: "all", hips: true, fadeIn: 0.1, fadeOut: 0.3 };
    if (base === "fall" && key === "fall") return { name: "die", t: Math.min(1.5 + st.keyT * 1.5, 4.3), part: "all", hips: true, fadeIn: 0.1, fadeOut: 0.3 };
    // Library takes for the dead-ball moments (2026-10-03, ANIMATION_MAP.md).
    if (base === "idle") return this.idleClip(st, st.keyT);
    if (base === "celebrate") {
      // The scorer: a butterfly twirl, then the procedural point-to-the-sky;
      // or a breakdance flair for the whole celebration.
      if (P.variant === 1) {
        if (st.variant % 2 === 0 && C.flair) return { name: "flair", t: st.keyT % C.flair.dur, part: "all", hips: true, fadeIn: 0.35, fadeOut: 0.4 };
        if (C.twirl && st.keyT < C.twirl.dur) return { name: "twirl", t: st.keyT, part: "all", hips: true, fadeIn: 0.2, fadeOut: 0.5 };
      }
      // Teammates' strut, claw, dance and flex stay procedural.
      return null;
    }
    // The quarterback's throw: the clip's wind-up and release squeezed into the throw overlay.
    // (2026-10-25: the Quarterback Pass clip folded the torso into a hunch and went
    // stiff from a pocket pose; the procedural overlay winds up from carryQB instead.)
    // Reaching catches: arms only.
    // A high ball: the receiver leaps for it. A batted ball: the defender's jump.
    if (over === "catch_away") return { name: "rcatch", t: clamp(0.3 + overT * 1.1, 0.3, 0.9), part: "all", hips: true, fadeIn: 0.08, fadeOut: 0.25 };
    if (over === "swat") return { name: "defB", t: clamp(0.14 + overT * 1.2, 0.14, 0.7), part: "all", hips: true, fadeIn: 0.06, fadeOut: 0.25 };
    // A ball off to one side: the goalkeeper's jumping two-hand catch overhead
    // (the take drifts to his right; mirrored for a ball on his left, catchSide > 0).
    if (over === "catch_side") return { name: (P.catchSide || 1) > 0 ? "gkCatch_m" : "gkCatch", t: clamp(0.55 + overT * 1.6, 0.55, 1.3), part: "all", hips: true, fadeIn: 0.08, fadeOut: 0.25 };
    if (over === "catch_toward") return { name: "catchA", t: clamp(0.35 + overT * 1.1, 0.35, 0.9), part: "arms", hips: false, fadeIn: 0.06, fadeOut: 0.2 };
    return this.mxLoco(st, base, over, P, sp, dt);
  };

  // Locomotion clips (Source/animations, 2026-10-03), picked by the direction of
  // travel relative to where the player faces. Each is a looping take; its time
  // comes from a phase that advances with ground speed over the take's stride
  // (yards per cycle, measured from the take's hips travel), so feet keep pace.
  // Legs only while an arm job (carry, block, reach) is on.
  // walk*/sprint: from the shared animation library (2026-10-03), strides from
  // ANIMATION_MAP.md (walk 1.66 / 1.56 m, Fast Run 2.90 m a cycle).
  const LOCO = {
    runF: { stride: 3.24 }, runB: { stride: 2.0 }, jogB: { stride: 1.25 },
    strafe: { stride: 2.5 }, strafeR: { stride: 3.0 }, arcL: { stride: 2.49 }, lookRun: { stride: 2.41 },
    walkM: { stride: 1.82 }, walkF: { stride: 1.71 }, sprint: { stride: 3.17 }
  };
  // Library takes in a male and a female style; the body's style picks one
  // (TRAITS in mxrig.js; only Rosa is "f" so far).
  // (The library's other idles were tried and dropped: "idle (3)" reads as a
  // hurt, slouched shuffle.)
  const STYLE = { idle: { m: ["idleM"], f: ["idleF"] }, walk: { m: "walkM", f: "walkF" } };
  const styleOf = function (st) { return (st.rig && st.rig.style) || "m"; };
  // The window of the backward death fall that plays (picked from a contact sheet).
  // The take staggers for ~1 s before it goes down; start there, flat by ~0.6 s.
  const DEATHB = { t0: 1.0, rate: 1.4, t1: 3.05 };

  // Standing still: one of the library's idle loops, offset per player so a row
  // of them doesn't breathe in step. Null when the clips are missing.
  View.prototype.idleClip = function (st, t) {
    const C = window.TBChars && window.TBChars.clips;
    const list = STYLE.idle[styleOf(st)];
    const name = list[st.variant % list.length];
    if (!C || !C[name]) return null;
    return { name: name, t: (t + st.variant * 1.7) % C[name].dur, part: "all", hips: true, fadeIn: 0.4, fadeOut: 0.3 };
  };
  View.prototype.mxLoco = function (st, base, over, P, sp, dt) {
    const C = window.TBChars.clips;
    const part = over ? "lower" : "all";
    // The hurdle (Running Jump, lands back in stride) and the front corkscrew
    // (Front Twist Flip, the window Dodge It plays). Whole body, carry arm kept.
    if (st.leap && base === "loco") {
      const L = st.leap;
      if (L.kind === "corkscrew" && C.twistflip) return { name: "twistflip", t: Math.min(0.45 + L.t * 1.45, C.twistflip.dur - 0.05), part: "all", hips: true, fadeIn: 0.06, fadeOut: 0.18 };
      if (L.kind === "hurdle" && C.hurdle) return { name: "hurdle", t: Math.min(L.t * 1.12, C.hurdle.dur - 0.02), part: "all", hips: true, fadeIn: 0.06, fadeOut: 0.15 };
    }
    // A juke: the Sprint Turn's plant-and-cut, squeezed into the juke. The take
    // cuts to his right; mirrored when the burst goes left.
    if (st.juke && base === "loco") {
      if (st.juke.clip === undefined) st.juke.clip = (P.side + st.turnRate * 0.1) > 0 ? "sprintTurn_m" : "sprintTurn";
      return { name: st.juke.clip, t: 0.2 + st.juke.t * 2.3, part: part, hips: true, fadeIn: 0.05, fadeOut: 0.2 };
    }
    const prev = st.loco;
    st.loco = null;
    if (base !== "loco") return null;
    // Direction of travel in his own frame: 0 ahead, +PI/2 to his left, PI behind.
    const ang = Math.abs(Math.atan2(P.side, P.fwd));
    const was = function (names) { return prev && names.indexOf(prev.name.replace(/_m$/, "")) >= 0; };
    let name = null;
    if (ang < 0.8) {
      if (sp > (was(["runF", "arcL", "lookRun", "sprint"]) ? 2.2 : 3.2)) {
        const turning = Math.abs(st.turnRate) > (was(["arcL"]) ? 0.7 : 1.1) && sp > 4;
        // Ball in the air behind him (a deep route, or a defender chasing it):
        // run on, head over the shoulder it is coming over.
        if (st.ballRel !== null && !over && Math.abs(st.ballRel) > 1.9) name = st.ballRel > 0 ? "lookRun" : "lookRun_m";
        else if (turning) name = st.turnRate > 0 ? "arcL" : "arcL_m";
        // Flat out (a breakaway, a pursuit angle): the library's Fast Run.
        else if (sp > (was(["sprint"]) ? 7.0 : 7.6)) name = "sprint";
        else name = "runF";
      } else if (sp > (was(["walkM", "walkF"]) ? 0.45 : 0.7) && sp < (was(["walkM", "walkF"]) ? 2.8 : 2.4)) {
        // Walking back to the huddle or up to the line. Between walk and run
        // (about 2.4-3.2 yd/s) the procedural jog takes over.
        name = STYLE.walk[styleOf(st)];
      }
    } else if (ang > 2.35) {
      // Backpedal: the slow jog for a drop or a shuffle, the full backward run at pace.
      if (sp > (was(["runB", "jogB"]) ? 0.9 : 1.3)) name = sp > (prev && prev.name === "runB" ? 3.1 : 3.6) ? "runB" : "jogB";
    } else if (sp > (was(["strafe", "strafeR"]) ? 1.0 : 1.5)) {
      // Side to side. Both takes go to his right; mirrored to go left (side > 0).
      name = (sp > 4.2 ? "strafeR" : "strafe") + (P.side > 0 ? "_m" : "");
    }
    // Standing about between plays (whistle blown, nothing in his hands): idle.
    if (!name && !over && st.live === false && sp < 0.35) {
      st.idleT = (st.idleT || 0) + dt;
      return this.idleClip(st, st.idleT);
    }
    if (!name || !C[name]) return null;
    const L = LOCO[name.replace(/_m$/, "")];
    const scale = st.rig.height / 1.95;     // shorter bodies take shorter strides
    st.locoPh = ((st.locoPh || 0) + dt * sp / (L.stride * scale)) % 1;
    st.loco = { name: name };
    return { name: name, t: st.locoPh * C[name].dur, part: part, hips: true, fadeIn: 0.15, fadeOut: 0.2 };
  };

  // ---- the ball between hands ------------------------------------------------------------

  // Where the ball sits for a holder, in world space.
  View.prototype.holdPoint = function (st, mode, out, quat) {
    const rig = st.rig;
    rig.root.updateMatrixWorld(true);
    if (mode === "2") {
      out.setFromMatrixPosition(rig.handL.matrixWorld).add(_v2.setFromMatrixPosition(rig.handR.matrixWorld)).multiplyScalar(0.5);
      _q1.setFromEuler(_e1.set(0.3, st.rig.root.rotation.y, 0));
      quat.copy(_q1);
      out.x += Math.sin(st.rig.root.rotation.y) * 0.05;
      out.z += Math.cos(st.rig.root.rotation.y) * 0.05;
      return out;
    }
    if (mode === "Q") {
      // The QB's cocked ball: lying across the fingers, nose pointing at the target and a little up.
      const y = st.rig.root.rotation.y, p = 0.35;
      _v2.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
      quat.setFromUnitVectors(_zAxis, _v2);
      out.setFromMatrixPosition(rig.handR.matrixWorld).addScaledVector(_v2, 0.1);
      out.y += 0.03;
      return out;
    }
    const hand = mode === "L" ? rig.handL : rig.handR;
    out.setFromMatrixPosition(hand.matrixWorld);
    // Nose along the forearm, pointing forward out of the hand.
    const fa = rig.bones[mode === "L" ? B.faL : B.faR];
    fa.getWorldQuaternion(_q1);
    quat.copy(_q1).multiply(_q2.setFromEuler(_e1.set(-PI / 2 + 0.25, 0, 0)));
    return out;
  };

  View.prototype.updateBall = function (gs, dt, events) {
    const bv = this.bv;
    const b = gs.ball;
    const self = this;
    const ballQuat = _q3;
    const target = _v3;
    let visible = true;
    let inAir = false;
    const find = function (ent) { return ent ? self.rigs[ent.team][ent.char] : null; };

    events.forEach(function (ev) {
      if (ev.type === "snap") {
        const qb = gs.entities.find(function (e) { return e.slot === "QB"; });
        bv.queue = [{ st: find(qb), mode: "2", dur: 0.32, arc: 0.25 }];
        if (gs.carrier && gs.carrier !== qb) bv.queue.push({ st: find(gs.carrier), mode: "R", dur: 0.2, arc: 0.1 });
        bv.toss = null;
      } else if (ev.type === "pitch" || (ev.type === "handoff" && ev.late)) {
        // A pitch is tossed; a draw's late handoff is a short hand-to-hand.
        bv.queue.push({ st: find(ev.to), mode: "R", dur: ev.late ? 0.18 : 0.28, arc: ev.late ? 0.05 : 0.4 });
      } else if (ev.type === "catch" || ev.type === "intercept" || ev.type === "recover") {
        bv.queue = [];
        bv.toss = { from: bv.pos.clone(), st: find(ev.who), mode: ev.type === "catch" ? "2" : "R", t: 0, dur: 0.08, arc: 0 };
      }
    });
    // The flea-flicker's pitch back to the QB is a carrier change with no event.
    if (gs.phase === PH.LIVE && gs.carrier && bv.holder && !bv.toss && !bv.queue.length && find(gs.carrier) !== bv.holder && !b.inFlight) {
      bv.queue.push({ st: find(gs.carrier), mode: "2", dur: 0.3, arc: 0.4 });
    }

    // Decide the ball's live target.
    let mode = "R";
    let holderSt = null;
    if (gs.phase === PH.PRE_SNAP || gs.phase === PH.HUDDLE_BREAK) {
      const ol = gs.entities.find(function (e) { return e.slot === "OL"; });
      holderSt = find(ol);
      if (gs.phase === PH.PRE_SNAP && holderSt) {
        this.holdPoint(holderSt, "R", target, ballQuat);
        target.y = Math.max(0.12, target.y - 0.02);
        target.z -= 0.06;
        ballQuat.setFromEuler(_e1.set(0, 0, PI / 2));
      } else {
        target.set(wx(MID), 0.11, wz(gs.los) - 0.35);
        ballQuat.setFromEuler(_e1.set(0, 0, PI / 2));
      }
      bv.holder = holderSt;
      bv.toss = null;
      bv.queue = [];
    } else if (gs.phase === PH.HUDDLE) {
      target.set(wx(MID), 0.11, wz(gs.los) - 0.35);
      ballQuat.setFromEuler(_e1.set(0, 0, PI / 2));
      bv.holder = null;
    } else if (b.inFlight) {
      const thrower = find(b.thrower);
      const u = clamp(b.t / b.T, 0, 1);
      const dist = Math.hypot(b.tx - b.x0, b.ty - b.y0);
      // Touch passes float, bullets are flat (D.PASS_KIND).
      const K = D.PASS_KIND[b.kind] || D.PASS_KIND.normal;
      const arc = Math.max(K.minArc, dist * K.arc);
      const h0 = 2.05, h1 = 1.35;
      target.set(wx(b.x), 4 * arc * u * (1 - u) + h0 + (h1 - h0) * u, wz(b.y));
      // Nose along the flight path, spinning.
      const vxw = (b.tx - b.x0) / b.T, vzw = -(b.ty - b.y0) / b.T;
      const vy = 4 * arc * (1 - 2 * u) / b.T + (h1 - h0) / b.T;
      _v2.set(vxw, vy, vzw).normalize();
      ballQuat.setFromUnitVectors(_zAxis, _v2);
      bv.spin += dt * 28;
      ballQuat.multiply(_q2.setFromAxisAngle(_zAxis, bv.spin));
      inAir = true;
      if (b.t < RELEASE && thrower) {
        this.holdPoint(thrower, "Q", target, ballQuat);
      } else if (!bv.lastInFlight || bv.releasing) {
        // Hand the ball from the hand to the flight path smoothly.
        if (!bv.releasing) { bv.releasing = { from: bv.pos.clone(), t: 0 }; }
      }
      bv.holder = null;
      bv.queue = [];
      bv.toss = null;
    } else if (gs.loose) {
      target.set(wx(b.x), 0.11 + b.z, wz(b.y));
      ballQuat.setFromEuler(_e1.set(b.tilt || 0, 0, PI / 2 + (b.tilt || 0)));
      bv.holder = null;
      bv.queue = [];
      bv.toss = null;
    } else {
      // Held: by the carrier, the interceptor, or whoever recovered it.
      const who = gs.carrier || gs.interceptor || gs.recoveredBy || null;
      holderSt = find(who);
      if (holderSt) {
        mode = holderSt.hold || "R";
        if (!bv.toss && !bv.queue.length && bv.holder !== holderSt && bv.holder && gs.phase === PH.LIVE) {
          bv.queue.push({ st: holderSt, mode: mode, dur: 0.18, arc: 0.1 });
        }
        this.holdPoint(holderSt, mode, target, ballQuat);
        if (!bv.toss && !bv.queue.length) bv.holder = holderSt;
      } else {
        // Dead on the grass: an incompletion. Let it bounce to a stop.
        if (!bv.dead) bv.dead = { t: 0, from: bv.pos.clone(), vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2 };
        const d = bv.dead;
        d.t += dt;
        const k = Math.exp(-3 * d.t);
        target.set(d.from.x + d.vx * (1 - k) * 0.6, 0.11 + Math.abs(Math.sin(d.t * 8)) * 0.5 * Math.exp(-4 * d.t), d.from.z + d.vz * (1 - k) * 0.6);
        ballQuat.setFromEuler(_e1.set(d.t * 3 * k, 0, PI / 2));
      }
    }
    if (holderSt || b.inFlight) bv.dead = null;

    // Tosses between hands (the snap, handoffs, pitches, catches).
    if (!bv.toss && bv.queue.length && gs.phase === PH.LIVE) {
      const q = bv.queue.shift();
      bv.toss = { from: bv.pos.clone(), st: q.st, mode: q.mode, t: 0, dur: q.dur, arc: q.arc };
    }
    if (bv.toss) {
      const T = bv.toss;
      T.t += dt;
      const u = clamp(T.t / T.dur, 0, 1);
      if (T.st) this.holdPoint(T.st, T.mode, _v4, _q4); else _v4.copy(target);
      target.lerpVectors(T.from, _v4, u);
      target.y += Math.sin(u * PI) * T.arc;
      ballQuat.slerpQuaternions(bv.quat, _q4, Math.min(1, u * 1.5));
      if (u >= 1) { bv.holder = T.st; bv.toss = null; }
    }
    if (bv.releasing) {
      bv.releasing.t += dt;
      const k = clamp(bv.releasing.t / 0.12, 0, 1);
      target.lerpVectors(bv.releasing.from, target, k);
      if (k >= 1 || !b.inFlight) bv.releasing = null;
    }
    bv.lastInFlight = b.inFlight;
    bv.pos.copy(target);
    bv.quat.copy(ballQuat);
    this.ball.position.copy(bv.pos);
    this.ball.quaternion.copy(bv.quat);
    this.ball.visible = visible;
    // Bigger in the air, the way games cheat it, so it can be followed.
    const sc = this.ball.scale.x + ((inAir ? 1.5 : 1) - this.ball.scale.x) * damp(10, dt);
    this.ball.scale.setScalar(sc);
    if (inAir && b.t >= RELEASE) {
      this.trailPts.unshift(bv.pos.clone());
      if (this.trailPts.length > this.trail.length * 2) this.trailPts.length = this.trail.length * 2;
    } else {
      this.trailPts.length = 0;
    }
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trailPts[i * 2 + 1];
      this.trail[i].visible = !!p;
      if (p) this.trail[i].position.copy(p);
    }

    // Its shadow and where it will come down.
    const hgt = bv.pos.y;
    this.ballShadow.visible = inAir || gs.loose;
    this.ballShadow.position.set(bv.pos.x, 0.03, bv.pos.z);
    this.ballShadow.material.opacity = clamp(0.5 - hgt * 0.06, 0.12, 0.5);
    this.ballShadow.scale.setScalar(clamp(0.7 + hgt * 0.1, 0.7, 1.3));
    this.landing.visible = inAir;
    if (inAir) {
      this.landing.position.set(wx(b.tx), 0.04, wz(b.ty));
      this.landing.scale.setScalar(1 + 0.12 * Math.sin(this.t * 10));
    }
    return inAir;
  };

  // ---- camera --------------------------------------------------------------------------

  // pMax: a portrait phone is so narrow that fitting both wide receivers needs
  // the camera much further back; players get small, but nobody falls off.
  const MODES = {
    // 2026-10-24: pulled in, Madden Mobile style (was min 12, max 34, fov 48,
    // pitch 0.4): lower, closer, a wider lens, and in play it frames only the
    // men within `near` yards of the ball instead of 11.
    chase: { yaw: 0, pitch: 0.34, fov: 56, min: 6.5, max: 22, pPitch: 0.52, pFov: 66, pMax: 40, near: 6.5 },
    broadcast: { yaw: PI / 2, pitch: 0.3, fov: 40, min: 16, max: 44, pPitch: 0.5, pFov: 58, pMax: 70 },
    high: { yaw: 0, pitch: 0.95, fov: 44, min: 16, max: 44, pPitch: 1.1, pFov: 60, pMax: 64 }
  };
  View.prototype.cameraModes = function () { return Object.keys(MODES); };
  View.prototype.setCameraMode = function (m) { if (MODES[m]) this.cam.mode = m; };

  View.prototype.updateCamera = function (gs, dt, inAir, reset) {
    const cam = this.cam;
    const M = MODES[cam.mode];
    const portrait = this.camera.aspect < 0.85;
    const self = this;
    const pts = [];
    const b = gs.ball;
    const bp = this.bv.pos;
    let fx, fz;
    let pitch = portrait ? M.pPitch : M.pitch;
    let yaw = M.yaw;
    const fov = portrait ? M.pFov : M.fov;
    let minD = M.min, maxD = portrait ? M.pMax : M.max;
    let k = 3.2;

    const scorer = (gs.phase === PH.TOUCHDOWN) ? (gs.whistleCarrier ? this.rigs[gs.whistleCarrier.team][gs.whistleCarrier.char] : null) : null;
    if (scorer) {
      // Touchdown: swing round the scorer and his teammates.
      cam.orbit += dt * 0.35;
      yaw = M.yaw + PI * 0.85 + Math.sin(cam.orbit) * 0.6;
      pitch = 0.18;
      fx = scorer.pos.x; fz = scorer.pos.z;
      pts.push(_p(scorer.pos.x, 2.2, scorer.pos.z));
      this.states.forEach(function (s) {
        if (s.e && s.e.team === scorer.e.team && s.pos.distanceTo(scorer.pos) < 7) pts.push(_p(s.pos.x, 2, s.pos.z));
      });
      minD = 6; maxD = 16; k = 1.5;
    } else if (gs.phase === PH.PRE_SNAP || gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK) {
      cam.orbit = 0;
      fx = bp.x * 0.5;
      fz = wz(gs.los) - (cam.mode === "broadcast" ? 3 : 5);
      // While the call screen is up the free strip above it is short, so
      // frame only the unit making the call (Madden-style): the huddle on
      // offense, the defenders on defense. Otherwise, everyone.
      const unit = this.callFocus === "off" ? "off" : this.callFocus === "def" ? "def" : null;
      if (unit === "off" && gs.huddleCx !== undefined) { fx = wx(gs.huddleCx); fz = wz(gs.huddleCy); }
      gs.entities.forEach(function (e) {
        if (unit && e.side !== unit) return;
        pts.push(_p(wx(e.x), 0, wz(e.y)), _p(wx(e.x), 2.1, wz(e.y)));
      });
      k = reset ? 100 : 2.5;
    } else {
      cam.orbit = 0;
      // Follow the ball, leaning toward where the play is going.
      let lx = bp.x, lz = bp.z;
      if (gs.carrier) {
        lx += gs.carrier.vx * 0.35;
        lz += -gs.carrier.vy * 0.35;
      }
      if (inAir) {
        lx = (bp.x + wx(b.tx)) / 2;
        lz = (bp.z + wz(b.ty)) / 2;
        pts.push(_p(wx(b.tx), 0, wz(b.ty)), _p(wx(b.tx), 2, wz(b.ty)));
        k = 4.5;
      }
      fx = lx; fz = lz;
      pts.push(_p(bp.x, 0, bp.z), _p(bp.x, 2.2, bp.z));
      const near = M.near || 11;
      gs.entities.forEach(function (e) {
        const st = self.rigs[e.team][e.char];
        const d = Math.hypot(st.pos.x - bp.x, st.pos.z - bp.z);
        if (d < near) pts.push(_p(st.pos.x, 0, st.pos.z), _p(st.pos.x, 2, st.pos.z));
      });
    }

    // Room at the bottom for the call screen: render the top of a taller virtual
    // frame so the optical centre sits in the middle of the free area. The
    // Madden-style call screen is over half the height on a laptop, and the
    // huddle it is calling for must stay visible above it.
    this.insetS = (this.insetS || 0) + ((this.insetBottom || 0) - (this.insetS || 0)) * damp(8, dt);
    const inset = Math.min(this.insetS, this.h * 0.68);
    const fullH = this.h + inset;
    this.camera.aspect = this.w / fullH;
    if (inset > 1) this.camera.setViewOffset(this.w, fullH, 0, inset, this.w, this.h);
    else this.camera.clearViewOffset();

    // Fit: the distance at which every point is inside the frame.
    const dir = _v1.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = _v2.crossVectors(dir, _up).normalize();
    const upc = _v3.crossVectors(right, dir).normalize();
    const tanFull = Math.tan(fov * PI / 360);
    const tanV = tanFull * (this.h - inset) / fullH;
    const tanH = tanFull * this.w / fullH;
    const focus = _v4.set(fx, 0.9, fz);
    // Centre the frame on the points' spread, pulled toward the ball.
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    pts.forEach(function (p) {
      const r = (p.x - focus.x) * right.x + (p.y - focus.y) * right.y + (p.z - focus.z) * right.z;
      const u = (p.x - focus.x) * upc.x + (p.y - focus.y) * upc.y + (p.z - focus.z) * upc.z;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
    });
    if (pts.length) {
      const cr = (minR + maxR) / 2 * 0.7;
      const cu = (minU + maxU) / 2 * 0.5;
      focus.addScaledVector(right, cr).addScaledVector(upc, cu);
    }
    let need = minD;
    const m = 0.86;
    pts.forEach(function (p) {
      const rx = p.x - focus.x, ry = p.y - focus.y, rz = p.z - focus.z;
      const x = rx * right.x + ry * right.y + rz * right.z;
      const y = rx * upc.x + ry * upc.y + rz * upc.z;
      const z = rx * dir.x + ry * dir.y + rz * dir.z;
      need = Math.max(need, Math.abs(x) / (tanH * m) - z, Math.abs(y) / (tanV * m) - z);
    });
    need = clamp(need, minD, maxD);

    if (!cam.init || reset) {
      cam.focus.copy(focus);
      cam.dist = need;
      cam.yaw = yaw;
      cam.pitch = pitch;
      cam.fov = fov;
      cam.init = true;
    } else {
      cam.focus.lerp(focus, damp(k, dt));
      cam.dist += (need - cam.dist) * damp(k * 0.7, dt);
      cam.yaw += angDiff(yaw, cam.yaw) * damp(2.5, dt);
      cam.pitch += (pitch - cam.pitch) * damp(2.5, dt);
      cam.fov += (fov - cam.fov) * damp(3, dt);
    }
    const cdir = _v1.set(-Math.sin(cam.yaw) * Math.cos(cam.pitch), -Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));
    this.camera.position.copy(cam.focus).addScaledVector(cdir, -cam.dist);
    if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;
    if (cam.shake > 0) {
      cam.shake = Math.max(0, cam.shake - dt);
      const s = cam.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    // The cameo (a big play) and the replay's PLAYER camera: a low, slow orbit
    // round one man, from a three-quarter front, blended in and out of the
    // normal camera by cine.w so nothing cuts.
    let look = cam.focus;
    let fovNow = cam.fov;
    const cine = this.cine;
    if (cine && cine.st && cine.w > 0) {
      const p = cine.st.pos;
      if (cine.yaw === undefined) cine.yaw = cine.st.heading + 0.75 * (cine.side || 1);
      cine.yaw += (cine.spinRate || 0.35) * (cine.rdt || dt) * (cine.side || 1);
      const target = _v5.set(p.x, 1.1, p.z);
      // A little above head height, so the bodies round him don't block the shot.
      const cp = _v6.set(p.x + Math.sin(cine.yaw) * cine.dist, 1.6 + cine.dist * 0.12, p.z + Math.cos(cine.yaw) * cine.dist);
      const w = cine.w * cine.w * (3 - 2 * cine.w);
      this.camera.position.lerp(cp, w);
      look = _v7.copy(cam.focus).lerp(target, w);
      fovNow = cam.fov + ((cine.fov || 36) - cam.fov) * w;
    }
    this.camera.fov = fovNow;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(look);
  };

  // A big play: slow-mo and the cinema camera on `ent` for `dur` real seconds.
  View.prototype.cameo = function (ent, kind, dur) {
    if (!ent) return;
    this.cine = { st: this.rigs[ent.team][ent.char], kind: kind, t: 0, dur: dur || 1.9, w: 0, dist: 4.6, side: Math.random() < 0.5 ? -1 : 1 };
  };
  // The replay's PLAYER camera: the same orbit, held until cleared.
  View.prototype.follow = function (ent) {
    this.cine = ent ? { st: this.rigs[ent.team][ent.char], kind: "follow", t: 0, dur: Infinity, w: 0, dist: 5.2, fov: 40, spinRate: 0.12, side: 1 } : null;
  };
  // How fast the game runs right now: slow-mo through the middle of a cameo.
  View.prototype.timeScale = function () {
    const c = this.cine;
    if (!c || c.dur === Infinity) return 1;
    const u = c.t / c.dur;
    const slow = 0.28;
    if (u < 0.12) return 1 + (slow - 1) * (u / 0.12);
    if (u > 0.82) return slow + (1 - slow) * Math.min(1, (u - 0.82) / 0.18);
    return slow;
  };
  View.prototype.stepCine = function (rdt) {
    const c = this.cine;
    if (!c) return;
    c.rdt = rdt;
    c.t += rdt;
    if (c.dur === Infinity) { c.w = Math.min(1, c.w + rdt / 0.4); return; }
    c.w = Math.min(1, c.t / 0.28, Math.max(0, (c.dur - c.t) / 0.4));
    if (c.t >= c.dur) this.cine = null;
  };

  // The camera's ground-plane axes, for camera-relative movement input.
  View.prototype.inputBasis = function () {
    const y = this.cam.yaw;
    // Screen-right and screen-up, projected onto the field, in SIM axes
    // (x across, y downfield). World X = sim x; world Z = -sim y.
    return { rx: Math.cos(y), ry: Math.sin(y), ux: -Math.sin(y), uy: Math.cos(y) };
  };

  // ---- one frame ----------------------------------------------------------------------------

  // rdt: real seconds this frame (dt is slowed during a cameo or a replay).
  View.prototype.render = function (gs, dt, humanTeam, rdt) {
    this.t += dt;
    this.stepCine(rdt === undefined ? dt : rdt);
    const events = gs.events ? gs.events.splice(0) : [];
    const reset = this.lastEntities !== gs.entities;
    this.lastEntities = gs.entities;
    const self = this;

    // Whistle: everyone not in the tackle runs on and pulls up.
    events.forEach(function (ev) {
      if (ev.type === "whistle") {
        gs.entities.forEach(function (e) {
          const st = self.rigs[e.team][e.char];
          if (e === ev.tackled || e === ev.tackler || e.lockT > 0.2 && e.action !== "block") { st.coast = null; return; }
          st.coast = { vx: e.lastVx || 0, vz: -(e.lastVy || 0), t: 0 };
        });
        if (ev.tackled) {
          const p = self.rigs[ev.tackled.team][ev.tackled.char].pos;
          self.particles.burst(p.x, 0.1, p.z, 18, ["#6b5a3e", "#7d7742", "#5f6d33", "#8a7550"], 2.2, 2.4, 0.9);
          self.cam.shake = 0.3;
        }
      } else if (ev.type === "spin" && ev.who) {
        self.rigs[ev.who.team][ev.who.char].spin = { t: 0, dir: ev.side >= 0 ? -1 : 1 };
      } else if ((ev.type === "hurdle" || ev.type === "corkscrew") && ev.who) {
        const st = self.rigs[ev.who.team][ev.who.char];
        st.leap = { t: 0, kind: ev.type };
        st.juke = null;
        self.particles.burst(st.pos.x, 0.05, st.pos.z, 10, ["#5f6d33", "#7d7742", "#4b6230"], 2, 2, 0.6);
      } else if (ev.type === "juke" && ev.who) {
        const st = self.rigs[ev.who.team][ev.who.char];
        st.juke = { t: 0, dir: ev.side };
        self.particles.burst(st.pos.x, 0.05, st.pos.z, 8, ["#5f6d33", "#7d7742", "#4b6230"], 2.5, 1.5, 0.6);
      } else if (ev.type === "broken" && ev.tackler) {
        const p = self.rigs[ev.tackler.team][ev.tackler.char].pos;
        self.particles.burst(p.x, 0.1, p.z, 12, ["#6b5a3e", "#5f6d33", "#8a7550"], 2, 2, 0.8);
      } else if (ev.type === "touchdown") {
        const team = D.TEAMS[ev.team];
        const c = self.bv.pos;
        self.particles.burst(c.x, 1.5, c.z, 160, [team.primary, team.accent, "#ffffff", "#f2c233"], 5, 7, 3.2, 3.5);
        self.cheer(4);
      } else if (ev.type === "incomplete") {
        self.particles.burst(self.bv.pos.x, 0.05, self.bv.pos.z, 8, ["#6b5a3e", "#7d7742"], 1.2, 1.2, 0.6);
      } else if (ev.type === "fumble") {
        self.cam.shake = 0.3;
      }
    });

    this.updatePlayers(gs, dt, reset);
    const inAir = this.updateBall(gs, dt, events);

    // Rings: who the human is steering.
    const human = humanTeam;
    let ctl = null;
    if (human >= 0 && gs.offense !== human && gs.controlSlot && gs.phase === PH.LIVE) {
      ctl = gs.entities.find(function (e) { return e.side === "def" && e.slot === gs.controlSlot; });
    }
    if (human >= 0 && gs.loose && gs.looseControlId !== null) {
      ctl = gs.entities.find(function (e) { return e.id === gs.looseControlId; }) || ctl;
    }
    this.ctlRing.visible = !!ctl;
    if (ctl) {
      const p = this.rigs[ctl.team][ctl.char].pos;
      this.ctlRing.position.set(p.x, 0.035, p.z);
      this.ctlRing.scale.setScalar(1 + 0.08 * Math.sin(this.t * 8));
    }
    const hc = human >= 0 && gs.offense === human && gs.carrier && (gs.phase === PH.LIVE || gs.phase === PH.PRE_SNAP) ? gs.carrier : null;
    this.carrierRing.visible = !!hc && gs.phase === PH.LIVE;
    if (hc) {
      const p = this.rigs[hc.team][hc.char].pos;
      this.carrierRing.position.set(p.x, 0.035, p.z);
    }

    if (this.endZonesFor !== gs.offense) {
      this.world.setEndZones(gs.offense);
      this.endZonesFor = gs.offense;
    }
    const showLines = gs.phase === PH.PRE_SNAP || gs.phase === PH.LIVE || gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK || gs.phase === PH.DEAD_BALL;
    this.world.setLines(wz(gs.los), wz(Math.min(100, gs.firstDownMark)), showLines, gs.firstDownMark >= 100);

    this.particles.update(dt);
    this.updateSpectators(dt);
    this.updateCamera(gs, dt, inAir, reset);
    this.world.update(this.t, dt, this.cam.focus);
    if (this.dbgFollow) {   // test hook: a close camera on one player
      const f = this.dbgFollow, p = f.st.pos;
      this.camera.position.set(p.x + f.off[0], p.y + f.off[1], p.z + f.off[2]);
      this.camera.fov = f.fov || 35; this.camera.updateProjectionMatrix();
      this.camera.lookAt(p.x, p.y + (f.lookY || 1), p.z);
    }
    if (!this.noDraw) this.renderer.render(this.scene, this.camera);
    return events;
  };

  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
  const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3();
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
  const _e1 = new THREE.Euler();
  const _up = new THREE.Vector3(0, 1, 0);
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _pool = [];
  let _pi = 0;
  function _p(x, y, z) {
    if (_pi >= _pool.length) _pool.push(new THREE.Vector3());
    const v = _pool[_pi];
    _pi = (_pi + 1) % 400;
    return v.set(x, y, z);
  }

  window.TBView = { View: View, wx: wx, wz: wz };
})();
