import { createProgram } from '../gl/program.js';
import { STAR_VS, STAR_FS } from '../shaders/stars.js';
import { STAR_STRIDE } from '../galaxy/generator.js';

/**
 * Draws a set of co-rotating galaxy particles. Configure the look with a
 * fragment shader and a blend mode:
 *   'add'    -> light accumulates (stars, haze)
 *   'absorb' -> dst *= (1 - src) (dust)
 */
export class StarLayer {
  constructor(gl, { fs = STAR_FS, label = 'stars', blend = 'add', maxSize = 64, nearFade = 0 } = {}) {
    this.gl = gl;
    this.prog = createProgram(gl, STAR_VS, fs, label);
    this.blend = blend;
    this.nearFade = nearFade;
    const deviceMax = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.maxSize = Math.min(maxSize, deviceMax);
    this.count = 0;

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const bytes = STAR_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 16);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bytes, 32);
    gl.bindVertexArray(null);
  }

  setData({ data, count }) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = count;
  }

  draw({ viewProj, time, v0, rc, patternSpeed, armLock, pointScale, sizeScale, intensity = 1 }) {
    if (!this.count || intensity <= 0) return;
    const { gl, prog } = this;
    if (this.blend === 'absorb') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE);
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uViewProj'), false, viewProj);
    gl.uniform1f(prog.loc('uTime'), time);
    gl.uniform1f(prog.loc('uV0'), v0);
    gl.uniform1f(prog.loc('uRc'), rc);
    gl.uniform1f(prog.loc('uPatternSpeed'), patternSpeed);
    gl.uniform1f(prog.loc('uArmLock'), armLock);
    gl.uniform1f(prog.loc('uNearFade'), this.nearFade);
    gl.uniform1f(prog.loc('uPointScale'), pointScale);
    gl.uniform1f(prog.loc('uSizeScale'), sizeScale);
    gl.uniform1f(prog.loc('uMaxSize'), this.maxSize);
    gl.uniform1f(prog.loc('uIntensity'), intensity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
