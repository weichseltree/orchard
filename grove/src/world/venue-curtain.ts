import { Color, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial } from "three";
import type { Mansion } from "./schema";
import { VENUE_TINT } from "./venue";

// A barred door has to look barred. A presence lock is a wall with a notice;
// a venue door is asked of every visitor and refused most of them, so it
// shows: a curtain of light threads fills the doorway of a room that asks
// for more than the visitor has, and lifts the moment they have it. One
// mesh per gated doorway, one material for all of them, hidden when the
// door is open to this visitor; nothing here decides who passes
// (world/venue.ts does).

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uTint;
uniform float uAspect;
varying vec2 vUv;
void main() {
  // Threads hang from the lintel: bright cores that drift and flicker, and a faint veil between them.
  float threads = 0.0;
  for (int i = 0; i < 3; i++) {
    float f = float(i);
    float x = vUv.x * uAspect * (9.0 + 4.0 * f) + sin(uTime * (0.4 + 0.3 * f) + f * 2.1) * 0.6;
    float core = abs(fract(x) - 0.5) * 2.0;
    threads += smoothstep(0.86, 1.0, 1.0 - core) * (0.55 - 0.12 * f);
  }
  float sway = 0.75 + 0.25 * sin(vUv.y * 9.0 - uTime * 1.7 + vUv.x * 5.0);
  float hem = smoothstep(0.0, 0.18, vUv.y);
  float veil = 0.08 * (1.0 - vUv.y);
  float alpha = (threads * sway * 0.8 + veil) * hem;
  gl_FragColor = vec4(uTint * (0.7 + 0.6 * threads), alpha);
}
`;

export class VenueCurtains {
  readonly group = new Group();
  readonly #material: ShaderMaterial;
  readonly #meshes: Array<{ mesh: Mesh; room: string }> = [];

  constructor(mansion: Mansion) {
    this.group.name = "venue-curtains";
    this.#material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: { value: 0 }, uTint: { value: new Color(VENUE_TINT) }, uAspect: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    for (const room of mansion.rooms) {
      if (room.requires.length === 0) continue;
      for (const door of room.doorways) {
        if (door.closed) continue;
        const neighbour = mansion.rooms.find((r) => r.id === door.to);
        if (!neighbour || neighbour.requires.length >= room.requires.length) continue;
        // The door opens at the higher floor; the curtain hangs from its lintel to that floor.
        const base = Math.max(room.bounds.min[1], neighbour.bounds.min[1]);
        const mesh = new Mesh(new PlaneGeometry(door.width, door.height), this.#material.clone());
        (mesh.material as ShaderMaterial).uniforms.uAspect!.value = door.width / door.height;
        mesh.name = `curtain-${neighbour.id}-${room.id}`;
        if (door.axis === "x") {
          mesh.position.set(door.at, base + door.height / 2, door.center);
          mesh.rotation.y = Math.PI / 2;
        } else {
          mesh.position.set(door.center, base + door.height / 2, door.at);
        }
        mesh.renderOrder = 890;
        mesh.visible = false;
        this.group.add(mesh);
        this.#meshes.push({ mesh, room: room.id });
      }
    }
  }

  /** Each frame: the time for the threads, and which rooms are barred to this visitor right now. */
  update(seconds: number, barred: ReadonlySet<string>): void {
    for (const { mesh, room } of this.#meshes) {
      mesh.visible = barred.has(room);
      if (mesh.visible) (mesh.material as ShaderMaterial).uniforms.uTime!.value = seconds;
    }
  }

  /** The doorways curtained, for tests. */
  get doors(): readonly string[] {
    return this.#meshes.map((m) => m.mesh.name);
  }

  dispose(): void {
    for (const { mesh } of this.#meshes) {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
    this.#material.dispose();
  }
}
