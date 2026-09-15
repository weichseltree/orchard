import type { Renderer } from "../render/types";

export interface FrameMetrics {
  samples: number;
  targetHz: number;
  budgetMs: number;
  fps: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames exceeding the target interval by more than 5% (clock jitter allowance). */
  overBudget: number;
  overBudgetPercent: number;
  stalls: number;
  sessionFrames: number;
  sessionStalls: number;
}

/** Bounded rolling frame intervals. These are CPU-observed cadence, not GPU timings. */
export class PerfMeter {
  readonly #samples: Float64Array;
  #count = 0;
  #next = 0;
  #sessionFrames = 0;
  #sessionStalls = 0;
  #targetHz = 60;

  constructor(capacity = 240) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("frame window must be a positive integer");
    this.#samples = new Float64Array(capacity);
  }

  /** Pass the raw, unclamped interval in seconds; suspend sampling while hidden. */
  sample(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const ms = dt * 1000;
    this.#samples[this.#next] = ms;
    this.#next = (this.#next + 1) % this.#samples.length;
    this.#count = Math.min(this.#count + 1, this.#samples.length);
    this.#sessionFrames++;
    if (ms > 50) this.#sessionStalls++;
  }

  setTargetHz(hz: number): void {
    if (!Number.isFinite(hz) || hz <= 0) throw new Error("frame target must be positive and finite");
    if (this.#targetHz === hz) return;
    this.#targetHz = hz;
    // Desktop cadence must not contaminate the first XR window, or vice versa.
    this.#count = 0;
    this.#next = 0;
  }

  snapshot(): FrameMetrics {
    const sorted = Array.from(this.#samples.subarray(0, this.#count)).sort((a, b) => a - b);
    const sum = sorted.reduce((total, ms) => total + ms, 0);
    const meanMs = this.#count ? sum / this.#count : 0;
    const budgetMs = 1000 / this.#targetHz;
    const overBudget = sorted.filter((ms) => ms > budgetMs * 1.05).length;
    const percentile = (p: number): number => sorted[Math.max(0, Math.ceil(p * this.#count) - 1)] ?? 0;
    return {
      samples: this.#count,
      targetHz: this.#targetHz,
      budgetMs,
      fps: meanMs ? 1000 / meanMs : 0,
      meanMs,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sorted.at(-1) ?? 0,
      overBudget,
      overBudgetPercent: this.#count ? (100 * overBudget) / this.#count : 0,
      stalls: sorted.filter((ms) => ms > 50).length,
      sessionFrames: this.#sessionFrames,
      sessionStalls: this.#sessionStalls,
    };
  }

  get fps(): number { return this.snapshot().fps; }
  get frameMs(): number { return this.snapshot().meanMs; }
  get worstMs(): number { return this.snapshot().maxMs; }

  report(renderer: Renderer, extra: Record<string, string | number> = {}): string {
    const info = renderer.info;
    const m = this.snapshot();
    const lines = [
      `${m.fps.toFixed(1)} fps   ${m.meanMs.toFixed(2)} ms   max ${m.maxMs.toFixed(2)} ms`,
      `p50 ${m.p50Ms.toFixed(2)}  p95 ${m.p95Ms.toFixed(2)}  p99 ${m.p99Ms.toFixed(2)} ms`,
      `${m.targetHz} Hz target  over ${m.overBudgetPercent.toFixed(1)}%  stalls >50 ms ${m.stalls}/${m.samples}`,
      `calls ${info.render.calls}  tris ${info.render.triangles}  pts ${info.render.points}`,
      `geom ${info.memory.geometries}  tex ${info.memory.textures}  progs ${("programs" in info ? (info as { programs?: unknown[] }).programs?.length : 0) ?? 0}`,
      `dpr ${renderer.getPixelRatio().toFixed(2)}${renderer.xr.isPresenting ? "  xr" : ""}`,
    ];
    for (const [key, value] of Object.entries(extra)) lines.push(`${key} ${value}`);
    return lines.join("\n");
  }
}
