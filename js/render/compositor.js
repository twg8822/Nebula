import { createProgram } from '../gl/program.js';
import { COMPOSITE_VS, COMPOSITE_FS, CORE_VS, CORE_FS } from '../shaders/composite.js';
import { transform } from '../math/mat4.js';

/** Draws a soft screen-space glow around the projected galactic center (additive, into HDR). */
export class CoreGlow {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, CORE_VS, CORE_FS, 'core');
    this.vao = gl.createVertexArray();
  }

  draw({ viewProj, pointScale, radius, intensity, width, height }) {
    if (intensity <= 0) return;
    const [x, y, , w] = transform(viewProj, 0, 0, 0, 1);
    if (w <= 0.01) return; // behind camera
    const { gl, prog } = this;
    prog.use();
    gl.uniform2f(prog.loc('uCenter'), (x / w * 0.5 + 0.5) * width, (y / w * 0.5 + 0.5) * height);
    gl.uniform1f(prog.loc('uRadius'), (radius * pointScale) / w);
    gl.uniform1f(prog.loc('uIntensity'), intensity);
    gl.uniform3f(prog.loc('uColorInner'), 1.0, 0.8, 0.52);
    gl.uniform3f(prog.loc('uColorOuter'), 1.0, 0.6, 0.32);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

/** HDR target -> tone-mapped default framebuffer. Later hosts bloom + lensing. */
export class Compositor {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, COMPOSITE_VS, COMPOSITE_FS, 'composite');
    this.vao = gl.createVertexArray();
  }

  draw(texture, { exposure, temperature = 0, width, height }) {
    const { gl, prog } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    prog.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(prog.loc('uScene'), 0);
    gl.uniform1f(prog.loc('uExposure'), exposure);
    gl.uniform1f(prog.loc('uTemperature'), temperature);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
