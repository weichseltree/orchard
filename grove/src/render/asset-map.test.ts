import { describe, expect, it } from "vitest";
import { hashedName, referencedAssets } from "../../build/fingerprint";
import mansionDocument from "../world/mansion.json";
import { resolveAsset } from "./asset-map";

describe("fingerprinted room assets", () => {
  const map = { "/assets/palace/hall/hall.glb": "/assets/palace/hall/hall.0123456789.glb" };

  it("maps a fixed path to its hashed name, same-origin absolute URLs too", () => {
    expect(resolveAsset("/assets/palace/hall/hall.glb", map, "https://x.test")).toBe(
      "/assets/palace/hall/hall.0123456789.glb",
    );
    expect(resolveAsset("https://x.test/assets/palace/hall/hall.glb", map, "https://x.test")).toBe(
      "https://x.test/assets/palace/hall/hall.0123456789.glb",
    );
  });

  it("leaves everything it does not know alone", () => {
    for (const url of [
      "https://media.weichseltree.com/2dd0038799b2db15/bundle.json",
      "blob:https://x.test/1234",
      "/basis/186/basis_transcoder.wasm",
      "https://other.test/assets/palace/hall/hall.glb",
    ]) {
      expect(resolveAsset(url, map, "https://x.test")).toBe(url);
    }
  });

  it("keeps the extension, so the loaders still pick KTX2 by it", () => {
    expect(hashedName("assets/palace/hall/lightmap-1024.ktx2", "abcdef0123456789")).toBe(
      "assets/palace/hall/lightmap-1024.abcdef0123.ktx2",
    );
  });

  it("ships the scene's glbs and lightmap tiers, not the bake's by-products", () => {
    const refs = referencedAssets(mansionDocument);
    expect(refs).toContain("assets/palace/hall/hall.glb");
    expect(refs).toContain("assets/palace/hall/lightmap-1024.ktx2");
    expect(refs.some((r) => r.endsWith("preview.png") || r.endsWith(".json"))).toBe(false);
    expect(refs.some((r) => r.startsWith("assets/hall/"))).toBe(false);
  });
});
