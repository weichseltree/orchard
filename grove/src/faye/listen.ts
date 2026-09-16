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

export interface SpeakerOptions {
  /** The module's gap plus a margin for the two clocks and the round trip. */
  gapMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<unknown>;
  onRefused: (text: string, error: unknown) => void;
  /** A droppable line was not queued because too many were already waiting. */
  onDropped: (text: string) => void;
}

/**
 * How many lines may wait in the queue before a droppable one is turned away.
 * A visitor may say a line every 0.7 s and she answers one every 0.9 s, so a
 * room that keeps asking would otherwise grow the queue without end and push
 * her announcements back behind replies nobody is still waiting for.
 */
export const SPEAKER_QUEUE_MAX = 4;

/**
 * Everything Faye says, one line at a time, spaced by the module's gap.
 *
 * The module allows one line per 0.7 s per speaker and refuses the next with
 * "slow down" -- a refusal nobody in the room sees, so the visitor who asked
 * simply gets no answer. Her greeting, her replies and her announcements all
 * speak as the same identity, and a fixed wait before each does not space
 * them from EACH OTHER: a question just after the greeting was scheduled
 * behind the same 0.9 s and refused. One queue, waiting from the last line
 * actually sent, is the only arrangement that cannot collide with itself.
 */
export class Speaker {
  #chain: Promise<void> = Promise.resolve();
  #lastAt = Number.NEGATIVE_INFINITY;
  #waiting = 0;
  #gate: Promise<unknown> = Promise.resolve();
  readonly #send: (text: string) => Promise<void>;
  readonly #options: SpeakerOptions;

  constructor(send: (text: string) => Promise<void>, options: SpeakerOptions) {
    this.#send = send;
    this.#options = options;
  }

  /**
   * Treat `at` as the last line sent. Called once the join is acknowledged: a
   * first join stamps `last_said`, and a rejoin keeps the previous run's,
   * which may be moments old after a restart. Neither is visible from here,
   * so the first line waits out the gap whichever it was.
   */
  heldUntilGap(at: number): void {
    this.#lastAt = Math.max(this.#lastAt, at);
  }

  /**
   * Sends nothing until `settled` has settled, whichever way. For the join:
   * her chat handler is live before it, and a reply queued while the join is
   * in flight must not time its gap from before the join's own stamp.
   */
  holdUntil(settled: Promise<unknown>): void {
    this.#gate = settled.then(() => undefined, () => undefined);
  }

  /**
   * Queues a line. Resolves once it was sent, refused or dropped; never
   * rejects. A `droppable` line (a reply) is turned away when the queue is
   * full; an undroppable one (an announcement, the greeting) never is.
   */
  say(text: string, options: { droppable?: boolean } = {}): Promise<void> {
    if (options.droppable && this.#waiting >= SPEAKER_QUEUE_MAX) {
      this.#options.onDropped(text);
      return Promise.resolve();
    }
    this.#waiting++;
    this.#chain = this.#chain.then(async () => {
      const { gapMs, now, sleep, onRefused } = this.#options;
      await this.#gate;
      // Re-read after each sleep: a hold can move while this line waits.
      for (let wait = this.#lastAt + gapMs - now(); wait > 0; wait = this.#lastAt + gapMs - now()) {
        await sleep(wait);
      }
      this.#waiting--;
      try {
        await this.#send(text);
      } catch (error) {
        onRefused(text, error);
      }
      // Stamped AFTER the call completes, refused or not: the module measures
      // the gap from its own commit, so a clock stamped at the start would let
      // a slow round trip bring the next call inside it.
      this.#lastAt = now();
    });
    return this.#chain;
  }
}
