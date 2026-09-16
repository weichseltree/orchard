import type { Mansion, Room } from "../world/schema";

/** Curatorial copy is separate from the tapes and their scientific provenance. */
export interface ExhibitContent {
  source?: string;
  question: string;
  introduction: string;
  lookFor: readonly string[];
  limitation?: string;
  species?: string;
  evidenceAnchor?: string;
  demo?: boolean;
}

export const RESEARCH_ORDER = ["einstruct", "spectre", "phototroph", "world-engine"] as const;
const NOTES = "https://github.com/weichseltree/orchard/blob/main/docs/EXHIBIT-PLAN.md";

const content: Readonly<Record<string, ExhibitContent>> = {
  hall: {
    question: "Which question draws you in?",
    introduction: "Welcome to the Observatory. Walk among particle tapes, compare a model with its control, or look closely at how a room is reconstructed. Each chamber begins with a question.",
    lookFor: [],
    limitation: "The architecture sets the scene. The tapes and stills carry the research; About this view identifies what you are looking at.",
  },
  einstruct: {
    source: "einstruct",
    question: "When do two kinds stop mixing?",
    introduction: "When unlike particles meet, both disappear. Compare a sheet left to evolve with its neighbour, where the particle kinds are repeatedly shuffled.",
    lookFor: [
      "Pause late in the tapes. Look for patches of the same kind, then compare their size and persistence between the two sheets.",
      "Move back towards the beginning. Follow how the patches emerge, rather than judging the comparison from one frame.",
    ],
    limitation: "A sampled browser view cannot measure every empty region in the full simulation.",
    species: "A and B name the two particle kinds. Colour identifies kind; it does not show temperature.",
    evidenceAnchor: "einstruct",
  },
  spectre: {
    source: "spectre",
    question: "How does a world find its middle?",
    introduction: "Three self-gravitating worlds start with the same mixture of heavy and light particles; the strength with which the two kinds repel each other differs across the trio. Each is cut open, its surface the measured edge of the particles and its interior measured from them, frame by frame.",
    lookFor: [
      "Let the record run and compare the three cut faces at the same moment. Where the two kinds repel most, the heavy kind gathers at the centre soonest.",
      "Switch what the faces show: composition, temperature or pressure. The lit view adds a glow that encodes temperature; it is not emitted light.",
      "Walk round a world and back to its cut. The surface alone would hide the centre; the cut is the evidence.",
    ],
    limitation: "One recorded run per world, and nothing interpolated. These runs do not separate unmixing from shared cooling as the cause of a heavy centre.",
    species: "Iron-warm regions hold more of the heavy kind, pale regions more of the light kind; their masses are in a two-to-one ratio. In the temperature and pressure views, colour is the measured field on the legend's scale.",
    evidenceAnchor: "spectre",
  },
  phototroph: {
    source: "phototroph",
    question: "What lets two atoms stay together?",
    introduction: "Follow one encounter between three atoms. Two settle into a pair while the third leaves, carrying energy away.",
    lookFor: [
      "Pause around the encounter. Follow the departing atom, then watch whether the remaining two continue to move together.",
      "Scrub backwards and replay the same encounter slowly. This is one recorded event, not a new experiment each time you press Play.",
    ],
    limitation: "One capture establishes neither equilibrium nor binding rates, and does not test light-driven selection.",
    species: "This tape shows particle positions. The browser does not draw bonds or photons, so staying close must not be read as a displayed bond measurement.",
    evidenceAnchor: "phototroph",
  },
  "world-engine": {
    source: "world-engine",
    question: "What does a new viewpoint reveal?",
    introduction: "Three still studies ask how much of a room can be rebuilt from a compact description. Begin with the classroom, then look behind the chair and along its edges.",
    lookFor: [
      "Compare the room reconstruction with the views behind the chair. Look for holes and stretched surfaces where a viewpoint changes.",
      "At the chair-leg study, compare the same edge across the different images. Small fringes can reveal what a convincing whole-room view conceals.",
    ],
    limitation: "These are still studies, not a live reconstruction or a demonstration of a working lens doorway.",
    evidenceAnchor: "world-engine",
  },
  terrace: {
    question: "Step out under the sky.",
    introduction: "The Horizon Terrace runs along the Observatory's garden side. Follow it to the Lantern Walk, or cross into the Meridian Garden, where the armillary holds the way to the Orrery.",
    lookFor: [],
  },
  orrery: {
    source: "spectre",
    question: "How does a world find its middle?",
    introduction: "Three worlds from spectre, cut open and grown to the scale of the sky. Each began as the same mixture of heavy and light particles; the strength with which the two kinds repel each other differs across the three. Their surface is the measured edge of the particles, and every frame of the interior is measured from them.",
    lookFor: [
      "Walk toward a world and watch its cut faces. The glow marks the hottest matter, an encoding of temperature rather than light.",
      "Compare the three at the same moment. Where the two kinds repel most, the heavy kind gathers at the centre soonest.",
      "The way back is the ring you arrived on: walk into it and the garden returns around you.",
    ],
    limitation: "One recorded run per world, and no interpolation: what moves is the record. A heavy centre here does not by itself separate unmixing from shared cooling as its cause.",
    species: "Iron-warm regions hold more of the heavy kind; pale regions more of the light kind. The glow encodes temperature and is not emitted light.",
    evidenceAnchor: "spectre",
  },
  orangery: {
    question: "Let your eyes travel.",
    introduction: "The Lantern Walk is a place between exhibits. Follow the open doors, look back towards the chambers, or continue out to the terrace. There is a game of chess here: Guide opens it over the room, and closing it puts you back where you stood.",
    lookFor: [],
  },
  gallery: {
    question: "A quieter stretch of the Observatory.",
    introduction: "The Long Gallery is a place to walk and pause. When you are ready for another exhibit, follow the open doorway back to the Binding Chamber.",
    lookFor: [],
  },
  parterre: {
    question: "Find your bearings under the sky.",
    introduction: "Pause in the Meridian Garden, walk out into the groves, or return towards the terrace and the research chambers. The armillary at the crossing is a portal: through it the Orrery's worlds show as globes, and walking into it takes you to their scale.",
    lookFor: ["Approach the armillary and look through it before you step in: what looks like a globe there is eighty metres across on the other side."],
  },
};

