import {
  BYTES_PER_SLOT,
  CHUNK_HEADER_BYTES,
  CHUNK_MAGIC,
  chunkByteLength,
  frameOffset,
} from "./format";

/**
 * One frame's three parallel arrays, as views straight onto the chunk buffer.
 * They are owned by the chunk and reused: copy out of them, never keep them
 * past the next chunk eviction, and never write into them.
 */
export interface TapeFrame {
  /** `n * 3` quantized coordinates, x0 y0 z0 x1 y1 z1 ... */
  readonly positions: Uint16Array;
  /** `n` species indices. */
  readonly species: Uint8Array;
  /** `n` liveness flags, 1 or 0. */
  readonly alive: Uint8Array;
}

export class TapeDecodeError extends Error {
  override name = "TapeDecodeError";
}

/**
 * Is this host little-endian? Every browser target is, but the format is
 * defined little-endian, so a big-endian host has to byte-swap once at decode
 * rather than read the positions backwards for the life of the chunk.
 */
const LITTLE_ENDIAN: boolean = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

/**
 * A decoded chunk. Decoding costs a header read and, on a little-endian host,
 * nothing else: the frame arrays are views onto the fetched bytes. Frame views
 * are built once each and cached, so stepping through a chunk allocates
 * nothing after the first pass.
 */
export class TapeChunk {
  readonly n: number;
  readonly frames: number;
  readonly frame0: number;
  readonly t0: number;
  readonly dt: number;
  /** Bytes this chunk holds resident, for the budget overlay. */
  readonly byteLength: number;

  readonly #buffer: ArrayBuffer;
  readonly #offset: number;
  readonly #views: Array<TapeFrame | undefined>;

  private constructor(
    buffer: ArrayBuffer,
    offset: number,
    n: number,
    frames: number,
    frame0: number,
    t0: number,
    dt: number,
  ) {
    this.#buffer = buffer;
    this.#offset = offset;
    this.n = n;
    this.frames = frames;
    this.frame0 = frame0;
    this.t0 = t0;
    this.dt = dt;
    this.byteLength = chunkByteLength(n, frames);
    this.#views = new Array<TapeFrame | undefined>(frames);
  }

  static decode(input: ArrayBuffer | ArrayBufferView): TapeChunk {
    // A view's .buffer is ArrayBufferLike; a chunk never arrives on shared
    // memory, and the narrowing keeps the u16 views below honest.
    const buffer = (ArrayBuffer.isView(input) ? input.buffer : input) as ArrayBuffer;
    const offset = ArrayBuffer.isView(input) ? input.byteOffset : 0;
    const length = ArrayBuffer.isView(input) ? input.byteLength : input.byteLength;
    if (length < CHUNK_HEADER_BYTES) {
      throw new TapeDecodeError(`chunk is ${length} bytes, shorter than the ${CHUNK_HEADER_BYTES}-byte header`);
    }
    const bytes = new Uint8Array(buffer, offset, length);
    for (let i = 0; i < CHUNK_MAGIC.length; i++) {
      if (bytes[i] !== CHUNK_MAGIC[i]) {
        throw new TapeDecodeError(`bad magic: expected OTC1, got ${JSON.stringify(textOf(bytes.subarray(0, 4)))}`);
      }
    }
    const header = new DataView(buffer, offset, CHUNK_HEADER_BYTES);
    const n = header.getUint32(4, true);
    const frames = header.getUint32(8, true);
    const frame0 = header.getUint32(12, true);
    const t0 = header.getFloat32(16, true);
    const dt = header.getFloat32(20, true);
    if (n === 0 || frames === 0) {
      throw new TapeDecodeError(`empty chunk: n=${n} frames=${frames}`);
    }
    const need = chunkByteLength(n, frames);
    if (length < need) {
      throw new TapeDecodeError(`chunk is ${length} bytes, needs ${need} for ${frames} frames of ${n} slots`);
    }
    // A misaligned start would make the u16 position views impossible; the
    // header is 32 bytes and the frame stride is 8n, so only the caller's own
    // offset can break it.
    if ((offset + CHUNK_HEADER_BYTES) % 2 !== 0) {
      throw new TapeDecodeError("chunk must start on an even byte offset");
    }
    if (!LITTLE_ENDIAN) swapPositionsInPlace(bytes, n, frames);
    return new TapeChunk(buffer, offset, n, frames, frame0, t0, dt);
  }

  /** True when `frame` (a tape-wide frame index) lives in this chunk. */
  holds(frame: number): boolean {
    return frame >= this.frame0 && frame < this.frame0 + this.frames;
  }

  /** The frame at a tape-wide index, or `null` when this chunk does not hold it. */
  frameAt(frame: number): TapeFrame | null {
    return this.holds(frame) ? this.localFrame(frame - this.frame0) : null;
  }

  /** The frame at an index local to this chunk, 0 .. frames-1. */
  localFrame(i: number): TapeFrame {
    if (i < 0 || i >= this.frames) throw new RangeError(`frame ${i} outside chunk of ${this.frames}`);
    const cached = this.#views[i];
    if (cached) return cached;
    const base = this.#offset + frameOffset(this.n, i);
    const view: TapeFrame = {
      positions: new Uint16Array(this.#buffer, base, this.n * 3),
      species: new Uint8Array(this.#buffer, base + this.n * 6, this.n),
      alive: new Uint8Array(this.#buffer, base + this.n * 7, this.n),
    };
    this.#views[i] = view;
    return view;
  }

  /** Tape time of a frame local to this chunk, in tau. */
  timeOf(i: number): number {
    return this.t0 + i * this.dt;
  }
}

function textOf(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
  return out;
}

/** Big-endian hosts only: swap every position u16 once, in place. */
function swapPositionsInPlace(bytes: Uint8Array, n: number, frames: number): void {
  const stride = n * BYTES_PER_SLOT;
  for (let f = 0; f < frames; f++) {
    const base = CHUNK_HEADER_BYTES + f * stride;
    for (let i = 0; i < n * 6; i += 2) {
      const a = base + i;
      const lo = bytes[a] as number;
      bytes[a] = bytes[a + 1] as number;
      bytes[a + 1] = lo;
    }
  }
}
