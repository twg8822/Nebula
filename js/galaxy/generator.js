import { createRng } from '../math/random.js';
import { spiralArm } from '../../src/math.js';

// Per-particle layout (9 floats):
//   r, theta0, height, worldSize, red, green, blue, brightness, lock
// The same layout is used for stars, haze (additive glow) and dust (absorption,
// where rgb = per-channel absorption tint and brightness = opacity).
//
// lock (0..1) blends a particle's angular speed from its own orbital Ω(r)
// (0 = free differential rotation) toward the spiral pattern speed Ωp
// (1 = rides with the arms). Arm tracers (young stars, knots, dust, arm haze)
// are short-lived in real galaxies, so they stay locked to the density wave;
// that's what keeps arms from winding into concentric rings.
export const STAR_STRIDE = 9;

const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const LOCK = { free: 0, oldArm: 0.8, arm: 1 };

/** Sample r from an exponential disk profile truncated to [rMin, rMax]. */
function sampleExpDisk(rng, scale, rMin, rMax) {
  const a = Math.exp(-rMin / scale);
  const b = Math.exp(-rMax / scale);
  return -scale * Math.log(a - rng.next() * (a - b));
}

/** Growable Float32Array of particles. */
class ParticleBuffer {
  constructor(capacity) {
    this.data = new Float32Array(Math.max(1, capacity) * STAR_STRIDE);
    this.count = 0;
  }

