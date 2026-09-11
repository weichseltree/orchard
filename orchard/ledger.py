"""The capital ledger, read from what already exists.

Sources, all read-only:
  ~/.exp_status/**/*.json      every lane job ever recorded (root + archive/, peer mirror)
  ~/.exp_status/.api_usage.jsonl   API spend posted by expusage.py
  http://localhost:8686/api/status expdash: quota cards, credits, disk, health

Nothing here writes. The record schema is ~/expdash/explib/record.py; the
classification rules (lane from `lock`, box from `host`, repo from the log
path because `repo` is a worktree basename for agent sessions) were validated
against 2,953 records on 2026-09-11.
"""
from __future__ import annotations

import collections
import json
import os
import re
import statistics
import time
import urllib.request
from dataclasses import dataclass, field, asdict
from pathlib import Path

from . import EXP_STATUS, EXPDASH_URL

VIDEO_RE = re.compile(r"render|film|video|narrat|episode|studio|animatic|styleframe|vo-", re.I)
GPU_LOCKS = ("gpu0.lock", "gputest.lock")
REPO_PATH_RE = re.compile(r"/home/manuel/(?:weichseltree|kaggle|lanework/repos)/([^/]+)/")


@dataclass
class Job:
    id: str
    name: str
    repo: str
    box: str
    lane: str            # gpu | cpu | none | remote
    kind: str            # video | research
    status: str
    prio: int | None
    queued_at: int
    started_at: int | None
    ended_at: int | None
    exit_code: int | None
    duration_s: float
    wait_s: float
    failed: bool
    taint: str           # clean | contended | contended_invisibly | unknown
    session: str = ""
    log: str = ""
    sweep: str = ""


def _box(r: dict, path: Path) -> str:
    if r.get("host"):
        return r["host"]
    if path.name.startswith("Legion__"):
        return "Legion"
    if r.get("remote"):
        return "kaggle"
    return "SirBase"


def _lane(r: dict) -> str:
    lk = r.get("lock")
    if lk is None:
        return "remote"
    if lk == "":
        return "none"
    return "gpu" if os.path.basename(lk) in GPU_LOCKS else "cpu"


def _repo(r: dict) -> str:
    rp = r.get("repo") or ""
    if rp.startswith("/"):
        rp = os.path.basename(rp.rstrip("/"))
    m = REPO_PATH_RE.search(r.get("log") or "") or REPO_PATH_RE.search(r.get("cmd") or "")
    if m and (rp.startswith("agent-") or rp == "" or "worktree" in rp or rp.startswith("video-")):
        return m.group(1)
    return rp or "?"


def _taint(r: dict, lane: str) -> str:
    a, m = r.get("gpu_apps_start"), r.get("gpu_mem_start")
    if a is None:
        return "unknown"
    if a > 0:
        return "contended"
    if lane == "gpu" and (m or 0) > 2000:
        return "contended_invisibly"
    return "clean"


def load_jobs(root: Path = EXP_STATUS, now: float | None = None) -> list[Job]:
    now = now or time.time()
    jobs: list[Job] = []
    for f in root.rglob("*.json"):
        try:
            r = json.loads(f.read_text())
        except Exception:
            continue
        if not (isinstance(r, dict) and "id" in r and "queued_at" in r):
            continue
        lane = _lane(r)
        s, e = r.get("started_at"), r.get("ended_at")
        dur = max(0.0, (e or now) - s) if s else 0.0
        wait = max(0.0, (s or now) - r["queued_at"])
        cmd_clean = re.sub(r"--\S+", "", r.get("cmd", ""))
        kind = "video" if (VIDEO_RE.search(r.get("name", "")) or VIDEO_RE.search(cmd_clean)) else "research"
        failed = r.get("status") in ("crashed", "cancelled") or (r.get("exit_code") not in (0, None))
        jobs.append(Job(
            id=r["id"], name=r.get("name", ""), repo=_repo(r), box=_box(r, f), lane=lane, kind=kind,
            status=r.get("status", ""), prio=r.get("prio"), queued_at=r["queued_at"],
            started_at=s, ended_at=e, exit_code=r.get("exit_code"), duration_s=dur, wait_s=wait,
            failed=failed, taint=_taint(r, lane), session=r.get("session", ""),
            log=r.get("log", ""), sweep=r.get("sweep", ""),
        ))
    return jobs


@dataclass
class RepoSpend:
    repo: str
    gpu_h: float = 0
    cpu_h: float = 0
    none_h: float = 0
    video_h: float = 0
    n: int = 0
    n_failed: int = 0
    wait_h: float = 0


