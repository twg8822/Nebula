function compile(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = source.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n');
    console.error(`[nebula] ${label} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader:\n${log}\n${numbered}`);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed (${label}): ${log}`);
  }
  return sh;
}

/**
 * Compile + link a program. Returns { program, use(), loc(name) } where
 * loc() caches uniform locations.
 */
export function createProgram(gl, vsSource, fsSource, label = 'program') {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource, label);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, label);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    console.error(`[nebula] ${label} link:\n${log}`);
    throw new Error(`Program link failed (${label}): ${log}`);
  }

  const cache = new Map();
  return {
    program,
    use() { gl.useProgram(program); },
    loc(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name);
    },
  };
}
