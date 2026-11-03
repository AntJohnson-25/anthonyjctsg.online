// Orbit camera: drag to rotate, wheel or pinch to zoom, gentle sway when nobody is touching it,
// and smooth fly-to moves when the view changes.
import * as THREE from "three";

export class Orbit {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 1, -4);
    this.goalTarget = this.target.clone();
    this.radius = this.goalRadius = 27;
    this.phi = this.goalPhi = 1.08;
    this.theta = this.goalTheta = 0;
    this.baseTheta = 0;
    this.rate = 2.6;     // how fast the camera chases its goals (the walk camera raises it)
    this.lastInput = -1e9;
    this.now = 0;
    this.pointers = new Map();
    this.pinch = 0;

    dom.addEventListener("pointerdown", (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInput = this.now;
    });
    dom.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        this.goalTheta -= dx * 0.006;
        this.goalPhi = clamp(this.goalPhi - dy * 0.005, 0.32, 1.42);
        this.baseTheta = this.goalTheta;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 2) {
        const [a, b] = Array.from(this.pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.goalRadius = clamp(this.goalRadius * this.pinch / d, 7, 46);
        this.pinch = d;
      }
      this.lastInput = this.now;
    });
    const up = (e) => { this.pointers.delete(e.pointerId); this.pinch = 0; };
    dom.addEventListener("pointerup", up);
    dom.addEventListener("pointercancel", up);
    dom.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.goalRadius = clamp(this.goalRadius * Math.exp(e.deltaY * 0.0012), 7, 46);
      this.lastInput = this.now;
    }, { passive: false });
  }

  flyTo(target, radius, phi, theta) {
    this.goalTarget.copy(target);
    this.goalRadius = radius;
    if (phi !== undefined) this.goalPhi = phi;
    if (theta !== undefined) { this.goalTheta = theta; this.baseTheta = theta; }
  }

  update(dt, time) {
    this.now = time;
    if (time - this.lastInput > 6) this.goalTheta = this.baseTheta + Math.sin(time * 0.11) * 0.22;
    const k = 1 - Math.exp(-dt * this.rate);
    this.target.lerp(this.goalTarget, k);
    this.radius += (this.goalRadius - this.radius) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    this.theta += (this.goalTheta - this.theta) * Math.min(1, k * 1.6);
    const s = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * s * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * s * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
