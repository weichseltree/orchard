"""Push the fund's public state into the live SpacetimeDB database.

The home box only ever connects outward. This is the first outward push: the
`tree` table (what a visitor may know about a tree) from `trees/*.yaml`, and
a ledger snapshot for the greenhouse. It shells out to the `spacetime` CLI so
the owner's login token is the identity (admin on the module).

    uv run orchard sync trees      # upsert every tree
    uv run orchard sync snapshot   # putSnapshot("ledger", ...)
    uv run orchard sync rulings    # rulings from the greenhouse back into the manifests
    uv run orchard sync all        # the three, in that order
    uv run orchard sync install    # a systemd user timer that runs `all` every 15 min

Rulings are the one thing that flows BACK: a review item names a tree and a
thesis, a ruling on it names a verdict, and the thesis's stage in the manifest
advances to what the ruling implies (an approved styleframe is `styleframe`,
an approved animatic `animatic`, `greenlit` is greenlit, an approved master
`mastered`). Stages only ever move forward here; a `changes` ruling writes its
note into the thesis's `blocked_by` instead.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from . import ROOT
from .manifest import Stage

DB = os.environ.get("ORCHARD_DB", "orchard")
SPACETIME_DIR = ROOT / "spacetime"
# For tests against a local server: which server, and which CLI config (whose
# login is that server's admin). Unset, the CLI's defaults: maincloud, ~/.config.
SERVER = os.environ.get("ORCHARD_SPACETIME_SERVER", "")
CLI_CONFIG = os.environ.get("ORCHARD_SPACETIME_CONFIG", "")


def _cli() -> str:
    from .toolchain import resolve                              # noqa: PLC0415
    exe = resolve("spacetime")
    if exe is None:
        sys.exit("spacetime CLI not found (orchard doctor)")
    return exe


def _command(sub: str) -> list[str]:
    """`spacetime [--config-path C] <sub> [-s S]`, with the test overrides applied."""
    cmd = [_cli()]
    if CLI_CONFIG:
        cmd += ["--config-path", CLI_CONFIG]
    cmd.append(sub)
    if SERVER:
        cmd += ["-s", SERVER]
    return cmd


def call(reducer: str, *args) -> None:
    """spacetime call <db> <reducer> <json args...>; raises on failure."""
    cmd = [*_command("call"), DB, reducer, *[json.dumps(a) for a in args]]
    r = subprocess.run(cmd, cwd=SPACETIME_DIR, capture_output=True, text=True, timeout=60)
    out = (r.stdout + r.stderr).replace("WARNING: This command is UNSTABLE and subject to breaking changes.", "").strip()
    if r.returncode != 0:
        raise RuntimeError(f"{reducer} failed: {out}")


def _timestamp(value):
    """A spacetime timestamp as the JSON output writes it: `[micros]`, `{...}` or a number."""
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict):
        value = next(iter(value.values()), None)
    return int(value) if isinstance(value, (int, float)) else None


def rows_from_sql_json(payload) -> list[dict]:
    """`spacetime sql --format json` output as a list of dicts, first statement only."""
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    names = [e["name"].get("some") if isinstance(e.get("name"), dict) else e.get("name")
             for e in payload.get("schema", {}).get("elements", [])]
    return [dict(zip(names, row)) for row in payload.get("rows", [])]


def sql(query: str) -> list[dict]:
    """A read over the database as the CLI identity (the owner: private tables included)."""
    cmd = [*_command("sql"), DB, query, "--format", "json"]
    r = subprocess.run(cmd, cwd=SPACETIME_DIR, capture_output=True, text=True, timeout=60)
    out = r.stdout.replace("WARNING: This command is UNSTABLE and subject to breaking changes.", "").strip()
    if r.returncode != 0:
        raise RuntimeError(f"sql failed: {(out + r.stderr).strip()}")
    return rows_from_sql_json(json.loads(out))


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


#: What a ruling on a review item of this kind means for the thesis's stage.
STAGE_FOR_APPROVED = {
    "styleframe": Stage.styleframe, "still": Stage.styleframe,
    "animatic": Stage.animatic, "cut": Stage.animatic,
    "master": Stage.mastered,
}


def stage_implied(kind: str, verdict: str) -> Stage | None:
    if verdict == "greenlit":
        return Stage.greenlit
    if verdict == "approved":
        return STAGE_FOR_APPROVED.get(kind)
    return None


def apply_rulings(trees, items: list[dict], rulings: list[dict]) -> list[dict]:
    """Pure: the manifests' theses after the rulings. Returns one row per change."""
    order = list(Stage)
    latest: dict[int, dict] = {}
    for r in sorted(rulings, key=lambda r: (_timestamp(r.get("at")) or 0, int(r["id"]))):
        latest[int(r["review_id"])] = r
    by_name = {t.name: t for t in trees}
    changes = []
    for item in items:
        ruling = latest.get(int(item["id"]))
        if not ruling:
            continue
        tree = by_name.get(item["tree"])
        thesis = next((th for th in tree.theses if th.id == item["thesis"]), None) if tree else None
        if thesis is None:
            changes.append({"tree": item["tree"], "thesis": item["thesis"], "status": "no such thesis",
                            "review_id": int(item["id"])})
            continue
        verdict, note = ruling["verdict"], (ruling.get("note") or "").strip()
        implied = stage_implied(item["kind"], verdict)
        row = {"tree": tree.name, "thesis": thesis.id, "review_id": int(item["id"]),
               "kind": item["kind"], "verdict": verdict, "status": "unchanged"}
        if implied and order.index(implied) > order.index(thesis.stage):
            row.update({"status": "advanced", "from": str(thesis.stage), "to": str(implied)})
            thesis.stage = implied
            if thesis.blocked_by:
                thesis.blocked_by = ""
        elif verdict in ("changes", "rejected"):
            text = f"{item['kind']} {verdict}" + (f": {note}" if note else "")
            if thesis.blocked_by != text:
                thesis.blocked_by = text
                row["status"] = "blocked_by written"
        changes.append(row)
    return changes


