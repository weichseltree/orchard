import {
  Box3,
  BufferAttribute,
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  VideoTexture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MEDIA_BASE } from "../config";
import { claimDecoder, holdsDecoder, releaseDecoder } from "../media/decoder-lease";
import { ATLAS_ORDER, type Screen, type ScreenMode } from "../media/screen";
import { PlanetBundleSchema, VideoBundleSchema, type PlanetBundle, type SurfaceSegment, type VideoBundle } from "../tape/bundle";
import type { PlanetHanging } from "./schema";

// spectre's cutaway worlds: three quarter-cut balls whose surface is the
// measured density edge of half a million particles, moving every tape frame.
// The mesh has fixed topology; each vertex carries a direction, a radius index
// and a factor, and the surface stream carries every frame's radii. The
// texture is an atlas video, one column per world, delivered as an ordinary
// video bundle through the one decoder (decoder-lease.ts). The rule the bake
// states and this file keeps: never show one frame's texture on another
// frame's shape. The geometry follows the DECODED video frame, and the video
// waits when the shape for its next frame has not arrived yet.

export interface PlanetExhibitOptions {
  hanging: PlanetHanging;
  /** Directory URL of the planet bundle, ending in a slash. */
  baseUrl: string;
  onNotice?: (message: string) => void;
}

/** The stream contract this consumer can decode; a bundle that says otherwise is refused. */
export const STREAM_FORMAT = "m04/planet-surface-stream/1";
const STREAM_HEADER_BYTES = 32;
const STREAM_MAGIC = "PSRF";
const STREAM_VERSION = 1;
const STREAM_PREDICTOR = 1;
/** Segments fetched at once; the stream is 34 MB and playback starts on the first. */
const STREAM_CONCURRENCY = 3;

/** Yaw about +Y that turns the cut's bisector `b` (node space, XZ) toward `d` (XZ). */
export function yawToward(b: readonly [number, number, number], d: { x: number; z: number }): number {
  return Math.atan2(d.x, d.z) - Math.atan2(b[0], b[2]);
}

/**
 * The frame a decoded video time names. HLS through hls.js presents its
 * first frame at a measured origin (0.0667 s in Chromium), not at zero, so
 * the origin is subtracted before rounding (spectre's HLS browser check).
 */
export function frameOfTime(mediaTime: number, origin: number, fps: number, frames: number): number {
  return Math.min(frames - 1, Math.max(0, Math.round((mediaTime - origin) * fps)));
}

interface Primitive {
  mesh: Mesh;
  /** Frame 0 as the glb ships it: what the mesh shows before the stream is in and after release. */
  rest: Float32Array;
  position: BufferAttribute;
  dir: Float32Array;
  factor: Float32Array;
  index: Int32Array;
}

interface World {
  name: string;
  /** Column in the atlas and slot in the stream. */
  column: number;
  node: Object3D;
  prims: Primitive[];
  placed: number;
}

/**
 * The decoded surface stream, shared by every planet built from the same
 * bundle: 74 MB of radii for the full record, fetched a segment at a time.
 */
class SurfaceStream {
  readonly codes: Uint8Array;
  readonly bases: Float32Array;
  readonly ready: Uint8Array;
  readonly worlds: number;
  readonly vertices: number;
  readonly columns: number;
  readonly step: number;
  readonly zero: number;
  readonly segments: readonly SurfaceSegment[];
  readonly frames: number;
  readonly listeners = new Set<(first: number, frames: number) => void>();
  #started = false;
  #failed: string | null = null;
  #loaded = 0;

  constructor(readonly base: string, bundle: PlanetBundle) {
    const s = bundle.surface;
    if (s.format !== STREAM_FORMAT) throw new Error(`surface stream ${s.format} is not ${STREAM_FORMAT}`);
    if (s.frames !== bundle.frames) throw new Error(`the stream has ${s.frames} frames, the video ${bundle.frames}`);
    if (s.grid.shape[0] * s.grid.shape[1] !== s.vertices_per_world) throw new Error("the stream's grid does not match its vertex count");
    let next = 0;
    for (const seg of s.segments) {
      if (seg.first_frame !== next) throw new Error(`${seg.file} starts at ${seg.first_frame}, expected ${next}`);
      if (/^[a-z][a-z0-9+.-]*:|^\/|(^|\/)\.\.(\/|$)/i.test(seg.file)) throw new Error(`${seg.file} is not a path inside the bundle`);
      next += seg.frames;
    }
    if (next !== s.frames) throw new Error(`the segments cover ${next} of ${s.frames} frames`);
    this.worlds = s.worlds.length;
    this.vertices = s.vertices_per_world;
    this.columns = s.grid.shape[1];
    this.step = Math.fround(s.quantisation_sigma);
    this.zero = s.zero_code;
    this.segments = s.segments;
    this.frames = s.frames;
    this.codes = new Uint8Array(s.frames * this.worlds * this.vertices);
    this.bases = new Float32Array(s.frames * this.worlds);
    this.ready = new Uint8Array(s.segments.length);
  }

