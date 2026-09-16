// Who Faye is and where she stands, as both halves need it: the script that
// answers (`reply.ts`) and the client that tells a visitor she cannot hear
// them. Kept apart from `reply.ts` and `events.ts` so the client bundle takes
// a regex and a room name, not the feed reader.

/**
 * The spellings that count as her name.
 *
 * "faye" alone is right for typed chat and wrong for spoken chat: a
 * transcriber hears a one-syllable name it does not know and writes the
 * common word -- fay, fae, fey. She would then ignore a visitor who plainly
 * addressed her, and there is no way for them to tell that from a dead
 * microphone, so the mishearing reads as the whole feature being broken.
 *
 * The alternative is to rewrite the transcript before it is sent, which puts
 * words the visitor did not say into the room's log. Widening what she
 * answers to keeps the log honest and costs only the chance that someone
 * says "fae" in a grove and gets a reply -- a far cheaper mistake than
 * silence.
 */
export const NAMES = /\b(faye|fay|fae|fey)\b/;

/**
 * The presence room she stands in: the hall's. `scripts/faye.ts` always joins
 * it, with no flag to change that, because the client names this room as the
 * one a visitor should walk to.
 */
export const FAYE_ROOM = "grove";

/** Whether a line is addressed to her. */
export function namesFaye(text: string): boolean {
  return NAMES.test(text.toLowerCase());
}

/**
 * Whether a peer is Faye. A host whose name is hers: anyone can CALL themselves
 * Faye, but only the module can make a peer a host, so a visitor named Faye
 * does not stand in for her and hide that she is absent.
 */
export function isFaye(peer: { name: string; host: boolean }): boolean {
  return peer.host && namesFaye(peer.name);
}

/**
 * What the log tells a visitor who spoke to Faye where she cannot hear them,
 * or null when she can (or they were not speaking to her).
 *
 * Chat reaches only the room it is said in, and the ask menu, the microphone
 * and the text line all work in every room. Without this, a question put to
 * her from the gallery gets silence -- which reads exactly like the feature
 * being broken, and gives nobody a way to tell the difference.
 *
 * `joinedRoom` null means the line never reached a room at all; that failure
 * is reported by the send itself, not here. `fayeRoomTitle` is the title of
 * the room whose presence is `FAYE_ROOM`, for a visitor to walk to.
 */
export function whereIsFaye(
  text: string,
  peers: Iterable<{ name: string; host: boolean }>,
  joinedRoom: string | null,
  fayeRoomTitle: string,
): string | null {
  if (joinedRoom === null || !namesFaye(text)) return null;
  for (const peer of peers) if (isFaye(peer)) return null;
  if (joinedRoom === FAYE_ROOM) return "Faye is not here right now, so nobody will answer.";
  return `Faye cannot hear you from here. She stands in the ${fayeRoomTitle}.`;
}
