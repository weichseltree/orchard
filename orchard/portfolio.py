"""The portfolio: every tree the fund knows about.

Resolution: `<tree.path>/orchard.yaml` if the repo carries one, else
`trees/<name>.yaml` here. Both may exist; the repo's is canonical.

THE FUND COPY IS A MIRROR. When the repo carries `orchard.yaml`, the fund's
`trees/<name>.yaml` is that file's bytes under one generated comment line,
regenerated every time orchard writes the canonical copy (`save`) and by
`orchard trees refresh`. It is what the portfolio falls back to when the repo
is not on disk, and it is never edited by hand. Before this, harvest, exhibit
and sync wrote only the copy they read, and the fund copies of einstruct,
spectre, phototroph and world-engine drifted from their repos. A tree whose
repo has no `orchard.yaml` (a scout draft) keeps its fund copy as the only
manifest, written in place as before.

A manifest that does not parse or validate is SKIPPED with one line on
stderr, and remembered in `BROKEN`, rather than raised: the trees edit their
own manifests in their own repos, and one torn write must not block every
other tree's harvest, board and sync (found 2026-09-12 when einstruct's
harvest died on phototroph's manifest mid-edit). A tree whose own manifest
is broken still fails, by name, in `get`.
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

from . import TREES, WEICHSELTREE
from .manifest import Tree, dump, load

BROKEN: dict[str, str] = {}      # manifest path -> why it was skipped, last load_all

CANONICAL = "orchard.yaml"
GENERATED = "# generated from {src} — edit that file, not this one\n"


def tree_files() -> list[Path]:
    return sorted(TREES.glob("*.yaml"))


def fund_path(name: str) -> Path:
    return TREES / f"{name}.yaml"


def canonical_path(tree: Tree) -> Path:
    return tree.root / CANONICAL


def manifest_path(tree: Tree) -> Path:
    """Where the tree's manifest lives: the repo's when it carries one."""
    canonical = canonical_path(tree)
    return canonical if canonical.exists() else fund_path(tree.name)


def mirror_bytes(canonical: Path) -> bytes:
    """The fund copy of a canonical manifest: one comment line, then its bytes."""
    return GENERATED.format(src=canonical).encode() + canonical.read_bytes()


def mirror(tree: Tree) -> bool:
    """Regenerate `trees/<name>.yaml` from the repo's `orchard.yaml`. True if it changed."""
    src, dst = canonical_path(tree), fund_path(tree.name)
    new = mirror_bytes(src)
    if dst.exists() and dst.read_bytes() == new:
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{dst.name}.tmp")
    tmp.write_bytes(new)
    tmp.replace(dst)
    return True


def save(tree: Tree) -> Path:
    """Write the tree's manifest where it lives and keep the fund copy in step.

    Every writer of a manifest goes through here (harvest, exhibit, sync's
    rulings, plant). Returns the path written.
    """
    path = manifest_path(tree)
    dump(tree, path)
    if path != fund_path(tree.name):
        mirror(tree)
    return path


def refresh(names=None) -> list[dict]:
    """Regenerate fund copies from every repo that carries `orchard.yaml`.

    One row per tree: `changed`, `unchanged`, or why nothing was written
    (`no repo`, `no orchard.yaml` — the fund copy is then the manifest —
    or the canonical copy does not load, which is never mirrored).
    """
    stems = list(names) if names else [p.stem for p in tree_files()]
    rows = []
    for name in stems:
        fund = fund_path(name)
        root = None
        if fund.exists():
            try:
                root = Path(str(yaml.safe_load(fund.read_text())["path"])).expanduser()
            except Exception:                                     # noqa: BLE001
                root = None
        root = root or WEICHSELTREE / name
        src = root / CANONICAL
        row = {"tree": name, "canonical": str(src), "fund": str(fund)}
        if not root.is_dir():
            row["status"] = "no repo"
        elif not src.exists():
            row["status"] = "no orchard.yaml"
        else:
            try:
                tree = load(src)
            except Exception as e:                                # noqa: BLE001
                row["status"] = f"unreadable: {type(e).__name__}"
            else:
                if tree.name != name:
                    row["status"] = f"canonical names itself {tree.name!r}"
                else:
                    row["status"] = "changed" if mirror(tree) else "unchanged"
        rows.append(row)
    return rows


def _try_load(path: Path) -> Tree | None:
    try:
        return load(path)
    except Exception as e:            # yaml.YAMLError, pydantic.ValidationError, OSError
        why = f"{type(e).__name__}: {str(e).splitlines()[0][:160]}"
        BROKEN[str(path)] = why
        print(f"orchard: skipping unreadable manifest {path}: {why}", file=sys.stderr)
        return None


def load_all() -> list[Tree]:
    BROKEN.clear()
    trees = []
    for f in tree_files():
        t = _try_load(f)
        if t is None:
            continue
        canonical = t.root / "orchard.yaml"
        if canonical.exists():
            t = _try_load(canonical)
            if t is None:
                continue
        trees.append(t)
    return trees


def get(name: str) -> Tree:
    for t in load_all():
        if t.name == name:
            return t
    for path, why in BROKEN.items():
        if Path(path).stem == name or Path(path).parent.name == name:
            raise KeyError(f"{name}: its manifest {path} is unreadable ({why})")
    raise KeyError(name)
