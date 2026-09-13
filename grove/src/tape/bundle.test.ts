import { describe, expect, it } from "vitest";
import { TapeBundleSchema, TapeVariantSchema, tapeTimeUnit } from "./bundle";

const legacy = {
  frames: 3, n: 8, frame_stride: 2, slot_stride: 1, dt_tau: 2, t0_tau: 10,
  chunk_frames: 3, chunks: [{ file: "vr-quest/c0000.bin", frame0: 0, frames: 3 }],
};

describe("compatible source timing metadata", () => {
  it("still accepts existing OTC1 variants without new timing fields", () => {
    expect(TapeVariantSchema.parse(legacy).times_tau).toBeUndefined();
  });

  it("preserves exact recorded times and the source cadence", () => {
    const variant = TapeVariantSchema.parse({ ...legacy, times_tau: [10, 11.9, 14], source_dt_tau: 1 });
    expect(variant.times_tau).toEqual([10, 11.9, 14]);
    expect(variant.source_dt_tau).toBe(1);
  });

  it.each([
    { times_tau: [10, 14] }, { times_tau: [10, 10, 14] },
    { times_tau: [11, 12, 14] }, { times_tau: [10, Number.POSITIVE_INFINITY, 14] },
    { times_tau: [10, Number.NaN, 14] }, { dt_tau: 0 }, { source_dt_tau: 0 },
  ])("refuses clocks that cannot locate every frame: %j", (invalid) => {
    expect(TapeVariantSchema.safeParse({ ...legacy, ...invalid }).success).toBe(false);
  });

  it("does not infer tau from a historical field name", () => {
    expect(tapeTimeUnit({ units: "reduced (sigma, t0)" })).toBe("t0");
    expect(tapeTimeUnit({ units: "SI", time_unit: "s" })).toBe("s");
    expect(tapeTimeUnit({ units: "unspecified" })).toBe("source time");
    expect(tapeTimeUnit({ units: "reduced (sigma, tau)" })).toBe("tau");
  });

  it("keeps unknown source fields, including dropped-channel disclosures", () => {
    const bundle = TapeBundleSchema.parse({ schema: "orchard/bundle/1", kind: "tape", id: "",
      title: "clock", tree: "fixture", box: [1, 1, 1], n_slots: 8,
      source: { omitted_channels: ["ke"] }, variants: { "vr-quest": legacy } });
    expect(bundle.source["omitted_channels"]).toEqual(["ke"]);
  });
});
