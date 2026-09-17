import { z } from "zod";

// The wall text of the museum, one file per language. A room's panel and an
// exhibit's label are copy, kept apart from the scene document (which owns
// where things are) and from the bundles (which own what they are). Every
// language file must name every room and every hanging in mansion.json; the
// test beside this file checks that, so a new room fails loudly in English
// and German alike instead of showing a bare id on one wall.
//
// Room titles are display text: a tree room is titled after its repository in
// every language (names are not translated), and "coarsen" is what the
// visitor reads for the room whose id and tree stay `spectre`
// (docs/specs/NAMING.md).

export const RoomLabelSchema = z.object({
  title: z.string().min(1),
  /** The question the room asks, under the title. */
  kicker: z.string().min(1),
  intro: z.string().min(1),
  lookFor: z.string().optional(),
  limit: z.string().optional(),
  /** The short records a room hangs along its walls (`wallLines` in mansion.json), by key. */
  lines: z.record(z.string(), z.object({ title: z.string().min(1), text: z.string().min(1) })).optional(),
});

export const ExhibitLabelSchema = z.object({
  title: z.string().min(1),
  caption: z.string().min(1),
  /** An extra credit line in the visitor's language (a stock scene, a licence); the repository line is generated. */
  credit: z.string().optional(),
});

export const CommonLabelsSchema = z.object({
  entrance: z.string().min(1),
  exhibit: z.string().min(1),
  lookFor: z.string().min(1),
  limit: z.string().min(1),
  source: z.string().min(1),
});

export const LabelsSchema = z.object({
  common: CommonLabelsSchema,
  rooms: z.record(z.string(), RoomLabelSchema),
  exhibits: z.record(z.string(), ExhibitLabelSchema),
});

export type RoomLabel = z.infer<typeof RoomLabelSchema>;
export type ExhibitLabel = z.infer<typeof ExhibitLabelSchema>;
export type CommonLabels = z.infer<typeof CommonLabelsSchema>;
export type Labels = z.infer<typeof LabelsSchema>;

/**
 * One lazy import per language, so the bundle carries only the language the
 * visitor reads. Adding a language is a file beside this one and a line here.
 */
const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  en: () => import("./en.json"),
  de: () => import("./de.json"),
  fr: () => import("./fr.json"),
  es: () => import("./es.json"),
  it: () => import("./it.json"),
  pt: () => import("./pt.json"),
  nl: () => import("./nl.json"),
  ja: () => import("./ja.json"),
};

export const AVAILABLE_LOCALES: readonly string[] = Object.keys(loaders);

const loaded = new Map<string, Labels>();
const loading = new Map<string, Promise<Labels>>();

export function parseLabels(input: unknown): Labels {
  return LabelsSchema.parse(input);
}

/** The language file, validated; rejects for a locale we do not have or a file that does not parse. */
export function labelsFor(locale: string): Promise<Labels> {
  const have = loaded.get(locale);
  if (have) return Promise.resolve(have);
  let pending = loading.get(locale);
  if (!pending) {
    const load = loaders[locale];
    pending = load
      ? load().then((module) => {
          const labels = parseLabels(module.default);
          loaded.set(locale, labels);
          return labels;
        })
      : Promise.reject(new Error(`no labels for locale "${locale}"`));
    pending.catch(() => loading.delete(locale));
    loading.set(locale, pending);
  }
  return pending;
}

/** The language file if `labelsFor` has already delivered it; for callers on the frame loop. */
export function labelsLoaded(locale: string): Labels | null {
  return loaded.get(locale) ?? null;
}

/** The room's title in the visitor's language, or undefined when the file does not name the room. */
export function roomTitle(labels: Labels | null | undefined, roomId: string): string | undefined {
  return labels?.rooms[roomId]?.title;
}

export function roomLabel(labels: Labels, roomId: string): RoomLabel | undefined {
  return labels.rooms[roomId];
}

export function exhibitLabel(labels: Labels, hangingId: string): ExhibitLabel | undefined {
  return labels.exhibits[hangingId];
}
