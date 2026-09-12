import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * Room assets under content-hashed names.
 *
 * The bakes write fixed names (`assets/palace/hall/hall.glb`) and a rebake
 * overwrites them, but `/assets/*` is served `immutable` for a year: a
 * visitor who had the old bake would keep it. So the build ships every file
 * the scene document names under a name that carries its content hash
 * (`hall.3f2a1b9c0d.glb`), and the client maps the fixed name to the hashed
 * one through three's loading manager (src/render/asset-map.ts). A rebake is
 * then a new URL, and "immutable" is true of everything under /assets/.
 *
 * What ships is what `src/world/mansion.json` references, and nothing else
 * from `public/assets/`: bake previews, bake provenance json, source textures
 * embedded in the glbs, and the retired WP3 hall stay out of dist. A file the
 * scene names that has not been baked yet is skipped (that room shows its grey
 * shell), and the build says so.
 *
 * In `vite dev` and under vitest the map is empty and public/ is served as is.
 */

export const VIRTUAL_ID = "virtual:grove-asset-map";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const ASSET_PATH = /^\/?assets\/.+\.(glb|gltf|ktx2|png|jpe?g|avif|webp|bin)$/i;

/** Every string in the scene document that names a file under assets/. */
export function referencedAssets(document: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (ASSET_PATH.test(value)) found.add(value.replace(/^\//, ""));
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(document);
  return [...found].sort();
}

/** `assets/palace/hall/hall.glb` + digest -> `assets/palace/hall/hall.<10 hex>.glb`. */
export function hashedName(rel: string, digestHex: string): string {
  const dir = posix.dirname(rel);
  const base = posix.basename(rel);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  return posix.join(dir, `${stem}.${digestHex.slice(0, 10)}${ext}`);
}

interface Entry {
  rel: string;
  hashed: string;
}

export function fingerprintAssets(options: { scene: string; publicDir: string }): Plugin {
  let config: ResolvedConfig;
  let entries: Entry[] = [];

  const plan = (): Entry[] => {
    const scene = JSON.parse(readFileSync(options.scene, "utf8")) as unknown;
    const out: Entry[] = [];
    const missing: string[] = [];
    for (const rel of referencedAssets(scene)) {
      const file = join(options.publicDir, rel);
      if (!existsSync(file)) {
        missing.push(rel);
        continue;
      }
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      out.push({ rel, hashed: hashedName(rel, digest) });
    }
    if (missing.length > 0) {
      config.logger.info(
        `fingerprint: ${missing.length} asset(s) named by the scene are not baked yet: ` +
          missing.join(", "),
      );
    }
    return out;
  };

  return {
    name: "grove-fingerprint-assets",
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      entries = config.command === "build" ? plan() : [];
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const map: Record<string, string> = {};
      for (const { rel, hashed } of entries) map[`/${rel}`] = `/${hashed}`;
      return `export default ${JSON.stringify(map)};`;
    },
    async closeBundle() {
      if (config.command !== "build") return;
      const outDir = config.build.outDir;
      // Vite copied public/ verbatim; take back every directory that came
      // from public/assets/ (Vite's own output under dist/assets/ is flat).
      const fromPublic = join(options.publicDir, "assets");
      if (existsSync(fromPublic)) {
        for (const entry of await readdir(fromPublic, { withFileTypes: true })) {
          await rm(join(outDir, "assets", entry.name), { recursive: true, force: true });
        }
      }
      let bytes = 0;
      for (const { rel, hashed } of entries) {
        const to = join(outDir, hashed);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(join(options.publicDir, rel), to);
        bytes += readFileSync(to).length;
      }
      config.logger.info(
        `fingerprint: ${entries.length} room asset(s), ${(bytes / 1e6).toFixed(1)} MB, under hashed names`,
      );
    },
  };
}
