// Single source of truth for every tunable parameter.
//
//   value   default
//   min/max/step  slider + validation range
//   kind    'regen'   -> changing it requires rebuilding star buffers
//           'uniform' -> changing it takes effect next frame
//   label   human-readable name (control panel)
//   random  [lo, hi] tasteful range used by randomize(); omitted = left alone
//
// The control panel, URL overrides and randomize() all read this table.

export const params = {
  // --- generation ---
  seed:          { value: 1337,  min: 0,    max: 999999, step: 1,     kind: 'regen',   label: 'Seed' },
  starCount:     { value: 110000, min: 5000, max: 200000, step: 5000,  kind: 'regen',   label: 'Star count' },
  armCount:      { value: 4,     min: 1,    max: 6,      step: 1,     kind: 'regen',   label: 'Arms',          random: [2, 4] },
  pitchDeg:      { value: 18,    min: 6,    max: 35,     step: 0.5,   kind: 'regen',   label: 'Arm tightness', random: [11, 22] },
  galaxyRadius:  { value: 10,    min: 4,    max: 20,     step: 0.5,   kind: 'regen',   label: 'Galaxy radius' },
  diskScale:     { value: 4,     min: 1,    max: 10,     step: 0.1,   kind: 'regen',   label: 'Disk scale',    random: [3.2, 4.8] },
  armSpread:     { value: 0.32,  min: 0.05, max: 1.2,    step: 0.01,  kind: 'regen',   label: 'Arm width',     random: [0.24, 0.4] },
  diskThickness: { value: 0.22,  min: 0,    max: 1,      step: 0.01,  kind: 'regen',   label: 'Disk thickness', random: [0.16, 0.28] },
  bulgeFraction: { value: 0.2,   min: 0,    max: 0.6,    step: 0.01,  kind: 'regen',   label: 'Bulge share',   random: [0.15, 0.26] },
  fieldFraction: { value: 0.12,  min: 0,    max: 0.5,    step: 0.01,  kind: 'regen',   label: 'Field share' },
  haloFraction:  { value: 0.04,  min: 0,    max: 0.3,    step: 0.01,  kind: 'regen',   label: 'Halo share' },
  bulgeRadius:   { value: 1.95,  min: 0.6,  max: 3.5,    step: 0.05,  kind: 'regen',   label: 'Core size',     random: [1.2, 2.1] },
  bgStarCount:   { value: 4000,  min: 0,    max: 20000,  step: 100,   kind: 'regen',   label: 'Background stars' },
  youngFraction: { value: 0.35,  min: 0,    max: 1,      step: 0.01,  kind: 'regen',   label: 'Young stars',   random: [0.25, 0.45] },
  knotRate:      { value: 0.004, min: 0,    max: 0.03,   step: 0.001, kind: 'regen',   label: 'Star-forming knots', random: [0.0025, 0.006] },
  dustFraction:  { value: 0.12,  min: 0,    max: 0.5,    step: 0.01,  kind: 'regen',   label: 'Dust',          random: [0.08, 0.16] },

  // --- dynamics (rotation curve: Ω(r) = v0 / sqrt(r² + rc²)) ---
  v0:            { value: 1.0,   min: 0,    max: 3,      step: 0.01,  kind: 'uniform', label: 'Orbital speed' },
  rc:            { value: 1.0,   min: 0.1,  max: 5,      step: 0.05,  kind: 'uniform', label: 'Core radius (dynamics)' },
  windingRate:   { value: 0.12,  min: 0,    max: 1,      step: 0.005, kind: 'uniform', label: 'Winding rate' },
  timeScale:     { value: 2.5,   min: 0,    max: 6,      step: 0.1,   kind: 'uniform', label: 'Rotation speed' },
  corotation:    { value: 0.6,   min: 0.1,  max: 1.5,    step: 0.01,  kind: 'uniform', label: 'Corotation',    random: [0.5, 0.7] },
  armLock:       { value: 1.0,   min: 0,    max: 1,      step: 0.01,  kind: 'uniform', label: 'Arm lock' },   // 0 = arms wind freely

  // --- look ---
  exposure:      { value: 1.2,   min: 0.1,  max: 5,      step: 0.05,  kind: 'uniform', label: 'Exposure' },
  starSize:      { value: 1.0,   min: 0.2,  max: 4,      step: 0.05,  kind: 'uniform', label: 'Star size' },
  coreGlow:      { value: 0.55,  min: 0,    max: 4,      step: 0.05,  kind: 'uniform', label: 'Core glow' },
  hazeBrightness:{ value: 1.0,   min: 0,    max: 4,      step: 0.05,  kind: 'uniform', label: 'Haze' },
  glow:          { value: 0.8,   min: 0,    max: 2.5,    step: 0.05,  kind: 'uniform', label: 'Glow intensity', random: [0.85, 1.25] }, // master scale on core glow + haze
  colorTemp:     { value: -0.37, min: -1,   max: 1,      step: 0.01,  kind: 'uniform', label: 'Color temperature', random: [-0.35, 0.35] }, // -1 cool … +1 warm
  // Color filter: tints the light before tone mapping. Strength 0 multiplies by
  // exactly 1, so it has no effect at all until used. No `random`: Randomize leaves it alone.
  tintStrength:  { value: 0,     min: 0,    max: 1,      step: 0.01,  kind: 'uniform', label: 'Color filter' },
  tintHue:       { value: 0,     min: 0,    max: 360,    step: 1,     kind: 'uniform', label: 'Filter hue' },       // degrees: 0 red, 120 green, 240 blue
  dustOpacity:   { value: 1.0,   min: 0,    max: 4,      step: 0.05,  kind: 'uniform', label: 'Dust opacity',  random: [0.8, 1.3] },
  bgBrightness:  { value: 1.0,   min: 0,    max: 3,      step: 0.05,  kind: 'uniform', label: 'Background' },
  twinkle:       { value: 0.35,  min: 0,    max: 1,      step: 0.01,  kind: 'uniform', label: 'Twinkle' },

  // --- features (0/1 toggles; no `random`, so Randomize never flips them) ---
  // Cinematic camera: slow auto-orbit with a swaying tilt after a few idle seconds.
  autoOrbit:     { value: 1,     min: 0,    max: 1,      step: 1,     kind: 'uniform', label: 'Cinematic camera' },
  orbitSpeed:    { value: 0.05,  min: 0,    max: 0.3,    step: 0.01,  kind: 'uniform', label: 'Orbit speed' },      // rad/s
  tiltDeg:       { value: 12,    min: 0,    max: 30,     step: 1,     kind: 'uniform', label: 'Camera tilt' },      // ± degrees

  // Supermassive black hole: horizon, accretion disk, screen-space lensing.
  blackHole:     { value: 0,     min: 0,    max: 1,      step: 1,     kind: 'uniform', label: 'Black hole' },
  bhMass:        { value: 0.6,   min: 0.1,  max: 2,      step: 0.01,  kind: 'uniform', label: 'Black hole size' }, // Einstein radius, world units
  bhDiskBrightness: { value: 2.0, min: 0,   max: 8,      step: 0.05,  kind: 'uniform', label: 'Accretion glow' },
  bhDoppler:     { value: 0.4,   min: 0,    max: 0.9,    step: 0.01,  kind: 'uniform', label: 'Doppler beaming' },  // β
  bhFlares:      { value: 0,     min: 0,    max: 1,      step: 1,     kind: 'uniform', label: 'Tidal disruptions' },  // stars shredded into flares
  bhGravity:     { value: 0,     min: 0,    max: 1,      step: 1,     kind: 'uniform', label: 'Black hole gravity' }, // collision mode only; restarts it

  // Galaxy collision: CPU N-body with a companion falling in.
  collision:     { value: 0,     min: 0,    max: 1,      step: 1,     kind: 'regen',   label: 'Collision' },
  companionMass: { value: 0.35,  min: 0.05, max: 1,      step: 0.01,  kind: 'regen',   label: 'Companion mass' },   // mass ratio q
  encounterTilt: { value: 30,    min: 0,    max: 180,    step: 1,     kind: 'regen',   label: 'Encounter tilt', random: [10, 60] }, // >90° = retrograde
  pericenter:    { value: 1.0,   min: 0.5,  max: 3,      step: 0.05,  kind: 'regen',   label: 'Closest approach' }, // × galaxyRadius
  collisionRate: { value: 1.0,   min: 0,    max: 3,      step: 0.05,  kind: 'uniform', label: 'Collision speed' },
};

