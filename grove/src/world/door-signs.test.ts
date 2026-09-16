import { describe, expect, it } from "vitest";
import { Font, type FontData } from "three/examples/jsm/loaders/FontLoader.js";
import { Vector3 } from "three";
import mansionDocument from "./mansion.json";
import cinzel from "./fonts/cinzel.json";
import en from "./labels/en.json";
import de from "./labels/de.json";
import ja from "./labels/ja.json";
import { parseLabels } from "./labels/index";
import { parseMansion } from "./schema";
import { SIGN, buildDoorSigns, canSet, letterGeometry, planDoorSigns, signed } from "./door-signs";

const mansion = parseMansion(mansionDocument);
const font = new Font(cinzel as unknown as FontData);
const labels = parseLabels(en);
const labelsDe = parseLabels(de);
const labelsJa = parseLabels(ja);
const room = (id: string) => mansion.rooms.find((r) => r.id === id)!;

describe("planDoorSigns over mansion.json", () => {
  for (const r of mansion.rooms) {
    it(`${r.id}: one sign per doorway with surrounds, on its lintel, facing into the room`, () => {
      const plans = planDoorSigns(r, labels, mansion);
      const expected = r.doorways.filter((d) => signed(r, d));
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
        expect(plan.position.y).toBeLessThan(r.bounds.max[1]);
      }
    });
  }

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

describe("letterGeometry", () => {
  it("sets every room title of every language the walls carry", () => {
    for (const bundle of [labels, labelsDe]) {
      for (const copy of Object.values(bundle.rooms)) expect(canSet(font, copy.title), copy.title).toBe(true);
    }
  });

  it("centres the letters and keeps them narrower than the lintel", () => {
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
  it("merges a room's signs into one mesh and keeps the whole palace under a triangle budget", () => {
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
    expect(triangles).toBeLessThan(60_000);
  });
});
