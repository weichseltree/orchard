import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import sirv from "sirv";
import { fingerprintAssets } from "./build/fingerprint.ts";
import { groveServiceWorker } from "./build/service-worker.ts";
import { groveVersion } from "./build/version.ts";
import { checkDist } from "./build/check-dist.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const threeVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("node_modules/three/package.json", import.meta.url)), "utf8"),
  ) as { version: string }
).version;
const devFixtures = fileURLToPath(new URL("dev", import.meta.url));
const repoBundles = fileURLToPath(new URL("../results/bundles", import.meta.url));

/**
 * Local content, in `pnpm dev` only.
 *
 * Nothing that is not a real, deployable asset may live under `public/`: Vite
 * copies that directory into `dist/` verbatim, so a fixture there is a fixture
 * on weichseltree.com, and `dist`'s size depended on whether whoever built it
 * had run `pnpm dev:bundle`. Instead:
 *
 *   /dev-bundle/…, /dev-video/…  -> grove/dev/…            (the synthetic fixtures)
 *   /local-bundles/<id>/…        -> results/bundles/<id>/… (WP1's real output)
 *
 * In a build, `MEDIA_BASE` points at media.weichseltree.com and neither path
 * exists.
 */
function localContent(): Plugin {
  return {
    name: "grove-local-content",
    apply: "serve",
    configureServer(server) {
      const mounts: Array<[string, string]> = [
        ["/dev-bundle", `${devFixtures}/dev-bundle`],
        ["/dev-video", `${devFixtures}/dev-video`],
        ["/local-bundles", repoBundles],
      ];
      for (const [prefix, dir] of mounts) {
        if (!existsSync(dir)) continue;
        const serve = sirv(dir, { dev: true, etag: true, extensions: [] });
        server.middlewares.use(prefix, serve);
      }
    },
  };
}

// Two pages out of one build: the site home at / and the app at /mind/.
// Base is "/" because Cloudflare Pages serves this project at the domain root.
export default defineConfig(({ command }) => ({
  base: "/",
  plugins: [
    localContent(),
    // Room assets ship under content-hashed names, and only the ones the scene
    // names (no bake previews, provenance json or retired WP3 hall). Before the
    // service worker, whose build manifest hashes the finished dist/.
    fingerprintAssets({
      scene: fileURLToPath(new URL("src/world/mansion.json", import.meta.url)),
      publicDir: fileURLToPath(new URL("public", import.meta.url)),
    }),
    // version.json and VITE_COMMIT; dist/sw.js, last, over the finished dist/.
    groveVersion(),
    groveServiceWorker({
      entry: "src/sw/sw.ts",
      mediaBase: process.env.VITE_MEDIA_BASE ?? "https://media.weichseltree.com",
    }),
    // Last: fails the build if anything served immutable has a fixed name.
    checkDist(),
  ],
  define: {
    // ffmpeg is optional for the local demo; absent, show tapes without empty walls.
    "import.meta.env.VITE_DEMO_VIDEO": JSON.stringify(
      command === "serve" && existsSync(`${devFixtures}/dev-video/bundle.json`) ? "1" : "",
    ),
    // scripts/copy-basis.mjs writes the transcoder under three's version.
    "import.meta.env.VITE_BASIS_PATH": JSON.stringify(`/basis/${threeVersion}/`),
    // Dev reads WP1's bundles straight off the disk; a build reads R2.
    "import.meta.env.VITE_MEDIA_BASE": JSON.stringify(
      process.env.VITE_MEDIA_BASE ??
        (command === "serve" ? "/local-bundles" : "https://media.weichseltree.com"),
    ),
    // The token service is a Pages Function, which `vite` does not run: off in
    // dev unless pointed at one (`wrangler pages dev`), on in a build.
    "import.meta.env.VITE_AUTH_URL": JSON.stringify(
      process.env.VITE_AUTH_URL ?? (command === "serve" ? "" : "/auth"),
    ),
    // FTL Chess admits weichseltree.com in its frame-ancestors since
    // 2026-09-16 (ftlchess apphosting.yaml), so the gallery's game surface
    // ships on; VITE_FTL_CHESS_ENABLED=0 hides it again without a code change.
    "import.meta.env.VITE_FTL_CHESS_ENABLED": JSON.stringify(
      process.env.VITE_FTL_CHESS_ENABLED ?? "1",
    ),
    // The site key is public, so the live one is the build's default: a build
    // without it would send no human check, and the token service, which
    // demands one, would refuse every visitor's token. (Widget "grove token
    // service", made by `orchard auth turnstile` on 2026-09-12.)
    "import.meta.env.VITE_TURNSTILE_SITEKEY": JSON.stringify(
      process.env.VITE_TURNSTILE_SITEKEY ??
        (command === "serve" ? "" : (process.env.TURNSTILE_SITEKEY ?? "0x4AAAAAAExzRPz5E0HakeDL")),
    ),
  },
  build: {
    manifest: true,
    target: "es2022",
    assetsInlineLimit: 4096,
    rolldownOptions: {
      input: {
        home: fileURLToPath(new URL("index.html", import.meta.url)),
        mind: fileURLToPath(new URL("mind/index.html", import.meta.url)),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    root,
    include: ["src/**/*.test.ts", "auth/**/*.test.ts", "build/**/*.test.ts", "voice/**/*.test.ts"],
    environment: "node",
  },
}));
