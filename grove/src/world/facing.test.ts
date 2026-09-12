import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { placeStill, roomBox } from "./world";
import { WALL_THICKNESS } from "./rooms";

// A still or video on a box room's wall must face INTO the room, or the
// visitor sees its back (2026-09-12: three world-engine stills hung with
// their faces in the wall).
describe("wall hangings face into their room", () => {
  const mansion = parseMansion(mansionDocument);
  for (const room of mansion.rooms) {
    if (room.glb) continue; // a baked room's markers own the facing
    const centre = roomBox(room).getCenter(new Vector3());
    for (const hanging of room.hangings) {
      if (hanging.kind === "tape") continue;
      it(`${room.id}/${hanging.id}`, () => {
        const place = placeStill(
          { position: hanging.position, rotationDeg: hanging.rotationDeg, widthMeters: 6, heightMeters: 3.4 },
          null,
        );
        const normal = new Vector3(0, 0, 1).applyQuaternion(place.quaternion);
        const toCentre = centre.clone().sub(place.position).setY(0).normalize();
        expect(normal.dot(toCentre)).toBeGreaterThan(0.3);
        // The box walls are built INSIDE the bounds, WALL_THICKNESS deep, so a
        // hanging closer to the bounds than that is buried in the wall.
        const inner = roomBox(room).expandByScalar(-WALL_THICKNESS - 0.01);
        expect(inner.containsPoint(place.position)).toBe(true);
      });
    }
  }
});
