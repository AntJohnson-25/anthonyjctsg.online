// The crime lab: the room, the regional desks that rise out of the floor, the analyst's laptop workstation and the
// crew who work in it. Everything here is decoration + choreography; the data drawing stays in plaza.js.
//
// Cast (player = lead data analyst, one of Wealth Runner's four runners; the crew is House Edge's four):
//   analyst  seated at the laptop: Sit To Type -> Typing while a query runs -> Type To Sit when the answer lands
//   Ray      evidence tech at the filing cabinets: Searching Files High while you work, Opening A Filing Cabinet on a
//            right answer, Looking Through Files Low on a wrong one
//   Iris     forensics at her own desk, typing all day
//   Marcus   the boss, Texting While Standing: your case requests (and your clue) come from his phone
//   Dee      lead investigator beside the evidence table: cheers or shakes her head
import * as THREE from "three";
import { Actor, loadBody, loadClips, attach } from "./people.js";
import { makeLabel, disposeLabel } from "./parts.js";

// The four bodies have no names: the player picks one and types their own name (main.js, saved "sqlquest.name").
export const HEROES = [
  { id: "runner_m_dark", label: "Analyst 1", sex: "m", tag: "Lead Data Analyst" },
  { id: "runner_f_dark", label: "Analyst 2", sex: "f", tag: "Lead Data Analyst" },
  { id: "runner_m_light", label: "Analyst 3", sex: "m", tag: "Lead Data Analyst" },
  { id: "runner_f_light", label: "Analyst 4", sex: "f", tag: "Lead Data Analyst" }
];

// Where everyone stands. Facing: yaw 0 looks down +z; yaw = atan2(dx, dz) toward a point.
const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const SPOTS = {
  analyst: { x: -8.6, z: 2.4, yaw: Math.PI / 2 },
  iris: { x: 8.6, z: 2.4, yaw: -Math.PI / 2 },
  ray: { x: -11.4, z: 5.4, yaw: -Math.PI / 2 },
  marcus: { x: 11.8, z: 5.6, yaw: toward(11.8, 5.6, 2, 0) },
  dee: { x: 3.9, z: 3.9, yaw: toward(3.9, 3.9, 0, 0) }
};
const BG_DESKS = [[-19, 13], [-15, 13], [-19, 18], [-15, 18], [15, 13], [19, 13], [15, 18], [19, 18]];   // chair spots, people face -z
const SEAT_Y = 0.47;      // chair seat height under the seated clips' hips
export const START = { x: 0, z: 15, yaw: Math.PI };   // where the analyst walks in
// one metre behind the chair, facing the desk: where you stand before sitting and after standing up
export const APPROACH = { x: SPOTS.analyst.x - 1.0, z: SPOTS.analyst.z, yaw: SPOTS.analyst.yaw };

const blobGeo = new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
function blob() { const m = new THREE.Mesh(blobGeo, blobMat); m.position.y = 0.02; m.renderOrder = 1; return m; }

// ---------------------------------------------------------------- textures

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function skylineTexture() {
  const r = rng(77);
  return canvasTex(2048, 420, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#08102a"); grd.addColorStop(0.65, "#1b2f60"); grd.addColorStop(1, "#40568f");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.fillStyle = "rgba(255,255,255," + (0.2 + r() * 0.6) + ")"; g.fillRect(r() * w, r() * h * 0.5, 2, 2); }
    for (let layer = 0; layer < 2; layer++) {
      let x = -20;
      while (x < w) {
        const bw = 40 + r() * 90, bh = (layer ? 70 : 120) + r() * (layer ? 160 : 270);
        g.fillStyle = layer ? "#0d1736" : "#060b1d";
        g.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 10; wy < h - 8; wy += 16) for (let wx = x + 6; wx < x + bw - 8; wx += 14) {
          if (r() < (layer ? 0.18 : 0.38)) { g.fillStyle = r() < 0.8 ? "#ffd98a" : "#8fd8ff"; g.fillRect(wx, wy, 6, 8); }
        }
        x += bw + r() * 10;
      }
    }
  });
}
function codeTexture() {
  const r = rng(5);
  return canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const cols = ["#2dff6a", "#1fb34d", "#7dff9c", "#17863a"];
    for (let y = 12, i = 0; y < h - 6; y += 13, i++) {
      let x = 10 + (i % 3 === 1 ? 14 : 0);
      for (let k = 0; k < 4; k++) {
        const len = 18 + r() * 40;
        g.fillStyle = cols[(i + k) % cols.length]; g.globalAlpha = 0.85;
        g.fillRect(x, y, len, 5);
        x += len + 6;
      }
    }
    g.globalAlpha = 1;
  });
}
function cabinetTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = "#56616f"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y = 12 + i * 124;
      g.fillStyle = "#6f7b8a"; g.fillRect(14, y, w - 28, 110);
      g.strokeStyle = "#2c333c"; g.lineWidth = 4; g.strokeRect(14, y, w - 28, 110);
      g.fillStyle = "#1a1f26"; g.fillRect(w / 2 - 34, y + 18, 68, 12);
      g.fillStyle = "#d9e2ee"; g.fillRect(w / 2 - 30, y + 56, 60, 30);
      g.fillStyle = "#39424d"; g.fillRect(w / 2 - 22, y + 64, 44, 4); g.fillRect(w / 2 - 22, y + 74, 30, 4);
    }
  });
}
function signTexture(text, sub) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = "#07101f"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#3ad8ff"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#eaf6ff"; g.font = "700 96px 'Segoe UI', system-ui, sans-serif"; g.textAlign = "center";
    g.fillText(text, w / 2 + 70, 128);
    g.fillStyle = "#3ad8ff"; g.font = "500 44px 'Cascadia Mono', Consolas, monospace";
    g.fillText(sub, w / 2 + 70, 196);
  });
}

// ---------------------------------------------------------------- the room

const M = {
  wall: new THREE.MeshStandardMaterial({ color: 0x8795ab, roughness: 0.9, metalness: 0.02 }),
  trim: new THREE.MeshBasicMaterial({ color: 0x2fb6ff }),
  desk: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.55, metalness: 0.05 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.5, metalness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.6, metalness: 0.3 }),
  chair: new THREE.MeshStandardMaterial({ color: 0x20324d, roughness: 0.8 })
};

