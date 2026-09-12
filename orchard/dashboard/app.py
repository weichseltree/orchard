"""The flat dashboard: what you look at while you work. Port 8787, local only.

The ledger and the portfolio are read from disk. The greenhouse panels (the
review queue, rulings, directives, exhibits) are read from the live database
through the `spacetime` CLI, whose login identity is the module's admin; the
same identity signs the rulings this page writes. Local only: nothing here
authenticates, the box does.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from ..ledger import snapshot
from ..portfolio import load_all
from ..sync import _timestamp, call, sql

app = FastAPI(title="orchard")
HERE = Path(__file__).parent


@app.get("/api/portfolio")
def api_portfolio():
    return JSONResponse([t.model_dump(mode="json") for t in load_all()])


@app.get("/api/ledger")
def api_ledger(days: int = 30):
    return JSONResponse(snapshot(days=days), headers={"Cache-Control": "no-store"})


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


@app.get("/", response_class=HTMLResponse)
def index():
    return (HERE / "index.html").read_text()
