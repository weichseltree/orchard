import { InstancedMesh, Light, Mesh, MeshBasicMaterial, Raycaster, Vector3, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { buildObservatory } from "./observatory";
import { buildRoom } from "./rooms";

const mansion = parseMansion(mansionDocument);
const shells = mansion.rooms.filter(room => room.architecture === "observatory").map(room => ({ room, shell: buildObservatory(room) }));
for (const { shell } of shells) shell.group.updateMatrixWorld(true);

describe("the designed observatory", () => {
  it("builds every footprint with explicit architectural provenance, no textures or lights", () => {
    expect(shells).toHaveLength(13);
    for (const { room, shell } of shells) {
      expect(shell.group.name).toBe(`${room.id}-shell`);
      expect(shell.group.userData.architecture).toBe("observatory");
      expect(shell.provenance.source).toBe("Designed procedural architecture");
      expect(shell.provenance.scientific_content).toBe(false);
      expect(shell.lightmap).toBeNull();
      expect(shell.markers.spawn).toBeUndefined();
      expect(shell.markers.doors.size + shell.markers.posters.size).toBe(0);
      shell.group.traverse(node => {
        expect(node).not.toBeInstanceOf(Light);
        if (!(node instanceof Mesh)) return;
        expect(node.material).toBeInstanceOf(MeshBasicMaterial);
        const material = node.material as MeshBasicMaterial;
        expect(material.map).toBeNull();
        // Light fittings stay luminous; stone keeps its modeled face shading.
        expect(material.vertexColors || !material.toneMapped).toBe(true);
        expect(node.castShadow || node.receiveShadow).toBe(false);
      });
    }
  });

  it("keeps all thirteen rooms below 150 architecture draws and 75000 triangles", () => {
    let draws = 0, triangles = 0;
    const geometries = new Set(), materials = new Set();
    for (const { shell } of shells) shell.group.traverse(node => {
      if (!(node instanceof Mesh)) return;
      draws++;
      geometries.add(node.geometry); materials.add(node.material);
      const count = node instanceof InstancedMesh ? node.count : 1;
      triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) * count / 3;
      expect(node.geometry.groups).toHaveLength(0);
      node.geometry.computeBoundingBox();
      const bounds = node.geometry.boundingBox!;
      expect([...bounds.min, ...bounds.max].every(Number.isFinite)).toBe(true);
    });
    expect(draws).toBeLessThan(150);
    expect(triangles).toBeLessThan(75_000);
    // Six shared primitives plus eight vaults; chamber colours reuse programs.
    expect(geometries.size).toBeLessThanOrEqual(14);
    expect(materials.size).toBeLessThanOrEqual(32);
  });

  it("leaves every open doorway clear at walking height across its aperture", () => {
    for (const { room, shell } of shells) for (const door of room.doorways.filter(d => !d.closed)) {
      const axis = door.axis === "x" ? 0 : 2;
      const along = door.axis === "x" ? 2 : 0;
      const inward = Math.abs(door.at - room.bounds.min[axis]) < 0.001 ? 1 : -1;
      for (const fraction of [-0.35, 0, 0.35]) for (const height of [1.2, Math.min(2.8, door.height - 0.2)]) {
        const origin = new Vector3(); origin.setComponent(axis, door.at + inward * 0.7);
        origin.setComponent(along, door.center + door.width * fraction); origin.y = room.bounds.min[1] + height;
        const direction = new Vector3().setComponent(axis, -inward);
        const hit = new Raycaster(origin, direction, 0.001, 1.4).intersectObject(shell.group, true);
        expect(hit.map(h => h.object.name), `${room.id} → ${door.to} at ${fraction}, y=${height}`).toEqual([]);
      }
    }
  });

  it("keeps closed doorways solid and every arrival spot clear above its floor", () => {
    for (const { room, shell } of shells) {
      const [x, y, z] = room.spawn.position;
      const above = new Raycaster(new Vector3(x, y + 0.2, z), new Vector3(0, 1, 0), 0.001, 2);
      expect(above.intersectObject(shell.group, true), `${room.id} arrival`).toEqual([]);
      for (const door of room.doorways.filter(d => d.closed)) {
        const axis = door.axis === "x" ? 0 : 2, along = door.axis === "x" ? 2 : 0;
        const inward = Math.abs(door.at - room.bounds.min[axis]) < 0.001 ? 1 : -1;
        const origin = new Vector3().setComponent(axis, door.at + inward * 0.7).setComponent(along, door.center);
        origin.y = y + 1.6;
        expect(new Raycaster(origin, new Vector3().setComponent(axis, -inward), 0.001, 1.4)
          .intersectObject(shell.group, true).length, `${room.id} closed ${door.to}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives the roof a real open crown and leaves the terrace under the sky", () => {
    for (const { room, shell } of shells) {
      const x = (room.bounds.min[0] + room.bounds.max[0]) / 2;
      const z = room.bounds.min[2] + 1.1;
      expect(new Raycaster(new Vector3(x, 0.2, z), new Vector3(0, 1, 0), 0.001, 10)
        .intersectObject(shell.group, true), `${room.id} sky opening`).toEqual([]);
    }
  });

  it("honours the architecture switch before considering a legacy asset URL", async () => {
    const room = { ...mansion.rooms[0]!, architecture: "observatory" as const, glb: "must-not-load.glb" };
    const fetch = vi.spyOn(globalThis, "fetch");
    const notice = vi.fn();
    const shell = await buildRoom({ room, renderer: {} as WebGLRenderer, onNotice: notice });
    expect(shell.group.userData.architecture).toBe("observatory");
    expect(fetch).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
