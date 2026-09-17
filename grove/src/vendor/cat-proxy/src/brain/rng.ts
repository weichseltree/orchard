/**
 * Seeded, DOM-free random helpers. The brain never touches `Math.random`; every call site is
 * handed one of these, so a whole session replays bit-for-bit from a seed (working rule 4).
 */

/** A uniform generator in [0, 1). Injected, never constructed from wall-clock entropy. */
export type Rng = () => number;

/** An Rng whose whole state is one number, so it can be snapshotted and restored. */
export interface SeededRng extends Rng {
  readonly state: number;
  setState(n: number): void;
}

/** mulberry32: small, fast, identical on every JS engine (matches apps/spike-c/src/synth.ts). */
export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The whole generator is one 32-bit word, so a brain's snapshot can carry it and a restored
  // session replays exactly (brain.ts: snapshot/restore).
  Object.defineProperty(next, "state", { get: () => a, enumerable: true });
  (next as SeededRng).setState = (n: number): void => {
    a = n >>> 0;
  };
  return next as SeededRng;
}

/** Standard normal via Box-Muller, drawn from the injected uniform source. */
export function gaussian(rng: Rng): number {
  // avoid log(0)
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * A dwell duration in seconds from a log-normal distribution given its median and a spread
 * (sigma of the underlying normal, in log-space — ~0.3 is fairly tight, ~0.8 is loose). Medians
 * stay medians regardless of spread, which is why the distribution is parameterised this way
 * rather than by mean/variance: a behaviour tuned from an ethogram gives a typical duration
 * directly.
 */
export function logNormalDurationS(rng: Rng, medianS: number, spread: number): number {
  return medianS * Math.exp(spread * gaussian(rng));
}

export interface ScoredOption<T> {
  item: T;
  score: number;
}

/**
 * Softmax selection at a given temperature, from the injected RNG — never argmax. Higher
 * temperature flattens the distribution (more variety); lower sharpens it (more decisive).
 * Scores may be any real number; -Infinity excludes an option entirely (a hard precondition
 * failure) without perturbing the others' relative weights.
 */
export function softmaxPick<T>(rng: Rng, options: ScoredOption<T>[], temperature: number): T {
  if (options.length === 0) {
    throw new Error("softmaxPick: no options");
  }
  const finite = options.filter((o) => Number.isFinite(o.score));
  const pool = finite.length > 0 ? finite : options;
  const maxScore = Math.max(...pool.map((o) => o.score));
  const weights = pool.map((o) => Math.exp((o.score - maxScore) / Math.max(temperature, 1e-6)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return pool[i]!.item;
  }
  return pool[pool.length - 1]!.item;
}
