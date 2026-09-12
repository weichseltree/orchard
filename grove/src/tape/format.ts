// The wire format of a tape chunk, exactly as docs/specs/M0-hall.md defines it.
//
// | offset | type      | meaning                                            |
// |--------|-----------|----------------------------------------------------|
// | 0      | char[4]   | magic `OTC1`                                       |
// | 4      | u32       | n (slots in this variant)                          |
// | 8      | u32       | frames in this chunk                               |
// | 12     | u32       | first frame index                                  |
// | 16     | f32       | tape time of the first frame (tau)                 |
// | 20     | f32       | dt between frames (tau)                            |
// | 24     | u8[8]     | reserved, zero                                     |
// | 32     | frames x (u16[3]*n, u8*n, u8*n) | positions, species, alive      |
//
// Everything is little-endian. Positions quantize [0, L) per axis onto
// [0, 65535]; a 2D tape has z = 0 for every slot and Lz = 1.

/** `OTC1`, as bytes. */
export const CHUNK_MAGIC = Uint8Array.from([0x4f, 0x54, 0x43, 0x31]);
export const CHUNK_MAGIC_TEXT = "OTC1";
export const CHUNK_HEADER_BYTES = 32;
/** Bytes one slot costs in one frame: 3 x u16 position + u8 species + u8 alive. */
export const BYTES_PER_SLOT = 8;
/** The largest value a quantized position axis can take. */
export const POSITION_MAX = 65535;

/** Bytes between the start of one frame and the start of the next: n x 8. */
export function frameStride(n: number): number {
  return n * BYTES_PER_SLOT;
}

/** Byte offset of frame `i` (local to the chunk) from the start of the chunk. */
export function frameOffset(n: number, i: number): number {
  return CHUNK_HEADER_BYTES + i * frameStride(n);
}

/** Total size of a chunk file holding `frames` frames of `n` slots. */
export function chunkByteLength(n: number, frames: number): number {
  return CHUNK_HEADER_BYTES + frames * frameStride(n);
}

/**
 * Quantize one axis coordinate in [0, L) onto [0, 65535].
 * Out-of-range input is clamped rather than wrapped: a periodic tape is
 * expected to have been folded into the box by the producer.
 */
export function quantize(value: number, length: number): number {
  if (!(length > 0)) return 0;
  const q = Math.round((value / length) * POSITION_MAX);
  return q < 0 ? 0 : q > POSITION_MAX ? POSITION_MAX : q;
}

/** The inverse of {@link quantize}, in tape units. */
export function dequantize(q: number, length: number): number {
  return (q / POSITION_MAX) * length;
}
