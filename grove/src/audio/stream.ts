// Pure logic behind an exhibit stream's fall-behind/dead-stream rule
// (AUDIO-STREAM.md §3): "a stream that falls behind its live edge by more
// than 10 s (budget) is dropped to silence with a visible marker in the
// room, not stretched, not played late." Kept separate from `exhibit.ts`'s
// browser/hls.js glue so the rule itself is testable without a DOM or a
// real HLS session, the same split `sw/policy.ts` makes from `sw/sw.ts`.

/** The budget from AUDIO-STREAM.md §3: unmeasured, §7 item 1 is what checks it. */
export const DEFAULT_MAX_LAG_SECONDS = 10;

/**
 * How far behind the live edge playback currently is, in seconds. Never
 * negative: a currentTime ahead of the reported edge (a stale read) is not
 * "ahead", it is unknown, so it reads as caught up.
 */
export function lagSeconds(liveEdgeSeconds: number, currentTimeSeconds: number): number {
  return Math.max(0, liveEdgeSeconds - currentTimeSeconds);
}

/** Whether that lag is past the fall-behind budget and the stream must drop to silence. */
export function shouldFallSilent(lag: number, maxLagSeconds: number = DEFAULT_MAX_LAG_SECONDS): boolean {
  return lag > maxLagSeconds;
}
