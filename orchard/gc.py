"""Cleanup of superseded bundles, on disk and in R2. A dry run unless `--apply`.

    uv run orchard bundle gc                 # results/bundles/<id> nothing references
    uv run orchard bundle gc --r2            # <id>/ prefixes in weichseltree-media, likewise
    uv run orchard bundle gc [--r2] --apply  # and delete them

Every bundle's id covers its bytes, so a re-encode or a re-harvest leaves the
old bundle behind under its own address. A bundle is LIVE when anything that
can make a visitor or a session fetch it names its id:

- any tree manifest, the repo's `orchard.yaml` and the fund's copy, every
  tree: the `bundle` field of every artefact, and the id mentioned anywhere
  else in the file (a note, a thesis);
- `grove/src/world/mansion.json`, a hanging's pinned `bundle.id` and its
  `exhibit.bundle`, in this checkout and in every worktree of it (a session's
  new pin is there before it reaches main);
- the live `exhibit` table: the id in every row's `url`, `thumb_url` and
  `tape_url`.

If any of these cannot be read, gc refuses rather than guessing: a guess here
deletes something published. A bundle younger than `--min-age-hours`
(default 24) is kept even when unreferenced, because a harvest writes the
bundle before the manifest names it, and `exhibit hang` pushes before the
table names it. Anything not named like a bundle id is left alone.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

from . import RESULTS, ROOT, WEICHSELTREE

ID = re.compile(r"^[0-9a-f]{16}$")
#: A 16-hex token standing alone: not a slice of a 64-hex sha256.
TOKEN = re.compile(r"(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])")
URL_ID = re.compile(r"/([0-9a-f]{16})/")
MANSION = Path("grove/src/world/mansion.json")
MIN_AGE_HOURS = 24.0


class GcRefused(RuntimeError):
    """A reference source could not be read; nothing is decided without it."""


def _add(live: dict, bid: str, why: str) -> None:
    live.setdefault(bid, [])
    if why not in live[bid]:
        live[bid].append(why)


def manifest_refs(live: dict) -> int:
    """Every 16-hex token in every fund copy and every repo's orchard.yaml."""
    import yaml

    from .portfolio import CANONICAL, tree_files
    files = []
    for fund in tree_files():
        files.append(fund)
        try:
            root = Path(str(yaml.safe_load(fund.read_text())["path"])).expanduser()
        except Exception:                                         # noqa: BLE001
            root = WEICHSELTREE / fund.stem
        if (root / CANONICAL).exists():
            files.append(root / CANONICAL)
    for f in files:
        try:
            text = f.read_text()
        except OSError as exc:
            raise GcRefused(f"cannot read the manifest {f}: {exc}") from exc
        for bid in TOKEN.findall(text):
            _add(live, bid, f"manifest {f}")
    return len(files)


def _worktrees() -> list[Path]:
    """This checkout and every worktree of its repository."""
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "worktree", "list", "--porcelain"],
                             capture_output=True, text=True, timeout=30)
        paths = [Path(line[len("worktree "):]) for line in out.stdout.splitlines()
                 if line.startswith("worktree ")] if not out.returncode else []
    except Exception:                                             # noqa: BLE001
        paths = []
    return [ROOT] + [p for p in paths if p.resolve() != ROOT.resolve()]


def mansion_refs(live: dict, mansion: Path | None = None) -> int:
    """The pinned ids of every hanging, from each worktree's mansion.json."""
    paths = [mansion] if mansion else [w / MANSION for w in _worktrees()]
    if not paths[0].exists():
        raise GcRefused(f"{paths[0]} is missing; its pinned bundle ids are unknown")
    n = 0
    for path in paths:
        if not path.exists():
            continue                          # another worktree without a grove
        try:
            doc = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise GcRefused(f"cannot read {path}: {exc}") from exc
        n += 1

        def walk(x):
            if isinstance(x, dict):
                ref = x.get("bundle")
                if isinstance(ref, dict):
                    for bid in (ref.get("id"), (ref.get("exhibit") or {}).get("bundle")):
                        if isinstance(bid, str) and ID.match(bid):
                            _add(live, bid, f"pinned in {path}")
                            for inner in nested_refs(bid):
                                _add(live, inner, f"named by pinned bundle {bid}")
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(doc)
    return n


def nested_refs(bid: str, root: Path | None = None) -> list[str]:
    """Bundle ids a local bundle names inside itself: a planet's atlas videos.

    A planet hanging pins one id; the video bundles that texture it are named
    in that bundle's `atlases`, so they are live for as long as it is. Read
    from the local copy when there is one; a bundle only in the bucket keeps
    its atlases alive by the same rule once it is pulled back.
    """
    root = Path(root) if root else RESULTS / "bundles"
    doc_path = root / bid / "bundle.json"
    if not doc_path.is_file():
        return []
    try:
        doc = json.loads(doc_path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for row in (doc.get("atlases") or {}).values():
        inner = row.get("bundle") if isinstance(row, dict) else None
        if isinstance(inner, str) and ID.match(inner):
            out.append(inner)
    return out


def exhibit_refs(live: dict, rows=None) -> int:
    """The ids the live `exhibit` table serves. Unreachable is a refusal."""
    if rows is None:
        from .sync import sql
        try:
            rows = sql("select id, tree, kind, url, thumb_url, tape_url from exhibit")
        except (RuntimeError, OSError, ValueError, SystemExit,
                subprocess.SubprocessError) as exc:
            raise GcRefused(f"the live exhibit table is unreachable ({exc}); gc will "
                            "not guess which bundles are hung") from exc
    for r in rows:
        for key in ("url", "thumb_url", "tape_url"):
            for bid in URL_ID.findall(str(r.get(key) or "")):
                _add(live, bid, f"exhibit {r.get('id')} ({r.get('tree')}, {r.get('kind')})")
    return len(rows)


def live_ids(*, mansion: Path | None = None, exhibit_rows=None) -> tuple[dict, dict]:
    """(id -> reasons, counts per source). Raises GcRefused when a source is unreadable."""
    live: dict[str, list[str]] = {}
    counts = {"manifests": manifest_refs(live),
              "mansion.json": mansion_refs(live, mansion),
              "exhibit rows": exhibit_refs(live, exhibit_rows)}
    return live, counts


def _dir_bytes(d: Path) -> int:
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file())


