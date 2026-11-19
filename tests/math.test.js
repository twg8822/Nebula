// Unit tests for src/math.js. Zero dependencies: Node's built-in runner.
//   npm test            (or)   node --test tests/*.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TAU, mulberry32, createRng,
  angularVelocity, circularSpeed, orbitAngle,
  spiralArm, diskPosition,
  LUMA, WARM_TINT, COOL_TINT, temperatureTint, colorFilter,
} from '../src/math.js';

const close = (actual, expected, eps = 1e-9, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);
const closeAll = (actual, expected, eps = 1e-9) =>
  expected.forEach((e, i) => close(actual[i], e, eps, `[${i}]`));
const luminance = (rgb) => rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
describe('seeded random: mulberry32', () => {
  test('golden values: a seed always gives the same galaxy', () => {
    const next = mulberry32(1337);
    assert.deepEqual([next(), next(), next()], [0.1844118325971067, 0.18998925131745636, 0.8104719922412187]);
  });

  test('same seed -> same sequence; different seed -> different sequence', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const sa = Array.from({ length: 100 }, a);
    assert.deepEqual(Array.from({ length: 100 }, b), sa);
    assert.notDeepEqual(Array.from({ length: 100 }, c), sa);
  });

  test('outputs stay in [0, 1) and are roughly uniform', () => {
    const next = mulberry32(99);
    const n = 100000;
    const buckets = new Array(10).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = next();
      assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
      sum += x;
      buckets[Math.floor(x * 10)]++;
    }
    close(sum / n, 0.5, 0.01, 'mean');
    for (const b of buckets) close(b / n, 0.1, 0.01, 'bucket share');
  });

  test('seeds are taken as unsigned 32-bit integers', () => {
    assert.equal(mulberry32(-1)(), mulberry32(0xffffffff)());
    assert.equal(mulberry32(2 ** 32 + 5)(), mulberry32(5)());
  });
});

describe('seeded random: createRng', () => {
  test('golden values for next, range and gauss', () => {
    const rng = createRng(42);
    assert.deepEqual([rng.next(), rng.range(5, 10), rng.gauss()],
      [0.6011037519201636, 7.241452794987708, -0.2730261048826104]);
  });

  test('next() is the same stream as mulberry32', () => {
    const rng = createRng(2024), m = mulberry32(2024);
    for (let i = 0; i < 50; i++) assert.equal(rng.next(), m());
  });

  test('range(a, b) stays inside [a, b)', () => {
    const rng = createRng(5);
    for (let i = 0; i < 10000; i++) {
      const x = rng.range(-3, 9);
      assert.ok(x >= -3 && x < 9, `out of range: ${x}`);
    }
  });

  test('gauss() is a standard normal: mean ≈ 0, sd ≈ 1, finite', () => {
    const rng = createRng(11);
    const n = 100000;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      const g = rng.gauss();
      assert.ok(Number.isFinite(g));
      sum += g;
      sumSq += g * g;
    }
    const mean = sum / n;
    close(mean, 0, 0.02, 'mean');
    close(Math.sqrt(sumSq / n - mean * mean), 1, 0.02, 'sd');
  });
});

// ---------------------------------------------------------------------------
describe('rotation curve', () => {
  test('Ω at the center is v0 / rc', () => {
    close(angularVelocity(0, 1, 1), 1);
    close(angularVelocity(0, 2.5, 0.5), 5);
  });

  test('Ω falls with radius (inner stars lap outer ones)', () => {
    let prev = Infinity;
    for (const r of [0, 0.5, 1, 2, 5, 10, 50]) {
      const w = angularVelocity(r, 1, 1);
      assert.ok(w < prev, `Ω(${r}) = ${w} should be below ${prev}`);
      prev = w;
    }
  });

  test('matches Ω = v0 / sqrt(r² + rc²) and scales linearly with v0', () => {
    close(angularVelocity(3, 1, 4), 1 / 5);
    close(angularVelocity(3, 2, 4), 2 * angularVelocity(3, 1, 4));
  });

  test('circular speed = r·Ω: zero at the center, flattening to v0', () => {
    assert.equal(circularSpeed(0, 1, 1), 0);
    close(circularSpeed(2, 1.3, 0.7), 2 * angularVelocity(2, 1.3, 0.7));
    close(circularSpeed(1e6, 1.3, 0.7), 1.3, 1e-6, 'flat rotation curve');
    assert.ok(circularSpeed(1, 1, 1) < circularSpeed(2, 1, 1), 'rises in the core');
  });

  test('orbitAngle: own orbit at lock 0, pattern speed at lock 1, θ0 at t = 0', () => {
    close(orbitAngle(0.3, 0.5, 0.1, 0, 10), 0.3 + 0.5 * 10);
    close(orbitAngle(0.3, 0.5, 0.1, 1, 10), 0.3 + 0.1 * 10);
    close(orbitAngle(0.3, 0.5, 0.1, 0.8, 10), 0.3 + (0.5 + (0.1 - 0.5) * 0.8) * 10);
    assert.equal(orbitAngle(1.25, 9, 3, 0.5, 0), 1.25);
  });
});