  push(r, theta, h, size, cr, cg, cb, bright, lock) {
    let o = this.count * STAR_STRIDE;
    if (o + STAR_STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    d[o++] = r; d[o++] = theta; d[o++] = h; d[o++] = size;
    d[o++] = cr; d[o++] = cg; d[o++] = cb; d[o++] = bright;
    d[o] = lock;
    this.count++;
  }

  finish() {
    return { data: this.data.subarray(0, this.count * STAR_STRIDE), count: this.count };
  }
}

/**
 * Build orbital elements for every particle. Positions are not stored; the
 * vertex shader derives them from (r, theta0, height, lock) and time.
 *
 * Returns { stars, haze, dust }, each { data, count }.
 */
export function generateGalaxy(cfg) {
  const rng = createRng(cfg.seed);
  const n = Math.max(0, Math.floor(cfg.starCount));
  const R = cfg.galaxyRadius;

  const stars = new ParticleBuffer(n);
  const haze = new ParticleBuffer(Math.ceil(n * 0.08));
  const dust = new ParticleBuffer(Math.ceil(n * cfg.dustFraction));

  // Arms trail the rotation: θ decreases with r.
  const arms = Math.max(1, Math.round(cfg.armCount));
  const armPhase = rng.next() * TAU;
  const armTheta = spiralArm(cfg.armCount, cfg.pitchDeg, armPhase);
  // Angular half-width (σ) of an arm at radius r.
  const armSigma = (r) => cfg.armSpread * (0.6 + 0.6 * (r / R));
  const pickArm = () => Math.floor(rng.next() * arms);
  // Disk scale height, flaring gently outward.
  const diskH = (x) => cfg.diskThickness * (0.8 + 0.5 * x);

  const nBulge = Math.round(n * cfg.bulgeFraction);
  const nField = Math.round(n * cfg.fieldFraction);
  const nHalo = Math.round(n * cfg.haloFraction);
  const nArm = Math.max(0, n - nBulge - nField - nHalo);
  const rMinArm = cfg.bulgeRadius * 0.5;

  // ---------------------------------------------------------------- arms
  let remaining = nArm;
  while (remaining > 0) {
    const r0 = sampleExpDisk(rng, cfg.diskScale, rMinArm, R);
    const x = r0 / R;
    const arm = pickArm();
    const sig = armSigma(r0);
    const base = armTheta(r0, arm);

    // Star-forming knot: a small cluster of pink stars plus a soft pink glow,
    // sitting on the arm ridge, mostly in the outer disk.
    if (x > 0.22 && rng.next() < cfg.knotRate) {
      const members = Math.min(remaining, 4 + Math.floor(rng.next() * 7));
      const th0 = base + (0.15 + 0.3 * rng.gauss()) * sig;
      const h0 = rng.gauss() * diskH(x) * 0.25;
      for (let m = 0; m < members; m++) {
        const rr = Math.max(0.05, r0 + rng.gauss() * 0.06);
        stars.push(rr, th0 + (rng.gauss() * 0.06) / rr, h0 + rng.gauss() * 0.02,
          rng.range(0.025, 0.045),
          1.0, rng.range(0.32, 0.45), rng.range(0.5, 0.65), rng.range(0.6, 1.4),
          LOCK.arm);
      }
      haze.push(r0, th0, h0, rng.range(0.22, 0.38), 1.0, 0.35, 0.55, rng.range(0.14, 0.24), LOCK.arm);
      remaining -= members;
      continue;
    }

    const r = Math.max(0.05, r0 + rng.gauss() * 0.1);

    // Young hot stars: concentrated toward the outer arms, tight on the ridge,
    // nudged slightly downstream of the dust lane.
    const pYoung = cfg.youngFraction * (0.12 + 0.88 * smoothstep(0.2, 0.75, x));
    if (rng.next() < pYoung) {
      const t = rng.next();
      stars.push(r, base + (0.25 + 0.45 * rng.gauss()) * sig, rng.gauss() * diskH(x) * 0.4,
        rng.range(0.03, 0.05),
        mix(0.55, 0.82, t), mix(0.7, 0.88, t), 1.0,
        rng.range(0.7, 1.8),
        LOCK.arm);
    } else {
      // Older disk population: warm in the inner disk and between arms,
      // neutral white further out on the arms.
      const g = rng.gauss();
      const warmth = clamp01(1 - smoothstep(0.05, 0.6, x) + Math.abs(g) / 3);
      stars.push(r, base + g * sig * 1.2, rng.gauss() * diskH(x),
        rng.range(0.022, 0.038),
        mix(0.9, 1.0, warmth), mix(0.92, 0.8, warmth), mix(1.0, 0.58, warmth),
        0.12 + 0.4 * Math.pow(rng.next(), 2),
        LOCK.oldArm);
    }
    remaining--;
  }

  // ---------------------------------------------------------------- bulge
  // Two gaussian scales give a cuspy, smoothly fading, nearly round bulge.
  for (let k = 0; k < nBulge; k++) {
    const s = cfg.bulgeRadius * (rng.next() < 0.5 ? 0.3 : 0.65);
    const px = rng.gauss() * s;
    const pz = rng.gauss() * s;
    const py = rng.gauss() * s * 0.85;
    const t = smoothstep(0, 1.2, Math.hypot(px, py, pz) / cfg.bulgeRadius);
    stars.push(Math.hypot(px, pz), Math.atan2(pz, px), py,
      rng.range(0.022, 0.04),
      1.0, mix(0.7, 0.86, t), mix(0.4, 0.64, t),
      mix(0.7, 0.25, t) * rng.range(0.6, 1.0),
      LOCK.free);
  }

  // ---------------------------------------------------------------- field
  // Diffuse thick disk between the arms.
  for (let k = 0; k < nField; k++) {
    const r = sampleExpDisk(rng, cfg.diskScale * 1.1, cfg.bulgeRadius * 0.3, R * 1.1);
    const warm = rng.next();
    stars.push(r, rng.next() * TAU, rng.gauss() * diskH(r / R) * 2.5,
      rng.range(0.02, 0.035),
      1.0, mix(0.92, 0.82, warm), mix(0.88, 0.66, warm),
      rng.range(0.08, 0.25),
      LOCK.free);
  }

  // ---------------------------------------------------------------- halo
  // Sparse spherical population of old stars: gives the galaxy volume when
  // seen from a low angle.
  for (let k = 0; k < nHalo; k++) {
    const d = sampleExpDisk(rng, R * 0.3, cfg.bulgeRadius * 0.5, R * 1.2);
    const cosT = rng.range(-1, 1);
    const sinT = Math.sqrt(1 - cosT * cosT);
    stars.push(d * sinT, rng.next() * TAU, d * cosT,
      rng.range(0.02, 0.032),
      1.0, rng.range(0.82, 0.9), rng.range(0.62, 0.74),
      rng.range(0.06, 0.18),
      LOCK.free);
  }

  // ---------------------------------------------------------------- haze
  // Large faint sprites standing in for unresolved starlight: blue along the
  // outer arms, dimmer and warmer inward so the center stays crisp.
  const nArmHaze = Math.round(n * 0.05);
  for (let k = 0; k < nArmHaze; k++) {
    const r = sampleExpDisk(rng, cfg.diskScale, rMinArm, R);
    const x = r / R;
    const t = smoothstep(0.15, 0.7, x);
    haze.push(r, armTheta(r, pickArm()) + rng.gauss() * 0.6 * armSigma(r),
      rng.gauss() * diskH(x) * 0.5,
      rng.range(0.5, 0.9) * (0.6 + 0.6 * x),
      mix(1.0, 0.62, t), mix(0.84, 0.74, t), mix(0.62, 1.0, t),
      rng.range(0.03, 0.06) * (0.4 + 0.6 * t),
      LOCK.arm);
  }
  const nDiskHaze = Math.round(n * 0.015);
  for (let k = 0; k < nDiskHaze; k++) {
    const r = sampleExpDisk(rng, cfg.diskScale * 0.6, cfg.bulgeRadius * 0.6, R * 0.7);
    haze.push(r, rng.next() * TAU, rng.gauss() * diskH(r / R),
      rng.range(0.5, 0.9),
      1.0, 0.82, 0.6,
      rng.range(0.012, 0.025),
      LOCK.free);
  }

  // ---------------------------------------------------------------- dust
  // rgb is the absorption tint: blue is absorbed more than red, so lane edges
  // redden. Dust fades out toward the center so the core stays clean.
  const nDust = Math.round(n * cfg.dustFraction);
  const nLane = Math.round(nDust * 0.65);
  const DR = 0.62, DG = 0.8, DB = 1.0;
  const dustFade = (r) => smoothstep(0.12, 0.3, r / R);

  // Lanes: hug the inner edge of each arm.
  for (let k = 0; k < nLane; k++) {
    const r = sampleExpDisk(rng, cfg.diskScale * 1.2, cfg.bulgeRadius * 0.7, R * 0.95);
    const x = r / R;
    const sig = armSigma(r);
    dust.push(r, armTheta(r, pickArm()) - (0.9 + 0.25 * rng.gauss()) * sig,
      rng.gauss() * diskH(x) * 0.2,
      rng.range(0.22, 0.4) * (0.7 + 0.5 * x),
      DR, DG, DB, rng.range(0.1, 0.2) * dustFade(r),
      LOCK.arm);
  }

  // Wisps: thin strands starting at the inner edge, some trailing along it and
  // some feathering outward across the arm at a steeper pitch.
  let wispBudget = nDust - nLane;
  while (wispBudget > 0) {
    let r = sampleExpDisk(rng, cfg.diskScale * 1.2, cfg.bulgeRadius, R * 0.85);
    const arm = pickArm();
    let th = armTheta(r, arm) - (0.7 + 0.3 * rng.gauss()) * armSigma(r);
    const len = Math.min(wispBudget, 12 + Math.floor(rng.next() * 20));
    const pitch = rng.range(20, 50) * (Math.PI / 180);
    const dr = rng.range(0.04, 0.08);
    const h = rng.gauss() * diskH(r / R) * 0.15;
    for (let j = 0; j < len; j++) {
      r += dr;
      th += -dr / (r * Math.tan(pitch)) + rng.gauss() * 0.004;
      dust.push(r, th, h, rng.range(0.12, 0.22),
        DR, DG, DB, rng.range(0.06, 0.12) * (1 - j / len) * dustFade(r),
        LOCK.arm);
    }
    wispBudget -= len;
  }

  return { stars: stars.finish(), haze: haze.finish(), dust: dust.finish() };
}