  get failed(): string | null {
    return this.#failed;
  }

  get loadedSegments(): number {
    return this.#loaded;
  }

  segmentOf(frame: number): number {
    // Segments are in frame order; a binary search is not worth it for 38 entries.
    for (let i = this.segments.length - 1; i >= 0; i--) if (this.segments[i]!.first_frame <= frame) return i;
    return 0;
  }

  has(frame: number): boolean {
    return this.ready[this.segmentOf(frame)] === 1;
  }

  /** Radius in sigma of one vertex at one frame. */
  radius(frame: number, world: number, vertex: number): number {
    const slot = frame * this.worlds + world;
    return this.bases[slot]! + (this.codes[slot * this.vertices + vertex]! - this.zero) * this.step;
  }

  /** Fetch every segment, `STREAM_CONCURRENCY` at a time, in order. Safe to call twice. */
  start(onNotice?: (message: string) => void): void {
    if (this.#started) return;
    this.#started = true;
    const queue = this.segments.map((_, i) => i);
    const worker = async (): Promise<void> => {
      while (queue.length && !this.#failed) {
        const i = queue.shift()!;
        try {
          await this.#load(i);
        } catch (error) {
          this.#failed = error instanceof Error ? error.message : String(error);
          onNotice?.(`the planet's surface stream stopped: ${this.#failed}`);
        }
      }
    };
    for (let n = 0; n < Math.min(STREAM_CONCURRENCY, queue.length); n++) void worker();
  }

  async #load(i: number): Promise<void> {
    const seg = this.segments[i]!;
    const response = await fetch(this.base + seg.file);
    if (!response.ok) throw new Error(`${seg.file}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== seg.bytes) throw new Error(`${seg.file} is ${bytes.length} bytes, the bundle says ${seg.bytes}`);
    if (globalThis.crypto?.subtle) {
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (digest !== seg.sha256) throw new Error(`${seg.file} does not match the bundle's SHA-256`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    const version = view.getUint16(4, true);
    const worlds = view.getUint16(6, true);
    const vertices = view.getUint32(8, true);
    const first = view.getUint32(12, true);
    const frames = view.getUint32(16, true);
    const step = view.getFloat32(20, true);
    const zero = view.getUint16(24, true);
    const predictor = view.getUint16(26, true);
    const payload = view.getUint32(28, true);
    const payloadStart = STREAM_HEADER_BYTES + 4 * frames * worlds;
    if (
      magic !== STREAM_MAGIC || version !== STREAM_VERSION || predictor !== STREAM_PREDICTOR ||
      worlds !== this.worlds || vertices !== this.vertices || first !== seg.first_frame || frames !== seg.frames ||
      step !== this.step || zero !== this.zero || payloadStart + payload !== bytes.length
    ) {
      throw new Error(`${seg.file}'s header disagrees with the bundle`);
    }
    for (let k = 0; k < frames * worlds; k++) {
      const base = view.getFloat32(STREAM_HEADER_BYTES + 4 * k, true);
      if (!(base > 0) || !Number.isFinite(base)) throw new Error(`${seg.file} has a base radius of ${base}`);
      this.bases[first * worlds + k] = base;
    }
    const inflated = new Uint8Array(await new Response(
      new Blob([bytes.subarray(payloadStart)]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
    ).arrayBuffer());
    if (inflated.length !== frames * worlds * vertices) throw new Error(`${seg.file} inflates to ${inflated.length} bytes, expected ${frames * worlds * vertices}`);
    // Predictor 1: along each row, code[0] = byte[0], code[j] = (code[j-1] + byte[j]) mod 256.
    const out = this.codes.subarray(first * worlds * vertices, (first + frames) * worlds * vertices);
    const columns = this.columns;
    for (let start = 0; start < inflated.length; start += columns) {
      let code = 0;
      for (let j = start; j < start + columns; j++) {
        code = (code + inflated[j]!) & 255;
        out[j] = code;
      }
    }
    this.ready[i] = 1;
    this.#loaded++;
    for (const listener of this.listeners) listener(first, frames);
  }
}

const streams = new Map<string, SurfaceStream>();
/** One glb parse per bundle; two hangings of one bundle (a chamber and the Orrery) clone its nodes. */
const meshes = new Map<string, Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>>();
let hlsModule: Promise<typeof import("hls.js")> | null = null;
function loadHls(): Promise<typeof import("hls.js")> {
  return hlsModule ??= import("hls.js").catch((error: unknown) => {
    hlsModule = null;
    throw error;
  });
}

async function fetchAtlas(base: string): Promise<VideoBundle> {
  const r = await fetch(`${base}bundle.json`);
  if (!r.ok) throw new Error(`atlas bundle.json: HTTP ${r.status}`);
  return VideoBundleSchema.parse(await r.json());
}

function createFallbackWorlds(hanging: PlanetHanging): { worlds: World[]; material: MeshBasicMaterial } {
  const worlds: World[] = [];
  const cut: [number, number, number] = [Math.SQRT1_2, 0, -Math.SQRT1_2];
  const material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: DoubleSide });

