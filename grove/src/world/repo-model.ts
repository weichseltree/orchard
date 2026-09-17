import { RepoEntrySchema, type RepoEntry, type RepoModel } from "./schema";

/** Every repository a model can show, bundled with this module and not with the startup document. */
const REPOS = import.meta.glob<{ default: unknown[] }>("./repos/*.json", { eager: true });

/** The folders of a model's repository; empty when the file is missing. */
export function entriesOf(model: RepoModel): RepoEntry[] {
  return (REPOS[`./repos/${model.repo}.json`]?.default ?? []).map((entry) => RepoEntrySchema.parse(entry));
}

// A repository as a tabletop model (ruled 2026-09-17): its directories are
// districts of a small city on a table, nested as they nest in the tree, each
// district's area following the square root of its bytes so a large results
// folder does not swallow the code. A directory the area gives a room of its
// own glows. The folder structure stays visible without eighteen empty
// corridors; the rooms are kept for what there is to see.

/** One district: a directory's rectangle on the table, in the table's own metres, centred on the table. */
export interface RepoBlock {
  path: string;
  name: string;
  sentence: string;
  room: string;
  /** Nesting depth: 0 for a top-level directory. */
  level: number;
  /** Centre and size on the table top: x across the table, z along its depth. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** From the table top to the block's top. */
  height: number;
  leaf: boolean;
}

/** The plate a district stands on, the gap between siblings, and how tall a leaf tower may grow. */
export const PLATE_M = 0.03;
const GAP_M = 0.04;
const TOWER_MIN_M = 0.03;
const TOWER_MAX_M = 0.2;
/** A leaf tower stands on its own footing, inset so the plate around it reads as a street. */
const FOOTING_M = 0.03;

interface Node {
  path: string;
  entry: RepoEntry | null;
  children: Node[];
  bytes: number;
}

/** Nest the flat entries by path; a parent the list never names is implied. */
function tree(entries: readonly RepoEntry[]): Node[] {
  const nodes = new Map<string, Node>();
  const roots: Node[] = [];
  const node = (path: string): Node => {
    let found = nodes.get(path);
    if (found) return found;
    found = { path, entry: null, children: [], bytes: 0 };
    nodes.set(path, found);
    const cut = path.lastIndexOf("/");
    if (cut < 0) roots.push(found);
    else node(path.slice(0, cut)).children.push(found);
    return found;
  };
  for (const entry of entries) node(entry.path.replace(/^\/+|\/+$/g, "")).entry = entry;
  const total = (n: Node): number => {
    n.bytes = Math.max(n.entry?.bytes ?? 0, n.children.reduce((sum, child) => sum + total(child), 0), 1);
    return n.bytes;
  };
  for (const root of roots) total(root);
  const order = (list: Node[]): void => {
    // Largest first, then by name, so the same repository always builds the same city.
    list.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
    for (const n of list) order(n.children);
  };
  order(roots);
  return roots;
}

interface Rect { x: number; z: number; width: number; depth: number }

/**
 * Squarified treemap (Bruls, Huizing, van Wijk): lay the weights out in rows
 * along the rectangle's shorter side, closing a row when adding the next
 * weight would make its worst aspect ratio worse. `weights` is sorted descending.
 */
export function squarify(weights: readonly number[], rect: Rect): Rect[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  // A district narrower than its own gaps has no room for its children.
  if (weights.length === 0 || !(total > 0) || !(rect.width > 0) || !(rect.depth > 0)) return [];
  const scale = (rect.width * rect.depth) / total;
  const areas = weights.map((w) => w * scale);
  const out: Rect[] = [];
  let free = { ...rect };
  let start = 0;
  while (start < areas.length) {
    const side = Math.min(free.width, free.depth);
    let end = start + 1;
    let best = worst(areas.slice(start, end), side);
    while (end < areas.length) {
      const next = worst(areas.slice(start, end + 1), side);
      if (next > best) break;
      best = next;
      end++;
    }
    const row = areas.slice(start, end);
    const rowArea = row.reduce((sum, a) => sum + a, 0);
    const thickness = rowArea / side;
    let offset = 0;
    for (const area of row) {
      const length = area / thickness;
      if (free.width >= free.depth) {
        // A column at the left of the free space, filled top to bottom.
        out.push({ x: free.x, z: free.z + offset, width: thickness, depth: length });
      } else {
        out.push({ x: free.x + offset, z: free.z, width: length, depth: thickness });
      }
      offset += length;
    }
    if (free.width >= free.depth) free = { x: free.x + thickness, z: free.z, width: free.width - thickness, depth: free.depth };
    else free = { x: free.x, z: free.z + thickness, width: free.width, depth: free.depth - thickness };
    start = end;
  }
  return out;
}

