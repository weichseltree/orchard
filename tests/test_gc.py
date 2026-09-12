"""gc: a bundle nothing references is listed, and deleted only with --apply."""
import json
import os
import time

import pytest
import yaml

import orchard.portfolio as P
from orchard import gc as G
from test_bundle import FakeCF

DAY = 86400
ID = {k: f"{i:x}" * 16 for i, k in enumerate(
    ["field", "note", "canon", "pinned", "exhibit_pin", "hung", "old", "young"], start=1)}
SHA = "0" * 20 + ID["old"] + "0" * 28          # a sha256 with an id-shaped slice inside


@pytest.fixture
def world(tmp_path, monkeypatch):
    trees = tmp_path / "trees"; trees.mkdir()
    repo = tmp_path / "repo"; repo.mkdir()
    monkeypatch.setattr(P, "TREES", trees)
    (trees / "a.yaml").write_text(yaml.safe_dump({
        "name": "a", "path": str(repo), "question": "?",
        "artefacts": [{"kind": "still", "path": "x.png", "bundle": ID["field"], "sha256": SHA}],
        "notes": f"superseded {ID['note']} on purpose"}))
    (repo / "orchard.yaml").write_text(yaml.safe_dump({
        "name": "a", "path": str(repo), "question": "?",
        "artefacts": [{"kind": "tape", "path": "t", "bundle": ID["canon"]}]}))
    mansion = tmp_path / "mansion.json"
    mansion.write_text(json.dumps({"rooms": [{"hangings": [
        {"bundle": {"id": ID["pinned"]}},
        {"bundle": {"exhibit": {"tree": "a", "kind": "tape", "bundle": ID["exhibit_pin"]}}},
        {"title": "not a bundle ref", "id": ID["old"][:8]}]}]}))
    rows = [{"id": 1, "tree": "a", "kind": "clip", "tape_url": "",
             "url": f"https://media.weichseltree.com/{ID['hung']}/master.m3u8",
             "thumb_url": f"https://media.weichseltree.com/{ID['hung']}/poster.jpg"}]
    root = tmp_path / "bundles"
    for bid in ID.values():
        d = root / bid; d.mkdir(parents=True)
        (d / "bundle.json").write_text("{}"); (d / "x.bin").write_bytes(b"x" * 1000)
        old = time.time() - (0 if bid == ID["young"] else 3 * DAY)
        os.utime(d / "bundle.json", (old, old))
    (root / ".bundle-staging").mkdir()
    return root, mansion, rows


def test_every_kind_of_reference_keeps_a_bundle(world):
    root, mansion, rows = world
    live, counts = G.live_ids(mansion=mansion, exhibit_rows=rows)
    assert counts == {"manifests": 2, "mansion.json": 1, "exhibit rows": 1}
    for k in ("field", "note", "canon", "pinned", "exhibit_pin", "hung"):
        assert ID[k] in live, k
    assert ID["old"] not in live, "a slice of a sha256 is not a reference"
    assert any("exhibit 1" in w for w in live[ID["hung"]])


def test_a_dry_run_lists_and_deletes_nothing_and_apply_deletes_only_garbage(world):
    root, mansion, rows = world
    rep = G.gc(root=root, mansion=mansion, exhibit_rows=rows, verbose=False)
    assert [r["id"] for r in rep["garbage"]] == [ID["old"]]
    assert rep["garbage"][0]["bytes"] == 1002 and rep["garbage"][0]["age_hours"] >= 71
    assert [r["id"] for r in rep["young"]] == [ID["young"]], "unreferenced but just made"
    assert rep["ignored"] == [".bundle-staging"] and rep["deleted"] == 0
    assert sorted(p.name for p in root.iterdir()) == sorted([*ID.values(), ".bundle-staging"])

    rep = G.gc(root=root, mansion=mansion, exhibit_rows=rows, apply=True, verbose=False)
    assert rep["deleted"] == 1 and not (root / ID["old"]).exists()
    assert sorted(p.name for p in root.iterdir()) == sorted(
        [v for k, v in ID.items() if k != "old"] + [".bundle-staging"])


def test_gc_refuses_when_a_reference_source_cannot_be_read(world, monkeypatch):
    from orchard import sync
    root, mansion, rows = world

    def unreachable(q):
        raise RuntimeError("sql failed: connection refused")
    monkeypatch.setattr(sync, "sql", unreachable)
    with pytest.raises(G.GcRefused, match="exhibit table is unreachable"):
        G.gc(root=root, mansion=mansion, apply=True, verbose=False)
    with pytest.raises(G.GcRefused, match="missing"):
        G.gc(root=root, mansion=mansion.with_name("nope.json"), exhibit_rows=rows, verbose=False)
    mansion.write_text("{ torn")
    with pytest.raises(G.GcRefused, match="cannot read"):
        G.gc(root=root, mansion=mansion, exhibit_rows=rows, apply=True, verbose=False)
    assert (root / ID["old"]).exists(), "a refusal deletes nothing"


def test_the_cli_exits_2_on_a_refusal(world, monkeypatch, capsys):
    from orchard import cli
    root, mansion, rows = world
    monkeypatch.setattr(G, "live_ids", lambda **kw: (_ for _ in ()).throw(G.GcRefused("db down")))
    with pytest.raises(SystemExit) as e:
        cli.main(["bundle", "gc", "--root", str(root), "--apply"])
    assert e.value.code == 2 and "gc refused: db down" in capsys.readouterr().err
    assert (root / ID["old"]).exists()


def test_r2_lists_prefixes_and_deletes_the_index_first(world):
    root, mansion, rows = world
    cf = FakeCF({f"{bid}/{f}": b"x" for bid in (ID["old"], ID["hung"])
                 for f in ("bundle.json", "360p/s0000.ts", ".orchard-index.json")})
    cf.objects["_bench/rest/c0000.bin"] = b"y"
    kw = dict(r2=True, bucket="b", cf=cf, mansion=mansion, exhibit_rows=rows, verbose=False)
    rep = G.gc(min_age_hours=1e9, apply=True, **kw)
    assert [r["id"] for r in rep["young"]] == [ID["old"]] and cf.deletes == [], \
        "an upload younger than the grace period is kept"
    rep = G.gc(min_age_hours=0, **kw)
    assert [r["id"] for r in rep["garbage"]] == [ID["old"]] and rep["garbage"][0]["objects"] == 3
    assert [r["id"] for r in rep["live"]] == [ID["hung"]] and rep["ignored"] == ["_bench"]
    assert cf.deletes == [], "a dry run deletes nothing"
    rep = G.gc(min_age_hours=0, apply=True, **kw)
    assert cf.deletes == [f"{ID['old']}/.orchard-index.json", f"{ID['old']}/bundle.json",
                          f"{ID['old']}/360p/s0000.ts"]
    assert all(k.startswith((ID["hung"], "_bench")) for k in cf.objects)