export function buildRoom(scene) {
  const g = new THREE.Group();
  const W = 26, D = 26, H = 11;
  // back wall + the skyline window
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), M.wall);
  back.position.set(0, H / 2, -D);
  g.add(back);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(40, 7.2), new THREE.MeshBasicMaterial({ map: skylineTexture() }));
  win.position.set(0, 5.6, -D + 0.05);
  g.add(win);
  for (let i = -3; i <= 3; i++) {   // window mullions
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 7.4, 0.2), M.frame);
    m.position.set(i * 6.67, 5.6, -D + 0.12);
    g.add(m);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(41, 0.2, 0.6), M.frame);
  sill.position.set(0, 1.95, -D + 0.3);
  g.add(sill);
  // side walls
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(D * 2, H), M.wall);
    w.position.set(s * W, H / 2, 0);
    w.rotation.y = -s * Math.PI / 2;
    g.add(w);
  }
  // glowing skirting along the walls
  const strip = (len, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), M.trim);
    m.position.set(x, 0.12, z); m.rotation.y = ry;
    g.add(m);
  };
  strip(W * 2, 0, -D + 0.1, 0); strip(D * 2, -W + 0.1, 0, Math.PI / 2); strip(D * 2, W - 0.1, 0, Math.PI / 2);
  // the lab sign (with the CTSG seal beside it)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: signTexture("CRIME LAB", "DATA UNIT  ·  CASE FILES") }));
  sign.position.set(0, 9.2, -D + 0.08);
  g.add(sign);
  const seal = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  seal.position.set(-5.6, 9.2, -D + 0.1);
  new THREE.TextureLoader().load("assets/ctsg-seal.png", (t) => { t.colorSpace = THREE.SRGBColorSpace; seal.material.map = t; seal.material.needsUpdate = true; });
  g.add(seal);
  // ceiling light bars (decor, no real lights)
  const bar = new THREE.MeshBasicMaterial({ color: 0xcfe6ff });
  for (let i = -2; i <= 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 18), bar);
    b.position.set(i * 9, H - 0.2, -2);
    g.add(b);
  }
  // front wall with the lab door, so the room is closed when you walk
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), M.wall);
  front.position.set(0, H / 2, D);
  front.rotation.y = Math.PI;
  g.add(front);
  const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, 0.12), M.dark);
  door.position.set(0, 2.2, D - 0.06);
  const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(3.7, 4.6, 0.08), M.trim);
  doorGlow.position.set(0, 2.3, D - 0.03);
  g.add(doorGlow, door);
  strip(W * 2, 0, D - 0.1, 0);

  // ceiling (only while walking; the data views fly high above the room)
  const ceil = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xaab4c4 }));
  roof.position.y = H;
  ceil.add(roof);
  const panel = new THREE.MeshBasicMaterial({ color: 0xeaf4ff });
  const panelGeo = new THREE.BoxGeometry(3.6, 0.05, 1.3);
  for (let ix = -3; ix <= 3; ix++) for (let iz = -3; iz <= 3; iz++) {
    const p = new THREE.Mesh(panelGeo, panel);
    p.position.set(ix * 7, H - 0.03, iz * 7);
    ceil.add(p);
  }
  g.add(ceil);
  g.userData.ceiling = ceil;
  g.userData.colliders = dress(g, W, D);
  scene.add(g);
  return g;
}

function caseBoardTexture() {
  const r = rng(31);
  return canvasTex(1024, 448, (g, w, h) => {
    g.fillStyle = "#0f1626"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#6a5238"; g.fillRect(14, 14, w - 28, h - 28);
    g.strokeStyle = "#cdd6e4"; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const x = 60 + r() * (w - 190), y = 50 + r() * (h - 170), photo = r() < 0.55;
      pts.push([x + 40, y + 10]);
      g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 0.18);
      g.fillStyle = photo ? "#e8e8e0" : (r() < 0.5 ? "#f6e58d" : "#ffffff");
      g.fillRect(0, 0, photo ? 84 : 100, photo ? 100 : 78);
      if (photo) { g.fillStyle = "#59616e"; g.fillRect(8, 8, 68, 66); g.fillStyle = "#2d333d"; g.beginPath(); g.arc(42, 34, 14, 0, 7); g.fill(); g.fillRect(24, 50, 36, 24); }
      else { g.fillStyle = "#586172"; for (let k = 0; k < 5; k++) g.fillRect(8, 10 + k * 13, 60 + r() * 24, 4); }
      g.fillStyle = "#d83a4a"; g.beginPath(); g.arc(40, 8, 6, 0, 7); g.fill();
      g.restore();
    }
    g.strokeStyle = "rgba(216,58,74,0.85)"; g.lineWidth = 2.5;
    g.beginPath();
    pts.forEach((p, i) => { if (i % 3 === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); });
    g.stroke();
  });
}

function plant(s = 1) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.2 * s, 0.5 * s, 12), new THREE.MeshStandardMaterial({ color: 0x2f3b4d, roughness: 0.7 }));
  pot.position.y = 0.25 * s;
  g.add(pot);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f9d5a, roughness: 0.8 });
  const leaf2 = new THREE.MeshStandardMaterial({ color: 0x45b86c, roughness: 0.8 });
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, (1.0 + (i % 3) * 0.25) * s, 6), i % 2 ? leaf : leaf2);
    c.position.set(Math.sin(a) * 0.14 * s, 0.9 * s, Math.cos(a) * 0.14 * s);
    c.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
    g.add(c);
  }
  return g;
}

