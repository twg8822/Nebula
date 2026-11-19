// Minimal MP4 (ISO BMFF) writer for one H.264 video track. No dependencies.
//
// WebCodecs' VideoEncoder with `avc: { format: 'avc' }` emits length-prefixed
// NAL units (exactly what MP4 stores) plus an avcC record in its decoder
// config. This file wraps them as a "fast start" MP4: ftyp, moov (all the
// sample tables), then one mdat holding every frame back to back, i.e. a
// single chunk. That's the plainest layout every player, Wallpaper Engine
// included, can read.

const enc = new TextEncoder();

/** Build a box: 32-bit size + 4-char type + payload parts (Uint8Array or number[]). */
function box(type, ...parts) {
  const bytes = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const size = 8 + bytes.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(enc.encode(type), 4);
  let o = 8;
  for (const b of bytes) { out.set(b, o); o += b.length; }
  return out;
}

/** Full box: box with a version byte and 24-bit flags before the payload. */
const fullBox = (type, version, flags, ...parts) =>
  box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const zeros = (n) => new Array(n).fill(0);
// Identity transform matrix (16.16 / 2.30 fixed point), shared by mvhd and tkhd.
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0),
  ...u32(0), ...u32(0), ...u32(0x40000000)];

/**
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.fps          frames per second (constant frame rate)
 * @param {Uint8Array} o.avcC     AVCDecoderConfigurationRecord (decoderConfig.description)
 * @param {{data: Uint8Array, key: boolean}[]} o.samples  encoded frames in order
 * @returns {Blob} video/mp4
 */
export function muxMp4({ width, height, fps, avcC, samples }) {
  if (!samples.length) throw new Error('No frames to write');
  const timescale = Math.round(fps * 1000);  // media ticks per second
  const delta = 1000;                        // ticks per frame
  const count = samples.length;
  const mediaDuration = count * delta;
  const movieDuration = Math.round((count / fps) * 1000);  // mvhd/tkhd use 1/1000 s

  const moov = (mdatOffset) => box('moov',
    fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDuration),
      u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box('trak',
      fullBox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDuration),
        zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(mediaDuration), u16(0x55c4), u16(0)),
        fullBox('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('VideoHandler\0')),
        box('minf',
          fullBox('vmhd', 0, 1, u16(0), zeros(6)),
          box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
          box('stbl',
            fullBox('stsd', 0, 0, u32(1),
              box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height),
                u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff),
                box('avcC', avcC))),
            fullBox('stts', 0, 0, u32(1), u32(count), u32(delta)),
            fullBox('stss', 0, 0, ...syncTable(samples)),
            fullBox('stsc', 0, 0, u32(1), u32(1), u32(count), u32(1)),
            fullBox('stsz', 0, 0, u32(0), u32(count), ...samples.map((s) => u32(s.data.length))),
            fullBox('stco', 0, 0, u32(1), u32(mdatOffset)))))));

  const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isomiso2avc1mp41'));
  // The chunk offset doesn't change moov's size, so measure once, then build for real.
  const moovSize = moov(0).length;
  const mdatHeader = 8;
  const moovBox = moov(ftyp.length + moovSize + mdatHeader);
  const payload = samples.reduce((n, s) => n + s.data.length, 0);
  const mdatHead = new Uint8Array(mdatHeader);
  new DataView(mdatHead.buffer).setUint32(0, mdatHeader + payload);
  mdatHead.set(enc.encode('mdat'), 4);
  return new Blob([ftyp, moovBox, mdatHead, ...samples.map((s) => s.data)], { type: 'video/mp4' });
}

/** stss payload: number of sync (key) samples, then their 1-based indices. */
function syncTable(samples) {
  const keys = [];
  samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
  return [u32(keys.length), ...keys.map(u32)];
}