/** Live config values: `config.starCount`, etc. */
export const config = Object.fromEntries(
  Object.entries(params).map(([k, p]) => [k, p.value]),
);

/** Snap a value to a param's range and step. */
export function sanitize(key, v) {
  const p = params[key];
  const clamped = Math.min(p.max, Math.max(p.min, v));
  const snapped = p.min + Math.round((clamped - p.min) / p.step) * p.step;
  return Number(snapped.toFixed(6));
}

/** Override config values from the URL query string, e.g. ?starCount=100000&seed=42 */
export function applyQueryOverrides(search = location.search) {
  for (const [key, raw] of new URLSearchParams(search)) {
    const v = Number(raw);
    if (!params[key] || !Number.isFinite(v)) continue;
    config[key] = Math.min(params[key].max, Math.max(params[key].min, v));
  }
}

/**
 * Re-roll every param that declares a `random` range, plus the seed.
 * Star count, speed and other user/perf choices are left alone.
 */
export function randomize(rand = Math.random) {
  config.seed = Math.floor(rand() * (params.seed.max + 1));
  for (const [key, p] of Object.entries(params)) {
    if (!p.random) continue;
    const [lo, hi] = p.random;
    // Integer params: inclusive of both ends.
    const v = p.step >= 1 ? lo + Math.floor(rand() * (hi - lo + 1)) : lo + rand() * (hi - lo);
    config[key] = sanitize(key, v);
  }
}