// Everything that makes the room feel lived in. Returns the colliders for walking.
function dress(g, W, D) {
  const cols = [];
  const circ = (x, z, r) => cols.push({ x, z, r });
  const box = (x, z, hw, hd, yaw) => cols.push({ x, z, hw, hd, yaw });
  // the case wall
  const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.4), new THREE.MeshBasicMaterial({ map: caseBoardTexture() }));
  board.position.set(-W + 0.06, 4.3, -2);
  board.rotation.y = Math.PI / 2;
  g.add(board);
  // plants
  const pl = [[-24.5, -24.5, 1.5], [24.5, -24.5, 1.5], [-24.5, 24.5, 1.5], [24.5, 24.5, 1.5], [-5, 24.4, 1.2], [5, 24.4, 1.2], [24.5, -5, 1.2], [-24.5, 12, 1.2], [14, -24.5, 1.3], [-14, -24.5, 1.3]];
  for (const [x, z, s] of pl) { const p = plant(s); p.position.set(x, 0, z); g.add(p); circ(x, z, 0.35 * s); }
  // water cooler
  const cooler = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.95, 0.42), new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.5 }));
  body.position.y = 0.475;
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0x6fc2ff, transparent: true, opacity: 0.65, roughness: 0.2 }));
  bottle.position.y = 1.2;
  cooler.add(body, bottle);
  cooler.position.set(24.5, 0, 11);
  g.add(cooler);
  circ(24.5, 11, 0.45);
  // background desks (each one is staffed: Crew.loadStaff seats a lab worker at it)
  for (const [x, z] of BG_DESKS) {
    const w = workstation(false);
    w.position.set(x, 0, z);
    w.rotation.y = Math.PI;
    g.add(w);
    box(x, z - 0.62, 0.9, 0.46, Math.PI);
    circ(x, z, 0.3);
  }

  // ---- more of the lab: a conference room corner, a lounge, a coffee bar, server racks, evidence lockers, wall screens
  const mat = (c, r = 0.7, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const bx = (w, h, d, m, x, y, z, ry = 0) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); k.position.set(x, y, z); k.rotation.y = ry; g.add(k); return k; };
  const wood = mat(0x7a5c3e, 0.5, 0.05), fabric = mat(0x24344f, 0.9, 0), couchM = mat(0x3b4a63, 0.9, 0), steel = mat(0x56616f, 0.5, 0.5), blackM = mat(0x12161d, 0.6, 0.3);
  // conference table with six chairs and a rug
  bx(6.6, 0.02, 3.6, mat(0x1c2a3d, 1, 0), -16, 0.011, -12);
  bx(4.4, 0.07, 1.7, wood, -16, 0.76, -12);
  for (const sx of [-1.9, 1.9]) for (const sz of [-0.6, 0.6]) bx(0.07, 0.74, 0.07, steel, -16 + sx, 0.37, -12 + sz);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const cx = -16 + (i - 1) * 1.35, cz = -12 + s * 1.2;
    bx(0.5, 0.07, 0.5, fabric, cx, 0.48, cz);
    bx(0.5, 0.55, 0.06, fabric, cx, 0.78, cz + s * 0.26);
    bx(0.06, 0.45, 0.06, steel, cx, 0.24, cz);
  }
  box(-16, -12, 2.4, 0.95, 0);
  // lounge: two couches facing each other over a coffee table
  bx(5.2, 0.02, 4.2, mat(0x2b1f33, 1, 0), 19.5, 0.011, -15);
  for (const [cz, ry] of [[-18.4, 0], [-11.6, Math.PI]]) {
    const cg = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 0.9), couchM); seat.position.y = 0.23;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 0.2), couchM); back.position.set(0, 0.62, -0.38);
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.9), couchM); a1.position.set(-1.0, 0.5, 0);
    const a2 = a1.clone(); a2.position.x = 1.0;
    cg.add(seat, back, a1, a2);
    cg.position.set(19.5, 0, cz); cg.rotation.y = ry; g.add(cg);
    box(19.5, cz, 1.1, 0.5, 0);
  }
  bx(1.3, 0.04, 0.7, wood, 19.5, 0.42, -15);
  bx(0.06, 0.4, 0.06, steel, 19.0, 0.2, -15.2); bx(0.06, 0.4, 0.06, steel, 20.0, 0.2, -14.8);
  box(19.5, -15, 0.7, 0.4, 0);
  // coffee bar along the right wall
  bx(0.7, 0.95, 4.2, mat(0x2f3946, 0.6, 0.3), 24.4, 0.475, -3);
  bx(0.8, 0.05, 4.3, mat(0xb9c3cf, 0.3, 0.5), 24.4, 0.97, -3);
  bx(0.4, 0.42, 0.45, blackM, 24.45, 1.2, -2.2); bx(0.4, 0.5, 0.45, blackM, 24.45, 1.24, -3.6);
  box(24.4, -3, 0.45, 2.15, 0);
  // server racks with blinking-looking LEDs (static bars) along the back wall
  const led = new THREE.MeshBasicMaterial({ color: 0x2dff6a });
  for (let i = 0; i < 4; i++) {
    const rx = 8 + i * 1.25;
    bx(1.0, 2.4, 1.0, blackM, rx, 1.2, -25.3);
    for (let k = 0; k < 9; k++) bx(0.6, 0.03, 0.02, led, rx + (k % 2 ? 0.1 : -0.1), 0.3 + k * 0.24, -24.78);
  }
  box(10.8, -25.3, 2.6, 0.55, 0);
  // evidence lockers along the left wall
  for (let i = 0; i < 6; i++) {
    bx(0.5, 2.0, 0.55, steel, -25.3, 1.0, -22 + i * 0.58);
    bx(0.04, 0.2, 0.04, blackM, -25.02, 1.0, -22 + i * 0.58 + 0.15);
  }
  box(-25.3, -20.3, 0.3, 1.8, 0);
  // wall screens: a world map in green, like the hologram
  const mapTex = worldScreenTexture();
  for (const [x, z, ry] of [[25.9, -15, -Math.PI / 2], [-25.9, -12, Math.PI / 2]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.9), new THREE.MeshBasicMaterial({ map: mapTex }));
    s.position.set(x, 3.6, z); s.rotation.y = ry; g.add(s);
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.1), new THREE.MeshBasicMaterial({ color: 0x2dff6a }));
    fr.position.set(x + (x > 0 ? 0.01 : -0.01), 3.6, z); fr.rotation.y = ry; g.add(fr);
  }
  // the big round meeting table: rug, pedestal, wood top, six chairs facing in, mugs and papers (the colleagues are Crew.loadStaff's)
  const cyl = (rt, rb, h, m, x, y, z) => { const k = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 40), m); k.position.set(x, y, z); g.add(k); return k; };
  cyl(3.4, 3.4, 0.02, mat(0x1c2a3d, 1, 0), TABLE.x, 0.011, TABLE.z);
  cyl(0.7, 0.8, 0.05, steel, TABLE.x, 0.05, TABLE.z);
  cyl(0.16, 0.16, 0.7, steel, TABLE.x, 0.4, TABLE.z);
  cyl(TABLE.r, TABLE.r, 0.07, wood, TABLE.x, 0.76, TABLE.z);
  cyl(TABLE.r + 0.02, TABLE.r + 0.02, 0.02, mat(0x2a1f14, 0.6, 0.1), TABLE.x, 0.73, TABLE.z);
  circ(TABLE.x, TABLE.z, TABLE.r + 0.1);
  const paper = mat(0xf2f0e6, 0.9, 0), mug = mat(0xdfe6ee, 0.5, 0.1);
  for (let i = 0; i < 6; i++) {
    const s = seatAt(i), dx = TABLE.x - s.x, dz = TABLE.z - s.z, d = Math.hypot(dx, dz);
    const c = chair();
    c.position.set(s.x, 0, s.z); c.rotation.y = s.yaw; g.add(c);
    circ(s.x, s.z, 0.3);
    // papers in front of the seat, a mug off to one side
    const px = s.x + dx / d * 0.85, pz = s.z + dz / d * 0.85;
    bx(0.3, 0.012, 0.22, paper, px, 0.8, pz, s.yaw);
    cyl(0.045, 0.04, 0.09, mug, px + Math.cos(s.yaw) * 0.32, 0.845, pz - Math.sin(s.yaw) * 0.32);
  }
  cyl(0.16, 0.12, 0.28, mat(0x2f9d5a, 0.8, 0), TABLE.x, 0.94, TABLE.z);   // a plant in the middle
  // the fax machine on a little table against the left wall (the clip "Using A Fax Machine" is played in front of it)
  bx(0.9, 0.04, 1.1, wood, FAX.x, 0.9, FAX.z);
  for (const [sx, sz] of [[-0.4, -0.5], [0.4, -0.5], [-0.4, 0.5], [0.4, 0.5]]) bx(0.05, 0.88, 0.05, steel, FAX.x + sx, 0.44, FAX.z + sz);
  bx(0.5, 0.18, 0.55, mat(0xcfd6de, 0.5, 0.2), FAX.x, 1.01, FAX.z);
  bx(0.3, 0.04, 0.34, mat(0x2b3138, 0.5, 0.3), FAX.x - 0.02, 1.12, FAX.z);
  bx(0.22, 0.012, 0.3, paper, FAX.x + 0.28, 0.935, FAX.z + 0.02);
  box(FAX.x, FAX.z, 0.5, 0.58, 0);
  return cols;
}

