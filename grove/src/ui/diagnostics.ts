/** Local diagnostic aggregates only: no visitor identities, resource URLs or telemetry uploads. */
export class VisitMetrics {
  #firstRoomReadyMs: number | null = null;
  #firstTapeReadyMs: number | null = null;
  #resourceBufferFull = false;
  readonly #onBufferFull = (): void => { this.#resourceBufferFull = true; };
  #longTasks: { count: number; blockingMs: number; longestMs: number } | null = null;
  #layout: LayoutStability | null = null;
  #observers: PerformanceObserver[] = [];

  constructor() {
    performance.addEventListener("resourcetimingbufferfull", this.#onBufferFull);
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (supported.includes("longtask")) {
      this.#longTasks = { count: 0, blockingMs: 0, longestMs: 0 };
      this.#observe("longtask", (entry) => {
        const tasks = this.#longTasks!;
        tasks.count++;
        tasks.blockingMs += Math.max(0, entry.duration - 50);
        tasks.longestMs = Math.max(tasks.longestMs, entry.duration);
      });
    }
    if (supported.includes("layout-shift")) {
      this.#layout = new LayoutStability();
      this.#observe("layout-shift", (entry) => {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        this.#layout!.sample(shift.startTime, shift.value, shift.hadRecentInput);
      });
    }
  }

  #observe(type: string, receive: (entry: PerformanceEntry) => void): void {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(receive));
    observer.observe({ type, buffered: true });
    this.#observers.push(observer);
  }

  roomReady(): void {
    if (this.#firstRoomReadyMs !== null) return;
    this.#firstRoomReadyMs = performance.now();
    performance.mark("grove:first-room-ready");
  }

  tapeReady(): void {
    if (this.#firstTapeReadyMs !== null) return;
    this.#firstTapeReadyMs = performance.now();
    performance.mark("grove:first-tape-ready");
  }

  snapshot() {
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return {
      /** Navigation to shell callback; GPU completion and exhibit readiness are separate. */
      firstRoomReadyMs: this.#firstRoomReadyMs,
      /** First active tape with an available frame, before the following render. */
      firstTapeReadyMs: this.#firstTapeReadyMs,
      elapsedMs: performance.now(),
      longTasks: this.#longTasks ? { ...this.#longTasks } : null,
      layoutShiftScore: this.#layout?.score ?? null,
      resources: summarizeResources(resources),
      resourceTimingBufferFull: this.#resourceBufferFull,
    };
  }

  dispose(): void {
    for (const observer of this.#observers) observer.disconnect();
    this.#observers = [];
    performance.removeEventListener("resourcetimingbufferfull", this.#onBufferFull);
  }
}

/** Maximum layout-shift session window, with 1 s gap and 5 s duration limits. */
export class LayoutStability {
  #score = 0;
  #window = 0;
  #start = 0;
  #last = 0;
  sample(time: number, value: number, hadRecentInput: boolean): void {
    if (hadRecentInput || !Number.isFinite(value) || value <= 0) return;
    if (this.#window === 0 || time - this.#last >= 1000 || time - this.#start >= 5000) {
      this.#window = value;
      this.#start = time;
    } else this.#window += value;
    this.#last = time;
    this.#score = Math.max(this.#score, this.#window);
  }
  get score(): number { return this.#score; }
}

type ResourceSize = Pick<PerformanceResourceTiming, "transferSize" | "encodedBodySize" | "decodedBodySize">;

export function summarizeResources(entries: readonly ResourceSize[]) {
  return entries.reduce((out, entry) => {
    out.count++;
    out.knownTransferBytes += entry.transferSize;
    out.encodedBodyBytes += entry.encodedBodySize;
    out.decodedBodyBytes += entry.decodedBodySize;
    // Zero transfer does not prove a cache hit: timing-opaque cross-origin data is also zero.
    if (entry.transferSize === 0 && entry.decodedBodySize > 0) out.cachedCount++;
    else if (entry.transferSize === 0) out.unknownSizeCount++;
    return out;
  }, { count: 0, knownTransferBytes: 0, encodedBodyBytes: 0, decodedBodyBytes: 0, cachedCount: 0, unknownSizeCount: 0 });
}
