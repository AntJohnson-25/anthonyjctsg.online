// Dirt and Deeds: boot, loop, player, camera, driving, people, interactions. Rules live in game.js, the town in world.js, the DOM in ui.js.
// Keyboard + mouse AND Xbox pad: pad.js turns buttons into the same key events and gives main the analog sticks and triggers.
import * as THREE from "three";
import { loadClips, loadBody, Actor } from "./chars.js";
import * as G from "./game.js";
import { T, HEROES, BODY, KEYS, WORKER_BODIES, RESIDENTS, LOITER, NICE_WALKERS, TOWN, money, clock } from "./data.js";
import { makeLots, buildWorld, collide, skyAt, EDGE, STREET_Z } from "./world.js";
import { loadCar, makeCar, makeParked, CAR_IDS, LUX_IDS } from "./cars3d.js";
import * as U from "./ui.js";
import { Pad } from "./pad.js";

const UI = U.UI;
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const SAVE_KEY = "dirt-deeds-save-1";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };

// ---------------------------------------------------------------- graphics presets
const GFX = { low: { pr: 1, shadow: 0, far: 150, aa: false }, med: { pr: 1.25, shadow: 1024, far: 220, aa: false }, high: { pr: 1.75, shadow: 2048, far: 320, aa: true } };
let gfxName = Q.get("gfx") || lsGet("dd-gfx") || ((navigator.hardwareConcurrency || 4) <= 2 ? "low" : "med");
if (!GFX[gfxName]) gfxName = "med";
const GF = GFX[gfxName];

// ---------------------------------------------------------------- three
const renderer = new THREE.WebGLRenderer({ canvas: $("c"), antialias: GF.aa, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, GF.pr));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = GF.shadow > 0; renderer.shadowMap.type = gfxName === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 2026-11-08 realism pass: Run It Up's filmic tone mapping (rolls highlights off, takes the cartoon saturation out)
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, GF.far + 80);
scene.background = new THREE.Color(0x8fc3ee); scene.fog = new THREE.Fog(0x9fcdf0, 40, GF.far);
// Soft sky light + reflections for every PBR surface (glass, car paint, wet puddles): a tiny gradient sky baked once
// into an environment map; its strength follows the daylight (updateSky).
{
  const es = new THREE.Scene();
  const eg = new THREE.SphereGeometry(10, 24, 12), col = [], p = eg.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; c.set(y > 0 ? 0x8ab0d8 : 0x6a6250).lerp(new THREE.Color(0xd8dcd8), 1 - Math.min(1, Math.abs(y) * (y > 0 ? 1.4 : 4))); col.push(c.r, c.g, c.b); }
  eg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  es.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0.04).texture; pm.dispose(); eg.dispose();
}
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a6450, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.castShadow = GF.shadow > 0; sun.shadow.mapSize.set(GF.shadow || 512, GF.shadow || 512);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
addEventListener("error", (e) => { const el = $("err"); el.hidden = false; el.textContent = "ERROR: " + e.message + " (" + (e.filename || "").split("/").pop() + ":" + e.lineno + ")"; });
addEventListener("unhandledrejection", (e) => { const el = $("err"); el.hidden = false; el.textContent = "ERROR: " + (e.reason && e.reason.message || e.reason); });

// ---------------------------------------------------------------- globals
let s = null, P = null, W = null, lots = null, mode = "boot";            // game state, props, world, lots
const models = {}, keyBody = {}, workerBody = [];
const npcs = [], traffic = [], marks = {};
let townSeed = 0, townGroups = [];
const pl = { x: 0, z: 0, yaw: 0, speed: 0, actor: null, heroId: "malik" };
const car = { x: 0, z: 0, yaw: 0, v: 0, steer: 0, g: null, driving: false };
const cam = { yaw: 0, pitch: 0.38, dist: 5.2, pos: new THREE.Vector3(), look: new THREE.Vector3(), want: new THREE.Vector3(), wantLook: new THREE.Vector3(), mode: "orbit", t: 0 };
const keys = new Set();
let target = null, talk = null, gpsPid = null, beacon = null, stageHero = null, stage = null, selHero = HEROES[0].id;
let selfUnlock = false, lastSave = 0, clockAcc = 0, labelT = 0, targetT = 0, skyT = 0;

// ================================================================= loading
function prog(f, txt) { $("load-fill").style.width = Math.round(f * 100) + "%"; if (txt) $("load-txt").textContent = txt; }

