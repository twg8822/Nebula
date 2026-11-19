// Rotation curve shared by the GPU (see js/shaders/stars.js) and the CPU
// physics for collisions. The implementation lives in src/math.js
// (unit-tested in tests/math.test.js).
//
//   v(r) = v0 * r / sqrt(r² + rc²)   (rises linearly, then flattens)
//   Ω(r) = v(r) / r = v0 / sqrt(r² + rc²)
//
// Ω decreases with r, so inner stars lap outer ones and arms wind (trail).

export { angularVelocity } from '../../src/math.js';
