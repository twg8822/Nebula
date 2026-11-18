import { createProgram } from '../gl/program.js';
import { BACKGROUND_VS, BACKGROUND_FS } from '../shaders/background.js';
import { createRng } from '../math/random.js';

// Per-star layout (10 floats): dir.xyz, brightness, phase, rate, pixelSize, r, g, b
const STRIDE = 10;

export function generateBackground(seed, count) {
  const rng = createRng(seed ^ 0x9e3779b9);
  const data = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) {
    const z = rng.range(-1, 1);
    const phi = rng.next() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const lum = Math.pow(rng.next(), 5); // mostly faint, a few bright
    const warm = rng.next();
    const o = i * STRIDE;
    data[o] = s * Math.cos(phi);
    data[o + 1] = z;
    data[o + 2] = s * Math.sin(phi);
    data[o + 3] = 0.05 + 0.6 * lum;
    data[o + 4] = rng.next() * Math.PI * 2;
    data[o + 5] = rng.range(0.25, 1.4);
    data[o + 6] = 1.2 + 2.0 * lum;
    data[o + 7] = 0.72 + 0.28 * warm;
    data[o + 8] = 0.8 + 0.08 * warm;
    data[o + 9] = 1.0 - 0.28 * warm;
  }
  return { data, count };
}

export class BackgroundLayer {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, BACKGROUND_VS, BACKGROUND_FS, 'background');
    this.count = 0;

    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, bytes, 28);
    gl.bindVertexArray(null);
  }

  setData(data, count) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = count;
  }

  draw({ viewProjRot, time, twinkle, brightness, dpr }) {
    if (!this.count) return;
    const { gl, prog } = this;
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uViewProjRot'), false, viewProjRot);
    gl.uniform1f(prog.loc('uTime'), time);
    gl.uniform1f(prog.loc('uTwinkle'), twinkle);
    gl.uniform1f(prog.loc('uBrightness'), brightness);
    gl.uniform1f(prog.loc('uDpr'), dpr);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
