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

The manifest written is the one that was read: `<repo>/orchard.yaml` when the
tree carries one, else the fund's copy in `trees/`.
"""
from __future__ import annotations

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


def source_digest(kind: str, src: Path) -> str:
    from .bundle import sha256_file
    if kind == "tape":
        return sha256_file(src / "header.json")
    return sha256_file(src)


def _bundler(kind: str):
    from . import bundle
    return {"tape": bundle.bundle_tape, "clip": bundle.bundle_video,
            "master": bundle.bundle_video, "still": bundle.bundle_still,
            "figure": bundle.bundle_still}[kind]


def harvest(name: str, *, only=None, out_root=None, dry_run: bool = False,
            force: bool = False, verbose: bool = True) -> list[dict]:
    """Bundle the tree's artefacts; returns one report row per artefact."""
    from .bundle import _git_describe
    from .portfolio import get
    tree = get(name)
    path = manifest_path(tree)
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    rows, changed = [], False
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
        digest = source_digest(art.kind, src)
        have = out_root / art.bundle if art.bundle else None
        if not force and art.bundle and art.sha256 == digest and have and have.is_dir():
            row["status"] = "current"
            rows.append(row)
            continue
        if dry_run:
            row["status"] = "would bundle"
            rows.append(row)
            continue
        t0 = time.perf_counter()
        if verbose:
            print(f"harvest {name}: {art.kind} {art.path}", flush=True)
        dest = _bundler(art.kind)(src, tree=name, title=art.title or src.name,
                                  out_root=out_root, verbose=verbose)
        art.bundle, art.sha256 = dest.name, digest
        art.commit = _git_describe(tree.root)
        changed = True
        row.update({"status": "bundled", "bundle": dest.name,
                    "seconds": round(time.perf_counter() - t0, 1)})
        rows.append(row)
    if changed and not dry_run:
        dump(tree, path)
        if verbose:
            print(f"wrote {path}", flush=True)
    return rows
