import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMMUTABLE_PATHS, immutableRules, unhashedFiles } from "./check-dist";

const here = dirname(fileURLToPath(import.meta.url));

function dist(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "grove-dist-"));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "x");
  }
  return root;
}

describe("the cache rule", () => {
  it("accepts Vite's hashes, fingerprinted room assets and a versioned transcoder", () => {
    const root = dist([
      "assets/grove-4yJGpl8w.css",
      "assets/basis_transcoder-VXdx5NbI.wasm",
      "assets/palace/hall/hall.326d194e17.glb",
      "assets/palace/hall/lightmap-1024.e39d74e0a4.ktx2",
      "basis/0.186.0/basis_transcoder.wasm",
      "sw.js",
      "version.json",
    ]);
    expect(unhashedFiles(root)).toEqual([]);
  });

  it("names every fixed name under an immutable path", () => {
    const root = dist([
      "assets/palace/hall/hall.glb",
      "assets/hall/preview.png",
      "basis/basis_transcoder.wasm",
    ]);
    expect(unhashedFiles(root)).toEqual([
      "assets/hall/preview.png",
      "assets/palace/hall/hall.glb",
      "basis/basis_transcoder.wasm",
    ]);
  });

  it("finds the immutable rules in a _headers file", () => {
    const headers = [
      "# comment",
      "/*",
      "  X-Content-Type-Options: nosniff",
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
      "/assets/hall/*",
      "  Cache-Control: public, max-age=86400",
      "/rooms/*",
      "  Cache-Control: public, max-age=31536000, immutable",
    ].join("\n");
    expect(immutableRules(headers)).toEqual(["/assets/*", "/rooms/*"]);
  });

  it("the grove's own _headers marks only the content-named paths immutable", () => {
    const headers = readFileSync(join(here, "..", "public", "_headers"), "utf8");
    expect(immutableRules(headers).sort()).toEqual([...IMMUTABLE_PATHS].sort());
  });
});