function worldScreenTexture() {
  const r = rng(9);
  return canvasTex(1024, 550, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(45,255,106,0.18)"; g.lineWidth = 1;
    for (let x = 0; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const blobs = [[220, 190, 120], [300, 360, 70], [520, 170, 90], [560, 330, 100], [760, 200, 140], [840, 400, 50]];
    g.fillStyle = "rgba(45,255,106,0.55)";
    for (const [bx0, by0, br] of blobs) for (let i = 0; i < 420; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * br;
      g.fillRect(bx0 + Math.cos(a) * d * 1.3, by0 + Math.sin(a) * d * 0.8, 3, 3);
    }
    g.fillStyle = "#ff3048";
    for (let i = 0; i < 7; i++) { const b = blobs[Math.floor(r() * blobs.length)]; g.beginPath(); g.arc(b[0] + (r() - 0.5) * b[2], b[1] + (r() - 0.5) * b[2] * 0.7, 6, 0, 7); g.fill(); }
    g.fillStyle = "#2dff6a"; g.font = "700 26px monospace"; g.fillText("GLOBAL WATCH  //  7 COUNTRIES  //  5 PORTS", 24, 40);
  });
}

// ---------------------------------------------------------------- furniture

const deskGeo = {
  top: new THREE.BoxGeometry(1.7, 0.06, 0.85),
  leg: new THREE.BoxGeometry(0.06, 1, 0.06),
  panel: new THREE.BoxGeometry(1.5, 0.5, 0.03),
  monitor: new THREE.BoxGeometry(0.7, 0.42, 0.04),
  stand: new THREE.BoxGeometry(0.06, 0.18, 0.06)
};
const screenMat = new THREE.MeshBasicMaterial({ map: null, color: 0xffffff });

// A regional desk: a fixed frame with a top that rises like a sit-stand desk. group.userData.top is the part that moves.
export function makeRegionDesk() {
  const g = new THREE.Group();
  const top = new THREE.Group();
  const slab = new THREE.Mesh(deskGeo.top, M.desk);
  slab.position.y = 0.78;
  const mon = new THREE.Mesh(deskGeo.monitor, M.dark);
  mon.position.set(0, 1.12, -0.18);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), new THREE.MeshBasicMaterial({ map: codeTexture() }));
  scr.position.set(0, 1.12, -0.158);
  scr.rotation.y = Math.PI;
  const stand = new THREE.Mesh(deskGeo.stand, M.frame);
  stand.position.set(0, 0.9, -0.18);
  top.add(slab, mon, scr, stand);
  g.add(top);
  for (const sx of [-0.78, 0.78]) {
    const leg = new THREE.Mesh(deskGeo.leg, M.frame);
    leg.scale.y = 0.78;
    leg.position.set(sx, 0.39, 0);
    g.add(leg);
  }
  const panel = new THREE.Mesh(deskGeo.panel, M.frame);
  panel.position.set(0, 0.5, -0.38);
  g.add(panel);
  g.userData.top = top;
  return g;
}

function chair() {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.48), M.chair);
  seat.position.y = SEAT_Y - 0.04;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.06), M.chair);
  back.position.set(0, SEAT_Y + 0.3, -0.26);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, SEAT_Y - 0.1, 8), M.frame);
  post.position.y = (SEAT_Y - 0.1) / 2 + 0.06;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), M.frame);
  base.position.y = 0.04;
  g.add(seat, back, post, base);
  return g;
}

// A workstation seen from the person's seat: +z is straight ahead. Returns a group placed by the caller.
function workstation(laptop) {
  const g = new THREE.Group();
  g.add(chair());
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.85), M.desk);
  top.position.set(0, 0.74, 0.78);
  g.add(top);
  for (const sx of [-0.78, 0.78]) for (const sz of [0.45, 1.08]) {
    const leg = new THREE.Mesh(deskGeo.leg, M.frame);
    leg.scale.y = 0.72; leg.position.set(sx, 0.36, sz);
    g.add(leg);
  }
  if (laptop) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), M.dark);
    base.position.set(0, 0.775, 0.62);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.015), M.dark);
    lid.position.set(0, 0.89, 0.74);
    lid.rotation.x = -0.28;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ map: codeTexture() }));
    scr.position.set(0, 0.89, 0.7315);
    scr.rotation.set(-0.28, Math.PI, 0);
    scr.position.z -= 0.0;
    g.add(base, lid, scr);
    g.userData.screen = scr;
  } else {
    for (const sx of [-0.4, 0.4]) {
      const mon = new THREE.Mesh(deskGeo.monitor, M.dark);
      mon.position.set(sx, 1.0, 0.98); mon.rotation.y = sx * -0.5;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), new THREE.MeshBasicMaterial({ map: codeTexture() }));
      scr.position.set(sx + (sx > 0 ? -0.0 : 0.0), 1.0, 0.958); scr.rotation.y = Math.PI + sx * -0.5;
      g.add(mon, scr);
    }
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.15), M.dark);
    kb.position.set(0, 0.775, 0.55);
    g.add(kb);
  }
  // pull the desk in toward the chair so the hands land on the keys
  const desk = new THREE.Group();
  desk.position.z = -0.16;
  g.children.slice(1).forEach((c) => desk.add(c));
  g.add(desk);
  return g;
}

function cabinets() {
  const g = new THREE.Group();
  const tex = cabinetTexture();
  const side = new THREE.MeshStandardMaterial({ color: 0x56616f, roughness: 0.6, metalness: 0.4 });
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.35, 0.5), [front, side, side, side, side, side]);
    c.position.set(0, 0.675, (i - 1) * 0.52);
    g.add(c);
  }
  return g;
}

// ---------------------------------------------------------------- the crew

const CAST = {
  marcus: { sex: "m", h: 1.83 },
  dee: { sex: "f", h: 1.70 },
  ray: { sex: "m", h: 1.72 },
  iris: { sex: "f", h: 1.68 }
};
const NAMES = { marcus: "Marcus Vale", dee: "Dee Santos", ray: "Ray", iris: "Iris Chen" };

// small talk when you walk up and press E (Marcus opens the case board instead)
// "{name}" = the player's chosen name (Crew.playerName), filled in by say().
const TALK = {
  dee: ["Hey {name}. Your last result is still on the floor.", "Red ghosts: rows you missed.", "Amber rings: rows that shouldn't be there."],
  ray: ["Every table is a drawer, {name}. Check your laptop.", "Wrong answer? Back to the cabinet I go.", "Tables line up on their id columns."],
  iris: ["Tracing a phone number. Don't wait on me, {name}.", "Check the heat colours first.", "Run it, read it, compare to the request."]
};

// Dee works the floor: she walks a loop around the evidence table and stops to look at it.
const DEE_PATH = [[3.9, 3.9], [9, -1], [5, -8], [-3, -9], [-7, -4], [-3, 5]];

const HOLO_START = { x: 0, z: 10.5, yaw: Math.PI };
const HOLO_SPOTS = [[12.2, -2.6], [13.4, -0.4], [12.0, 1.8], [13.6, 3.6], [12.4, 5.4], [13.8, 7.2]];

