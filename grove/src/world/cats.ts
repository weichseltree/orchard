import type { Group } from "three";
import type { Room } from "./schema";
import { roomArena } from "./room-arena";
import { CATS, CatWorld, type Visitor } from "../vendor/cat-proxy/src/index";

// Manuel's two Ragdolls, living in the hall. The bodies and the behaviour are
// @someother/cat-proxy, vendored under src/vendor (PACKAGES.md section 2); everything the
// grove owns is here: which room they live in, where they start, and who counts as a visitor.
//
// They are CLIENT-LOCAL and deterministic: seeded brains and an injected clock, no server and
// no shared state, so two visitors in the hall see their own cats. A greeting nobody else
// witnesses is the weaker thing, and an authoritative host is the eventual answer -- the brains
// snapshot to plain JSON precisely so that host does not reshape this seam when it arrives.
//
// Nothing is downloaded: the mesh, the skeleton and all nineteen clips are generated in code.
// The .glb beside the package is its exported form for other consumers, and the grove never
// fetches it.

/** The room the cats live in. */
export const CAT_ROOM = "hall";

/**
 * Seeds are fixed so a given visitor's hall is the same hall twice running, and so a
 * screenshot of it can be compared with the last one.
 *
 * They are not arbitrary, though: a seed decides what sort of afternoon a cat has, and
 * some of them are dull. 0x7f4a7c15 gave the seal `sit-watch` for all 7 200 ticks of a
 * two-minute run -- nought metres walked, a statue in the middle of the hall. These two
 * were chosen by running every pair of a dozen seeds for three minutes in this room and
 * keeping one where both cats walk (6.4 m and 13.5 m), both use five or six different
 * behaviours, both greet a visitor standing at the door, and they never come closer than
 * 3.2 m to one another. cats.test.ts holds them to the first three of those.
 */
const CAT_SEEDS: Record<string, number> = { blue: 0x5eed, seal: 0xb };

/** Two cats, started apart and not on the spawn point, facing roughly into the room. */
export function buildCats(room: Room): CatWorld | null {
  if (room.id !== CAT_ROOM) return null;
  const cats = new CatWorld({
    arena: roomArena(room),
    cats: [
      { id: "blue", appearance: CATS.blue, seed: CAT_SEEDS.blue!, start: { x: -3.2, z: 2.4 }, heading: Math.PI * 0.75 },
      { id: "seal", appearance: CATS.seal, seed: CAT_SEEDS.seal!, start: { x: 3.6, z: -2.8 }, heading: -Math.PI * 0.25 },
    ],
  });
  cats.group.position.y = room.bounds.min[1];
  return cats;
}

/** Add the cats' scene content to the room's group. */
export function attachCats(cats: CatWorld, roomGroup: Group): void {
  roomGroup.add(cats.group);
}

/**
 * Who the cats can see. The visitor is only a visitor while they are in the cats' room:
 * a cat should not cross the hall to greet somebody standing in the phototroph.
 */
export function visitorsIn(room: string, at: { x: number; z: number }): Visitor[] {
  return room === CAT_ROOM ? [{ id: "you", at: { x: at.x, z: at.z } }] : [];
}
