import { describe, expect, it } from "vitest";
import { TapeChunk, TapeDecodeError } from "./decode";
import { syntheticTape, thin } from "./devtape";
import { encodeChunk } from "./encode";
import {
  BYTES_PER_SLOT,
  CHUNK_HEADER_BYTES,
  chunkByteLength,
  dequantize,
  frameOffset,
  frameStride,
  quantize,
} from "./format";

// The decoder is checked against bytes the dev generator produced, not against
// the decoder's own idea of the format: encode with one module, decode with
// the other, and assert the numbers in docs/specs/M0-hall.md by hand.

const BOX = [40, 40, 1] as const;

function fixture(slots = 32, frames = 5, frame0 = 0, t0 = 0, dt = 0.5) {
  const tape = syntheticTape({ slots, frames: frames + frame0, box: BOX, dtTau: dt, seed: 7 });
  const encodable = [];
  for (let i = 0; i < frames; i++) encodable.push(tape.frame(frame0 + i));
  const bytes = encodeChunk({ n: slots, frame0, t0, dt, frames: encodable });
  return { tape, encodable, bytes };
}

describe("chunk layout", () => {
  it("puts the header fields where the spec says", () => {
    const { bytes } = fixture(4, 3, 60, 30, 0.5);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("OTC1");
    expect(view.getUint32(4, true)).toBe(4); // n
    expect(view.getUint32(8, true)).toBe(3); // frames
    expect(view.getUint32(12, true)).toBe(60); // first frame index
    expect(view.getFloat32(16, true)).toBeCloseTo(30);
    expect(view.getFloat32(20, true)).toBeCloseTo(0.5);
    for (let i = 24; i < 32; i++) expect(bytes[i]).toBe(0); // reserved, zero
  });

  it("uses a frame stride of n x 8 bytes", () => {
    expect(frameStride(4000)).toBe(32000);
    expect(BYTES_PER_SLOT).toBe(8);
    expect(frameOffset(4000, 0)).toBe(CHUNK_HEADER_BYTES);
    expect(frameOffset(4000, 1)).toBe(CHUNK_HEADER_BYTES + 32000);
    const { bytes } = fixture(4000, 2);
    expect(bytes.byteLength).toBe(chunkByteLength(4000, 2));
    expect(bytes.byteLength).toBe(32 + 2 * 4000 * 8);
  });

  it("orders each frame as positions, then species, then alive", () => {
    const n = 3;
    const positions = Uint16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const species = Uint8Array.from([0, 1, 0]);
    const alive = Uint8Array.from([1, 0, 1]);
    const bytes = encodeChunk({ n, frame0: 0, t0: 0, dt: 1, frames: [{ positions, species, alive }] });
    const base = CHUNK_HEADER_BYTES;
    // little-endian u16 x 3 x n
    expect([...bytes.subarray(base, base + n * 6)]).toEqual([
      1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0,
    ]);
    expect([...bytes.subarray(base + n * 6, base + n * 7)]).toEqual([0, 1, 0]);
    expect([...bytes.subarray(base + n * 7, base + n * 8)]).toEqual([1, 0, 1]);
  });
});

