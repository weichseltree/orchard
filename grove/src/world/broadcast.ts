// What a client does with a world event, and — mostly — what it refuses to do.
//
// `broadcast` is a PUBLIC table, so a joining client receives every row in it,
// including everything fired before it arrived. Acting on that backlog would
// make a visitor who walks in at noon watch the whole morning replay: every
// turnstile, every forced-update notice, in a burst. So the gate is built out
// of refusals, and the rules are here rather than in the socket handler
// because each of them is a bug that has to be got right once.
//
// Four rules, from VR-PRESENCE §4:
//
//   1. Only rows that arrive AFTER subscribing. The backlog is history.
//   2. Only rows that have not expired.
//   3. Each row at most once -- a reconnect re-delivers the subscription.
//   4. Order by `at`, NEVER by `id`.
//
// Rule 4 is the one that looks wrong and is not: SpacetimeDB's auto-increment
// ids are not sequential and gaps are normal (spacetime/CLAUDE.md), so an id
// identifies a row and does not place it in time. Two cues fired a second
// apart can arrive with ids that order them backwards.

/** A row as the client receives it. Timestamps are the SERVER's, in ms. */
export interface BroadcastRow {
  id: string;
  kind: string;
  cue: string;
  text: string;
  room: string;
  at: number;
  expiresAt: number;
}

/** What the world should do. `null` everywhere else means: nothing. */
export type BroadcastAction =
  | { kind: "notice"; id: string; text: string; holdMs: number }
  | { kind: "cue"; id: string; cue: string; text: string; holdMs: number };

/**
 * How many ids to remember for rule 3.
 *
 * Bounded because the set would otherwise grow for as long as the tab is
 * open. Far more than a room can fire inside one broadcast's lifetime, which
 * is what it actually has to cover: a row can only be re-delivered while it
 * still exists, and the module sweeps it at expiry.
 */
export const SEEN_MAX = 256;

/** Kinds this client understands. Anything else is ignored, not an error. */
const KINDS = new Set(["notice", "cue"]);

export class BroadcastGate {
  /** False until the initial rows have been delivered; everything before is history. */
  #live = false;
  #seen: string[] = [];
  #seenSet = new Set<string>();

  /**
   * The backlog is over; rows from here are events.
   *
   * Driven by the subscription's `onApplied`, which fires AFTER the initial
   * rows — the same boundary the chat panel uses. A timer would be a guess,
   * and a 0 ms timer is a guess that happens to be right on a fast machine.
   */
  open(): void {
    this.#live = true;
  }

  /** A reconnect re-delivers everything, so the boundary is drawn again. */
  close(): void {
    this.#live = false;
  }

  get live(): boolean {
    return this.#live;
  }

  /**
   * Whether this row is something to act on, and what.
   *
   * `room` is where the visitor is standing; a row with an empty room is for
   * every room.
   *
   * Takes no clock, and that is the point: see the expiry note below.
   */
  admit(row: BroadcastRow, room: string): BroadcastAction | null {
    if (!this.#live) return null;
    if (this.#seenSet.has(row.id)) return null;
    if (row.room !== "" && row.room !== room) return null;
    if (!KINDS.has(row.kind)) return null;

    // Expiry as a DURATION, never as a wall-clock comparison. Both stamps are
    // the server's, so their difference is a true length of time, while
    // `expiresAt > now` compares two different clocks: a visitor whose machine
    // is a few minutes fast would silently discard every broadcast, and one a
    // few minutes slow would act on ones long dead. Neither would look like a
    // clock problem from inside the room.
    const holdMs = row.expiresAt - row.at;
    if (!Number.isFinite(holdMs) || holdMs <= 0) return null;

    this.#remember(row.id);
    if (row.kind === "notice") {
      if (row.text.trim() === "") return null;
      return { kind: "notice", id: row.id, text: row.text, holdMs };
    }
    // A cue names something pre-fetched. An empty name is not a cue.
    if (row.cue.trim() === "") return null;
    return { kind: "cue", id: row.id, cue: row.cue, text: row.text, holdMs };
  }

  /**
   * Several rows at once, in the order they were fired.
   *
   * Sorted by `at`, with the id only as a tie-break so the same input always
   * produces the same output. Rows arriving in one subscription update have no
   * inherent order.
   */
  admitAll(rows: readonly BroadcastRow[], room: string): BroadcastAction[] {
    const ordered = [...rows].sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : 1));
    const actions: BroadcastAction[] = [];
    for (const row of ordered) {
      const action = this.admit(row, room);
      if (action) actions.push(action);
    }
    return actions;
  }

  #remember(id: string): void {
    this.#seen.push(id);
    this.#seenSet.add(id);
    while (this.#seen.length > SEEN_MAX) {
      const dropped = this.#seen.shift();
      if (dropped !== undefined) this.#seenSet.delete(dropped);
    }
  }
}

/**
 * Whether this build can play a named cue.
 *
 * This list is what is IMPLEMENTED, not what is planned: `notice` shows its
 * words, `update` makes every open page check for a new build and require it
 * (ui/update.ts, at a safe moment), and `turnstile` holds the doorways shut for
 * the broadcast's lifetime (world/turnstile.ts). A client that claimed a cue it
 * could not act on would fire a moment nobody sees and report nothing wrong.
 *
 * An unknown cue is SILENCE, not a fallback notice: a cue is a moment, it
 * cannot wait for a download, and showing its text instead would turn a
 * missing animation into a wall of words nobody asked for. VR-PRESENCE §8
 * ruling 4 is whether a cue may ever name a content-hashed bundle.
 */
export const CUES = new Set(["notice", "update", "turnstile"]);

export function knowsCue(cue: string): boolean {
  return CUES.has(cue);
}
