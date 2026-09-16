"""orchard <verb>. Verbs are the orchard's: scout, plant, board, bundle, harvest,
push, exhibit, sync, r2, ledger, doctor, audit, serve."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import RESULTS, TREES, WEICHSELTREE
from .manifest import Stage, dump, load
from .push import BUCKET, PUBLIC_HOST

# `orchard.bundle` pulls in numpy, so the two knobs its parser needs are named
# here and asserted against the module in tests/test_bundle.py rather than
# imported: every verb would otherwise pay for numpy.
SLOT_BUDGET, CHUNK_FRAMES = 4000, 60


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
        if (p / "orchard.yaml").exists():
            # planted: the fund copy mirrors the repo's, and a draft must not replace it
            print(f"skip {t.name}: planted, trees/{t.name}.yaml mirrors {p / 'orchard.yaml'}")
            continue
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
    from .portfolio import mirror
    dump(t, dst)
    mirror(t)                 # from now on the fund copy is generated from dst
    print(f"planted {t.name} -> {dst}")


def cmd_trees_refresh(a):
    from .portfolio import refresh
    rows = refresh(a.name or None)
    _table([[r["tree"], r["status"], r["canonical"]] for r in rows], ["tree", "status", "canonical"])
    changed = [r["tree"] for r in rows if r["status"] == "changed"]
    print(f"\n{len(changed)} fund cop{'y' if len(changed) == 1 else 'ies'} regenerated"
          + (f": {', '.join(changed)}" if changed else ""))


def cmd_board(a):
    from .portfolio import load_all
    from .ledger import load_jobs, spend
    trees = load_all()
    recent = {s.repo: s for s in spend(load_jobs(), since=time.time() - 30 * 86400)}
    rows = []
    for t in sorted(trees, key=lambda t: (-t.potential, t.name)):
        s = recent.get(t.name)
        bundled = sum(1 for x in t.artefacts if x.bundle)
        approved = sum(1 for x in t.artefacts if x.approved)
        rows.append([t.label, t.status, t.furthest_stage(), t.potential or "", len(t.theses), len(t.phenomena),
                     f"{bundled}/{len(t.artefacts)}" if t.artefacts else "", approved or "",
                     f"{s.gpu_h:.1f}" if s else "0", f"{s.video_h:.1f}" if s else "0",
                     f"{t.budget.gpu_h:g}" if t.budget.gpu_h else "ask", t.question[:60]])
    # bundled: artefacts `orchard harvest` has bundled; approved: rulings, what `exhibit hang` will take
    _table(rows, ["tree", "status", "stage", "pot", "theses", "phen", "bundled", "appr", "gpu_h_30d", "video_h_30d", "gpu_budget", "question"])


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
    from .ledger import expdash_status
    from .toolchain import report
    checks = [
        ("expdash /api/status", expdash_status() is not None),
        ("~/.exp_status", (Path.home() / ".exp_status").is_dir()),
        ("trees/", TREES.is_dir() and any(TREES.glob("*.yaml"))),
    ]
    for name, ok in checks:
        print(("ok   " if ok else "MISS ") + name)
    # every tool orchard shells out to, against the version orchard/toolchain.py expects
    print()
    _table([[p.name, p.status, p.version or "-", p.expected, p.path or "-"] for p in report()],
           ["tool", "status", "found", "expected", "path"])
    from .secrets import status, PATHS
    print("\nsecrets file:", next((str(p) for p in PATHS if p and p.exists()), "none"))
    for svc, kind, present, missing in status():
        flag = "ok   " if not missing else ("part " if present else "MISS ")
        print(f"{flag}{svc:<20} {kind:<9} " + (f"missing {', '.join(missing)}" if missing else ""))


def cmd_audit(a):
    from .audit import audit, render, write
    rep = audit(a.repo or None)
    if not a.repo:
        write(rep)                 # a partial run must not replace what the dashboard shows
    print(json.dumps(rep, indent=1) if a.json else render(rep, show_ok=a.all))
    sys.exit(1 if rep["summary"]["fail"] else 0)


def cmd_bundle_tape(a):
    from .bundle import bundle_tape
    out = bundle_tape(a.dir, tree=a.tree, title=a.title, out_root=a.out,
                      slot_budget=a.slot_budget, chunk_frames=a.chunk_frames)
    print(out)


def cmd_bundle_video(a):
    from .bundle import bundle_video
    out = bundle_video(a.mp4, tree=a.tree, title=a.title, out_root=a.out)
    print(out)


def cmd_bundle_planet(a):
    from .planet import bundle_planet
    atlases = {}
    for spec in a.atlas or []:
        mode, sep, bid = spec.partition("=")
        if not sep:
            raise SystemExit(f"--atlas wants mode=<video bundle id>, not {spec!r}")
        atlases[mode] = bid
    out = bundle_planet(a.delivery, tree=a.tree, title=a.title, out_root=a.out,
                        atlases=atlases or None)
    print(out)


def cmd_bundle_still(a):
    from .bundle import bundle_still
    out = bundle_still(a.image, tree=a.tree, title=a.title, out_root=a.out)
    print(out)


def cmd_bundle_audio(a):
    from .bundle import bundle_audio
    out = bundle_audio(a.tracks, score=a.score, tree=a.tree, title=a.title, out_root=a.out)
    print(out)


def cmd_bundle_verify(a):
    from .bundle import verify_bundle
    rep = verify_bundle(a.bundle_dir)
    print(json.dumps(rep, indent=1))
    sys.exit(0 if rep["ok"] else 1)


def cmd_bundle_gc(a):
    from .gc import GcRefused, gc
    try:
        rep = gc(r2=a.r2, apply=a.apply, root=a.root, bucket=a.bucket,
                 min_age_hours=a.min_age_hours)
    except GcRefused as exc:
        print(f"gc refused: {exc}", file=sys.stderr)
        sys.exit(2)
    if a.json:
        print(json.dumps(rep, indent=1)); return
    where = rep.get("bucket") or rep.get("root")
    mb = lambda rows: sum(r["bytes"] for r in rows) / 1e6
    print(f"live ids: {rep['live_ids']} (from {rep['sources']['manifests']} manifests, "
          f"{rep['sources']['mansion.json']} mansion.json, {rep['sources']['exhibit rows']} exhibit rows)")
    print(f"{where}: {len(rep['live'])} live ({mb(rep['live']):.1f} MB), "
          f"{len(rep['young'])} unreferenced but younger than {a.min_age_hours:g} h, "
          f"{len(rep['garbage'])} unreferenced ({mb(rep['garbage']):.1f} MB)")
    if rep["garbage"]:
        _table([[r["id"], f"{r['bytes'] / 1e6:.1f} MB", f"{r['age_hours']:g} h"] for r in rep["garbage"]],
               ["unreferenced", "size", "age"])
    if rep["young"]:
        print("kept for age: " + ", ".join(r["id"] for r in rep["young"]))
    if rep["ignored"]:
        print("not bundle ids, left alone: " + ", ".join(rep["ignored"]))
    print(f"deleted {rep['deleted']}" if a.apply else
          f"dry run: nothing deleted; --apply deletes the {len(rep['garbage'])} above")


def cmd_harvest(a):
    from .harvest import DIRTY, dirty_message, harvest
    from .portfolio import get
    rows = harvest(a.tree, only=a.only or None, out_root=a.out, dry_run=a.dry_run,
                   force=a.force, allow_dirty=a.allow_dirty)
    _table([[r["kind"], r["status"], r.get("bundle") or "-", r["path"]] for r in rows],
           ["kind", "status", "bundle", "path"])
    refused = next((r for r in rows if r["status"] == DIRTY), None)
    if refused:
        print("\n" + dirty_message(get(a.tree), refused["dirty"]), file=sys.stderr)
        sys.exit(1)


def cmd_exhibit_hang(a):
    from .exhibit import hang
    try:
        rep = hang(a.bundle_dir, approve=a.approve, push=a.push, dry_run=a.dry_run,
                   host=a.host, tree=a.tree, kind=a.kind, title=a.title)
    except PermissionError as exc:
        print(exc, file=sys.stderr)
        sys.exit(3)
    print(json.dumps(rep, indent=1, default=str))


def cmd_exhibit_list(a):
    from .exhibit import listing
    print(listing())


def cmd_exhibit_take_down(a):
    from .exhibit import take_down
    take_down(a.id)
    print(f"took down exhibit {a.id}")


def cmd_sync(a):
    from .sync import main as sync_main
    sync_main([a.what])


def cmd_push(a):
    from .push import R2NotEnabled, cors_preflight, push, refresh_headers, wait_public
    try:
        if a.refresh_headers:
            rep = refresh_headers(a.bundle_dir, bucket=a.bucket, dry_run=a.dry_run,
                                  force=a.force)
            if a.json:
                print(json.dumps(rep, indent=1))
            sys.exit(1 if rep["still_wrong"] else 0)
        rep = push(a.bundle_dir, bucket=a.bucket, method=a.method,
                   dry_run=a.dry_run, force=a.force, check=a.check)
    except R2NotEnabled as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)
    if a.verify and not a.dry_run:
        rep["public"] = wait_public(rep["id"], host=a.host,
                                    timeout_s=a.verify_timeout)
        rep["cors"] = cors_preflight(rep["id"], host=a.host)
        print("  cors:", json.dumps(rep["cors"]))
    if a.json:
        print(json.dumps(rep, indent=1))


def cmd_r2_ensure(a):
    from .push import R2NotEnabled, ensure_bucket
    try:
        ensure_bucket(a.bucket, domain=a.domain)
    except R2NotEnabled as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)


def cmd_r2_benchmark(a):
    from .push import benchmark, wrangler_spawn_cost
    print(f"wrangler process start-up: {wrangler_spawn_cost():.2f} s per call")
    print(json.dumps(benchmark(a.bundle_dir, bucket=a.bucket, n=a.n), indent=1))


def cmd_auth(a):
    from .auth import main as auth_main
    auth_main(a)


def cmd_serve(a):
    import uvicorn
    uvicorn.run("orchard.dashboard.app:app", host=a.host, port=a.port, reload=a.reload)


def main(argv=None):
    p = argparse.ArgumentParser(prog="orchard", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scout", help="draft tree manifests from repos"); s.add_argument("repo", nargs="*"); s.add_argument("--force", action="store_true"); s.set_defaults(fn=cmd_scout)
    s = sub.add_parser("plant", help="register: write orchard.yaml into the repo"); s.add_argument("name"); s.add_argument("--force", action="store_true"); s.set_defaults(fn=cmd_plant)
    s = sub.add_parser("board", help="the portfolio"); s.set_defaults(fn=cmd_board)
    s = sub.add_parser("trees", help="the fund's copies of the tree manifests")
    tsub = s.add_subparsers(dest="what", required=True)
    t = tsub.add_parser("refresh", help="regenerate trees/<name>.yaml from each repo's orchard.yaml")
    t.add_argument("name", nargs="*"); t.set_defaults(fn=cmd_trees_refresh)
    s = sub.add_parser("ledger", help="capital spent and left"); s.add_argument("--days", type=int, default=30); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_ledger)
    s = sub.add_parser("bundle", help="write a content-addressed bundle")
    bsub = s.add_subparsers(dest="what", required=True)
    b = bsub.add_parser("tape", help="a particle tape as chunked variants")
    b.add_argument("dir"); b.add_argument("--tree", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--out", default=str(RESULTS / "bundles"))
    b.add_argument("--slot-budget", type=int, default=SLOT_BUDGET,
                   help="slots the vr-high variant keeps (default %(default)s)")
    b.add_argument("--chunk-frames", type=int, default=CHUNK_FRAMES)
    b.set_defaults(fn=cmd_bundle_tape)
    b = bsub.add_parser("video", help="an mp4 as an HLS ladder")
    b.add_argument("mp4"); b.add_argument("--tree", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--out", default=str(RESULTS / "bundles"))
    b.set_defaults(fn=cmd_bundle_video)
    b = bsub.add_parser("planet", help="spectre's cutaway worlds: mesh, surface stream, legends")
    b.add_argument("delivery", help="a completed exhibit bake directory (manifest.json)")
    b.add_argument("--tree", required=True); b.add_argument("--title", required=True)
    b.add_argument("--atlas", action="append", metavar="MODE=ID",
                   help="video bundle id per atlas mode (default: the delivery's hls/index.json)")
    b.add_argument("--out", default=str(RESULTS / "bundles"))
    b.set_defaults(fn=cmd_bundle_planet)
    b = bsub.add_parser("still", help="an image as AVIF + JPEG at three widths")
    b.add_argument("image"); b.add_argument("--tree", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--out", default=str(RESULTS / "bundles"))
    b.set_defaults(fn=cmd_bundle_still)
    b = bsub.add_parser("audio", help="one or more .opus tracks plus the score that produced them")
    b.add_argument("tracks", nargs="+", help="one or more .opus files")
    b.add_argument("--score", required=True, help="the score.json recorded alongside the tracks")
    b.add_argument("--tree", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--out", default=str(RESULTS / "bundles"))
    b.set_defaults(fn=cmd_bundle_audio)
    b = bsub.add_parser("verify", help="id and every digest, no token needed")
    b.add_argument("bundle_dir"); b.set_defaults(fn=cmd_bundle_verify)
    b = bsub.add_parser("gc", help="bundles no manifest, mansion.json or exhibit names (dry run)")
    b.add_argument("--apply", action="store_true", help="delete them (default: only list)")
    b.add_argument("--r2", action="store_true", help="the bucket's <id>/ prefixes, not results/bundles")
    b.add_argument("--root", default=str(RESULTS / "bundles"), help="local bundles (default %(default)s)")
    b.add_argument("--bucket", default=BUCKET)
    b.add_argument("--min-age-hours", type=float, default=24.0,
                   help="keep unreferenced bundles younger than this (default %(default)s)")
    b.add_argument("--json", action="store_true")
    b.set_defaults(fn=cmd_bundle_gc)

    s = sub.add_parser("harvest", help="bundle a tree's artefacts and record the ids")
    s.add_argument("tree")
    s.add_argument("--only", action="append", choices=["tape", "clip", "master", "still", "figure"])
    s.add_argument("--out", default=str(RESULTS / "bundles"))
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--force", action="store_true", help="re-bundle even when current")
    s.add_argument("--allow-dirty", action="store_true",
                   help="bundle although tracked files have uncommitted changes; "
                        "the commit is recorded as <sha>-dirty")
    s.set_defaults(fn=cmd_harvest)

    s = sub.add_parser("exhibit", help="what hangs in the grove")
    esub = s.add_subparsers(dest="what", required=True)
    e = esub.add_parser("hang", help="push a bundle and name it to the database")
    e.add_argument("bundle_dir")
    e.add_argument("--approve", action="store_true", help="record the ruling in the manifest")
    e.add_argument("--no-push", dest="push", action="store_false")
    e.add_argument("--dry-run", action="store_true")
    e.add_argument("--host", default=PUBLIC_HOST)
    e.add_argument("--tree"); e.add_argument("--kind"); e.add_argument("--title")
    e.set_defaults(fn=cmd_exhibit_hang)
    e = esub.add_parser("list", help="the exhibit table"); e.set_defaults(fn=cmd_exhibit_list)
    e = esub.add_parser("take-down", help="remove an exhibit by id")
    e.add_argument("id", type=int); e.set_defaults(fn=cmd_exhibit_take_down)

    s = sub.add_parser("sync", help="the live database: push trees and the ledger, pull rulings")
    s.add_argument("what", choices=["trees", "snapshot", "rulings", "all", "install"])
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("push", help="upload a bundle to R2")
    s.add_argument("bundle_dir")
    s.add_argument("--bucket", default=BUCKET)
    s.add_argument("--host", default=PUBLIC_HOST)
    s.add_argument("--method", choices=["rest", "wrangler"], default="rest")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--force", action="store_true", help="ignore the push index")
    s.add_argument("--refresh-headers", action="store_true",
                   help="re-put an already-pushed bundle's objects whose Cache-Control "
                        "is missing or stale (same bytes; --dry-run lists them)")
    s.add_argument("--no-check", dest="check", action="store_false",
                   help="skip the digest checks on either side of the upload")
    s.add_argument("--no-verify", dest="verify", action="store_false",
                   help="do not fetch the pushed bundle.json over https")
    s.add_argument("--verify-timeout", type=int, default=300)
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_push)

    s = sub.add_parser("r2", help="the media bucket")
    rsub = s.add_subparsers(dest="what", required=True)
    r = rsub.add_parser("ensure", help="bucket, CORS and the custom domain")
    r.add_argument("--bucket", default=BUCKET)
    r.add_argument("--domain", default=PUBLIC_HOST)
    r.set_defaults(fn=cmd_r2_ensure)
    r = rsub.add_parser("benchmark", help="time REST against wrangler")
    r.add_argument("bundle_dir"); r.add_argument("--bucket", default=BUCKET)
    r.add_argument("-n", type=int, default=10)
    r.set_defaults(fn=cmd_r2_benchmark)

    s = sub.add_parser("auth", help="the grove's token service: keys, Pages secrets, the gate")
    asub = s.add_subparsers(dest="what", required=True)
    r = asub.add_parser("keygen", help="make AUTH_SIGNING_KEY and AUTH_NETWORK_KEY if missing")
    r.add_argument("--write", action="store_true", help="append them to the secrets file")
    asub.add_parser("turnstile", help="create the Turnstile widget and store its keys")
    asub.add_parser("push", help="send the token service's secrets to Cloudflare Pages")
    asub.add_parser("status", help="what the live token service answers, and the gate")
    r = asub.add_parser("gate", help="turn anonymous visitors away (on) or let them in (off)")
    r.add_argument("state", choices=["on", "off"])
    s.set_defaults(fn=cmd_auth)

    s = sub.add_parser("doctor", help="what is wired up"); s.set_defaults(fn=cmd_doctor)
    s = sub.add_parser("audit", help="PACKAGES.md's rules across every live repo (exit 1 on a failure)")
    s.add_argument("repo", nargs="*", help="only these repos (results/audit.json is then left alone)")
    s.add_argument("--json", action="store_true"); s.add_argument("--all", action="store_true", help="list the ok checks too")
    s.set_defaults(fn=cmd_audit)
    s = sub.add_parser("serve", help="the flat dashboard"); s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8787); s.add_argument("--reload", action="store_true"); s.set_defaults(fn=cmd_serve)
    a = p.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