async function bootGame() {
  mode = "boot";
  const want = new Set();
  for (const k of ["flats", "heights"]) for (const l of Object.values(RESIDENTS[k])) l.forEach((b) => want.add(b));
  LOITER.forEach((b) => want.add(b)); NICE_WALKERS.forEach((b) => want.add(b));
  const list = [...want];
  prog(0.03, "Animations…");
  await loadClips();
  // key people: first body in each fallback list that has a packed file
  const keyIds = Object.values(KEYS).flat().concat(WORKER_BODIES.flat());
  const all = [...new Set([...list, ...keyIds])];
  let done = 0, next = 0;
  const worker = async () => {
    while (next < all.length) {
      const id = all[next++];
      try { models[id] = await loadBody(id, BODY[id] ? BODY[id][1] : 1.75); } catch (e) { models[id] = null; }
      done++; prog(0.05 + 0.8 * done / all.length, "People of " + TOWN + "… " + done + "/" + all.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  for (const [role, cands] of Object.entries(KEYS)) keyBody[role] = cands.find((b) => models[b]) || "hoodie_m";
  for (const cands of WORKER_BODIES) workerBody.push(cands.find((b) => models[b]) || "construction_m");
  prog(0.9, "Cars…");
  await Promise.all(CAR_IDS.map((id) => loadCar(id).catch(() => {})));
  prog(0.95, "Building the town…");
  await new Promise((r) => setTimeout(r, 30));
  const saved = lsGet(SAVE_KEY);
  let seed = Math.floor(Math.random() * 1e6);
  const sv = saved && G.restore(saved);
  if (sv) seed = sv.seed;
  if (Q.get("seed")) seed = +Q.get("seed");
  buildTown(seed);
  prog(1, "Ready.");
  mode = "title";
  $("loading").classList.add("ready");
  $("load-bar").hidden = true;
  $("t-play").hidden = false; $("t-cont").hidden = !sv; $("t-gfx").hidden = false;
  $("t-fine").textContent = "Keyboard & mouse or Xbox controller · " + (sv ? "Day " + sv.day + " saved" : "");
  UI.pending = sv;
  if (Q.get("auto")) { const h = Q.get("auto"); if (HEROES.some((x) => x.id === h)) { selHero = h; await startRun(h, null); } }
}

// ================================================================= the town (rebuilt per seed)
function disposeTown() {
  for (const g of townGroups) { scene.remove(g); g.traverse((o) => { if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); }); }
  townGroups = [];
  for (const n of npcs) scene.remove(n.a.root); npcs.length = 0;
  for (const t of traffic) scene.remove(t.g); traffic.length = 0;
  for (const k of Object.keys(marks)) { scene.remove(marks[k]); delete marks[k]; }
  if (W && W.group) { scene.remove(W.group); W.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}
function buildTown(seed) {
  disposeTown();
  townSeed = seed;
  lots = makeLots();
  P = G.genProps(seed, lots);
  W = buildWorld(scene, P, lots);
  placeParked();
  UI.P = P;
  spawnPeople();
  spawnTraffic();
  // the car you drive
  if (car.g) scene.remove(car.g);
  car.g = makeCar("sedan"); scene.add(car.g);
  car.x = -52; car.z = 3.7; car.yaw = 0; car.v = 0; syncCar();
  // gps beacon
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  beacon.visible = false; scene.add(beacon); townGroups.push(beacon);
}

// Every parking spot the town build left (curbs, drives, lots) gets a Meshy car. Model from the spot, a dusty look on
// half the Flats cars, the rust bucket where a house has the "rustcar" sign. 2026-11-08 realism pass (box cars gone).
function placeParked() {
  const grp = new THREE.Group(); scene.add(grp); townGroups.push(grp);
  const ids = ["sedan", "sedan2", "suv", "pickup", "sedan", "van", "suv", "sedan2"];
  for (const sp of W.parked) {
    const h = Math.abs(Math.round(sp.x * 13.7 + sp.z * 7.3)), flats = sp.x < -84;
    // Heights drives: about one in five holds a luxury car; the showcase spots downtown name their own model.
    const lux = !flats && sp.x > 84 && !sp.rusty && h % 5 === 0;
    const id = sp.model || (sp.rusty ? "pickup" : lux ? LUX_IDS[(h >> 3) % LUX_IDS.length] : ids[h % ids.length]);
    const look = sp.model || lux ? "clean" : sp.rusty ? "rust" : flats && h % 2 ? "dusty" : "clean";
    const c = makeParked(id, look);
    c.position.set(sp.x, 0, sp.z); c.rotation.y = sp.ry;
    grp.add(c);
    const L = (c.userData.len || 4.8) / 2, Wd = 1.0, along = Math.abs(Math.cos(sp.ry)) > 0.7;
    W.boxes.push(along ? { x0: sp.x - L, x1: sp.x + L, z0: sp.z - Wd, z1: sp.z + Wd } : { x0: sp.x - Wd, x1: sp.x + Wd, z0: sp.z - L, z1: sp.z + L });
  }
}

function bodyOf(id) { return models[id] ? id : null; }
function makeNpc(bodyId, x, z, yaw, opts = {}) {
  const id = bodyOf(bodyId) || bodyOf("hoodie_m"); if (!id) return null;
  const a = new Actor(models[id], BODY[id] ? BODY[id][0] : "m");
  a.root.position.set(x, 0, z); a.root.rotation.y = yaw; scene.add(a.root);
  a.update(0, 0);
  const n = { a, x, z, yaw, id, speed: 0, kind: opts.kind || "stand", ...opts };
  a.root.traverse((o) => { if (o.isMesh) { o.castShadow = GF.shadow > 0 && !opts.noShadow; o.receiveShadow = true; } });
  if (opts.hold) a.hold(opts.hold);
  npcs.push(n);
  return n;
}
function spawnPeople() {
  const R = G.rng(townSeed + 4242);
  const rp = (arr) => arr[Math.floor(R() * arr.length)];
  // key people
  const mk = (role, poi, hold) => { const n = makeNpc(keyBody[role], poi.x, poi.z, poi.yaw, { kind: "key", role, hold }); return n; };
  W.keyNpc = { mentor: mk("mentor", W.poi.mentor, "cocky"), lender: mk("lender", W.poi.lender, "m_idle"), agent: mk("agent", W.poi.agent, "f_idle") };
  if (W.keyNpc.agent) W.keyNpc.agent.a.hold(models[keyBody.agent] && BODY[keyBody.agent][0] === "f" ? "phone_talk" : "device");
  if (W.keyNpc.lender) W.keyNpc.lender.a.hold(null);
  // the rival lounges outside the coffee shop
  const cf = W.bld.coffee; makeNpc(keyBody.rival, cf.stand.x + 3, cf.stand.z, Math.PI, { kind: "key", role: "rival", hold: "cocky" });
  // construction site: workers + foreman
  const S = W.site;
  makeNpc(workerBody[0], S.x - 2, S.z + 1, 0.6, { kind: "work", role: "framer", job: R() * 6 });
  makeNpc(workerBody[1], S.x + 3, S.z - 1, 2.4, { kind: "work", role: "roofer", job: R() * 6 });
  makeNpc(keyBody.gc, S.x + 8, S.z + 6.5, Math.PI * 1.1, { kind: "key", role: "gc", hold: "idle_examine" });
  // walkers on the sidewalks
  const walker = (bodies, zc, side, x0, x1, speed) => {
    const x = x0 + R() * (x1 - x0), dir = R() < 0.5 ? 1 : -1;
    makeNpc(rp(bodies), x, zc + side * 6.25, dir > 0 ? Math.PI / 2 : -Math.PI / 2, { kind: "walk", x0, x1, dir, speed, z: zc + side * 6.25 });
  };
  const flat = [...RESIDENTS.flats.m, ...RESIDENTS.flats.f, "elder_f"], heights = NICE_WALKERS;
  for (const zc of [-62, 0, 62]) {
    walker(flat, zc, -1, -222, -90, 1.3); walker(flat, zc, 1, -222, -90, 1.2);
    walker(heights, zc, -1, 90, 222, 1.3); walker(heights, zc, 1, 90, 222, 1.1);
  }
  for (let i = 0; i < 5; i++) walker([...heights, ...RESIDENTS.flats.m, "polo_m"], 0, i % 2 ? 1 : -1, -74, 74, 1.1 + R() * 0.4);
  // corner loiterers in the Flats
  const spots = [[-92, -6, 1], [-92, -4, 1.7], [-96, 6.5, 3.1], [-100, -64, 2]];
  spots.forEach(([x, z, yaw], i) => makeNpc(LOITER[i % LOITER.length], x, z, yaw, { kind: "stand", hold: i % 2 ? "cocky" : "talk_m" }));
}
function spawnTraffic() {
  const ids = ["sedan2", "suv", "pickup", "van", "sedan2", "suv", "luxsedan", "sportscar", "royalsuv"];
  const lanes = [[0, 1], [0, -1], [-62, 1], [62, -1], [0, 1], [62, 1], [0, -1], [-62, -1], [62, 1]];
  ids.forEach((id, i) => {
    const [zc, dir] = lanes[i], g = makeCar(id); scene.add(g);
    const t = { g, zc, dir, x: -200 + ((i * 85 + (i > 5 ? 40 : 0)) % 400), z: zc + dir * 1.8, v: 7 + (i % 3) * 1.2 + (id === "sportscar" ? 2.5 : 0), cur: 0, len: g.userData.len || 4.8 };
    g.rotation.y = dir > 0 ? 0 : Math.PI; g.position.set(t.x, 0, t.z);
    traffic.push(t);
  });
}

// ================================================================= title / select / start
function setMode(m) {
  mode = m;
  const playish = m === "play";
  if (!playish && document.pointerLockElement) { selfUnlock = true; document.exitPointerLock(); }
  $("hud").hidden = !(m === "play" || m === "talk");
  if (m !== "play") U.prompt(null);
  if (m !== "play" && m !== "talk") U.houseLabel(null);
  U.hudKeys(Pad.on, car.driving);
}
function showSelect() {
  $("loading").hidden = true; $("select").hidden = false; mode = "select";
  const box = $("sel-cards"); box.innerHTML = "";
  HEROES.forEach((h) => { const b = document.createElement("button"); b.textContent = h.name; b.dataset.id = h.id; b.onclick = () => pickHero(h.id); box.appendChild(b); });
  buildStage();
  pickHero(selHero);
}
function buildStage() {
  if (stage) return;
  stage = new THREE.Group(); stage.position.set(0, 0, 330);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6 }));
  ped.position.y = 0.1; ped.receiveShadow = true; stage.add(ped);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.04, 8, 48), new THREE.MeshBasicMaterial({ color: 0xe3b765 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.21; stage.add(ring);
  const spot = new THREE.SpotLight(0xfff0d0, 90, 14, 0.7, 0.5); spot.position.set(2.5, 6, 4); spot.target.position.set(0, 1, 0); stage.add(spot, spot.target);
  scene.add(stage);
}
// A hero's own Meshy body once it is packed (src/chars/hero_*.js); the stand-in until then.
async function heroModel(h) {
  for (const id of [h.body, h.fb]) {
    if (models[id]) return models[id];
    try { const M = await loadBody(id, h.h); if (M) return (models[id] = M); } catch (e) { /* not packed yet */ }
  }
  return null;
}
async function pickHero(id) {
  selHero = id;
  document.querySelectorAll("#sel-cards button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  const h = HEROES.find((x) => x.id === id);
  $("sel-info").innerHTML = "<b>" + h.name + " · " + h.perk + "</b><br>" + h.line + "<br><em>" + h.perkText + "</em>";
  $("sel-go").disabled = true;
  const HM = await heroModel(h);
  if (!HM) U.toast("Could not load " + h.name, "bad");
  if (selHero !== id) return;
  if (stageHero) { stage.remove(stageHero.root); }
  if (HM) {
    stageHero = new Actor(HM, h.sex); stageHero.root.rotation.y = 0.35; stage.add(stageHero.root); stageHero.root.position.y = 0.2;
    stageHero.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    stageHero.play("waving", {}); 
  }
  $("sel-go").disabled = false;
}

async function startRun(heroId, savedState) {
  $("select").hidden = true; $("loading").hidden = true;
  const h = HEROES.find((x) => x.id === heroId);
  const HM = await heroModel(h);
  if (!HM) { U.toast("Missing body " + h.body, "bad"); return; }
  if (savedState) { s = savedState; if (townSeed !== s.seed) buildTown(s.seed); G.applyTurns(s, P); }
  else { const seed = Q.get("seed") ? +Q.get("seed") : Math.floor(Math.random() * 1e6); if (seed !== townSeed) buildTown(seed); s = G.newGame(heroId, seed); }
  UI.s = s; UI.P = P;
  if (pl.actor) scene.remove(pl.actor.root);
  pl.actor = new Actor(HM, h.sex); pl.heroId = heroId;
  pl.actor.root.traverse((o) => { if (o.isMesh) { o.castShadow = GF.shadow > 0; o.receiveShadow = true; } });
  scene.add(pl.actor.root);
  if (stageHero) { stage.remove(stageHero.root); stageHero = null; }
  car.driving = false;
  if (s.flags.car) { car.x = s.flags.car.x; car.z = s.flags.car.z; car.yaw = s.flags.car.yaw; syncCar(); }
  gpsPid = s.flags.gps != null ? s.flags.gps : null;
  placeAtHome(); refreshMarks(); refreshGps();
  cam.yaw = Math.PI; cam.pitch = 0.3; cam.mode = "orbit";
  snapCamera();
  U.hud(s); setMode("play");
  if (!savedState) introCard();
  saveGame();
}
function placeAtHome() {
  const st = W.bld.home.stand;
  pl.x = st.x; pl.z = st.z; pl.yaw = Math.PI; pl.speed = 0; pl.actor.root.position.set(pl.x, 0, pl.z); pl.actor.root.rotation.y = 0;
  cam.yaw = 0;
}
function introCard() {
  setMode("card");
  U.card("Welcome to " + TOWN,
    "<p>You have <b>" + money(T.startCash) + "</b>, a phone and a beat-up sedan. Rent is <b>" + money(T.rent) + "</b> every " + T.rentEvery + " days. Food and gas eat about " + money(T.living) + " a day.</p>" +
    "<p>You are a <b>bird dog</b>: you find houses whose owners <i>have</i> to sell, learn their situation and their number, and hand the lead to the mentor in the brick building on Main Street. He pays a finder's fee when it closes.</p>" +
    "<ul><li><b>Read the houses.</b> Overgrown yards, boards, tarps, notices, stacked mail = trouble.</li><li><b>" + (Pad.on ? "A" : "E") + "</b> notes a house from the street. Walk to the door and knock, or find a phone number and call.</li>" +
    "<li>Build <b>trust</b> before you ask about money. Push too hard and the door closes.</li><li>Check your <b>phone</b> (" + (Pad.on ? "Y" : "Tab") + "): the numbers tell you whether a deal even exists.</li></ul>" +
    "<p>The mentor is on Main Street, north side. Your car is outside your apartment.</p>",
    [{ label: "Hit the street", primary: true, fn: () => setMode("play") }]);
}

// ================================================================= save
function saveGame() {
  if (!s || s.over) return;
  s.flags.car = { x: car.x, z: car.z, yaw: car.yaw }; s.flags.gps = gpsPid;
  lsSet(SAVE_KEY, G.serialize(s)); lastSave = performance.now();
}
addEventListener("visibilitychange", () => { if (document.hidden && mode === "play") saveGame(); });

// ================================================================= markers + gps
const flagGeo = { pole: new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), flag: new THREE.BoxGeometry(0.5, 0.32, 0.03), board: new THREE.BoxGeometry(1.1, 0.6, 0.05) };
const flagCol = { noted: 0xe8c64a, talked: 0x5aa8e8, locked: 0x4fcf7a, contract: 0xe8903a, sent: 0xe3b765, cold: 0x888888, dead: 0x666666, paid: 0x4fcf7a };
function refreshMarks() {
  if (!s) return;
  const want = {};
  for (const pid of Object.keys(s.leads)) { const L = s.leads[pid]; if (s.sold[pid]) continue; if (L.status !== "paid") want[pid] = L.status; }
  for (const pid of Object.keys(s.sold)) want[pid] = "sold";
  for (const pid of Object.keys(marks)) if (!want[pid]) { scene.remove(marks[pid]); delete marks[pid]; }
  for (const pid of Object.keys(want)) {
    const st = want[pid];
    if (marks[pid] && marks[pid].userData.st === st) continue;
    if (marks[pid]) scene.remove(marks[pid]);
    const pl2 = W.place[pid], cs = pl2.face > 0 ? 1 : -1, g = new THREE.Group();
    const col = st === "sold" ? 0xd23a2a : (flagCol[st] || 0xaaaaaa);
    const pole = new THREE.Mesh(flagGeo.pole, new THREE.MeshBasicMaterial({ color: 0xdddddd })); pole.position.y = 0.8; g.add(pole);
    const f = new THREE.Mesh(st === "sold" ? flagGeo.board : flagGeo.flag, new THREE.MeshBasicMaterial({ color: col })); f.position.set(st === "sold" ? 0 : 0.28, st === "sold" ? 1.3 : 1.4, 0); g.add(f);
    g.position.set(pl2.x + (-7.5) * cs, 0, pl2.z + 9.6 * cs); g.rotation.y = pl2.yaw; g.userData.st = st; scene.add(g); marks[pid] = g;
  }
}
function refreshGps() {
  if (gpsPid == null || !s || s.sold[gpsPid]) { gpsPid = null; beacon.visible = false; U.gps(null); return; }
  const pp = W.place[gpsPid]; beacon.visible = true; beacon.position.set(pp.x, 30, pp.z);
}
function updateGps() {
  if (gpsPid == null) return;
  const pp = W.place[gpsPid], rx = car.driving ? car.x : pl.x, rz = car.driving ? car.z : pl.z;
  const d = Math.hypot(pp.x - rx, pp.z - rz);
  U.gps("&#9906; " + P[gpsPid].addr + " &middot; " + (d > 999 ? (d / 1000).toFixed(1) + " km" : Math.round(d) + " m"));
}
// ================================================================= input
document.addEventListener("keydown", (e) => {
  if (e.repeat) { if (mode === "play") keys.add(e.code); return; }
  keys.add(e.code);
  if (e.code === "Tab") e.preventDefault();
  onKey(e);
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
document.body.addEventListener("keydown", (e) => { /* synthetic pad events bubble from body; handled by the document listener */ });
document.addEventListener("mousemove", (e) => { if (mode === "play" && document.pointerLockElement) { cam.yaw -= e.movementX * 0.0024; cam.pitch = clamp(cam.pitch + e.movementY * 0.0018, 0.04, 1.3); camManual = 1.5; } });
let camManual = 0;
$("c").addEventListener("click", () => { if (mode === "play" && !Pad.on && !document.pointerLockElement) { try { $("c").requestPointerLock(); } catch (e) { /* denied */ } } });
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement) { if (selfUnlock) { selfUnlock = false; return; } if (mode === "play") pauseGame(); }
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function onKey(e) {
  const c = e.code;
  if (mode === "card") { if (c === "Enter" || c === "Space" || c === "KeyE") { const b = document.querySelector("#card-btns .primary") || document.querySelector("#card-btns button"); if (b) b.click(); e.preventDefault(); } return; }
  if (mode === "pause") { if (c === "Escape") resumeGame(); return; }
  if (mode === "talk") {
    if (c.startsWith("Digit")) talkKey(+c.slice(5)); else if (c === "Escape") UI.act.talk("leave");
    else if (c === "Tab") { /* no phone mid-conversation */ }
    return;
  }
  if (mode === "phone") { if (c === "Tab" || c === "Escape") closePhoneMode(); return; }
  if (mode === "play") {
    if (c === "Escape" || c === "KeyP") pauseGame();
    else if (c === "Tab") openPhoneMode();
    else if (c === "KeyE") interact();
    else if (c === "KeyF" && car.driving) exitCar();
    else if (c === "KeyR") { camManual = 0; }
  }
}
const talkKey = U.talkKey;
function openPhoneMode(tab) { setMode("phone"); U.openPhone(tab); }
function closePhoneMode() { U.closePhone(); setMode("play"); }
function pauseGame() {
  if (mode !== "play") return;
  setMode("pause"); $("pause").hidden = false;
  $("pz-gfxv").textContent = gfxName; $("pz-musicv").textContent = musicOn ? "on" : "off";
  document.querySelector(".pz-keys").textContent = Pad.on ? "Left stick move / drive · Right stick camera · A use · Y phone · RT gas · LT brake · L3 run · Menu pause" : "WASD move / drive · Shift run · Mouse look · E use · Tab phone · Esc pause";
  saveGame();
}
function resumeGame() { $("pause").hidden = true; setMode("play"); }
$("pz-resume").onclick = resumeGame;
$("pz-save").onclick = () => { saveGame(); U.toast("Saved.", "good"); };
$("pz-gfx").onclick = () => { const order = ["low", "med", "high"]; lsSet("dd-gfx", order[(order.indexOf(gfxName) + 1) % 3]); saveGame(); location.reload(); };
$("pz-music").onclick = () => { toggleMusic(); $("pz-musicv").textContent = musicOn ? "on" : "off"; };
$("pz-quit").onclick = () => { saveGame(); location.href = location.pathname; };
$("ph-x").onclick = closePhoneMode;
$("h-phone").style.pointerEvents = "auto"; $("h-phone").style.cursor = "pointer"; $("h-phone").onclick = () => { if (mode === "play") openPhoneMode(); };
$("t-play").onclick = () => { showSelect(); };
$("t-cont").onclick = async () => { const sv = UI.pending; if (sv) { selHero = sv.hero; await startRun(sv.hero, sv); } };
$("t-gfx").onclick = () => { const order = ["low", "med", "high"]; lsSet("dd-gfx", order[(order.indexOf(gfxName) + 1) % 3]); location.reload(); };
$("t-gfx").textContent = "Graphics: " + gfxName;
$("sel-back").onclick = () => { $("select").hidden = true; $("loading").hidden = false; mode = "title"; if (stageHero) { stage.remove(stageHero.root); stageHero = null; } };
$("sel-go").onclick = () => startRun(selHero, null);

// music (optional): the user's tracks, one <audio>, shuffled
const TRACKS = ["last-summer-boulevard", "rain-on-the-windowpane"];
let musicOn = lsGet("dd-music") !== "off", audio = null, mi = Math.floor(Math.random() * TRACKS.length);
function startMusic() {
  if (audio || !musicOn) return;
  audio = new Audio(); audio.volume = 0.35;
  audio.onended = () => { mi = (mi + 1) % TRACKS.length; audio.src = "assets/music/" + TRACKS[mi] + ".mp3"; audio.play().catch(() => {}); };
  audio.src = "assets/music/" + TRACKS[mi] + ".mp3"; audio.play().catch(() => { audio = null; });
}
function toggleMusic() { musicOn = !musicOn; lsSet("dd-music", musicOn ? "on" : "off"); if (musicOn) startMusic(); else if (audio) { audio.pause(); audio = null; } }
document.addEventListener("click", startMusic, { once: true }); document.addEventListener("keydown", startMusic, { once: true });
addEventListener("gamepadconnected", () => { U.toast("Controller connected", "good", 1800); });

// ================================================================= phone actions
Object.assign(UI.act, {
  gps(pid) { gpsPid = +pid; refreshGps(); U.toast("GPS set: " + P[pid].addr); closePhoneMode(); },
  trace(pid) { const r = G.skipTrace(s, P[pid]); U.toast(r.msg, r.ok ? "good" : "bad"); U.hud(s); U.renderPhone(); },
  drop(pid) { const L = s.leads[pid]; if (L) { L.status = "dead"; } refreshMarks(); UI.lead = null; U.renderPhone(); },
  send(pid) { const r = G.sendToMentor(s, P, +pid); U.toast(r.msg, r.ok ? "good" : "bad", 4200); refreshMarks(); U.hud(s); U.renderPhone(); },
  call(pid) { callOwner(+pid); },
  pitch(i, bid) { const r = G.pitchBuyer(s, P, s.contracts[+i], bid); U.toast(r.msg, r.interested ? "good" : "", 4600); U.hud(s); U.renderPhone(); if (G.adv(s, 0)) lateNight(); },
  accept(i) { const c = s.contracts[+i]; const r = G.respondOffer(s, P, c, "accept"); U.toast(r.msg, "good", 4600); U.renderPhone(); },
  decline(i) { const r = G.respondOffer(s, P, s.contracts[+i], "decline"); U.toast(r.msg); U.renderPhone(); },
  counter(i) { const c = s.contracts[+i]; const r = G.respondOffer(s, P, c, "counter", Math.round(c.offer.price * 1.1 / 100) * 100); U.toast(r.msg, r.accepted ? "good" : "", 4600); if (r.accepted) { G.respondOffer(s, P, c, "accept"); } U.renderPhone(); },
  talk(id) { talkAct(id); }
});
// ================================================================= interaction
function nearestHouse(ref, fwdDot) {
  let best = null, bd = 1e9;
  const f = camFlatForward();
  for (const l of lots) {
    const dx = l.x - ref.x, dz = l.z - ref.z, d = Math.hypot(dx, dz);
    const lim = car.driving ? 27 : 24;
    if (d > lim) continue;
    const dot = (dx * f.x + dz * f.z) / (d || 1);
    if (d > 9 && dot < fwdDot) continue;
    if (d < bd) { bd = d; best = l; }
  }
  return best ? { lot: best, d: bd } : null;
}
function camFlatForward() { return { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) }; }
function computeTarget() {
  const ref = car.driving ? car : pl;
  let t = null;
  if (!car.driving) {
    for (const role of ["mentor", "lender", "agent"]) { const n = W.keyNpc[role]; if (!n) continue; const d = Math.hypot(n.x - pl.x, n.z - pl.z); if (d < 3.4 && (!t || d < t.d)) t = { type: "npc", role, d, text: { mentor: "Talk to the mentor", lender: "Talk to the lender", agent: "Talk to the listing agent" }[role], sub: { mentor: "Ironwood Acquisitions", lender: "Cobblestone Bridge Capital", agent: "Pecan Hollow Realty" }[role] }; }
    const hs = W.bld.home.stand, hd = Math.hypot(hs.x - pl.x, hs.z - pl.z);
    if (hd < 3.2 && (!t || hd < t.d)) t = { type: "home", d: hd, text: "Go home", sub: "Sleep, save, end the day" };
    const cd = Math.hypot(car.x - pl.x, car.z - pl.z);
    if (cd < 3.8 && (!t || cd < t.d)) t = { type: "car", d: cd, text: "Get in the car", sub: "Drive for dollars" };
    for (const l of lots) {
      const pp = W.place[l.id], d = Math.hypot(pp.door.x - pl.x, pp.door.z - pl.z);
      if (d < 3.0 && (!t || d < t.d)) { t = { type: "door", pid: l.id, d, text: "Knock: " + P[l.id].addr, sub: s.sold[l.id] ? "SOLD" : "Owner on record: " + P[l.id].owner.name }; break; }
    }
  }
  const nh = nearestHouse(ref, car.driving ? 0.35 : 0.45);
  if (!t && nh && !s.sold[nh.lot.id] && !s.leads[nh.lot.id]) t = { type: "note", pid: nh.lot.id, d: nh.d, text: "Note this house", sub: P[nh.lot.id].addr };
  return { t, near: nh };
}function interact() {
  if (mode !== "play" || !target) return;
  const t = target;
  if (t.type === "note") doNote(t.pid);
  else if (t.type === "door") doKnock(t.pid);
  else if (t.type === "npc") talkNpc(t.role);
  else if (t.type === "home") homeCard();
  else if (t.type === "car") enterCar();
  else if (t.type === "exit") exitCar();
}
function doNote(pid) {
  const r = G.noteLead(s, P[pid]);
  U.toast(r.ok ? "Noted " + P[pid].addr + ". It's on your phone." : r.msg, r.ok ? "good" : "", 2200);
  if (r.ok) { const p = P[pid]; if (s.leads[pid].arvKnown) U.toast("Noted " + p.addr + ". You pegged it at ~" + money(Math.round(p.arv * s.mkt / 1000) * 1000) + " fixed up.", "good", 3000); }
  refreshMarks(); U.hud(s); checkLate();
}
function enterCar() { car.driving = true; pl.actor.root.visible = false; cam.mode = "orbit"; U.hudKeys(Pad.on, true); U.toast("Drive for dollars. Read the houses.", "", 2000); }
function exitCar() {
  if (Math.abs(car.v) > 2.5) { U.toast("Slow down first.", "", 1200); return; }
  car.driving = false; car.v = 0; pl.actor.root.visible = true;
  // step out on the right-hand side of the heading (right of fwd = (sin, cos))
  pl.x = car.x + Math.sin(car.yaw) * 2.5; pl.z = car.z + Math.cos(car.yaw) * 2.5;
  collide(W, pl, 0.45);
  pl.yaw = Math.atan2(Math.sin(car.yaw), Math.cos(car.yaw)); pl.actor.root.position.set(pl.x, 0, pl.z);
  U.hudKeys(Pad.on, false);
}
// --- home
function homeCard() {
  setMode("card");
  const late = G.hour(s) >= 17;
  U.card("Maple Court #4B", "<p>It is " + clock(s.min) + ". Sleeping ends the day: bills get paid, the mentor and the buyers call in, and the clock resets to 7 AM.</p><p class=\"fine\">Cash " + money(s.cash) + " · rent " + money(T.rent) + " due in " + (s.rentDue - s.day) + " days.</p>",
    [{ label: "Sleep (end the day)", primary: true, fn: () => endOfDay("sleep") }, { label: "Save", fn: () => { saveGame(); U.toast("Saved.", "good"); setMode("play"); } }, { label: "Not yet", fn: () => setMode("play") }]);
}
function lateNight() { checkLate(); }
function checkLate() {
  if (mode !== "play" && mode !== "talk" && mode !== "phone") return;
  if (s.min >= T.dayEnd && mode === "play") endOfDay("late");
  else if (s.min >= T.dayEnd) pendingLate = true;
}
let pendingLate = false;
function endOfDay(reason) {
  U.closePhone(); closeTalkUi();
  const wasDriving = car.driving;
  const res = G.endDay(s, P);
  const lines = res.lines.map((t) => '<div class="sum-line ' + (/Closed|fee|Tip|called back|passed your number|TIER|reached/.test(t) ? "good" : /lost|ghosted|lien|trouble|Bad news|can't|expire|ran out|stopped/.test(t) ? "bad" : "") + '">' + t + "</div>").join("");
  setMode("card");
  U.card(reason === "late" ? "It's late. You head home." : "Good night.", "<p class=\"fine\">Day " + (s.day - 1) + " is over.</p>" + lines, s.over ? [{ label: "Game over", primary: true, fn: () => gameOver() }] : [{ label: "Start day " + s.day, primary: true, fn: () => newDay() }]);
}
function newDay() {
  if (car.driving) { /* leave the car where it is */ car.driving = false; car.v = 0; pl.actor.root.visible = true; }
  placeAtHome(); refreshMarks(); refreshGps(); U.hud(s); setMode("play"); saveGame();
  const t = G.checkTier(s, P); if (t) U.toast(t, "good", 4500);
  U.toast("Day " + s.day + ". " + (s.unread ? s.unread + " new message" + (s.unread > 1 ? "s" : "") + " on your phone." : "Good morning."), "", 2800);
}
function gameOver() {
  localStorage.removeItem(SAVE_KEY);
  U.card("Out of money", "<p>You made it " + (s.day - 1) + " days. " + s.closed + " leads closed through your mentor, " + s.assigned + " contracts assigned, " + money(s.earned) + " earned in fees.</p><p>Real estate does not forgive a missed rent. The next try starts with what you learned.</p>",
    [{ label: "Back to title", primary: true, fn: () => { location.href = location.pathname; } }]);
}
// --- people
function talkNpc(role) {
  setMode("card");
  if (role === "mentor") return mentorCard();
  if (role === "lender") return U.card("Cobblestone Bridge Capital", "<p>\"Short-term money for people with a plan. I fund flips and purchases at a rate and a clock. Miss the clock and the clock eats you.\"</p><p class=\"fine\">Hard-money lending unlocks in Tier 3. Earn your name first.</p>", [{ label: "Fair enough", primary: true, fn: () => setMode("play") }]);
  if (role === "agent") {
    const fl = G.compPpsf(s, "flats"), he = G.compPpsf(s, "heights");
    return U.card("Pecan Hollow Realty", "<p>\"Free tip: homes in the Flats are going for about <b>$" + fl + "</b> a square foot fixed up. Willow Crest about <b>$" + he + "</b>. Retail buyers pay that. Investors pay less, and that gap is where you live.\"</p><p class=\"fine\">Sellers who already listed with an agent aren't for you.</p>", [{ label: "Thanks", primary: true, fn: () => setMode("play") }]);
  }
}
function mentorCard() {
  const locked = Object.values(s.leads).filter((l) => l.status === "locked" && !s.sold[l.pid]);
  const sent = s.sent.length;
  let h = "<p>\"" + (s.closed === 0 && !sent && !locked.length ? "Listen close. Find me a house where the owner has to sell. Overgrown, boarded, notices on the door. Get them to tell you why, and what number gets it done. I pay when it closes." : s.tier === 1 ? "Keep your eyes open. Fix your numbers and bring me deals that work." : "You're past the training wheels. You know the game.") + "\"</p>";
  h += "<p class=\"fine\">Closed through him: " + s.closed + " · rep " + Math.round(s.rep) + (sent ? " · " + sent + " lead(s) with him now" : "") + "</p>";
  const btns = locked.slice(0, 3).map((l) => ({ label: "Hand over " + P[l.pid].addr + " (" + money(l.lockedPrice) + ")", primary: true, fn: () => { const r = G.sendToMentor(s, P, l.pid); U.toast(r.msg, r.ok ? "good" : "bad", 4200); refreshMarks(); U.hud(s); setMode("play"); } }));
  btns.push({ label: "How the numbers work", fn: () => mentorRules() });
  btns.push({ label: "Later", primary: !btns.length, fn: () => setMode("play") });
  U.card("Ironwood Acquisitions", h, btns);
}
function mentorRules() {
  U.card("The mentor's rules",
    "<ul><li><b>ARV</b> is what the house sells for fixed up. Price per square foot times size. Check the Market tab.</li><li>An investor pays at most <b>70% of ARV, minus repairs, minus about $5,000</b>. That's your phone's \"most a buyer can pay\".</li>" +
    "<li>If the seller's number is <b>above</b> that, there's no deal. Don't lock it.</li><li><b>See the inside</b> (needs real trust). Guessing repairs is how people lose money.</li>" +
    "<li>Sellers who really have to move say yes at a lower number. Learn <i>why</i> they're selling.</li><li>Finder's fee: about 6% of the room I have, more if you bring the whole story.</li></ul>",
    [{ label: "Understood", primary: true, fn: () => setMode("play") }]);
}

// ================================================================= knock + call + conversation
let sellerNpc = null;
function doKnock(pid) {
  const p = P[pid];
  if (s.sold[pid]) { U.toast("That house is sold.", "bad"); return; }
  let L = s.leads[pid];
  if (L && L.cooldown > s.day) { U.toast(p.owner.first + " told you to stay away for now. Try after day " + L.cooldown + ".", "bad", 3200); return; }
  if (L && ["sent", "paid", "contract"].includes(L.status)) { U.toast("You already have this one spoken for.", "", 2200); return; }
  if (!L) { G.noteLead(s, p); refreshMarks(); }
  s.stats.knocks++;
  const home = Q.get("home") === "1" ? !p.absentee : G.homeNow(s, p, "door");
  const pp = W.place[pid];
  // walk up and face the door
  pl.x = pp.door.x; pl.z = pp.door.z; pl.yaw = pp.yaw + Math.PI; pl.actor.root.position.set(pl.x, 0, pl.z); pl.actor.root.rotation.y = pl.yaw;
  U.toast("Knock knock…", "", 900);
  setMode("card"); $("card").hidden = true;
  setTimeout(() => {
    if (!home) {
      const res = G.noAnswer(s, P, p, "door", true);
      U.toast(res.text, "", 4200); refreshMarks(); U.hud(s); setMode("play"); checkLate(); return;
    }
    sellerNpc = makeNpc(p.owner.body, pp.porch.x, pp.porch.z, pp.yaw, { kind: "seller", hold: BODY[p.owner.body] && BODY[p.owner.body][0] === "f" ? "f_idle" : "m_idle" });
    beginTalk(pid, "door");
  }, 900);
}
function callOwner(pid) {
  const p = P[pid], L = s.leads[pid];
  if (!G.canCall(L, p)) { U.toast("You have no number for them.", "bad"); return; }
  if (car.driving && Math.abs(car.v) > 1) { U.toast("Pull over before you make the call.", "bad"); return; }
  if (L.cooldown > s.day) { U.toast("They aren't taking your calls right now.", "bad"); return; }
  U.closePhone();
  s.stats.calls++;
  if (!G.homeNow(s, p, "phone")) {
    const res = G.noAnswer(s, P, p, "phone", true);
    U.toast(res.text, "", 4200); U.hud(s); setMode("play"); checkLate(); return;
  }
  sellerNpc = null;
  beginTalk(pid, "phone");
}
function beginTalk(pid, kind) {
  const p = P[pid], c = G.startTalk(s, p, kind);
  talk = { pid, c, p, kind, done: false };
  setMode("talk");
  U.openTalk(c, p);
  const greet = kind === "door" ? ["\"Yes? Can I help you?\"", "\"I'm not buying anything.\"", "\"Hello? Who are you?\""] : ["\"Hello?\"", "\"Who's this?\"", "\"Yeah?\""];
  U.talkLines([{ who: "seller", text: greet[Math.floor(Math.random() * greet.length)] }, { who: "note", text: kind === "door" ? "You're at the door of " + p.addr + "." : "You called " + p.owner.name + "." }]);
  if (kind === "phone") pl.actor.hold("phone_talk"); else { if (sellerNpc) sellerNpc.a.hold(BODY[p.owner.body] && BODY[p.owner.body][0] === "f" ? "talk_f" : "talk_m"); }
  cam.mode = "talk";
}
function talkAct(id) {
  if (!talk || talk.done) return;
  const res = G.talkAct(s, talk.c, talk.p, id);
  U.talkLines(res.lines); U.renderTalk(); U.hud(s);
  if (sellerNpc) {
    if (res.end === "locked" || res.end === "contract") sellerNpc.a.play("agreeing");
    else if (res.end === "burned") sellerNpc.a.play(sellerNpc.a.M.clips.angry ? "angry" : "head_shake");
    else if (id === "push" && talk.c.tension > 60) sellerNpc.a.play("head_shake");
  }
  if (talk.c.over) {
    talk.done = true;
    setTimeout(() => finishTalkUi(), 900);
  } else if (s.min >= T.dayEnd) { /* the day ends when the talk does */ }
}
function finishTalkUi() {
  const fin = G.finishTalk(s, P, talk.c);
  const wasKind = talk.kind;
  closeTalkUi();
  refreshMarks(); U.hud(s);
  setMode("card");
  const title = { locked: "Locked!", contract: "Under contract!", burned: "Door closed", dead: "Off the table", left: "Conversation over" }[fin.kind] || "Done";
  let extra = "";
  if (fin.kind === "locked") extra = '<p class="fine">Open your phone to send it to the mentor, or hand it over in person. Make sure the numbers work first.</p>';
  U.card(title, "<p>" + fin.text + "</p>" + extra, [{ label: "Continue", primary: true, fn: () => { setMode("play"); checkLate(); } }]);
}
function closeTalkUi() {
  U.closeTalk();
  pl.actor.hold(null);
  if (sellerNpc) { const n = sellerNpc; sellerNpc = null; n.a.hold(null); n.kind = "leaving"; n.leaveT = 0; }
  talk = null; cam.mode = "orbit"; pendingLate = false;
}

// ================================================================= per-frame
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
function syncCar() { if (!car.g) return; car.g.position.set(car.x, 0, car.z); car.g.rotation.y = car.yaw; }

function updatePlayer(dt) {
  const f = camFlatForward(), r = { x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) };
  let ix = 0, iz = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) iz += 1; if (keys.has("KeyS") || keys.has("ArrowDown")) iz -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1; if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
  if (Pad.on || Pad.lx || Pad.ly) { ix += Pad.lx; iz -= Pad.ly; }
  const m = Math.hypot(ix, iz); if (m > 1) { ix /= m; iz /= m; }
  const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Pad.sprint;
  const sp = (run ? 4.6 : 2.7) * Math.min(1, m);
  const dx = (f.x * iz + r.x * ix), dz = (f.z * iz + r.z * ix);
  if (m > 0.05) {
    const want = Math.atan2(dx, dz);
    let d = want - pl.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    pl.yaw += d * Math.min(1, dt * 12);
    const n = Math.hypot(dx, dz) || 1;
    pl.x += dx / n * sp * dt; pl.z += dz / n * sp * dt;
    collide(W, pl, 0.42);
    pl.speed = sp;
  } else pl.speed = 0;
  pl.actor.root.position.set(pl.x, 0, pl.z); pl.actor.root.rotation.y = pl.yaw;
  pl.actor.update(dt, pl.speed);
}

function updateCar(dt) {
  const k = (c) => keys.has(c);
  let thr = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
  let st = (k("KeyA") || k("ArrowLeft") ? 1 : 0) - (k("KeyD") || k("ArrowRight") ? 1 : 0);
  if (Pad.on || Pad.rt || Pad.lt) { thr += Pad.rt - Pad.lt; st += -Pad.lx; if (!Pad.rt && !Pad.lt && Math.abs(Pad.ly) > 0.3) thr -= Pad.ly; }
  thr = clamp(thr, -1, 1); st = clamp(st, -1, 1);
  const handbrake = k("Space");
  if (thr > 0) car.v += (car.v < -0.5 ? 16 : 7.5) * thr * dt; else if (thr < 0) car.v -= (car.v > 0.5 ? 16 : 5) * -thr * dt;
  if (!thr) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 4 * dt);
  if (handbrake) car.v -= Math.sign(car.v) * Math.min(Math.abs(car.v), 14 * dt);
  car.v = clamp(car.v * (1 - 0.05 * dt), -5, 17);
  car.yaw += st * 1.7 * clamp(car.v / 5, -1, 1) * dt * (1 - Math.min(0.4, Math.abs(car.v) / 40));
  const fx = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
  const ox = car.x, oz = car.z;
  car.x += fx * car.v * dt; car.z += fz * car.v * dt;
  // three circles along the body
  let hit = 0;
  for (const off of [-1.5, 0, 1.5]) {
    const p = { x: car.x + fx * off, z: car.z + fz * off };
    const bx = p.x, bz = p.z;
    collide(W, p, 1.0);
    if (Math.abs(p.x - bx) + Math.abs(p.z - bz) > 0.001) { car.x += p.x - bx; car.z += p.z - bz; hit += Math.hypot(p.x - bx, p.z - bz); }
  }
  for (const t of traffic) {
    const dx = car.x - t.x, dz = car.z - t.z, d = Math.hypot(dx, dz);
    if (d < 3.6) { const n = d || 1; car.x += dx / n * (3.6 - d) * 0.6; car.z += dz / n * (3.6 - d) * 0.6; hit += 0.1; t.hold = 1.2; }
  }
  if (hit > 0.02) car.v *= 1 - Math.min(0.7, hit * 3);
  s.driven += Math.hypot(car.x - ox, car.z - oz);
  syncCar();
  // cabin shake / nothing else
}

