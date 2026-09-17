import {
  Box3,
  BoxGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Renderer } from "../render/types";
import type { DeviceTier } from "../tape/bundle";
import { ModelBundleSchema, type ModelBundle } from "../tape/model-bundle";
import { modelPlacement, spinRate, type ModelPlacement } from "./model-placement";
import type { ModelHanging } from "./schema";

// A glTF model on a plinth (a `model` bundle, orchard/bundle.py). Only rooms
// that hang one import this module, and with it the glTF loader; a meshopt
// decoder or the KTX2 transcoder is fetched only when the bundle says the glb
// needs it. The bundle's bbox places and scales the model before the glb
// lands, so where it stands never depends on what the loader computed.

export interface ModelExhibitOptions {
  hanging: ModelHanging;
  /** Directory URL of the model bundle, ending in a slash. */
  baseUrl: string;
  renderer: Renderer;
  tier: DeviceTier;
  /** Fetches the glb's bytes; the loader's own fetch when absent. */
  bytes?: (url: string) => Promise<ArrayBuffer>;
  onNotice?: (message: string) => void;
}

/** Extensions the grove cannot decode; the bundler refuses them too. */
const UNDECODABLE = ["KHR_draco_mesh_compression"];
/** The plinth: the Observatory's stone, a brass-toned cap would be a second draw. */
const PLINTH_COLOUR = "#53616c";

export class ModelExhibit {
  readonly group = new Group();
  readonly bounds = new Box3();
  readonly bundle: ModelBundle;
  readonly placement: ModelPlacement;
  /** The turntable: turns about the pivot over `position`, on the plinth's top. */
  readonly #pivot = new Group();
  readonly #model: Object3D;
  readonly #plinth: Mesh<BoxGeometry, MeshStandardMaterial> | null;
  readonly #spin: number;
  readonly #baseUrl: string;
  #disposed = false;

  private constructor(hanging: ModelHanging, bundle: ModelBundle, model: Object3D, baseUrl: string, tier: DeviceTier) {
    this.bundle = bundle;
    this.#model = model;
    this.#baseUrl = baseUrl;
    this.placement = modelPlacement(bundle.bbox, hanging);
    const { scale, offset, plinthHeight, plinthSize } = this.placement;
    this.group.name = `model-${hanging.id}`;
    this.group.position.fromArray(hanging.position);
    this.group.rotation.set(0, MathUtils.degToRad(hanging.rotationDeg[1]), 0);
    this.#pivot.position.set(0, plinthHeight, 0);
    model.scale.setScalar(scale);
    model.position.fromArray(offset);
    this.#pivot.add(model);
    this.group.add(this.#pivot);
    this.#plinth = null;
    if (plinthHeight > 0) {
      const plinth = new Mesh(
        new BoxGeometry(plinthSize[0], plinthHeight, plinthSize[1]),
        new MeshStandardMaterial({ color: PLINTH_COLOUR, roughness: 0.85, metalness: 0 }),
      );
      plinth.name = "plinth";
      plinth.position.set(0, plinthHeight / 2, 0);
      this.group.add(plinth);
      this.#plinth = plinth;
    }
    this.#spin = spinRate(hanging, tier);
    this.#recomputeBounds();
  }

  static async load(options: ModelExhibitOptions): Promise<ModelExhibit> {
    const { hanging, baseUrl, renderer, tier, bytes } = options;
    const response = await fetch(`${baseUrl}bundle.json`);
    if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
    const bundle = ModelBundleSchema.parse(await response.json());
    const needs = new Set([...bundle.extensions_used, ...bundle.extensions_required]);
    const undecodable = UNDECODABLE.filter((ext) => needs.has(ext));
    if (undecodable.length) throw new Error(`the glb needs ${undecodable.join(", ")}, which the grove cannot decode`);
    const loader = new GLTFLoader();
    if (needs.has("EXT_meshopt_compression")) {
      const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
      loader.setMeshoptDecoder(MeshoptDecoder);
    }
    if (needs.has("KHR_texture_basisu")) {
      const { ktx2Loader } = await import("../render/lightmap");
      loader.setKTX2Loader(ktx2Loader(renderer));
    }
    // Not through the chunk scheduler: its 2 MiB chunk limit is a tape's, and a
    // model may be up to the bundler's 8 MB. `bytes` is a test's seam.
    const url = baseUrl + bundle.model;
    const gltf = bytes ? await loader.parseAsync(await bytes(url), baseUrl) : await loader.loadAsync(url);
    if (gltf.animations.length) options.onNotice?.(`${hanging.id}: the model's ${gltf.animations.length} animation(s) are not played`);
    return new ModelExhibit(hanging, bundle, gltf.scene, baseUrl, tier);
  }

  /** Turn the turntable; a still model (or any on a phone) costs nothing. */
  update(dt: number): void {
    if (this.#spin === 0 || this.#disposed) return;
    this.#pivot.rotation.y = (this.#pivot.rotation.y + this.#spin * dt) % (2 * Math.PI);
  }

  provenance(): Record<string, unknown> {
    const b = this.bundle;
    const [x, y, z] = this.placement.size;
    return {
      title: b.title,
      tree: b.tree,
      bundle_id: b.id,
      kind: "model",
      model: this.#baseUrl + b.model,
      size_m: `${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)}`,
      scale: Number(this.placement.scale.toPrecision(4)),
      triangles: b.triangles,
      draw_calls: b.draws,
      bytes: b.bytes,
      extensions: b.extensions_used.join(", "),
      turntable: this.#spin === 0 ? "still" : `${MathUtils.radToDeg(this.#spin).toFixed(1)} deg/s`,
      produced_by: b.produced_by,
      source: b.source,
    };
  }

  #recomputeBounds(): void {
    this.group.updateMatrixWorld(true);
    this.bounds.setFromObject(this.group);
    if (this.#spin === 0) return;
    // A turning model sweeps a circle about the pivot: the box holds all of it.
    const centre = new Vector3();
    this.group.localToWorld(centre.set(0, 0, 0));
    const [sx, , sz] = this.placement.size;
    const r = Math.hypot(sx, sz) / 2;
    this.bounds.expandByPoint(new Vector3(centre.x - r, this.bounds.min.y, centre.z - r));
    this.bounds.expandByPoint(new Vector3(centre.x + r, this.bounds.max.y, centre.z + r));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.group.removeFromParent();
    const materials = new Set<Material>();
    this.#model.traverse((node) => {
      const mesh = node as Partial<Mesh>;
      mesh.geometry?.dispose();
      const own = mesh.material;
      if (Array.isArray(own)) own.forEach((m) => materials.add(m));
      else if (own) materials.add(own);
    });
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
      material.dispose();
    }
    if (this.#plinth) {
      this.#plinth.geometry.dispose();
      this.#plinth.material.dispose();
    }
  }
}
