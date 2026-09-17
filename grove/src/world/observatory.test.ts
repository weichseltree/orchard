import { InstancedMesh, Light, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";
import mansionDocument from "./mansion.json";
import { parseMansion } from "./schema";
import { buildObservatory, coverFloor, covered, runsAlongX } from "./observatory";
import { buildRoom } from "./rooms";

const mansion = parseMansion(mansionDocument);
const shells = mansion.rooms.filter(room => room.architecture === "observatory").map(room => ({ room, shell: buildObservatory(room, mansion) }));
for (const { shell } of shells) shell.group.updateMatrixWorld(true);

describe("the designed observatory", () => {
  it("builds every footprint with explicit architectural provenance, no textures or lights", () => {
    // The palace's thirteen chambers and cells (coarsen's chamber went on 2026-09-16), the cellar venue's five, arcedit's area of six (redesigned 2026-09-17), and quantumflow's east wing of six.
    expect(shells).toHaveLength(30);
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

  it("keeps every room near fifteen architecture draws and the world under 200000 triangles", () => {
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
    // Fifteen batches a room, and the grounds are height-field meshes now.
    expect(draws).toBeLessThan(shells.length * 16);
    // About fourteen thousand triangles a room: the palace's fifteen came to
    // 200,000. quantumflow's rooms are large and cost 13,100 to 16,000 each, so
    // the world now sits at about 416,000 of 420,000 -- under 1% of slack. The
    // next change that adds geometry to any room will have to buy some back
    // (observatory.ts steps wall panels every 1.4 m, and the wing's chambers
    // have 136 to 144 m of perimeter apiece), not merely nudge this number.
    expect(triangles).toBeLessThan(shells.length * 14_000);
    // Six primitives, one vault per chamber, one height field per cell.
    expect(geometries.size).toBeLessThanOrEqual(6 + shells.length);
    // Fifteen finishes, a few of them per-room variants; an area's rooms share
    // their tree's. quantumflow's indigo wing brought seven more on 2026-09-17,
    // which is exactly the bound: 62.
    expect(materials.size).toBeLessThanOrEqual(62);
  });

  it("leaves every open doorway clear at walking height across its aperture", () => {
    for (const { room, shell } of shells) for (const door of room.doorways.filter(d => !d.closed)) {
      const axis = door.axis === "x" ? 0 : 2;
      const along = door.axis === "x" ? 2 : 0;
      const inward = Math.abs(door.at - room.bounds.min[axis]) < 0.001 ? 1 : -1;
      // A doorway opens at the higher of the two floors it joins; below that, in the lower room, stands its flight.
      const neighbour = mansion.rooms.find(r => r.id === door.to)!;
      const base = Math.max(room.bounds.min[1], neighbour.bounds.min[1]);
      for (const fraction of [-0.35, 0, 0.35]) for (const height of [1.2, Math.min(2.8, door.height - 0.2)]) {
        const origin = new Vector3(); origin.setComponent(axis, door.at + inward * 0.7);
        origin.setComponent(along, door.center + door.width * fraction); origin.y = base + height;
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

  it("gives the roof a real open crown and leaves the terrace under the sky, except under another room, where it is lidded", () => {
    expect(mansion.rooms.filter(r => covered(r, mansion)).map(r => r.id)).toEqual(["foyer", "club", "stage"]);
    for (const { room, shell } of shells) {
      // The crown runs the room's long way: along z, or along x in a turned room of an area.
      const turned = runsAlongX(room, mansion);
      const x = turned ? room.bounds.min[0] + 1.1 : (room.bounds.min[0] + room.bounds.max[0]) / 2;
      const z = turned ? (room.bounds.min[2] + room.bounds.max[2]) / 2 : room.bounds.min[2] + 1.1;
      // From above any flight's parapet, so a stair at the north wall does not count as roof.
      const above = new Raycaster(new Vector3(x, room.bounds.min[1] + 3.2, z), new Vector3(0, 1, 0), 0.001, 10)
        .intersectObject(shell.group, true).map(h => h.object.name);
      // A ray through a box meets both its faces: two hits, both the lid, nothing else.
      if (covered(room, mansion)) expect(new Set(above), `${room.id} lid`).toEqual(new Set(["observatory-box-wall"]));
      else expect(above, `${room.id} sky opening`).toEqual([]);
    }
  });

  it("keeps the venue's fittings inside their rooms", () => {
    // The foyer's lanterns once stood in a wall and inside a stair's cheek; every placed element's centre stays in its room's box.
    const margin = 0.12;
    for (const { room, shell } of shells.filter(s => ["stair-north", "stair-south", "foyer", "club", "stage"].includes(s.room.id))) {
      const [x0, y0, z0] = room.bounds.min, [x1, , z1] = room.bounds.max;
      // A covered room's lid fills the void up to just inside the slab of the floor above -- never to the
      // floor itself, where the visitor walks -- and its cladding stands a hand outside its walls.
      const cover = coverFloor(room, mansion);
      const y1 = cover === null ? room.bounds.max[1] : cover - 0.12;
      const outside: string[] = [];
      const m = new Matrix4(), p = new Vector3(), s = new Vector3();
      for (const child of shell.group.children) {
        if (!(child instanceof InstancedMesh)) continue;
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, m);
          p.setFromMatrixPosition(m);
          s.setFromMatrixScale(m);
          // An upright box's top; a bar is a column turned on its side, whose scale says nothing about height.
          const e = m.elements, upright = Math.abs(e[1]!) < 1e-6 && Math.abs(e[4]!) < 1e-6 && Math.abs(e[6]!) < 1e-6 && Math.abs(e[9]!) < 1e-6;
          if (child.name.startsWith("observatory-box") && upright && p.y + s.y / 2 > y1 + 0.01) outside.push(`${child.name}[${i}] tops at ${(p.y + s.y / 2).toFixed(2)} over ${y1.toFixed(2)}`);
          if (child.name.includes("@")) {
            // Cladding and its string course: on a wall's outside, within a hand of it, never in the room.
            const onX = Math.abs(p.x - x0) < 0.16 || Math.abs(p.x - x1) < 0.16, onZ = Math.abs(p.z - z0) < 0.16 || Math.abs(p.z - z1) < 0.16;
            if (!onX && !onZ) outside.push(`${child.name}[${i}] off the walls at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
            continue;
          }
          if (p.x < x0 - margin || p.x > x1 + margin || p.y < y0 - margin || p.y > y1 + margin || p.z < z0 - margin || p.z > z1 + margin) {
            outside.push(`${child.name}[${i}] at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`);
          }
        }
      }
      expect(outside, room.id).toEqual([]);
    }
    // And the foyer's lanterns flank each of the club's two doors, clear of their jambs.
    const foyer = shells.find(s => s.room.id === "foyer")!;
    const lamps: number[] = [];
    const m = new Matrix4(), p = new Vector3(), s = new Vector3();
    for (const child of foyer.shell.group.children) {
      if (!(child instanceof InstancedMesh) || child.name !== "observatory-box-light") continue;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, m); p.setFromMatrixPosition(m); s.setFromMatrixScale(m);
        // A lantern's head is the 0.26 m cube; the sconces are thin strips.
        if (Math.abs(p.x + 10.6) < 0.05 && Math.abs(s.x - 0.26) < 0.01) lamps.push(Number(p.z.toFixed(2)));
      }
    }
    expect(lamps.sort((a, b) => a - b)).toEqual([-57.6, -52.4, -29.6, -24.4]);
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
