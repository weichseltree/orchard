// The part of room chat that is not the DOM: what the log holds, and what may
// be sent when. Kept separate from `chat.ts` so the rules are testable without
// a browser, the same split `audio/stream.ts` makes from `audio/exhibit.ts`.

/** One line as the panel holds it. `mine` is resolved by presence, not here. */
export interface ChatEntry {
  id: string;
  name: string;
  text: string;
  mine: boolean;
  at: number;
}

/**
 * How many lines the panel keeps. The module keeps chat for 24 h, so a busy
 * room's history is unbounded; this is what stays in the DOM, not what exists.
 */
export const CHAT_LOG_MAX = 50;

/** The module's own limit (`CHAT_MAX` in the module). Longer is refused there. */
export const CHAT_TEXT_MAX = 280;

/**
 * One line per 0.7 s per visitor, as the module enforces it (`CHAT_MIN_GAP`).
 * The panel holds the visitor to it rather than letting the reducer refuse:
 * a disabled button for a moment reads as the room being orderly, where
 * "slow down" in the log reads as something being broken.
 */
export const CHAT_MIN_GAP_MS = 700;

/**
 * Adds a line, keeping order and dropping a repeat of one already held.
 *
 * The repeat matters: a line can arrive twice — a reconnect re-delivers a
 * subscription, and our own line comes back through the same view it was sent
 * into. Ids come from the module's auto-increment column, so they are unique
 * even though they are not contiguous, which makes them the right thing to
 * compare and the wrong thing to sort by.
 */
export function appendLine(
  lines: readonly ChatEntry[],
  line: ChatEntry,
  max: number = CHAT_LOG_MAX,
): ChatEntry[] {
  if (lines.some((held) => held.id === line.id)) return [...lines];
  const next = [...lines, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** What will actually be sent: trimmed, and clipped to what the module accepts. */
export function outgoing(raw: string): string {
  return raw.trim().slice(0, CHAT_TEXT_MAX);
}

/** Whether there is anything to send. Whitespace alone is not a message. */
export function isSendable(raw: string): boolean {
  return outgoing(raw).length > 0;
}

/**
 * Whether the visitor may speak yet.
 *
 * `lastSentAt` is null before their first line of a session -- but joining a
 * room stamps the module's clock too, so the first line after arriving can
 * still be refused. The caller passes the join time as `lastSentAt` for that
 * reason; this function does not know the difference and does not need to.
 */
export function maySend(lastSentAt: number | null, now: number, gapMs: number = CHAT_MIN_GAP_MS): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= gapMs;
}

/** Milliseconds until the next line may be sent; 0 when it may be sent now. */
export function waitFor(lastSentAt: number | null, now: number, gapMs: number = CHAT_MIN_GAP_MS): number {
  if (lastSentAt === null) return 0;
  return Math.max(0, gapMs - (now - lastSentAt));
}

/**
 * How a line reads in the log. A visitor with no name is shown as a visitor
 * rather than as an empty string or an identity: the module already replaces
 * an unusable name with `visitor-NNNN`, so this only covers a row that
 * reached us before that happened.
 */
export function speakerOf(line: ChatEntry): string {
  return line.name.trim() || "visitor";
}
