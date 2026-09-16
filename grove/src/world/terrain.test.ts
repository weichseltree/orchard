import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion, roomById } from "./schema";
import { BODY_RADIUS, resolveMove } from "./navigation";
import {
  STAIR_MARGIN, STAIR_RISE, STAIR_TREAD, flightFraction, flightsOf, floorAt, keepOnFlight, moundHeight, stairRun, stairSteps,
} from "./terrain";

// One height function under the ground mesh, the steps and the feet: a hill
// you see is a hill you climb. The hall is at 0 and the north wing at 1.5,
// so the hall carries the flight; the sunken garden is at -1.6 and the
// terrace at 0, so the garden carries three garden stairs.

const mansion = parseMansion(mansionDocument);
const hall = roomById(mansion, "hall")!;
const wing = roomById(mansion, "world-engine")!;
const parterre = roomById(mansion, "parterre")!;
const terrace = roomById(mansion, "terrace")!;
const west = roomById(mansion, "orchard-west")!;

describe("stairs", () => {
  it("climbs a rise in steps of at most one riser, on treads of one tread", () => {
    expect(stairSteps(1.5)).toBe(10);
    expect(stairSteps(1.6)).toBe(10);
    expect(stairSteps(0.1)).toBe(1);
    expect(stairRun(1.5)).toBeCloseTo(10 * STAIR_TREAD);
    expect(STAIR_RISE * stairSteps(1.5)).toBeGreaterThanOrEqual(1.5);
  });

  it("gives the lower room the flight, never the higher one", () => {
    const hallFlights = flightsOf(mansion, hall);
    expect(hallFlights.map((f) => f.door.to)).toEqual(["world-engine"]);
    expect(hallFlights[0]!.rise).toBeCloseTo(1.5);
    expect(hallFlights[0]!.direction).toBe(1);
    expect(flightsOf(mansion, wing).map((f) => f.door.to)).toEqual([]);
    expect(flightsOf(mansion, parterre).map((f) => f.door.to)).toEqual(["terrace", "terrace", "terrace"]);
    expect(flightsOf(mansion, terrace).filter((f) => f.door.to === "orangery")).toHaveLength(3);
  });

  it("ramps the floor from the foot of the flight to the doorway plane", () => {
    const flight = flightsOf(mansion, hall)[0]!;
    const plane = flight.door.at;
    expect(floorAt(mansion, hall, 0, plane + 0.001)).toBeCloseTo(1.5, 2);
    expect(floorAt(mansion, hall, 0, plane + flight.run / 2)).toBeCloseTo(0.75, 2);
    expect(floorAt(mansion, hall, 0, plane + flight.run + 0.5)).toBe(0);
    expect(floorAt(mansion, hall, 0, 8)).toBe(0);
    // Off the flight's width, the floor is the floor.
    expect(flightFraction(flight, flight.door.width / 2 + STAIR_MARGIN + 0.1, plane + 0.5)).toBeNull();
    expect(floorAt(mansion, hall, 8, plane + 0.5)).toBe(0);
  });

  it("meets the higher floor exactly at the doorway, both ways round", () => {
    for (const room of mansion.rooms) for (const flight of flightsOf(mansion, room)) {
      const neighbour = roomById(mansion, flight.door.to)!;
      const x = flight.door.axis === "x" ? flight.door.at : flight.door.center;
      const z = flight.door.axis === "x" ? flight.door.center : flight.door.at;
      expect(floorAt(mansion, room, x, z), `${room.id} -> ${neighbour.id}`).toBeCloseTo(neighbour.bounds.min[1], 3);
    }
  });

  it("keeps a body that has climbed between the cheek walls", () => {
    const flight = flightsOf(mansion, hall)[0]!;
    const z = flight.door.at + 0.5;
    const half = flight.door.width / 2 + STAIR_MARGIN - BODY_RADIUS;
    expect(keepOnFlight(mansion, hall, { x: half - 0.1, z }, { x: half + 1, z }, BODY_RADIUS).x).toBeCloseTo(half);
    expect(keepOnFlight(mansion, hall, { x: 0, z }, { x: 1, z }, BODY_RADIUS).x).toBe(1);
    // Beside the flight on the level floor, the body walks free.
    expect(keepOnFlight(mansion, hall, { x: half + 1, z }, { x: half + 2, z }, BODY_RADIUS).x).toBe(half + 2);
    // At the foot, the floor is level and the body walks free.
    const foot = flight.door.at + flight.run + 0.1;
    expect(keepOnFlight(mansion, hall, { x: 0, z: foot }, { x: half + 1, z: foot }, BODY_RADIUS).x).toBe(half + 1);
    // And through the clamp: a step sideways off the flight is stopped.
    const out = resolveMove(mansion, "hall", { x: half - 0.1, z }, { x: half + 2, z });
    expect(out.x).toBeCloseTo(half);
  });
});

describe("terrain", () => {
  it("lifts the groves and nothing else", () => {
    const { mounds } = mansion.terrain;
    expect(moundHeight(mounds, mounds[0]!.x, mounds[0]!.z)).toBeCloseTo(mounds[0]!.height);
    expect(moundHeight(mounds, mounds[0]!.x + mounds[0]!.radius, mounds[0]!.z)).toBe(0);
    // No mound reaches the parterre, the terrace or a doorway between cells.
    for (let z = parterre.bounds.min[2]; z <= parterre.bounds.max[2]; z += 2) {
      for (const x of [parterre.bounds.min[0], parterre.bounds.max[0]]) expect(moundHeight(mounds, x, z), `parterre edge ${x},${z}`).toBe(0);
    }
    for (let x = parterre.bounds.min[0]; x <= parterre.bounds.max[0]; x += 2) {
      for (const z of [parterre.bounds.min[2], parterre.bounds.max[2]]) expect(moundHeight(mounds, x, z), `parterre edge ${x},${z}`).toBe(0);
    }
    expect(floorAt(mansion, parterre, -45, 10)).toBeCloseTo(parterre.bounds.min[1]);
    expect(floorAt(mansion, hall, 0, 0)).toBe(0);
  });

  it("is the same height on both sides of an open edge between cells", () => {
    const south = roomById(mansion, "orchard-south")!;
    for (let x = -139; x <= -71; x += 4) {
      expect(floorAt(mansion, west, x, -46)).toBeCloseTo(floorAt(mansion, south, x, -46), 6);
    }
  });

  it("has a hill worth climbing in every grove", () => {
    for (const id of ["orchard-west", "orchard-south", "orchard-east"]) {
      const room = roomById(mansion, id)!;
      let top = room.bounds.min[1];
      for (let x = room.bounds.min[0]; x <= room.bounds.max[0]; x += 3) for (let z = room.bounds.min[2]; z <= room.bounds.max[2]; z += 3) {
        top = Math.max(top, floorAt(mansion, room, x, z));
      }
      expect(top - room.bounds.min[1], id).toBeGreaterThan(1.5);
    }
  });
});
