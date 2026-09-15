// One decoder for the whole world. Quest 3 decodes exactly one HLS stream
// without complaint and falls over on two (grove/README.md: "One screen plays
// at a time"), so every video-textured thing, a wall or a planet, takes the
// decoder through this lease and hands it back through it. The lease knows
// nothing about what it is lending to: the owner is an opaque token.

let owner: object | null = null;

/** Take the decoder for `who`; false when someone else holds it. */
export function claimDecoder(who: object): boolean {
  if (owner !== null && owner !== who) return false;
  owner = who;
  return true;
}

/** Whether `who` holds the decoder now. */
export function holdsDecoder(who: object): boolean {
  return owner === who;
}

/** Hand it back; a no-op for anyone but the holder. */
export function releaseDecoder(who: object): void {
  if (owner === who) owner = null;
}

/** For tests: who holds it, or null. */
export function decoderOwner(): object | null {
  return owner;
}
