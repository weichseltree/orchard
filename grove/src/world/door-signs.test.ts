import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import mansionDocument from "./mansion.json";
import cinzel from "./fonts/cinzel.json";
import en from "./labels/en.json";
import de from "./labels/de.json";
import ja from "./labels/ja.json";
import { parseLabels } from "./labels/index";
import { parseMansion } from "./schema";
import { SIGN, buildDoorSigns, canSet, extrudeText, glyphContours, letterGeometry, planDoorSigns, signed, type Typeface } from "./door-signs";

const mansion = parseMansion(mansionDocument);
const font = cinzel as unknown as Typeface;
const labels = parseLabels(en);
const labelsDe = parseLabels(de);
const labelsJa = parseLabels(ja);
const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;

describe("planDoorSigns over mansion.json", () => {
  for (const r of mansion.rooms) {
    it(`${r.id}: one sign per doorway with surrounds, on its lintel, facing into the room`, () => {
      const plans = planDoorSigns(r, labels, mansion);
      const expected = r.doorways.filter((d) => signed(r, d, mansion));
      expect(plans.map((p) => p.to).sort()).toEqual(expected.map((d) => d.to).sort());
      for (const plan of plans) {
        const door = r.doorways.find((d) => d.to === plan.to)!;
        const across = door.axis === "x" ? plan.position.x : plan.position.z;
        // Just off the lintel's face, on the room's side of the wall.
        expect(Math.abs(Math.abs(across - door.at) - (SIGN.lintelFace + SIGN.standoff))).toBeLessThan(1e-6);
        const normal = new Vector3(0, 0, 1).applyQuaternion(plan.quaternion);
        const inward = door.axis === "x" ? Math.sign(across - door.at) : Math.sign(across - door.at);
        expect(door.axis === "x" ? normal.x : normal.z).toBeCloseTo(inward, 6);
        // Above the door's head, within the room.
        expect(plan.position.y).toBeGreaterThan(r.bounds.min[1] + door.height);
        // The whole cap height stays under the ceiling, not just its middle.
        expect(plan.position.y + plan.size / 2).toBeLessThanOrEqual(r.bounds.max[1]);
      }
    });
  }

  it("names the room a door points at, not the one it opens on", () => {
    // The stairs are signed for the club; nobody walks down for the stair's own sake.
    const court = room("court-north");
    const door = court.doorways.find((d) => d.to === "stair-north")!;
    expect(door.signRoom).toBe("club");
    const plan = planDoorSigns(court, labels, mansion).find((p) => p.to === "stair-north")!;
    expect(plan.text).toBe(labels.rooms.club!.title);
    expect(plan.fallback).toBe("club");
    // Without the field the sign would name the room behind the door.
    const plain = planDoorSigns({ ...court, doorways: [{ ...door, signRoom: "" }] }, labels, mansion)[0]!;
    expect(plain.text).toBe(labels.rooms["stair-north"]!.title);
  });

  it("names the room beyond as the visitor reads it, and a sealed room by its repository", () => {
    const hall = planDoorSigns(room("hall"), labelsDe, mansion);
    expect(hall.find((p) => p.to === "terrace")?.text).toBe(labelsDe.rooms["terrace"]!.title);
    expect(hall.find((p) => p.to === "greenhouse")?.text).toBe(labelsDe.rooms["greenhouse"]!.title);
    const gallery = planDoorSigns(room("gallery"), labels, mansion);
    expect(gallery.find((p) => p.to === "arcedit")?.text).toBe("arcedit");
    expect(gallery.find((p) => p.to === "HNL")?.fallback).toBe("HNL");
  });

  it("falls back to the identifier when the typeface cannot set the title", () => {
    const signs = planDoorSigns(room("hall"), labelsJa, mansion);
    const terrace = signs.find((p) => p.to === "terrace")!;
    expect(canSet(font, terrace.text)).toBe(false);
    expect(canSet(font, terrace.fallback)).toBe(true);
    const geometry = letterGeometry(terrace, font);
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    geometry.dispose();
  });
});

