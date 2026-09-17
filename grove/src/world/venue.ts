import type { Mansion, Room, VenueNeed } from "./schema";

// The venue's door policy, as pure functions. A room may ask for things a
// visitor has switched on (`requires` in mansion.json): the club asks for a
// microphone and for sound, its stage for an immersive session. The gate is
// the same one presence uses -- a doorway into a room that asks more than the
// visitor has is a wall (navigation.ts `locked`) -- so walking, the XR head
// push, a pointer teleport and the portals all refuse it through one
// predicate, and nothing here moves a body. What a visitor has is a snapshot
// the caller takes from the audio gate, the microphone grant and the XR
// session; what the door says when it refuses is written here too, so the
// wording is tested and lives in one place.

/** The venue's colour where it shows outside the architecture: the door curtains. A design token. */
export const VENUE_TINT = "#ff3fb0";

/** What the visitor has switched on, right now. */
export interface VenueState {
  microphone: boolean;
  sound: boolean;
  immersive: boolean;
}

export const NOTHING_ON: VenueState = { microphone: false, sound: false, immersive: false };

/** The room's needs the visitor has not met, in the room's own order. */
export function unmetNeeds(room: Room | undefined, state: VenueState): VenueNeed[] {
  if (!room) return [];
  return room.requires.filter((need) => !state[need]);
}

/** Whether the door into `roomId` is a wall for this visitor. */
export function venueBarred(mansion: Mansion, roomId: string, state: VenueState): boolean {
  return unmetNeeds(mansion.rooms.find((r) => r.id === roomId), state).length > 0;
}

/** Every room whose door is a wall for this visitor; for the curtains, which show only over barred doors. */
export function barredRooms(mansion: Mansion, state: VenueState): Set<string> {
  const out = new Set<string>();
  for (const room of mansion.rooms) if (unmetNeeds(room, state).length > 0) out.add(room.id);
  return out;
}

/** Whether any room of the mansion asks for `need`, so a control is offered only where it opens a door. */
export function anyRoomAsks(mansion: Mansion, need: VenueNeed): boolean {
  return mansion.rooms.some((room) => room.requires.includes(need));
}

/**
 * The rooms whose doors this visitor should be told about: the room they
 * stand in and its open neighbours. An offer to switch the microphone on
 * belongs in the foyer, not in the far grove.
 */
export function nearbyNeeds(mansion: Mansion, roomId: string, state: VenueState): VenueNeed[] {
  const here = mansion.rooms.find((r) => r.id === roomId);
  if (!here) return [];
  const out = new Set<VenueNeed>();
  for (const need of unmetNeeds(here, state)) out.add(need);
  for (const door of here.doorways) {
    if (door.closed) continue;
    for (const need of unmetNeeds(mansion.rooms.find((r) => r.id === door.to), state)) out.add(need);
  }
  return [...out];
}

const NEED_TEXT: Record<VenueNeed, string> = {
  microphone: "your microphone on",
  sound: "your sound on",
  immersive: "a headset: it opens to an immersive session only",
};

/**
 * What the door says. One sentence, the room's title first, then what it
 * asks for, then how to give it: on a desk the offers do; in a headset the
 * trigger switches sound on, but a microphone can only be allowed outside
 * the session, which is the one honest thing to say about it.
 */
export function venueReason(title: string, unmet: readonly VenueNeed[], presenting: boolean): string {
  if (unmet.length === 0) return `${title} is open.`;
  const wants = unmet.map((need) => NEED_TEXT[need]);
  const list = wants.length === 1 ? wants[0]! : `${wants.slice(0, -1).join(", ")} and ${wants[wants.length - 1]}`;
  let how = "";
  if (unmet.includes("microphone") && presenting) how = " Allow the microphone outside VR first, then come back.";
  else if (unmet.some((need) => need !== "immersive")) how = presenting ? " Press the trigger to switch it on." : " The offers on screen switch it on.";
  else if (unmet.includes("immersive")) how = " Enter VR to take the stage.";
  return `${title} asks for ${list}.${how}`;
}

/**
 * Where a shared link into a gated room lands: the nearest room, by open
 * doorways, that asks for nothing -- the foyer for the club, the foyer for
 * the stage too. A room that asks nothing is its own entrance.
 */
export function venueEntrance(mansion: Mansion, roomId: string): Room {
  const start = mansion.rooms.find((r) => r.id === roomId) ?? mansion.rooms.find((r) => r.id === mansion.start)!;
  if (start.requires.length === 0) return start;
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const room = queue.shift()!;
    for (const door of room.doorways) {
      if (door.closed || seen.has(door.to)) continue;
      const next = mansion.rooms.find((r) => r.id === door.to);
      if (!next) continue;
      if (next.requires.length === 0) return next;
      seen.add(next.id);
      queue.push(next);
    }
  }
  return mansion.rooms.find((r) => r.id === mansion.start)!;
}

/**
 * Where a visitor goes when a room they stand in stops being theirs (a
 * headset taken off on the stage): the nearest room, by open doorways, that
 * asks for nothing they lack -- the club's floor for a singer who left VR
 * with sound and microphone still on, the foyer if those went too.
 */
export function retreat(mansion: Mansion, roomId: string, state: VenueState): Room {
  const here = mansion.rooms.find((r) => r.id === roomId);
  if (!here) return venueEntrance(mansion, roomId);
  const seen = new Set([here.id]);
  const queue = [here];
  while (queue.length) {
    const room = queue.shift()!;
    for (const door of room.doorways) {
      if (door.closed || seen.has(door.to)) continue;
      const next = mansion.rooms.find((r) => r.id === door.to);
      if (!next) continue;
      if (unmetNeeds(next, state).length === 0) return next;
      seen.add(next.id);
      queue.push(next);
    }
  }
  return venueEntrance(mansion, roomId);
}

/**
 * The box round every room that asks for something: the club and its stage
 * together, for the light pulse, which plays inside it and nowhere else.
 */
export function venueBox(mansion: Mansion): { min: [number, number, number]; max: [number, number, number] } | null {
  let box: { min: [number, number, number]; max: [number, number, number] } | null = null;
  for (const room of mansion.rooms) {
    if (room.requires.length === 0) continue;
    if (!box) box = { min: [...room.bounds.min], max: [...room.bounds.max] };
    else for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis]!, room.bounds.min[axis]!);
      box.max[axis] = Math.max(box.max[axis]!, room.bounds.max[axis]!);
    }
  }
  return box;
}

/** How slowly a silent room breathes, cycles per second. */
export const IDLE_BREATH_HZ = 0.35;

/**
 * The gain on the club's light. Silent (no level): a slow breath about one,
 * never dark. With a level: the floor of the breath plus the low end, so a
 * kick lifts the room and the space between kicks lets it fall. The gain is
 * a multiplier on baked light and on the fittings' own colour; the range is a
 * design token, not a measurement.
 */
export function pulseGain(level: number | null, seconds: number): number {
  const breath = 1 + 0.12 * Math.sin(2 * Math.PI * IDLE_BREATH_HZ * seconds);
  if (level === null) return breath;
  const bass = Math.max(0, Math.min(1, level));
  return 0.78 + 0.9 * bass * bass + 0.08 * (breath - 1);
}
