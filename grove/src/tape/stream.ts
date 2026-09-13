import { canHash, isSha256, sha256Hex } from "../sw/digest";
import { pageIsControlled } from "../sw/register";
import type { ChunkRef, TapeVariant } from "./bundle";
import { TapeChunk, type TapeFrame } from "./decode";

/**
 * Streams a variant's chunks, keeping at most `maxResident` decoded (the spec
 * says 3). Each chunk is independently fetchable, so there is no range
 * request, no server and no session: R2 serves bytes and the browser caches
 * them.
 *
 * `frame()` never waits. It returns the frame if its chunk is resident and
 * `null` otherwise, having started the fetch. The render loop draws the last
 * good frame while a chunk lands, which is what keeps a scrub from stalling
 * the whole world.
 */
export interface TapeStreamOptions {
  /** Directory URL of the bundle, ending in a slash. */
  baseUrl: string;
  variant: TapeVariant;
  maxResident?: number;
  fetchImpl?: typeof fetch;
  onError?: (error: Error) => void;
  /**
   * True when something between here and R2 already checked each chunk's
   * sha256: the service worker does, for a page it controls. Otherwise the
   * stream hashes the chunk itself (a chunk is ~0.5 MB; cheap).
   */
  transportVerifies?: () => boolean;
}

interface Resident {
  chunk: TapeChunk;
  used: number;
}

export class TapeStream {
  readonly variant: TapeVariant;
  readonly maxResident: number;
  readonly frames: number;

  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #onError: ((error: Error) => void) | undefined;
  readonly #transportVerifies: () => boolean;
  readonly #resident = new Map<number, Resident>();
  readonly #inflight = new Map<number, AbortController>();
  /**
   * A chunk that failed is not asked for again before `at` (performance.now()),
   * the wait doubling from 1 s to 30 s. Without it a chunk that can never
   * load (a digest refused, a 404) is fetched again on every frame.
   */
  readonly #retry = new Map<number, { at: number; delay: number }>();
  #tick = 0;
  #lastFrame = -1;
  #disposed = false;
  #fetched = 0;
  #failed = 0;

  constructor(options: TapeStreamOptions) {
    this.variant = options.variant;
    this.maxResident = Math.max(1, options.maxResident ?? 3);
    this.frames = options.variant.frames;
    this.#baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#onError = options.onError;
    this.#transportVerifies = options.transportVerifies ?? pageIsControlled;
  }

