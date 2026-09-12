import type { EncodableFrame } from "./encode";
import { quantize } from "./format";

// A synthetic tape in the real format, so WP2 can be finished and tested
// before WP1's first bundle exists. Two species drifting in a periodic 2D box
// and annihilating in pairs — the shape of the einstruct segregation tape,
// none of its physics. Deterministic from a seed: the same bytes every run,
// which is what lets a test assert on them.

export interface SyntheticTapeOptions {
  slots: number;
  frames: number;
  box: readonly [number, number, number];
  dtTau: number;
  seed?: number;
  speciesNames?: readonly string[];
}

export interface SyntheticTape {
  readonly slots: number;
  readonly frames: number;
  readonly dtTau: number;
  readonly box: readonly [number, number, number];
  readonly speciesNames: readonly string[];
  /** Builds frame `f`; the arrays are freshly allocated and owned by the caller. */
  frame(f: number): EncodableFrame;
}

/** Small, fast, and the same everywhere: a seeded generator, not Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrap(v: number, length: number): number {
  const m = v % length;
  return m < 0 ? m + length : m;
}

export function syntheticTape(options: SyntheticTapeOptions): SyntheticTape {
  const { slots, frames, box, dtTau } = options;
  const speciesNames = options.speciesNames ?? ["A", "B"];
  const random = mulberry32(options.seed ?? 0);
  const [lx, ly, lz] = box;

  const x0 = new Float64Array(slots);
  const y0 = new Float64Array(slots);
  const vx = new Float64Array(slots);
  const vy = new Float64Array(slots);
  const species = new Uint8Array(slots);
  const dies = new Int32Array(slots);

  for (let i = 0; i < slots; i++) {
    species[i] = i % speciesNames.length;
    // Species start on opposite halves: the picture says what kind of matter
    // is on screen from the first frame (LAWS 10), then they mix.
    const half = (species[i] as number) === 0 ? 0 : 0.5;
    x0[i] = (random() * 0.5 + half) * lx;
    y0[i] = random() * ly;
    const speed = 0.12 + random() * 0.35;
    const angle = random() * Math.PI * 2;
    vx[i] = Math.cos(angle) * speed;
    vy[i] = Math.sin(angle) * speed;
    dies[i] = -1;
  }
  // Annihilate in pairs so the two counts stay equal, later and later.
  const pairs = Math.floor(slots / 2);
  for (let p = 0; p < pairs; p++) {
    if (random() > 0.75) continue;
    const at = Math.floor(Math.pow(random(), 0.6) * frames);
    const a = p;
    const b = slots - 1 - p;
    dies[a] = at;
    dies[b] = at;
  }

  return {
    slots,
    frames,
    dtTau,
    box,
    speciesNames,
    frame(f: number): EncodableFrame {
      const positions = new Uint16Array(slots * 3);
      const alive = new Uint8Array(slots);
      const speciesOut = new Uint8Array(slots);
      for (let i = 0; i < slots; i++) {
        const death = dies[i] as number;
        const isAlive = death < 0 || f < death;
        // A dead slot keeps its last position; that is how einstruct tapes behave.
        const at = isAlive ? f : Math.max(0, death - 1);
        const t = at * dtTau;
        positions[i * 3] = quantize(wrap((x0[i] as number) + (vx[i] as number) * t, lx), lx);
        positions[i * 3 + 1] = quantize(wrap((y0[i] as number) + (vy[i] as number) * t, ly), ly);
        // 2D: z is 0 for every slot and Lz is 1.
        positions[i * 3 + 2] = lz === 1 ? 0 : quantize(lz / 2, lz);
        speciesOut[i] = species[i] as number;
        alive[i] = isAlive ? 1 : 0;
      }
      return { positions, species: speciesOut, alive };
    },
  };
}

/**
 * A device-tier variant of a tape: every `frameStride`-th frame, every
 * `slotStride`-th slot. The thinned frames are what a variant's chunks hold.
 */
export interface ThinnedTape {
  readonly slots: number;
  readonly frames: number;
  readonly dtTau: number;
  frame(f: number): EncodableFrame;
}

export function thin(tape: SyntheticTape, frameStride: number, slotStride: number): ThinnedTape {
  const slots = Math.ceil(tape.slots / slotStride);
  const frames = Math.ceil(tape.frames / frameStride);
  return {
    slots,
    frames,
    dtTau: tape.dtTau * frameStride,
    frame(f: number): EncodableFrame {
      const full = tape.frame(Math.min(tape.frames - 1, f * frameStride));
      if (slotStride === 1) return full;
      const positions = new Uint16Array(slots * 3);
      const species = new Uint8Array(slots);
      const alive = new Uint8Array(slots);
      for (let i = 0; i < slots; i++) {
        const src = i * slotStride;
        positions[i * 3] = full.positions[src * 3] as number;
        positions[i * 3 + 1] = full.positions[src * 3 + 1] as number;
        positions[i * 3 + 2] = full.positions[src * 3 + 2] as number;
        species[i] = full.species[src] as number;
        alive[i] = full.alive[src] as number;
      }
      return { positions, species, alive };
    },
  };
}
