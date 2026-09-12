import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TapeBundleSchema, pickVariant, variantSlots } from "./bundle";
import { TapeChunk } from "./decode";
import { chunkByteLength, dequantize } from "./format";
import { advance, frameAt, timeline } from "./time";

// Every other decoder test runs on `devtape.ts`, which the dev generator also
// writes: a shared misreading of the spec would be invisible in both. These
// run against WP1's real output — `results/bundles/` is gitignored, so they
// skip loudly rather than fail on a checkout that has not built the bundles.

const BUNDLE_ID = "84b67b5a0d22eeab";
const dir = fileURLToPath(new URL(`../../../results/bundles/${BUNDLE_ID}/`, import.meta.url));
const present = existsSync(`${dir}bundle.json`);
const when = present ? describe : describe.skip;

if (!present) {
  console.warn(
    `[real-bundle.test] results/bundles/${BUNDLE_ID}/ is not here; skipping the real-bundle checks. ` +
      `Run WP1's \`uv run orchard bundle tape …\` to get them.`,
  );
}

when(`WP1 bundle ${BUNDLE_ID}`, () => {
  const bundle = TapeBundleSchema.parse(JSON.parse(readFileSync(`${dir}bundle.json`, "utf8")));

  it("parses under the client's own schema", () => {
    expect(bundle.kind).toBe("tape");
    expect(bundle.id).toBe(BUNDLE_ID);
    expect(bundle.tree).toBe("einstruct");
    expect(Object.keys(bundle.variants).sort()).toEqual(["phone", "vr-high", "vr-quest"]);
    // A 2D tape: Lz is 1 and every z is 0.
    expect(bundle.box[2]).toBe(1);
  });

  it("takes each tier's slot count from the variant, not from the stride", () => {
    for (const [name, variant] of Object.entries(bundle.variants)) {
      expect(variant.n, name).toBeGreaterThan(0);
      expect(variantSlots(bundle, variant), name).toBe(variant.n);
    }
    expect(pickVariant(bundle, "phone")?.name).toBe("phone");
    expect(pickVariant(bundle, "vr-quest")?.name).toBe("vr-quest");
    expect(pickVariant(bundle, "desktop")?.name).toBe("vr-high");
  });

  it("tiles every variant's frames with no gap and no overlap", () => {
    for (const [name, variant] of Object.entries(bundle.variants)) {
      let next = 0;
      for (const chunk of variant.chunks) {
        expect(chunk.frame0, `${name} ${chunk.file}`).toBe(next);
        next += chunk.frames;
      }
      expect(next, name).toBe(variant.frames);
    }
  });

  for (const name of ["phone", "vr-quest", "vr-high"]) {
    it(`decodes ${name}'s first and last chunk against bundle.json`, () => {
      const variant = bundle.variants[name]!;
      const slots = variantSlots(bundle, variant);
      for (const ref of [variant.chunks[0]!, variant.chunks[variant.chunks.length - 1]!]) {
        const bytes = readFileSync(dir + ref.file);
        const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const chunk = TapeChunk.decode(copy as ArrayBuffer);
        expect(chunk.n).toBe(slots);
        expect(chunk.frames).toBe(ref.frames);
        expect(chunk.frame0).toBe(ref.frame0);
        // The header's f32 dt against bundle.json's f64.
        expect(chunk.dt).toBeCloseTo(variant.dt_tau, 5);
        expect(chunk.t0).toBeCloseTo(variant.t0_tau + ref.frame0 * variant.dt_tau, 3);
        expect(bytes.byteLength).toBe(chunkByteLength(slots, ref.frames));

        const frame = chunk.localFrame(0);
        expect(frame.positions).toHaveLength(slots * 3);
        for (let i = 0; i < slots; i++) {
          // 2D: z is zero for every slot, and every species is in the palette.
          expect(frame.positions[i * 3 + 2]).toBe(0);
          expect(frame.species[i]!).toBeLessThan(8);
          expect(frame.alive[i]!).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it("agrees with the recorded species counts and alive counts", () => {
    const counts = (bundle as unknown as { species_counts?: number[] }).species_counts;
    const variant = bundle.variants["vr-high"]!;
    const first = readFileSync(dir + variant.chunks[0]!.file);
    const chunk = TapeChunk.decode(
      first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) as ArrayBuffer,
    );
    const frame = chunk.localFrame(0);
    const seen = [0, 0];
    let alive = 0;
    for (let i = 0; i < chunk.n; i++) {
      seen[frame.species[i]!]! += 1;
      alive += frame.alive[i]!;
    }
    if (counts) expect(seen).toEqual(counts);
    const declared = (variant as unknown as { alive?: { first: number } }).alive;
    if (declared) expect(alive).toBe(declared.first);
  });

  it("inverts WP1's quantization with no off-by-one", () => {
    const [lx] = bundle.box;
    expect(dequantize(0, lx)).toBe(0);
    expect(dequantize(65535, lx)).toBeCloseTo(lx, 9);
    // Worst error is half a quantization step.
    expect(lx / 65535 / 2).toBeLessThan(1e-2);
  });

  it("never leaves the tape, however long it plays at 4x", () => {
    for (const [name, variant] of Object.entries(bundle.variants)) {
      const tl = timeline(variant.frames, variant.dt_tau, variant.t0_tau);
      let tau = tl.t0Tau;
      for (let i = 0; i < 20000; i++) {
        tau = advance(tl, tau, 1 / 72, 4, true);
        const frame = frameAt(tl, tau);
        if (frame < 0 || frame >= tl.frames) {
          throw new Error(`${name}: frame ${frame} outside 0..${tl.frames - 1} at tau ${tau}`);
        }
      }
      expect(frameAt(tl, tau)).toBeLessThan(tl.frames);
    }
  });
});
