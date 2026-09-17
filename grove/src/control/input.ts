// One frame's worth of intent, whatever produced it. Desktop, touch and XR all
// write into the same object so locomotion and the AABB clamp exist once.

export interface InputState {
  /** -1 back .. 1 forward. */
  forward: number;
  /** -1 left .. 1 right. */
  strafe: number;
  run: boolean;
  /** Radians to turn this frame; consumed by the locomotion step. */
  yawDelta: number;
  /** Radians to pitch this frame (ignored in XR: the neck owns pitch). */
  pitchDelta: number;
  /** -1 .. 1, a held scrub (VR right thumbstick). */
  scrub: number;
}

export function createInput(): InputState {
  return { forward: 0, strafe: 0, run: false, yawDelta: 0, pitchDelta: 0, scrub: 0 };
}

/** Deltas are one-shot; levels are not. */
export function consumeDeltas(input: InputState): void {
  input.yawDelta = 0;
  input.pitchDelta = 0;
}

/** Commands that are events, not levels. */
export interface Commands {
  togglePlay(): void;
  nudgeFrames(delta: number): void;
  cycleSpeed(): void;
  /** The next display mode of the room's planet, when there is one. */
  cycleAtlas(): void;
  toggleProvenance(): void;
  togglePerf(): void;
  toggleUnmute(): void;
  /** The game whose table the visitor stands at, when the room has one (G). */
  openGame(): void;
  /**
   * Point and go (INTERACTION.md §1.2): frame the exhibit or glide to the floor
   * under a screen point (-1..1 each way, y up), or under the crosshair for
   * null. Says what it found; "nothing" also while the code is still loading.
   */
  point(at: { x: number; y: number } | null): "exhibit" | "floor" | "nothing";
  /** Frame the next (1) or previous (-1) exhibit of the room (N, Shift+N). */
  nextExhibit(delta: 1 | -1): void;
  /** The plan of this area's rooms (L). */
  toggleMap(): void;
  /** Back to free walking: no glide, no framed exhibit (Escape). */
  release(): void;
}

/** A stick reading with its dead zone removed and its edge rescaled. */
export function deadzone(value: number, threshold = 0.18): number {
  const magnitude = Math.abs(value);
  if (magnitude < threshold) return 0;
  const scaled = (magnitude - threshold) / (1 - threshold);
  return Math.sign(value) * Math.min(1, scaled);
}