function updateTraffic(dt) {
  for (const t of traffic) {
    t.hold = Math.max(0, (t.hold || 0) - dt);
    let want = t.hold > 0 ? 0 : t.v;
    // brake for you (on foot or in the car) ahead in the lane
    const refs = [car.driving ? car : pl]; if (!car.driving) refs.push(car);
    for (const r of refs) { const ahead = (r.x - t.x) * t.dir; if (ahead > 0 && ahead < 9 && Math.abs(r.z - t.z) < 2.2) want = Math.min(want, Math.max(0, (ahead - 4) * 1.2)); }
    t.cur += (want - t.cur) * Math.min(1, dt * 2.2);
    t.x += t.dir * t.cur * dt;
    if (t.x > EDGE.x + 20) t.x = -EDGE.x - 20; if (t.x < -EDGE.x - 20) t.x = EDGE.x + 20;
    t.g.position.set(t.x, 0, t.z);
  }
}

function updateNpcs(dt) {
  const cx = camera.position.x, cz = camera.position.z;
  for (const n of npcs) {
    const dist = Math.hypot(n.x - cx, n.z - cz);
    if (n.kind === "walk") {
      n.x += n.dir * n.speed * dt;
      if (n.x > n.x1) { n.x = n.x1; n.dir = -1; } else if (n.x < n.x0) { n.x = n.x0; n.dir = 1; }
      n.yaw = n.dir > 0 ? Math.PI / 2 : -Math.PI / 2; n.a.root.position.set(n.x, 0, n.z); n.a.root.rotation.y = n.yaw;
    } else if (n.kind === "work") {
      n.job -= dt;
      if (n.job <= 0 && !n.a.busy) { n.a.play(Math.random() < 0.5 ? "pick_up" : "idle_examine"); n.job = 4 + Math.random() * 6; }
    } else if (n.kind === "leaving") {
      n.leaveT += dt;
      if (n.leaveT > 1.2) { const pp = null; n.a.root.visible = false; n.dead = true; }
    } else if (n.kind === "key" && n.role !== "rival") {
      // face the player when close
      const d = Math.hypot(pl.x - n.x, pl.z - n.z);
      if (d < 6 && !car.driving) { const want = Math.atan2(pl.x - n.x, pl.z - n.z); let df = want - n.yaw; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2; n.yaw += df * Math.min(1, dt * 3); n.a.root.rotation.y = n.yaw; }
    }
    if (dist > 95 && n.kind !== "seller") { n.a.root.visible = false; continue; }
    if (!n.dead) n.a.root.visible = true;
    n.a.lod(dist > 24);
    n.a.update(dt, n.kind === "walk" ? n.speed : 0);
  }
  for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].dead) { scene.remove(npcs[i].a.root); npcs.splice(i, 1); }
}

