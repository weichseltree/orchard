"""The portfolio: every tree the fund knows about.

Resolution: `<tree.path>/orchard.yaml` if the repo carries one, else
`trees/<name>.yaml` here. Both may exist; the repo's is canonical.
"""
from __future__ import annotations

from pathlib import Path

from . import TREES
from .manifest import Tree, load


def tree_files() -> list[Path]:
    return sorted(TREES.glob("*.yaml"))


def load_all() -> list[Tree]:
    trees = []
    for f in tree_files():
        t = load(f)
        canonical = t.root / "orchard.yaml"
        if canonical.exists():
            t = load(canonical)
        trees.append(t)
    return trees


def get(name: str) -> Tree:
    for t in load_all():
        if t.name == name:
            return t
    raise KeyError(name)