describe("extrudeText", () => {
  it("reads a glyph's outline as closed contours with its holes", () => {
    // O: an outer contour and one hole, opposite senses.
    const contours = glyphContours(font.glyphs["O"]!, SIGN.size / font.resolution);
    expect(contours).toHaveLength(2);
    const area = (c: number[]) => { let a = 0; for (let i = 0; i < c.length; i += 2) { const j = (i + 2) % c.length; a += c[i]! * c[j + 1]! - c[j]! * c[i + 1]!; } return a / 2; };
    expect(Math.sign(area(contours[0]!))).not.toBe(Math.sign(area(contours[1]!)));
  });

  it("extrudes front caps toward +z and sides round every contour, and no back cap", () => {
    const { position, normal } = extrudeText("O", font, SIGN.size, SIGN.depth);
    expect(position.length % 9).toBe(0);
    let front = 0, side = 0, back = 0;
    for (let i = 0; i < normal.length; i += 3) {
      if (normal[i + 2]! > 0.5) front++; else if (normal[i + 2]! < -0.5) back++; else side++;
    }
    expect(front).toBeGreaterThan(0);
    expect(side).toBeGreaterThan(0);
    expect(back).toBe(0);
    for (let i = 0; i < position.length; i += 3) expect(position[i + 2]! === 0 || position[i + 2]! === SIGN.depth).toBe(true);
  });

  it("winds every triangle with its normal, so a front-sided material shows the returns", () => {
    const { position, normal } = extrudeText("OB", font, SIGN.size, SIGN.depth);
    for (let t = 0; t < position.length; t += 9) {
      const ax = position[t]!, ay = position[t + 1]!, az = position[t + 2]!;
      const ux = position[t + 3]! - ax, uy = position[t + 4]! - ay, uz = position[t + 5]! - az;
      const vx = position[t + 6]! - ax, vy = position[t + 7]! - ay, vz = position[t + 8]! - az;
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      const dot = gx * normal[t]! + gy * normal[t + 1]! + gz * normal[t + 2]!;
      expect(dot, `triangle at ${t / 9}`).toBeGreaterThan(0);
    }
  });

  it("advances the pen by each glyph's width, spaces included", () => {
    const one = extrudeText("I", font, SIGN.size, SIGN.depth);
    const two = extrudeText("I I", font, SIGN.size, SIGN.depth);
    const maxX = (p: number[]) => Math.max(...p.filter((_, i) => i % 3 === 0));
    expect(maxX(two.position)).toBeGreaterThan(maxX(one.position) + SIGN.size * 0.5);
  });
});

describe("letterGeometry", () => {
  it("sets every room title of every language the walls carry", () => {
    for (const bundle of [labels, labelsDe]) {
      for (const copy of Object.values(bundle.rooms)) expect(canSet(font, copy.title), copy.title).toBe(true);
    }
  });

  // Sets real glyph outlines for every room title: slow enough that a loaded
  // runner can push it past vitest's 5 s default, as the light-field bake did.
  it("centres the letters and keeps them narrower than the lintel", { timeout: 20_000 }, () => {
    for (const r of mansion.rooms) {
      for (const sign of planDoorSigns(r, labelsDe, mansion)) {
        const geometry = letterGeometry(sign, font);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(1e-6);
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(sign.maxWidth - 0.3 + 1e-6);
        expect(box.max.z - box.min.z).toBeCloseTo(SIGN.depth, 6);
        geometry.dispose();
      }
    }
  });
});

describe("buildDoorSigns", () => {
  it("merges a room's signs into one mesh and keeps the whole palace under a triangle budget", { timeout: 20_000 }, () => {
    let triangles = 0, meshes = 0;
    for (const r of mansion.rooms) {
      const signs = planDoorSigns(r, labels, mansion);
      const group = buildDoorSigns(r, signs, font);
      if (signs.length === 0) {
        expect(group.children).toHaveLength(0);
        continue;
      }
      expect(group.children).toHaveLength(1);
      meshes++;
      const mesh = group.children[0] as import("three").Mesh;
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      (group.userData as { dispose(): void }).dispose();
    }
    console.info(`door signs: ${meshes} meshes, ${Math.round(triangles)} triangles`);
    // The palace's fifteen rooms set some 45,000; arcedit's area adds forty signed doorways (TREE-AREAS.md).
    expect(triangles).toBeLessThan(200_000);
  });
});