function updateCamera(dt) {
  const ref = car.driving ? car : pl;
  const tgtY = car.driving ? 1.4 : 1.35;
  if (mode === "title" || mode === "boot") {
    cam.t += dt * 0.05;
    cam.want.set(Math.sin(cam.t) * 150, 62, Math.cos(cam.t) * 90 + 20); cam.wantLook.set(0, 4, 0);
    cam.pos.lerp(cam.want, 0.03); cam.look.lerp(cam.wantLook, 0.05);
  } else if (mode === "select") {
    cam.want.set(0.7, 1.55, 330 + 4.2); cam.wantLook.set(0, 1.0, 330);
    cam.pos.lerp(cam.want, 0.1); cam.look.lerp(cam.wantLook, 0.1);
    if (stageHero) { stageHero.root.rotation.y += dt * 0.35; stageHero.update(dt, 0); if (!stageHero.busy && Math.random() < 0.004) stageHero.play(Math.random() < 0.5 ? "waving" : "victory"); }
  } else if (cam.mode === "talk" && talk) {
    if (talk.kind === "door" && sellerNpc) {
      const a = { x: pl.x, z: pl.z }, b = { x: sellerNpc.x, z: sellerNpc.z };
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      const nx = -dz / d, nz = dx / d;  // perpendicular
      const side = (nx * (camera.position.x - mx) + nz * (camera.position.z - mz)) >= 0 ? 1 : -1;
      cam.want.set(mx + nx * side * 4.4 - dx / d * 0.4, 1.35, mz + nz * side * 4.4); cam.wantLook.set(mx, 0.25, mz);
    } else {
      cam.want.set(pl.x + Math.sin(pl.yaw) * 3.2 + Math.cos(pl.yaw) * 1.0, 1.3, pl.z + Math.cos(pl.yaw) * 3.2 - Math.sin(pl.yaw) * 1.0); cam.wantLook.set(pl.x, 0.5, pl.z);
    }
    cam.pos.lerp(cam.want, Math.min(1, dt * 3)); cam.look.lerp(cam.wantLook, Math.min(1, dt * 4));
  } else {
    if (Pad.on) { cam.yaw -= Pad.rx * 2.6 * dt; cam.pitch = clamp(cam.pitch + Pad.ry * 1.5 * dt, 0.04, 1.3); if (Pad.rx || Pad.ry) camManual = 1.5; }
    if (car.driving) {
      // chase: ease the camera yaw behind the heading unless you're looking around
      camManual = Math.max(0, camManual - dt);
      if (camManual <= 0) { const want = car.yaw - Math.PI / 2; let d = want - cam.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; cam.yaw += d * Math.min(1, dt * 2.2); }
      if (camManual <= 0) cam.pitch += (0.26 - cam.pitch) * Math.min(1, dt * 1.5);
    } else if (Pad.on && !Pad.rx && !Pad.ry && pl.speed > 0.5) {
      // pad: gently swing the camera behind you while you walk
      camManual = Math.max(0, camManual - dt);
      if (camManual <= 0) { const want = pl.yaw + Math.PI; let d = want - cam.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; cam.yaw += d * Math.min(1, dt * 0.9) * 0.6; }
    }
    const dist = car.driving ? 8.4 : cam.dist;
    cam.want.set(ref.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist, tgtY + Math.sin(cam.pitch) * dist + 0.2, ref.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist);
    cam.wantLook.set(ref.x, tgtY + 0.15, ref.z);
    clipCam(cam.want, cam.wantLook);
    cam.pos.lerp(cam.want, Math.min(1, dt * 14)); cam.look.copy(cam.wantLook);
    if (cam.pos.y < 0.5) cam.pos.y = 0.5;
  }
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
}
// keep the camera out of walls: march from the target toward where the camera wants to be, stop at the first building box
function clipCam(want, look) {
  const dx = want.x - look.x, dz = want.z - look.z;
  let k = 1;
  for (let i = 1; i <= 10; i++) {
    const x = look.x + dx * i / 10, z = look.z + dz * i / 10;
    let inside = false;
    for (const b of W.boxes) if (x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3) { inside = true; break; }
    if (inside) { k = Math.max(0.15, (i - 1) / 10); break; }
  }
  if (k < 1) { want.x = look.x + dx * k; want.z = look.z + dz * k; want.y = look.y + (want.y - look.y) * Math.max(k, 0.5); }
}
function snapCamera() {
  const ref = pl; cam.pos.set(ref.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, 1.6 + Math.sin(cam.pitch) * cam.dist, ref.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist); cam.look.set(ref.x, 1.5, ref.z);
}

