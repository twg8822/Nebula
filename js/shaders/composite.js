// Core haze (additive, into HDR) and final tone-map pass (HDR -> screen).

export { FULLSCREEN_VS as COMPOSITE_VS, FULLSCREEN_VS as CORE_VS } from './common.js';

export const CORE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2  uCenter;      // core position in pixels
uniform float uRadius;      // core radius in pixels
uniform float uIntensity;
uniform vec3  uColorInner;  // hot yellow-white nucleus
uniform vec3  uColorOuter;  // orange envelope
out vec4 outColor;
void main() {
  float d = length(gl_FragCoord.xy - uCenter) / uRadius;
  vec3 g = uColorInner * exp(-d * d * 3.5)
         + uColorOuter * 0.18 * exp(-d * 2.2);
  outColor = vec4(g * uIntensity, 1.0);
}`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uExposure;
uniform float uTemperature;  // -1 cool … 0 neutral … +1 warm
out vec4 outColor;

#ifdef LENSING
// Point-mass gravitational lens around the black hole, in pixels.
uniform vec2  uBH;           // black hole position
uniform float uThetaE;       // Einstein radius
uniform float uHorizon;      // shadow radius
uniform vec2  uResolution;
#endif

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// White-balance tint, normalized so overall brightness stays constant.
vec3 temperatureTint(float t) {
  vec3 tint = t >= 0.0
    ? mix(vec3(1.0), vec3(1.18, 1.0, 0.72), t)
    : mix(vec3(1.0), vec3(0.8, 0.95, 1.25), -t);
  return tint / dot(tint, LUMA);
}

// Narkowicz ACES filmic approximation.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float acesL(float x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
#ifdef LENSING
  // Thin-lens mapping: light seen at distance θ came from θ - θE²/θ, so each
  // pixel samples the unlensed scene closer in (or, inside θE, from the
  // opposite side: the inverted secondary image). The deflection is eased out
  // far from the hole so the whole frame isn't bent.
  vec2 d = gl_FragCoord.xy - uBH;
  float th = max(length(d), 1e-3);
  float falloff = 1.0 - smoothstep(5.0 * uThetaE, 10.0 * uThetaE, th);
  float bend = (uThetaE * uThetaE) / (th * th) * falloff;
  vec2 uv = (uBH + d * (1.0 - bend)) / uResolution;
  // The secondary image is tiny and aliases without mipmaps: dim it.
  float lensGain = mix(0.55, 1.0, smoothstep(0.85 * uThetaE, 1.1 * uThetaE, th));
  lensGain *= smoothstep(uHorizon * 0.94, uHorizon * 1.04, th);  // the shadow
  vec3 c = max(texture(uScene, uv).rgb, 0.0) * lensGain * uExposure * temperatureTint(uTemperature);
#else
  vec3 c = max(texture(uScene, vUv).rgb, 0.0) * uExposure * temperatureTint(uTemperature);
#endif

  // Tone-map luminance and keep hue, so a dense warm core stays yellow-orange
  // instead of clipping to white. Blend in a little per-channel ACES so the
  // very brightest pixels still bleach toward white like a real exposure.
  float L = dot(c, LUMA);
  vec3 hp = c * (acesL(L) / max(L, 1e-6));
  hp /= max(1.0, max(hp.r, max(hp.g, hp.b)));
  c = mix(hp, aces(c), 0.3);

  c = pow(c, vec3(1.0 / 2.2));
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;  // dither against banding
  outColor = vec4(c, 1.0);
}`;
