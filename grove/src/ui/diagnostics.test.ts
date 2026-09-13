import { expect, it } from "vitest";
import { LayoutStability, summarizeResources } from "./diagnostics";

it("uses layout session windows, excluding intentional changes after input", () => {
  const layout = new LayoutStability();
  layout.sample(100, 0.1, false);
  layout.sample(600, 0.2, false);
  layout.sample(700, 1, true);
  layout.sample(2000, 0.2, false);
  expect(layout.score).toBeCloseTo(0.3);
  for (let time = 2500; time <= 7000; time += 500) layout.sample(time, 0.01, false);
  expect(layout.score).toBeCloseTo(0.3);
});

it("distinguishes cached bodies from unknown cross-origin transfer sizes", () => {
  expect(summarizeResources([
    { transferSize: 500, encodedBodySize: 200, decodedBodySize: 1000 },
    { transferSize: 0, encodedBodySize: 200, decodedBodySize: 1000 },
    { transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 },
  ])).toEqual({ count: 3, knownTransferBytes: 500, encodedBodyBytes: 400, decodedBodyBytes: 2000, cachedCount: 1, unknownSizeCount: 1 });
});
