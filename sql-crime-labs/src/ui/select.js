// Analyst line-up on the title screen: the four playable bodies stand in a lit studio so you see who you pick.
// Own small renderer (the lab's renderer keeps running behind the title); loop only runs while the line-up is visible.
//   const sel = new HeroSelect(canvasEl, HEROES, (id) => ...);   await sel.load();   sel.show(id);   sel.hide();
import * as THREE from "three";
import { Actor, loadBody, loadClips } from "../world/people.js";

const GAP = 1.3;
const GREEN = 0x2dff6a;

export class HeroSelect {
  constructor(canvas, heroes, onPick) {
    this.canvas = canvas;
    this.heroes = heroes;
    this.onPick = onPick;
    this.actors = [];
    this.sel = 0;
    this.visible = false;
    this.ready = false;
    this.t = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.camPos = new THREE.Vector3(0, 1.25, 7.6);
    this.camLook = new THREE.Vector3(0, 0.95, 0);
    this.camera.position.copy(this.camPos);

    this.scene.add(new THREE.HemisphereLight(0xdde9ff, 0x142018, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 5, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(GREEN, 1.6); rim.position.set(-4, 3, -4); this.scene.add(rim);

    // floor: a dark disc with a green grid, one ring per slot
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.2, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x03100a, transparent: true, opacity: 0.9 }));
    floor.position.y = -0.005;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(10.4, 26, GREEN, 0x0e4a22);
    grid.material.transparent = true; grid.material.opacity = 0.16;
    this.scene.add(grid);
    this.rings = heroes.map((_, i) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.58, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(this.slotX(i), 0.01, 0);
      this.scene.add(m);
      return m;
    });

    this.ray = new THREE.Raycaster();
    this.hits = [];
    canvas.addEventListener("pointerdown", (e) => this.click(e));
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop(null);
  }

  slotX(i) { return (i - (this.heroes.length - 1) / 2) * GAP; }

  async load() {
    await loadClips();
    for (let i = 0; i < this.heroes.length; i++) {
      const h = this.heroes[i];
      let M = null;
      try { M = await loadBody(h.id, 1.78); } catch (e) { /* that body is missing: the slot stays empty */ }
      if (!M) { this.actors.push(null); this.hits.push(null); continue; }
      const a = new Actor(M, h.sex);
      a.root.position.set(this.slotX(i), 0, 0);
      this.scene.add(a.root);
      this.actors.push(a);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.set(this.slotX(i), 1, 0);
      box.userData.i = i;
      this.scene.add(box);
      this.hits.push(box);
    }
    this.ready = true;
    this.pick(this.sel, false);
  }

  resize() {
    const host = this.canvas.parentElement;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.aspect = w / h;
  }

  click(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), this.camera);
    const hit = this.ray.intersectObjects(this.hits.filter(Boolean), false)[0];
    if (hit) this.pick(hit.object.userData.i, true);
  }

  // Step forward onto the ring, play a one-shot, and let the camera ease in.
  pick(i, notify) {
    this.sel = (i + this.heroes.length) % this.heroes.length;
    const a = this.actors[this.sel];
    if (a && this.ready) {
      const key = a.M.clips.cocky ? "cocky" : a.M.clips.agreeing ? "agreeing" : null;
      if (key) a.play(key, { smooth: true });
    }
    if (notify && this.onPick) this.onPick(this.heroes[this.sel].id);
  }
  pickId(id) { const i = this.heroes.findIndex((h) => h.id === id); if (i >= 0) this.pick(i, false); }
  step(d) { this.pick(this.sel + d, true); }

  show(id) {
    if (id) { const i = this.heroes.findIndex((h) => h.id === id); if (i >= 0) this.sel = i; }
    this.visible = true;
    this.resize();
    if (this.ready) this.pick(this.sel, false);
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }
  hide() { this.visible = false; this.renderer.setAnimationLoop(null); }

  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now; this.t += dt;
    const k = 1 - Math.exp(-dt * 5);
    const portrait = this.aspect < 0.9;
    const n = this.heroes.length;
    this.actors.forEach((a, i) => {
      if (!a) return;
      const on = i === this.sel;
      const z = a.root.position.z + ((on ? 0.9 : -0.1) - a.root.position.z) * k;
      a.root.position.z = z;
      // turn toward the picked one a little, the picked one faces the camera
      const toward = on ? 0 : Math.sign(this.sel - i) * 0.35;
      a.root.rotation.y += (toward - a.root.rotation.y) * k;
      a.update(dt, 0);
      const ring = this.rings[i];
      ring.position.z = z;
      ring.material.opacity += ((on ? 0.95 : 0.22) - ring.material.opacity) * k;
      ring.scale.setScalar(on ? 1.1 + Math.sin(this.t * 3) * 0.05 : 1);
    });
    const sx = this.slotX(this.sel);
    // wide enough to show the whole row; eases toward the picked analyst
    const dist = portrait ? 11.5 : 7.0;
    const wantPos = new THREE.Vector3(sx * 0.35, portrait ? 1.5 : 1.2, dist - 1.1);
    const wantLook = new THREE.Vector3(sx * 0.45, 0.98, 0.3);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}
