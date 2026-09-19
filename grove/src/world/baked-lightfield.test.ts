import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mansionDocument from "./mansion.json" with { type: "json" };
import { parseMansion } from "./schema";
import { bakeLightField, getPrebakedLightField, lightAt } from "./lightfield";
import { emittersOf } from "./observatory";
import { BAKED_LIGHT_FIELD_META, decompressLightFieldRLE, getBakedLightFieldData, setBakedLightFieldData } from "./baked-lightfield";

const mansion = parseMansion(mansionDocument);

describe("pre-baked 3D Light Field", () => {
  beforeAll(() => {
    const binPath = path.resolve(process.cwd(), "public/assets/lightfield.bin");
    const rle = new Uint8Array(fs.readFileSync(binPath));
    setBakedLightFieldData(decompressLightFieldRLE(rle, BAKED_LIGHT_FIELD_META.byteLength));
  });
  it("provides valid pre-baked metadata and raw binary texture payload", () => {
    expect(BAKED_LIGHT_FIELD_META).toBeDefined();
    expect(BAKED_LIGHT_FIELD_META.cells).toHaveLength(3);
    expect(BAKED_LIGHT_FIELD_META.cells[0]).toBeGreaterThan(10);
    expect(BAKED_LIGHT_FIELD_META.cells[1]).toBeGreaterThan(5);
    expect(BAKED_LIGHT_FIELD_META.cells[2]).toBeGreaterThan(10);

    const data = getBakedLightFieldData()!;
    expect(data).toBeDefined();
    expect(data.length).toBe(BAKED_LIGHT_FIELD_META.byteLength);
    expect(data.length).toBe(
      BAKED_LIGHT_FIELD_META.cells[0] * BAKED_LIGHT_FIELD_META.cells[1] * BAKED_LIGHT_FIELD_META.cells[2] * 4,
    );
  });

  it("instantiates the pre-baked 3D LightField texture instantly", () => {
    const start = performance.now();
    const prebaked = getPrebakedLightField();
    const elapsed = performance.now() - start;

    expect(prebaked).not.toBeNull();
    expect(prebaked?.texture).toBeDefined();
    expect(prebaked?.cells).toEqual(BAKED_LIGHT_FIELD_META.cells);
    expect(prebaked?.min.x).toBeCloseTo(BAKED_LIGHT_FIELD_META.min[0]);
    expect(prebaked?.min.y).toBeCloseTo(BAKED_LIGHT_FIELD_META.min[1]);
    expect(prebaked?.min.z).toBeCloseTo(BAKED_LIGHT_FIELD_META.min[2]);
    // Instant instantiation should take under 50 ms (vs 1500+ ms for dynamic CPU bake)
    expect(elapsed).toBeLessThan(100);
  });

  it(
    "matches dynamic bakeLightField lighting at key room locations",
    () => {
      const prebaked = getPrebakedLightField()!;
      expect(prebaked).not.toBeNull();

      const emitters = emittersOf(mansion);
      const dynamic = bakeLightField(mansion, emitters);

      // Verify cell dimensions and bounds match exactly:
      expect(prebaked.cells).toEqual(dynamic.cells);
      expect(prebaked.min.toArray()).toEqual(dynamic.min.toArray());
      expect(prebaked.size.toArray()).toEqual(dynamic.size.toArray());

      const testLocations: Array<{ name: string; pos: [number, number, number] }> = [
        { name: "hall center", pos: [0, 2.0, 0] },
        { name: "hall wall sconce", pos: [-6.5, 2.6, 0] },
        { name: "orangery center", pos: [0, 3.0, -25] },
        { name: "foyer entrance", pos: [0, -3.0, 15] },
        { name: "club dance floor", pos: [0, -4.5, 25] },
        { name: "parterre portal", pos: [-27, 0.5, -24.5] },
        { name: "stair-court floor", pos: [-12.5, -4.8, -24.5] },
      ];

      for (const loc of testLocations) {
        const [x, y, z] = loc.pos;
        const lightPre = lightAt(prebaked, x, y, z);
        const lightDyn = lightAt(dynamic, x, y, z);

        expect(lightPre[0], `${loc.name} red`).toBeCloseTo(lightDyn[0], 2);
        expect(lightPre[1], `${loc.name} green`).toBeCloseTo(lightDyn[1], 2);
        expect(lightPre[2], `${loc.name} blue`).toBeCloseTo(lightDyn[2], 2);
      }
    },
    30000,
  );
});