def local_plan(root: Path, live: dict, min_age_hours=MIN_AGE_HOURS, now=None) -> dict:
    """Which `root/<id>` directories are live, young, or garbage."""
    now = now or time.time()
    plan = {"root": str(root), "live": [], "young": [], "garbage": [], "ignored": []}
    for d in sorted(Path(root).iterdir()) if Path(root).is_dir() else []:
        if not d.is_dir() or not ID.match(d.name):
            plan["ignored"].append(d.name)
            continue
        stamp = (d / "bundle.json") if (d / "bundle.json").exists() else d
        row = {"id": d.name, "bytes": _dir_bytes(d),
               "age_hours": round((now - stamp.stat().st_mtime) / 3600, 1)}
        if d.name in live:
            plan["live"].append(row)
        elif row["age_hours"] < min_age_hours:
            plan["young"].append(row)
        else:
            plan["garbage"].append(row)
    return plan


def _age_hours(last_modified: str, now: float) -> float:
    t = datetime.fromisoformat(last_modified.replace("Z", "+00:00")).timestamp()
    return round((now - t) / 3600, 1)


def r2_plan(cf, live: dict, bucket: str, min_age_hours=MIN_AGE_HOURS, now=None) -> dict:
    """The same split over the bucket's `<id>/` prefixes, from one listing."""
    now = now or time.time()
    objects, _ = cf.list_objects(bucket=bucket)
    groups: dict[str, list[dict]] = {}
    loose = []
    for o in objects:
        top, sep, _rest = o["key"].partition("/")
        (groups.setdefault(top, []) if sep else loose).append(o)
    plan = {"bucket": bucket, "live": [], "young": [], "garbage": [],
            "ignored": sorted(k for k in groups if not ID.match(k)) + [o["key"] for o in loose]}
    for bid, objs in sorted(groups.items()):
        if not ID.match(bid):
            continue
        row = {"id": bid, "bytes": sum(int(o.get("size", 0)) for o in objs),
               "objects": len(objs),
               "age_hours": min(_age_hours(o["last_modified"], now) for o in objs),
               "keys": [o["key"] for o in objs]}
        if bid in live:
            plan["live"].append(row)
        elif row["age_hours"] < min_age_hours:
            plan["young"].append(row)
        else:
            plan["garbage"].append(row)
    return plan


def delete_local(plan: dict, verbose=True) -> int:
    n = 0
    for row in plan["garbage"]:
        shutil.rmtree(Path(plan["root"]) / row["id"])
        n += 1
        if verbose:
            print(f"  deleted {row['id']}", flush=True)
    return n


def delete_r2(cf, plan: dict, verbose=True) -> int:
    """Index first, then bundle.json, then the rest: an interrupted delete must
    not leave an index that tells the next push the objects are still there,
    nor a bundle.json naming objects that are gone."""
    from .push import INDEX_KEY
    n = 0
    for row in plan["garbage"]:
        first = [f"{row['id']}/{INDEX_KEY}", f"{row['id']}/bundle.json"]
        keys = [k for k in first if k in row["keys"]] + \
               [k for k in row["keys"] if k not in first]
        for k in keys:
            cf.delete_object(k, plan["bucket"])
        n += 1
        if verbose:
            print(f"  deleted {row['id']}/ ({len(keys)} objects)", flush=True)
    return n


def gc(*, r2: bool = False, apply: bool = False, root=None, bucket=None,
       min_age_hours: float = MIN_AGE_HOURS, cf=None, mansion=None,
       exhibit_rows=None, verbose=True) -> dict:
    """Find (and with `apply`, delete) bundles nothing references."""
    live, counts = live_ids(mansion=mansion, exhibit_rows=exhibit_rows)
    if r2:
        from .push import BUCKET, CF
        own = cf is None
        cf = cf or CF()
        try:
            plan = r2_plan(cf, live, bucket or BUCKET, min_age_hours)
            deleted = delete_r2(cf, plan, verbose) if apply else 0
        finally:
            if own:
                cf.close()
    else:
        plan = local_plan(Path(root) if root else RESULTS / "bundles", live, min_age_hours)
        deleted = delete_local(plan, verbose) if apply else 0
    for row in plan["garbage"] + plan["young"] + plan["live"]:
        row.pop("keys", None)
    return {"mode": "r2" if r2 else "local", "apply": apply, "live_ids": len(live),
            "sources": counts, "deleted": deleted, **plan,
            "reasons": {r["id"]: live[r["id"]] for r in plan["live"]}}