// ---------------------------------------------------------------------------
describe('spiral arms', () => {
  test('arm 0 sits at the phase angle at r = 1', () => {
    close(spiralArm(3, 15, 0.7)(1, 0), 0.7);
  });

  test('arms are evenly spaced around the disk', () => {
    for (const n of [1, 2, 3, 4, 6]) {
      const arm = spiralArm(n, 20, 0.2);
      for (let k = 0; k < n; k++) close(arm(4, k) - arm(4, 0), (k * TAU) / n);
    }
  });

  test('arms trail: the angle falls as r grows', () => {
    const arm = spiralArm(2, 15);
    let prev = Infinity;
    for (const r of [0.5, 1, 2, 4, 8, 16]) {
      assert.ok(arm(r, 0) < prev);
      prev = arm(r, 0);
    }
  });

  test('logarithmic spiral: constant pitch, so dθ/d(ln r) = -1/tan(pitch)', () => {
    for (const pitch of [6, 12, 18, 35]) {
      const arm = spiralArm(4, pitch);
      const slope = -1 / Math.tan((pitch * Math.PI) / 180);
      for (const [r1, r2] of [[1, 2], [0.3, 7], [5, 5.5]]) {
        close((arm(r2, 1) - arm(r1, 1)) / Math.log(r2 / r1), slope, 1e-9, `pitch ${pitch}`);
      }
    }
  });

  test('smaller pitch winds tighter', () => {
    const turn = (pitch) => spiralArm(1, pitch)(1, 0) - spiralArm(1, pitch)(10, 0);
    assert.ok(turn(8) > turn(15) && turn(15) > turn(30));
  });

  test('arm count is rounded and never below 1', () => {
    close(spiralArm(2.6, 15)(3, 1) - spiralArm(2.6, 15)(3, 0), TAU / 3);
    close(spiralArm(0, 15)(3, 1) - spiralArm(0, 15)(3, 0), TAU);
  });

  test('diskPosition: radius kept, Y is height, θ = 0 points along +X', () => {
    const [x, y, z] = diskPosition(5, 1.1, -0.4);
    close(Math.hypot(x, z), 5);
    assert.equal(y, -0.4);
    closeAll(diskPosition(2, 0, 0), [2, 0, 0]);
    closeAll(diskPosition(2, Math.PI / 2, 0), [0, 0, 2], 1e-12);
  });
});

// ---------------------------------------------------------------------------
describe('color temperature -> RGB', () => {
  test('neutral (0) is exactly [1, 1, 1]', () => {
    assert.deepEqual(temperatureTint(0), [1, 1, 1]);
  });

  test('brightness holds: luminance is 1 across the whole slider', () => {
    for (let t = -1; t <= 1.0001; t += 0.05) close(luminance(temperatureTint(t)), 1, 1e-12, `t=${t}`);
  });

  test('warm pushes red over blue, cool pushes blue over red, more as |t| grows', () => {
    const warm = temperatureTint(1), cool = temperatureTint(-1);
    assert.ok(warm[0] > warm[2] && cool[2] > cool[0]);
    const ratio = (t) => temperatureTint(t)[0] / temperatureTint(t)[2];
    assert.ok(ratio(1) > ratio(0.5) && ratio(0.5) > ratio(0) && ratio(0) > ratio(-0.5) && ratio(-0.5) > ratio(-1));
  });

  test('the extremes are the normalized end tints', () => {
    closeAll(temperatureTint(1), WARM_TINT.map((c) => c / luminance(WARM_TINT)));
    closeAll(temperatureTint(-1), COOL_TINT.map((c) => c / luminance(COOL_TINT)));
  });

  test('matches the GLSL temperatureTint() in js/shaders/composite.js', () => {
    const src = readSource('js/shaders/composite.js');
    const vec = (arr) => `vec3(${arr.map((c) => (Number.isInteger(c) ? c.toFixed(1) : String(c))).join(', ')})`;
    assert.ok(src.includes(`mix(vec3(1.0), ${vec(WARM_TINT)}, t)`), 'warm tint constant');
    assert.ok(src.includes(`mix(vec3(1.0), ${vec(COOL_TINT)}, -t)`), 'cool tint constant');
    assert.ok(src.includes(`const vec3 LUMA = ${vec(LUMA)};`), 'luminance weights');
  });
});

describe('color filter', () => {
  test('strength 0 is exactly [1, 1, 1] for every hue (no effect when off)', () => {
    for (let hue = 0; hue <= 360; hue += 15) assert.deepEqual(colorFilter(hue, 0), [1, 1, 1]);
  });

  test('brightness holds at any hue and strength', () => {
    for (let hue = 0; hue < 360; hue += 10) {
      for (const s of [0.1, 0.5, 1]) close(luminance(colorFilter(hue, s)), 1, 1e-12, `hue ${hue} s ${s}`);
    }
  });

  test('hues land where the panel labels say', () => {
    const top = (rgb) => rgb.indexOf(Math.max(...rgb));
    assert.equal(top(colorFilter(0, 1)), 0, 'red');
    assert.equal(top(colorFilter(120, 1)), 1, 'green');
    assert.equal(top(colorFilter(240, 1)), 2, 'blue');
  });

  test('hue wraps around (360 = 0, -60 = 300)', () => {
    closeAll(colorFilter(360, 0.7), colorFilter(0, 0.7));
    closeAll(colorFilter(-60, 0.7), colorFilter(300, 0.7));
  });

  test('full strength never zeroes a channel', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const c of colorFilter(hue, 1)) assert.ok(c > 0, `hue ${hue}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe('shader stays in sync with the JS math', () => {
  test('STAR_VS uses the same rotation curve and disk position', () => {
    const src = readSource('js/shaders/stars.js');
    assert.ok(src.includes('float omega = uV0 * inversesqrt(r * r + uRc * uRc);'), 'Ω(r) = v0 / sqrt(r² + rc²)');
    assert.ok(src.includes('vec3 p = vec3(r * cos(th), aOrbit.z, r * sin(th));'), 'disk position');
  });
});
