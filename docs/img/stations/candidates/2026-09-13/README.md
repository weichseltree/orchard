# Station candidates preserved on 2026-09-13

These six images were already in the worktree before the UX changes. They
are retained for geometry review, not accepted as new camera-station
baselines. Each differs from its corresponding image two directories up.

`manifest.json` records the original paths, byte sizes and SHA-256 digests.
The capture-time code and asset revisions were not recorded. Compare them
with the accepted stations and the current room geometry before deciding
whether any should replace a baseline.

New station runs may create fresh `.new.jpg` files in the parent station
directory. Those transient comparisons are ignored; deliberately archive
useful evidence or use the station tool's `--accept` only after review.
