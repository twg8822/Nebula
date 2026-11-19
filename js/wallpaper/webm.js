// Minimal WebM (Matroska) writer for one VP8/VP9 video track. No dependencies.
//
// Layout: EBML header, then a Segment holding Info, Tracks and one Cluster
// per keyframe (each frame is a SimpleBlock). Sizes are all known up front
// because the whole clip is muxed at the end, so every element gets an exact
// size; there are no "unknown size" elements for players to stumble over.

const enc = new TextEncoder();

/** EBML variable-length size: always 8 bytes (marker 0x01 + 7 bytes), valid for any size. */
function vsize(n) {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

const cat = (parts) => {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Element: ID bytes (already including their length marker), size, payload. */
const el = (id, ...payload) => {
  const body = cat(payload.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))));
  return cat([Uint8Array.from(id), vsize(body.length), body]);
};

/** Unsigned integer payload, big-endian, minimal length. */
function uint(v) {
  const bytes = [];
  let x = v;
  do { bytes.unshift(x % 256); x = Math.floor(x / 256); } while (x > 0);
  return Uint8Array.from(bytes);
}

function float64(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return b;
}

const ID = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3], EBMLVersion: [0x42, 0x86], EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2], EBMLMaxSizeLength: [0x42, 0xf3], DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87], DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66], TimecodeScale: [0x2a, 0xd7, 0xb1], Duration: [0x44, 0x89],
  MuxingApp: [0x4d, 0x80], WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xae, 0x6b], TrackEntry: [0xae], TrackNumber: [0xd7], TrackUID: [0x73, 0xc5],
  TrackType: [0x83], FlagLacing: [0x9c], CodecID: [0x86], DefaultDuration: [0x23, 0xe3, 0x83],
  Video: [0xe0], PixelWidth: [0xb0], PixelHeight: [0xba],
  Cluster: [0x1f, 0x43, 0xb6, 0x75], Timecode: [0xe7], SimpleBlock: [0xa3],
};

/**
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.fps
 * @param {'V_VP9'|'V_VP8'} o.codecId
 * @param {{data: Uint8Array, key: boolean}[]} o.samples  encoded frames in order
 * @returns {Blob} video/webm
 */
export function muxWebm({ width, height, fps, codecId, samples }) {
  if (!samples.length) throw new Error('No frames to write');
  const msPerFrame = 1000 / fps;

  const header = el(ID.EBML,
    el(ID.EBMLVersion, uint(1)), el(ID.EBMLReadVersion, uint(1)),
    el(ID.EBMLMaxIDLength, uint(4)), el(ID.EBMLMaxSizeLength, uint(8)),
    el(ID.DocType, enc.encode('webm')), el(ID.DocTypeVersion, uint(2)), el(ID.DocTypeReadVersion, uint(2)));

  const info = el(ID.Info,
    el(ID.TimecodeScale, uint(1000000)),  // timecodes in milliseconds
    el(ID.Duration, float64(samples.length * msPerFrame)),
    el(ID.MuxingApp, enc.encode('NEBULA')), el(ID.WritingApp, enc.encode('NEBULA')));

  const tracks = el(ID.Tracks, el(ID.TrackEntry,
    el(ID.TrackNumber, uint(1)), el(ID.TrackUID, uint(1)), el(ID.TrackType, uint(1)),
    el(ID.FlagLacing, uint(0)), el(ID.CodecID, enc.encode(codecId)),
    el(ID.DefaultDuration, uint(Math.round(1e9 / fps))),
    el(ID.Video, el(ID.PixelWidth, uint(width)), el(ID.PixelHeight, uint(height)))));

  // A new cluster at every keyframe (block timecodes are 16-bit, relative to it).
  const clusters = [];
  let blocks = [];
  let clusterStart = 0;
  const flush = () => {
    if (blocks.length) clusters.push(el(ID.Cluster, el(ID.Timecode, uint(clusterStart)), ...blocks));
    blocks = [];
  };
  samples.forEach((s, i) => {
    const t = Math.round(i * msPerFrame);
    if (s.key || t - clusterStart > 30000) {
      flush();
      clusterStart = t;
    }
    const rel = t - clusterStart;
    const head = Uint8Array.from([0x81, (rel >> 8) & 255, rel & 255, s.key ? 0x80 : 0x00]);
    blocks.push(el(ID.SimpleBlock, head, s.data));
  });
  flush();

  // The Segment is written as its header plus the parts, so a long 4K clip
  // isn't copied into one giant array.
  const body = [info, tracks, ...clusters];
  const bodySize = body.reduce((n, p) => n + p.length, 0);
  const segmentHead = cat([Uint8Array.from(ID.Segment), vsize(bodySize)]);
  return new Blob([header, segmentHead, ...body], { type: 'video/webm' });
}
