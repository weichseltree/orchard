// Copies the Basis Universal transcoder out of the three package into
// public/basis/, where KTX2Loader can fetch it at runtime. It is a wasm blob
// with a JS shim, not an import, so it cannot ride the bundle.
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "node_modules", "three", "examples", "jsm", "libs", "basis");
const to = join(here, "..", "public", "basis");

try {
  const names = (await readdir(from)).filter((n) => n.startsWith("basis_transcoder."));
  if (names.length === 0) throw new Error(`no basis_transcoder.* in ${from}`);
  await mkdir(to, { recursive: true });
  for (const name of names) await copyFile(join(from, name), join(to, name));
  console.log(`basis: ${names.join(", ")} -> public/basis/`);
} catch (error) {
  // A missing transcoder is not fatal: the hall falls back to a PNG lightmap.
  console.warn(`basis: not copied (${error instanceof Error ? error.message : String(error)})`);
}
