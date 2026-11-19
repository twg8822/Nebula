// Structural tests for the hand-written video containers in js/wallpaper/.
// They don't decode video (that needs a codec); they check that every size
// and offset in the file points where it should.
//   node --test tests/*.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { muxMp4 } from '../js/wallpaper/mp4.js';
import { muxWebm } from '../js/wallpaper/webm.js';

// Fake encoded frames: distinct bytes so offsets can be checked.
const samples = Array.from({ length: 7 }, (_, i) => ({
  data: Uint8Array.from({ length: 10 + i }, (_, j) => (i * 31 + j) & 255),
  key: i % 3 === 0,
}));
const AVCC = Uint8Array.from([1, 0x64, 0, 0x33, 0xff, 0xe1, 0, 0]);

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const str = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const u32 = (b, o) => new DataView(b.buffer, b.byteOffset).getUint32(o);

/** Walk sibling boxes in [start, end); returns [{type, start, size}]. */
function boxes(b, start, end) {
  const out = [];
  for (let o = start; o < end;) {
    const size = u32(b, o);
    assert.ok(size >= 8 && o + size <= end, `box at ${o} has bad size ${size}`);
    out.push({ type: str(b, o + 4, 4), start: o, size });
    o += size;
  }
  return out;
}
const child = (b, parent, type, headerExtra = 0) =>
  boxes(b, parent.start + 8 + headerExtra, parent.start + parent.size).find((x) => x.type === type);

describe('MP4 writer', () => {
  test('top level is ftyp, moov, mdat and the sizes add up to the file', async () => {
    const b = await bytesOf(muxMp4({ width: 64, height: 36, fps: 30, avcC: AVCC, samples }));
    const top = boxes(b, 0, b.length);
    assert.deepEqual(top.map((x) => x.type), ['ftyp', 'moov', 'mdat']);
  });

  test('sample table: count, sizes, keyframes and the chunk offset all match the data', async () => {
    const b = await bytesOf(muxMp4({ width: 64, height: 36, fps: 30, avcC: AVCC, samples }));
    const [, moov, mdat] = boxes(b, 0, b.length);
    const stbl = child(b, child(b, child(b, child(b, moov, 'trak'), 'mdia'), 'minf'), 'stbl');
    const stsz = child(b, stbl, 'stsz');
    assert.equal(u32(b, stsz.start + 16), samples.length);
    samples.forEach((s, i) => assert.equal(u32(b, stsz.start + 20 + 4 * i), s.data.length));
    const stss = child(b, stbl, 'stss');
    assert.deepEqual([0, 1, 2].map((i) => u32(b, stss.start + 16 + 4 * i)), [1, 4, 7]);
    // stco points at the first frame's bytes inside mdat.
    const offset = u32(b, child(b, stbl, 'stco').start + 16);
    assert.equal(offset, mdat.start + 8);
    assert.deepEqual(b.subarray(offset, offset + samples[0].data.length), samples[0].data);
    const last = samples.at(-1).data;
    assert.deepEqual(b.subarray(b.length - last.length), last);
  });

  test('duration and frame timing match the frame rate', async () => {
    const b = await bytesOf(muxMp4({ width: 64, height: 36, fps: 30, avcC: AVCC, samples }));
    const moov = boxes(b, 0, b.length)[1];
    const mdhd = child(b, child(b, child(b, moov, 'trak'), 'mdia'), 'mdhd');
    const timescale = u32(b, mdhd.start + 20);
    const duration = u32(b, mdhd.start + 24);
    assert.equal(duration / timescale, samples.length / 30);
  });

  test('refuses an empty clip', () => {
    assert.throws(() => muxMp4({ width: 64, height: 36, fps: 30, avcC: AVCC, samples: [] }));
  });
});

describe('WebM writer', () => {
  test('EBML header, then a Segment whose size covers the rest of the file', async () => {
    const b = await bytesOf(muxWebm({ width: 64, height: 36, fps: 30, codecId: 'V_VP9', samples }));
    assert.deepEqual([...b.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    // Sizes are 8-byte vints (0x01 + 7 bytes).
    const vsize = (o) => { assert.equal(b[o], 0x01); let v = 0; for (let i = 1; i < 8; i++) v = v * 256 + b[o + i]; return v; };
    const headerEnd = 4 + 8 + vsize(4);
    assert.deepEqual([...b.subarray(headerEnd, headerEnd + 4)], [0x18, 0x53, 0x80, 0x67]);
    assert.equal(headerEnd + 4 + 8 + vsize(headerEnd + 4), b.length);
  });

  test('every frame is stored once, keyframes flagged, codec named', async () => {
    const b = await bytesOf(muxWebm({ width: 64, height: 36, fps: 30, codecId: 'V_VP9', samples }));
    const text = String.fromCharCode(...b);
    assert.ok(text.includes('V_VP9') && text.includes('webm'));
    let found = 0;
    for (const s of samples) {
      const needle = String.fromCharCode(...s.data);
      const at = text.indexOf(needle);
      assert.ok(at > 4, 'frame data present');
      assert.equal(b[at - 1], s.key ? 0x80 : 0x00, 'SimpleBlock keyframe flag');
      found++;
    }
    assert.equal(found, samples.length);
    // One cluster per keyframe.
    const clusters = text.split(String.fromCharCode(0x1f, 0x43, 0xb6, 0x75)).length - 1;
    assert.equal(clusters, samples.filter((s) => s.key).length);
  });
});
