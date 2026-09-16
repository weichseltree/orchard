"""The flat dashboard: what you look at while you work. Port 8787, local only.

The ledger, the portfolio and the audit are read from disk. The greenhouse panels (the
review queue, rulings, directives, exhibits) are read from the live database
through the `spacetime` CLI, whose login identity is the module's admin; the
same identity signs the rulings this page writes, and the moderation panel's
mutes, kicks and bans.

Local only, and nothing here logs in: the box is the boundary. Two things keep
a web page open in the same browser from reaching through it. Every request
must be addressed to localhost by name (a DNS-rebinding page arrives with its
own hostname in `Host`), and every write must carry `X-Orchard: 1`, which a
cross-site request cannot send without a CORS preflight this app never
answers. The page may not be framed, so nothing can trick a click on it.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..ledger import snapshot
from ..portfolio import load_all
from ..sync import _timestamp, call, sql
from ..render_stream import ClientCapabilities, RenderStreamHub, StreamDescriptor

app = FastAPI(title="orchard")
HERE = Path(__file__).parent

#: Hostnames this app answers to. ORCHARD_DASHBOARD_HOSTS adds more (comma-separated)
#: for anyone who deliberately serves it elsewhere.
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"} | {
    h.strip().lower() for h in os.environ.get("ORCHARD_DASHBOARD_HOSTS", "").split(",") if h.strip()
}
SAFE_METHODS = {"GET", "HEAD"}
IDENTITY = r"^0x[0-9a-f]{64}$"
#: The module's DEFAULT_ISSUER (spacetime/spacetimedb/src/index.ts).
DEFAULT_ISSUER = "https://www.weichseltree.com/auth"

# The dashboard is the local transport boundary. Producers may replace this
# hub in-process; clients always receive a descriptor even when no raw frame
# source is configured.
RENDER_STREAM = RenderStreamHub(
    stream=StreamDescriptor(
        stream_id="orchard-hybrid",
        correlation_id="orchard-hybrid-model",
        width=0,
        height=0,
        pixel_format="unknown",
        fps=0,
        transport="sse",
        raw_frames=False,
    )
)


def _hostname(value: str) -> str:
    """The name part of a Host or Origin: no scheme, no port, no IPv6 brackets."""
    netloc = value if "//" in value else f"//{value}"
    return (urlsplit(netloc).hostname or "").lower()


@app.middleware("http")
async def local_only(request: Request, call_next):
    if _hostname(request.headers.get("host", "")) not in LOCAL_HOSTS:
        return PlainTextResponse("orchard serve answers to localhost only", status_code=421)
    if request.method not in SAFE_METHODS:
        if request.headers.get("x-orchard") != "1":
            return PlainTextResponse("writes need the X-Orchard header", status_code=403)
        origin = request.headers.get("origin")
        if origin and _hostname(origin) not in LOCAL_HOSTS:
            return PlainTextResponse("wrong origin", status_code=403)
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/api/portfolio")
def api_portfolio():
    return JSONResponse([t.model_dump(mode="json") for t in load_all()])


@app.get("/api/ledger")
def api_ledger(days: int = 30):
    return JSONResponse(snapshot(days=days), headers={"Cache-Control": "no-store"})


@app.get("/api/render/stream")
def api_render_stream(raw_frames: bool = False, session_id: str | None = None):
    """Send the renderer model and correlated display stream over local SSE.

    ``raw_frames`` is a capability negotiation, not an authorization grant:
    the hub emits frames only when both the client and the configured stream
    support them. The existing localhost/Origin middleware remains in force.
    """
    capabilities = ClientCapabilities(raw_frames=raw_frames)
    return StreamingResponse(
        iter([RENDER_STREAM.sse(capabilities, session_id)]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/audit")
def api_audit():
    """The last `orchard audit` (results/audit.json, which the timer rewrites every 15
    minutes): the counts, the unwaived failures, and how old the report is."""
    from .. import audit as A                                   # noqa: PLC0415
    try:
        rep = json.loads(A.OUT.read_text())
    except FileNotFoundError:
        return JSONResponse({"error": "no audit yet: `uv run orchard audit` writes results/audit.json"},
                            status_code=404, headers={"Cache-Control": "no-store"})
    except (OSError, ValueError) as exc:
        return JSONResponse({"error": f"results/audit.json unreadable: {exc}"}, status_code=503,
                            headers={"Cache-Control": "no-store"})
    age = max(0.0, time.time() - float(rep.get("generated_at_unix") or 0))
    pick = lambda e, f: {"repo": e["name"], "rule": f["rule"], "where": f["where"], "detail": f["detail"]}
    return JSONResponse({
        "generated_at": rep.get("generated_at"),
        "generated_at_unix": rep.get("generated_at_unix"),
        "age_s": age,
        "stale": age > A.STALE_S,
        "duration_s": rep.get("duration_s"),
        "summary": rep.get("summary") or {},
        "failures": [pick(e, f) for e in rep.get("repos", []) for f in e["results"]
                     if f["status"] == "fail" and not f["waived"]],
    }, headers={"Cache-Control": "no-store"})


def _stamp(row: dict, key: str) -> dict:
    micros = _timestamp(row.get(key))
    row[key] = micros / 1e6 if micros else None
    return row


@app.get("/api/greenhouse")
def api_greenhouse():
    """What the greenhouse shows: open reviews, the last rulings, active directives, exhibits."""
    try:
        items = [_stamp(r, "created_at") for r in sql("select * from review_item")]
        rulings = [_stamp(r, "at") for r in sql("select * from ruling")]
        directives = [_stamp(r, "at") for r in sql("select * from directive")]
        exhibits = [_stamp(r, "hung_at") for r in sql("select * from exhibit")]
    except Exception as exc:                                    # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503, headers={"Cache-Control": "no-store"})
    for r in rulings:
        r.pop("by", None)                                        # an identity, not for the page
    by_review: dict[int, list[dict]] = {}
    for r in rulings:
        by_review.setdefault(int(r["review_id"]), []).append(r)
    for it in items:
        it["rulings"] = sorted(by_review.get(int(it["id"]), []), key=lambda r: r["at"] or 0)
    return JSONResponse({
        "review_items": sorted(items, key=lambda r: (r["status"] != "open", -(r["created_at"] or 0))),
        "rulings": sorted(rulings, key=lambda r: -(r["at"] or 0))[:30],
        "directives": sorted(directives, key=lambda r: (not r["active"], -(r["at"] or 0))),
        "exhibits": sorted(exhibits, key=lambda r: -(r["hung_at"] or 0)),
    }, headers={"Cache-Control": "no-store"})


class Ruling(BaseModel):
    review_id: int
    verdict: str          # approved | changes | rejected | greenlit
    note: str = ""


class Review(BaseModel):
    tree: str
    thesis: str
    kind: str             # styleframe | animatic | cut | still | master
    title: str
    url: str = ""
    note: str = ""


class Directive(BaseModel):
    text: str


def _call(reducer: str, *args):
    try:
        call(reducer, *args)
    except Exception as exc:                                    # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/rule")
def api_rule(r: Ruling):
    """A ruling (LAWS 14, 22). `orchard sync rulings` carries it into the manifest."""
    if r.verdict not in ("approved", "changes", "rejected", "greenlit"):
        raise HTTPException(status_code=400, detail="verdict must be approved, changes, rejected or greenlit")
    return _call("rule", r.review_id, r.verdict, r.note)


@app.post("/api/review")
def api_review(r: Review):
    return _call("submit_review", r.tree, r.thesis, r.kind, r.title, r.url, r.note)


@app.post("/api/directive")
def api_directive(d: Directive):
    if not d.text.strip():
        raise HTTPException(status_code=400, detail="empty directive")
    return _call("set_directive", d.text.strip())


@app.post("/api/directive/{directive_id}/retire")
def api_retire(directive_id: int):
    return _call("retire_directive", directive_id)


def _identity(value) -> str:
    """An identity as the CLI's JSON writes it (`["0x…"]`), as a checked hex string."""
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, dict):
        value = next(iter(value.values()), "")
    text = str(value or "").lower()
    if not text.startswith("0x"):
        text = f"0x{text}"
    return text if re.match(IDENTITY, text) else ""


