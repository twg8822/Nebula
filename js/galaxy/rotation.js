// Rotation curve shared by the GPU (see js/shaders/stars.js) and, later,
// the CPU physics for collisions.
//
//   v(r) = v0 * r / sqrt(r² + rc²)   (rises linearly, then flattens)
//   Ω(r) = v(r) / r = v0 / sqrt(r² + rc²)
//
// Ω decreases with r, so inner stars lap outer ones and arms wind (trail).

export function angularVelocity(r, v0, rc) {
  return v0 / Math.sqrt(r * r + rc * rc);
}

export function circularSpeed(r, v0, rc) {
  return r * angularVelocity(r, v0, rc);
}
