// Galaxy collision: restricted N-body on the CPU.
//
// Every particle (stars, haze, dust of both galaxies) is a massless test
// particle feeding two moving potentials:
//   host       logarithmic halo  Φ = ½ v0² ln(d² + rc²)
//              -> circular speed v0·d/√(d²+rc²), exactly the rotation curve the
//                 analytic mode uses (js/galaxy/rotation.js), so the disk
//                 starts in equilibrium and doesn't drift before the encounter.
//   companion  Plummer sphere     Φ = -M / √(d² + a²)
// The two cores attract each other. Gravity constant G = 1.
// Integrator: leapfrog (kick-drift-kick), substepped.

import { generateGalaxy } from './generator.js';
import { angularVelocity } from './rotation.js';
import { createRng } from '../math/random.js';

const DEG = Math.PI / 180;
const LEAD_TIME = 40;      // sim time from the start to closest approach
const PERI_SPEED = 1.4;    // × v0 at pericenter: a bound, elongated orbit
const MAX_SUBSTEP = 0.05;
const MAX_SUBSTEPS = 4;

function concat(a, b) {
  const data = new Float32Array(a.data.length + b.data.length);
  data.set(a.data);
  data.set(b.data, a.data.length);
  return { data, count: a.count + b.count };
}

/** Rotate a vector in place: about X by ax, then about Y by ay. */
function rotate(v, o, ax, ay) {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  const x = v[o], y0 = v[o + 1], z0 = v[o + 2];
  const y = y0 * cx - z0 * sx;
  const z = y0 * sx + z0 * cx;
  v[o] = x * cy + z * sy;
  v[o + 1] = y;
  v[o + 2] = -x * sy + z * cy;
}

export class CollisionSim {
  /**
   * @param cfg   live config
   * @param host  generateGalaxy(cfg) result for the host
   * @param t0    analytic galaxy time at the switch, so the host doesn't jump
   */
  constructor(cfg, host, t0) {
    const q = cfg.companionMass;
    const R = cfg.galaxyRadius;
    const v0 = cfg.v0;
    const rc = cfg.rc;
    const sq = Math.sqrt(q);
    this.q = q;
    this.R = R;
    this.mass = q * v0 * v0 * R;            // host's enclosed mass at R is ≈ v0²R
    const compR = R * sq;
    this.soft = 0.35 * compR;               // Plummer scale length
    this.companionBulge = cfg.bulgeRadius * sq;

    const comp = generateGalaxy({
      ...cfg,
      seed: (cfg.seed + 7919) % 1000000,
      starCount: Math.max(1000, Math.round(cfg.starCount * q)),
      galaxyRadius: compR,
      diskScale: cfg.diskScale * sq,
      bulgeRadius: this.companionBulge,
      armCount: 2,
      dustFraction: cfg.dustFraction * 0.5,
    });

    // Combined per-layer data: host particles first, then companion.
    this.layers = {};
    const counts = {};
    for (const k of ['stars', 'haze', 'dust']) {
      this.layers[k] = concat(host[k], comp[k]);
      counts[k] = [host[k].count, comp[k].count];
    }
    const total = Object.values(this.layers).reduce((n, l) => n + l.count, 0);
    this.pos = new Float32Array(total * 3);
    this.vel = new Float32Array(total * 3);
    this.ranges = {};

    // ---- core orbit: set at pericenter, then run backward LEAD_TIME ----
    const rp = cfg.pericenter * R;
    const vp = PERI_SPEED * Math.max(v0, 0.05);
    const inc = cfg.encounterTilt * DEG;
    // Relative orbit in the disk plane with angular momentum along -Y (the same
    // sense as the host's rotation, i.e. prograde), then inclined about X.
    const H = [0, 0, 0], HV = [0, 0, 0];
    const C = [rp, 0, 0], CV = [0, 0, vp];
    rotate(C, 0, inc, 0.6);
    rotate(CV, 0, inc, 0.6);
    this.H = H; this.HV = HV; this.C = C; this.CV = CV;
    const back = Math.ceil(LEAD_TIME / 0.02);
    for (let i = 0; i < back; i++) this._stepCores(-0.02, v0, rc);
    // Re-centre on the host core at rest (a Galilean shift; forces only depend
    // on separations).
    for (let i = 0; i < 3; i++) {
      C[i] -= H[i]; CV[i] -= HV[i];
      H[i] = 0; HV[i] = 0;
    }

    // ---- particles ----
    const rng = createRng(cfg.seed ^ 0x51f15e);
    const patternSpeed = angularVelocity(cfg.corotation * R, v0, rc);
    let base = 0;
    for (const k of ['stars', 'haze', 'dust']) {
      const { data } = this.layers[k];
      const [nHost, nComp] = counts[k];
      this.ranges[k] = [base, base + nHost + nComp];
      for (let i = 0; i < nHost + nComp; i++) {
        const isHost = i < nHost;
        const e = i * 9;
        const r = data[e], h = data[e + 2], lock = data[e + 8];
        // Host keeps its current analytic angle so the switch is seamless.
        const th = isHost
          ? data[e + 1] + (angularVelocity(r, v0, rc) + (patternSpeed - angularVelocity(r, v0, rc))
            * Math.min(1, lock * cfg.armLock)) * t0
          : data[e + 1];
        const o = (base + i) * 3;
        const p = this.pos, v = this.vel;
        p[o] = r * Math.cos(th); p[o + 1] = h; p[o + 2] = r * Math.sin(th);
        const s = Math.hypot(r, h);

        // Circular-orbit velocity. Thin-disk particles orbit in the plane
        // (angular momentum -Y); puffy ones (bulge, halo) on randomly tilted
        // circles so they keep a rounded shape instead of collapsing.
        let nx = 0, ny = -1, nz = 0;
        let speed;
        const puffy = Math.abs(h) > 0.5 * Math.max(r, 0.3);
        if (puffy) {
          nx = rng.gauss(); ny = rng.gauss() - 1.2; nz = rng.gauss();
        }
        if (isHost) {
          speed = puffy ? v0 * s / Math.sqrt(s * s + rc * rc) : v0 * r / Math.sqrt(s * s + rc * rc);
        } else {
          speed = Math.sqrt(this.mass) * (puffy ? s : r) / Math.pow(s * s + this.soft * this.soft, 0.75);
        }
        // direction = n × p
        let dx = ny * p[o + 2] - nz * p[o + 1];
        let dy = nz * p[o] - nx * p[o + 2];
        let dz = nx * p[o + 1] - ny * p[o];
        const dl = Math.hypot(dx, dy, dz) || 1;
        v[o] = (dx / dl) * speed; v[o + 1] = (dy / dl) * speed; v[o + 2] = (dz / dl) * speed;

        if (!isHost) {
          // Tilt the companion's disk so it reads as a separate galaxy, then
          // place it on its orbit.
          rotate(p, o, 55 * DEG, 30 * DEG);
          rotate(v, o, 55 * DEG, 30 * DEG);
          for (let j = 0; j < 3; j++) { p[o + j] += C[j]; v[o + j] += CV[j]; }
        }
      }
      base += nHost + nComp;
    }
  }

