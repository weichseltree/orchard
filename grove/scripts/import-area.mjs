#!/usr/bin/env node
// Fold a tree's area plan (its results/grove/area.json, TREE-AREAS.md §8)
// into mansion.json and its wall text into the eight label files, replacing
// whatever that tree had before. The plan is authored with its entrance door
// at its own origin; the offset is read off the host room's door, so the
// area lands where the palace opened a door for it. Rooms of another scale
// keep their own coordinates, as the Orrery does.
//
//   node scripts/import-area.mjs <area.json> <labels.json> [--dry-run]
//
// Take both files from the tree's pinned commit (git show <sha>:<path>), never
// from a working copy.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const world = join(here, "../src/world");
const args = process.argv.slice(2);
const [areaPath, labelsPath] = args.filter((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
if (!areaPath || !labelsPath) {
  console.error("usage: import-area.mjs <area.json> <labels.json> [--dry-run]");
  process.exit(2);
}

/** How big a repository model's table is, whatever floor the plan reserves for it. */
const TABLE_SIZE = [8, 6];

const area = JSON.parse(readFileSync(areaPath, "utf8"));
const areaLabels = JSON.parse(readFileSync(labelsPath, "utf8"));
const mansionPath = join(world, "mansion.json");
const mansion = JSON.parse(readFileSync(mansionPath, "utf8"));
const tree = area.tree;
if (!tree || !Array.isArray(area.rooms)) throw new Error(`${areaPath}: not an area plan`);
const mine = (id) => id === tree || id.startsWith(`${tree}/`);

// The offset: the host's door onto the entrance, less the entrance's own door.
const host = mansion.rooms.find((r) => r.id === area.attach.to);
if (!host) throw new Error(`host room "${area.attach.to}" is not in mansion.json`);
const hostDoor = host.doorways.find((d) => d.to === area.entrance);
if (!hostDoor) throw new Error(`"${host.id}" has no doorway to "${area.entrance}"; open one first`);
const own = area.attach.door;
if (hostDoor.axis !== own.axis) throw new Error(`the host's door is on axis ${hostDoor.axis}, the area's on ${own.axis}`);
const along = hostDoor.axis === "x" ? [hostDoor.at - own.at, hostDoor.center - own.center] : [hostDoor.center - own.center, hostDoor.at - own.at];
const offset = [along[0], host.bounds.min[1], along[1]];

const scaled = (room) => (room.scale ?? 1) !== 1;
const shift = (p) => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];
const withoutNotes = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === "note" ? undefined : v)));
const planned = new Map(area.rooms.map((r) => [r.id, r]));

const rooms = area.rooms.map((source) => {
  const room = withoutNotes(source);
  if (scaled(room)) {
    // A far room keeps its space; only a portal home needs the palace's coordinates.
    for (const portal of room.portals ?? []) {
      if (planned.has(portal.to) && !scaled(planned.get(portal.to))) portal.exit.position = shift(portal.exit.position);
    }
    return room;
  }
  room.bounds = { min: shift(room.bounds.min), max: shift(room.bounds.max) };
  room.spawn.position = shift(room.spawn.position);
  for (const door of room.doorways) {
    const [a, c] = door.axis === "x" ? [offset[0], offset[2]] : [offset[2], offset[0]];
    door.at += a;
    door.center += c;
  }
  for (const hanging of room.hangings ?? []) {
    delete hanging.caption_key;
    hanging.position = shift(hanging.position);
    if (hanging.pedestal) hanging.pedestal.position = shift(hanging.pedestal.position);
    for (const w of hanging.worlds ?? []) w.position = shift(w.position);
  }
  for (const portal of room.portals ?? []) {
    portal.position = shift(portal.position);
    if (planned.has(portal.to) && !scaled(planned.get(portal.to))) portal.exit.position = shift(portal.exit.position);
  }
  if (room.wall_lines) {
    room.wallLines = room.wall_lines.map(({ dirs: _dirs, ...line }) => ({ ...line, position: shift(line.position) }));
    delete room.wall_lines;
  }
  if (room.tabletop) {
    if (room.tabletop.source !== "repo_model") throw new Error(`${room.id}: a tabletop of "${room.tabletop.source}" is not known`);
    room.repoModels = [{
      id: `${tree}.repo-model`,
      title: area.title ?? tree,
      position: shift(room.tabletop.position),
      yawDeg: 0,
      size: TABLE_SIZE,
      // Low enough to see the far districts over the near ones from the table's edge.
      tableHeight: 0.7,
      // The repository's root is the table itself, not a district on it.
      entries: area.repo_model.filter((e) => e.path !== "." && e.path !== "").map((e) => ({
        path: e.path, bytes: e.bytes, sentence: e.sentence ?? "", room: e.room ?? "",
      })),
    }];
    delete room.tabletop;
  }
  return room;
});

// The entrance's door must meet the host's exactly, or one side walks into a wall.
const entrance = rooms.find((r) => r.id === area.entrance);
const back = entrance?.doorways.find((d) => d.to === host.id);
if (!back || Math.abs(back.at - hostDoor.at) > 1e-6 || Math.abs(back.center - hostDoor.center) > 1e-6) {
  throw new Error(`the entrance's door onto "${host.id}" does not meet the host's door after the offset`);
}

// Replace the tree's rooms where they stood, so the document's order holds.
const first = mansion.rooms.findIndex((r) => mine(r.id));
const kept = mansion.rooms.filter((r) => !mine(r.id));
const at = first < 0 ? kept.length : mansion.rooms.slice(0, first).filter((r) => !mine(r.id)).length;
const removed = mansion.rooms.length - kept.length;
mansion.rooms = [...kept.slice(0, at), ...rooms, ...kept.slice(at)];

const written = [];
const save = (path, doc) => {
  written.push(path);
  if (!dryRun) writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
};
save(mansionPath, mansion);

const exhibitIds = new Set(rooms.flatMap((r) => (r.hangings ?? []).map((h) => h.id)));
for (const [locale, copy] of Object.entries(areaLabels)) {
  const path = join(world, "labels", `${locale}.json`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`labels: no ${locale}.json in the grove, skipped`);
    continue;
  }
  const clean = (record, keep) => Object.fromEntries(Object.entries(record).filter(([k]) => keep(k)));
  doc.rooms = { ...clean(doc.rooms, (k) => !mine(k)), ...clean(copy.rooms ?? {}, (k) => planned.has(k)) };
  doc.exhibits = { ...clean(doc.exhibits, (k) => k !== tree && !k.startsWith(`${tree}.`) && !k.startsWith(`${tree}#`)), ...clean(copy.exhibits ?? {}, (k) => exhibitIds.has(k)) };
  save(path, doc);
}

console.log(`${tree}: ${removed} rooms out, ${rooms.length} in, offset (${offset.join(", ")}) from "${host.id}"'s door`);
console.log(`${dryRun ? "would write" : "wrote"} ${written.length} files`);
