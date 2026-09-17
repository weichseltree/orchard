// The seam between the brain (src/brain: DOM-free, decides what the cat does) and the body
// (src/body: Three.js, moves a skinned mesh). Neither side imports the other; main.ts wires them.
// Vocabulary is closed, like M1's proxy-animation vocabulary (ADR 0011).

/** What the skeleton can hold at rest. Every clip starts and ends in one of these. */
export type Posture = "stand" | "sit" | "lie" | "loaf";

/** Authored clips. Transitions move between postures; loops hold one. */
export type ClipName =
  // loops
  | "idle" // stand, weight shifts
  | "walk"
  | "trot"
  | "sit-idle"
  | "lie-idle"
  | "sleep" // loaf, breathing only, eyes shut
  | "groom" // sit, licks a forepaw and wipes its face
  | "eat" // stand, head down
  | "look-around" // stand or sit, head scan (the body picks by posture)
  // one-shots
  | "sit-down" // stand -> sit
  | "stand-up" // sit -> stand
  | "lie-down" // sit -> lie
  | "get-up" // lie -> sit
  | "tuck" // lie -> loaf
  | "untuck" // loaf -> lie
  | "stretch" // stand -> stand
  | "startle" // any -> stand, a crouched hop back
  | "rub"; // stand -> stand, head and flank along the target

export const CLIP_POSTURE: Record<ClipName, { from: Posture | "any"; to: Posture; loop: boolean }> =
  {
    idle: { from: "stand", to: "stand", loop: true },
    walk: { from: "stand", to: "stand", loop: true },
    trot: { from: "stand", to: "stand", loop: true },
    "sit-idle": { from: "sit", to: "sit", loop: true },
    "lie-idle": { from: "lie", to: "lie", loop: true },
    sleep: { from: "loaf", to: "loaf", loop: true },
    groom: { from: "sit", to: "sit", loop: true },
    eat: { from: "stand", to: "stand", loop: true },
    "look-around": { from: "any", to: "stand", loop: true },
    "sit-down": { from: "stand", to: "sit", loop: false },
    "stand-up": { from: "sit", to: "stand", loop: false },
    "lie-down": { from: "sit", to: "lie", loop: false },
    "get-up": { from: "lie", to: "sit", loop: false },
    tuck: { from: "lie", to: "loaf", loop: false },
    untuck: { from: "loaf", to: "lie", loop: false },
    stretch: { from: "stand", to: "stand", loop: false },
    startle: { from: "any", to: "stand", loop: false },
    rub: { from: "stand", to: "stand", loop: false },
  };

export interface Vec2 {
  x: number;
  z: number;
}

/** Things that happen to the cat. Every one has a pointing-only trigger in the page (rule 8). */
export type WorldEvent =
  | { kind: "player-near"; at: Vec2 }
  | { kind: "player-far" }
  | { kind: "hand-offered"; at: Vec2 }
  | { kind: "petted" }
  | { kind: "food-offered"; at: Vec2 }
  | { kind: "toy-moved"; at: Vec2 }
  | { kind: "loud-noise"; at: Vec2 };

/** What the body reports back each tick. */
export interface BodyState {
  position: Vec2;
  heading: number; // radians, 0 = +z
  posture: Posture;
  clip: ClipName;
  clipDone: boolean; // a one-shot finished, or a loop completed at least one cycle
  arrived: boolean; // within arrival radius of the last moveTo, or no moveTo pending
}

/** What the brain asks for. The body plans the posture transitions itself: asking for "walk"
 * while sitting plays "stand-up" first. */
export interface BodyCommand {
  clip: ClipName;
  moveTo?: Vec2; // only with walk/trot
  lookAt?: Vec2 | null; // procedural head aim, layered over any clip; null clears it
  /** The brain's current behaviour, for the debug overlay only. */
  behaviour: string;
}
