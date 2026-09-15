export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
export const RESIDENT_BUDGET_BYTES = {
  phone: 8 * 1024 * 1024,
  "vr-quest": 12 * 1024 * 1024,
  "vr-high": 24 * 1024 * 1024,
  desktop: 64 * 1024 * 1024,
} as const;

export interface ChunkSchedulerOptions {
  maxResidentBytes: number;
  maxChunkBytes?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  onError?: (error: Error) => void;
}

export interface ChunkRequestOptions {
  priority?: number;
  sizeHint?: number;
  signal?: AbortSignal;
  cache?: RequestCache;
}

interface Pending {
  url: string;
  options: ChunkRequestOptions;
  resolve: (bytes: ArrayBuffer) => void;
  reject: (error: unknown) => void;
  order: number;
  onAbort?: () => void;
}

interface Resident {
  bytes: ArrayBuffer;
  used: number;
}

/**
 * A small scheduler shared by every payload type the grove streams. It keeps
 * fetch order deterministic, refuses oversized payloads before they reach the
 * GPU, and evicts by byte budget rather than by object count.
 */
export class ChunkScheduler {
  readonly maxResidentBytes: number;
  readonly maxChunkBytes: number;
  readonly concurrency: number;

  readonly #fetch: typeof fetch;
  readonly #onError: ((error: Error) => void) | undefined;
  readonly #resident = new Map<string, Resident>();
  readonly #pending: Pending[] = [];
  readonly #inflight = new Map<string, AbortController>();
  readonly #requests = new Map<string, Promise<ArrayBuffer>>();
  #residentBytes = 0;
  #active = 0;
  #order = 0;
  #used = 0;
  #disposed = false;

  constructor(options: ChunkSchedulerOptions) {
    this.maxResidentBytes = Math.max(0, options.maxResidentBytes);
    this.maxChunkBytes = Math.min(MAX_CHUNK_BYTES, Math.max(1, options.maxChunkBytes ?? MAX_CHUNK_BYTES));
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#onError = options.onError;
  }

  load(url: string, options: ChunkRequestOptions = {}): Promise<ArrayBuffer> {
    if (this.#disposed) return Promise.reject(new Error("chunk scheduler is disposed"));
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (options.sizeHint !== undefined && options.sizeHint > this.maxChunkBytes) {
      return Promise.reject(new Error(`chunk ${url}: declared size exceeds ${this.maxChunkBytes} bytes`));
    }
    const cached = this.#resident.get(url);
    if (cached) {
      cached.used = ++this.#used;
      return Promise.resolve(cached.bytes.slice(0));
    }
    const existing = this.#requests.get(url);
    if (existing) return existing;
    const request = new Promise<ArrayBuffer>((resolve, reject) => {
      const pending: Pending = { url, options, resolve, reject, order: this.#order++ };
      if (options.signal) {
        pending.onAbort = () => {
          const index = this.#pending.indexOf(pending);
          if (index >= 0) this.#pending.splice(index, 1);
          this.#requests.delete(url);
          reject(abortError());
        };
        options.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.#pending.push(pending);
      this.#pump();
    });
    this.#requests.set(url, request);
    return request;
  }

  get residentBytes(): number {
    return this.#residentBytes;
  }

  get residentCount(): number {
    return this.#resident.size;
  }

  get inflightCount(): number {
    return this.#active;
  }

  dispose(): void {
    this.#disposed = true;
    for (const controller of this.#inflight.values()) controller.abort();
    for (const pending of this.#pending.splice(0)) pending.reject(new Error("chunk scheduler disposed"));
    this.#inflight.clear();
    this.#requests.clear();
    this.#resident.clear();
    this.#residentBytes = 0;
  }

  #pump(): void {
    while (!this.#disposed && this.#active < this.concurrency && this.#pending.length) {
      this.#pending.sort((a, b) => (b.options.priority ?? 0) - (a.options.priority ?? 0) || a.order - b.order);
      const pending = this.#pending.shift()!;
      void this.#run(pending);
    }
  }

  async #run(pending: Pending): Promise<void> {
    if (pending.onAbort && pending.options.signal) {
      pending.options.signal.removeEventListener("abort", pending.onAbort);
    }
    this.#active++;
    const controller = new AbortController();
    this.#inflight.set(pending.url, controller);
    const signal = mergeSignals(controller.signal, pending.options.signal);
    try {
      const response = await this.#fetch(pending.url, {
        signal,
        cache: pending.options.cache ?? "force-cache",
      });
      if (!response.ok) throw new Error(`chunk ${pending.url}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > this.maxChunkBytes) {
        throw new Error(`chunk ${pending.url}: payload is ${bytes.byteLength} bytes; limit is ${this.maxChunkBytes}`);
      }
      this.#resident.set(pending.url, { bytes, used: ++this.#used });
      this.#residentBytes += bytes.byteLength;
      this.#evict();
      pending.resolve(bytes.slice(0));
    } catch (error) {
      if (!signal.aborted) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.#onError?.(normalized);
        pending.reject(normalized);
      } else {
        pending.reject(abortError());
      }
    } finally {
      this.#inflight.delete(pending.url);
      this.#requests.delete(pending.url);
      this.#active--;
      this.#pump();
    }
  }

  #evict(): void {
    while (this.#residentBytes > this.maxResidentBytes && this.#resident.size) {
      let oldestUrl = "";
      let oldest = Number.POSITIVE_INFINITY;
      for (const [url, item] of this.#resident) {
        if (item.used < oldest) {
          oldest = item.used;
          oldestUrl = url;
        }
      }
      const item = this.#resident.get(oldestUrl);
      if (!item) return;
      this.#resident.delete(oldestUrl);
      this.#residentBytes -= item.bytes.byteLength;
    }
  }
}

function abortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("The chunk request was aborted", "AbortError")
    : Object.assign(new Error("The chunk request was aborted"), { name: "AbortError" });
}

function mergeSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary) return primary;
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  secondary.addEventListener("abort", abort, { once: true });
  if (primary.aborted || secondary.aborted) controller.abort();
  return controller.signal;
}
