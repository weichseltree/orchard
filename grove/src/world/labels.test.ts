import { describe, expect, it } from "vitest";
import { Box3, Group, Vector3 } from "three";
import mansionDocument from "./mansion.json";
import { parseMansion, type Doorway, type Room } from "./schema";
import { parseLabels } from "./labels/index";
import en from "./labels/en.json";
import de from "./labels/de.json";
import {
  DOOR_JAMB_M,
  LABEL,
  PANEL,
  buildRoomLabels,
  creditFor,
  disposeRoomLabels,
  entranceWall,
  forwardOf,
  hallDistances,
  planRoomLabels,
  roomCentre,
  type PlaquePlan,
} from "./labels";

// Every plaque of every room: inside its room, off its doorways, and facing
// the reader. The scene document is the fixture, so a room added to
// mansion.json is placed and checked the moment it exists.

const mansion = parseMansion(mansionDocument);
const labels = parseLabels(en);
const labelsDe = parseLabels(de);

function corners(plan: PlaquePlan): Vector3[] {
  const right = new Vector3(1, 0, 0).applyQuaternion(plan.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(plan.quaternion);
  const out: Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    out.push(plan.position.clone().addScaledVector(right, (sx * plan.width) / 2).addScaledVector(up, (sy * plan.height) / 2));
  }
  return out;
}

function normalOf(plan: PlaquePlan): Vector3 {
  return new Vector3(0, 0, 1).applyQuaternion(plan.quaternion);
}

/** The doorway as a horizontal segment across its opening. */
function doorSegment(door: Doorway): [Vector3, Vector3] {
  const h = door.width / 2;
  return door.axis === "x"
    ? [new Vector3(door.at, 0, door.center - h), new Vector3(door.at, 0, door.center + h)]
    : [new Vector3(door.center - h, 0, door.at), new Vector3(door.center + h, 0, door.at)];
}

function distanceToSegment(p: Vector3, [a, b]: [Vector3, Vector3]): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).setY(0).distanceTo(p.clone().setY(0));
}

function box(room: Room): Box3 {
  return new Box3(new Vector3(...room.bounds.min), new Vector3(...room.bounds.max));
}

