import type { Room } from "./schema";
import { COLUMN_FOOT_M, columnFootprints } from "./observatory";
import { rectArena, type Arena, type Rect } from "../vendor/cat-proxy/src/arena";

// The room as the cats are allowed to walk it. cat-proxy takes its arena as a pair of
// functions rather than a list of rectangles, and this is the implementation the hall
// hands it: the room's own bounds, and the column footprints observatory.ts generates
// at runtime. Nothing here is written down anywhere -- move an exhibit and a suppressed
// column stops being an obstacle on the next build, for the cats as for the visitors.
//
// Doorways are deliberately NOT openings here. A cat that walks into the next room needs
// cross-room state that nobody owns yet (the cats are client-local), so v0.1 keeps them in
// one room: `insideRoom`'s rectangle, minus the columns. When that changes, this is the
// one function that changes, and `resolveMove` already reports which room a step landed in.

/** A column's square footprint: conservative at the corners by ~17 cm, which is a cat's whisker. */
function columnKeepOut(room: Room): Rect[] {
  return columnFootprints(room).map(({ x, z }) => ({
    minX: x - COLUMN_FOOT_M, maxX: x + COLUMN_FOOT_M,
    minZ: z - COLUMN_FOOT_M, maxZ: z + COLUMN_FOOT_M,
  }));
}

/** Where a cat may stand in this room, asked rather than described. */
export function roomArena(room: Room): Arena {
  const [minX, , minZ] = room.bounds.min;
  const [maxX, , maxZ] = room.bounds.max;
  return rectArena({ minX, maxX, minZ, maxZ, keepOut: columnKeepOut(room) });
}
