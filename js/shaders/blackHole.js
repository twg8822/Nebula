// Accretion disk around the central black hole: a flat annulus in the galaxy
// plane, drawn additively into the HDR buffer. The lensing that wraps it over
// the shadow happens later, in the composite pass (see composite.js LENSING).

/** Tidal disruption flare length in seconds (used by the shader and FlareTimer). */
export const FLARE_LEN = 3.5;

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
uniform float uFlareAge;  // seconds since a tidal disruption began; < 0 = none
uniform float uFlarePhi;  // disk angle where the star was shredded
uniform vec3  uTint;      // color filter; (1,1,1) = none
out vec4 outColor;

const float TAU = 6.2831853;
const float FLARE_LEN = ${FLARE_LEN.toFixed(1)};  // seconds

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
  vec3 light = col * profile * streak;

  // Tidal disruption: the shredded star's debris is a bright head that
  // spirals in from the outer disk, trailing a stream that lengthens as it
  // shears. The whole disk briefly brightens as the debris feeds it.
  if (uFlareAge >= 0.0) {
    float t = uFlareAge;
    float env = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(FLARE_LEN * 0.45, FLARE_LEN, t));
    float k = smoothstep(0.0, FLARE_LEN * 0.75, t);
    float span = uRout - uRin;
    float rHead = mix(uRin + span * 0.75, uRin + span * 0.03, k);
    float phiHead = uFlarePhi + 1.2 * TAU * k;          // prograde, about one turn
    float behind = mod(phiHead - phi, TAU);             // angle trailing the head
    float len = 0.5 + 3.5 * k;                          // stream length, radians
    float rStream = rHead + behind / TAU * span * 0.45; // trails back outward
    float w = span * (0.007 + 0.004 * behind);          // thin, widening as it shears
    float along = exp(-2.5 * behind / len) * (1.0 - smoothstep(len * 0.5, len, behind));
    float across = exp(-pow((r - rStream) / w, 2.0));
    // Tinted toward the disk's own hot color so it reads as gas, not a line.
    vec3 debris = mix(col, vec3(1.0, 0.97, 1.02), 0.5);
    light = light * (1.0 + 0.35 * env) + debris * (1.4 * env * along * across);
  }

  // Relativistic beaming: gas moving toward the camera brightens and blues.
  // Orbits run with θ increasing, like the stars: tangent = (-sin φ, 0, cos φ).
  vec3 tangent = vec3(-sin(phi), 0.0, cos(phi));
  float beta = uDoppler * sqrt(uRin / r);
  float D = 1.0 / (1.0 - beta * dot(tangent, normalize(uEye - vWorld)));
  light *= D * D * D;
  light *= mix(vec3(1.0), vec3(0.85, 0.95, 1.2), clamp(D - 1.0, 0.0, 1.0));

  outColor = vec4(light * uBrightness * uTint, 1.0);
}`;