def sync_rulings() -> list[dict]:
    """Pull rulings into the manifests; writes each changed tree's manifest
    (the repo's, with the fund copy following it)."""
    from .portfolio import load_all, save
    trees = load_all()
    items = sql("select * from review_item")
    rulings = sql("select * from ruling")
    changes = apply_rulings(trees, items, rulings)
    touched = {c["tree"] for c in changes if c["status"] in ("advanced", "blocked_by written")}
    for t in trees:
        if t.name in touched:
            save(t)
    return changes


def sync_all() -> None:
    n, r = sync_trees(); print(f"upserted {n} planted trees into {DB}, removed {r} non-planted")
    sync_snapshot(); print(f"snapshot 'ledger' written to {DB}")
    ch = sync_rulings()
    moved = [c for c in ch if c["status"] != "unchanged"]
    print(f"rulings: {len(ch)} reviewed, {len(moved)} manifest changes")
    for c in moved:
        print("  ", c)


UNIT_DIR = Path.home() / ".config/systemd/user"
UNIT_SRC = ROOT / "deploy/systemd"


def install_service() -> None:
    """Copy orchard-sync.{service,timer} into the user's systemd and start the timer.

    Like expdash and lanesync, a systemd USER unit: `systemctl --user
    restart orchard-sync.timer`, never kill + nohup. The service runs `orchard
    sync all` once; the timer fires it every 15 minutes.
    """
    UNIT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("orchard-sync.service", "orchard-sync.timer"):
        text = (UNIT_SRC / name).read_text().replace("@ROOT@", str(ROOT)).replace("@HOME@", str(Path.home()))
        (UNIT_DIR / name).write_text(text)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", "orchard-sync.timer"], check=True)
    r = subprocess.run(["systemctl", "--user", "list-timers", "orchard-sync.timer", "--no-pager"],
                       capture_output=True, text=True)
    print(r.stdout.strip())


def main(argv=None):
    what = (argv or sys.argv[1:] or ["trees"])[0]
    if what == "trees":
        n, r = sync_trees(); print(f"upserted {n} planted trees into {DB}, removed {r} non-planted")
    elif what == "snapshot":
        sync_snapshot(); print(f"snapshot 'ledger' written to {DB}")
    elif what == "rulings":
        for c in sync_rulings():
            print(c)
    elif what == "all":
        sync_all()
    elif what == "install":
        install_service()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