@app.get("/api/people")
def api_people():
    """The moderation panel: who is online, open reports, active bans, the token gate."""
    try:
        visitors = sql("select * from visitor where online = true")
        reports = sql("select * from report")
        bans = sql("select * from ban")
        guests = {_identity(g["identity"]): g.get("network", "") for g in sql("select * from guest")}
        settings = {r["key"]: r["value"] for r in sql("select * from setting")}
    except Exception as exc:                                    # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=503, headers={"Cache-Control": "no-store"})
    online = [{
        "identity": _identity(v["identity"]),
        "name": v["name"],
        "room": v["room"],
        "is_admin": v["is_admin"],
        "muted": v["muted"],
        "network": guests.get(_identity(v["identity"]), ""),
        "last_seen": (_timestamp(v.get("last_seen")) or 0) / 1e6,
    } for v in visitors]
    return JSONResponse({
        "online": sorted(online, key=lambda v: (v["room"], v["name"].lower())),
        "reports": sorted(({
            "id": int(r["id"]),
            "subject": _identity(r["subject"]),
            "subject_name": r["subject_name"],
            "room": r["room"],
            "reason": r["reason"],
            "context": r["context"],
            "status": r["status"],
            "at": (_timestamp(r.get("at")) or 0) / 1e6,
        } for r in reports), key=lambda r: (r["status"] != "open", -r["at"])),
        "bans": sorted(({
            "identity": _identity(b["identity"]),
            "network": bool(b.get("network")),
            "reason": b["reason"],
            "until": (_timestamp(b.get("until")) or 0) / 1e6,
        } for b in bans), key=lambda b: -b["until"]),
        "auth": {
            # Empty means the module's built-in default, DEFAULT_ISSUER.
            "issuers": (settings.get("auth.issuers") or "").split(),
            "default_issuer": DEFAULT_ISSUER,
            "required": settings.get("auth.required") == "true",
        },
    }, headers={"Cache-Control": "no-store"})


