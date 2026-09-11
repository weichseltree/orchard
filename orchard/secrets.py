"""Secrets: one env file outside the repo, one registry inside it.

    ~/.config/orchard/secrets.env      the values (override: $ORCHARD_SECRETS)
    ~/.config/ptstudio/secrets.env     legacy fallback, still read by spectre, phototroph, expdash
    services.yaml                      which variables each service needs

Values never reach logs or the dashboard; `status()` reports names only.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml

from . import ROOT

PATHS = [
    Path(os.environ["ORCHARD_SECRETS"]) if os.environ.get("ORCHARD_SECRETS") else None,
    Path.home() / ".config/orchard/secrets.env",
    Path.home() / ".config/ptstudio/secrets.env",
]


def _parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if v:
            out[k.strip()] = v
    return out


@lru_cache(maxsize=1)
def load() -> dict[str, str]:
    """Merged view, first file wins per key; the process environment wins over all."""
    merged: dict[str, str] = {}
    for p in reversed([p for p in PATHS if p and p.exists()]):
        merged.update(_parse(p))
    for k in list(merged):
        if os.environ.get(k):
            merged[k] = os.environ[k]
    return merged


def get(name: str, default: str | None = None) -> str | None:
    return load().get(name, os.environ.get(name, default))


def require(name: str) -> str:
    v = get(name)
    if not v:
        raise KeyError(f"{name} is not set; add it to ~/.config/orchard/secrets.env (see secrets.example.env)")
    return v


def registry() -> dict:
    with open(ROOT / "services.yaml") as f:
        return yaml.safe_load(f)["services"]


def status() -> list[tuple[str, str, list[str], list[str]]]:
    """(service, kind, present vars, missing vars). Names only, never values."""
    have = load()
    rows = []
    for name, svc in registry().items():
        env = svc.get("env") or []
        present = [k for k in env if have.get(k)]
        rows.append((name, svc.get("kind", ""), present, [k for k in env if k not in present]))
    return rows
