// The client's SpacetimeDB bindings (src/module_bindings/, checked in) must be
// what the module in ../spacetime/spacetimedb generates today. A module change
// without `pnpm gen:bindings` builds fine and fails only in production, as a
// reducer or column the client cannot see. This regenerates into a temporary
// directory and compares; it writes nothing in the repo. Run before every
// deploy (`pnpm run deploy` calls it) and by `orchard audit`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const grove = join(dirname(fileURLToPath(import.meta.url)), "..");
const committed = join(grove, "src", "module_bindings");
const out = mkdtempSync(join(tmpdir(), "grove-bindings-"));

function files(root, dir = root) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...files(root, path));
    else found.push(relative(root, path));
  }
  return found.sort();
}

try {
  execFileSync(
    "spacetime",
    ["generate", "--lang", "typescript", "--out-dir", out, "-p", join(grove, "..", "spacetime", "spacetimedb"), "-y"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const want = files(out);
  const have = files(committed);
  const differ = [];
  for (const name of new Set([...want, ...have])) {
    if (!want.includes(name)) differ.push(`${name}: committed, but the module no longer generates it`);
    else if (!have.includes(name)) differ.push(`${name}: the module generates it, but it is not committed`);
    else if (readFileSync(join(out, name), "utf8") !== readFileSync(join(committed, name), "utf8")) {
      differ.push(`${name}: differs from what the module generates`);
    }
  }
  if (differ.length > 0) {
    console.error(`bindings: src/module_bindings is stale; run \`pnpm gen:bindings\`:\n  ${differ.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`bindings: ${have.length} files match the module`);
  }
} catch (error) {
  console.error(`bindings: could not generate (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 2;
} finally {
  rmSync(out, { recursive: true, force: true });
}
