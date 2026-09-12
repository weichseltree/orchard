import {
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Object3D,
  type WebGLRenderer,
} from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

// WP3 bakes Cycles diffuse+indirect to a 2048 lightmap on UV2 and exports
// hall.glb. glTF has no lightmap slot, so the texture arrives one of three
// ways and this module handles all three:
//
//   1. the exporter already set `material.lightMap` (three's GLTFLoader never
//      does, but a custom loader or a later extension might),
//   2. the glb names a baked image in `extras` / `userData` that the loader
//      parsed into a texture we can read off the material,
//   3. a sibling file next to the glb: lightmap.ktx2, else lightmap.png.
//
// Whichever it is, the texture is bound to the *second* UV set, which is what
// a bake writes and what the base colour must not share.

/** Where copy-basis.mjs puts the Basis Universal transcoder. */
export const TRANSCODER_PATH = "/basis/";

let ktx2: KTX2Loader | null = null;

export function ktx2Loader(renderer: WebGLRenderer): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
  }
  return ktx2;
}

export function disposeKtx2(): void {
  ktx2?.dispose();
  ktx2 = null;
}

/**
 * Loads the first lightmap URL that resolves. `.ktx2` goes through
 * KTX2Loader (Basis transcode, GPU-compressed); anything else through the
 * ordinary texture loader. Returns null when none of them load, which is not
 * an error: the hall is then lit by the fallback lights.
 */
export async function loadLightmap(
  urls: readonly string[],
  renderer: WebGLRenderer,
): Promise<Texture | null> {
  for (const url of urls) {
    try {
      const texture = url.endsWith(".ktx2")
        ? await ktx2Loader(renderer).loadAsync(url)
        : await new TextureLoader().loadAsync(url);
      prepareLightmap(texture);
      // For the provenance panel, and the console: which file actually loaded.
      texture.userData.orchardUrl = url;
      console.info(`[lightmap] ${url} (${texture.image?.width ?? "?"} px)`);
      return texture;
    } catch {
      // Try the next candidate; a missing lightmap is expected before WP3 lands.
    }
  }
  return null;
}

/** glTF convention: no flip, sRGB-encoded, sampled off UV set 1. */
export function prepareLightmap(texture: Texture): Texture {
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.channel = 1;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface LightmapReport {
  /** Meshes that ended up with a lightMap bound. */
  applied: number;
  /** Meshes with a second UV set to bind one to. */
  withUv1: number;
  source: "embedded" | "sibling" | "none";
  /** The `lightMapIntensity` actually set. */
  intensity: number;
}

/**
 * What the bake says its texture means. WP3 writes this into the glb's
 * `asset.extras.orchard.lightmap`.
 */
export interface LightmapMeta {
  /** irradiance/pi = srgb_decode(texel) * scale */
  scale?: number;
  /** The number three wants, which is `scale * pi`. Preferred when present. */
  three_light_map_intensity?: number;
}

/**
 * three r155 dropped the pi factor from the lightmap path
 * (`lights_fragment_maps.glsl.js`: the texel is added straight to irradiance,
 * which is then multiplied by albedo/pi), so a bake that stores irradiance/pi
 * needs `scale * pi`, not `scale`, and certainly not 1. WP3 now publishes the
 * corrected number; the multiplication is the fallback for an older asset.
 */
export function lightmapIntensity(meta: LightmapMeta | null | undefined): number {
  if (!meta) return 1;
  if (typeof meta.three_light_map_intensity === "number" && meta.three_light_map_intensity > 0) {
    return meta.three_light_map_intensity;
  }
  if (typeof meta.scale === "number" && meta.scale > 0) return meta.scale * Math.PI;
  return 1;
}

/**
 * Binds `fallback` (a sibling file) to every standard material under `root`
 * that has a second UV set and no lightmap of its own.
 */
export function applyLightmap(
  root: Object3D,
  fallback: Texture | null,
  meta?: LightmapMeta | null,
): LightmapReport {
  const intensity = lightmapIntensity(meta);
  let applied = 0;
  let withUv1 = 0;
  let embedded = false;
  // Idempotent, and the only place that guarantees the binding is on UV2
  // whoever produced the texture.
  if (fallback) prepareLightmap(fallback);
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    // Some exporters still write the old name; three reads "uv1".
    if (!geometry.getAttribute("uv1") && geometry.getAttribute("uv2")) {
      geometry.setAttribute("uv1", geometry.getAttribute("uv2"));
    }
    const hasUv1 = Boolean(geometry.getAttribute("uv1"));
    if (hasUv1) withUv1++;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue;
      if (material.lightMap) {
        embedded = true;
        prepareLightmap(material.lightMap);
        material.lightMapIntensity = intensity;
        applied++;
        continue;
      }
      if (!hasUv1 || !fallback) continue;
      material.lightMap = fallback;
      material.lightMapIntensity = intensity;
      material.needsUpdate = true;
      applied++;
    }
  });
  return {
    applied,
    withUv1,
    source: embedded ? "embedded" : applied > 0 ? "sibling" : "none",
    intensity,
  };
}