const quietRoom: ExhibitContent = {
  question: "Take a moment between questions.",
  introduction: "This is a place to walk and pause. Follow an open doorway when you are ready to return to the research chambers.",
  lookFor: [],
};

/** The demo replaces research exhibits, so its observations and legend must too. */
export function exhibitContent(room: Room, demo = false): ExhibitContent {
  const research = content[room.id] ?? quietRoom;
  if (!demo) return research;
  const hasFixture = room.hangings.some((hanging) => hanging.kind === "tape" || hanging.kind === "video");
  return {
    ...research,
    demo: true,
    introduction: hasFixture
      ? "This room uses synthetic particles for trying the controls. Its research exhibit is not loaded in the local demo."
      : "This local demo lets you explore the Observatory's rooms. Research stills are not loaded, and any particles you find in other chambers are synthetic test material.",
    lookFor: hasFixture
      ? ["Pause the test tape, walk around it, then scrub through time. The chambers share this same test example."]
      : ["Follow an open doorway to try the local test tapes in a research chamber."],
    limitation: "This motion is test material, not evidence for the room's research question.",
    species: undefined,
  };
}

export function evidenceUrl(exhibit: ExhibitContent): string | undefined {
  return exhibit.evidenceAnchor ? `${NOTES}#${exhibit.evidenceAnchor}` : undefined;
}

/** Direct links keep a visitor's mode, but never another room's camera position. */
export function roomHref(search: string, id: string): string {
  const params = new URLSearchParams(search);
  for (const key of ["yaw", "pitch", "x", "z"]) params.delete(key);
  params.set("room", id);
  return `/grove/?${params}`;
}

/** Keep the suggested sequence within the rooms reachable through open doors. */
export function researchRooms(mansion: Mansion): Room[] {
  const reachable = new Set([mansion.start]);
  const pending = [mansion.start];
  while (pending.length > 0) {
    const id = pending.shift();
    const room = mansion.rooms.find((candidate) => candidate.id === id);
    for (const door of room?.doorways ?? []) {
      if (!door.closed && !reachable.has(door.to)) {
        reachable.add(door.to);
        pending.push(door.to);
      }
    }
  }
  return RESEARCH_ORDER.flatMap((id) => {
    const room = mansion.rooms.find((candidate) => candidate.id === id);
    return room && reachable.has(id) ? [room] : [];
  });
}
