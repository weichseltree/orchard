// Which lines in the room Faye hears, and when her connection counts as lost.
//
// Pure, so the rules are tested without a server (scripts/faye.ts holds the
// wiring).

/** A chat row as far as hearing it goes: who said it and when, server time. */
export interface HeardLine {
  sender: string;
  /** Microseconds since the epoch, stamped by the module. */
  atMicros: bigint;
}

/**
 * Whether a line is one said to the room since she walked in.
 *
 * Joining a room moves `chat_here` onto that room, so its whole history
 * arrives as inserts after the join. Answering it would have her walk in
 * replying to a conversation that finished hours ago. The cut is her own
 * visitor row's `last_seen`, which `join` stamps with the transaction's time:
 * both sides are the module's clock, so a wrong clock on this machine cannot
 * move it.
 *
 * It used to be the first successful poll of the compute feed, which meant a
 * dashboard that was down when she started left her deaf for the whole run --
 * and `--poll 0` left her deaf by design.
 *
 * `joinedAtMicros` is null until her row is in the view; nothing said before
 * then can be new, because the history and her row arrive together.
 */
export function isNewLine(line: HeardLine, self: string, joinedAtMicros: bigint | null): boolean {
  if (joinedAtMicros === null) return false;
  // Her own lines come back through the same view; answering them is a loop.
  if (line.sender === self) return false;
  return line.atMicros > joinedAtMicros;
}

/**
 * How often she sends her pose while turning on the spot, per second.
 *
 * Every send is a reducer call against maincloud, around the clock: 10 Hz was
 * ~864,000 calls a day to turn slowly. The client eases every peer toward its
 * last pose (`net/avatars.ts`), so at 2 Hz a 24 s turn arrives as 7.5-degree
 * steps that it smooths into a turn. Standing still needs one send, not a
 * stream: the module keeps a pose until she leaves.
 */
export const TURN_POSE_HZ = 2;

/**
 * What a disconnect means, by whether the connection had come up.
 *
 * Before it came up, the caller is still waiting for it and gets an error.
 * After, the process must EXIT, nonzero: a script that stays up with a dead
 * socket is a unit systemd calls active while her capsule is gone from the
 * room, and `Restart=on-failure` only acts on an exit. Leaving on purpose is
 * the one disconnect that is not a failure.
 */
export function onDisconnectAction(state: { connected: boolean; leaving: boolean }): "reject" | "exit-ok" | "exit-failed" {
  if (!state.connected) return "reject";
  return state.leaving ? "exit-ok" : "exit-failed";
}
