import type { WebGLRenderer } from "three";

// The frame budget, measured rather than asserted: Quest 3 browser wants
// 13.9 ms. `renderer.info` is the honest source for draw calls and triangles;
// the frame time is the animation loop's own clock.

export class PerfMeter {
  #frames = 0;
  #accumulated = 0;
  #worst = 0;
  #fps = 0;
  #frameMs = 0;
  #worstMs = 0;

  sample(dt: number): void {
    if (dt <= 0) return;
    this.#frames++;
    this.#accumulated += dt;
    this.#worst = Math.max(this.#worst, dt);
    if (this.#accumulated >= 0.5) {
      this.#fps = this.#frames / this.#accumulated;
      this.#frameMs = (this.#accumulated / this.#frames) * 1000;
      this.#worstMs = this.#worst * 1000;
      this.#frames = 0;
      this.#accumulated = 0;
      this.#worst = 0;
    }
  }

  get fps(): number {
    return this.#fps;
  }

  get frameMs(): number {
    return this.#frameMs;
  }

  get worstMs(): number {
    return this.#worstMs;
  }

  report(
    renderer: WebGLRenderer,
    extra: Record<string, string | number> = {},
  ): string {
    const info = renderer.info;
    const lines = [
      `${this.#fps.toFixed(1)} fps   ${this.#frameMs.toFixed(2)} ms   worst ${this.#worstMs.toFixed(2)} ms`,
      `calls ${info.render.calls}  tris ${info.render.triangles}  pts ${info.render.points}`,
      `geom ${info.memory.geometries}  tex ${info.memory.textures}  progs ${info.programs?.length ?? 0}`,
      `dpr ${renderer.getPixelRatio().toFixed(2)}${renderer.xr.isPresenting ? "  xr" : ""}`,
    ];
    for (const [key, value] of Object.entries(extra)) lines.push(`${key} ${value}`);
    return lines.join("\n");
  }
}
