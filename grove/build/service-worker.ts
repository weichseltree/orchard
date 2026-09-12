import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { build, type Plugin, type ResolvedConfig } from "vite";
import { buildStamp } from "./version";

/**
 * Builds src/sw/sw.ts to `dist/sw.js`: one classic script at the site root,
 * unhashed (a worker's URL is its identity) and served `Cache-Control:
 * no-cache` (public/_headers). Build only; `vite dev` has no worker.
 *
 * It runs last, after every other plugin has written dist/, and hashes what
 * is under dist/assets and dist/basis into a manifest baked into sw.js: the
 * worker keys its cache by those revisions, so even a file whose name is not
 * hashed is never served stale, and it drops what the last two builds do not
 * ship. The manifest also makes sw.js differ whenever the build does, which
 * is what makes a browser install the new worker.
 *
 * `GROVE_SW=off pnpm run build` writes a worker that deletes the grove's caches
 * and unregisters itself instead, and version.json says `"sw": false`: the
 * rollback, reaching even a page too broken to run its own kill switch.
 */
export interface ServiceWorkerOptions {
  /** The worker's source, relative to the Vite root. */
  entry: string;
  /** Where bundles live, no trailing slash (VITE_MEDIA_BASE). */
  mediaBase: string;
}

/** Top-level directories of dist/ whose files are content-addressed build output. */
const HASHED_DIRS = ["assets", "basis"];

export function groveServiceWorker(options: ServiceWorkerOptions): Plugin {
  let config: ResolvedConfig;
  return {
    name: "grove-service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        const outDir = resolve(config.root, config.build.outDir);
        const stamp = buildStamp();
        if (!stamp.sw) {
          await writeFile(join(outDir, "sw.js"), KILL_SWITCH);
          config.logger.info("grove: sw.js is the kill switch (GROVE_SW=off)");
          return;
        }
        const manifest = await hashTree(outDir, HASHED_DIRS);
        await build({
          configFile: false,
          root: config.root,
          logLevel: "warn",
          publicDir: false,
          define: {
            __GROVE_BUILD__: JSON.stringify(`${stamp.commit} ${stamp.builtAt}`),
            __GROVE_MEDIA_BASE__: JSON.stringify(absoluteMediaBase(options.mediaBase)),
            __GROVE_MANIFEST__: JSON.stringify(manifest),
          },
          build: {
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            target: "es2020",
            minify: true,
            sourcemap: false,
            reportCompressedSize: false,
            rolldownOptions: {
              input: resolve(config.root, options.entry),
              output: { format: "iife", entryFileNames: "sw.js" },
            },
          },
        });
        config.logger.info(`grove: sw.js built, ${Object.keys(manifest).length} build files in its manifest`);
      },
    },
  };
}

/** A relative media base (a dev path) is nothing the worker can match; only a URL is. */
function absoluteMediaBase(base: string): string {
  return /^https?:\/\//.test(base) ? base.replace(/\/+$/, "") : "";
}

/** `/assets/x.js` -> the first 12 hex of its sha256, for every file under `dirs`. */
async function hashTree(root: string, dirs: string[]): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = (await readdir(join(root, dir), { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name));
    } catch {
      continue; // no such directory in this build
    }
    for (const file of entries.sort()) {
      const path = `/${relative(root, file).split(sep).join("/")}`;
      manifest[path] = createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 12);
    }
  }
  return manifest;
}

/** What a deploy with GROVE_SW=off serves as /sw.js: remove everything, then step aside. */
const KILL_SWITCH = `// The grove's service worker is switched off (GROVE_SW=off): this one deletes
// the grove's caches and unregisters itself. It has no fetch handler, so every
// request meanwhile goes to the network as if there were no worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("grove-")) await caches.delete(name);
    await self.registration.unregister();
  })());
});
`;
