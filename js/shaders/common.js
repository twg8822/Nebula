// Shared GLSL snippets.

/** Fullscreen triangle from gl_VertexID; no vertex buffers needed. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Soft round sprite: bright gaussian core + faint wide halo. */
export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float a = exp(-d2 * 6.0) + 0.06 * (1.0 - d2);
  outColor = vec4(vColor * a, 1.0);
}`;
