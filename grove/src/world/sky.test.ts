import { BackSide, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import hallRecord from "../../public/assets/hall/hall.json";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { SKY_RADIUS, buildSky, sunFromAsset, sunFromBlenderTravel } from "./sky";

// The hall's windows are open apertures. The sky outside must put the sun
// where the bake put it, or the pools on the floor and the disc in the window
// disagree; and mansion.json's copy of the bake's sun must not drift from
// hall.json, the record it was copied from.

const HALL_SUN = hallRecord.lighting.sun_direction_blender as [number, number, number];

describe("sunFromBlenderTravel", () => {
  it("turns the bake's travel direction into a world vector towards the sun", () => {
    const sun = sunFromBlenderTravel(HALL_SUN);
    // Blender (x, y, z) -> glTF (x, z, -y), then flipped: (-x, -z, y).
    expect(sun.x).toBeCloseTo(-0.7796, 3);
    expect(sun.y).toBeCloseTo(0.5498, 3);
    expect(sun.z).toBeCloseTo(0.2999, 3);
    expect(sun.length()).toBeCloseTo(1, 6);
  });

  it("puts the hall's sun on the window side, about 33 degrees up", () => {
    const sun = sunFromBlenderTravel(HALL_SUN);
    // The windows are on the -X wall (WP3); the sun comes in through them.
    expect(sun.x).toBeLessThan(0);
    expect((Math.asin(sun.y) * 180) / Math.PI).toBeCloseTo(33.4, 0);
  });
});

describe("mansion.json sky", () => {
  it("names the same sun as the hall's bake record", () => {
    const sky = parseMansion(mansionDocument).sky;
    expect(sky).toBeDefined();
    expect(sky!.sunTravelBlender).toEqual(HALL_SUN);
    expect(sky!.sunAngleDeg).toBe(hallRecord.lighting.sun_angle_deg);
  });
});

describe("sunFromAsset", () => {
  it("reads lighting.sun_direction_blender out of a glb's extras", () => {
    const sun = sunFromAsset({ orchard: { lighting: { sun_direction_blender: HALL_SUN } } });
    expect(sun).not.toBeNull();
    expect(sun!.x).toBeCloseTo(-0.7796, 3);
  });

  it("is null for today's hall, whose extras carry no lighting record", () => {
    expect(sunFromAsset({ orchard: { lightmap: { scale: 3.41 } } })).toBeNull();
    expect(sunFromAsset({})).toBeNull();
    expect(sunFromAsset({ orchard: { lighting: { sun_direction_blender: [0, "x", 1] } } })).toBeNull();
    expect(sunFromAsset({ orchard: { lighting: { sun_direction_blender: [0, 0, 0] } } })).toBeNull();
  });
});

describe("buildSky", () => {
  it("is a dome seen from inside, drawn first, inside the camera's far plane", () => {
    const sky = buildSky(parseMansion(mansionDocument).sky!);
    const material = sky.mesh.material as { side: number; depthWrite: boolean };
    expect(material.side).toBe(BackSide);
    expect(material.depthWrite).toBe(false);
    expect(sky.mesh.renderOrder).toBeLessThan(0);
    expect(sky.mesh.frustumCulled).toBe(false);
    // Rooms sit within 20 m of the origin; the far plane is 120 (view.ts).
    expect(SKY_RADIUS + 20).toBeLessThan(120);
    sky.dispose();
  });

  it("takes the asset's sun when one is offered", () => {
    const sky = buildSky(parseMansion(mansionDocument).sky!);
    sky.setSun(new Vector3(0, 2, 0));
    expect(sky.sun.y).toBeCloseTo(1, 6);
    const uniform = (sky.mesh.material as unknown as { uniforms: { uSunDir: { value: Vector3 } } })
      .uniforms;
    expect(uniform.uSunDir.value.y).toBeCloseTo(1, 6);
    sky.dispose();
  });
});
