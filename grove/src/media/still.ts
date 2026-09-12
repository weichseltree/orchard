import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from "three";
import { pickStillTier, type StillBundle } from "../tape/bundle";
import type { DeviceTier } from "../tape/bundle";

// A still on a wall: one plane, one texture. AVIF first because it is a third
// of the JPEG; the browser's own image decoder answers whether it can read
// it, and a refusal falls through to the JPEG the bundle always carries.

export type StillFormat = "avif" | "jpg";

export interface StillPanelOptions {
  /** The bundle directory, with its trailing slash. */
  base: string;
  bundle: StillBundle;
  tier: DeviceTier;
  /** The largest the panel may be, metres. The image keeps its aspect inside. */
  maxWidthMeters: number;
  maxHeightMeters: number;
  onNotice?: (message: string) => void;
}

/** The largest width × height of `aspect` (w/h) that fits in the box. */
export function fitPanel(
  aspect: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const width = Math.min(maxWidth, maxHeight * aspect);
  return { width, height: width / aspect };
}

export class StillPanel {
  readonly mesh: Mesh;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly tier: string;
  readonly format: StillFormat;
  readonly #texture: Texture;

  private constructor(mesh: Mesh, texture: Texture, size: { width: number; height: number }, tier: string, format: StillFormat) {
    this.mesh = mesh;
    this.#texture = texture;
    this.widthMeters = size.width;
    this.heightMeters = size.height;
    this.tier = tier;
    this.format = format;
  }

  static async create(options: StillPanelOptions): Promise<StillPanel> {
    const tier = pickStillTier(options.bundle, options.tier);
    const loader = new TextureLoader();
    let texture: Texture;
    let format: StillFormat = "jpg";
    if (tier.avif) {
      try {
        texture = await loader.loadAsync(options.base + tier.avif);
        format = "avif";
      } catch {
        // No AVIF decoder here (older Safari, some WebViews): the JPEG is the same picture.
        texture = await loader.loadAsync(options.base + tier.jpg);
      }
    } else {
      texture = await loader.loadAsync(options.base + tier.jpg);
    }
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const size = fitPanel(tier.width / tier.height, options.maxWidthMeters, options.maxHeightMeters);
    const mesh = new Mesh(
      new PlaneGeometry(size.width, size.height),
      new MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    mesh.name = "still-panel";
    return new StillPanel(mesh, texture, size, tier.name, format);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.#texture.dispose();
  }
}
