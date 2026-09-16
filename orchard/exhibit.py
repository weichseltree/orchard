"""Exhibit: hang an approved bundle in the grove.

    uv run orchard exhibit hang results/bundles/<id> [--approve] [--no-push]
    uv run orchard exhibit list
    uv run orchard exhibit take-down <id>

An exhibit is a row in the live database's `exhibit` table pointing at a
bundle on the media host. Hanging one is a ruling (LAWS 22): the artefact the
bundle came from must carry `approved: true` in its manifest, or the call must
say `--approve`, which records that ruling in the manifest. The bundle is
verified against its own digests, pushed to R2 (unless it is there already,
`push` is idempotent) and only then named to the database, so a visitor never
sees an exhibit whose bytes are not yet servable.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .bundle import verify_id
from .manifest import Artefact, Tree
from .push import PUBLIC_HOST, verify_local
from .sync import DB, SPACETIME_DIR, _cli, call

#: What the module's `exhibit.kind` may say (spacetime/spacetimedb/src/index.ts).
EXHIBIT_KINDS = ("clip", "still", "master", "tape", "planet")


def entry_urls(doc: dict, host: str = PUBLIC_HOST) -> dict:
    """`url`, `thumb_url` and `tape_url` for a bundle, as the exhibit row wants them."""
    base = f"https://{host}/{doc['id']}/"
    kind = doc.get("kind")
    thumb = base + doc["poster"] if doc.get("poster") else ""
    if kind == "video":
        return {"url": base + doc["master"], "thumb_url": thumb, "tape_url": ""}
    if kind == "tape":
        return {"url": base + "bundle.json", "thumb_url": thumb, "tape_url": base + "bundle.json"}
    if kind == "still":
        full = doc["tiers"][0]
        return {"url": base + (full.get("avif") or full["jpg"]), "thumb_url": thumb,
                "tape_url": ""}
    if kind == "planet":
        # One address for the whole exhibit: the client reads bundle.json and
        # follows it to the mesh, the surface stream and the atlas videos.
        return {"url": base + "bundle.json", "thumb_url": thumb, "tape_url": ""}
    raise ValueError(f"no exhibit shape for bundle kind {kind!r}")


def find_artefact(bundle_id: str) -> tuple[Tree, Artefact] | None:
    """The manifest artefact `orchard harvest` wrote this bundle from, if any."""
    from .portfolio import load_all
    for tree in load_all():
        for art in tree.artefacts:
            if art.bundle == bundle_id:
                return tree, art
    return None


def hang(bundle_dir, *, approve: bool = False, push: bool = True,
         dry_run: bool = False, host: str = PUBLIC_HOST, tree: str | None = None,
         kind: str | None = None, title: str | None = None,
         verbose: bool = True) -> dict:
    root = Path(bundle_dir).resolve()
    doc = json.loads((root / "bundle.json").read_text())
    ok, on_disk, recomputed = verify_id(root)
    if not ok or root.name != on_disk:
        raise ValueError(f"{root.name}: bundle.json says id {on_disk!r}, recomputed "
                         f"{recomputed!r}; re-bundle before hanging")
    local = verify_local(root)
    if local["mismatched"] or local["missing"]:
        raise ValueError(f"{root.name} does not match its own manifest: "
                         f"mismatched={local['mismatched']} missing={local['missing']}")

    found = find_artefact(doc["id"])
    art: Artefact | None = None
    if found:
        owner, art = found
        tree = tree or owner.name
        kind = kind or art.kind
        title = title or art.title or doc.get("title", "")
        approved = art.approved or approve
    else:
        tree = tree or doc.get("tree")
        kind = kind or {"video": "clip", "tape": "tape", "still": "still", "planet": "planet"}[doc["kind"]]
        title = title or doc.get("title", "")
        approved = approve
    if kind not in EXHIBIT_KINDS:
        raise ValueError(f"exhibit kind must be one of {EXHIBIT_KINDS}, not {kind!r}")
    if not approved:
        where = (f"{found[0].name}'s manifest, artefact {art.path}" if found
                 else "any manifest (no artefact names this bundle)")
        raise PermissionError(
            f"{doc['id']} is not approved in {where}. Exhibiting is a ruling "
            "(LAWS 22): set `approved: true` on the artefact, or pass --approve "
            "to record that ruling now.")

    urls = entry_urls(doc, host)
    rep = {"id": doc["id"], "tree": tree, "kind": kind, "title": title, **urls,
           "pushed": False, "hung": False, "dry_run": dry_run}
    if dry_run:
        return rep
    if push:
        from .push import push as push_bundle
        rep["push"] = push_bundle(root, verbose=verbose)
        rep["pushed"] = True
    call("hang", tree, kind, title, urls["url"], urls["thumb_url"], urls["tape_url"])
    rep["hung"] = True
    if found and approve and not art.approved:
        from .portfolio import save
        art.approved = True
        rep["approved_in"] = str(save(found[0]))
    if verbose:
        print(f"hung {doc['id']} on {tree} as {kind}: {urls['url']}", flush=True)
    return rep


def listing() -> str:
    """The exhibit table as the CLI prints it (read-only, no admin needed)."""
    r = subprocess.run([_cli(), "sql", DB,
                        "select id, tree, kind, title, url, hung_at from exhibit"],
                       cwd=SPACETIME_DIR, capture_output=True, text=True, timeout=60)
    out = (r.stdout + r.stderr).replace(
        "WARNING: This command is UNSTABLE and subject to breaking changes.", "").strip()
    if r.returncode != 0:
        raise RuntimeError(out)
    return out


def take_down(exhibit_id: int) -> None:
    call("take_down", int(exhibit_id))
