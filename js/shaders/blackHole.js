// Accretion disk around the central black hole: a flat annulus in the galaxy
// plane, drawn additively into the HDR buffer. The lensing that wraps it over
// the shadow happens later, in the composite pass (see composite.js LENSING).

export const DISK_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPolar;   // radial fraction 0..1, angle φ
uniform mat4  uViewProj;
uniform vec3  uCenter;
uniform float uRin;
uniform float uRout;
out vec2 vPolar;                       // r (world), φ
out vec3 vWorld;
void main() {
  float r = mix(uRin, uRout, aPolar.x);
  vec3 p = uCenter + vec3(r * cos(aPolar.y), 0.0, r * sin(aPolar.y));
  vPolar = vec2(r, aPolar.y);
  vWorld = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

export const DISK_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPolar;
in vec3 vWorld;
uniform vec3  uEye;
uniform float uRin;
uniform float uRout;
uniform float uTime;
uniform float uBrightness;
uniform float uDoppler;   // β at the inner edge
out vec4 outColor;

void main() {
  float r = vPolar.x;
  float phi = vPolar.y;
  float x = (r - uRin) / (uRout - uRin);

  // Sharp hot inner edge, steep falloff outward.
  float profile = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.45, 1.0, x)) * pow(uRin / r, 2.5);

  // Keplerian shear: inner gas laps outer gas, drawing streaks into spirals.
  float a = phi - 0.9 * pow(uRin / r, 1.5) * uTime;
  float streak = 0.78
    + 0.2 * sin(a * 3.0 + r * 9.0) * sin(a * 7.0 - r * 23.0 + 1.3)
    + 0.1 * sin(a * 13.0 + r * 41.0);

  vec3 col = mix(vec3(1.0, 0.93, 0.82), vec3(1.0, 0.52, 0.18), smoothstep(0.0, 0.6, x));

  // Relativistic beaming: gas moving toward the camera brightens and blues.
  // Orbits run with θ increasing, like the stars: tangent = (-sin φ, 0, cos φ).
  vec3 tangent = vec3(-sin(phi), 0.0, cos(phi));
  float beta = uDoppler * sqrt(uRin / r);
  float D = 1.0 / (1.0 - beta * dot(tangent, normalize(uEye - vWorld)));
  col *= D * D * D;
  col *= mix(vec3(1.0), vec3(0.85, 0.95, 1.2), clamp(D - 1.0, 0.0, 1.0));

  outColor = vec4(col * profile * streak * uBrightness, 1.0);
}`;
