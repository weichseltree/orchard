import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { resolveMove } from "./navigation";
import { STAIR_MARGIN, floorAt } from "./terrain";
import { parseMansion } from "./schema";
import { buildObservatory } from "./observatory";

// The sunken court is the grand semi-octagonal (Halb-Achteck) staircase where
// the terrace's two arms, the garden, and the club meet. It replaces straight
// flights with concentric faceted stone tiers forming a half-octagon, descending
// from the terrace (y=0) and garden (y=-1.6) to the paved court floor (y=-5.0)
// in front of the club's entrance, stretching into the garden and free of
// chamber walls and obstructive doors. This suite walks all routes.

const mansion = parseMansion(mansionDocument);
const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;
const STEP = 0.12;

/**
 * A body walking a route, a step at a time, through whatever rooms the route
 * crosses: the same `resolveMove` main.ts uses, so a clamp that stops a
 * visitor stops this walk in the same place.
 */
function walk(startRoom: string, from: { x: number; z: number }, route: readonly { x: number; z: number }[]) {
  let at = { x: from.x, z: from.z }, id = startRoom;
  const visited = [startRoom];
  for (const target of route) {
    // Generous: 40 steps per metre of the leg, so a walk that is merely slow
    // still arrives and only a walk that is BLOCKED fails.
    const budget = Math.ceil(Math.hypot(target.x - at.x, target.z - at.z) / STEP) + 40;
    for (let i = 0; i < budget; i++) {
      const gap = Math.hypot(target.x - at.x, target.z - at.z);
      if (gap < 0.05) break;
      const stride = Math.min(STEP, gap);
      const to = { x: at.x + (target.x - at.x) / gap * stride, z: at.z + (target.z - at.z) / gap * stride };
      const out = resolveMove(mansion, id, at, to);
      at = { x: out.x, z: out.z };
      if (out.room !== id) { id = out.room; visited.push(id); }
    }
  }
  return { ...at, room: id, visited, floor: floorAt(mansion, room(id), at.x, at.z) };
}

