"""Exhibit: an approved bundle is verified, pushed, then named to the database."""
import json

import numpy as np
import pytest

from orchard import exhibit as X
from orchard.bundle import bundle_tape
from test_bundle import synthetic, write_tape


@pytest.fixture
def tape_bundle(tmp_path):
    rng = np.random.default_rng(7)
    pos, species, alive = synthetic(rng, frames=2, n=40)
    write_tape(tmp_path / "tape", pos, species, alive)
    return bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b", verbose=False)


def test_entry_urls_per_kind():
    base = "https://media.weichseltree.com/0123456789abcdef/"
    video = {"id": "0123456789abcdef", "kind": "video", "master": "master.m3u8", "poster": "poster.jpg"}
    assert X.entry_urls(video) == {"url": base + "master.m3u8", "thumb_url": base + "poster.jpg", "tape_url": ""}
    tape = {"id": "0123456789abcdef", "kind": "tape", "poster": "poster.png"}
    assert X.entry_urls(tape)["tape_url"] == base + "bundle.json"
    still = {"id": "0123456789abcdef", "kind": "still", "poster": "thumb.jpg",
             "tiers": [{"name": "full", "jpg": "full.jpg", "avif": "full.avif"}]}
    assert X.entry_urls(still)["url"] == base + "full.avif"
    del still["tiers"][0]["avif"]
    assert X.entry_urls(still)["url"] == base + "full.jpg"
    planet = {"id": "0123456789abcdef", "kind": "planet", "poster": "poster.jpg"}
    assert X.entry_urls(planet) == {"url": base + "bundle.json", "thumb_url": base + "poster.jpg", "tape_url": ""}
    with pytest.raises(ValueError):
        X.entry_urls({"id": "x", "kind": "splat"})


def test_an_unapproved_bundle_is_refused_before_anything_is_called(tape_bundle, monkeypatch):
    calls = []
    monkeypatch.setattr(X, "call", lambda *a: calls.append(a))
    monkeypatch.setattr(X, "find_artefact", lambda bid: None)
    with pytest.raises(PermissionError, match="LAWS 22"):
        X.hang(tape_bundle, push=False, verbose=False)
    assert calls == []


def test_approve_hangs_with_the_manifest_s_tree_kind_and_title(tape_bundle, monkeypatch):
    calls = []
    monkeypatch.setattr(X, "call", lambda *a: calls.append(a))
    from orchard.manifest import Artefact, Tree
    tree = Tree(name="einstruct", path="/nowhere", question="q?",
                artefacts=[Artefact(kind="tape", path="results/tapes/ab", title="the tape",
                                    bundle=tape_bundle.name, approved=True)])
    monkeypatch.setattr(X, "find_artefact", lambda bid: (tree, tree.artefacts[0]))
    rep = X.hang(tape_bundle, push=False, verbose=False)
    assert rep["hung"] and not rep["pushed"]
    base = f"https://media.weichseltree.com/{tape_bundle.name}/"
    assert calls == [("hang", "einstruct", "tape", "the tape", base + "bundle.json",
                      base + "poster.png", base + "bundle.json")]


def test_dry_run_reports_and_calls_nothing(tape_bundle, monkeypatch):
    calls = []
    monkeypatch.setattr(X, "call", lambda *a: calls.append(a))
    monkeypatch.setattr(X, "find_artefact", lambda bid: None)
    rep = X.hang(tape_bundle, approve=True, dry_run=True, verbose=False)
    assert rep["dry_run"] and not rep["hung"] and rep["kind"] == "tape"
    assert calls == []


def test_a_tampered_bundle_is_refused(tape_bundle, monkeypatch):
    monkeypatch.setattr(X, "call", lambda *a: None)
    doc = json.loads((tape_bundle / "bundle.json").read_text())
    chunk = tape_bundle / doc["variants"]["vr-high"]["chunks"][0]["file"]
    b = bytearray(chunk.read_bytes()); b[40] ^= 0xFF; chunk.write_bytes(bytes(b))
    with pytest.raises(ValueError, match="does not match"):
        X.hang(tape_bundle, approve=True, push=False, verbose=False)
