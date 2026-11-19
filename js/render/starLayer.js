import { createProgram } from '../gl/program.js';
import { STAR_VS, STAR_VS_POS, STAR_FS } from '../shaders/stars.js';
import { STAR_STRIDE } from '../galaxy/generator.js';

const NO_TINT = [1, 1, 1];

/**
 * Draws a set of co-rotating galaxy particles. Configure the look with a
 * fragment shader and a blend mode:
 *   'add'    -> light accumulates (stars, haze)
 *   'absorb' -> dst *= (1 - src) (dust)
 *
 * Two position sources share the same per-particle data:
 *   analytic   (default) the vertex shader orbits each particle from its elements
 *   positional (collision mode) world positions streamed in from the CPU
 */
export class StarLayer {
  constructor(gl, { fs = STAR_FS, label = 'stars', blend = 'add', maxSize = 64, nearFade = 0 } = {}) {
    this.gl = gl;
    this.prog = createProgram(gl, STAR_VS, fs, label);
    this.posProg = createProgram(gl, STAR_VS_POS, fs, `${label}-pos`);
    this.blend = blend;
    this.nearFade = nearFade;
    const deviceMax = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    this.maxSize = Math.min(maxSize, deviceMax);
    this.count = 0;
    this.positional = false;
    this.posBytes = 0;

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.posBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const bytes = STAR_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 16);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, bytes, 32);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
  }

  /** positions: Float32Array of xyz per particle switches to positional mode. */
  setData({ data, count }, positions = null) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = count;
    this.positional = !!positions;
    gl.bindVertexArray(this.vao);
    if (this.positional) gl.enableVertexAttribArray(3);
    else gl.disableVertexAttribArray(3);
    gl.bindVertexArray(null);
    if (positions) this.setPositions(positions);
  }

  /** Stream new world positions (collision mode). */
  setPositions(positions) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    if (positions.byteLength !== this.posBytes) {
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      this.posBytes = positions.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    }
  }

  /** tint: color filter multiplier for emitted light; dust (absorption) passes [1, 1, 1]. */
  /**
   * edgeFade: galaxy radius to fade big sprites toward the rim (haze), 0 = off.
   * cores: { a, b, radiusB } galaxy centres for that fade in collision mode.
   */
  draw({ viewProj, time, v0, rc, patternSpeed, armLock, pointScale, sizeScale, intensity = 1, tint = NO_TINT,
    edgeFade = 0, cores = null }) {
    if (!this.count || intensity <= 0) return;
    const { gl } = this;
    const prog = this.positional ? this.posProg : this.prog;
    if (this.blend === 'absorb') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE);
    prog.use();
    // Orbit uniforms are unused (null location, a no-op) by the positional shader.
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
    gl.uniform3fv(prog.loc('uTint'), tint);
    gl.uniform1f(prog.loc('uEdgeFade'), edgeFade);
    if (cores) {
      gl.uniform3fv(prog.loc('uCoreA'), cores.a);
      gl.uniform3fv(prog.loc('uCoreB'), cores.b);
      gl.uniform1f(prog.loc('uRadiusB'), cores.radiusB);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
