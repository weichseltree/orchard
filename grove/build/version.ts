import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * The build's stamp: `dist/version.json` = `{commit, builtAt, sw}` and the same
 * commit baked into the page as `import.meta.env.VITE_COMMIT` (and the time as
 * VITE_BUILT_AT). An open grove compares the two to offer a reload
 * (src/ui/update.ts); `sw: false` makes every open page remove the service
 * worker (the kill switch, `GROVE_SW=off`; build/service-worker.ts).
 *
 * `/version.json` must be served `Cache-Control: no-store` (public/_headers).
 */
export interface BuildStamp {
  commit: string;
  builtAt: string;
  sw: boolean;
}

const grove = fileURLToPath(new URL("..", import.meta.url));

let stamp: BuildStamp | null = null;

/** One stamp per process, so the page, version.json and sw.js agree. */
export function buildStamp(): BuildStamp {
  stamp ??= {
    commit: process.env.GROVE_COMMIT || gitCommit(),
    builtAt: new Date().toISOString(),
    sw: process.env.GROVE_SW !== "off",
  };
  return stamp;
}

/** `git rev-parse --short HEAD`, plus `-dirty` when anything under grove/ differs from it. */
function gitCommit(): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: grove, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const head = git("rev-parse", "--short", "HEAD");
    const dirty = git("status", "--porcelain", "--", ".") !== "";
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "unknown";
  }
}

export function groveVersion(): Plugin {
  return {
    name: "grove-version",
    config() {
      const { commit, builtAt } = buildStamp();
      return {
        define: {
          "import.meta.env.VITE_COMMIT": JSON.stringify(commit),
          "import.meta.env.VITE_BUILT_AT": JSON.stringify(builtAt),
        },
      };
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(buildStamp())}\n`,
      });
    },
  };
}
