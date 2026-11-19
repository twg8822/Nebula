// NEBULA's pure math: no DOM, no WebGL, no state. The app imports it
// (through js/math/random.js, js/galaxy/rotation.js, js/galaxy/generator.js,
// js/galaxy/collision.js and js/render/compositor.js), and tests/math.test.js
// covers it with Node's built-in test runner (`node --test`).
//
// The GLSL shaders can't import JavaScript, so a few formulas live twice:
//   orbitAngle / diskPosition  <->  STAR_VS in js/shaders/stars.js
//   temperatureTint            <->  temperatureTint() in js/shaders/composite.js
// The tests check the shader constants still match.

export const TAU = Math.PI * 2;

// ------------------------------------------------------------- seeded random
// Every galaxy is reproducible from its seed.

/** mulberry32: a fast 32-bit seeded PRNG. Returns next() -> [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded generator with uniform, ranged and normal (gaussian) samples. */
export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    /** Standard normal sample (Box–Muller). */
    gauss() {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

// ------------------------------------------------------------ rotation curve
//   v(r) = v0 * r / sqrt(r² + rc²)   (rises linearly, then flattens)
//   Ω(r) = v(r) / r = v0 / sqrt(r² + rc²)
// Ω decreases with r, so inner stars lap outer ones and arms wind (trail).

/** Angular velocity Ω(r) in radians per time unit. */
export function angularVelocity(r, v0, rc) {
  return v0 / Math.sqrt(r * r + rc * rc);
}

/** Orbital (circular) speed v(r) = r·Ω(r). */
export function circularSpeed(r, v0, rc) {
  return r * angularVelocity(r, v0, rc);
}

/**
 * Angle of an orbiting particle after time t. lockBlend 0 = its own orbit Ω,
 * 1 = rides the spiral pattern at patternSpeed (see "winding problem" in CLAUDE.md).
 */
export function orbitAngle(theta0, omega, patternSpeed, lockBlend, t) {
  return theta0 + (omega + (patternSpeed - omega) * lockBlend) * t;
}

// ---------------------------------------------------------------- spiral arms

/**
 * Logarithmic spiral arms. Returns armAngle(r, arm): the angle of arm number
 * `arm` (0 … armCount-1) at radius r. Arms trail the rotation, so the angle
 * falls as r grows; pitchDeg is the pitch angle (small = tightly wound).
 */
export function spiralArm(armCount, pitchDeg, phase = 0) {
  const arms = Math.max(1, Math.round(armCount));
  const invTanPitch = 1 / Math.tan((pitchDeg * Math.PI) / 180);
  return (r, arm) => phase + (arm * TAU) / arms - Math.log(r) * invTanPitch;
}

/** World position [x, y, z] of a disk particle: the disk lies in XZ, Y is up. */
export function diskPosition(r, theta, height) {
  return [r * Math.cos(theta), height, r * Math.sin(theta)];
}

// ------------------------------------------------------------- looping clips
// A wallpaper clip should loop without a visible jump. The arms are evenly
// spaced, so the arm pattern looks the same after turning 1/armCount of a
// revolution: nudge the galaxy's speed so the pattern turns a whole number
// of arm spacings during the clip, then cross-fade the last moments into the
// start to hide the individual stars that don't line up.

/**
 * Speed multiplier for a seamless loop. patternRate is the arm pattern's
 * angular speed in radians per clip second; after scaling, the pattern turns
 * exactly k · 2π/arms in `seconds` (k ≥ 1, the nearest whole number of arm
 * spacings). Returns 1 when the galaxy doesn't rotate.
 */
export function loopSpeedScale(patternRate, seconds, armCount) {
  const turn = patternRate * seconds;
  if (!(turn > 0) || !(seconds > 0)) return 1;
  const spacing = TAU / Math.max(1, Math.round(armCount));
  const k = Math.max(1, Math.round(turn / spacing));
  return (k * spacing) / turn;
}

/**
 * Cross-fade weight toward the clip's start: 0 until `fade` seconds before
 * the end, then easing to 1 at t = seconds (so the last frame flows into the
 * first).
 */
export function loopFade(t, seconds, fade) {
  if (!(fade > 0)) return 0;
  const x = Math.min(1, Math.max(0, (t - (seconds - fade)) / fade));
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------- color

/** Rec. 709 luminance weights. */
export const LUMA = [0.2126, 0.7152, 0.0722];
/** Tints at the ends of the color temperature slider (+1 warm, -1 cool). */
export const WARM_TINT = [1.18, 1.0, 0.72];
export const COOL_TINT = [0.8, 0.95, 1.25];

const luminance = (rgb) => rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];

/**
 * Color temperature (-1 cool … 0 neutral … +1 warm) -> RGB multiplier,
 * normalized to luminance 1 so brightness holds. 0 gives [1, 1, 1].
 * Mirrors temperatureTint() in js/shaders/composite.js.
 */
export function temperatureTint(t) {
  const end = t >= 0 ? WARM_TINT : COOL_TINT;
  const k = Math.abs(t);
  const tint = end.map((c) => 1 * (1 - k) + c * k);  // GLSL mix(1.0, c, k)
  const lum = luminance(tint);
  return tint.map((c) => c / lum);
}

const NO_TINT = [1, 1, 1];
const FILTER_SATURATION = 0.8;  // full strength never zeroes a channel outright

/**
 * Color filter multiplier for the tone-map pass. The filter color is a hue at
 * 80% saturation, scaled so its luminance is 1 (overall brightness stays
 * about the same), then blended in by strength. Strength 0 gives exactly
 * [1, 1, 1], so the image is unchanged.
 */
export function colorFilter(hueDeg, strength) {
  if (!(strength > 0)) return NO_TINT;
  const h = (((hueDeg % 360) + 360) % 360) / 60;
  const rgb = [0, 4, 2].map((o) => {
    const k = Math.min(Math.max(Math.abs(((h + o) % 6) - 3) - 1, 0), 1); // pure hue
    return 1 - FILTER_SATURATION + FILTER_SATURATION * k;
  });
  const lum = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
  return rgb.map((c) => 1 + (c / lum - 1) * strength);
}
