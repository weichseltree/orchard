import {
  CHUNK_HEADER_BYTES,
  CHUNK_MAGIC,
  chunkByteLength,
  frameOffset,
} from "./format";

/** One frame's three parallel arrays, as the encoder wants them. */
export interface EncodableFrame {
  /** `n * 3` already-quantized coordinates. */
  positions: Uint16Array;
  /** `n` species indices; all zero when the tape has no species channel. */
  species: Uint8Array;
  /** `n` liveness flags, 1 or 0. */
  alive: Uint8Array;
}

export interface EncodeChunkOptions {
  n: number;
  /** Tape-wide index of the first frame in this chunk. */
  frame0: number;
  /** Tape time of the first frame, tau. */
  t0: number;
  /** Time between frames, tau. */
  dt: number;
  frames: readonly EncodableFrame[];
}

/**
 * Writes one chunk file. The dev generator and the decoder test both go
 * through here, so the bytes the tests check are the bytes the app reads.
 */
export function encodeChunk(options: EncodeChunkOptions): Uint8Array {
  const { n, frame0, t0, dt, frames } = options;
  if (n <= 0) throw new RangeError(`n must be positive, got ${n}`);
  if (frames.length === 0) throw new RangeError("a chunk needs at least one frame");
  const out = new Uint8Array(chunkByteLength(n, frames.length));
  out.set(CHUNK_MAGIC, 0);
  const header = new DataView(out.buffer, 0, CHUNK_HEADER_BYTES);
  header.setUint32(4, n, true);
  header.setUint32(8, frames.length, true);
  header.setUint32(12, frame0, true);
  header.setFloat32(16, t0, true);
  header.setFloat32(20, dt, true);
  // bytes 24..31 stay zero: reserved.

  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f] as EncodableFrame;
    if (frame.positions.length !== n * 3) {
      throw new RangeError(`frame ${f} has ${frame.positions.length} coordinates, expected ${n * 3}`);
    }
    if (frame.species.length !== n || frame.alive.length !== n) {
      throw new RangeError(`frame ${f} has ${frame.species.length}/${frame.alive.length} species/alive, expected ${n}`);
    }
    const base = frameOffset(n, f);
    // Little-endian by definition of the format; write bytes rather than
    // typed-array .set so the generator produces identical files on any host.
    for (let i = 0; i < n * 3; i++) {
      const q = frame.positions[i] as number;
      out[base + i * 2] = q & 0xff;
      out[base + i * 2 + 1] = (q >> 8) & 0xff;
    }
    out.set(frame.species, base + n * 6);
    out.set(frame.alive, base + n * 7);
  }
  return out;
}
