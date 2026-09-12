import { z } from "zod";

// bundle.json, `orchard/bundle/1`. Written by `uv run orchard bundle ...`
// (WP1); read here. Objects are loose so a field added later reaches the
// provenance panel without a client release.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ChunkRefSchema = z.looseObject({
  file: z.string().min(1),
  frame0: z.number().int().nonnegative(),
  frames: z.number().int().positive(),
  sha256: z.string().default(""),
});

export const TapeVariantSchema = z.looseObject({
  frames: z.number().int().positive(),
  /** Slots this variant actually carries. Authoritative when present. */
  n: z.number().int().positive().optional(),
  frame_stride: z.number().int().positive(),
  slot_stride: z.number().int().positive(),
  dt_tau: z.number(),
  /** Tape time of the variant's frame 0. */
  t0_tau: z.number().default(0),
  chunk_frames: z.number().int().positive(),
  bytes: z.number().int().nonnegative().default(0),
  chunks: z.array(ChunkRefSchema).min(1),
});

export const TapeBundleSchema = z.looseObject({
  schema: z.literal("orchard/bundle/1"),
  kind: z.literal("tape"),
  id: z.string(),
  tree: z.string(),
  title: z.string(),
  produced_by: z.string().default(""),
  source: z.looseObject({}).default({}),
  box: Vec3,
  periodic: z.tuple([z.boolean(), z.boolean(), z.boolean()]).default([false, false, false]),
  units: z.string().default(""),
  n_slots: z.number().int().positive(),
  species_names: z.array(z.string()).default([]),
  variants: z.record(z.string(), TapeVariantSchema),
  poster: z.string().default(""),
});

export const VideoBundleSchema = z.looseObject({
  schema: z.literal("orchard/bundle/1"),
  kind: z.literal("video"),
  id: z.string(),
  tree: z.string().default(""),
  title: z.string().default(""),
  produced_by: z.string().default(""),
  source: z.looseObject({}).default({}),
  duration_s: z.number().nonnegative().default(0),
  width: z.number().int().positive().default(1920),
  height: z.number().int().positive().default(1080),
  master: z.string().default("master.m3u8"),
  poster: z.string().default("poster.jpg"),
});

export type ChunkRef = z.infer<typeof ChunkRefSchema>;
export type TapeVariant = z.infer<typeof TapeVariantSchema>;
export type TapeBundle = z.infer<typeof TapeBundleSchema>;
export type VideoBundle = z.infer<typeof VideoBundleSchema>;

/** Device tiers, best first. The client walks this list and takes the first variant present. */
export const VARIANT_PREFERENCE = {
  "vr-high": ["vr-high", "vr-quest", "phone", "preview"],
  "vr-quest": ["vr-quest", "phone", "vr-high", "preview"],
  phone: ["phone", "vr-quest", "preview", "vr-high"],
  desktop: ["vr-high", "vr-quest", "phone", "preview"],
} as const satisfies Record<string, readonly string[]>;

export type DeviceTier = keyof typeof VARIANT_PREFERENCE;

export interface PickedVariant {
  name: string;
  variant: TapeVariant;
}

/** The variant this device should stream, or null when the bundle has none. */
export function pickVariant(bundle: TapeBundle, tier: DeviceTier): PickedVariant | null {
  for (const name of VARIANT_PREFERENCE[tier]) {
    const variant = bundle.variants[name];
    if (variant) return { name, variant };
  }
  const [name, variant] = Object.entries(bundle.variants)[0] ?? [];
  return name && variant ? { name, variant } : null;
}

/**
 * Slots the variant actually carries. WP1 writes `n` per variant and that is
 * the authority; the stride arithmetic is only the fallback for a bundle
 * written before the field existed. They agree on ab_d2 (200000/50 = 4000),
 * but a bundle whose selection rule is not "every k-th slot" — and ab_d2's is
 * "alive-last-then-blake2b" — makes the arithmetic a guess.
 */
export function variantSlots(bundle: TapeBundle, variant: TapeVariant): number {
  return variant.n ?? Math.ceil(bundle.n_slots / Math.max(1, variant.slot_stride));
}
