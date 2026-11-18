export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');

  // Needed to render into RGBA16F targets (HDR accumulation).
  const floatRenderable = !!gl.getExtension('EXT_color_buffer_float');
  if (!floatRenderable) {
    console.warn('[nebula] EXT_color_buffer_float missing; falling back to 8-bit target (less dynamic range).');
  }
  return { gl, floatRenderable };
}
