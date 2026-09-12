// What the live database says hangs on a tree. `orchard exhibit hang` inserts
// a row per approved bundle; a hanging in mansion.json may name a tree and a
// kind instead of a bundle id and take whatever is hung there now. A pinned
// id still wins when the visitor is single-player: the page must work with
// the database unreachable.

/** The `exhibit` table as the generated bindings type it (camelCase fields). */
export interface ExhibitRow {
  id: bigint;
  tree: string;
  kind: string;
  title: string;
  url: string;
  thumbUrl: string;
  tapeUrl: string;
}

/** The exhibit kinds a hanging of each kind may take (module: clip | still | master | tape). */
export const EXHIBIT_KINDS_FOR = {
  tape: ["tape"],
  video: ["clip", "master"],
  still: ["still"],
} as const;

/**
 * The most recently hung row for the tree, of a kind the hanging can show;
 * with `bundle`, the most recent row whose media lives under that bundle id.
 */
export function pickExhibit(
  rows: Iterable<ExhibitRow>,
  tree: string,
  hanging: keyof typeof EXHIBIT_KINDS_FOR,
  bundle = "",
): ExhibitRow | null {
  const kinds: readonly string[] = EXHIBIT_KINDS_FOR[hanging];
  let best: ExhibitRow | null = null;
  for (const row of rows) {
    if (row.tree !== tree || !kinds.includes(row.kind)) continue;
    if (bundle && !bundleBaseOf(row).endsWith(`/${bundle}/`)) continue;
    if (!best || row.id > best.id) best = row;
  }
  return best;
}

/**
 * The bundle directory an exhibit row points into: its url minus the file.
 * `https://media.weichseltree.com/<id>/master.m3u8` -> `https://media.weichseltree.com/<id>/`.
 */
export function bundleBaseOf(row: Pick<ExhibitRow, "url" | "tapeUrl">): string {
  const url = row.tapeUrl || row.url;
  const cut = url.lastIndexOf("/");
  return cut < 0 ? `${url}/` : url.slice(0, cut + 1);
}
