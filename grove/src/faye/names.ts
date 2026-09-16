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
 * The name she stands in the room under. Not a flag: the client recognises her
 * by it (`isFaye`), so a Faye started under another name would be reported
 * absent while she stood there. It is 23 characters because NAME_MAX in the
 * module is 24 and `cleanName` clips silently: the fuller title, with "The"
 * in front, would have stood in the room cut off mid-name. A test holds it
 * within the limit.
 */
export const FAYE_NAME = "Great Admin Spirit Faye";

/**
 * The presence room she stands in: the hall's. `scripts/faye.ts` always joins
 * it, with no flag to change that, because the client names this room as the
 * one a visitor should walk to.
 */
export const FAYE_ROOM = "grove";

/**
 * Whether a line is addressed to her, read the way the module will store it.
 * `say` runs `cleanText` first -- invisible format characters removed (the
 * zero-width joiner kept), control characters and runs of whitespace
 * collapsed -- so "fa\u202Eye" arrives as "faye" and she answers it. The
 * client's notice must follow the line she actually receives.
 */
export function namesFaye(text: string): boolean {
  const stored = text.replace(/\p{Cf}/gu, (c) => (c === "\u200D" ? c : "")).replace(/[\s\p{Cc}]+/gu, " ");
  return NAMES.test(stored.toLowerCase());
}

/**
 * Whether a peer is Faye: a host whose name is exactly hers. Anyone can CALL
 * themselves Faye, but only the module can make a peer a host. And not every
 * host whose name `NAMES` would hear -- that regex is for lines addressed to
 * her, and a host called "Fay" standing in the gallery must not hide that
 * Faye is somewhere else.
 */
export function isFaye(peer: { name: string; host: boolean }): boolean {
  return peer.host && peer.name === FAYE_NAME;
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
 * is reported by the send itself, not here. `peers` null means who is in the
 * room is not known yet (just arrived), and a guess either way would be wrong
 * as often as right, so nothing is said. `fayeRoomTitle` is the title of
 * the room whose presence is `FAYE_ROOM`, for a visitor to walk to.
 */
export function whereIsFaye(
  text: string,
  peers: Iterable<{ name: string; host: boolean }> | null,
  joinedRoom: string | null,
  fayeRoomTitle: string,
): string | null {
  if (joinedRoom === null || peers === null || !namesFaye(text)) return null;
  for (const peer of peers) if (isFaye(peer)) return null;
  if (joinedRoom === FAYE_ROOM) return "Faye is not here right now, so nobody will answer.";
  return `Faye cannot hear you from here. She stands in the ${fayeRoomTitle}.`;
}
