import { describe, expect, it } from "vitest";
import { ChunkScheduler, MAX_CHUNK_BYTES } from "./chunk-stream";

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("ChunkScheduler", () => {
  it("deduplicates requests and caches the payload", async () => {
    let calls = 0;
    const scheduler = new ChunkScheduler({
      maxResidentBytes: 100,
      fetchImpl: (async () => {
        calls++;
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
      }) as unknown as typeof fetch,
    });
    const first = scheduler.load("/chunk", { priority: 1 });
    const second = scheduler.load("/chunk", { priority: 5 });
    expect(await first).toEqual(await second);
    expect(calls).toBe(1);
    expect(scheduler.residentCount).toBe(1);
    await scheduler.load("/chunk");
    expect(calls).toBe(1);
  });

  it("prioritizes queued work and evicts by byte budget", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const scheduler = new ChunkScheduler({
      maxResidentBytes: 4,
      concurrency: 1,
      fetchImpl: (async (input: string | URL) => {
        const url = String(input);
        order.push(url);
        if (url === "/first") await blocked;
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response;
      }) as typeof fetch,
    });
    const first = scheduler.load("/first", { priority: 0 });
    await settle();
    const low = scheduler.load("/low", { priority: 0 });
    const high = scheduler.load("/high", { priority: 10 });
    release();
    await Promise.all([first, low, high]);
    expect(order).toEqual(["/first", "/high", "/low"]);
    expect(scheduler.residentBytes).toBe(3);
    expect(scheduler.residentCount).toBe(1);
  });

  it("rejects payloads above the hard chunk limit", async () => {
    const scheduler = new ChunkScheduler({
      maxResidentBytes: MAX_CHUNK_BYTES,
      fetchImpl: (async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(MAX_CHUNK_BYTES + 1),
      })) as unknown as typeof fetch,
    });
    await expect(scheduler.load("/too-large")).rejects.toThrow(/limit/);
    await settle();
    expect(scheduler.residentCount).toBe(0);
  });

  it("cancels queued requests before they fetch", async () => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    const fetched: string[] = [];
    const scheduler = new ChunkScheduler({
      maxResidentBytes: 100,
      concurrency: 1,
      fetchImpl: (async (input: string | URL) => {
        fetched.push(String(input));
        if (String(input) === "/first") await started;
        return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer } as Response;
      }) as unknown as typeof fetch,
    });
    const first = scheduler.load("/first");
    const controller = new AbortController();
    const queued = scheduler.load("/queued", { signal: controller.signal });
    controller.abort();
    release();
    await first;
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(fetched).toEqual(["/first"]);
  });
});
