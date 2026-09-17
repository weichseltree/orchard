import type { Vec2 } from "../contract";
import type { BrainParams } from "./params";
import type { SalienceMap, SalienceSource } from "./types";

/** Refreshes (or creates) a stimulus, resetting its strength to full — called from event handling. */
export function markSalient(map: SalienceMap, source: SalienceSource, at: Vec2, now: number): void {
  map[source] = { at, since: now, strength: 1 };
}

/** The most salient stimulus right now, decayed exponentially since it was last refreshed, or
 * null once everything has faded below the floor. This drives `lookAt` independently of whatever
 * behaviour is running (sold cheaply: the cat's eyes track interest even mid-nap). */
export function mostSalient(map: SalienceMap, now: number, params: BrainParams): Vec2 | null {
  let best: Vec2 | null = null;
  let bestStrength = params.salienceFloor;
  for (const entry of Object.values(map)) {
    if (!entry) continue;
    const decayed = entry.strength * Math.exp(-params.salienceDecayPerS * (now - entry.since));
    if (decayed >= bestStrength) {
      bestStrength = decayed;
      best = entry.at;
    }
  }
  return best;
}