function worst(row: readonly number[], side: number): number {
  const sum = row.reduce((s, a) => s + a, 0);
  const max = Math.max(...row), min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** The whole city for one model: every district, parents before their children. */
export function layoutRepoModel(model: RepoModel, entries: readonly RepoEntry[] = entriesOf(model)): RepoBlock[] {
  const roots = tree(entries);
  const [width, depth] = model.size;
  const leafBytes = entries.map((e) => e.bytes).filter((b) => b > 0);
  const lo = Math.log10(Math.max(1, Math.min(...leafBytes, Infinity)));
  const hi = Math.log10(Math.max(10, ...leafBytes));
  const blocks: RepoBlock[] = [];
  const place = (nodes: Node[], rect: Rect, level: number, base: number): void => {
    const rects = squarify(nodes.map((n) => Math.sqrt(n.bytes)), rect);
    nodes.forEach((n, i) => {
      const r = rects[i];
      if (!r || ![r.x, r.z, r.width, r.depth].every(Number.isFinite)) return;
      const inner = { x: r.x + GAP_M / 2, z: r.z + GAP_M / 2, width: Math.max(0, r.width - GAP_M), depth: Math.max(0, r.depth - GAP_M) };
      const leaf = n.children.length === 0;
      if (leaf) {
        const inset = Math.min(FOOTING_M, inner.width / 4, inner.depth / 4);
        inner.x += inset; inner.z += inset; inner.width -= 2 * inset; inner.depth -= 2 * inset;
      }
      const rise = leaf
        ? TOWER_MIN_M + (TOWER_MAX_M - TOWER_MIN_M) * Math.min(1, Math.max(0, (Math.log10(n.bytes) - lo) / Math.max(1e-6, hi - lo)))
        : PLATE_M;
      const name = n.path.slice(n.path.lastIndexOf("/") + 1);
      blocks.push({
        path: n.path, name, sentence: n.entry?.sentence ?? "", room: n.entry?.room ?? "", level,
        x: inner.x + inner.width / 2 - width / 2, z: inner.z + inner.depth / 2 - depth / 2,
        width: inner.width, depth: inner.depth, height: base + rise, leaf,
      });
      if (!leaf) {
        // Children stand on their parent's plate, inset so the parent shows as a rim.
        const rim = Math.min(GAP_M * 1.5, inner.width / 6, inner.depth / 6);
        place(n.children, { x: inner.x + rim, z: inner.z + rim, width: inner.width - 2 * rim, depth: inner.depth - 2 * rim }, level + 1, base + PLATE_M);
      }
    });
  };
  place(roots, { x: 0, z: 0, width, depth }, 0, 0);
  return blocks;
}

/** A room-space point turned into the table's own frame (yaw about the table's centre). */
export function toTable(model: RepoModel, x: number, z: number): { x: number; z: number } {
  const dx = x - model.position[0], dz = z - model.position[2];
  const yaw = -model.yawDeg * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // three.js turns +x toward -z for a positive yaw about +y; undo that.
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/** The table's frame back into room space. */
export function fromTable(model: RepoModel, x: number, z: number): { x: number; z: number } {
  const yaw = model.yawDeg * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: model.position[0] + x * c + z * s, z: model.position[2] - x * s + z * c };
}

/** The deepest district under a table-frame point, or null off the model. */
export function blockAt(blocks: readonly RepoBlock[], x: number, z: number): RepoBlock | null {
  let found: RepoBlock | null = null;
  for (const block of blocks) {
    if (!(Math.abs(x - block.x) <= block.width / 2 && Math.abs(z - block.z) <= block.depth / 2)) continue;
    if (!found || block.level > found.level) found = block;
  }
  return found;
}

/** How far above the table top the model's plates start (observatory.ts lays them on a thin inlay). */
export const INLAY_M = 0.006;

/**
 * Which district the eye is looking at: the first block the gaze ray enters,
 * tower side or roof, in the table's own frame. Towers stand up to a fifth of
 * a metre, so the table's plane alone would name the district behind the one
 * looked at. Null when the ray misses the model.
 */
export function gazeBlock(
  model: RepoModel, blocks: readonly RepoBlock[],
  eye: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number },
): RepoBlock | null {
  const origin = toTable(model, eye.x, eye.z);
  const yaw = -model.yawDeg * Math.PI / 180;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const d = { x: direction.x * c + direction.z * s, y: direction.y, z: -direction.x * s + direction.z * c };
  const base = model.position[1] + model.tableHeight + INLAY_M;
  let found: RepoBlock | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    // observatory.ts draws nothing under a centimetre: nothing to look at.
    if (!(block.width >= 0.01 && block.depth >= 0.01)) continue;
    const t = enterBox(
      [origin.x, eye.y, origin.z], [d.x, d.y, d.z],
      [block.x - block.width / 2, base + block.level * PLATE_M, block.z - block.depth / 2],
      [block.x + block.width / 2, base + block.height, block.z + block.depth / 2],
    );
    if (t === null) continue;
    // A tower and the plate it stands on can be met at the same point: the deeper one is what is seen.
    if (t < nearest - 1e-6 || (Math.abs(t - nearest) <= 1e-6 && found && block.level > found.level)) {
      nearest = t;
      found = block;
    }
  }
  return found;
}

/** Where a ray enters an axis-aligned box (slab test), or null when it misses or the box is behind. */
function enterBox(o: readonly number[], d: readonly number[], lo: readonly number[], hi: readonly number[]): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis++) {
    if (!(hi[axis]! - lo[axis]! >= 0)) return null;
    if (Math.abs(d[axis]!) < 1e-9) {
      if (o[axis]! < lo[axis]! || o[axis]! > hi[axis]!) return null;
      continue;
    }
    let t1 = (lo[axis]! - o[axis]!) / d[axis]!;
    let t2 = (hi[axis]! - o[axis]!) / d[axis]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near;
}
