import { createProgram } from '../gl/program.js';
import { DISK_VS, DISK_FS } from '../shaders/blackHole.js';

const SEGMENTS = 256;

// Disk proportions relative to the Einstein radius (artistic, not to scale).
export const BH_HORIZON = 0.5;
export const BH_DISK_IN = 1.2;
export const BH_DISK_OUT = 3.5;

/** Tidal disruption flare length in seconds (matches FLARE_LEN in the shader). */
export const FLARE_LEN = 3.5;
const FLARE_COOLDOWN = 4;

/**
 * Schedules tidal disruption flares: randomly every 10–25 s, or on demand
 * when the collision sim reports a star falling in. Runs on unpaused real
 * time so flares look the same at any rotation speed.
 */
export class FlareTimer {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.age = -1;       // seconds into the current flare; -1 = none
    this.phi = 0;
    this.sinceLast = Infinity;
    this.next = 5 + rand() * 8;
  }

  trigger(phi) {
    if (this.sinceLast < FLARE_COOLDOWN) return;
    this.age = 0;
    this.sinceLast = 0;
    this.phi = phi;
    this.next = 10 + this.rand() * 15;
  }

  update(dt) {
    this.sinceLast += dt;
    if (this.age >= 0) {
      this.age += dt;
      if (this.age > FLARE_LEN) this.age = -1;
    }
    this.next -= dt;
    if (this.next <= 0) this.trigger(this.rand() * Math.PI * 2);
  }

  stop() {
    this.age = -1;
  }
}

/** Glowing accretion disk around the black hole (additive, into HDR). */
export class AccretionDisk {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, DISK_VS, DISK_FS, 'accretion');
    const verts = new Float32Array((SEGMENTS + 1) * 4);
    for (let i = 0; i <= SEGMENTS; i++) {
      const phi = (i / SEGMENTS) * Math.PI * 2;
      verts.set([0, phi, 1, phi], i * 4);
    }
    this.count = (SEGMENTS + 1) * 2;
    this.vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
  }

  draw({ viewProj, center, eye, mass, brightness, doppler, time, flareAge = -1, flarePhi = 0, tint = [1, 1, 1] }) {
    if (brightness <= 0) return;
    const { gl, prog } = this;
    gl.blendFunc(gl.ONE, gl.ONE);
    prog.use();
    gl.uniformMatrix4fv(prog.loc('uViewProj'), false, viewProj);
    gl.uniform3fv(prog.loc('uCenter'), center);
    gl.uniform3fv(prog.loc('uEye'), eye);
    gl.uniform1f(prog.loc('uRin'), mass * BH_DISK_IN);
    gl.uniform1f(prog.loc('uRout'), mass * BH_DISK_OUT);
    gl.uniform1f(prog.loc('uTime'), time);
    gl.uniform1f(prog.loc('uBrightness'), brightness);
    gl.uniform1f(prog.loc('uDoppler'), doppler);
    gl.uniform1f(prog.loc('uFlareAge'), flareAge);
    gl.uniform1f(prog.loc('uFlarePhi'), flarePhi);
    gl.uniform3fv(prog.loc('uTint'), tint);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.count);
    gl.bindVertexArray(null);
  }
}