  const worldStyles: Record<string, { skin: number; core: number; face: number }> = {
    "adiabat-chi0": { skin: 0x3d5470, core: 0x8a5d3b, face: 0x5c799c },
    "adiabat-chi6": { skin: 0x2d4863, core: 0xd97724, face: 0xb86b28 },
    "adiabat-chi12": { skin: 0x223b54, core: 0xff9933, face: 0xe65c00 },
  };

  hanging.worlds.forEach((placement, idx) => {
    const node = new Group();
    node.name = `planet-${placement.world}`;
    node.position.set(placement.position[0], placement.position[1], placement.position[2]);
    node.scale.setScalar(hanging.radiusMeters);
    if (placement.cutToward) {
      node.rotation.set(0, yawToward(cut, {
        x: placement.cutToward[0] - placement.position[0],
        z: placement.cutToward[2] - placement.position[2],
      }), 0);
    } else {
      node.rotation.set(
        MathUtils.degToRad(placement.rotationDeg[0]),
        MathUtils.degToRad(placement.rotationDeg[1]),
        MathUtils.degToRad(placement.rotationDeg[2]),
      );
    }

    const style = worldStyles[placement.world] ?? { skin: 0x2d4863, core: 0xd97724, face: 0xb86b28 };

    // Outer 3/4 sphere cutaway skin
    const skinGeo = new SphereGeometry(1, 48, 32, 0, Math.PI * 1.5, 0, Math.PI);
    const skinMat = new MeshBasicMaterial({ color: style.skin, side: DoubleSide, toneMapped: false });
    const skinMesh = new Mesh(skinGeo, skinMat);
    node.add(skinMesh);

    // Inner glowing core sphere
    const coreGeo = new SphereGeometry(0.44, 32, 24, 0, Math.PI * 1.5, 0, Math.PI);
    const coreMat = new MeshBasicMaterial({ color: style.core, side: DoubleSide, toneMapped: false });
    const coreMesh = new Mesh(coreGeo, coreMat);
    node.add(coreMesh);

    // Cut face 1 (along YZ plane, normal +X)
    const face1Geo = new CircleGeometry(1, 32, -Math.PI / 2, Math.PI);
    const faceMat = new MeshBasicMaterial({ color: style.face, side: DoubleSide, toneMapped: false });
    const face1Mesh = new Mesh(face1Geo, faceMat);
    face1Mesh.rotation.y = Math.PI / 2;
    node.add(face1Mesh);

    // Cut face 2 (along XY plane, normal +Z)
    const face2Geo = new CircleGeometry(1, 32, -Math.PI / 2, Math.PI);
    const face2Mesh = new Mesh(face2Geo, faceMat);
    node.add(face2Mesh);

    const prims: Primitive[] = [
      {
        mesh: skinMesh,
        rest: new Float32Array(),
        position: skinGeo.getAttribute("position") as BufferAttribute,
        dir: new Float32Array(),
        factor: new Float32Array(),
        index: new Int32Array(),
      },
      {
        mesh: face1Mesh,
        rest: new Float32Array(),
        position: face1Geo.getAttribute("position") as BufferAttribute,
        dir: new Float32Array(),
        factor: new Float32Array(),
        index: new Int32Array(),
      },
      {
        mesh: face2Mesh,
        rest: new Float32Array(),
        position: face2Geo.getAttribute("position") as BufferAttribute,
        dir: new Float32Array(),
        factor: new Float32Array(),
        index: new Int32Array(),
      },
    ];

    worlds.push({ name: placement.world, column: idx, node, prims, placed: 0 });
  });

  return { worlds, material };
}

