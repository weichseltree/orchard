"""Harvest: bundle every artefact a tree declares, and write the ids back.

    uv run orchard harvest einstruct            # every supported artefact
    uv run orchard harvest einstruct --only tape --dry-run

The manifest is the list of what a tree can show; the bundle is what the
grove can download. This is the join. For each artefact whose kind has a
bundler (tape, clip, master, still, figure) the source is hashed, bundled
unless the manifest already names a bundle made from those bytes, and the
bundle id, the source digest and the tree commit are written into the
artefact. Nothing here uploads or hangs anything: `orchard exhibit` does
that, on a ruling (LAWS 22).

Two things the trees found on 2026-09-12 and this now does:

- A tape's digest covers `header.json`, `frames.jsonl` and `trailer.json`
  together (it was the header alone, so a tape bundled mid-write stayed
  "current" forever), and a tape whose trailer disagrees with its index is
  refused as still being written. A row carrying the old header-only digest
  is still "current": the digest is upgraded in place, not re-bundled, so
  the tapes already hanging keep their ids.
- `commit` is the commit the artefact was MADE at, which for a gitignored
  result only the tree can know. Harvest stamps a commit only when the field
  is empty or the source bytes changed since the last harvest; a commit the
  tree wrote by hand survives.

And since 2026-09-13:

- **A dirty tree is refused.** An artefact that needs bundling is refused
  while the tree has uncommitted changes to tracked files, because the
  commit it would record does not describe the code that made it (the
  manifests were collecting `-dirty` commits). `--allow-dirty` bundles
  anyway and records `<sha>-dirty` as before. Untracked files are not dirt,
  and neither is the tree's own `orchard.yaml`, which harvest rewrites.
- **The commit is the source's own where git knows it** (BACKLOG 19a). A
  source git tracks records the commit that last touched it; a gitignored
  one records HEAD. Whichever commit the artefact ends up with is also what
  its bundle's `source.tree_commit` says, so the two no longer disagree.

The manifest written is the one that was read: `<repo>/orchard.yaml` when the
tree carries one, else the fund's copy in `trees/`.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from . import RESULTS, TREES
from .manifest import Artefact, Tree, dump

BUNDLED_KINDS = ("tape", "clip", "master", "still", "figure")


def manifest_path(tree: Tree) -> Path:
    canonical = tree.root / "orchard.yaml"
    return canonical if canonical.exists() else TREES / f"{tree.name}.yaml"


def resolve_source(tree: Tree, art: Artefact) -> Path | None:
    """The file (or, for a tape, the directory) the artefact names, if it exists.

    A tape artefact may point at `header.json`; the bundler wants the directory.
    """
    p = (tree.root / art.path).expanduser()
    if art.kind == "tape" and p.is_file():
        p = p.parent
    return p if p.exists() else None


TAPE_DIGEST_FILES = ("header.json", "frames.jsonl", "trailer.json")


def tape_digest(src: Path) -> str:
    """One digest over the header, the frame index and the trailer.

    `data.bin` is not read (gigabytes); the index names every frame's offset
    and length and the trailer its total, so a frame appended, torn or
    rewritten changes one of the three.
    """
    h = hashlib.sha256()
    for name in TAPE_DIGEST_FILES:
        f = src / name
        h.update(name.encode() + b"\0")
        if f.exists():
            h.update(f.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def legacy_tape_digest(src: Path) -> str:
    """What harvest recorded for tapes before 2026-09-12: the header alone."""
    from .bundle import sha256_file
    return sha256_file(src / "header.json")


def tape_incomplete(src: Path) -> str | None:
    """Why this tape must not be bundled yet, or None when it is whole.

    The writer appends to `frames.jsonl` per frame and rewrites
    `trailer.json` per chunk, so while a run is on, the two disagree (spectre's
    chi6 read 1,036 in the index against 1,035 in the trailer). No trailer at
    all is a writer that never finished.
    """
    tp = src / "trailer.json"
    if not tp.exists():
        return "no trailer.json: the writer has not finished"
    try:
        frames = int(json.loads(tp.read_text())["frames"])
    except (ValueError, KeyError, TypeError) as e:
        return f"trailer.json unreadable ({type(e).__name__})"
    ip = src / "frames.jsonl"
    n = 0
    if ip.exists():
        with open(ip) as f:
            for line in f:
                if line.endswith("\n") and line.strip():
                    n += 1
    if n != frames:
        return f"trailer says {frames} frames, index has {n}: still being written"
    return None


def source_digest(kind: str, src: Path) -> str:
    from .bundle import sha256_file
    if kind == "tape":
        return tape_digest(src)
    return sha256_file(src)


def _bundler(kind: str):
    from . import bundle
    return {"tape": bundle.bundle_tape, "clip": bundle.bundle_video,
            "master": bundle.bundle_video, "still": bundle.bundle_still,
            "figure": bundle.bundle_still}[kind]


DIRTY = "refused: the tree has uncommitted changes to tracked files"


def dirty_message(tree: Tree, paths: list[str]) -> str:
    shown = ", ".join(paths[:8]) + (f" and {len(paths) - 8} more" if len(paths) > 8 else "")
    return (f"{tree.name}: {tree.root} has uncommitted changes to tracked files "
            f"({shown}). A bundle records the commit it was made at, and that "
            "commit would not describe this code. Commit (or stash) them and "
            "harvest again, or pass --allow-dirty to bundle anyway and record "
            "the commit as -dirty. Untracked files and orchard.yaml do not count.")


def artefact_commit(tree: Tree, src: Path) -> str:
    """The commit an artefact was made at, as far as git can say.

    A source git tracks, and that has no uncommitted change of its own,
    was made at the commit that last touched it. Anything else (a
    gitignored result, the usual case) gets the tree's HEAD, `-dirty` when
    the tree is.
    """
    from .bundle import _git_describe, last_commit, tracked_changes
    last = last_commit(tree.root, src)
    if last and not tracked_changes(tree.root, src):
        return last
    return _git_describe(tree.root)


def harvest(name: str, *, only=None, out_root=None, dry_run: bool = False,
            force: bool = False, allow_dirty: bool = False,
            verbose: bool = True) -> list[dict]:
    """Bundle the tree's artefacts; returns one report row per artefact.

    A row refused because the tree is dirty has `status == DIRTY`, on a dry
    run too, and carries `dirty`, the paths.
    """
    from .bundle import tracked_changes
    from .portfolio import get
    tree = get(name)
    path = manifest_path(tree)
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    rows, changed = [], False
    dirty: list[str] | None = None          # asked once, when first needed
    for art in tree.artefacts:
        row = {"kind": art.kind, "path": art.path, "title": art.title, "bundle": art.bundle}
        if art.kind not in BUNDLED_KINDS or (only and art.kind not in only):
            row["status"] = "skipped" if art.kind in BUNDLED_KINDS else "no bundler"
            rows.append(row)
            continue
        src = resolve_source(tree, art)
        if src is None:
            row["status"] = "missing"
            rows.append(row)
            continue
        if art.kind == "tape" and (why := tape_incomplete(src)):
            row["status"] = f"refused: {why}"
            rows.append(row)
            continue
        digest = source_digest(art.kind, src)
        have = out_root / art.bundle if art.bundle else None
        if not force and art.bundle and have and have.is_dir():
            if art.sha256 == digest:
                row["status"] = "current"
                rows.append(row)
                continue
            if art.kind == "tape" and art.sha256 == legacy_tape_digest(src):
                if not dry_run:
                    art.sha256, changed = digest, True
                row["status"] = "current"
                row["note"] = "digest upgraded from header-only"
                rows.append(row)
                continue
        if dirty is None:
            dirty = tracked_changes(tree.root) or []
        if dirty and not allow_dirty:
            row.update({"status": DIRTY, "dirty": dirty})
            rows.append(row)
            continue
        if dry_run:
            row["status"] = "would bundle"
            rows.append(row)
            continue
        t0 = time.perf_counter()
        if verbose:
            print(f"harvest {name}: {art.kind} {art.path}", flush=True)
        # The tree's own commit survives unless the bytes moved under it; it
        # goes into the bundle too, so bundle.json and the manifest agree.
        if not art.commit or (art.sha256 and art.sha256 != digest):
            commit = artefact_commit(tree, src)
        else:
            commit = art.commit
        dest = _bundler(art.kind)(src, tree=name, title=art.title or src.name,
                                  out_root=out_root, verbose=verbose, commit=commit)
        art.commit, art.bundle, art.sha256 = commit, dest.name, digest
        changed = True
        row.update({"status": "bundled", "bundle": dest.name,
                    "seconds": round(time.perf_counter() - t0, 1)})
        rows.append(row)
    if changed and not dry_run:
        dump(tree, path)
        if verbose:
            print(f"wrote {path}", flush=True)
    return rows
