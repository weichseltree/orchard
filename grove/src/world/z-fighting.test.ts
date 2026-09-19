import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { buildObservatory } from "./observatory";
import { auditWorldZFighting, detectZFighting, groupZFightingWarnings } from "./z-fighting";

describe("z-fighting detection and warning grouping", () => {
  const mansion = parseMansion(mansionDocument);

  it("detects coplanar overlapping box faces as warnings", () => {
    const group = new Group();
    const geom = new BoxGeometry(1, 1, 1);
    const matA = new MeshBasicMaterial({ color: 0xff0000 });
    const matB = new MeshBasicMaterial({ color: 0x00ff00 });

    const meshA = new Mesh(geom, matA);
    meshA.name = "observatory-box-floor";
    meshA.position.set(0, 0, 0);
    meshA.scale.set(4, 0.2, 4);
    meshA.updateMatrixWorld(true);

    // Completely coplanar overlapping top face at y = 0.1
    const meshB = new Mesh(geom, matB);
    meshB.name = "observatory-box-path";
    meshB.position.set(1, 0, 1);
    meshB.scale.set(2, 0.2, 2);
    meshB.updateMatrixWorld(true);

    group.add(meshA, meshB);

    const warnings = detectZFighting(group, "test-room");
    expect(warnings.length).toBeGreaterThan(0);
    const topWarning = warnings.find((w) => w.plane === "horizontal" && Math.abs(w.coordinate - 0.1) < 0.01);
    expect(topWarning).toBeDefined();
    expect(topWarning?.materials).toEqual(["floor", "path"]);
    expect(topWarning?.suggestedFix).toContain("vertical offset");
  });

  it("ignores properly offset faces with standard standoff distance", () => {
    const group = new Group();
    const geom = new BoxGeometry(1, 1, 1);

    const floor = new Mesh(geom, new MeshBasicMaterial());
    floor.name = "observatory-box-floor";
    floor.position.set(0, 0, 0);
    floor.scale.set(4, 0.2, 4); // Top face at y = 0.1

    // Placed with +0.006m standoff: top face at y = 0.106 + 0.006 = 0.112
    const path = new Mesh(geom, new MeshBasicMaterial());
    path.name = "observatory-box-path";
    path.position.set(0, 0.106, 0);
    path.scale.set(2, 0.012, 2); // Bottom at 0.100, top at 0.112

    floor.updateMatrixWorld(true);
    path.updateMatrixWorld(true);
    group.add(floor, path);

    const warnings = detectZFighting(group, "test-room");
    // No warning on the top face because path top is at y = 0.112 (> 3mm above floor top at 0.1)
    const topWarnings = warnings.filter((w) => w.plane === "horizontal" && w.coordinate > 0.105);
    expect(topWarnings).toHaveLength(0);
  });

  it("groups warnings by room, plane, and material pair for batch fixing", () => {
    const group = new Group();
    const geom = new BoxGeometry(1, 1, 1);

    // 3 duplicate wall panels on the same plane x = 5.0
    for (let i = 0; i < 3; i++) {
      const wall = new Mesh(geom, new MeshBasicMaterial());
      wall.name = "observatory-box-wall";
      wall.position.set(5.0, i * 0.5, 0);
      wall.scale.set(0.2, 1.0, 4.0);
      wall.updateMatrixWorld(true);
      group.add(wall);
    }

    const warnings = detectZFighting(group, "gallery");
    const grouped = groupZFightingWarnings(warnings);

    expect(grouped.length).toBeGreaterThan(0);
    const galleryGroup = grouped.find((g) => g.room === "gallery" && g.plane === "vertical-x");
    expect(galleryGroup).toBeDefined();
    expect(galleryGroup?.count).toBeGreaterThan(1);
    expect(galleryGroup?.recommendation).toBeDefined();
  });

  it("audits the designed observatory rooms and reports grouped findings", () => {
    const report = auditWorldZFighting(mansion, (room, m) => buildObservatory(room, m));
    expect(report).toBeDefined();
    expect(Array.isArray(report.groups)).toBe(true);
    expect(report.totalWarnings).toBeGreaterThanOrEqual(0);
    expect(report.groups.length).toBeGreaterThan(0);
  }, 15000);
});