// Dealin's six, working undercover as lab detectives. "out" = leave by the front door, come back a while later.
const DETS = [
  { id: "dre", sex: "m", h: 1.82, v: 1.35, route: ["in", [0, 19], [-6, 10], [-3, -6], [4, -14], [10, -8], [6, 9], [0, 19], "out"] },
  { id: "nia", sex: "f", h: 1.68, v: 1.25, route: [[-20, 8], [-14, -4], [-11, -12], [-12, -20], [-6, -22], [-2, -12], [-10, 8]] },
  { id: "diego", sex: "m", h: 1.80, v: 1.4, route: [[14, -8], [22, -8], [22.5, 6], [20, 8], [13, 10], [8, -6], [12, -18]] },
  { id: "lucia", sex: "f", h: 1.65, v: 1.3, route: ["in", [4, 19], [14.5, 10], [13.7, -2], [12, -14], [0, -18], [-12, -14], [-16, 0], [-8, 10], [0, 19], "out"] },
  { id: "jake", sex: "m", h: 1.78, v: 1.3, route: [[-6, 19], [-6, 12], [-10, -8], [-10, -17], [-4, -20], [6, -20], [6, 12]] },
  { id: "emily", sex: "f", h: 1.66, v: 1.2, route: ["in", [-2, 18], [2, 8], [2, -4], [0, -10], [-4, 6], [0, 18], "out"] },
  // universal cast: lab security patrols the front, a courier carries evidence in and out
  { id: "cop_m", sex: "m", h: 1.82, v: 1.0, gear: true, route: [[-10, 22], [10, 22], [10, 15.5], [-10, 15.5]] },
  { id: "courier_m", sex: "m", h: 1.74, v: 1.35, route: ["in", [1, 19], [-5, 9], [-6, -7], [3, -15], [7, -6], [3, 9], [1, 19], "out"] }
];
// Universal cast (Meshy extras, G:\meshy\universal): lab staff who fill the room. Bodies are src/chars/<id>.js.
// (key = the people[] key; a repeated body gets a "2" key. Bodies from Dealin's locals: earl mateo omar mai sina.)
// Typists: one per background desk (BG_DESKS order).
const STAFF = [
  { id: "scrubs_f", sex: "f", h: 1.64 }, { id: "track_m", sex: "m", h: 1.80 },
  { id: "hoodie_m", sex: "m", h: 1.78 }, { id: "mai", sex: "f", h: 1.60 },
  { id: "omar", sex: "m", h: 1.83 }, { id: "labcoat_f", key: "labcoat_f2", sex: "f", h: 1.66 },
  { id: "polo_m", key: "polo_m2", sex: "m", h: 1.76 }, { id: "hoodie_m", key: "hoodie_m2", sex: "m", h: 1.78 }
];
// Standing around the case wall (x = -26, z = -7..3), talking. face = the spot they look toward.
const BOARD_CREW = [
  { id: "labcoat_f", sex: "f", h: 1.66, x: -23.7, z: -4.4, face: [-23.7, -2.3] },
  { id: "polo_m", sex: "m", h: 1.76, x: -23.7, z: -2.3, face: [-23.7, -4.4] },
  { id: "mateo", sex: "m", h: 1.78, x: -22.1, z: -3.35, face: [-23.7, -3.35] }
];
// The big round meeting table (right side, between Marcus and the coffee bar). Six colleagues sit around it, talking.
const TABLE = { x: 17.2, z: -1.6, r: 1.75, seatR: 2.05 };
const TABLE_CREW = [
  { id: "suit_m", sex: "m", h: 1.82 }, { id: "blazer_f", sex: "f", h: 1.68 }, { id: "elder_m", sex: "m", h: 1.72 },
  { id: "auntie_f", sex: "f", h: 1.62 }, { id: "hijab_f", sex: "f", h: 1.64 }, { id: "elder_f", sex: "f", h: 1.60 }
];
const seatAt = (i, n = 6) => {
  const a = (i / n) * Math.PI * 2 + 0.3;
  return { x: TABLE.x + Math.sin(a) * TABLE.seatR, z: TABLE.z + Math.cos(a) * TABLE.seatR, yaw: a + Math.PI };
};
// Others: a cop at the coffee bar texting, someone on the lounge couch on a device, someone at the fax machine
// (the other cop and the courier walk the floor as DETS).
const COFFEE_COP = { id: "cop_f", sex: "f", h: 1.70, x: 23.1, z: -3.2, yaw: Math.PI / 2 };
const COUCH_SIT = { id: "earl", sex: "m", h: 1.76, x: 19.3, z: -18.4, yaw: 0 };
const FAX = { x: -24.6, z: 8 };   // the little fax table against the left wall
const FAX_USER = { id: "sina", sex: "f", h: 1.70, x: -23.2, z: 8, yaw: -Math.PI / 2 };
const BOARD_TALK = [
  ["labcoat_f", "Three of the five informants trace back to one port."],
  ["polo_m", "Then seizures should line up with case_suspects.", "cocky"],
  ["mateo", "Twenty years on this wall. It's always the join you skipped."],
  ["labcoat_f", "Marcus wants the country totals before noon."],
  ["polo_m", "Tell whoever pulls it: check for duplicates."],
  ["mateo", "Duplicates, nulls, and one name spelled three ways."],
  ["polo_m", "Contraband by weight. Not by count."],
  ["labcoat_f", "That red string goes right through the harbour."],
  ["mateo", "Back in my day we did this with index cards."]
];
const TABLE_TALK = [
  ["suit_m", "Okay. Open requests first."],
  ["blazer_f", "Fourteen cases waiting on data."],
  ["elder_m", "So our analyst is the bottleneck.", "sit_yell"],
  ["auntie_f", "Don't rush them. A wrong number costs more."],
  ["hijab_f", "Three suspects have no country on file."],
  ["elder_f", "Check the join. An inner join drops those rows."],
  ["suit_m", "LEFT JOIN. Somebody write that on the board."],
  ["blazer_f", "Seizures by port, ranked. By Friday."],
  ["elder_m", "Coffee first. Then Friday."],
  ["auntie_f", "There's a pot in the lounge."]
];
const DOOR = [0, 25.7];