describe("TapeChunk.decode", () => {
  it("reads back every frame the generator wrote", () => {
    const { encodable, bytes } = fixture(64, 6, 120, 60, 0.25);
    const chunk = TapeChunk.decode(bytes.buffer.slice(0) as ArrayBuffer);
    expect(chunk.n).toBe(64);
    expect(chunk.frames).toBe(6);
    expect(chunk.frame0).toBe(120);
    expect(chunk.t0).toBeCloseTo(60);
    expect(chunk.dt).toBeCloseTo(0.25);
    for (let i = 0; i < 6; i++) {
      const decoded = chunk.localFrame(i);
      const source = encodable[i]!;
      expect([...decoded.positions]).toEqual([...source.positions]);
      expect([...decoded.species]).toEqual([...source.species]);
      expect([...decoded.alive]).toEqual([...source.alive]);
      expect(chunk.timeOf(i)).toBeCloseTo(60 + i * 0.25);
    }
  });

  it("addresses frames by their tape-wide index", () => {
    const { bytes } = fixture(8, 4, 40, 20, 0.5);
    const chunk = TapeChunk.decode(bytes.buffer.slice(0) as ArrayBuffer);
    expect(chunk.holds(39)).toBe(false);
    expect(chunk.holds(40)).toBe(true);
    expect(chunk.holds(43)).toBe(true);
    expect(chunk.holds(44)).toBe(false);
    expect(chunk.frameAt(44)).toBeNull();
    expect(chunk.frameAt(42)).toBe(chunk.localFrame(2));
  });

  it("hands out the same frame view twice, so stepping allocates nothing", () => {
    const { bytes } = fixture(8, 3);
    const chunk = TapeChunk.decode(bytes.buffer.slice(0) as ArrayBuffer);
    expect(chunk.localFrame(1)).toBe(chunk.localFrame(1));
  });

  it("keeps a dead slot's last position and marks it not alive", () => {
    const tape = syntheticTape({ slots: 200, frames: 60, box: BOX, dtTau: 0.5, seed: 3 });
    const frames = [];
    for (let i = 0; i < 60; i++) frames.push(tape.frame(i));
    const bytes = encodeChunk({ n: 200, frame0: 0, t0: 0, dt: 0.5, frames });
    const chunk = TapeChunk.decode(bytes.buffer.slice(0) as ArrayBuffer);
    let checked = 0;
    for (let slot = 0; slot < 200; slot++) {
      let died = -1;
      for (let f = 0; f < 60; f++) {
        if (chunk.localFrame(f).alive[slot] === 0) {
          died = f;
          break;
        }
      }
      if (died <= 0) continue;
      checked++;
      const at = chunk.localFrame(died);
      const last = chunk.localFrame(60 - 1);
      for (let axis = 0; axis < 3; axis++) {
        expect(last.positions[slot * 3 + axis]).toBe(at.positions[slot * 3 + axis]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("refuses bytes that are not a chunk", () => {
    const bad = new Uint8Array(64);
    bad.set([0x4f, 0x54, 0x43, 0x30]); // OTC0
    expect(() => TapeChunk.decode(bad.buffer as ArrayBuffer)).toThrow(TapeDecodeError);
    expect(() => TapeChunk.decode(new ArrayBuffer(8))).toThrow(/shorter than/);
  });

  it("refuses a truncated chunk rather than reading past the end", () => {
    const { bytes } = fixture(16, 4);
    const truncated = bytes.slice(0, bytes.byteLength - 9);
    expect(() => TapeChunk.decode(truncated.buffer.slice(0) as ArrayBuffer)).toThrow(/needs/);
  });
});

describe("quantization", () => {
  it("maps [0, L) onto [0, 65535] and back within half a step", () => {
    for (const value of [0, 1.25, 19.999, 39.5]) {
      const q = quantize(value, 40);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(65535);
      expect(dequantize(q, 40)).toBeCloseTo(value, 3);
    }
    expect(quantize(-5, 40)).toBe(0);
    expect(quantize(100, 40)).toBe(65535);
  });

  it("writes z = 0 for every slot of a 2D tape", () => {
    const tape = syntheticTape({ slots: 50, frames: 3, box: [40, 40, 1], dtTau: 0.5, seed: 1 });
    const frame = tape.frame(2);
    for (let i = 0; i < 50; i++) expect(frame.positions[i * 3 + 2]).toBe(0);
  });
});

describe("variants", () => {
  it("thins frames and slots the way the phone variant does", () => {
    const tape = syntheticTape({ slots: 40, frames: 10, box: BOX, dtTau: 0.5, seed: 5 });
    const phone = thin(tape, 2, 2);
    expect(phone.slots).toBe(20);
    expect(phone.frames).toBe(5);
    expect(phone.dtTau).toBeCloseTo(1);
    const full = tape.frame(4);
    const thinned = phone.frame(2);
    for (let i = 0; i < 20; i++) {
      expect(thinned.positions[i * 3]).toBe(full.positions[i * 2 * 3]);
      expect(thinned.alive[i]).toBe(full.alive[i * 2]);
    }
  });
});
