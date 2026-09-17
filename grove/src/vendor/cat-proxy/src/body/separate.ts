// Keeps bodies from walking through each other: any two closer than their combined radii are
// pushed apart along the line between them, half each. Positional only and one pass per frame,
// which is enough for two cats; each brain still steers toward its own target.

import type { Vec2 } from "../contract";

export interface Body {
  position: Vec2;
  /** Footprint radius, metres. */
  radius: number;
}

/** New positions, in order; a body that overlaps nothing keeps its position object. */
export function separate(bodies: readonly Body[]): Vec2[] {
  const out = bodies.map((b) => b.position);
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      const min = bodies[i]!.radius + bodies[j]!.radius;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      // Exactly on top of each other: any direction will do, so pick one deterministically.
      const nx = d > 1e-9 ? dx / d : 1;
      const nz = d > 1e-9 ? dz / d : 0;
      const push = (min - d) / 2;
      out[i] = { x: a.x - nx * push, z: a.z - nz * push };
      out[j] = { x: b.x + nx * push, z: b.z + nz * push };
    }
  }
  return out;
}
