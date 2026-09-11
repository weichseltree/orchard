"""Push the fund's public state into the live SpacetimeDB database.

The home box only ever connects outward. This is the first outward push: the
`tree` table (what a visitor may know about a tree) from `trees/*.yaml`, and
a ledger snapshot for the greenhouse. It shells out to the `spacetime` CLI so
the owner's login token is the identity (admin on the module).

    python -m orchard.sync trees      # upsert every tree
    python -m orchard.sync snapshot   # putSnapshot("ledger", ...)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import ROOT
from .manifest import Stage

DB = os.environ.get("ORCHARD_DB", "orchard")
SPACETIME_DIR = ROOT / "spacetime"


def _cli() -> str:
    exe = shutil.which("spacetime") or str(Path.home() / ".local/bin/spacetime")
    if not Path(exe).exists():
        sys.exit("spacetime CLI not found")
    return exe


def call(reducer: str, *args) -> None:
    """spacetime call <db> <reducer> <json args...>; raises on failure."""
    cmd = [_cli(), "call", DB, reducer, *[json.dumps(a) for a in args]]
    r = subprocess.run(cmd, cwd=SPACETIME_DIR, capture_output=True, text=True, timeout=60)
    out = (r.stdout + r.stderr).replace("WARNING: This command is UNSTABLE and subject to breaking changes.", "").strip()
    if r.returncode != 0:
        raise RuntimeError(f"{reducer} failed: {out}")


PUBLIC_FROM = Stage.planted   # scout drafts never reach visitors


def sync_trees() -> tuple[int, int]:
    """Upsert planted trees; remove anything the database shows that is not planted here."""
    from .portfolio import load_all
    trees = load_all()
    order = list(Stage)
    public = [t for t in trees if order.index(t.furthest_stage()) >= order.index(PUBLIC_FROM)]
    for t in public:
        call("upsert_tree", t.name, t.question[:400], str(t.status), str(t.furthest_stage()), int(max(0, min(10, t.potential))))
    removed = 0
    for t in trees:
        if t not in public:
            call("remove_tree", t.name); removed += 1
    return len(public), removed


def sync_snapshot(days: int = 30) -> None:
    from .ledger import snapshot
    snap = snapshot(days=days)
    public = {
        "generated_at": snap["generated_at"],
        "n_jobs": snap["n_jobs"],
        "video_share": snap["video_share"],
        "spend_recent": [{k: s[k] for k in ("repo", "gpu_h", "cpu_h", "video_h", "n", "n_failed")} for s in snap["spend_recent"][:12]],
        "cards": [{k: c.get(k) for k in ("kind", "key", "label", "unit", "used", "limit", "percent")} for c in snap["cards"] if c["kind"] != "disk"],
    }
    call("put_snapshot", "ledger", json.dumps(public, default=str))


def main(argv=None):
    what = (argv or sys.argv[1:] or ["trees"])[0]
    if what == "trees":
        n, r = sync_trees(); print(f"upserted {n} planted trees into {DB}, removed {r} non-planted")
    elif what == "snapshot":
        sync_snapshot(); print(f"snapshot 'ledger' written to {DB}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
