// Shared helpers for the test suite only (not part of the module's public surface — index.ts
// does not re-export this file).
import type { TimelineEntry } from "./simulate";
import type { BehaviourId } from "./types";

export interface EpisodeRow {
  behaviour: BehaviourId;
  startedAt: number;
  startedByInterrupt: boolean;
}

/** Collapses a tick-level timeline into one row per episode. Two ticks belong to the same
 * episode iff they share `episodeStartedAt` — necessary because a repeat (two back-to-back
 * episodes that happen to choose the same behaviour) is otherwise invisible in `behaviour`
 * alone: it reads exactly like one long episode. */
export function episodes(timeline: TimelineEntry[]): EpisodeRow[] {
  const out: EpisodeRow[] = [];
  let last: number | null = null;
  for (const e of timeline) {
    if (e.episodeStartedAt !== last) {
      out.push({
        behaviour: e.behaviour,
        startedAt: e.episodeStartedAt,
        startedByInterrupt: e.startedByInterrupt,
      });
      last = e.episodeStartedAt;
    }
  }
  return out;
}

export function episodeBehaviours(timeline: TimelineEntry[]): BehaviourId[] {
  return episodes(timeline).map((e) => e.behaviour);
}

export function longestRun(ids: BehaviourId[]): number {
  if (ids.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < ids.length; i++) {
    run = ids[i] === ids[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** The first behaviour after sleep ends for good, or undefined if the timeline never slept (or
 * never stopped within it). Consecutive sleep episodes are a legitimate repeat (a short nap that
 * gets re-picked immediately, up to the repeat cap) rather than a "wake" — this skips past all
 * of them to the first genuinely different behaviour. */
export function firstBehaviourAfterSleep(timeline: TimelineEntry[]): BehaviourId | undefined {
  const eps = episodeBehaviours(timeline);
  let i = eps.indexOf("sleep");
  if (i === -1) return undefined;
  while (i < eps.length && eps[i] === "sleep") i++;
  return i < eps.length ? eps[i] : undefined;
}
