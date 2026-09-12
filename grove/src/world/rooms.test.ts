import { Group, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { readMarkers } from "./rooms";
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
