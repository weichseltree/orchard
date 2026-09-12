import type { DeviceTier } from "./tape/bundle";

// What kind of thing is this running on. Used for three decisions only: which
// bundle variant to stream, what to cap devicePixelRatio at, and which
// controls to wire up. Everything else is feature detection.

export interface DeviceProfile {
  tier: DeviceTier;
  /** Touch-first, no mouse: phones and tablets. */
  touch: boolean;
  /** A standalone headset browser (Quest). */
  headset: boolean;
  /** Cap for renderer.setPixelRatio. */
  maxPixelRatio: number;
}

export function detectDevice(
  ua: string = navigator.userAgent,
  win: { devicePixelRatio: number; matchMedia?: (q: string) => { matches: boolean } } = window,
): DeviceProfile {
  const headset = /OculusBrowser|Quest|Pico|VisionOS/i.test(ua);
  const coarse = win.matchMedia?.("(pointer: coarse)").matches ?? false;
  // An iPad in its default "desktop" mode sends a Macintosh UA with no Mobile
  // token; without the touch-point count it gets the desktop tier, a 25 MB
  // variant and no controls at all, because there is no pointer to lock.
  const multiTouch = (navigator as { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || multiTouch > 1;
  const touch = !headset && coarse && mobileUa;
  if (headset) return { tier: "vr-quest", touch: false, headset: true, maxPixelRatio: 1 };
  // A phone renders more pixels than it can afford; 1.5 is the ceiling that
  // keeps the tape and one decoder inside the frame budget.
  if (touch) return { tier: "phone", touch: true, headset: false, maxPixelRatio: 1.5 };
  return { tier: "desktop", touch: false, headset: false, maxPixelRatio: 2 };
}
