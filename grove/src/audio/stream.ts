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

/**
 * Whether a playlist has anything to play: a media line, not just its
 * header. An idle floor publishes an empty live playlist (orchard/stream.py),
 * so a silent player polls the playlist and comes back the moment a segment
 * appears, without a 404 for every poll.
 */
export function playlistHasMedia(text: string): boolean {
  return text.split("\n").some((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

/** How often a silent stream looks for its playlist to fill again, in ms. */
export const RETRY_MS = 8000;
/** Behind the live edge by more than this, playback jumps back to it (budget: two segments). */
export const SEEK_LAG_SECONDS = 4;

/** Whether that lag is past the fall-behind budget and the stream must drop to silence. */
export function shouldFallSilent(lag: number, maxLagSeconds: number = DEFAULT_MAX_LAG_SECONDS): boolean {
  return lag > maxLagSeconds;
}