def spend(jobs: list[Job], since: float | None = None) -> list[RepoSpend]:
    agg: dict[str, RepoSpend] = {}
    for j in jobs:
        if since and (j.started_at or 0) < since:
            continue
        a = agg.setdefault(j.repo, RepoSpend(j.repo))
        h = j.duration_s / 3600
        if j.lane == "gpu":
            a.gpu_h += h
        elif j.lane == "cpu":
            a.cpu_h += h
        elif j.lane == "none":
            a.none_h += h
        if j.kind == "video":
            a.video_h += h
        a.n += 1
        a.n_failed += j.failed
        a.wait_h += j.wait_s / 3600
    return sorted(agg.values(), key=lambda s: -(s.gpu_h + s.cpu_h + s.none_h))


def queue_wait_by_tier(jobs: list[Job]) -> dict[str, dict]:
    def tier(p):
        if p is None: return "unset"
        if p >= 20: return "20+"
        if p >= 10: return "10-19"
        if p >= 5: return "5-9"
        if p >= 0: return "0-4"
        return "<0"
    by = collections.defaultdict(list)
    for j in jobs:
        if j.lane == "gpu" and j.started_at:
            by[tier(j.prio)].append(j.wait_s)
    out = {}
    for t, ws in by.items():
        ws.sort()
        out[t] = {"n": len(ws), "median_min": statistics.median(ws) / 60,
                  "p90_h": ws[int(0.9 * (len(ws) - 1))] / 3600, "max_h": ws[-1] / 3600,
                  "total_h": sum(ws) / 3600}
    return out


def api_usage(root: Path = EXP_STATUS) -> dict[str, dict]:
    """Per-service totals from the usage log expusage.py appends to."""
    f = root / ".api_usage.jsonl"
    out: dict[str, dict] = {}
    if not f.exists():
        return out
    for line in f.read_text().splitlines():
        try:
            r = json.loads(line)
        except Exception:
            continue
        svc = r.get("service", "?")
        a = out.setdefault(svc, {"calls": 0, "units": 0.0, "cost_usd": 0.0, "tags": collections.Counter()})
        a["calls"] += 1
        a["units"] += float(r.get("units") or 0)
        a["cost_usd"] += float(r.get("cost_usd") or 0)
        a["tags"][r.get("tag") or ""] += 1
    for a in out.values():
        a["tags"] = dict(a["tags"].most_common(6))
    return out


def expdash_status(url: str = EXPDASH_URL, timeout: float = 3.0) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/api/status", timeout=timeout) as resp:
            return json.load(resp)
    except Exception:
        return None


def quota_cards(status: dict | None) -> list[dict]:
    """The capital lines expdash already tracks: API quotas, credits, disk."""
    if not status:
        return []
    cards = []
    for a in status.get("apis") or []:
        cards.append({"kind": "api", "key": a.get("key"), "label": a.get("label"), "unit": a.get("unit"),
                      "used": a.get("used"), "limit": a.get("limit"), "percent": a.get("percent"),
                      "resets_at": a.get("resets_at"), "note": a.get("note")})
    for c in status.get("credits") or []:
        cards.append({"kind": "credit", "key": c.get("key"), "label": c.get("label"), "unit": c.get("unit"),
                      "used": c.get("used"), "limit": c.get("limit"), "percent": c.get("percent"),
                      "resets_at": c.get("resets_at"), "note": "left %.2f %s" % (c.get("left") or 0, c.get("unit") or "")})
    disk = status.get("disk") or {}
    if disk:
        cards.append({"kind": "disk", "key": "disk", "label": "Disk", "raw": disk})
    return cards


def snapshot(days: int = 30) -> dict:
    """Everything the dashboard needs, as one JSON-able dict."""
    now = time.time()
    jobs = load_jobs(now=now)
    st = expdash_status()
    return {
        "generated_at": now,
        "n_jobs": len(jobs),
        "span": [min((j.queued_at for j in jobs), default=None), max((j.queued_at for j in jobs), default=None)],
        "spend_all": [asdict(s) for s in spend(jobs)],
        "spend_recent": [asdict(s) for s in spend(jobs, since=now - days * 86400)],
        "queue_wait": queue_wait_by_tier(jobs),
        "taint": dict(collections.Counter(j.taint for j in jobs if j.lane == "gpu")),
        "video_share": {
            "video_h": sum(j.duration_s for j in jobs if j.kind == "video") / 3600,
            "total_h": sum(j.duration_s for j in jobs) / 3600,
        },
        "api_usage": api_usage(),
        "cards": quota_cards(st),
        "running": [asdict(j) for j in jobs if j.status in ("running", "queued")],
        "expdash_reachable": st is not None,
    }
