/**
 * Writes a synthetic tape bundle in the `orchard/bundle/1` format into
 * grove/dev/dev-bundle/, and (when ffmpeg is on PATH) a small HLS video
 * bundle into grove/dev/dev-video/.
 *
 * NOT under public/: everything in public/ is copied verbatim into dist/ and
 * would be deployed. vite.config.ts serves grove/dev/ in `pnpm dev` only.
 *
 * WP1 produces the real bundles; this exists so WP2 can be built, tested and
 * demonstrated without waiting for it, and so the decoder test has bytes that
 * came out of a generator rather than out of the decoder's own assumptions.
 *
 *   pnpm dev:bundle
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { syntheticTape, thin, type ThinnedTape } from "../src/tape/devtape";
import { encodeChunk } from "../src/tape/encode";
import type { EncodableFrame } from "../src/tape/encode";

const here = dirname(fileURLToPath(import.meta.url));
const devDir = join(here, "..", "dev");
const tapeDir = join(devDir, "dev-bundle");
const videoDir = join(devDir, "dev-video");

const SLOTS = 4000;
const FRAMES = 240;
const DT_TAU = 0.5;
const CHUNK_FRAMES = 60;
const BOX: [number, number, number] = [40, 40, 1];

interface VariantSpec {
  name: string;
  frameStride: number;
  slotStride: number;
}

const VARIANTS: VariantSpec[] = [
  { name: "vr-high", frameStride: 1, slotStride: 1 },
  { name: "vr-quest", frameStride: 2, slotStride: 1 },
  { name: "phone", frameStride: 2, slotStride: 2 },
];

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeTapeBundle(): void {
  rmSync(tapeDir, { recursive: true, force: true });
  mkdirSync(tapeDir, { recursive: true });

  const tape = syntheticTape({
    slots: SLOTS,
    frames: FRAMES,
    box: BOX,
    dtTau: DT_TAU,
    seed: 20260912,
    speciesNames: ["A", "B"],
  });

  const variants: Record<string, unknown> = {};
  for (const spec of VARIANTS) {
    const thinned: ThinnedTape = thin(tape, spec.frameStride, spec.slotStride);
    const chunkFrames = Math.max(1, Math.floor(CHUNK_FRAMES / spec.frameStride));
    mkdirSync(join(tapeDir, spec.name), { recursive: true });
    const chunks: Array<Record<string, unknown>> = [];
    let bytes = 0;
    for (let frame0 = 0, index = 0; frame0 < thinned.frames; frame0 += chunkFrames, index++) {
      const count = Math.min(chunkFrames, thinned.frames - frame0);
      const frames: EncodableFrame[] = [];
      for (let i = 0; i < count; i++) frames.push(thinned.frame(frame0 + i));
      const encoded = encodeChunk({
        n: thinned.slots,
        frame0,
        t0: frame0 * thinned.dtTau,
        dt: thinned.dtTau,
        frames,
      });
      const file = `${spec.name}/c${String(index).padStart(4, "0")}.bin`;
      writeFileSync(join(tapeDir, file), encoded);
      bytes += encoded.byteLength;
      chunks.push({ file, frame0, frames: count, sha256: sha256(encoded) });
    }
    variants[spec.name] = {
      frames: thinned.frames,
      frame_stride: spec.frameStride,
      slot_stride: spec.slotStride,
      dt_tau: thinned.dtTau,
      chunk_frames: chunkFrames,
      bytes,
      chunks,
    };
  }

  const bundle = {
    schema: "orchard/bundle/1",
    kind: "tape",
    id: "",
    tree: "einstruct",
    title: "A+B annihilation, 2D, synthetic (dev fixture)",
    produced_by: "pnpm --dir grove dev:bundle",
    source: {
      tape_dir: "(none: synthetic)",
      tape_header_sha256: "",
      tape_schema: "video/tape/1",
      tree_commit: "(none)",
      scene: {
        note: "Synthetic fixture written by grove/scripts/make-dev-bundle.ts. Not physics; not for publication.",
        seed: 20260912,
      },
    },
    box: BOX,
    periodic: [true, true, false],
    units: "reduced (sigma, tau)",
    n_slots: SLOTS,
    species_names: ["A", "B"],
    variants,
    poster: "poster.png",
  };

  // The id is the first 16 hex of sha256 over bundle.json with its id empty.
  const canonical = `${JSON.stringify(bundle, null, 2)}\n`;
  bundle.id = sha256(canonical).slice(0, 16);
  writeFileSync(join(tapeDir, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(join(tapeDir, "poster.png"), poster(128, 72));

  const total = Object.values(variants).reduce<number>(
    (sum, v) => sum + ((v as { bytes: number }).bytes ?? 0),
    0,
  );
  console.log(
    `tape: dev/dev-bundle/ id=${bundle.id} ${VARIANTS.length} variants ${(total / 1e6).toFixed(1)} MB`,
  );
}

/** A tiny dark poster, written by hand so the fixture needs no image library. */
function poster(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const glow = Math.max(0, 1 - Math.hypot(x / width - 0.5, y / height - 0.5) * 2.2);
      raw[o++] = Math.round(0x0e + glow * 0x50);
      raw[o++] = Math.round(0x13 + glow * 0xb0);
      raw[o++] = Math.round(0x10 + glow * 0x50);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const b of buffer) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeVideoBundle(): void {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.warn("video: ffmpeg not on PATH, skipping dev/dev-video/");
    return;
  }
  rmSync(videoDir, { recursive: true, force: true });
  mkdirSync(videoDir, { recursive: true });
  // A cellular automaton in the orchard palette: 12 s, two rungs, 6 s segments.
  // The real ladder (360/720/1080) comes from `uv run orchard bundle video`.
  const source =
    "life=size=320x180:mold=10:r=25:ratio=0.11:death_color=#0e1310:life_color=#7fc97f:stitch=0";
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", source, "-t", "12",
      "-filter_complex", "[0:v]split=2[a][b];[a]scale=640:360[v0];[b]scale=1280:720[v1]",
      "-map", "[v0]", "-map", "[v1]",
      "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main", "-pix_fmt", "yuv420p",
      "-g", "150", "-keyint_min", "150", "-sc_threshold", "0",
      "-b:v:0", "600k", "-b:v:1", "1800k",
      "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
      "-hls_segment_filename", join(videoDir, "v%v_s%03d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", "v:0,name:360p v:1,name:720p",
      join(videoDir, "v%v.m3u8"),
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", source,
     "-frames:v", "1", "-vf", "scale=640:360", join(videoDir, "poster.jpg")],
    { stdio: "inherit" },
  );
  const bundle = {
    schema: "orchard/bundle/1",
    kind: "video",
    id: "",
    tree: "einstruct",
    title: "Dev clip (synthetic, not an episode)",
    produced_by: "pnpm --dir grove dev:bundle",
    source: { file_sha256: "", note: "ffmpeg lavfi life filter; a fixture, not footage" },
    duration_s: 12,
    width: 1280,
    height: 720,
    master: "master.m3u8",
    poster: "poster.jpg",
  };
  bundle.id = sha256(`${JSON.stringify(bundle, null, 2)}\n`).slice(0, 16);
  writeFileSync(join(videoDir, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`video: dev/dev-video/ id=${bundle.id} master.m3u8 (360p, 720p)`);
}

writeTapeBundle();
writeVideoBundle();