describe("the sunken court", () => {
  const court = room("stair-court");
  const FLOOR = court.bounds.min[1];

  it("lets a visitor walk down the semi-octagonal staircase from the south terrace to the court paving", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [{ x: -16, z: -6 }, { x: -16, z: -21 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    // On the paving at the bottom of the semi-octagonal steps
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor walk down the semi-octagonal staircase from the orangery's north terrace", () => {
    const arrived = walk("terrace-north", { x: -16, z: -42 }, [{ x: -16, z: -40 }, { x: -16, z: -28 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor walk down the semi-octagonal tiers from the garden parterre", () => {
    const arrived = walk("parterre", { x: -28, z: -24.5 }, [{ x: -25, z: -24.5 }, { x: -12, z: -24.5 }]);
    expect(arrived.room).toBe("stair-court");
    expect(arrived.floor).toBeCloseTo(FLOOR, 2);
  });

  it("lets a visitor cross the court from the terrace to the club's door", () => {
    // Down from terrace, into the court, in through the club door
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.5, z: -24.5 }, { x: -9, z: -24.5 },
    ]);
    expect(arrived.room).toBe("club");
    expect(arrived.visited).toEqual(["terrace", "stair-court", "club"]);
  });

  it("lets a visitor cross the court to the undercroft door at its north end", () => {
    const arrived = walk("terrace", { x: -16, z: -5 }, [
      { x: -16, z: -21 }, { x: -11.8, z: -24.5 }, { x: -11.8, z: -39 },
    ]);
    expect(arrived.room).toBe("foyer");
  });

  it("lets a visitor climb back out of the court onto both arms of the terrace", () => {
    const up = walk("stair-court", { x: -11.5, z: -24.5 }, [{ x: -16, z: -20.8 }, { x: -16, z: -9 }]);
    expect(up.room).toBe("terrace");
    const north = walk("stair-court", { x: -11.5, z: -24.5 }, [{ x: -16, z: -28 }, { x: -16, z: -40 }]);
    expect(north.room).toBe("terrace-north");
  });

  it("lets a visitor walk between terrace-north and terrace across the amphitheatre tiers", () => {
    const across = walk("terrace-north", { x: -16, z: -40 }, [{ x: -16, z: -24.5 }, { x: -16, z: -8 }]);
    expect(across.room).toBe("terrace");
  });

  it("walks the north arm past the orangery's flights without being pulled sideways", () => {
    const along = walk("terrace-north", { x: -15, z: -40 }, [{ x: -15, z: -74 }]);
    expect(along.room).toBe("terrace-north");
    expect(along.x).toBeCloseTo(-15, 1);
    expect(along.z).toBeLessThan(-73);
    const door = room("terrace-north").doorways
      .filter((d) => d.to === "orangery").sort((a, b) => b.center - a.center)[0]!;
    const close = walk("terrace-north", { x: -12.5, z: door.center + 3 }, [{ x: -12.5, z: -74 }]);
    const cheek = door.center + door.width / 2 + STAIR_MARGIN;
    expect(close.x).toBeCloseTo(-12.5, 1);
    expect(close.z).toBeGreaterThan(cheek);
    expect(close.z).toBeLessThan(cheek + 0.6);
  });

  it("matches movement floor height with rendered staircase geometry within one riser across the court", () => {
    const shell = buildObservatory(court, mansion);
    interface OrientedBox {
      pos: Vector3;
      quat: Quaternion;
      invQuat: Quaternion;
      scale: Vector3;
      topY: number;
    }
    const oBoxes: OrientedBox[] = [];
    const mat = new Matrix4();

    shell.group.traverse((node) => {
      if (node instanceof InstancedMesh) {
        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, mat);
          const p = new Vector3(), q = new Quaternion(), s = new Vector3();
          mat.decompose(p, q, s);
          oBoxes.push({
            pos: p,
            quat: q,
            invQuat: q.clone().invert(),
            scale: s,
            topY: p.y + s.y / 2,
          });
        }
      }
    });

    const highestRenderedY = (x: number, z: number): number => {
      let maxTop = FLOOR;
      const pt = new Vector3();
      for (const b of oBoxes) {
        pt.set(x - b.pos.x, 0, z - b.pos.z).applyQuaternion(b.invQuat);
        if (Math.abs(pt.x) <= b.scale.x / 2 + 0.02 && Math.abs(pt.z) <= b.scale.z / 2 + 0.02) {
          if (b.topY > maxTop) maxTop = b.topY;
        }
      }
      return maxTop;
    };

    // Sample along axis walk (x: -12 -> -19.5, z = -24.5):
    for (let x = -12; x >= -19.5; x -= 0.5) {
      const h_move = floorAt(mansion, court, x, -24.5);
      const h_rend = highestRenderedY(x, -24.5);
      expect(Math.abs(h_move - h_rend)).toBeLessThanOrEqual(0.18);
    }

    // Sample along North terrace arm (z: -25 -> -37, x = -16):
    for (let z = -25; z >= -37; z -= 1.0) {
      const h_move = floorAt(mansion, court, -16, z);
      const h_rend = highestRenderedY(-16, z);
      expect(Math.abs(h_move - h_rend)).toBeLessThanOrEqual(0.18);
    }

    // Sample along South terrace arm (z: -25 -> -12, x = -16):
    for (let z = -25; z <= -12; z += 1.0) {
      const h_move = floorAt(mansion, court, -16, z);
      const h_rend = highestRenderedY(-16, z);
      expect(Math.abs(h_move - h_rend)).toBeLessThanOrEqual(0.18);
    }
  }, 15000);

  it("provides a wide, completely flat foyer promenade connecting north foyer, club, and south undercroft", () => {
    // Check points across the promenade x in [-15.5, -10.0] and z in [-38, -11]
    for (let x = -10.5; x >= -15.5; x -= 1.0) {
      for (let z = -37.0; z <= -12.0; z += 2.5) {
        expect(floorAt(mansion, court, x, z)).toBeCloseTo(FLOOR, 2);
      }
    }
  });

  it("smoothly and monotonically climbs from court floor to garden parterre", () => {
    let lastHeight = -5.1;
    for (let x = -11.5; x >= -26.0; x -= 0.25) {
      const r = x >= -20.0 ? court : room("parterre");
      const h = floorAt(mansion, r, x, -24.5);
      expect(h).toBeGreaterThanOrEqual(lastHeight - 0.001);
      lastHeight = h;
    }
    expect(lastHeight).toBeCloseTo(-1.6, 2);
  });

  it("seamlessly matches terrace and parterre floor elevations at doorways", () => {
    // Parterre doorway boundary at x = -20, z = -24.5
    expect(floorAt(mansion, court, -20.0, -24.5)).toBeCloseTo(floorAt(mansion, room("parterre"), -20.0, -24.5), 2);

    // Parterre top of stairs at x = -26.0, z = -24.5 reaches garden lawn level
    expect(floorAt(mansion, room("parterre"), -26.0, -24.5)).toBeCloseTo(-1.6, 2);

    // Court promenade in front of club at x = -11.5, z = -24.5
    expect(floorAt(mansion, court, -11.5, -24.5)).toBeCloseTo(-5.0, 2);
    expect(floorAt(mansion, room("club"), -10.0, -24.5)).toBeCloseTo(-5.0, 2);

    // Undercroft connections at North (z = -38) and South (z = -11)
    expect(floorAt(mansion, room("foyer"), -12.75, -38.0)).toBeCloseTo(-5.0, 2);
    expect(floorAt(mansion, room("foyer-south"), -12.75, -11.0)).toBeCloseTo(-5.0, 2);
  });

  it("audits the semi-octagonal staircase for zero under-step holes and continuous vertical solidity", () => {
    const shell = buildObservatory(court, mansion);
    interface OrientedBox {
      pos: Vector3;
      quat: Quaternion;
      invQuat: Quaternion;
      scale: Vector3;
      minY: number;
      maxY: number;
    }
    const oBoxes: OrientedBox[] = [];
    const mat = new Matrix4();

    shell.group.traverse((node) => {
      if (node instanceof InstancedMesh && node.name.includes("stone")) {
        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, mat);
          const p = new Vector3(), q = new Quaternion(), s = new Vector3();
          mat.decompose(p, q, s);
          oBoxes.push({
            pos: p,
            quat: q,
            invQuat: q.clone().invert(),
            scale: s,
            minY: p.y - s.y / 2,
            maxY: p.y + s.y / 2,
          });
        }
      }
    });

    // 1. Check that all step tiers are solid masonry extending down to foundation FLOOR (-5.0):
    const stepBoxes = oBoxes.filter((b) => b.maxY > FLOOR + 0.05 && b.pos.x <= -15.5 + 0.5);
    expect(stepBoxes.length).toBeGreaterThan(0);
    for (const b of stepBoxes) {
      expect(b.minY).toBeLessThanOrEqual(FLOOR + 0.02);
    }

    // 2. Sample 2D rays across the entire staircase and confirm unbroken solid vertical volume:
    const pt = new Vector3();
    const testPoints = [
      { x: -16.0, z: -24.5 },
      { x: -18.0, z: -24.5 },
      { x: -19.5, z: -24.5 },
      { x: -16.0, z: -30.0 },
      { x: -16.0, z: -35.0 },
      { x: -16.0, z: -19.0 },
      { x: -16.0, z: -14.0 },
      { x: -18.5, z: -29.0 },
      { x: -18.5, z: -20.0 },
    ];

    for (const tp of testPoints) {
      const h_expected = floorAt(mansion, court, tp.x, tp.z);
      if (h_expected <= FLOOR + 0.05) continue;

      // Find all overlapping boxes at this column:
      const covering = oBoxes.filter((b) => {
        pt.set(tp.x - b.pos.x, 0, tp.z - b.pos.z).applyQuaternion(b.invQuat);
        return Math.abs(pt.x) <= b.scale.x / 2 + 0.02 && Math.abs(pt.z) <= b.scale.z / 2 + 0.02;
      });

      expect(covering.length).toBeGreaterThan(0);
      const maxTop = Math.max(...covering.map((b) => b.maxY));
      const minBottom = Math.min(...covering.map((b) => b.minY));

      // Surface height must match within riser:
      expect(maxTop).toBeGreaterThanOrEqual(h_expected - 0.20);
      // Bottom must reach all the way to floor base with zero vertical void:
      expect(minBottom).toBeLessThanOrEqual(FLOOR + 0.02);
    }
  });
});
