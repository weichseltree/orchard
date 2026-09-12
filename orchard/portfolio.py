"""The portfolio: every tree the fund knows about.

Resolution: `<tree.path>/orchard.yaml` if the repo carries one, else
`trees/<name>.yaml` here. Both may exist; the repo's is canonical.

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

from . import TREES
from .manifest import Tree, load

BROKEN: dict[str, str] = {}      # manifest path -> why it was skipped, last load_all


def tree_files() -> list[Path]:
    return sorted(TREES.glob("*.yaml"))


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
