"""orchard <verb>. Verbs are the orchard's: scout, plant, board, ledger, doctor, serve."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import TREES, WEICHSELTREE
from .manifest import Stage, dump, load


def _table(rows, hdr):
    rows = [[str(x) for x in r] for r in rows]
    w = [max(len(x) for x in col) for col in zip(hdr, *rows)] if rows else [len(h) for h in hdr]
    line = lambda r: "  ".join(x.ljust(w[i]) for i, x in enumerate(r))
    print(line(hdr)); print(line(["-" * x for x in w]))
    for r in rows: print(line(r))


def cmd_scout(a):
    from .scout import draft
    from .ledger import load_jobs
    jobs = load_jobs()
    paths = [Path(p) for p in a.repo] if a.repo else sorted(p for p in WEICHSELTREE.iterdir() if (p / ".git").exists())
    for p in paths:
        t = draft(p, jobs)
        out = TREES / f"{t.name}.yaml"
        if out.exists() and not a.force:
            print(f"skip {t.name}: {out.relative_to(TREES.parent)} exists (use --force)")
            continue
        dump(t, out)
        print(f"drafted {out.relative_to(TREES.parent)}  [{t.status}] {t.gpu}  {t.question[:70]}")


def cmd_plant(a):
    """Copy the fund's manifest into the repo root as orchard.yaml (registration)."""
    t = load(TREES / f"{a.name}.yaml")
    dst = t.root / "orchard.yaml"
    if dst.exists() and not a.force:
        sys.exit(f"{dst} exists; use --force to overwrite")
    t.stage = max(t.stage, Stage.planted, key=list(Stage).index)
    dump(t, dst)
    dump(t, TREES / f"{a.name}.yaml")
    print(f"planted {t.name} -> {dst}")


def cmd_board(a):
    from .portfolio import load_all
    from .ledger import load_jobs, spend
    trees = load_all()
    recent = {s.repo: s for s in spend(load_jobs(), since=time.time() - 30 * 86400)}
    rows = []
    for t in sorted(trees, key=lambda t: (-t.potential, t.name)):
        s = recent.get(t.name)
        rows.append([t.name, t.status, t.furthest_stage(), t.potential or "", len(t.theses), len(t.phenomena),
                     f"{s.gpu_h:.1f}" if s else "0", f"{s.video_h:.1f}" if s else "0",
                     f"{t.budget.gpu_h:g}" if t.budget.gpu_h else "ask", t.question[:60]])
    _table(rows, ["tree", "status", "stage", "pot", "theses", "phen", "gpu_h_30d", "video_h_30d", "gpu_budget", "question"])


def cmd_ledger(a):
    from .ledger import snapshot
    snap = snapshot(days=a.days)
    if a.json:
        print(json.dumps(snap, indent=1, default=str)); return
    print(f"{snap['n_jobs']} jobs; expdash {'reachable' if snap['expdash_reachable'] else 'NOT reachable'}")
    vs = snap["video_share"]
    print(f"lane-hours total {vs['total_h']:.0f}, on video {vs['video_h']:.0f} ({100*vs['video_h']/max(vs['total_h'],1):.0f}%)\n")
    print(f"== spend, last {a.days} days ==")
    _table([[s['repo'], f"{s['gpu_h']:.1f}", f"{s['cpu_h']:.1f}", f"{s['none_h']:.1f}", f"{s['video_h']:.1f}", s['n'], s['n_failed'], f"{s['wait_h']:.0f}"]
            for s in snap["spend_recent"][:15]], ["repo", "gpu_h", "cpu_h", "exprun_h", "video_h", "n", "failed", "wait_h"])
    print("\n== GPU queue wait by EXP_PRIO tier ==")
    _table([[t, v['n'], f"{v['median_min']:.0f}", f"{v['p90_h']:.1f}", f"{v['max_h']:.1f}", f"{v['total_h']:.0f}"]
            for t, v in sorted(snap["queue_wait"].items())], ["tier", "n", "median_min", "p90_h", "max_h", "total_h"])
    print("\n== GPU timing taint ==", snap["taint"])
    if snap["cards"]:
        print("\n== quota and credit cards (from expdash) ==")
        _table([[c.get('label'), c.get('used'), c.get('limit'), c.get('unit'), f"{(c.get('percent') or 0):.0f}%", (c.get('note') or '')[:50]]
                for c in snap["cards"] if c["kind"] != "disk"], ["card", "used", "limit", "unit", "pct", "note"])
    if snap["api_usage"]:
        print("\n== API usage log ==")
        _table([[k, v['calls'], f"{v['units']:.0f}", f"{v['cost_usd']:.2f}", json.dumps(v['tags'])[:60]] for k, v in snap["api_usage"].items()],
               ["service", "calls", "units", "usd", "tags"])


def cmd_doctor(a):
    import shutil
    from .ledger import expdash_status
    checks = [
        ("expdash /api/status", expdash_status() is not None),
        ("~/.exp_status", (Path.home() / ".exp_status").is_dir()),
        ("spacetime CLI", shutil.which("spacetime") is not None),
        ("wrangler CLI", shutil.which("wrangler") is not None),
        ("ffmpeg", shutil.which("ffmpeg") is not None),
        ("blender", (Path.home() / "tools/blender/blender").exists()),
        ("trees/", TREES.is_dir() and any(TREES.glob("*.yaml"))),
    ]
    for name, ok in checks:
        print(("ok   " if ok else "MISS ") + name)
    from .secrets import status, PATHS
    print("\nsecrets file:", next((str(p) for p in PATHS if p and p.exists()), "none"))
    for svc, kind, present, missing in status():
        flag = "ok   " if not missing else ("part " if present else "MISS ")
        print(f"{flag}{svc:<20} {kind:<9} " + (f"missing {', '.join(missing)}" if missing else ""))


def cmd_serve(a):
    import uvicorn
    uvicorn.run("orchard.dashboard.app:app", host=a.host, port=a.port, reload=a.reload)


def main(argv=None):
    p = argparse.ArgumentParser(prog="orchard", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scout", help="draft tree manifests from repos"); s.add_argument("repo", nargs="*"); s.add_argument("--force", action="store_true"); s.set_defaults(fn=cmd_scout)
    s = sub.add_parser("plant", help="register: write orchard.yaml into the repo"); s.add_argument("name"); s.add_argument("--force", action="store_true"); s.set_defaults(fn=cmd_plant)
    s = sub.add_parser("board", help="the portfolio"); s.set_defaults(fn=cmd_board)
    s = sub.add_parser("ledger", help="capital spent and left"); s.add_argument("--days", type=int, default=30); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_ledger)
    s = sub.add_parser("doctor", help="what is wired up"); s.set_defaults(fn=cmd_doctor)
    s = sub.add_parser("serve", help="the flat dashboard"); s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8787); s.add_argument("--reload", action="store_true"); s.set_defaults(fn=cmd_serve)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