class Who(BaseModel):
    who: str = Field(pattern=IDENTITY)


class Mute(Who):
    muted: bool


class Ban(Who):
    minutes: int = Field(ge=0, le=10_000_000)   # 0 is for good
    reason: str = Field(default="", max_length=280)
    network: bool = False


class Gate(BaseModel):
    issuers: list[str] = Field(min_length=1, max_length=8)
    required: bool


@app.post("/api/people/mute")
def api_mute(m: Mute):
    return _call("mute", m.who, m.muted)


@app.post("/api/people/kick")
def api_kick(w: Who):
    return _call("kick", w.who)


@app.post("/api/people/ban")
def api_ban(b: Ban):
    return _call("ban_visitor", b.who, b.minutes, b.reason, b.network)


@app.post("/api/people/unban")
def api_unban(w: Who):
    return _call("unban", w.who)


@app.post("/api/reports/{report_id}/resolve")
def api_resolve(report_id: int):
    return _call("resolve_report", report_id)


@app.post("/api/auth")
def api_auth(g: Gate):
    """The token gate: which token services count, and whether anonymous visitors are turned away."""
    issuers = [i.strip() for i in g.issuers if i.strip()]
    if not all(re.match(r"^https?://[^\s]+$", i) for i in issuers):
        raise HTTPException(status_code=400, detail="issuers are URLs")
    return _call("set_auth", issuers, g.required)


@app.get("/", response_class=HTMLResponse)
def index():
    return (HERE / "index.html").read_text()
