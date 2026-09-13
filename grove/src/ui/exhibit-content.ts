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
    introduction: "Three self-gravitating balls start with the same mixture of heavy and light particles. The interaction between the two kinds changes across the trio.",
    lookFor: [
      "Move through time across the three tapes. Compare where the heavy particles collect at corresponding moments.",
      "Walk around a ball. Its surface can hide what is happening near the centre; a view from outside is only part of the evidence.",
    ],
    limitation: "These runs do not separate unmixing from shared cooling as the cause of a heavy centre.",
    species: "The warm, dark particles are the heavy kind; the pale particles are the light kind. Their masses are in a two-to-one ratio. Colour marks kind, not heat.",
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
    source: "spectre",
    question: "A world, seen from outside.",
    introduction: "The world above the terrace is the strongest-interaction ball from spectre, shown again at a different scale. Pause here before returning to the chambers.",
    lookFor: ["Watch the whole shape, then visit the Gravity Chamber to compare it with the other two runs."],
    limitation: "A view of the surface hides the centre. This is another view of the same tape, not an additional experiment.",
    species: "Warm, dark particles mark the heavy kind; pale particles mark the light kind.",
    evidenceAnchor: "spectre",
  },
  orangery: {
    question: "Let your eyes travel.",
    introduction: "The Lantern Walk is a place between exhibits. Follow the open doors, look back towards the chambers, or continue out to the terrace.",
    lookFor: [],
  },
  gallery: {
    question: "A quieter stretch of the Observatory.",
    introduction: "The Long Gallery is a place to walk and pause. When you are ready for another exhibit, follow the open doorway back to the Binding Chamber.",
    lookFor: [],
  },
  parterre: {
    question: "Find your bearings under the sky.",
    introduction: "Pause in the Meridian Garden, walk out into the groves, or return towards the terrace and the research chambers.",
    lookFor: [],
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
