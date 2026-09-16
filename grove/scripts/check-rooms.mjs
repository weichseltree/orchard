// A room in the client that the server has never heard of is a room where a
// visitor stands alone: `join` is refused, presence falls back to the grove,
// and the only trace is a console line nobody reads. The mansion and the
// module are edited in different repos-worth of files days apart, so nothing
// but this check ties them together.
//
// Two comparisons, because there are two ways to be out of step:
//   - mansion.json against the module's SEED_ROOMS, which is what a fresh
//     publish (or a --delete-data republish) creates. Always runs.
//   - mansion.json against the rooms that exist on maincloud RIGHT NOW, which
//     is what a visitor actually meets. `--live`, and it needs the admin
//     identity: the module refuses anonymous SQL.
// `pnpm run deploy` runs the live form, so a mansion cannot ship a room the
// database is missing. Fix a live gap with `set_room`, not a republish.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const grove = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({ options: {
  live: { type: "boolean", default: false },
  db: { type: "string", default: "orchard" },
} });

const mansion = JSON.parse(readFileSync(join(grove, "src", "world", "mansion.json"), "utf8"));
/** Every presence room the client can ask to join, and the rooms asking. */
const wanted = new Map();
for (const room of mansion.rooms) {
  const name = room.presence ?? "grove";
  if (!wanted.has(name)) wanted.set(name, []);
  wanted.get(name).push(room.id);
}

const module = readFileSync(join(grove, "..", "spacetime", "spacetimedb", "src", "index.ts"), "utf8");
const block = module.match(/const SEED_ROOMS[^[]*\[([\s\S]*?)\n\];/);
if (!block) {
  console.error("rooms: could not find SEED_ROOMS in the module; this check cannot vouch for anything");
  process.exit(2);
}
const seeded = new Set([...block[1].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]));

const problems = [];
const compare = (where, have) => {
  for (const [name, rooms] of wanted) {
    if (!have.has(name)) problems.push(`${where}: no room "${name}", which ${rooms.join(", ")} joins`);
  }
  for (const name of have) {
    if (!wanted.has(name)) problems.push(`${where}: room "${name}" exists, but no room in the mansion joins it`);
  }
};
compare("module SEED_ROOMS", seeded);

if (args.live) {
  let rows;
  try {
    const out = execFileSync(
      "spacetime",
      ["sql", args.db, "--format", "json", "SELECT name FROM room"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    rows = JSON.parse(out.slice(out.indexOf("[{")))[0].rows;
  } catch (error) {
    console.error(`rooms: could not read the live room table (${error instanceof Error ? error.message : String(error)})`);
    process.exit(2);
  }
  compare(`live ${args.db}`, new Set(rows.map(([name]) => name)));
}

if (problems.length > 0) {
  console.error(`rooms:\n  ${problems.join("\n  ")}`);
  // Each argument is its own JSON value; a single array is rejected as
  // "Invalid arguments provided for reducer".
  console.error(`  add a missing live room with:\n    spacetime call ${args.db} set_room '"<name>"' '"<title>"' 'false' 'true' '24'`);
  process.exitCode = 1;
} else {
  console.log(`rooms: ${wanted.size} presence rooms match the module${args.live ? ` and live ${args.db}` : ""}`);
}