describe("planRoomLabels over mansion.json", () => {
  for (const room of mansion.rooms) {
    describe(room.id, () => {
      const plans = planRoomLabels(room, labels, mansion);
      const floor = room.bounds.min[1];
      const spawn = new Vector3(...room.spawn.position);

      it("has one entrance panel and one label per hanging", () => {
        expect(plans.filter((p) => p.kind === "entrance")).toHaveLength(1);
        const labelled = plans.filter((p) => p.kind === "label").map((p) => p.hangingId).sort();
        expect(labelled).toEqual(room.hangings.map((h) => h.id).sort());
      });

      for (const plan of plans) {
        const name = `${plan.kind}${plan.hangingId ? ` ${plan.hangingId}` : ""} (${plan.mount})`;

        it(`${name} stays inside the room`, () => {
          const inner = box(room);
          for (const corner of corners(plan)) expect(inner.containsPoint(corner), `corner ${corner.toArray().map((v) => v.toFixed(2)).join(",")}`).toBe(true);
          if (plan.foot) expect(inner.containsPoint(plan.foot)).toBe(true);
        });

        it(`${name} keeps clear of every doorway`, () => {
          for (const door of room.doorways) {
            const segment = doorSegment(door);
            if (plan.mount === "wall") {
              // On the door's own wall the plaque must not overlap the opening or its jamb.
              const across = door.axis === "x" ? plan.position.x : plan.position.z;
              if (Math.abs(across - door.at) > 0.6) continue;
              const alongAxis = door.axis === "x" ? "z" : "x";
              const lo = Math.min(...corners(plan).map((c) => c[alongAxis]));
              const hi = Math.max(...corners(plan).map((c) => c[alongAxis]));
              const jamb: [number, number] = [door.center - door.width / 2 - DOOR_JAMB_M, door.center + door.width / 2 + DOOR_JAMB_M];
              expect(lo >= jamb[1] - 1e-6 || hi <= jamb[0] + 1e-6, `${door.to} door ${jamb} vs plaque ${lo.toFixed(2)}..${hi.toFixed(2)}`).toBe(true);
            } else {
              expect(distanceToSegment(plan.foot!, segment), `lectern near ${door.to} door`).toBeGreaterThan(1.0);
            }
          }
        });

        it(`${name} faces its reader`, () => {
          const n = normalOf(plan);
          if (plan.mount === "wall") {
            const toCentre = roomCentre(room).sub(plan.position).setY(0).normalize();
            expect(n.dot(toCentre)).toBeGreaterThan(0.3);
          } else if (plan.facing === "spawn") {
            const toSpawn = spawn.clone().sub(plan.position).setY(0).normalize();
            const horizontal = n.clone().setY(0).normalize();
            expect(horizontal.dot(toSpawn)).toBeGreaterThan(0.7);
            // Tilted 30 degrees from horizontal: the normal leans 30 degrees off vertical.
            expect(n.y).toBeCloseTo(Math.cos(Math.PI / 6), 3);
          } else {
            const hanging = room.hangings.find((h) => h.id === plan.hangingId);
            expect(hanging?.kind).toBe("tape");
            if (hanging?.kind !== "tape" || !hanging.pedestal) throw new Error("pedestal lectern without a pedestal");
            const yaw = (hanging.pedestal.rotationDeg[1] * Math.PI) / 180;
            const front = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            expect(n.clone().setY(0).normalize().dot(front)).toBeGreaterThan(0.99);
            // Beside the pedestal, not on it, and not in the tape's sheet.
            expect(plan.foot!.distanceTo(new Vector3(...hanging.pedestal.position))).toBeGreaterThan(0.6);
          }
        });

        it(`${name} stands at the right height above the room's floor`, () => {
          if (plan.kind === "entrance" && plan.mount === "wall") {
            expect(Math.max(...corners(plan).map((c) => c.y))).toBeCloseTo(floor + PANEL.top, 5);
          } else if (plan.mount === "wall") {
            expect(plan.position.y).toBeCloseTo(floor + LABEL.centre, 5);
          } else {
            expect(plan.foot!.y).toBeCloseTo(floor, 5);
            expect(Math.max(...corners(plan).map((c) => c.y))).toBeLessThanOrEqual(floor + 1.1 + 1e-6);
            expect(Math.max(...corners(plan).map((c) => c.y))).toBeGreaterThan(floor + 0.9);
          }
        });
      }

      it("labels sit just beyond their wall hanging's right edge", () => {
        for (const hanging of room.hangings) {
          if (hanging.kind !== "still" && hanging.kind !== "video") continue;
          const plan = plans.find((p) => p.hangingId === hanging.id)!;
          const right = new Vector3(1, 0, 0).applyQuaternion(plan.quaternion);
          const offset = plan.position.clone().sub(new Vector3(...hanging.position)).setY(0);
          // On the hanging's right, and at least clear of its edge.
          expect(offset.dot(right)).toBeGreaterThan(hanging.widthMeters / 2 + LABEL.width / 2 - 1e-6);
          // Same wall: the same normal as the hanging.
          const hangingNormal = new Vector3(0, 0, 1).applyQuaternion(plan.quaternion);
          expect(hangingNormal.dot(normalOf(plan))).toBeGreaterThan(0.99);
        }
      });

      it("no two plaques overlap", () => {
        for (let i = 0; i < plans.length; i++) {
          for (let j = i + 1; j < plans.length; j++) {
            const a = plans[i]!, b = plans[j]!;
            const d = a.position.clone().sub(b.position).setY(0).length();
            expect(d, `${a.kind}/${a.hangingId ?? ""} vs ${b.kind}/${b.hangingId ?? ""}`).toBeGreaterThan((a.width + b.width) / 2 - 0.05);
          }
        }
      });
    });
  }
});

