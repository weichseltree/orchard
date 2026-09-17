import { z } from "zod";

// bundle.json of a `model` bundle, `orchard/bundle/1`. Its own module, not
// bundle.ts: bundle.ts is on the startup path (the still and video schemas),
// and a model's schema is needed only by a room that hangs one.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * A glTF model on a plinth (orchard `bundle_model`): the glb byte for byte,
 * and what the bundler measured from its JSON so the grove can place and
 * scale it before the glb lands. `bbox` is in the file's own units through its
 * node transforms; `triangles` and `draws` are what the bundler's budget held.
 */
export const ModelBundleSchema = z.looseObject({
  schema: z.literal("orchard/bundle/1"),
  kind: z.literal("model"),
  id: z.string(),
  tree: z.string().default(""),
  title: z.string().default(""),
  produced_by: z.string().default(""),
  source: z.looseObject({}).default({}),
  model: z.string().min(1).default("model.glb"),
  poster: z.string().default(""),
  bytes: z.number().int().nonnegative(),
  triangles: z.number().int().nonnegative(),
  draws: z.number().int().positive(),
  bbox: z.looseObject({ min: Vec3, max: Vec3 }).refine(
    (b) => b.min.every((v, i) => v <= b.max[i]!),
    { message: "bbox min must not exceed max" },
  ),
  animations: z.number().int().nonnegative().default(0),
  extensions_used: z.array(z.string()).default([]),
  extensions_required: z.array(z.string()).default([]),
  files: z.record(z.string(), z.looseObject({ sha256: z.string(), bytes: z.number() })).default({}),
});

export type ModelBundle = z.infer<typeof ModelBundleSchema>;