class Det {
  constructor(a, def) { this.a = a; this.def = def; this.reset(); }
  reset() {
    const r = this.def.route;
    this.paused = false;
    this.out = r[0] === "in";
    this.i = this.out ? 1 : 0;
    this.wait = this.out ? 2 + Math.random() * 10 : Math.random() * 3;
    if (this.out) { this.x = DOOR[0]; this.z = DOOR[1]; this.yaw = Math.PI; }
    else { this.x = r[0][0]; this.z = r[0][1]; this.yaw = Math.random() * 6; }
    this.a.root.visible = !this.out;
    this.a.root.position.set(this.x, 0, this.z);
  }
  update(dt, hold) {
    const a = this.a, r = this.def.route;
    if (this.paused) { if (a.root.visible) a.update(dt, 0); return; }
    if (this.out) {
      this.wait -= dt;
      if (this.wait > 0) return;
      this.out = false; a.root.visible = true; this.x = DOOR[0]; this.z = DOOR[1]; this.yaw = Math.PI;
    }
    let sp = 0;
    if (this.wait > 0) this.wait -= dt;
    else {
      const t = r[this.i] === "out" ? DOOR : r[this.i];
      const dx = t[0] - this.x, dz = t[1] - this.z, d = Math.hypot(dx, dz);
      if (d < 0.2) {
        if (r[this.i] === "out") { this.out = true; this.wait = 8 + Math.random() * 14; this.i = r[0] === "in" ? 1 : 0; a.root.visible = false; return; }
        this.i = (this.i + 1) % r.length;
        if (Math.random() < 0.35) this.wait = 1 + Math.random() * 3;
      } else {
        sp = this.def.v;
        this.x += dx / d * sp * dt; this.z += dz / d * sp * dt;
        this.yaw = turnTo(this.yaw, Math.atan2(dx, dz), dt * 6);
      }
    }
    a.root.position.set(this.x, 0, this.z);
    a.root.rotation.y = this.yaw;
    a.update(dt, sp);
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const turnTo = (cur, target, k) => cur + Math.atan2(Math.sin(target - cur), Math.cos(target - cur)) * Math.min(1, k);

export class Crew {
  constructor(scene, orbit, room) {
    this.scene = scene;
    this.orbit = orbit;
    this.people = {};
    this.beat = null;
    this.workT = 0;
    this.says = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ready = false;
    this.colliders = room && room.userData.colliders ? room.userData.colliders.slice() : [];
    this.heroState = "stand";     // stand | sitting | seated | standing
    this.heroSpeed = 0;
    this.slide = null;            // the analyst gliding between the approach spot and the chair
    this.after = null;            // something to do when a sit/stand animation ends
    this.talkI = {};
    this.deeP = { x: SPOTS.dee.x, z: SPOTS.dee.z, yaw: SPOTS.dee.yaw };
    this.deeAI = { i: 0, wait: 3 };
    this._items = null;
  }

  async load(heroId) {
    await loadClips();
    // furniture first, so the room is never empty
    this.furn = new THREE.Group();   // the desks and cabinets: gone when the hologram is up
    this.scene.add(this.furn);
    const place = (obj, s) => { obj.position.set(s.x, 0, s.z); obj.rotation.y = s.yaw; this.furn.add(obj); return obj; };
    place(workstation(true), SPOTS.analyst);
    place(workstation(false), SPOTS.iris);
    const cab = cabinets();
    cab.position.set(SPOTS.ray.x - 0.9, 0, SPOTS.ray.z);
    this.furn.add(cab);
    for (const s of [SPOTS.analyst, SPOTS.iris]) this.colliders.push({ x: s.x + 0.62 * Math.sin(s.yaw), z: s.z + 0.62 * Math.cos(s.yaw), hw: 0.9, hd: 0.46, yaw: s.yaw });
    this.colliders.push({ x: cab.position.x, z: cab.position.z, hw: 0.34, hd: 0.8, yaw: 0 });
    this.colliders.push({ x: SPOTS.iris.x, z: SPOTS.iris.z, r: 0.35 }, { x: SPOTS.marcus.x, z: SPOTS.marcus.z, r: 0.4 }, { x: SPOTS.ray.x, z: SPOTS.ray.z, r: 0.4 });
    const all = [];
    for (const [id, c] of Object.entries(CAST)) all.push(this._spawn(id, id, c.sex, c.h));
    await Promise.all(all);
    // the six undercover detectives (Dealin's cast) who walk the floor and in and out of the lab
    this.dets = [];
    await Promise.all(DETS.map(async (d) => {
      let M0 = null;
      try { M0 = await loadBody(d.id, d.h); } catch (e) { /* body file missing: that person just isn't in the lab */ }
      if (!M0) return;
      const a = new Actor(M0, d.sex);
      a.root.add(blob());
      this.group.add(a.root);
      this.dets.push(new Det(a, d));
    }));
    await this.setHero(heroId || HEROES[0].id);
    this._settle();
    this.ready = true;
    this.loadStaff();   // the rest of the universal cast streams in behind the scenes
  }

  // Typists at every background desk, three people talking at the case wall, a cop at the coffee bar.
  async loadStaff() {
    this.staff = [];
    this.chat = {
      board: { i: -1, t: 3, lines: BOARD_TALK, members: BOARD_CREW.map((b) => b.id), nod: "agreeing", p: 0.6 },
      table: { i: -1, t: 7, lines: TABLE_TALK, members: TABLE_CREW.map((b) => b.id), nod: "sit_disbelief", p: 0.2 }
    };
    const add = async (def, place) => {
      let M0 = null;
      try { M0 = await loadBody(def.id, def.h); } catch (e) { return; }   // body file missing: skip that person
      if (!M0) return;
      const a = new Actor(M0, def.sex);
      const key = def.key || def.id;
      a.name = key;
      a.root.add(blob());
      this.people[key] = a;
      this.group.add(a.root);
      this.staff.push(a);
      place(a);
      a.root.visible = !this.hidden;
    };
    const stand = (def, hold, t) => (a) => {
      a.root.position.set(def.x, 0, def.z);
      a.root.rotation.y = def.yaw !== undefined ? def.yaw : toward(def.x, def.z, def.face[0], def.face[1]);
      a.hold(hold || a.loco("idle"), t === undefined ? Math.random() * 6 : t);
      this.colliders.push({ x: def.x, z: def.z, r: 0.4 });
    };
    const jobs = [];
    STAFF.forEach((def, i) => jobs.push(add(def, (a) => {   // every background desk has someone typing
      const [x, z] = BG_DESKS[i];
      a.root.position.set(x, 0, z); a.root.rotation.y = Math.PI;
      a.hold("typing", Math.random() * 16);
    })));
    BOARD_CREW.forEach((def) => jobs.push(add(def, stand(def))));
    TABLE_CREW.forEach((def, i) => jobs.push(add(def, (a) => {   // the round table: seated, talking with their hands
      const s = seatAt(i);
      a.root.position.set(s.x, 0, s.z); a.root.rotation.y = s.yaw;
      a.hold(def.sex === "f" ? "meeting_f" : "meeting_m", Math.random() * 40);
    })));
    jobs.push(add(COFFEE_COP, stand(COFFEE_COP, "texting", Math.random() * 20)));
    jobs.push(add(FAX_USER, stand(FAX_USER, "fax", Math.random() * 10)));
    jobs.push(add(COUCH_SIT, (a) => { a.root.position.set(COUCH_SIT.x, 0, COUCH_SIT.z); a.root.rotation.y = COUCH_SIT.yaw; a.hold("device", 0); }));
    await Promise.all(jobs);
  }

  // Small talk at the case wall and the round table: one line at a time, in turn, with a reaction from a listener now and then.
  _chat(dt) {
    if (!this.chat || this.hidden || !this.staff || !this.staff.length) return;
    for (const g of Object.values(this.chat)) {
      g.t -= dt;
      if (g.t > 0) continue;
      g.t = 6 + Math.random() * 3;
      const [who, text, act] = g.lines[g.i = (g.i + 1) % g.lines.length];
      const a = this.people[who];
      if (!a) continue;
      // only draw the bubble when the camera is within earshot
      if (this.orbit.camera.position.distanceTo(a.root.position) < 30) this.say(who, text, 5);
      if (act) a.play(act, { rate: 1 });
      const others = g.members.filter((k) => k !== who && this.people[k]);
      if (others.length && Math.random() < g.p) this.people[others[Math.floor(Math.random() * others.length)]].play(g.nod, { rate: 1 });
    }
  }

  async _spawn(key, bodyId, sex, h) {
    const M0 = await loadBody(bodyId, h);
    if (!M0) return null;
    const a = new Actor(M0, sex);
    a.name = key;
    a.root.add(blob());
    this.people[key] = a;
    this.group.add(a.root);
    return a;
  }

  async setHero(id) {
    const def = HEROES.find((x) => x.id === id) || HEROES[0];
    const keep = this.hero ? { x: this.hero.root.position.x, z: this.hero.root.position.z, yaw: this.hero.root.rotation.y } : null;
    const M0 = await loadBody(def.id, 1.78);
    if (!M0) return;
    if (this.hero) this.group.remove(this.hero.root);
    const a = new Actor(M0, def.sex);
    a.name = "analyst";
    a.root.add(blob());
    this.hero = a;
    this.heroDef = def;
    this.group.add(a.root);
    const at = keep || START;
    a.root.position.set(at.x, 0, at.z);
    a.root.rotation.y = at.yaw;
    if (this.heroState === "seated") this.seated();
  }

  // The crew to their stations and resting poses.
  _settle() {
    const put = (a, s) => { if (!a) return; a.root.position.set(s.x, 0, s.z); a.root.rotation.y = s.yaw; };
    put(this.people.iris, SPOTS.iris);
    put(this.people.ray, SPOTS.ray);
    put(this.people.marcus, SPOTS.marcus);
    put(this.people.dee, SPOTS.dee);
    const { iris, ray, marcus, dee } = this.people;
    if (iris) iris.hold("typing", 2.5);
    if (ray) ray.hold("files_low", 1);
    if (marcus) marcus.hold("texting", 4);
    if (dee) dee.hold(null);
    this.state = "idle";
  }

  // The analyst starts on their feet by the door, or already in the chair.
  startStanding() {
    const a = this.hero;
    this.heroState = "stand"; this.slide = null; this.after = null;
    if (!a) return;
    a.clear(); a.hold(null);
    a.root.position.set(START.x, 0, START.z);
    a.root.rotation.y = START.yaw;
  }
  startSeated() {
    const a = this.hero, s = SPOTS.analyst;
    this.slide = null; this.after = null;
    if (!a) return;
    a.root.position.set(s.x, 0, s.z);
    a.root.rotation.y = s.yaw;
    this.seated();
    this.heroState = "seated";
  }

  // The analyst resting in the chair: the last frame of Type To Sit, held.
  seated(smooth) {
    const a = this.hero;
    if (!a) return;
    a.hold(null);
    const cl = a.M.clips.type_to_sit;
    if (cl) a.play("type_to_sit", { from: cl.dur - 0.001, keep: true, smooth: !!smooth });
  }

  // ---- walking around

  // Push a walker (a circle) out of the furniture.
  collide(x, z, pr = 0.32) {
    if (this.hidden) return { x, z };   // the hologram room is empty
    for (const c of this.colliders) {
      if (c.r !== undefined) {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + pr;
        if (d < m) { if (d < 1e-4) x += m; else { x = c.x + dx / d * m; z = c.z + dz / d * m; } }
      } else {
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const wx = x - c.x, wz = z - c.z;
        const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
        const px = Math.max(-c.hw, Math.min(c.hw, lx)), pz = Math.max(-c.hd, Math.min(c.hd, lz));
        let dx = lx - px, dz = lz - pz, d = Math.hypot(dx, dz);
        if (d >= pr) continue;
        let nx, nz;
        if (d > 1e-4) { nx = px + dx / d * pr; nz = pz + dz / d * pr; }
        else {   // centre inside the box: leave by the nearest face
          const ox = c.hw - Math.abs(lx), oz = c.hd - Math.abs(lz);
          if (ox < oz) { nx = Math.sign(lx || 1) * (c.hw + pr); nz = lz; } else { nz = Math.sign(lz || 1) * (c.hd + pr); nx = lx; }
        }
        x = c.x + nx * cs + nz * sn;
        z = c.z - nx * sn + nz * cs;
      }
    }
    return { x, z };
  }

  // Things you can walk up to and use.
  interactables() {
    if (!this.ready || this.hidden) return [];
    if (this._items) return this._items;
    const self = this;
    const npc = (id, label, r) => ({ id, label, r, get x() { return self.people[id].root.position.x; }, get z() { return self.people[id].root.position.z; } });
    this._items = [
      { id: "desk", label: "Sit down at your laptop", x: SPOTS.analyst.x - 0.4, z: SPOTS.analyst.z, r: 2.3 },
      npc("marcus", "Talk to Marcus: case board", 2.4),
      npc("dee", "Talk to Dee", 2.0),
      npc("ray", "Talk to Ray", 2.0),
      npc("iris", "Talk to Iris", 1.9)
    ];
    return this._items;
  }

  talk(id) {
    const lines = TALK[id];
    if (!lines) return;
    const i = (this.talkI[id] = ((this.talkI[id] ?? -1) + 1) % lines.length);
    this.say(id, lines[i], 4.2);
    if (id === "dee") this.deeAI.wait = Math.max(this.deeAI.wait, 5);
  }

  // ---- sitting down and standing up (the analyst is on the approach spot, facing the desk)

  sitDown() {
    const a = this.hero, s = SPOTS.analyst;
    this.heroState = "sitting";
    a.clear(); a.hold(null);
    const dur = a.play("stand_up", { reverse: true, from: 2.45, to: 0.6, keep: true, smooth: true });
    this.slide = { a, from: { x: a.root.position.x, z: a.root.position.z }, to: { x: s.x, z: s.z }, t: 0, delay: dur * 0.15, d: dur * 0.7 };
    return new Promise((res) => { this.after = { t: dur + 0.05, fn: () => { this.seated(true); this.heroState = "seated"; res(); } }; });
  }

  standUp() {
    const a = this.hero, s = SPOTS.analyst;
    this.heroState = "standing";
    this.state = "idle";
    a.hold(null);
    const dur = a.play("stand_up", { from: 0.6, to: 2.45, smooth: true });
    this.slide = { a, from: { x: s.x, z: s.z }, to: { x: APPROACH.x, z: APPROACH.z }, t: 0, delay: dur * 0.45, d: dur * 0.55 + 0.2 };
    return new Promise((res) => { this.after = { t: dur + 0.25, fn: () => { this.heroState = "stand"; res(); } }; });
  }

  // Over the shoulder: the analyst seen from behind at the desk, just before the zoom into the screen.
  shoulderView() {
    const s = SPOTS.analyst;
    this.orbit.flyTo(new THREE.Vector3(s.x + 0.25, 1.0, s.z), 2.4, 1.3, s.yaw + Math.PI - 0.18);
  }
  startTyping() {
    const a = this.hero;
    if (!a || !a.M.clips.typing) return;
    a.clear(); a.hold("typing", 0);
    a.play("sit_to_type", { rate: 1 });
  }

  // The hologram room: you walk around the results; the crew and two detectives stand together off to the side.
  enterHolo() {
    const a = this.hero;
    this.heroState = "stand"; this.slide = null; this.after = null; this.state = "idle";
    if (a) { a.clear(); a.hold(null); a.root.visible = true; a.root.position.set(HOLO_START.x, 0, HOLO_START.z); a.root.rotation.y = HOLO_START.yaw; }
    const p = this.people;
    const side = [p.marcus, p.dee, p.ray, p.iris];
    const dets = this.dets.filter((d) => d.def.id === "nia" || d.def.id === "jake");
    this.dets.forEach((d) => { d.paused = true; d.a.root.visible = dets.includes(d); });
    (this.staff || []).forEach((a) => { a.root.visible = false; });   // the lab staff stay behind in the office
    const crowd = side.concat(dets.map((d) => d.a));
    crowd.forEach((c, i) => {
      if (!c) return;
      const [x, z] = HOLO_SPOTS[i];
      c.clear(); c.hold(null);
      c.root.visible = true;
      c.root.position.set(x, 0, z);
      c.root.rotation.y = Math.atan2(3 - x, 2 - z) + (i % 2 ? 0.15 : -0.1);
    });
    this.deeAI.freeze = true;
  }
  exitHolo() {
    this.deeAI.freeze = false;
    this.deeP = { x: SPOTS.dee.x, z: SPOTS.dee.z, yaw: SPOTS.dee.yaw };
    this._settle();
    this.dets.forEach((d) => d.reset());
    (this.staff || []).forEach((a) => { a.root.visible = true; });
  }

  // Zoom in until the laptop screen fills the view (the screen faces the chair; the analyst is hidden meanwhile).
  screenView() {
    const s = SPOTS.analyst;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    this.orbit.flyTo(new THREE.Vector3(s.x + fx * 0.585, 0.9, s.z + fz * 0.585), 0.3, 1.42, s.yaw + Math.PI);
  }
  // Leaving the laptop screen: back up behind the chair, looking over the analyst at the desk.
  pullBack() {
    const s = SPOTS.analyst;
    this.orbit.flyTo(new THREE.Vector3(s.x + 1.0, 1.0, s.z), 5.5, 1.25, s.yaw + Math.PI - 0.5);
  }
  setHeroVisible(v) { if (this.hero) this.hero.root.visible = v; }

  // The analyst goes to work at the laptop. Resolves once the typing has had a moment to show.
  beginWork() {
    const a = this.hero;
    if (!this.ready || !a || !a.M.clips.typing || this.heroState !== "seated") return Promise.resolve();
    this.state = "work";
    a.clear();
    a.hold("typing", 0);
    const lean = a.play("sit_to_type", { rate: 1 });
    if (this.people.ray) this.people.ray.hold("files_high", 0);
    this.workT = 0;
    // over-the-shoulder camera, from behind and to the side so you can see the hands on the keys
    const s = SPOTS.analyst;
    this.orbit.flyTo(new THREE.Vector3(s.x + 0.35, 0.95, s.z + 0.15), 4.4, 1.3, -0.62);
    return new Promise((res) => {
      this.beat = { at: lean + 1.0, res };
      setTimeout(() => this._endBeat(), 7000);   // never hang if the tab is hidden
    });
  }
  _endBeat() { if (this.beat) { const r = this.beat.res; this.beat = null; r(); } }

  // kind: "correct" | "wrong" | "error" | "reveal"
  finishWork(kind) {
    if (!this.ready) return;
    const a = this.hero, { ray, dee } = this.people;
    this.orbit.goalTheta = this.orbit.baseTheta = 0;
    if (a && this.state === "work") {
      a.clear();
      a.hold(null);
      a.play("type_to_sit", { keep: true });
    }
    this.state = "idle";
    if (ray) {
      if (kind === "correct") { ray.clear(); ray.hold("files_low", 0); ray.play("cabinet", { rate: 1.7, to: 9 }); this.say("ray", "Got the file.", 2.4); }
      else if (kind === "wrong" || kind === "reveal") { ray.hold("files_low", 3); this.say("ray", kind === "wrong" ? "Hmm. Something's off…" : "Here's the file.", 2.4); }
      else ray.hold("files_low", 3);
    }
    if (dee) {
      if (kind === "correct") { dee.play("victory", { rate: 1 }); this.say("dee", "That's the one, {name}!", 2.6); }
      else if (kind === "wrong") { dee.play("head_shake", { rate: 1 }); }
    }
  }

  // The boss's text: a new request, or the clue.
  ping(text) {
    this.say("marcus", text, 3.2);
  }

  say(who, text, secs) {
    const a = who === "analyst" ? this.hero : this.people[who];
    if (!a) return;
    text = text.replace(/\{name\}/g, this.playerName || "Analyst");
    this.says = this.says.filter((s) => { if (s.who === who) { disposeLabel(s.sprite); return false; } return true; });
    const sprite = makeLabel(text, { size: 28, height: 0.36, color: "#3ad8ff" });
    this.scene.add(sprite);
    this.says.push({ who, a, sprite, t: secs, base: sprite.scale.clone() });
  }

  _dee(dt) {
    const d = this.people.dee;
    if (!d) return;
    if (this.deeAI.freeze) { d.update(dt, 0); return; }
    const P = this.deeP, ai = this.deeAI;
    let sp = 0;
    if (d.busy) { /* reacting to an answer: stay put */ }
    else if (ai.wait > 0) { ai.wait -= dt; P.yaw = turnTo(P.yaw, Math.atan2(-P.x, -P.z), dt * 3); }
    else {
      const t = DEE_PATH[ai.i], dx = t[0] - P.x, dz = t[1] - P.z, dist = Math.hypot(dx, dz);
      if (dist < 0.12) { ai.i = (ai.i + 1) % DEE_PATH.length; ai.wait = 5 + Math.random() * 5; }
      else { sp = 1.15; P.x += dx / dist * sp * dt; P.z += dz / dist * sp * dt; P.yaw = turnTo(P.yaw, Math.atan2(dx, dz), dt * 6); }
    }
    d.root.position.set(P.x, 0, P.z);
    d.root.rotation.y = P.yaw;
    d.update(dt, sp);
  }

  update(dt) {
    if (!this.ready) return;
    this.workT += dt;
    if (this.beat && this.workT >= this.beat.at) this._endBeat();
    if (this.slide) {
      const s = this.slide;
      s.t += dt;
      const u = clamp01((s.t - s.delay) / s.d), e = u * u * (3 - 2 * u);
      s.a.root.position.set(s.from.x + (s.to.x - s.from.x) * e, 0, s.from.z + (s.to.z - s.from.z) * e);
      if (u >= 1) this.slide = null;
    }
    if (this.after) { this.after.t -= dt; if (this.after.t <= 0) { const f = this.after.fn; this.after = null; f(); } }
    this._dee(dt);
    this._chat(dt);
    for (const d of this.dets || []) d.update(dt);
    for (const [k, a] of Object.entries(this.people)) if (k !== "dee") a.update(dt, 0);
    if (this.hero) this.hero.update(dt, this.heroState === "stand" ? this.heroSpeed : 0);
    for (let i = this.says.length - 1; i >= 0; i--) {
      const s = this.says[i];
      s.t -= dt;
      const p = s.a.root.position;
      const seated = s.who === "analyst" && (this.heroState === "seated" || this.heroState === "sitting");
      s.sprite.position.set(p.x, p.y + (seated ? 1.7 : 2.15), p.z);
      s.sprite.material.opacity = Math.min(1, s.t * 2);
      s.sprite.visible = !this.hidden;
      // keep the bubble a readable size whether the camera is close behind you or high above the lab
      const f = Math.max(0.3, Math.min(1.4, this.orbit.camera.position.distanceTo(s.sprite.position) / 13));
      s.sprite.scale.copy(s.base).multiplyScalar(f);
      if (s.t <= 0) { disposeLabel(s.sprite); this.says.splice(i, 1); }
    }
  }
}

export { NAMES };
