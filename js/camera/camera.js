import * as mat4 from '../math/mat4.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Orbit camera around a target. The galaxy disk lies in the XZ plane (Y up).
 * pitch = elevation above the disk plane (90° would be exactly face-on).
 * Drag to orbit, wheel to zoom, double-click to reset.
 */
export class OrbitCamera {
  constructor(canvas, { distance = 26, yaw = 0, pitch = 60 * DEG, fov = 50 * DEG } = {}) {
    this.defaults = { distance, yaw, pitch };
    this.distance = distance;
    this.yaw = yaw;
    this.pitch = pitch;
    this.fov = fov;
    this.near = 0.05;
    this.far = 500;
    this.target = [0, 0, 0];

    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.viewProjRot = mat4.create();
    this._viewRot = mat4.create();

    this._attach(canvas);
  }

  reset() {
    Object.assign(this, this.defaults);
  }

  _attach(canvas) {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.yaw -= (e.clientX - lastX) * 0.005;
      this.pitch = clamp(this.pitch + (e.clientY - lastY) * 0.005, -1.5, 1.5);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const end = () => {
      dragging = false;
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = clamp(this.distance * Math.exp(e.deltaY * 0.001), 2, 150);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => this.reset());
  }

  update(aspect) {
    const cp = Math.cos(this.pitch);
    const eye = [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
    mat4.lookAt(this.view, eye, this.target, [0, 1, 0]);
    mat4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);

    this._viewRot.set(this.view);
    this._viewRot[12] = this._viewRot[13] = this._viewRot[14] = 0;
    mat4.multiply(this.viewProjRot, this.proj, this._viewRot);
  }

  /** Pixels per world unit at view distance 1, for a viewport of `heightPx`. */
  pointScale(heightPx) {
    return heightPx / (2 * Math.tan(this.fov / 2));
  }
}
