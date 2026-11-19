// Offline video recording with WebCodecs: the caller renders each frame into
// the canvas at a fixed time step, this encodes it and muxes the result. The
// clip's timing never depends on how fast the GPU is, so a slow machine (or
// 4K) just takes longer instead of stuttering.

import { muxMp4 } from './mp4.js';
import { muxWebm } from './webm.js';

/** Bits per pixel per frame: star fields are noisy, so they need a healthy rate. */
const BITS_PER_PIXEL = 0.2;
const MAX_BITRATE = 50e6;
const KEYFRAME_SECONDS = 2;
const MAX_QUEUE = 4;  // frames waiting in the encoder before we pause rendering

// Candidates per container, best first. H.264 level 5.1 covers up to 4096×2304 at 30 fps,
// 5.2 up to 60 fps. VP9 profile 0 level 5.1.
const CODECS = {
  mp4: (fps) => (fps > 30
    ? ['avc1.640034', 'avc1.4d0034', 'avc1.420034']
    : ['avc1.640033', 'avc1.4d0033', 'avc1.420033']),
  webm: () => ['vp09.00.51.08', 'vp8'],
};

/**
 * Yield to the event loop (so the encoder's output and the progress bar can
 * run). A MessageChannel hop, not setTimeout: browsers throttle timers in
 * background tabs to about once a second, which would stall a recording as
 * soon as the user switched tabs.
 */
function nextTask() {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { port1.close(); resolve(); };
    port2.postMessage(0);
  });
}

export function bitrateFor(width, height, fps) {
  return Math.min(MAX_BITRATE, Math.round(width * height * fps * BITS_PER_PIXEL));
}

/** First encoder config this browser supports for the container, or null. */
export async function findEncoderConfig(format, width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of CODECS[format](fps)) {
    const config = {
      codec, width, height, framerate: fps,
      bitrate: bitrateFor(width, height, fps),
      bitrateMode: 'variable',
      ...(format === 'mp4' ? { avc: { format: 'avc' } } : {}),
    };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch { /* malformed for this browser: try the next */ }
  }
  return null;
}

/**
 * Render and encode a clip.
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas   drawn into by `render`, already sized width×height
 * @param {'mp4'|'webm'} o.format
 * @param {VideoEncoderConfig} o.config  from findEncoderConfig
 * @param {number} o.fps
 * @param {number} o.frames
 * @param {(i: number) => void} o.render  draw frame i into the canvas
 * @param {(done: number) => void} [o.onProgress]
 * @param {() => boolean} [o.cancelled]
 * @returns {Promise<Blob|null>} null if cancelled
 */
export async function recordClip({ canvas, format, config, fps, frames, render, onProgress, cancelled = () => false }) {
  const samples = [];
  let description = null;
  let failure = null;
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
      if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description);
    },
    error(e) { failure = e; },
  });
  encoder.configure(config);

  const frameUs = 1e6 / fps;
  const keyEvery = Math.max(1, Math.round(fps * KEYFRAME_SECONDS));
  try {
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      if (cancelled()) return null;
      render(i);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      onProgress?.(i + 1);
      // Let the encoder catch up (and the page update) before queueing more.
      while (encoder.encodeQueueSize > MAX_QUEUE) {
        await ('ondequeue' in encoder
          ? new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }))
          : nextTask());
      }
      if (i % 4 === 3) await nextTask();
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  // Both writers store frames in decode order and assume it equals display
  // order. WebCodecs encoders don't reorder (no B-frames) by default; if one
  // ever does, fail clearly instead of writing a stuttering file.
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp <= samples[i - 1].timestamp) {
      throw new Error('This encoder reorders frames, which this recorder can\'t store. Try the other format.');
    }
  }

  const { width, height } = config;
  if (format === 'mp4') {
    if (!description) throw new Error('The H.264 encoder gave no decoder configuration');
    return muxMp4({ width, height, fps, avcC: description, samples });
  }
  return muxWebm({ width, height, fps, codecId: config.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', samples });
}
