import { Vector3 } from "three";

// The one moving part of the palace's light: a gain on the baked field
// inside a box (the club and its stage, world/venue.ts), driven each frame
// from main.ts (audio/beat.ts). Kept apart from lightfield.ts so the frame
// loop can move it without carrying the bake on the startup path; the stone
// shader reads these uniforms beside the field's (lightfield.ts).

export const pulseUniforms = {
  /** An empty box (min above max) pulses nothing. */
  uPulseMin: { value: new Vector3(1, 1, 1) },
  uPulseMax: { value: new Vector3(0, 0, 0) },
  uPulse: { value: 1 },
};

/** Where the pulse plays; null switches it off everywhere. */
export function setPulseBox(box: { min: readonly [number, number, number]; max: readonly [number, number, number] } | null): void {
  if (!box) {
    pulseUniforms.uPulseMin.value.set(1, 1, 1);
    pulseUniforms.uPulseMax.value.set(0, 0, 0);
    return;
  }
  pulseUniforms.uPulseMin.value.set(box.min[0], box.min[1], box.min[2]);
  pulseUniforms.uPulseMax.value.set(box.max[0], box.max[1], box.max[2]);
}

/** Whoever else follows the pulse: the architecture tints a pulsing room's own lamps (observatory.ts). */
const pulseHooks = new Set<(gain: number) => void>();
export function onPulse(hook: (gain: number) => void): () => void {
  pulseHooks.add(hook);
  return () => pulseHooks.delete(hook);
}

/** This frame's gain on the baked light inside the pulse box, and on whatever follows it; 1 is the bake as baked. */
export function setPulse(gain: number): void {
  pulseUniforms.uPulse.value = gain;
  for (const hook of pulseHooks) hook(gain);
}
