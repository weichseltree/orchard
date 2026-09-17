#!/usr/bin/env node
// Re-hashes a vendored copy of @someother/cat-proxy against the VENDORED.json beside it and
// reports drift: files edited in place, files missing, files that appeared. Standalone on purpose
// — node's own modules only, no package to install, no network, no upstream checkout — so it can
// be run in a public CI that cannot see the private repo this package comes from.
//
//     node check-vendor.mjs [<dir>]        # defaults to the directory this script sits in
//
// Exit 0 when the copy matches its manifest, 1 when it does not. It deliberately cannot tell you
// whether the copy is BEHIND upstream; that needs the upstream repo, and the tool for it lives
// there (tools/sync-to-orchard.mjs --stale).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "VENDORED.json");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(`no readable VENDORED.json in ${root}: ${String(error)}`);
    process.exit(1);
  }

  const expected = new Map(Object.entries(manifest.files ?? {}));
  const found = new Set(
    walk(root)
      .map((path) => relative(root, path).split(sep).join("/"))
      .filter((name) => name !== "VENDORED.json"),
  );

  const edited = [];
  const missing = [];
  for (const [name, record] of expected) {
    if (!found.has(name)) {
      missing.push(name);
      continue;
    }
    const bytes = readFileSync(join(root, name));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== record.sha256) edited.push(name);
  }
  const extra = [...found].filter((name) => !expected.has(name));

  const problems = edited.length + missing.length + extra.length;
  console.log(
    `${manifest.package ?? "cat-proxy"} vendored from ${manifest.source_repo ?? "?"} ` +
      `@ ${String(manifest.commit ?? "?").slice(0, 12)}${manifest.dirty ? " (dirty)" : ""}, ` +
      `${expected.size} files`,
  );
  for (const name of edited) console.error(`edited here: ${name}`);
  for (const name of missing) console.error(`missing:     ${name}`);
  for (const name of extra) console.error(`not ours:    ${name}`);
  if (problems === 0) {
    console.log("matches its manifest.");
    return;
  }
  console.error(
    `\n${problems} file(s) differ. Edits belong upstream in someotherlife, not here: change the ` +
      `package there and re-sync, or this copy will be overwritten.`,
  );
  process.exit(1);
}

main();