  /** Index into `variant.chunks` for a tape-wide frame, or -1. */
  chunkIndexOf(frame: number): number {
    const chunks = this.variant.chunks;
    // The declared chunk_frames gives the answer in one step; the list is the
    // authority, so the guess is checked and only then trusted.
    const guess = Math.floor(frame / Math.max(1, this.variant.chunk_frames));
    const at = chunks[guess];
    if (at && frame >= at.frame0 && frame < at.frame0 + at.frames) return guess;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] as ChunkRef;
      if (frame >= c.frame0 && frame < c.frame0 + c.frames) return i;
    }
    return -1;
  }

  /**
   * The frame if it is resident, else null with its chunk requested.
   * Also warms the next chunk when the frame is near the end of this one.
   */
  frame(frame: number): TapeFrame | null {
    const index = this.chunkIndexOf(frame);
    if (index < 0) return null;
    this.request(index);
    const near = this.#nearIndex(frame, index);
    if (near >= 0 && near !== index) this.request(near);
    const resident = this.#resident.get(index);
    if (!resident) return null;
    resident.used = ++this.#tick;
    return resident.chunk.frameAt(frame);
  }

  /** Ask for a chunk without needing a frame out of it yet. */
  request(index: number): void {
    if (this.#disposed) return;
    if (this.#resident.has(index) || this.#inflight.has(index)) return;
    const retry = this.#retry.get(index);
    if (retry && performance.now() < retry.at) return;
    const ref = this.variant.chunks[index];
    if (!ref) return;
    const controller = new AbortController();
    this.#inflight.set(index, controller);
    void this.#load(index, ref, controller);
  }

  get residentCount(): number {
    return this.#resident.size;
  }

  get residentBytes(): number {
    let total = 0;
    for (const r of this.#resident.values()) total += r.chunk.byteLength;
    return total;
  }

  get inflightCount(): number {
    return this.#inflight.size;
  }

  get stats(): { fetched: number; failed: number; resident: number; bytes: number } {
    return {
      fetched: this.#fetched,
      failed: this.#failed,
      resident: this.#resident.size,
      bytes: this.residentBytes,
    };
  }

  dispose(): void {
    this.#disposed = true;
    for (const controller of this.#inflight.values()) controller.abort();
    this.#inflight.clear();
    this.#resident.clear();
  }

  async #load(index: number, ref: ChunkRef, controller: AbortController): Promise<void> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}${ref.file}`, {
        signal: controller.signal,
        // Chunks are content-addressed; the browser may keep them forever.
        cache: "force-cache",
      }).catch((error: unknown) => {
        // A network error (and the service worker's refusal of a bad digest
        // is one) says only "Failed to fetch"; say which chunk.
        throw new Error(`chunk ${ref.file}: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (!response.ok) throw new Error(`chunk ${ref.file}: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (this.#disposed) return;
      await this.#verify(ref, buffer);
      if (this.#disposed) return;
      const chunk = TapeChunk.decode(buffer);
      if (chunk.frame0 !== ref.frame0) {
        throw new Error(
          `chunk ${ref.file} says frame0=${chunk.frame0}, bundle.json says ${ref.frame0}`,
        );
      }
      if (chunk.frames !== ref.frames || (this.variant.n !== undefined && chunk.n !== this.variant.n)) {
        throw new Error(`chunk ${ref.file}: frame or slot count does not match bundle.json; not shown`);
      }
      const exactOrigin = this.variant.times_tau?.[ref.frame0];
      if (exactOrigin !== undefined && chunk.t0 !== Math.fround(exactOrigin)) {
        throw new Error(`chunk ${ref.file}: clock origin does not match recorded frame times; not shown`);
      }
      this.#resident.set(index, { chunk, used: ++this.#tick });
      this.#retry.delete(index);
      this.#fetched++;
      this.#evict();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#failed++;
      const delay = Math.min(30_000, (this.#retry.get(index)?.delay ?? 500) * 2);
      this.#retry.set(index, { at: performance.now() + delay, delay });
      this.#onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#inflight.delete(index);
    }
  }

  /**
   * Refuses a chunk whose bytes are not the ones bundle.json names. Skipped
   * when the service worker already checked (hashing twice buys nothing), when
   * the bundle names no digest, and outside a secure context, which has no
   * crypto.subtle (a LAN IP in `vite dev`).
   */
  async #verify(ref: ChunkRef, buffer: ArrayBuffer): Promise<void> {
    if (!isSha256(ref.sha256) || !canHash() || this.#transportVerifies()) return;
    if ((await sha256Hex(buffer)) !== ref.sha256.toLowerCase()) {
      throw new Error(`chunk ${ref.file}: sha256 does not match bundle.json; not shown`);
    }
  }

  /**
   * The chunk to warm next: the one ahead of the playhead, in the direction it
   * is actually moving. Warming both neighbours with only three slots costs a
   * fetch per chunk boundary in both directions — measured at roughly double
   * the traffic during ordinary forward playback of a four-chunk tape.
   */
  #nearIndex(frame: number, index: number): number {
    const ref = this.variant.chunks[index];
    if (!ref) return -1;
    const backwards = frame < this.#lastFrame;
    this.#lastFrame = frame;
    const into = frame - ref.frame0;
    if (!backwards && into > ref.frames * 0.6 && index + 1 < this.variant.chunks.length) {
      return index + 1;
    }
    if (backwards && into < ref.frames * 0.4 && index > 0) return index - 1;
    return -1;
  }

  #evict(): void {
    while (this.#resident.size > this.maxResident) {
      let oldest = -1;
      let oldestUsed = Number.POSITIVE_INFINITY;
      for (const [index, resident] of this.#resident) {
        if (resident.used < oldestUsed) {
          oldestUsed = resident.used;
          oldest = index;
        }
      }
      if (oldest < 0) return;
      this.#resident.delete(oldest);
    }
  }
}
