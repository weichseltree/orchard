import { Box3, Color, Group, MathUtils, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { PALETTE } from "../config";
import { buildStand, standFoot, standFrame, type Stand } from "./stand";
import type { DeviceTier } from "../tape/bundle";
import { TapeBundleSchema, pickVariant, tapeTimeUnit, variantSlots, type TapeBundle } from "../tape/bundle";
import { TapeStream } from "../tape/stream";
import type { ChunkScheduler } from "../render/chunk-stream";
import {
  advance,
  clampTau,
  frameAt,
  formatFrameTime,
  fractionOf,
  nextSpeed,
  stepFrames,
  tauOfFraction,
  tauOfFrame,
  variantTimeline,
  type Speed,
  type Timeline,
} from "../tape/time";
import { TapeVolume } from "../tape/volume";
import type { TapeHanging } from "./schema";

// The signature feature: the tape as points you walk into, on a clock you can
// scrub. The volume, its stream and the reading stand whose lit bar shows
// where in the tape you are, as one object the room can add and the controls
// can talk to. The stand's face carries the wall text (labels.ts).

export interface TapeExhibitOptions {
  hanging: TapeHanging;
  /** Directory URL of the bundle, ending in a slash. */
  baseUrl: string;
  tier: DeviceTier;
  pixelRatio: number;
  onNotice?: (message: string) => void;
  scheduler?: ChunkScheduler;
  /** The room's floor (`bounds.min[1]`), where the reading stand's foot goes; 0 when absent. */
  floorY?: number;
  /**
   * The reading stand the room built for this hanging (world.ts), whose
   * strip the tape drives. Absent, the tape builds one of its own and owns it.
   */
  stand?: Stand;
}

/**
 * Where a hanging's tape volume ends up in the room: the box scaled so its
 * long side is `longSideMeters`, rotated, and moved to `position`. Exported
 * because the ruling that a 2D tape lies flat is a claim about these numbers.
 */
export function hangingBounds(
  box: readonly [number, number, number],
  longSideMeters: number,
  position: readonly [number, number, number],
  rotationDeg: readonly [number, number, number],
): Box3 {
  const scale = longSideMeters / Math.max(...box);
  const half = new Vector3(box[0], box[1], box[2]).multiplyScalar(scale / 2);
  const holder = new Object3D();
  holder.position.set(position[0], position[1], position[2]);
  holder.rotation.set(
    MathUtils.degToRad(rotationDeg[0]),
    MathUtils.degToRad(rotationDeg[1]),
    MathUtils.degToRad(rotationDeg[2]),
  );
  holder.updateMatrixWorld(true);
  return new Box3(half.clone().negate(), half.clone()).applyMatrix4(holder.matrixWorld);
}

type LampState = "playing" | "paused" | "waiting";

export class TapeExhibit {
  readonly group = new Group();
  readonly bundle: TapeBundle;
  readonly variantName: string;
  readonly timeline: Timeline;
  readonly volume: TapeVolume;
  readonly stream: TapeStream;
  readonly hanging: TapeHanging;
  /** World-space box the provenance picker aims at. */
  readonly bounds = new Box3();

  playing = true;
  speed: Speed = 1;
  tau: number;

  #progress: Mesh;
  #light: Mesh;
  #progressWidth: number;
  #lastUploaded = -1;
  #waiting = false;
  #warnedMismatch = false;
  #onNotice: ((message: string) => void) | undefined;
  /** Pre-built: Color.set(string) parses the string and allocates. */
  #lampColours: Record<LampState, Color> = {
    playing: new Color(PALETTE.accent),
    paused: new Color(0x5a6a5c),
    waiting: new Color(0xc9a227),
  };
  #lampState: LampState | "" = "";

  private constructor(
    options: TapeExhibitOptions,
    bundle: TapeBundle,
    variantName: string,
    stream: TapeStream,
    volume: TapeVolume,
    tl: Timeline,
  ) {
    this.hanging = options.hanging;
    this.#onNotice = options.onNotice;
    this.bundle = bundle;
    this.variantName = variantName;
    this.stream = stream;
    this.volume = volume;
    this.timeline = tl;
    this.tau = tl.t0Tau;

    this.group.name = `tape-${options.hanging.id}`;
    const [px, py, pz] = options.hanging.position;
    const [rx, ry, rz] = options.hanging.rotationDeg;
    volume.points.position.set(px, py, pz);
    // A 2D tape is a sheet, and a sheet you walk around lies flat: -90 about X
    // maps the tape's thin local z (Lz = 1) to world up. The document says so
    // per hanging; the client must not quietly ignore it.
    volume.points.rotation.set(
      MathUtils.degToRad(rx),
      MathUtils.degToRad(ry),
      MathUtils.degToRad(rz),
    );
    volume.points.updateMatrixWorld(true);
    this.group.add(volume.points);
    // The picker aims at the AABB of the ROTATED box, not of the local one.
    this.bounds.copy(
      hangingBounds(
        bundle.box,
        options.hanging.longSideMeters,
        options.hanging.position,
        options.hanging.rotationDeg,
      ),
    );

    // The room's stand, or one of this tape's own on the same foot the wall text uses (stand.ts).
    const foot = standFoot(options.hanging, options.floorY ?? 0);
    const stand = options.stand ?? buildStand(standFrame(foot.position, foot.rotationDeg), PALETTE.accent);
    if (!options.stand) {
      this.group.add(stand.group);
      this.#ownStand = stand;
    }
    this.#progress = stand.progress;
    this.#light = stand.light;
    this.#progressWidth = stand.progressWidth;
    this.#applyProgress();
  }
  /** The stand this tape built for itself, to dispose; null when the room owns it. */
  #ownStand: Stand | null = null;

  static async load(options: TapeExhibitOptions): Promise<TapeExhibit> {
    const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    const response = await fetch(`${base}bundle.json`);
    if (!response.ok) throw new Error(`bundle.json: HTTP ${response.status}`);
    const bundle = TapeBundleSchema.parse(await response.json());
    const forced = options.hanging.variant;
    const picked =
      forced && bundle.variants[forced]
        ? { name: forced, variant: bundle.variants[forced]! }
        : pickVariant(bundle, options.tier);
    if (!picked) throw new Error(`bundle ${bundle.id} has no variants`);
    const slots = variantSlots(bundle, picked.variant);
    const stream = new TapeStream({
      baseUrl: base,
      variant: picked.variant,
      maxResident: 3,
      ...(options.onNotice ? { onError: (e: Error) => options.onNotice?.(e.message) } : {}),
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    });
    const volume = new TapeVolume({
      slots,
      box: bundle.box,
      longSideMeters: options.hanging.longSideMeters,
      speciesCount: Math.max(1, bundle.species_names.length),
      pixelRatio: options.pixelRatio,
      pointSize: options.hanging.pointSize,
      palette: options.hanging.palette,
    });
    const tl = variantTimeline(picked.variant);
    stream.request(0);
    return new TapeExhibit(options, bundle, picked.name, stream, volume, tl);
  }

  get frame(): number {
    return frameAt(this.timeline, this.tau);
  }

  /** Source time of the frame requested by the playhead, without cadence interpolation. */
  get frameTime(): number {
    return tauOfFrame(this.timeline, this.frame);
  }

  get frameTimeLabel(): string {
    return formatFrameTime(this.timeline, this.frame);
  }

  get timeUnit(): string {
    return tapeTimeUnit(this.bundle);
  }

  get fraction(): number {
    return fractionOf(this.timeline, this.tau);
  }

  /** True while the frame on screen is older than the frame asked for. */
  get waiting(): boolean {
    return this.#waiting;
  }

  /** Advances the clock and uploads a frame. Allocation-free. */
  update(dt: number): void {
    if (this.playing && dt > 0) {
      this.tau = advance(this.timeline, this.tau, dt, this.speed, true);
    }
    const frame = this.frame;
    if (frame !== this.#lastUploaded) {
      const data = this.stream.frame(frame);
      if (data && this.volume.setFrame(data)) {
        this.#lastUploaded = frame;
        this.#waiting = false;
      } else {
        this.#waiting = true;
        if (data && !this.#warnedMismatch) {
          this.#warnedMismatch = true;
          this.#onNotice?.(
            `tape ${this.bundle.id}: variant "${this.variantName}" declares ` +
              `${this.volume.slots} slots but its chunks carry ${data.positions.length / 3}`,
          );
        }
      }
    }
    this.#applyProgress();
  }

  togglePlay(): boolean {
    this.playing = !this.playing;
    return this.playing;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  cycleSpeed(): Speed {
    this.speed = nextSpeed(this.speed);
    return this.speed;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  scrubToFraction(fraction: number): void {
    this.tau = tauOfFraction(this.timeline, fraction);
  }

  /** The [ and ] keys and a thumbstick nudge. */
  nudgeFrames(delta: number): void {
    this.tau = stepFrames(this.timeline, this.tau, delta);
  }

  /** A held thumbstick: scrub in proportion to how far it is pushed. */
  scrubBySeconds(seconds: number): void {
    this.tau = clampTau(
      this.timeline,
      this.tau + seconds * this.timeline.playbackDtTau * 30,
    );
  }

  setPixelRatio(ratio: number): void {
    this.volume.setPixelRatio(ratio);
  }

  provenance(): Record<string, unknown> {
    return {
      title: this.bundle.title,
      tree: this.bundle.tree,
      bundle_id: this.bundle.id,
      variant: `${this.variantName} (${this.timeline.frames} frames)`,
      time_unit: this.timeUnit,
      frame_time: this.frameTime,
      clock: this.timeline.frameTimesTau ? "exact recorded frame times" : "nominal cadence (legacy bundle)",
      source_time_per_second_at_1x: this.timeline.playbackDtTau * 30,
      slots: `${this.volume.slots} of ${this.bundle.n_slots}`,
      box: `${this.bundle.box.join(" x ")} ${this.bundle.units}`,
      channels_shown: "position, species, alive",
      omitted_channels: this.bundle.source["omitted_channels"] ?? "not recorded by this bundle",
      produced_by: this.bundle.produced_by,
      source: this.bundle.source,
      resident_chunks: `${this.stream.residentCount} of at most ${this.stream.maxResident}`,
    };
  }

  dispose(): void {
    this.stream.dispose();
    this.volume.dispose();
    this.#progress.geometry.dispose();
    (this.#progress.material as MeshBasicMaterial).dispose();
    this.#light.geometry.dispose();
    (this.#light.material as MeshBasicMaterial).dispose();
    this.#ownStand?.dispose();
  }

  /** Called every frame, so it allocates nothing and writes nothing unchanged. */
  #applyProgress(): void {
    const f = this.fraction;
    this.#progress.scale.x = f > 0.001 ? f : 0.001;
    this.#progress.position.x = -this.#progressWidth / 2 + (this.#progressWidth * f) / 2;
    const state: LampState = this.#waiting ? "waiting" : this.playing ? "playing" : "paused";
    if (state === this.#lampState) return;
    this.#lampState = state;
    (this.#light.material as MeshBasicMaterial).color.copy(this.#lampColours[state]);
  }
}