export class PlanetExhibit implements Screen {
  readonly group = new Group();
  readonly bundle: PlanetBundle;
  readonly bounds = new Box3();
  readonly position = new Vector3();
  readonly hasAudio = false;
  readonly worlds: World[];
  readonly video: HTMLVideoElement;
  readonly material: MeshBasicMaterial;
  readonly stream: SurfaceStream;
  /** The display modes the bundle carries, in display order. */
  readonly atlases: readonly string[];
  /** The mode showing now (or chosen for when it plays). */
  atlas: string;
  /** The planet bundle's directory, for the legends. */
  readonly baseUrl: string;
  /** Video bundle documents by mode, fetched as modes are asked for. */
  #atlasDocs = new Map<string, Promise<{ base: string; doc: VideoBundle }>>();
  /** Where the video plays from now: the current mode's master playlist. */
  master: string;
  /** A frame to return to once a new source's origin is measured. */
  #seekTo = -1;
  /** The tape frame the geometry shows; -1 while at the glb's rest shape. */
  frame = -1;
  #mode: ScreenMode = "poster";
  #poster: Texture | null;
  #texture: VideoTexture | null = null;
  #hls: { destroy(): void } | null = null;
  #origin: number | null = null;
  #wasPlaying = false;
  #frameCallback: number | null = null;
  #waitingFor = -1;
  #attachment = 0;
  #attaching: Promise<boolean> | null = null;
  #disposed = false;
  #onNotice: ((message: string) => void) | undefined;
  #onSegment: (first: number, frames: number) => void;

