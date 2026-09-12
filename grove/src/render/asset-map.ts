import { DefaultLoadingManager } from "three";
import assetMap from "virtual:grove-asset-map";

// The build ships room assets under content-hashed names (build/fingerprint.ts)
// so they can be cached forever; the scene document keeps naming them by their
// fixed paths. Every three loader the grove constructs uses the default
// loading manager, so one URL modifier there translates the lot: GLTFLoader for
// the room glbs, KTX2Loader and TextureLoader for the lightmap tiers. A URL the
// map does not know (a bundle on the media host, a blob, anything in dev) is
// returned unchanged.

export function resolveAsset(
  url: string,
  map: Readonly<Record<string, string>> = assetMap,
  origin: string = globalThis.location?.origin ?? "",
): string {
  const direct = map[url];
  if (direct) return direct;
  if (origin && url.startsWith(`${origin}/`)) {
    const hashed = map[url.slice(origin.length)];
    if (hashed) return `${origin}${hashed}`;
  }
  return url;
}

let installed = false;

export function installAssetMap(): void {
  if (installed || Object.keys(assetMap).length === 0) return;
  installed = true;
  DefaultLoadingManager.setURLModifier((url) => resolveAsset(url));
}
