import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import sirv from "sirv";

const root = fileURLToPath(new URL(".", import.meta.url));
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

/**
 * WP3 ships `preview.png` (766 kB) beside the hall asset. It is documentation
 * of the bake, not something the client ever fetches, and `public/` is a
 * deploy manifest. Keep the file where WP3 writes it; keep it out of dist.
 */
function dropUnshippedAssets(): Plugin {
  return {
    name: "grove-drop-unshipped",
    apply: "build",
    async closeBundle() {
      await rm(fileURLToPath(new URL("dist/assets/hall/preview.png", import.meta.url)), {
        force: true,
      });
    },
  };
}

// Two pages out of one build: the site home at / and the app at /grove/.
// Base is "/" because Cloudflare Pages serves this project at the domain root.
export default defineConfig(({ command }) => ({
  base: "/",
  plugins: [localContent(), dropUnshippedAssets()],
  define: {
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
    // The site key is public. A deploy sources the secrets file (wrangler needs
    // the token from it), so TURNSTILE_SITEKEY is there: a build can never go
    // out without it once the token service asks for the human check, which
    // would refuse every visitor's token.
    "import.meta.env.VITE_TURNSTILE_SITEKEY": JSON.stringify(
      process.env.VITE_TURNSTILE_SITEKEY ?? (command === "serve" ? "" : (process.env.TURNSTILE_SITEKEY ?? "")),
    ),
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("index.html", import.meta.url)),
        grove: fileURLToPath(new URL("grove/index.html", import.meta.url)),
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    root,
    include: ["src/**/*.test.ts", "auth/**/*.test.ts"],
    environment: "node",
  },
}));
