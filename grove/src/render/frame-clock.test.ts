import { expect, it } from "vitest";
import { FrameClock } from "./frame-clock";

it("bounds movement after a stall while exposing its entire measured duration", () => {
  const clock = new FrameClock();
  expect(clock.tick(0)).toEqual({ dt: 0, rawDt: 0 });
  expect(clock.tick(400)).toEqual({ dt: 0.1, rawDt: 0.4 });
  expect(clock.tick(420)).toEqual({ dt: 0.02, rawDt: 0.02 });
  clock.reset();
  expect(clock.tick(300_000)).toEqual({ dt: 0, rawDt: 0 });
});