function updateSky(force) {
  const m = s ? s.min : 14 * 60;
  const k = skyAt(m);
  scene.background.copy(k.sky); scene.fog.color.copy(k.fog);
  hemi.intensity = k.amb * 1.25; sun.intensity = k.sun * 1.35;
  scene.environmentIntensity = 0.12 + 0.5 * (1 - k.night);
  const hr = k.hour; const ang = clamp((hr - 6) / 14, 0, 1) * Math.PI;
  const tx = (mode === "select" ? 0 : (car.driving ? car.x : pl.x)), tz = (mode === "select" ? 330 : (car.driving ? car.z : pl.z));
  sun.target.position.set(tx, 0, tz);
  sun.position.set(tx + Math.cos(ang) * 90, Math.max(12, Math.sin(ang) * 90), tz + 40);
  sun.color.setHex(hr < 8 || hr > 18.2 ? 0xffc890 : 0xfff2dc);
  if (W) for (const mat of W.nightMats) mat.emissiveIntensity = k.night * (mat === W.mats.lamp ? 1.4 : 1.0);
  if (W && W.signMats) for (const mat of W.signMats) mat.emissiveIntensity = 0.28 + 0.9 * k.night;   // shop signs glow a little by day, fully at night
  if (W && W.setTime) W.setTime(k, sun.position, sun.target.position, sun.color);
  scene.fog.far = GF.far * (k.night > 0.6 ? 0.7 : 1);
}

