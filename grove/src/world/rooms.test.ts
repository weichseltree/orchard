import { DirectionalLight, Group, HemisphereLight, Light, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { lightmapCandidates, proceduralRoom, readMarkers, shellLights } from "./rooms";
import { parseMansion, roomById } from "./schema";

// The glb's marker empties are the authority on where things are. This is
// WP3's hall as its nodes come out of the loader: spawn on the floor, the
// doorway on the -Z wall, and the poster panel on +X facing back into the hall.

function hallScene(): Object3D {
  const scene = new Group();
  const spawn = new Object3D();
  spawn.name = "spawn";
  spawn.position.set(0, 0, 8);
  spawn.userData = { role: "spawn", eye_height_m: 1.6 };
  const door = new Object3D();
  door.name = "door_einstruct";
  door.position.set(0, 0, -10);
  door.quaternion.set(0, 1, 0, 0);
  door.userData = { role: "doorway", width_m: 2.4, height_m: 3.2, to: "einstruct" };
  const poster = new Object3D();
  poster.name = "poster_wall";
  poster.position.set(7.04, 3.1, 0);
  poster.quaternion.set(0, Math.SQRT1_2, 0, Math.SQRT1_2);
  poster.userData = { role: "poster", width_m: 6, height_m: 3.4 };
  scene.add(spawn, door, poster);
  return scene;
}

describe("readMarkers", () => {
  const hall = roomById(parseMansion(mansionDocument), "hall")!;
  const markers = readMarkers(hallScene(), hall);

  it("reads the spawn and the doorway", () => {
    expect(markers.spawn).toMatchObject({ position: [0, 0, 8], eyeHeight: 1.6 });
    expect(markers.spawn!.yawDeg).toBeCloseTo(0);
    expect(markers.doors.get("einstruct")).toEqual({ at: -10, center: 0, width: 2.4, height: 3.2 });
  });

  it("reads the poster panel, whose local -Z points into the hall", () => {
    const poster = markers.posters.get("poster_wall")!;
    expect(poster).toBeDefined();
    expect(poster.position[0]).toBeCloseTo(7.04);
    expect(poster.width).toBe(6);
    expect(poster.height).toBe(3.4);
    const normal = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...poster.quaternion));
    expect(normal.x).toBeCloseTo(-1);
    expect(normal.y).toBeCloseTo(0);
    expect(normal.z).toBeCloseTo(0);
  });
});

function lightsUnder(root: Object3D): Light[] {
  const lights: Light[] = [];
  root.traverse((node) => {
    if (node instanceof Light) lights.push(node);
  });
  return lights;
}

describe("shellLights", () => {
  const hall = roomById(parseMansion(mansionDocument), "hall")!;

  it("gives a baked room no lights at all: the bake is the lighting, and a light is global", () => {
    expect(shellLights(hall, { applied: 12 })).toEqual([]);
  });

  it("lights a glb whose lightmap did not take like the grey shell", () => {
    for (const lightmap of [{ applied: 0 }, null]) {
      const lights = lightsUnder(new Group().add(...shellLights(hall, lightmap)));
      expect(lights.some((l) => l instanceof HemisphereLight)).toBe(true);
      expect(lights.some((l) => l instanceof DirectionalLight)).toBe(true);
    }
  });

  it("leaves the grey shell its own hemisphere and key", () => {
    const shell = proceduralRoom(hall);
    expect(shell.getObjectByName("hall-lights")).toBeDefined();
    const lights = lightsUnder(shell);
    expect(lights.filter((l) => l instanceof HemisphereLight)).toHaveLength(1);
    expect(lights.filter((l) => l instanceof DirectionalLight)).toHaveLength(1);
  });
});

describe("lightmapCandidates", () => {
  const hall = roomById(parseMansion(mansionDocument), "hall")!;

  it("gives the phone its 1024 tier and everyone else the 2048 KTX2, PNG behind both", () => {
    expect(lightmapCandidates(hall, "phone")).toEqual([
      "assets/palace/hall/lightmap-1024.ktx2",
      "assets/palace/hall/lightmap.png",
    ]);
    for (const tier of ["desktop", "vr-quest", "vr-high", undefined] as const) {
      expect(lightmapCandidates(hall, tier)).toEqual([
        "assets/palace/hall/lightmap.ktx2",
        "assets/palace/hall/lightmap.png",
      ]);
    }
  });

  it("falls back to the one list when a room has no phone tier", () => {
    expect(lightmapCandidates({ lightmap: ["a.png"], lightmapPhone: [] }, "phone")).toEqual(["a.png"]);
  });
});