  private constructor(
    bundle: PlanetBundle,
    worlds: World[],
    material: MeshBasicMaterial,
    poster: Texture | null,
    stream: SurfaceStream,
    baseUrl: string,
    atlas: { mode: string; base: string; doc: VideoBundle },
    onNotice: ((message: string) => void) | undefined,
  ) {
    this.bundle = bundle;
    this.worlds = worlds;
    this.material = material;
    this.#poster = poster;
    this.stream = stream;
    this.baseUrl = baseUrl;
    this.atlases = ATLAS_ORDER.filter((mode) => bundle.atlases[mode] !== undefined);
    this.atlas = atlas.mode;
    this.#atlasDocs.set(atlas.mode, Promise.resolve({ base: atlas.base, doc: atlas.doc }));
    this.master = atlas.base + atlas.doc.master;
    this.#onNotice = onNotice;
    this.group.name = "planet";
    for (const world of worlds) this.group.add(world.node);
    this.position.copy(worlds[0]!.node.position);
    this.#recomputeBounds();

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = true;
    video.setAttribute("muted", "");
    video.preload = "auto";
    // The same one-pixel trick as the wall: iOS decodes no detached video into a texture.
    video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    this.video = video;
    this.#onSegment = (first, frames) => {
      // The frame the video stopped for has landed: place it and let the clock run.
      if (this.#waitingFor >= first && this.#waitingFor < first + frames) {
        const frame = this.#waitingFor;
        this.#waitingFor = -1;
        this.place(frame);
        if (this.#mode !== "poster") void this.video.play().catch(() => undefined);
      }
    };
    stream.listeners.add(this.#onSegment);
  }

  static async load(options: PlanetExhibitOptions): Promise<PlanetExhibit> {
    const { hanging, baseUrl, onNotice } = options;
    try {
      const response = await fetch(`${baseUrl}bundle.json`);
      if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
      const bundle = PlanetBundleSchema.parse(await response.json());
      const mode = bundle.atlases[hanging.atlas] ? hanging.atlas : "beauty";
      if (mode !== hanging.atlas) onNotice?.(`${hanging.id}: the bundle has no ${hanging.atlas} atlas; showing beauty`);
      const atlas = bundle.atlases[mode];
      if (!atlas) throw new Error("the bundle names no beauty atlas");
      const atlasBase = `${MEDIA_BASE}/${atlas.bundle}/`;
      let mesh = meshes.get(baseUrl);
      if (!mesh) {
        mesh = new GLTFLoader().loadAsync(baseUrl + bundle.mesh).catch((error: unknown) => {
          meshes.delete(baseUrl);
          throw error;
        });
        meshes.set(baseUrl, mesh);
      }
      const [atlasDoc, gltf] = await Promise.all([fetchAtlas(atlasBase), mesh]);
      if (gltf.animations.length) throw new Error("the mesh carries animations; the surface stream is the only clock");
      let stream = streams.get(baseUrl);
      if (!stream) {
        stream = new SurfaceStream(baseUrl, bundle);
        streams.set(baseUrl, stream);
      }
      let poster: Texture | null = null;
      const worlds: World[] = [];
      const cut = bundle.cut.bisector;
      for (const placement of hanging.worlds) {
        const row = bundle.worlds.find((w) => w.world === placement.world);
        if (!row) throw new Error(`${hanging.id}: the bundle has no world "${placement.world}"`);
        if (bundle.surface.worlds[row.column] !== row.world) throw new Error(`${row.world}: atlas column ${row.column} is not its stream slot`);
        const source = gltf.scene.getObjectByName(row.node);
        if (!source) throw new Error(`the mesh has no node ${row.node}`);
        // Each placement gets its own node: one bundle may stand twice in a room.
        const node = source.clone(true);
        node.name = `planet-${placement.world}`;
        node.position.set(placement.position[0], placement.position[1], placement.position[2]);
        node.scale.setScalar(hanging.radiusMeters);
        if (placement.cutToward) {
          node.rotation.set(0, yawToward(cut, {
            x: placement.cutToward[0] - placement.position[0],
            z: placement.cutToward[2] - placement.position[2],
          }), 0);
        } else {
          node.rotation.set(
            MathUtils.degToRad(placement.rotationDeg[0]),
            MathUtils.degToRad(placement.rotationDeg[1]),
            MathUtils.degToRad(placement.rotationDeg[2]),
          );
        }
        const prims: Primitive[] = [];
        node.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const geometry = object.geometry;
          const glbPosition = geometry.getAttribute("position") as BufferAttribute | undefined;
          const dir = geometry.getAttribute("_direction") as BufferAttribute | undefined;
          const factor = geometry.getAttribute("_radius_factor") as BufferAttribute | undefined;
          const index = geometry.getAttribute("_radius_index") as BufferAttribute | undefined;
          if (!glbPosition || !dir || !factor || !index || dir.itemSize !== 3 || factor.itemSize !== 1 || index.itemSize !== 1) {
            throw new Error(`${row.node} lacks the _direction / _radius_factor / _radius_index recipe`);
          }
          const n = glbPosition.count;
          if (dir.count !== n || factor.count !== n || index.count !== n) throw new Error(`${row.node}: recipe attributes disagree in length`);
          const prim: Primitive = {
            mesh: object,
            rest: new Float32Array(glbPosition.array as ArrayLike<number>),
            position: new BufferAttribute(new Float32Array(3 * n), 3).setUsage(DynamicDrawUsage),
            dir: new Float32Array(3 * n),
            factor: new Float32Array(n),
            index: new Int32Array(n),
          };
          for (let v = 0; v < n; v++) {
            prim.dir[3 * v] = dir.getX(v);
            prim.dir[3 * v + 1] = dir.getY(v);
            prim.dir[3 * v + 2] = dir.getZ(v);
            prim.factor[v] = factor.getX(v);
            const k = index.getX(v);
            if (!Number.isInteger(k) || k < 0 || k >= stream!.vertices) throw new Error(`${row.node}: radius index ${k} is outside the stream`);
            prim.index[v] = k;
          }
          (prim.position.array as Float32Array).set(prim.rest);
          // A clone shares its geometry with the source; give it its own so two placements move apart.
          object.geometry = geometry.clone();
          object.geometry.setAttribute("position", prim.position);
          object.geometry.deleteAttribute("_direction");
          object.geometry.deleteAttribute("_radius_factor");
          object.geometry.deleteAttribute("_radius_index");
          object.geometry.computeBoundingSphere();
          object.frustumCulled = true;
          const material = object.material as MeshBasicMaterial;
          if (!poster && material.map) poster = material.map;
          prims.push(prim);
        });
        if (prims.length !== 3) throw new Error(`${row.node} has ${prims.length} primitives; the cutaway has a skin and two faces`);
        worlds.push({ name: row.world, column: row.column, node, prims, placed: -1 });
      }
      // One unlit material for every mesh: light and glow are in the pixels.
      // Both sides, so a visitor inside a world sees its skin, not the sky.
      const material = new MeshBasicMaterial({ map: poster, color: poster ? 0xffffff : 0x1b1f28, toneMapped: false, side: DoubleSide });
      material.name = "planet-atlas";
      for (const world of worlds) for (const prim of world.prims) prim.mesh.material = material;
      return new PlanetExhibit(bundle, worlds, material, poster, stream, baseUrl, { mode, base: atlasBase, doc: atlasDoc }, onNotice);
    } catch (error) {
      onNotice?.(`The live planet bundle could not load (${error instanceof Error ? error.message : String(error)}); showing procedural cutaways.`);
      return PlanetExhibit.createFallback(options);
    }
  }

  static createFallback(options: PlanetExhibitOptions): PlanetExhibit {
    const { hanging, baseUrl, onNotice } = options;
    const fallbackBundle: PlanetBundle = {
      schema: "orchard/bundle/1",
      kind: "planet",
      tree: "spectre",
      id: hanging.bundle?.id || "fallback-planet",
      title: hanging.title || "Planet from scratch",
      fps: 30,
      frames: 1129,
      R_REF_sigma: 55,
      cut: { bisector: [Math.SQRT1_2, 0, -Math.SQRT1_2] },
      mesh: "fallback.glb",
      poster: "poster.jpg",
      atlases: {
        beauty: { bundle: "0000000000000001", legend: "", description: "Beauty atlas (surface density and temperature)" },
        temperature: { bundle: "0000000000000002", legend: "", description: "Temperature atlas (iron-warm core to cool surface)" },
        density: { bundle: "0000000000000003", legend: "", description: "Density atlas (heavy species segregation)" },
      },
      surface: {
        format: STREAM_FORMAT,
        frames: 1129,
        bytes: 1024,
        worlds: ["adiabat-chi0", "adiabat-chi6", "adiabat-chi12"],
        vertices_per_world: 16,
        grid: { shape: [4, 4] },
        quantisation_sigma: 0.1,
        zero_code: 128,
        segment_frames: 1129,
        segments: [
          {
            file: "fallback_seg0.bin",
            first_frame: 0,
            frames: 1129,
            bytes: 1024,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
      },
      worlds: [
        { world: "adiabat-chi0", chi: 0, column: 0, node: "planet-adiabat-chi0" },
        { world: "adiabat-chi6", chi: 6, column: 1, node: "planet-adiabat-chi6" },
        { world: "adiabat-chi12", chi: 12, column: 2, node: "planet-adiabat-chi12" },
      ],
      honesty: ["Procedural cutaway models rendered when offline"],
      produced_by: "grove/src/world/planet-exhibit.ts",
      source: { note: "Procedural cutaway geometry" },
      files: {},
    };

    let stream = streams.get(baseUrl);
    if (!stream) {
      stream = new SurfaceStream(baseUrl, fallbackBundle);
      streams.set(baseUrl, stream);
    }
    const { worlds, material } = createFallbackWorlds(hanging);
    const atlasDoc: VideoBundle = {
      schema: "orchard/bundle/1",
      kind: "video",
      tree: "spectre",
      id: "fallback-video",
      title: "Planet atlas",
      master: "master.m3u8",
      poster: "poster.jpg",
      width: 1920,
      height: 1080,
      duration_s: 37.6,
      produced_by: "grove/src/world/planet-exhibit.ts",
      source: { note: "fallback" },
    };

    return new PlanetExhibit(
      fallbackBundle,
      worlds,
      material,
      null,
      stream,
      baseUrl,
      { mode: "beauty", base: baseUrl, doc: atlasDoc },
      onNotice,
    );
  }

  get mode(): ScreenMode {
    return this.#mode;
  }

  get muted(): boolean {
    return true;
  }

  get playing(): boolean {
    return this.#mode !== "poster" && !this.video.paused;
  }

  /** Whether the shape for the current frame is still on its way. */
  get waiting(): boolean {
    return this.#waitingFor >= 0;
  }

  /** Progress through the record, 0..1, for a readout. */
  get fraction(): number {
    return this.frame < 0 ? 0 : this.frame / Math.max(1, this.bundle.frames - 1);
  }

  /**
   * Take the decoder and play. The surface stream starts downloading on the
   * first attach; the video waits for each frame's shape before showing it.
   */
  attach(): Promise<boolean> {
    if (this.#disposed || this.#mode !== "poster") return Promise.resolve(this.#mode !== "poster");
    if (this.#attaching) return this.#attaching;
    if (!claimDecoder(this)) return Promise.resolve(false);
    const attachment = ++this.#attachment;
    const pending = this.#start(attachment).finally(() => {
      if (attachment === this.#attachment) this.#attaching = null;
    });
    if (attachment === this.#attachment) this.#attaching = pending;
    return pending;
  }

  async #start(attachment: number): Promise<boolean> {
    try {
      this.stream.start(this.#onNotice);
      const platform = globalThis as { MediaSource?: unknown; ManagedMediaSource?: unknown };
      if (platform.MediaSource || platform.ManagedMediaSource) {
        const { default: Hls } = await loadHls();
        if (this.#disposed || attachment !== this.#attachment || !holdsDecoder(this)) return false;
        if (Hls.isSupported()) {
          const instance = new Hls({ enableWorker: true, lowLatencyMode: false });
          this.#hls = instance;
          this.#origin = null;
          // The first fragment's presentation time is the clock's origin
          // (0.0667 s in Chromium); measured here, never assumed.
          instance.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
            const start = data.frag.startPTS;
            if (this.#origin === null && typeof start === "number" && Number.isFinite(start)) {
              this.#origin = start;
              this.#resumeAfterSwitch();
            }
          });
          instance.loadSource(this.master);
          instance.attachMedia(this.video);
          this.#mode = "hls.js";
        }
      }
      if (this.#mode === "poster") {
        if (!this.video.canPlayType("application/vnd.apple.mpegurl")) {
          this.release();
          this.#onNotice?.("this browser has neither MSE nor native HLS; the worlds keep their first frame");
          return false;
        }
        // Native HLS exposes no fragment times; its origin is unmeasured and taken as zero.
        this.video.src = this.master;
        this.#origin = 0;
        this.#mode = "native";
        this.#resumeAfterSwitch();
      }
      this.#texture = new VideoTexture(this.video);
      this.#texture.flipY = false;
      this.#texture.colorSpace = SRGBColorSpace;
      this.#texture.generateMipmaps = false;
      this.#texture.minFilter = LinearFilter;
      this.#texture.magFilter = LinearFilter;
      this.material.map = this.#texture;
      this.material.color.set(0xffffff);
      this.material.needsUpdate = true;
      if ("requestVideoFrameCallback" in this.video) {
        const tick = (_now: number, metadata: { mediaTime: number }): void => {
          if (this.#mode !== "poster") this.#decoded(metadata.mediaTime);
          this.#frameCallback = this.video.requestVideoFrameCallback(tick);
        };
        this.#frameCallback = this.video.requestVideoFrameCallback(tick);
      }
      void this.video.play().catch(() => undefined);
      return true;
    } catch (error) {
      if (attachment !== this.#attachment || !holdsDecoder(this)) return false;
      this.release();
      this.#onNotice?.(`The worlds could not start (${error instanceof Error ? error.message : String(error)}); showing their first frame.`);
      return false;
    }
  }

  /** A decoded video frame is on screen: put the surface at that frame, or hold the video until it can be. */
  #decoded(mediaTime: number): void {
    if (this.#origin === null) return; // no fragment measured yet: the first frame is frame 0, already placed
    const frame = frameOfTime(mediaTime, this.#origin, this.bundle.fps, this.bundle.frames);
    if (this.stream.has(frame)) {
      this.#waitingFor = -1;
      if (frame !== this.frame) this.place(frame);
    } else if (this.#waitingFor !== frame) {
      this.#waitingFor = frame;
      this.video.pause();
    }
  }

  /** Browsers without decoded-frame callbacks follow the seek clock, a frame late at worst. */
  update(): void {
    if (this.#mode === "poster" || this.#frameCallback !== null || this.video.paused || this.video.readyState < 2) return;
    if (this.#origin === null) return;
    const frame = Math.min(this.bundle.frames - 1, Math.max(0, Math.floor((this.video.currentTime - this.#origin) * this.bundle.fps + 1e-5)));
    if (frame !== this.frame) {
      if (this.stream.has(frame)) this.place(frame);
      else if (this.#waitingFor !== frame) {
        this.#waitingFor = frame;
        this.video.pause();
      }
    }
  }

  /** Move every vertex of every world to tape frame `frame`. */
  place(frame: number): void {
    const R = this.bundle.R_REF_sigma;
    const stream = this.stream;
    for (const world of this.worlds) {
      if (world.placed === frame) continue;
      const slot = frame * stream.worlds + world.column;
      const base = stream.bases[slot]!;
      const offset = slot * stream.vertices;
      const { codes, zero, step } = stream;
      for (const prim of world.prims) {
        const p = prim.position.array as Float32Array;
        const { dir, factor, index } = prim;
        for (let v = 0, n = index.length; v < n; v++) {
          const r = factor[v]! * (base + (codes[offset + index[v]!]! - zero) * step) / R;
          p[3 * v] = r * dir[3 * v]!;
          p[3 * v + 1] = r * dir[3 * v + 1]!;
          p[3 * v + 2] = r * dir[3 * v + 2]!;
        }
        prim.position.needsUpdate = true;
        prim.mesh.geometry.computeBoundingSphere();
      }
      world.placed = frame;
    }
    this.frame = frame;
  }

  /** Back to the glb's own frame 0, the shape its poster texture belongs to. */
  #rest(): void {
    for (const world of this.worlds) {
      for (const prim of world.prims) {
        (prim.position.array as Float32Array).set(prim.rest);
        prim.position.needsUpdate = true;
        prim.mesh.geometry.computeBoundingSphere();
      }
      world.placed = -1;
    }
    this.frame = -1;
  }

  /** The legend image for a mode, from the planet bundle. */
  legendUrl(mode: string): string | null {
    const legend = this.bundle.atlases[mode]?.legend;
    return legend ? this.baseUrl + legend : null;
  }

  /**
   * Show another atlas: the same worlds, the same frame, a different
   * measurement in the pixels. The video's source changes, so the clock's
   * origin is measured again on the new stream (spectre's rule: never carry
   * one source's origin to another) and the frame is sought once it is.
   */
  async setAtlas(mode: string): Promise<void> {
    if (!this.bundle.atlases[mode]) throw new Error(`the bundle has no ${mode} atlas`);
    if (mode === this.atlas) return;
    let pending = this.#atlasDocs.get(mode);
    if (!pending) {
      const base = `${MEDIA_BASE}/${this.bundle.atlases[mode]!.bundle}/`;
      pending = fetchAtlas(base).then((doc) => ({ base, doc })).catch((error: unknown) => {
        this.#atlasDocs.delete(mode);
        throw error;
      });
      this.#atlasDocs.set(mode, pending);
    }
    const { base, doc } = await pending;
    if (this.#disposed) return;
    this.atlas = mode;
    this.master = base + doc.master;
    if (this.#mode === "poster") return;
    // Attached: swap the source under the same video element and texture.
    this.#wasPlaying = !this.video.paused;
    this.#seekTo = Math.max(0, this.frame);
    this.video.pause();
    this.#origin = null;
    this.#waitingFor = -1;
    if (this.#hls) {
      const hls = this.#hls as { destroy(): void; loadSource(url: string): void; attachMedia(video: HTMLVideoElement): void };
      // Fragment times arrive on the new source's first fragment; the listener is on the instance and stays.
      hls.loadSource(this.master);
    } else {
      this.video.src = this.master;
      this.#origin = 0;
      this.#resumeAfterSwitch();
    }
  }

  /** After a source change: back to the frame the visitor was on, then play if they were. */
  #resumeAfterSwitch(): void {
    if (this.#seekTo < 0 || this.#origin === null) return;
    const frame = this.#seekTo;
    this.#seekTo = -1;
    if (frame > 0) this.video.currentTime = this.#origin + (frame + 0.25) / this.bundle.fps;
    if (this.#wasPlaying) void this.video.play().catch(() => undefined);
    this.#wasPlaying = false;
  }

  togglePlay(): boolean {
    if (this.#mode === "poster") return false;
    if (this.video.paused) {
      if (this.#waitingFor >= 0) return false; // it resumes by itself when the shape lands
      void this.video.play().catch(() => undefined);
      return true;
    }
    this.video.pause();
    return false;
  }

  /** Hand the decoder back; the worlds return to their first frame and its texture. */
  release(): void {
    ++this.#attachment;
    this.#attaching = null;
    releaseDecoder(this);
    if (this.#mode === "poster" && !this.#hls) return;
    if (this.#frameCallback !== null) {
      this.video.cancelVideoFrameCallback?.(this.#frameCallback);
      this.#frameCallback = null;
    }
    this.#hls?.destroy();
    this.#hls = null;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.#texture?.dispose();
    this.#texture = null;
    this.#waitingFor = -1;
    this.#origin = null;
    this.#seekTo = -1;
    this.#wasPlaying = false;
    this.material.map = this.#poster;
    this.material.color.set(this.#poster ? 0xffffff : 0x1b1f28);
    this.material.needsUpdate = true;
    this.#mode = "poster";
    this.#rest();
  }

  async unmute(): Promise<void> {
    /* A planet has no sound. */
  }

  mute(): void {
    /* A planet has no sound. */
  }

  provenance(): Record<string, unknown> {
    const b = this.bundle;
    return {
      title: b.title,
      tree: b.tree,
      bundle_id: b.id,
      kind: "planet",
      what: b.what ?? "",
      worlds: this.worlds.map((w) => w.name).join(", "),
      frames: b.frames,
      fps: b.fps,
      frame_shown: this.frame < 0 ? "0 (the mesh's own first frame)" : String(this.frame),
      playback: this.#mode,
      surface_stream: `${this.stream.loadedSegments}/${this.stream.segments.length} segments`,
      clock_origin_s: this.#origin,
      atlas_mode: this.atlas,
      atlas_description: this.bundle.atlases[this.atlas]?.description ?? "",
      atlas: this.master,
      honesty: b.honesty,
      produced_by: b.produced_by,
      source: b.source,
    };
  }

  #recomputeBounds(): void {
    this.bounds.makeEmpty();
    for (const world of this.worlds) {
      const r = world.node.scale.x * 1.05;
      this.bounds.expandByPoint(world.node.position.clone().addScalar(r));
      this.bounds.expandByPoint(world.node.position.clone().subScalar(r));
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.release();
    this.#disposed = true;
    this.stream.listeners.delete(this.#onSegment);
    this.video.remove();
    for (const world of this.worlds) for (const prim of world.prims) prim.mesh.geometry.dispose();
    this.material.dispose();
    this.#poster?.dispose();
    this.#poster = null;
  }
}
