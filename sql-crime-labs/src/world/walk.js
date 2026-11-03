// Walk mode: WASD / arrows / touch stick move the analyst around the lab, drag to look, wheel to zoom.
// The follow camera is the Orbit camera driven directly (so sitting down at the desk can hand over smoothly).
// Interaction: stand near something and press E (or tap the Use button).
import * as THREE from "three";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const turnTo = (cur, target, k) => cur + Math.atan2(Math.sin(target - cur), Math.cos(target - cur)) * Math.min(1, k);

export const WALK = 2.3;
export const RUN = 4.6;

export class Walker {
  constructor(dom, orbit, crew, hooks = {}) {
    this.dom = dom;
    this.orbit = orbit;
    this.crew = crew;
    this.onNear = hooks.onNear || (() => {});
    this.onUse = hooks.onUse || (() => {});
    this.enabled = false;   // input on
    this.locked = false;    // the crew is moving the analyst (sitting down / standing up)
    this.x = 0; this.z = 15; this.yaw = Math.PI; this.speed = 0;
    this.camYaw = Math.PI; this.camPitch = 0.3; this.camDist = 4.4;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.auto = null;
    this.near = null;
    this.drag = new Map();
    this.bound = 25.3;

    addEventListener("keydown", (e) => {
      if (!this.enabled || e.repeat) return;
      const t = e.target && e.target.tagName;
      if (t === "TEXTAREA" || t === "INPUT") return;
      this.keys.add(e.code);
      if (e.code === "KeyE" || e.code === "KeyF" || e.code === "Enter") this.use();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
    dom.addEventListener("pointerdown", (e) => { this.drag.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    dom.addEventListener("pointermove", (e) => {
      const p = this.drag.get(e.pointerId);
      if (!p) return;
      if (this.enabled && !this.locked && this.drag.size === 1) {
        this.camYaw -= (e.clientX - p.x) * 0.0055;
        this.camPitch = clamp(this.camPitch + (e.clientY - p.y) * 0.0045, -0.1, 1.05);
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => this.drag.delete(e.pointerId);
    dom.addEventListener("pointerup", up);
    dom.addEventListener("pointercancel", up);
    dom.addEventListener("wheel", (e) => { if (this.enabled) this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.4, 2.4, 9); }, { passive: true });
  }

  use() { if (this.enabled && !this.locked && !this.auto && this.near) this.onUse(this.near); }

  // Walk to a spot (ignoring furniture), then turn to face yaw. Resolves on arrival.
  goTo(x, z, yaw) {
    return new Promise((res) => { this.auto = { x, z, yaw, res, settle: 0 }; });
  }

  // Put the analyst (and the camera behind them) at a spot.
  place(x, z, yaw, look) {
    this.x = x; this.z = z; this.yaw = yaw; this.speed = 0;
    this.camYaw = look === undefined ? yaw : look;
  }

  update(dt, time) {
    const a = this.crew.hero;
    if (!a) return;
    const o = this.orbit;
    if (this.locked) {
      const p = a.root.position;
      this.x = p.x; this.z = p.z; this.yaw = a.root.rotation.y; this.speed = 0;
    } else if (this.auto) {
      const g = this.auto;
      const dx = g.x - this.x, dz = g.z - this.z, d = Math.hypot(dx, dz);
      if (d > 0.06) {
        const step = Math.min(d, 2.0 * dt);
        this.x += dx / d * step; this.z += dz / d * step;
        this.yaw = turnTo(this.yaw, Math.atan2(dx, dz), dt * 10);
        this.speed = 2.0;
      } else {
        this.speed = 0;
        this.yaw = turnTo(this.yaw, g.yaw, dt * 9);
        g.settle += dt;
        if (g.settle > 0.3 && Math.abs(Math.atan2(Math.sin(g.yaw - this.yaw), Math.cos(g.yaw - this.yaw))) < 0.05) { this.auto = null; g.res(); }
      }
    } else if (this.enabled) {
      let fx = 0, fz = 0;
      const k = this.keys;
      if (k.has("KeyW") || k.has("ArrowUp")) fz += 1;
      if (k.has("KeyS") || k.has("ArrowDown")) fz -= 1;
      if (k.has("KeyA") || k.has("ArrowLeft")) fx += 1;
      if (k.has("KeyD") || k.has("ArrowRight")) fx -= 1;
      let mag = 1;
      const sm = Math.hypot(this.stick.x, this.stick.y);
      if (sm > 0.12) { fx = -this.stick.x; fz = -this.stick.y; mag = Math.min(1, sm); }
      const run = k.has("ShiftLeft") || k.has("ShiftRight") || sm > 0.85;
      const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
      let dx = sy * fz + cy * fx, dz = cy * fz - sy * fx;
      const len = Math.hypot(dx, dz);
      const want = len > 0.05 ? (run ? RUN : WALK) * (sm > 0.12 && !run ? Math.max(0.5, mag) : 1) : 0;
      this.speed += (want - this.speed) * Math.min(1, dt * 9);
      if (len > 0.05) {
        dx /= len; dz /= len;
        this.yaw = turnTo(this.yaw, Math.atan2(dx, dz), dt * 11);
        const p = this.crew.collide(this.x + dx * this.speed * dt, this.z + dz * this.speed * dt);
        this.x = clamp(p.x, -this.bound, this.bound);
        this.z = clamp(p.z, -this.bound, this.bound);
      }
    } else {
      this.speed *= Math.max(0, 1 - dt * 9);
    }
    if (!this.locked) {
      a.root.position.set(this.x, 0, this.z);
      a.root.rotation.y = this.yaw;
    }
    this.crew.heroSpeed = this.speed;

    // what's in reach
    let best = null, bd = 1e9;
    if (this.enabled && !this.locked && !this.auto) {
      for (const it of this.crew.interactables()) {
        const d = Math.hypot(it.x - this.x, it.z - this.z);
        if (d < it.r && d < bd) { best = it; bd = d; }
      }
    }
    if ((best && best.id) !== (this.near && this.near.id)) { this.near = best; this.onNear(best); } else this.near = best;

    // the follow camera: the orbit, driven directly
    o.rate = Math.min(14, o.rate + dt * 16);
    o.lastInput = time;
    o.goalTarget.set(this.x, 1.45, this.z);
    o.goalRadius = this.camDist;
    o.goalPhi = Math.PI / 2 - this.camPitch;
    o.goalTheta = this.camYaw + Math.PI;
    o.baseTheta = o.goalTheta;
  }

  // After the orbit has moved the camera: keep it inside the room.
  afterCamera() {
    const c = this.orbit.camera, b = this.bound + 0.4;
    c.position.set(clamp(c.position.x, -b, b), clamp(c.position.y, 0.5, 10.2), clamp(c.position.z, -b, b));
    c.lookAt(this.orbit.target);
  }

  // Start following from wherever the orbit camera is now (no jump): glide in.
  takeCamera() {
    const o = this.orbit;
    o.rate = 2.6;
    this.camYaw = o.theta - Math.PI;
    this.camPitch = clamp(Math.PI / 2 - o.phi, -0.1, 1.05);
  }
}
