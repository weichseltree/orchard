/** Movement is bounded after a stall; measurement retains the full interval. */
export class FrameClock {
  #previous: number | null = null;
  readonly #interval = { dt: 0, rawDt: 0 };

  reset(): void { this.#previous = null; }

  tick(timeMs: number): { dt: number; rawDt: number } {
    const rawDt = this.#previous === null ? 0 : Math.max(0, (timeMs - this.#previous) / 1000);
    this.#previous = timeMs;
    this.#interval.dt = Math.min(0.1, rawDt);
    this.#interval.rawDt = rawDt;
    return this.#interval;
  }
}
