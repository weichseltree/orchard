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

/** A playlist whose newest segment is older than this is a leftover of an encoder that died, not a stream. */
export const STALE_PLAYLIST_MS = 30_000;

/**
 * Whether a playlist is live NOW: it has media, and its newest segment's
 * programme date plus its duration is within `STALE_PLAYLIST_MS` of `nowMs`.
 * An encoder killed without its retire leaves its last window on the host;
 * without this a silent player would replay those sixteen seconds forever.
 * A playlist with no programme dates is taken at its word.
 */
export function playlistIsFresh(text: string, nowMs: number, staleMs = STALE_PLAYLIST_MS): boolean {
  if (!playlistHasMedia(text)) return false;
  let lastDate: number | null = null;
  let lastDuration = 0;
  let pendingDate: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      // ffmpeg writes the offset as +0200; the colon form is the one every engine parses.
      const stamp = line.slice("#EXT-X-PROGRAM-DATE-TIME:".length).replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
      const t = Date.parse(stamp);
      pendingDate = Number.isFinite(t) ? t : null;
    } else if (line.startsWith("#EXTINF:")) {
      const d = Number.parseFloat(line.slice("#EXTINF:".length));
      if (Number.isFinite(d)) lastDuration = d;
    } else if (line.length > 0 && !line.startsWith("#")) {
      if (pendingDate !== null) lastDate = pendingDate;
      pendingDate = null;
    }
  }
  if (lastDate === null) return true;
  return nowMs - (lastDate + lastDuration * 1000) < staleMs;
}

/** How often a silent stream looks for its playlist to fill again, in ms. */
export const RETRY_MS = 8000;
/** Behind the live edge by more than this, playback jumps back to it (budget: two segments). */
export const SEEK_LAG_SECONDS = 4;

/** Whether that lag is past the fall-behind budget and the stream must drop to silence. */
export function shouldFallSilent(lag: number, maxLagSeconds: number = DEFAULT_MAX_LAG_SECONDS): boolean {
  return lag > maxLagSeconds;
}
