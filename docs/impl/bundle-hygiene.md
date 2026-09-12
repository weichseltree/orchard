# Bundle hygiene · content ids, cache headers, clean harvests, gc

2026-09-13. Six changes Manuel approved, one commit each, so that bundles are
content-addressed, cacheable, reproducible and cleaned up.

| change | what it does now |
|---|---|
| **Every id covers every byte** | Video and still bundles name each file they ship in `bundle.json:files` (`{relpath: {sha256, bytes}}`); `media.json` is no longer written. A re-encode that differs is a new bundle; `_finalize` onto an existing id is a no-op. This reverses [WP1](WP1-bundle.md) change 2. The digest check reads all three forms, and all 39 bundles in `results/bundles` still verify. The schema string stays `orchard/bundle/1`, because the grove matches it literally. |
| **Cache-Control on push** | `public, max-age=31536000, immutable` on every object under `<id>/`, `no-cache` on `.orchard-index.json`. `orchard push --refresh-headers <dir>` re-puts the objects of an already-pushed bundle that lack the header. It takes the bucket's own listing as the truth and refuses if any bytes differ. Not run against production. A dry run over all 12 prefixes finds 309 objects to re-put and no disagreements. |
| **Harvest refuses a dirty tree** | An artefact that needs bundling is refused while tracked files have uncommitted changes. Untracked files and the tree's own `orchard.yaml` do not count. `--allow-dirty` records `<sha>-dirty`, as before. |
| **The source's own commit** (BACKLOG 19a) | If git tracks the source and it is clean, the recorded commit is the one that last touched it. Otherwise it is HEAD. A commit the tree wrote survives. Whichever commit the artefact carries is also `bundle.json:source.tree_commit`. |
| **Toolchain** | `orchard/toolchain.py` holds the expected versions: ffmpeg 6.1.1, toktx 4.4.2, Blender 4.2.1, spacetime 2.10.0, wrangler 4.131.1, node 22. `orchard doctor` shows each one as ok, mismatch or missing. Video and still bundles record `tools: {ffmpeg: <banner>}`. |
| **One manifest, one mirror** | Every manifest write goes through `portfolio.save`. `trees/<name>.yaml` is regenerated from the repo's `orchard.yaml` under a `# generated from …` line. `orchard trees refresh [name…]` regenerates all of them. |
| **`orchard bundle gc [--r2] [--apply]`** | Lists bundles that nothing references: manifests, `mansion.json` in any worktree, or the live exhibit table. It deletes them only with `--apply`. It refuses if a source cannot be read, and keeps anything younger than 24 h. Today there is nothing to delete: 39 of 39 local bundles and 12 of 12 R2 prefixes are live. |

## Measured

On this box, harvest dry runs find einstruct (2 tracked files) and phototroph
(6) dirty. All their artefacts are current, so a harvest there is still a
no-op. The refusal comes with their next new or changed artefact. HNL,
agivity and event-atoms are clean and have unbundled artefacts.

## Owed

1. `orchard push --refresh-headers` over the 12 hung prefixes, on a ruling.
2. The grove pinning wrangler as a devDependency. Until then the global pnpm
   copy resolves, and `orchard doctor` reports it.
3. The spec text for `files` and `tools` in `bundle.json` (the parent's).
