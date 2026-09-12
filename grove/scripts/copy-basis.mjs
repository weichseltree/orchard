// Copies the Basis Universal transcoder out of the three package into
// public/basis/<three version>/, where KTX2Loader can fetch it at runtime. It
// is a wasm blob with a JS shim, not an import, so it cannot ride the bundle,
// and KTX2Loader names the files itself, so they cannot carry a content hash.
// The directory carries the version instead: /basis/* is served immutable, and
// a three upgrade is then a new URL rather than a year-stale transcoder.
// vite.config.ts points the client at the same directory (VITE_BASIS_PATH).
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const three = join(here, "..", "node_modules", "three");
const from = join(three, "examples", "jsm", "libs", "basis");
const root = join(here, "..", "public", "basis");

try {
  const { version } = JSON.parse(await readFile(join(three, "package.json"), "utf8"));
  const to = join(root, version);
  const names = (await readdir(from)).filter((n) => n.startsWith("basis_transcoder."));
  if (names.length === 0) throw new Error(`no basis_transcoder.* in ${from}`);
  // Only the current version's copy: public/ is what ships.
  await rm(root, { recursive: true, force: true });
  await mkdir(to, { recursive: true });
  for (const name of names) await copyFile(join(from, name), join(to, name));
  console.log(`basis: ${names.join(", ")} -> public/basis/${version}/`);
} catch (error) {
  // A missing transcoder is not fatal: the hall falls back to a PNG lightmap.
  console.warn(`basis: not copied (${error instanceof Error ? error.message : String(error)})`);
}
