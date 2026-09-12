import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TapeVariant } from "./bundle";
import { syntheticTape } from "./devtape";
import { encodeChunk } from "./encode";
import { TapeStream } from "./stream";

// "Each chunk is independently fetchable and decodable; the client keeps at
// most 3 chunks resident." Both halves get a test, against bytes the dev
// generator produced.

const SLOTS = 16;
const CHUNK_FRAMES = 4;
const CHUNKS = 6;

function build(digests = false): { variant: TapeVariant; files: Map<string, Uint8Array>; fetches: string[] } {
  const tape = syntheticTape({
    slots: SLOTS,
    frames: CHUNK_FRAMES * CHUNKS,
    box: [40, 40, 1],
    dtTau: 0.5,
    seed: 11,
  });
  const files = new Map<string, Uint8Array>();
  const chunks = [];
  for (let index = 0; index < CHUNKS; index++) {
    const frame0 = index * CHUNK_FRAMES;
    const frames = [];
    for (let i = 0; i < CHUNK_FRAMES; i++) frames.push(tape.frame(frame0 + i));
    const bytes = encodeChunk({ n: SLOTS, frame0, t0: frame0 * 0.5, dt: 0.5, frames });
    const file = `vr-high/c${String(index).padStart(4, "0")}.bin`;
    files.set(file, bytes);
    const sha256 = digests ? createHash("sha256").update(bytes).digest("hex") : "";
    chunks.push({ file, frame0, frames: CHUNK_FRAMES, sha256 });
  }
  return {
    variant: {
      frames: CHUNK_FRAMES * CHUNKS,
      frame_stride: 1,
      slot_stride: 1,
      dt_tau: 0.5,
      t0_tau: 0,
      chunk_frames: CHUNK_FRAMES,
      bytes: 0,
      chunks,
    },
    files,
    fetches: [],
  };
}

function streamOf(
  options: { digests?: boolean; corrupt?: string; transportVerifies?: boolean; errors?: string[] } = {},
): { stream: TapeStream; fetches: string[] } {
  const { variant, files, fetches } = build(options.digests);
  if (options.corrupt) {
    const bytes = files.get(options.corrupt)!.slice();
    bytes[bytes.length - 1]! ^= 0xff;
    files.set(options.corrupt, bytes);
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    fetches.push(url);
    const name = url.replace("https://media.test/x/", "");
    const bytes = files.get(name);
    if (!bytes) return { ok: false, status: 404 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    stream: new TapeStream({
      baseUrl: "https://media.test/x/",
      variant,
      maxResident: 3,
      fetchImpl,
      ...(options.transportVerifies !== undefined
        ? { transportVerifies: () => options.transportVerifies! }
        : {}),
      ...(options.errors ? { onError: (e: Error) => options.errors!.push(e.message) } : {}),
    }),
    fetches,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("TapeStream", () => {
  it("maps a frame to its chunk from the chunk list", () => {
    const { stream } = streamOf();
    expect(stream.chunkIndexOf(0)).toBe(0);
    expect(stream.chunkIndexOf(3)).toBe(0);
    expect(stream.chunkIndexOf(4)).toBe(1);
    expect(stream.chunkIndexOf(23)).toBe(5);
    expect(stream.chunkIndexOf(24)).toBe(-1);
  });

  it("returns null while a chunk is in flight and the frame once it lands", async () => {
    const { stream } = streamOf();
    expect(stream.frame(0)).toBeNull();
    await settle();
    const frame = stream.frame(0);
    expect(frame).not.toBeNull();
    expect(frame!.positions).toHaveLength(SLOTS * 3);
    expect(frame!.alive).toHaveLength(SLOTS);
  });

  it("keeps at most three chunks resident, evicting the least recently used", async () => {
    const { stream } = streamOf();
    for (let chunk = 0; chunk < CHUNKS; chunk++) {
      stream.frame(chunk * CHUNK_FRAMES);
      await settle();
      await settle();
      expect(stream.residentCount).toBeLessThanOrEqual(3);
    }
    expect(stream.residentCount).toBe(3);
    expect(stream.stats.fetched).toBe(CHUNKS);
    // The chunk just played is still there; the first one is long gone.
    expect(stream.frame(CHUNKS * CHUNK_FRAMES - 1)).not.toBeNull();
    expect(stream.frame(0)).toBeNull();
  });

  it("fetches each chunk once while it stays resident", async () => {
    const { stream, fetches } = streamOf();
    stream.frame(0);
    await settle();
    for (let i = 0; i < CHUNK_FRAMES; i++) stream.frame(i);
    await settle();
    const c0 = fetches.filter((url) => url.endsWith("c0000.bin"));
    expect(c0).toHaveLength(1);
  });

  it("warms the next chunk before the playhead reaches it", async () => {
    const { stream, fetches } = streamOf();
    stream.frame(3); // last frame of chunk 0
    await settle();
    expect(fetches.some((url) => url.endsWith("c0001.bin"))).toBe(true);
  });

  it("reports a failed chunk instead of throwing into the frame loop", async () => {
    const { variant } = build();
    const errors: string[] = [];
    const stream = new TapeStream({
      baseUrl: "https://media.test/x/",
      variant,
      fetchImpl: (async () => ({ ok: false, status: 503 }) as unknown as Response) as unknown as typeof fetch,
      onError: (error) => errors.push(error.message),
    });
    stream.frame(0);
    await settle();
    expect(stream.frame(0)).toBeNull();
    expect(errors[0]).toMatch(/503/);
    expect(stream.stats.failed).toBeGreaterThan(0);
  });

  it("waits before asking again for a chunk that failed, instead of every frame", async () => {
    const { variant } = build();
    let calls = 0;
    const stream = new TapeStream({
      baseUrl: "https://media.test/x/",
      variant,
      fetchImpl: (async () => {
        calls++;
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      onError: () => undefined,
    });
    stream.frame(0);
    await settle();
    for (let i = 0; i < 10; i++) {
      stream.frame(0);
      await settle();
    }
    expect(calls).toBe(1);
  });

  // Hashing is a Web Crypto promise, a few macrotasks in node.
  const landed = async () => {
    for (let i = 0; i < 5; i++) await settle();
  };

  it("decodes a chunk whose sha256 matches bundle.json", async () => {
    const errors: string[] = [];
    const { stream } = streamOf({ digests: true, errors });
    stream.frame(0);
    await landed();
    expect(stream.frame(0)).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it("refuses a chunk whose bytes are not the ones bundle.json names", async () => {
    const errors: string[] = [];
    const { stream } = streamOf({ digests: true, corrupt: "vr-high/c0000.bin", errors });
    stream.frame(0);
    await landed();
    expect(stream.frame(0)).toBeNull();
    expect(errors[0]).toMatch(/c0000\.bin: sha256 does not match/);
    expect(stream.stats.failed).toBe(1);
  });

  it("leaves the check to a service worker that already made it", async () => {
    const errors: string[] = [];
    const { stream } = streamOf({ digests: true, corrupt: "vr-high/c0000.bin", transportVerifies: true, errors });
    stream.frame(0);
    await landed();
    // The worker would have refused these bytes; the stream does not hash twice.
    expect(errors).toEqual([]);
    expect(stream.stats.fetched).toBe(1);
  });
});
