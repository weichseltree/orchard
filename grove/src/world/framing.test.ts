import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { framingPose, hangingFace, lookFrom, nextHangingIndex, type Face } from "./framing";
import { insideRoom } from "./navigation";
import { parseMansion, roomById } from "./schema";

const mansion = parseMansion(mansionDocument);
const hall = roomById(mansion, "hall")!;
const EYE = 1.6;

/** The yaw a body needs to look along (dx, dz); forward at yaw 0 is -Z. */
function forward(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

describe("where a hanging is seen from", () => {
  it("reads a wall's picture as facing into its room", () => {
    const wall = hall.hangings.find((h) => h.id === "spectre-wall")!;
    const face = hangingFace(hall, wall);
    expect(face.normal[0]).toBeCloseTo(-1);
    expect(face.normal[1]).toBeCloseTo(0);
    expect(face.width).toBe(6);
  });

  it("stands back until the whole face fits, and faces it", () => {
    const wall = hall.hangings.find((h) => h.id === "spectre-wall")!;
    const face = hangingFace(hall, wall);
    const pose = framingPose(face, hall, 72, 16 / 9, EYE);
    expect(insideRoom(hall, pose.x, pose.z)).toBe(true);
    const distance = Math.hypot(pose.x - face.centre[0], pose.z - face.centre[2]);
    // A 6 m picture at 72 degrees: half its width over tan(horizontal half-angle), plus the margin.
    const halfH = Math.atan(Math.tan((36 * Math.PI) / 180) * (16 / 9));
    expect(distance).toBeCloseTo(1.25 * (3 / Math.tan(halfH)));
    const [fx, fz] = forward(pose.yaw);
    expect(fx).toBeCloseTo((face.centre[0] - pose.x) / distance);
    expect(fz).toBeCloseTo((face.centre[2] - pose.z) / distance);
    // The picture hangs above the eye: the head tips up.
    expect(pose.pitch).toBeGreaterThan(0);
  });

  it("stands further back for a wider face or a narrower view", () => {
    const face: Face = { centre: [0, 1.6, -10], normal: [0, 1], width: 2, height: 1 };
    const room = hall;
    const near = framingPose(face, room, 72, 1.5, EYE);
    const wide = framingPose({ ...face, width: 4 }, room, 72, 1.5, EYE);
    const narrow = framingPose(face, room, 40, 1.5, EYE);
    expect(wide.z).toBeGreaterThan(near.z);
    expect(narrow.z).toBeGreaterThan(near.z);
    // A portrait phone shows less width, so it stands back too.
    expect(framingPose(face, room, 72, 0.5, EYE).z).toBeGreaterThan(near.z);
  });

  it("never stands nearer than reading distance, nor outside the room", () => {
    const tiny: Face = { centre: [0, 1.6, 0], normal: [1, 0], width: 0.1, height: 0.1 };
    expect(framingPose(tiny, hall, 72, 1.5, EYE).x).toBeCloseTo(1.4);
    const huge: Face = { centre: [0, 4, 0], normal: [0, 1], width: 80, height: 40 };
    const pose = framingPose(huge, hall, 72, 1.5, EYE);
    expect(insideRoom(hall, pose.x, pose.z, 0.35 - 1e-9)).toBe(true);
  });

  it("reads a tape from its stand's side, and a planet from where the visitor lands", () => {
    const einstruct = roomById(mansion, "einstruct")!;
    const tape = einstruct.hangings.find((h) => h.kind === "tape")!;
    expect(hangingFace(einstruct, tape).normal[1]).toBeCloseTo(1);
    const orrery = roomById(mansion, "orrery")!;
    const planet = orrery.hangings.find((h) => h.kind === "planet")!;
    const face = hangingFace(orrery, planet);
    const pose = framingPose(face, orrery, 72, 1.5, EYE);
    expect(insideRoom(orrery, pose.x, pose.z)).toBe(true);
    const toSpawn = [orrery.spawn.position[0] - face.centre[0], orrery.spawn.position[2] - face.centre[2]];
    expect(face.normal[0] * toSpawn[0]! + face.normal[1] * toSpawn[1]!).toBeGreaterThan(0);
  });

  it("frames every hanging in the palace from inside its own room", () => {
    for (const room of mansion.rooms) {
      for (const hanging of room.hangings) {
        const pose = framingPose(hangingFace(room, hanging), room, 72, 1.5, EYE);
        expect(insideRoom(room, pose.x, pose.z), `${hanging.id}`).toBe(true);
        expect(Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch)).toBe(true);
      }
    }
  });

  it("looks level at a point at eye height", () => {
    const pose = lookFrom(0, 0, [0, 1.6, -5], 1.6);
    expect(pose.yaw).toBeCloseTo(0);
    expect(pose.pitch).toBeCloseTo(0);
  });
});

describe("the order N walks a room's hangings in", () => {
  it("starts at the first, or the last going back, and wraps both ways", () => {
    expect(nextHangingIndex(4, null, 1)).toBe(0);
    expect(nextHangingIndex(4, null, -1)).toBe(3);
    expect(nextHangingIndex(4, 1, 1)).toBe(2);
    expect(nextHangingIndex(4, 3, 1)).toBe(0);
    expect(nextHangingIndex(4, 0, -1)).toBe(3);
    expect(nextHangingIndex(0, null, 1)).toBeNull();
    // An index from another room's count is not trusted.
    expect(nextHangingIndex(2, 5, 1)).toBe(0);
  });
});