describe("entranceWall", () => {
  const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;

  it("picks the open doorway nearest the hall by graph distance", () => {
    expect(entranceWall(room("einstruct"), mansion)?.door?.to).toBe("hall");
    expect(entranceWall(room("world-engine"), mansion)?.door?.to).toBe("hall");
    expect(entranceWall(room("orangery"), mansion)?.door?.to).toBe("world-engine");
    expect(entranceWall(room("belvedere"), mansion)?.door?.to).toBe("gallery");
    // coarsen's two doors both lead to rooms one step from the hall: the one nearer its spawn wins.
    expect(entranceWall(room("spectre"), mansion)?.door?.to).toBe("einstruct");
  });

  it("uses the wall behind the spawn for the hall", () => {
    const e = entranceWall(room("hall"), mansion)!;
    expect(e.wall.axis).toBe("z");
    expect(e.wall.at).toBe(room("hall").bounds.max[2]);
    expect(e.door?.to).toBe("phototroph");
  });

  it("takes a closed door when that is all a room has (the host's Workshop)", () => {
    expect(entranceWall(room("greenhouse"), mansion)?.door?.to).toBe("hall");
  });

  it("gives the grounds and the Orrery no wall", () => {
    for (const id of ["terrace", "parterre", "orchard-west", "orchard-south", "orchard-east", "orrery"]) {
      expect(entranceWall(room(id), mansion), id).toBeNull();
    }
  });

  it("hallDistances walks open doors only", () => {
    const d = hallDistances(mansion);
    expect(d.get("hall")).toBe(0);
    expect(d.get("einstruct")).toBe(1);
    expect(d.get("spectre")).toBe(2);
    expect(d.get("greenhouse")).toBeUndefined();
    expect(d.get("orrery")).toBeUndefined();
  });

  it("puts the entrance panel to the right of the door's jamb as seen from inside", () => {
    // einstruct's hall door is on its x = 10 wall, centred at z = -5, 3 m wide.
    // Facing that wall from inside (looking -X), the right hand points -Z.
    const plan = planRoomLabels(room("einstruct"), labels, mansion).find((p) => p.kind === "entrance")!;
    expect(plan.position.x).toBeCloseTo(10 + 0.36 + 0.015, 3);
    expect(plan.position.z).toBeLessThan(-5 - 1.5 - DOOR_JAMB_M - 0.6);
    expect(plan.position.z + plan.width / 2).toBeCloseTo(-5 - 1.5 - DOOR_JAMB_M - 0.6, 3);
  });
});

describe("forwardOf", () => {
  it("matches the rig: yaw 0 looks down -Z, -90 looks down +X", () => {
    const rounded = (v: Vector3) => v.toArray().map((c) => Math.round(c) + 0);
    expect(rounded(forwardOf(0))).toEqual([0, 0, -1]);
    expect(rounded(forwardOf(-90))).toEqual([1, 0, 0]);
    expect(rounded(forwardOf(180))).toEqual([0, 0, 1]);
  });
});

describe("creditFor", () => {
  const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;
  const hanging = (roomId: string, id: string) => room(roomId).hangings.find((h) => h.id === id)!;

  it("names the repository the visitor reads and the bundle id, untranslated", () => {
    expect(creditFor(room("einstruct"), hanging("einstruct", "einstruct-tape"))).toBe("einstruct · 2dd0038799b2db15");
    expect(creditFor(room("hall"), hanging("hall", "hall-poster"))).toBe("einstruct · c59c7baa6fd15489");
    // The tree is spectre inside the bytes; the visitor reads coarsen.
    expect(creditFor(room("spectre"), hanging("spectre", "spectre-wall"))).toBe("coarsen · 0462efca96af7297");
    expect(creditFor(room("spectre"), hanging("spectre", "spectre-worlds"))).toBe("coarsen · 26f78b7516170d6d");
    expect(creditFor(room("orrery"), hanging("orrery", "orrery-worlds"))).toBe("coarsen · 26f78b7516170d6d");
  });
});

describe("buildRoomLabels", () => {
  it("builds a group per plaque with a slab and a face, and disposes them", () => {
    const room = mansion.rooms.find((r) => r.id === "einstruct")!;
    const group = buildRoomLabels(room, labelsDe, "de", { mansion });
    expect(group).toBeInstanceOf(Group);
    expect(group.children).toHaveLength(1 + room.hangings.length);
    for (const plaque of group.children) {
      expect(plaque.userData.locale).toBe("de");
      const names = plaque.children.map((c) => c.name);
      expect(names).toContain("plaque-slab");
      expect(names).toContain("plaque-face");
      if (plaque.userData.mount === "lectern") expect(names).toContain("plaque-stem");
    }
    disposeRoomLabels(group);
    expect(group.children).toHaveLength(0);
  });

  it("reads the same text in both languages", () => {
    const room = mansion.rooms.find((r) => r.id === "spectre")!;
    const [en1] = planRoomLabels(room, labels, mansion);
    const [de1] = planRoomLabels(room, labelsDe, mansion);
    expect(en1!.text.title).toBe("coarsen");
    expect(de1!.text.title).toBe("coarsen");
    expect(de1!.text.heading).toBe("Einführung");
    expect(en1!.position.equals(de1!.position)).toBe(true);
  });
});
