"""`orchard scout`: look at a repo and draft a tree manifest.

The draft is a starting point for a human, never a registration: it reads the
README's first heading and paragraph, counts what the repo can already show,
detects the GPU framework from the lock files and imports, and pulls the
repo's own lane history from the ledger. Every field it cannot know is left
empty on purpose.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .manifest import Artefact, Status, Stage, Tree
from .ledger import load_jobs, spend

MEDIA = {"clip": ("*.mp4", "*.webm", "*.gif"), "still": ("*.png", "*.jpg"), "tape": ("header.json",)}
SKIP = ("/.git/", "/.venv/", "/node_modules/", "/__pycache__/", "/.claude/", "/docs/references/")


def _git(path: Path, *args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def _readme(path: Path) -> tuple[str, str]:
    for name in ("README.md", "readme.md", "README"):
        f = path / name
        if f.exists():
            text = f.read_text(errors="replace")
            title = next((l.lstrip("# ").strip() for l in text.splitlines() if l.startswith("# ")), path.name)
            paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip() and not p.lstrip().startswith(("#", "!", "|", ">", "```"))]
            first = re.sub(r"\s+", " ", paras[0])[:400] if paras else ""
            return title, first
    return path.name, ""


def _gpu(path: Path) -> str:
    text = ""
    for f in ("pyproject.toml", "requirements.txt", "uv.lock", "environment.yml", "Cargo.toml"):
        p = path / f
        if p.exists():
            text += p.read_text(errors="replace")[:200_000].lower()
    for key in ("mitsuba", "jax", "torch", "taichi", "warp-lang", "numba"):
        if key in text:
            return key
    return "none"


def _status(path: Path) -> tuple[Status, str]:
    last = _git(path, "log", "-1", "--format=%cs")
    readme = (path / "README.md").read_text(errors="replace")[:600].lower() if (path / "README.md").exists() else ""
    if "archived" in readme:
        return Status.archived, last
    if "dormant" in readme:
        return Status.dormant, last
    return Status.active, last


def _artefacts(path: Path, limit: int = 12) -> list[Artefact]:
    found: list[tuple[float, Artefact]] = []
    for kind, pats in MEDIA.items():
        for pat in pats:
            for f in path.rglob(pat):
                s = str(f)
                if any(k in s for k in SKIP):
                    continue
                try:
                    st = f.stat()
                except OSError:
                    continue
                if kind == "still" and st.st_size < 20_000:
                    continue
                found.append((st.st_mtime, Artefact(kind=kind, path=str(f.relative_to(path)), title=f.stem)))
    found.sort(key=lambda x: -x[0])
    return [a for _, a in found[:limit]]


def draft(path: Path, jobs=None) -> Tree:
    path = path.expanduser().resolve()
    title, first = _readme(path)
    status, last = _status(path)
    remote = _git(path, "remote", "get-url", "origin")
    counts = {k: 0 for k in MEDIA}
    for kind, pats in MEDIA.items():
        for pat in pats:
            counts[kind] += sum(1 for f in path.rglob(pat) if not any(k in str(f) for k in SKIP))
    jobs = jobs if jobs is not None else load_jobs()
    mine = [s for s in spend(jobs) if s.repo == path.name]
    lane_note = ""
    if mine:
        s = mine[0]
        lane_note = f"ledger: {s.gpu_h:.1f} gpu-h, {s.cpu_h:.1f} cpu-h, {s.video_h:.1f} h on video, {s.n} jobs, {s.n_failed} failed"
    return Tree(
        name=path.name,
        path=str(path),
        remote=remote,
        question=first or f"({title}: no README paragraph found)",
        status=status,
        stage=Stage.scouted,
        gpu=_gpu(path),
        artefacts=_artefacts(path),
        notes=" | ".join(x for x in [f"last commit {last}" if last else "", f"media on disk: {counts}", lane_note] if x),
    )