// --- target + label (6 Hz)
function updateTarget(dt) {
  targetT -= dt; if (targetT > 0) return; targetT = 0.12;
  if (mode !== "play") { target = null; return; }
  const { t, near } = computeTarget();
  target = t;
  if (t) {
    const key = Pad.on ? "A" : "E";
    U.prompt("<kbd>" + key + "</kbd>" + t.text, t.sub);
  } else U.prompt(null);
  // the house label for the closest front-facing house
  const ref = car.driving ? car : pl;
  const lab = near && (!car.driving || true) ? near : null;
  if (lab && lab.d < (car.driving ? 26 : 22)) {
    const pp = W.place[lab.lot.id];
    _v.set(pp.x, 4.2, pp.z).project(camera);
    if (_v.z < 1 && Math.abs(_v.x) < 1.1) {
      const el = U.houseLabel(P[lab.lot.id], s.leads[lab.lot.id], s, lab.d < 17);
      el.style.left = ((_v.x + 1) / 2 * innerWidth) + "px"; el.style.top = ((1 - _v.y) / 2 * innerHeight) + "px";
    } else U.houseLabel(null);
  } else U.houseLabel(null);
}

// ================================================================= main loop
let last = performance.now();
let padWas = false;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  requestAnimationFrame(frame);
  try {
    Pad.poll(dt);
    if (Pad.on !== padWas) { padWas = Pad.on; U.hudKeys(Pad.on, car.driving); }
    if (mode === "play") {
      if (car.driving) updateCar(dt); else updatePlayer(dt);
      // the clock
      s.min += dt * T.walkMinPerSec; clockAcc += dt;
      if (clockAcc > 0.5) { clockAcc = 0; U.hud(s); if (U.phoneOpen()) U.renderPhone(); updateGps(); }
      if (s.min >= T.dayEnd) { endOfDay("late"); }
      if (now - lastSave > 45000) saveGame();
    } else if (mode === "talk" && talk && talk.kind === "phone") { pl.actor.update(dt, 0); }
    else if (mode === "talk" && talk) { pl.actor.update(dt, 0); }
    else if (mode === "card" || mode === "phone" || mode === "pause") { if (pl.actor && s) pl.actor.update(dt, car.driving ? 0 : 0); }
    if (s && mode !== "title" && mode !== "select" && mode !== "boot") { updateTraffic(dt); }
    updateNpcs(dt);
    updateTarget(dt);
    updateCamera(dt);
    skyT -= dt; if (skyT <= 0) { skyT = 0.25; updateSky(); }
    // sun/shadow follow every frame
    if (beacon && beacon.visible) beacon.material.opacity = 0.2 + 0.1 * Math.sin(now / 300);
    renderer.render(scene, camera);
  } catch (e) { const el = $("err"); el.hidden = false; el.textContent = "FRAME ERROR: " + e.message; console.error(e); }
}
document.addEventListener("keydown", (e) => { if (e.code === "Tab") e.preventDefault(); }, true);

window.DD = { get s() { return s; }, get P() { return P; }, get W() { return W; }, G, pl, car, cam, scene, camera, setMode, startRun, endOfDay, get mode() { return mode; }, interact, get target() { return target; }, npcs, talkAct, doKnock, doNote, openPhoneMode };
Pad.init({});
requestAnimationFrame(frame);
bootGame().catch((e) => { const el = $("err"); el.hidden = false; el.textContent = "BOOT ERROR: " + e.message; console.error(e); });
