import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/**
 * The cache rule, checked on every build (docs/specs/PACKAGES.md §4).
 *
 * `public/_headers` serves `/assets/*` and `/basis/*` immutable for a year.
 * That is only true if every file there carries its content in its name:
 * Vite's own output (`grove-4yJGpl8w.css`), the fingerprinted room assets
 * (`hall.326d194e17.glb`, build/fingerprint.ts), and the Basis transcoder
 * under three's version (`basis/0.186.0/`). A fixed name under an immutable
 * path is a file visitors keep for a year after it changes, so the build
 * fails instead, naming the file. The same goes for `_headers` itself: an
 * immutable rule on any other path fails the build.
 */

const VITE_HASHED = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;
const FINGERPRINTED = /\.[0-9a-f]{10}\.[A-Za-z0-9]+$/;
const VERSION_DIR = /^\d+\.\d+\.\d+[^/]*$/;
/** The only paths `_headers` may mark immutable. */
export const IMMUTABLE_PATHS = ["/assets/*", "/basis/*"] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Files under dist/assets and dist/basis whose names do not change with their bytes. */
export function unhashedFiles(outDir: string): string[] {
  const bad: string[] = [];
  for (const file of walk(join(outDir, "assets"))) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (!VITE_HASHED.test(name) && !FINGERPRINTED.test(name)) bad.push(relative(outDir, file));
  }
  for (const file of walk(join(outDir, "basis"))) {
    const [version] = relative(join(outDir, "basis"), file).split("/");
    if (!version || !VERSION_DIR.test(version) || !relative(join(outDir, "basis"), file).includes("/")) {
      bad.push(relative(outDir, file));
    }
  }
  return bad.sort();
}

/** Every path pattern in a Cloudflare Pages `_headers` file whose rules say `immutable`. */
export function immutableRules(headers: string): string[] {
  const found: string[] = [];
  let path: string | null = null;
  for (const raw of headers.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      path = line.trim();
      continue;
    }
    if (path && /^cache-control:/i.test(line.trim()) && /\bimmutable\b/i.test(line)) {
      found.push(path);
    }
  }
  return found;
}

export function checkDist(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "grove-check-dist",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle: {
      // After the fingerprint step and the service worker have finished dist/.
      order: "post",
      sequential: true,
      handler() {
        const outDir = config.build.outDir;
        const problems: string[] = [];
        for (const file of unhashedFiles(outDir)) {
          problems.push(`${file}: served immutable, but its name does not change with its bytes`);
        }
        const headers = readFileSync(join(outDir, "_headers"), "utf8");
        for (const rule of immutableRules(headers)) {
          if (!(IMMUTABLE_PATHS as readonly string[]).includes(rule)) {
            problems.push(`_headers: ${rule} is marked immutable; only ${IMMUTABLE_PATHS.join(", ")} may be`);
          }
        }
        if (problems.length > 0) {
          throw new Error(
            `the cache rule is broken (docs/specs/PACKAGES.md §4):\n  ${problems.join("\n  ")}`,
          );
        }
        config.logger.info("check-dist: every immutable file is content-named");
      },
    },
  };
}
