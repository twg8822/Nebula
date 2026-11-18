import { createProgram } from '../gl/program.js';
import { COMPOSITE_VS, COMPOSITE_FS, CORE_VS, CORE_FS } from '../shaders/composite.js';
import { transform } from '../math/mat4.js';

/**
 * Project a world point to pixel coordinates. Returns null when it is behind
 * (or nearly at) the camera; `w` is the view depth.
 */
export function projectToScreen(viewProj, p, width, height) {
  const [x, y, , w] = transform(viewProj, p[0], p[1], p[2], 1);
  if (w <= 0.01) return null;
  return { x: (x / w * 0.5 + 0.5) * width, y: (y / w * 0.5 + 0.5) * height, w };
}

const ORIGIN = [0, 0, 0];
const NO_TINT = [1, 1, 1];
const LUMA = [0.2126, 0.7152, 0.0722];
const FILTER_SATURATION = 0.8;  // full strength never zeroes a channel outright

/**
 * Color filter multiplier for the tone-map pass. The filter color is a hue at
 * 80% saturation, scaled so its luminance is 1 (overall brightness stays
 * about the same), then blended in by strength. Strength 0 gives exactly
 * [1, 1, 1], so the image is unchanged.
 */
export function colorFilter(hueDeg, strength) {
  if (!(strength > 0)) return NO_TINT;
  const h = (((hueDeg % 360) + 360) % 360) / 60;
  const rgb = [0, 4, 2].map((o) => {
    const k = Math.min(Math.max(Math.abs(((h + o) % 6) - 3) - 1, 0), 1); // pure hue
    return 1 - FILTER_SATURATION + FILTER_SATURATION * k;
  });
  const lum = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2];
  return rgb.map((c) => 1 + (c / lum - 1) * strength);
}
const WARM_INNER = [1.0, 0.8, 0.52];
const WARM_OUTER = [1.0, 0.6, 0.32];

/** Draws a soft screen-space glow around a projected galactic center (additive, into HDR). */
export class CoreGlow {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, CORE_VS, CORE_FS, 'core');
    this.vao = gl.createVertexArray();
  }

  draw({ viewProj, pointScale, radius, intensity, width, height,
    center = ORIGIN, colorInner = WARM_INNER, colorOuter = WARM_OUTER }) {
    if (intensity <= 0) return;
    const sp = projectToScreen(viewProj, center, width, height);
    if (!sp) return; // behind camera
    const { gl, prog } = this;
    prog.use();
    gl.uniform2f(prog.loc('uCenter'), sp.x, sp.y);
    gl.uniform1f(prog.loc('uRadius'), (radius * pointScale) / sp.w);
    gl.uniform1f(prog.loc('uIntensity'), intensity);
    gl.uniform3fv(prog.loc('uColorInner'), colorInner);
    gl.uniform3fv(prog.loc('uColorOuter'), colorOuter);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

/**
 * HDR target -> tone-mapped default framebuffer. With `lens` set, a variant
 * of the same shader bends the image around the black hole first; without
 * it the original program runs untouched.
 */
export class Compositor {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, COMPOSITE_VS, COMPOSITE_FS, 'composite');
    this.lensProg = createProgram(gl, COMPOSITE_VS,
      COMPOSITE_FS.replace('#version 300 es', '#version 300 es\n#define LENSING'), 'composite-lens');
    this.vao = gl.createVertexArray();
  }

  /**
   * lens: { x, y, thetaE, horizon } in pixels, or null.
   * tint: color filter multiplier [r, g, b]; [1, 1, 1] = no filter.
   */
  draw(texture, { exposure, temperature = 0, tint = NO_TINT, width, height, lens = null }) {
    const { gl } = this;
    const prog = lens ? this.lensProg : this.prog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(prog.loc('uScene'), 0);
    gl.uniform1f(prog.loc('uExposure'), exposure);
    gl.uniform1f(prog.loc('uTemperature'), temperature);
    gl.uniform3fv(prog.loc('uTint'), tint);
    if (lens) {
      gl.uniform2f(prog.loc('uBH'), lens.x, lens.y);
      gl.uniform1f(prog.loc('uThetaE'), lens.thetaE);
      gl.uniform1f(prog.loc('uHorizon'), lens.horizon);
      gl.uniform2f(prog.loc('uResolution'), width, height);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