  /** Accelerations of the two cores on each other (+ gentle dynamical friction). */
  _coreAccel(v0, rc) {
    const { H, C, HV, CV } = this;
    const dx = C[0] - H[0], dy = C[1] - H[1], dz = C[2] - H[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const fc = -v0 * v0 / (d2 + rc * rc);                         // companion in host halo
    const inv = 1 / Math.sqrt(d2 + this.soft * this.soft);
    const fh = this.mass * inv * inv * inv;                       // host toward companion
    // Friction on the relative velocity near the host, so passes slowly decay.
    const R2 = d2 / (2.25 * this.R * this.R);
    const fr = 0.04 * this.q * Math.exp(-R2);
    return {
      ac: [fc * dx - fr * (CV[0] - HV[0]), fc * dy - fr * (CV[1] - HV[1]), fc * dz - fr * (CV[2] - HV[2])],
      ah: [fh * dx, fh * dy, fh * dz],
    };
  }

  _stepCores(dt, v0, rc) {
    const { H, C, HV, CV } = this;
    let { ac, ah } = this._coreAccel(v0, rc);
    for (let i = 0; i < 3; i++) { CV[i] += ac[i] * dt / 2; HV[i] += ah[i] * dt / 2; }
    for (let i = 0; i < 3; i++) { C[i] += CV[i] * dt; H[i] += HV[i] * dt; }
    ({ ac, ah } = this._coreAccel(v0, rc));
    for (let i = 0; i < 3; i++) { CV[i] += ac[i] * dt / 2; HV[i] += ah[i] * dt / 2; }
  }

  /** Half-kick every particle by the field of the cores at their current positions. */
  _kick(dt, v0, rc) {
    const { pos: p, vel: v, H, C } = this;
    const v02 = v0 * v0, rc2 = rc * rc, a2 = this.soft * this.soft, M = this.mass;
    const hx = H[0], hy = H[1], hz = H[2], cx = C[0], cy = C[1], cz = C[2];
    for (let o = 0, n = p.length; o < n; o += 3) {
      const x = p[o], y = p[o + 1], z = p[o + 2];
      const dx = x - hx, dy = y - hy, dz = z - hz;
      const fh = -v02 / (dx * dx + dy * dy + dz * dz + rc2) * dt;
      const ex = x - cx, ey = y - cy, ez = z - cz;
      const inv = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez + a2);
      const fc = -M * inv * inv * inv * dt;
      v[o] += fh * dx + fc * ex;
      v[o + 1] += fh * dy + fc * ey;
      v[o + 2] += fh * dz + fc * ez;
    }
  }

  /** Advance by dtau sim-time units. */
  step(dtau, cfg) {
    if (!(dtau > 0)) return;
    const n = Math.min(MAX_SUBSTEPS, Math.ceil(dtau / MAX_SUBSTEP));
    const h = Math.min(dtau, MAX_SUBSTEP * MAX_SUBSTEPS) / n;
    const { v0, rc } = cfg;
    const { pos: p, vel: v } = this;
    for (let s = 0; s < n; s++) {
      this._kick(h / 2, v0, rc);
      for (let o = 0, len = p.length; o < len; o++) p[o] += v[o] * h;
      this._stepCores(h, v0, rc);
      this._kick(h / 2, v0, rc);
    }
  }

  /** Positions for one layer, laid out for StarLayer.setPositions. */
  positions(layer) {
    const [a, b] = this.ranges[layer];
    return this.pos.subarray(a * 3, b * 3);
  }

  /** Mass-weighted midpoint of the two cores (a calm camera target). */
  focus() {
    const { H, C, q } = this;
    return [0, 1, 2].map((i) => (H[i] + q * C[i]) / (1 + q));
  }
}
