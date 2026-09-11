"""The flat dashboard: what you look at while you work. Port 8787, local only.

Read-only over the ledger and the portfolio for now. Rulings (approve a still,
greenlight an episode, write a directive) land in the next pass and are the
same tables the grove's greenhouse will show through SpacetimeDB.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

from ..ledger import snapshot
from ..portfolio import load_all

app = FastAPI(title="orchard")
HERE = Path(__file__).parent


@app.get("/api/portfolio")
def api_portfolio():
    return JSONResponse([t.model_dump(mode="json") for t in load_all()])


@app.get("/api/ledger")
def api_ledger(days: int = 30):
    return JSONResponse(snapshot(days=days), headers={"Cache-Control": "no-store"})


@app.get("/", response_class=HTMLResponse)
def index():
    return (HERE / "index.html").read_text()
