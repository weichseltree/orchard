// The `turnstile` cue: the doorways close for a while (ruled by Manuel,
// 2026-09-16).
//
// Built on the lock that already exists. `lockedRoom` in main.ts is the one
// question every way out of a room asks -- walking a doorway, teleporting,
// clamping the head, crossing a portal -- so a turnstile is nothing more than
// a reason for that question to answer yes. It gets no movement code of its
// own, which is what keeps it from disagreeing with the locked-door rules
// about where a visitor may stand (#19, #25).
//
// Which visitors it holds is already settled before it gets here: the
// broadcast gate only passes a cue addressed to this visitor's room, or to
// every room.

/**
 * The longest a turnstile holds, whatever the row says.
 *
 * The module already clamps a broadcast's life to ten minutes
 * (BROADCAST_TTL_MAX). This is the same limit held again on the client,
 * because a door that stays shut because of a server bug is a trapped
 * visitor, and the fix for that should not need a deploy of the module.
 */
export const TURNSTILE_MAX_MS = 10 * 60_000;

export class Turnstile {
  #until = 0;
  #reason = "";
  #wasClosed = false;

  /**
   * Close the doors for `holdMs` from `now`.
   *
   * A second turnstile while one is running EXTENDS it to whichever ends
   * later, and never shortens it: two hosts holding the room for different
   * lengths should not have the shorter one open the doors early.
   */
  hold(holdMs: number, reason: string, now: number): void {
    if (!Number.isFinite(holdMs) || holdMs <= 0) return;
    const until = now + Math.min(holdMs, TURNSTILE_MAX_MS);
    if (until > this.#until) this.#until = until;
    if (reason.trim() !== "") this.#reason = reason.trim();
  }

  closed(now: number): boolean {
    return now < this.#until;
  }

  /** What a visitor reads when they walk into a held door. */
  why(now: number): string | null {
    if (!this.closed(now)) return null;
    return this.#reason || "the doors are held for a moment";
  }

  /**
   * Call once a frame. True exactly once, on the frame the doors reopen, so
   * the room can say so -- otherwise a visitor who stopped trying has no way
   * to know they can go.
   */
  opened(now: number): boolean {
    const closed = this.closed(now);
    const opened = this.#wasClosed && !closed;
    this.#wasClosed = closed;
    if (opened) this.#reason = "";
    return opened;
  }
}
