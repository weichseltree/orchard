// What a particular cat looks like, as plain data: how big it is, how its body is proportioned,
// its colourpoint colours and how long its fur is. cat.ts turns one of these into a mesh; the
// skeleton, poses and clips are shared, so two cats differ only in what is written here.
//
// Both presets are the owner's two Ragdolls, read off the reference photos and clips in
// results/spike-e (sheet_stills.jpg, sheet_clips.jpg, frames_425_6fps, ethogram/frames_061130):
//
// - BLUE_POINT: the cat on the sofa in July, on the bed in August and September, on the table in
//   clips 061102 and 061134, and fed pizza in 061425. A pale cool cream coat with a faint grey
//   cast on the back and flanks, a white bib, a slate-grey mask, darker grey ears, grey legs and
//   grey, tufted paws (not mitted), a grey plume tail. The bulkier of the two.
// - SEAL_POINT: the cat walking under the table in clip 061130 and stills 061139-061154. A warm
//   cream body with fawn shading along the back, a near-black brown mask that covers most of the
//   face, dark ears, dark brown legs and paws from the elbow down, and a very dark, very full
//   plume tail. A little lighter-built and lower in the photos.
//
// SIZE COMES FROM WEIGHT, NOT FROM THE SILHOUETTE. The photographs make these cats look half as
// big again as a domestic cat; almost all of that is coat. Mass goes as the cube of length, so a
// length scale follows from a weight:
//
//     size = cbrt(weight / REFERENCE_CAT_KG)
//
// The blue point was weighed at 5.5 kg (the owner, 2026-09-17): cbrt(5.5 / 4.25) = 1.09, so 1.10.
// An earlier 1.34 was judged from the pictures and was wrong by that much — the fluff is not the
// animal. The seal point has never been weighed; its 1.05 is inferred from the photographs, where
// it looks a little smaller and lighter-built than the blue point, and should be replaced by
// cbrt(its weight / REFERENCE_CAT_KG) the day someone puts it on the scales.
//
// The coat carries the bulk instead: `fur`, `ruff`, `tail` and `britches` were raised when the
// bodies shrank, so the silhouette still matches the photographs at the right skeleton size.
//
// AND CHUNK IS WIDTH, NOT LENGTH. The blue point's 5.5 kg is 1.10x the length of a 4.25 kg cat
// but about 1.3x its cross-section: it is the wider animal from the front and from above, barely
// the longer one from the side, and it hangs a deeper belly. `breadth` and `pouch` carry that;
// raising `size` instead would make a big cat rather than a heavy one.

/** An ordinary adult domestic cat, the size the rig itself is authored at (skeleton.ts): about
 * 0.50 m nose to tail base and 4.0-4.5 kg. */
export const REFERENCE_CAT_KG = 4.25;

/** Length scale for a cat of `kg`: mass goes as the cube of length. */
export function sizeForWeight(kg: number): number {
  return Math.cbrt(kg / REFERENCE_CAT_KG);
}

/** What the blue point weighed on the owner's scales. */
export const BLUE_POINT_KG = 5.5;

export interface CatProportions {
  /** Torso width and depth. */
  girth: number;
  /** Across the body only — chest, ribcage, rump, neck and the tops of the legs. Chunk is width
   * and depth, not length: a heavy cat is a wide cat of much the same length (see the note on
   * size above), so this is where its extra kilos go. */
  breadth: number;
  /** How far the belly hangs below the ribcage at its lowest, rig metres. Ragdolls carry a
   * primordial pouch; a heavy one carries it visibly. */
  pouch: number;
  /** Skull and cheek width. */
  head: number;
  /** Leg thickness (the bones are shared; this is boning and fur). */
  legs: number;
  /** Paw size. */
  paws: number;
  /** Tail plume width. */
  tail: number;
  /** Neck ruff and bib. */
  ruff: number;
  /** Britches on the hind legs. */
  britches: number;
}

export interface CatColours {
  /** The flanks. sRGB hex, like every colour here. */
  body: number;
  /** Along the spine, slightly darker than the flanks. */
  back: number;
  /** Belly, chest and bib. */
  belly: number;
  /** Mask, legs and tail. */
  point: number;
  /** The darkest point: ears, the tail tip, the mask round the nose. */
  pointDeep: number;
  nose: number;
  eye: number;
}

export interface CatAppearance {
  name: string;
  /** World size of the rig, which is authored at domestic-cat size: 1.3 is 30% longer and taller. */
  size: number;
  proportions: CatProportions;
  colours: CatColours;
  /** How far the mask spreads over the face; 1 = eyes and muzzle. */
  mask: number;
  /** How dark the legs get toward the paws, 0..1. */
  legPoint: number;
  /** Where along the tail it reaches full point colour, 0 (base) .. 1 (tip). */
  tailPoint: number;
  /** Tuft length multiplier: 1 = a long-haired cat. */
  fur: number;
  /** Rough footprint radius in metres, for keeping two cats apart. */
  radius: number;
}

export const BLUE_POINT: CatAppearance = {
  name: "blue",
  // Measured: 5.5 kg, so cbrt(5.5 / 4.25) = 1.09, rounded to 1.10. Chunky, not lanky: a heavy,
  // broad body at that length, with the coat on top.
  size: 1.1,
  proportions: {
    girth: 1.07,
    breadth: 1.2,
    pouch: 0.036,
    head: 1.06,
    legs: 1.06,
    paws: 1.1,
    tail: 1.15,
    ruff: 1.2,
    britches: 1.18,
  },
  colours: {
    body: 0xd8d1c6,
    back: 0xb4afa9,
    belly: 0xeeeae3,
    point: 0x57565d,
    pointDeep: 0x3e3e46,
    nose: 0x4f5058,
    eye: 0x6ea7e0,
  },
  mask: 0.8,
  legPoint: 1.0,
  tailPoint: 0.4,
  fur: 1.3,
  radius: 0.18,
};

export const SEAL_POINT: CatAppearance = {
  name: "seal",
  // Never weighed: judged from the photographs to be a little smaller than the blue point, in the
  // same proportion as before (1.28 against 1.34). Replace it with a weight when there is one.
  size: 1.05,
  proportions: {
    girth: 1.0,
    breadth: 1.0,
    pouch: 0.014,
    head: 1.0,
    legs: 1.02,
    paws: 1.04,
    tail: 1.2,
    ruff: 1.08,
    britches: 1.1,
  },
  colours: {
    body: 0xdac5a6,
    back: 0xb08d69,
    belly: 0xefe4d2,
    point: 0x4b3527,
    pointDeep: 0x2a1c15,
    nose: 0x261a14,
    eye: 0x5a8fd0,
  },
  mask: 1.15,
  legPoint: 1.0,
  tailPoint: 0.25,
  fur: 1.25,
  radius: 0.17,
};

export const CATS = { blue: BLUE_POINT, seal: SEAL_POINT } as const;
export type CatId = keyof typeof CATS;

export const DEFAULT_APPEARANCE = BLUE_POINT;

/** The size the gaits and clips are authored for, in world units per rig unit: the blue point,
 * the cat whose weight is known. A cat of another size plays its gait at RIG_SCALE / size speed,
 * so its stride still matches the ground it covers. */
export const RIG_SCALE = 1.1;
