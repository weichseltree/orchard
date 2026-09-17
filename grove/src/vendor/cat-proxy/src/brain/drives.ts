import type { DriveRates } from "./params";
import type { BehaviourId, Drives } from "./types";

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Per-tick drive integration. Continuous growth/decay always applies; a behaviour actively
 * satisfying its drive (eating, grooming, ...) subtracts its relief on top. Fear decays
 * exponentially rather than linearly, since a startle should fade fast at first and taper off
 * (an animal calms down quickly, then stays a little on edge for a while). */
export function tickDrives(
  drives: Drives,
  dt: number,
  current: BehaviourId | null,
  rates: DriveRates,
): Drives {
  const asleep = current === "sleep";
  const energy = clamp01(
    drives.energy + dt * (asleep ? rates.energyAsleepRecoverPerS : -rates.energyAwakeDecayPerS),
  );
  const hunger = clamp01(
    drives.hunger +
      dt * rates.hungerGrowPerS -
      (current === "eat" ? dt * rates.hungerReliefPerS : 0),
  );
  const affection = clamp01(drives.affection + dt * rates.affectionGrowPerS);
  const curiosity = clamp01(
    drives.curiosity +
      dt * rates.curiosityGrowPerS -
      (current === "investigate" || current === "play" ? dt * rates.curiosityReliefPerS : 0),
  );
  const fear = clamp01(drives.fear * Math.exp(-dt * rates.fearDecayPerS));
  const grooming = clamp01(
    drives.grooming +
      dt * rates.groomingGrowPerS -
      (current === "groom" ? dt * rates.groomingReliefPerS : 0),
  );
  return { energy, hunger, affection, curiosity, fear, grooming };
}
