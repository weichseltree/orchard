import { describe, expect, it } from "vitest";
import { detectDevice } from "./device";

// Three decisions ride on this: which variant is streamed, what
// devicePixelRatio is capped at, and which controls are wired up. Getting an
// iPad wrong costs it 25 MB and every control it has.

const media = (matches: boolean) => ({ matchMedia: () => ({ matches }), devicePixelRatio: 2 });

function withTouchPoints<T>(points: number, run: () => T): T {
  const nav = globalThis.navigator as { maxTouchPoints?: number } | undefined;
  const had = Object.prototype.hasOwnProperty.call(globalThis, "navigator");
  const previous = nav?.maxTouchPoints;
  if (!had) {
    Object.defineProperty(globalThis, "navigator", {
      value: { maxTouchPoints: points },
      configurable: true,
    });
  } else {
    Object.defineProperty(globalThis.navigator, "maxTouchPoints", {
      value: points,
      configurable: true,
    });
  }
  try {
    return run();
  } finally {
    if (!had) delete (globalThis as { navigator?: unknown }).navigator;
    else if (previous !== undefined) {
      Object.defineProperty(globalThis.navigator, "maxTouchPoints", {
        value: previous,
        configurable: true,
      });
    }
  }
}

describe("detectDevice", () => {
  it("gives a desktop the best variant and a 2.0 pixel-ratio cap", () => {
    const profile = withTouchPoints(0, () =>
      detectDevice("Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0 Safari/537.36", media(false)),
    );
    expect(profile).toMatchObject({ tier: "desktop", touch: false, headset: false, maxPixelRatio: 2 });
  });

  it("gives the Quest browser the vr-quest variant and no upscaling", () => {
    const profile = withTouchPoints(0, () =>
      detectDevice(
        "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/34.0 Chrome/136 VR Safari/537.36",
        media(false),
      ),
    );
    expect(profile).toMatchObject({ tier: "vr-quest", headset: true, touch: false, maxPixelRatio: 1 });
  });

  it("gives a phone the phone variant and caps the pixel ratio at 1.5", () => {
    const profile = withTouchPoints(5, () =>
      detectDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/141.0.0.0 Mobile Safari/537.36",
        media(true),
      ),
    );
    expect(profile).toMatchObject({ tier: "phone", touch: true, maxPixelRatio: 1.5 });
  });

  it("catches an iPad in desktop mode, which sends a Macintosh UA", () => {
    const profile = withTouchPoints(5, () =>
      detectDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        media(true),
      ),
    );
    expect(profile.touch).toBe(true);
    expect(profile.tier).toBe("phone");
  });

  it("does not call a touchscreen laptop a phone", () => {
    const profile = withTouchPoints(10, () =>
      detectDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36",
        media(false),
      ),
    );
    expect(profile.tier).toBe("desktop");
  });
});
