// Background starfield: stars on the unit sphere, rendered with the camera's
// rotation only (no translation) so they sit at infinity.

export { SPRITE_FS as BACKGROUND_FS } from './common.js';

export const BACKGROUND_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec3 aDir;
layout(location = 1) in vec4 aParams;  // brightness, phase, rate, pixelSize
layout(location = 2) in vec3 aColor;

uniform mat4  uViewProjRot;
uniform float uTime;
uniform float uTwinkle;
uniform float uBrightness;
uniform float uDpr;

out vec3 vColor;

void main() {
  gl_Position = uViewProjRot * vec4(aDir, 1.0);
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * aParams.z + aParams.y));
  vColor = aColor * aParams.x * tw * uBrightness;
  gl_PointSize = aParams.w * uDpr;
}`;
