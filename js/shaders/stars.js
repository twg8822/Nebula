// Galaxy particle shaders. Positions are computed analytically on the GPU from
// fixed orbital elements; must stay in sync with js/galaxy/rotation.js.
// One vertex shader serves stars, haze and dust so all three co-rotate.

export { SPRITE_FS as STAR_FS } from './common.js';

// Position source, spliced into the shared vertex shader below.
// EDGE (haze only): fade start and end (fraction of the radius), then sprite
// size and brightness beyond the end. Gentle in the normal disk so the arms
// stay soft and puffy; strong in collision tails, where gas is sparse.
const ANALYTIC = {
  decl: 'const vec4 EDGE = vec4(0.75, 1.15, 0.8, 0.6);',
  body: `
  float r = aOrbit.x;
  // Rotation curve v(r) = v0 * r / sqrt(r² + rc²)  =>  Ω(r) = v0 / sqrt(r² + rc²)
  float omega = uV0 * inversesqrt(r * r + uRc * uRc);
  omega = mix(omega, uPatternSpeed, clamp(aLock * uArmLock, 0.0, 1.0));
  float th = aOrbit.y + omega * uTime;
  vec3 p = vec3(r * cos(th), aOrbit.z, r * sin(th));
  float rn = r / max(uEdgeFade, 1e-3);   // radius as a fraction of the galaxy's`,
};

// Collision mode: world positions integrated on the CPU (js/galaxy/collision.js).
const POSITIONAL = {
  decl: `layout(location = 3) in vec3 aPos;     // world position from the N-body sim
const vec4 EDGE = vec4(0.6, 1.1, 0.55, 0.3);
uniform vec3  uCoreA;         // host centre
uniform vec3  uCoreB;         // companion centre
uniform float uRadiusB;       // companion radius`,
  body: `
  vec3 p = aPos;
  // Distance from the nearer galaxy, as a fraction of its radius: > 1 means
  // the particle has been pulled out into a bridge or tail.
  float rn = min(length(p - uCoreA) / max(uEdgeFade, 1e-3), length(p - uCoreB) / max(uRadiusB, 1e-3));`,
};

const starVS = ({ decl, body }) => /* glsl */ `#version 300 es
layout(location = 0) in vec4 aOrbit;   // r, theta0, height, worldSize
layout(location = 1) in vec4 aColor;   // rgb, brightness
layout(location = 2) in float aLock;   // 0 = own orbit, 1 = rides the arm pattern
${decl}

uniform mat4  uViewProj;
uniform float uTime;          // galaxy time (already scaled by windingRate)
uniform float uV0;
uniform float uRc;
uniform float uPatternSpeed;  // Ωp of the spiral density wave
uniform float uArmLock;       // global scale on aLock (0 = everything winds freely)
uniform float uPointScale;    // pixels per world unit at distance 1
uniform float uSizeScale;
uniform float uMaxSize;       // pixels
uniform float uIntensity;
uniform float uNearFade;      // >0: fade out within this distance of the camera
uniform vec3  uTint;          // color filter; (1,1,1) = none
uniform float uEdgeFade;      // >0 (haze): galaxy radius; sprites shrink and dim toward the rim

out vec3 vColor;

void main() {${body}

  gl_Position = uViewProj * vec4(p, 1.0);

  // Where the gas thins out (the rim, and especially tidal tails) single big
  // sprites read as separate cotton balls: shrink and dim them there.
  float edge = uEdgeFade > 0.0 ? 1.0 - smoothstep(EDGE.x, EDGE.y, rn) : 1.0;
  float size = aOrbit.w * uSizeScale * mix(EDGE.z, 1.0, edge) * uPointScale / max(gl_Position.w, 1e-3);
  float px = clamp(size, 1.5, uMaxSize);
  // Sub-minimum sprites get dimmed so distant particles don't over-brighten.
  float energy = min(1.0, (size * size) / (px * px));
  // Big soft sprites (haze, dust) fade near the camera instead of becoming fog.
  float fade = uNearFade > 0.0 ? smoothstep(uNearFade * 0.3, uNearFade, gl_Position.w) : 1.0;
  gl_PointSize = px;
  vColor = aColor.rgb * aColor.a * energy * fade * mix(EDGE.w, 1.0, edge) * uIntensity * uTint;
}`;

export const STAR_VS = starVS(ANALYTIC);
export const STAR_VS_POS = starVS(POSITIONAL);

/** Additive soft glow with no visible core (unresolved starlight, nebulae). */
export const HAZE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  outColor = vec4(vColor * exp(-d2 * 3.0) * (1.0 - d2), 1.0);
}`;

/**
 * Absorption: output is the fraction of light removed per channel.
 * Used with blendFunc(ZERO, ONE_MINUS_SRC_COLOR) => dst *= (1 - src).
 * Clamped so float targets never go negative.
 */
export const DUST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  outColor = vec4(min(vColor * exp(-d2 * 2.5) * (1.0 - d2), vec3(0.9)), 1.0);
}`;
