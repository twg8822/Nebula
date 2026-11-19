// HDR accumulation target. Stars are summed additively here, then tone-mapped.

export function createHDRTarget(gl, floatRenderable) {
  const fbo = gl.createFramebuffer();
  let tex = null;
  let useFloat = floatRenderable;

  const target = {
    fbo,
    get texture() { return tex; },
    /** False if RGBA16F wasn't available or wasn't renderable (8-bit fallback). */
    get isFloat() { return useFloat; },
    width: 0,
    height: 0,

    resize(w, h) {
      if (w === target.width && h === target.height && tex) return;
      target.width = w;
      target.height = h;
      if (tex) gl.deleteTexture(tex);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      allocate(w, h);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (useFloat && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('[nebula] RGBA16F framebuffer incomplete; falling back to RGBA8.');
        useFloat = false;
        allocate(w, h);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    bind() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, target.width, target.height);
    },
  };

  function allocate(w, h) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  return target;
}
