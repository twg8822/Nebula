import * as mat4 from '../math/mat4.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

const PITCH_LIMIT = 1.5;
const IDLE_SECONDS = 3;    // auto-orbit resumes after this long without input
const RAMP_SECONDS = 2.5;  // ease-in time for auto-orbit
const BREATH = 0.06;       // ± fraction of distance during auto-orbit

/**
 * Orbit camera around a target. The galaxy disk lies in the XZ plane (Y up).
 * pitch = elevation above the disk plane (90° would be exactly face-on).
 * Drag to orbit (with inertia), wheel to zoom, double-click to glide home.
 *
 * Input writes a *goal*; the shown view eases toward it each frame
 * (frame-rate independent). Cinematic mode advances the goal's yaw and adds a
 * swaying tilt and slow zoom "breathing", both scaled by a 0..1 blend so the
 * view never jumps when auto-orbit starts or stops.
 */
export class OrbitCamera {
  constructor(canvas, { distance = 26, yaw = 0, pitch = 20 * DEG, fov = 50 * DEG } = {}) {
    this.defaults = { distance, yaw, pitch };
    this.goal = { distance, yaw, pitch };
    // Smoothed values (before cinematic offsets) and final shown values.
    this.s = { distance, yaw, pitch };
    this.distance = distance;
    this.yaw = yaw;
    this.pitch = pitch;
    this.fov = fov;
    this.near = 0.05;
    this.far = 500;
    this.target = [0, 0, 0];
    this.targetGoal = [0, 0, 0];
    this.eye = [0, 0, distance];

    this._dragging = false;
    this._yawVel = 0;
    this._lastInput = -Infinity;
    this._autoRaw = 0;   // linear 0..1 ramp
    this._auto = 0;      // eased blend
    this._phase = 0;     // tilt/breath phase, only advances while auto
    this._tilt = 0;      // last-frame offsets, so input can fold them in
    this._breath = 0;

    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.viewProjRot = mat4.create();
    this._viewRot = mat4.create();

    this._attach(canvas);
  }

  /** Glide back to the default framing; auto-orbit resumes shortly after. */
  reset() {
    const d = this.defaults;
    this.goal.yaw = this.s.yaw + wrapPi(d.yaw - this.s.yaw);
    this.goal.pitch = d.pitch;
    this.goal.distance = d.distance;
    this._yawVel = 0;
    this._lastInput = performance.now() - (IDLE_SECONDS - 1) * 1000;
  }

  /** User took over: bake the cinematic offsets into the goal so nothing jumps. */
  _takeOver() {
    if (this._auto > 0) {
      this.goal.pitch = clamp(this.goal.pitch + this._tilt, -PITCH_LIMIT, PITCH_LIMIT);
      this.s.pitch = clamp(this.s.pitch + this._tilt, -PITCH_LIMIT, PITCH_LIMIT);
      this.goal.distance *= 1 + this._breath;
      this.s.distance *= 1 + this._breath;
    }
    this._autoRaw = this._auto = this._tilt = this._breath = 0;
    this._lastInput = performance.now();
  }

  _attach(canvas) {
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;

    canvas.addEventListener('pointerdown', (e) => {
      this._takeOver();
      this._dragging = true;
      this._yawVel = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dYaw = -(e.clientX - lastX) * 0.005;
      this.goal.yaw += dYaw;
      this.goal.pitch = clamp(this.goal.pitch + (e.clientY - lastY) * 0.005, -PITCH_LIMIT, PITCH_LIMIT);
      const dts = Math.max(1, e.timeStamp - lastT) / 1000;
      this._yawVel = 0.5 * this._yawVel + 0.5 * (dYaw / dts);
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
      this._lastInput = performance.now();
    });
    const end = (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      // Held still before letting go: no fling.
      if (e.timeStamp - lastT > 80) this._yawVel = 0;
      this._lastInput = performance.now();
      canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._takeOver();
      this.goal.distance = clamp(this.goal.distance * Math.exp(e.deltaY * 0.001), 2, 150);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => this.reset());
  }

  /**
   * @param {number} aspect
   * @param {number} dt  real seconds since last frame (keeps running while paused)
   * @param {{auto?: boolean, orbitSpeed?: number, tilt?: number}} opts  tilt in radians
   */
  update(aspect, dt = 0, { auto = false, orbitSpeed = 0, tilt = 0 } = {}) {
    const { goal, s } = this;

    // Fling inertia after a drag.
    if (!this._dragging && this._yawVel !== 0) {
      goal.yaw += this._yawVel * dt;
      this._yawVel *= Math.exp(-dt * 4);
      if (Math.abs(this._yawVel) < 1e-3) this._yawVel = 0;
    }

    // Cinematic blend: ramps in after an idle period, out when toggled off.
    const idle = (performance.now() - this._lastInput) / 1000;
    const want = auto && !this._dragging && idle > IDLE_SECONDS;
    this._autoRaw = clamp(this._autoRaw + (want ? dt / RAMP_SECONDS : -dt / 1.5), 0, 1);
    this._auto = smoothstep(this._autoRaw);
    const A = this._auto;
    goal.yaw += orbitSpeed * A * dt;
    this._phase += dt * A * 0.22;

    // Ease shown values toward the goal.
    const k = 1 - Math.exp(-dt * 8);
    s.yaw += (goal.yaw - s.yaw) * k;
    s.pitch += (goal.pitch - s.pitch) * k;
    s.distance += (goal.distance - s.distance) * k;
    const kt = 1 - Math.exp(-dt * 1.5);
    for (let i = 0; i < 3; i++) this.target[i] += (this.targetGoal[i] - this.target[i]) * kt;

    this._tilt = A * tilt * Math.sin(this._phase);
    this._breath = A * BREATH * Math.sin(this._phase * 0.6);
    this.yaw = s.yaw;
    this.pitch = clamp(s.pitch + this._tilt, -PITCH_LIMIT, PITCH_LIMIT);
    this.distance = s.distance * (1 + this._breath);

    const cp = Math.cos(this.pitch);
    const eye = this.eye;
    eye[0] = this.target[0] + this.distance * cp * Math.sin(this.yaw);
    eye[1] = this.target[1] + this.distance * Math.sin(this.pitch);
    eye[2] = this.target[2] + this.distance * cp * Math.cos(this.yaw);
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
