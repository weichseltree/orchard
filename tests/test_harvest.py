"""Harvest: the manifest's artefacts become bundles, and the manifest learns their ids."""
import json
from pathlib import Path

import numpy as np
import pytest
import yaml

from orchard import harvest as H
from orchard.manifest import load
from test_bundle import synthetic, write_tape
from test_still import ffmpeg_missing, make_png


@pytest.fixture
def grove(tmp_path, monkeypatch):
    """A fake tree on disk and a fund copy of its manifest, in a private trees/."""
    repo = tmp_path / "repo"
    rng = np.random.default_rng(1)
    pos, species, alive = synthetic(rng, frames=2, n=40)
    write_tape(repo / "results/tapes/ab", pos, species, alive)
    make_png(repo / "results/still.png", 320, 200)
    trees = tmp_path / "trees"; trees.mkdir()
    (trees / "fake.yaml").write_text(yaml.safe_dump({
        "name": "fake", "path": str(repo), "question": "q?",
        "artefacts": [
            {"kind": "tape", "path": "results/tapes/ab/header.json", "title": "the tape"},
            {"kind": "still", "path": "results/still.png", "title": "the still"},
            {"kind": "clip", "path": "results/missing.mp4", "title": "not there"},
            {"kind": "audio", "path": "results/vo.wav"},
        ]}))
    import orchard.portfolio as P
    monkeypatch.setattr(P, "TREES", trees)
    monkeypatch.setattr(H, "TREES", trees)
    return repo, trees, tmp_path / "bundles"


@ffmpeg_missing
def test_harvest_bundles_what_exists_and_writes_the_ids_back(grove):
    repo, trees, out = grove
    rows = H.harvest("fake", out_root=out, verbose=False)
    by_kind = {r["kind"]: r for r in rows}
    assert by_kind["tape"]["status"] == "bundled" and by_kind["still"]["status"] == "bundled"
    assert by_kind["clip"]["status"] == "missing"
    assert by_kind["audio"]["status"] == "no bundler"
    tree = load(trees / "fake.yaml")
    tape = next(a for a in tree.artefacts if a.kind == "tape")
    assert tape.bundle == by_kind["tape"]["bundle"] and (out / tape.bundle / "bundle.json").exists()
    assert tape.sha256 and tape.commit
    still = next(a for a in tree.artefacts if a.kind == "still")
    assert json.loads((out / still.bundle / "bundle.json").read_text())["kind"] == "still"
    # The path that pointed at header.json still does: harvest resolves, never rewrites.
    assert tape.path == "results/tapes/ab/header.json"


@ffmpeg_missing
def test_a_second_harvest_is_a_no_op_until_the_source_changes_or_force(grove):
    repo, trees, out = grove
    H.harvest("fake", out_root=out, verbose=False)
    rows = H.harvest("fake", out_root=out, verbose=False)
    assert {r["status"] for r in rows if r["kind"] in ("tape", "still")} == {"current"}
    rows = H.harvest("fake", out_root=out, dry_run=True, force=True, verbose=False)
    assert {r["status"] for r in rows if r["kind"] in ("tape", "still")} == {"would bundle"}
    make_png(repo / "results/still.png", 300, 200)
    rows = H.harvest("fake", out_root=out, only=["still"], verbose=False)
    by_kind = {r["kind"]: r for r in rows}
    assert by_kind["still"]["status"] == "bundled" and by_kind["tape"]["status"] == "skipped"


def test_dry_run_writes_nothing(grove):
    repo, trees, out = grove
    before = (trees / "fake.yaml").read_text()
    rows = H.harvest("fake", out_root=out, dry_run=True, verbose=False)
    assert any(r["status"] == "would bundle" for r in rows)
    assert (trees / "fake.yaml").read_text() == before and not out.exists()


def test_the_repo_manifest_wins_when_it_exists(grove):
    repo, trees, out = grove
    (repo / "orchard.yaml").write_text((trees / "fake.yaml").read_text())
    tree = load(trees / "fake.yaml")
    assert H.manifest_path(tree) == repo / "orchard.yaml"


# --------------------------------------------- what the trees found 2026-09-12


def test_a_commit_the_tree_wrote_survives_a_harvest_of_unchanged_bytes(grove):
    """premosaic: two July stills were stamped with today's HEAD."""
    repo, trees, out = grove
    doc = yaml.safe_load((trees / "fake.yaml").read_text())
    doc["artefacts"][1]["commit"] = "2fdf90d"
    (trees / "fake.yaml").write_text(yaml.safe_dump(doc))
    H.harvest("fake", out_root=out, only=["still"], verbose=False)
    still = next(a for a in load(trees / "fake.yaml").artefacts if a.kind == "still")
    assert still.commit == "2fdf90d" and still.bundle
    # Changed bytes since the last harvest: the old commit is stale, HEAD is the best guess.
    make_png(repo / "results/still.png", 300, 200)
    H.harvest("fake", out_root=out, only=["still"], verbose=False)
    still = next(a for a in load(trees / "fake.yaml").artefacts if a.kind == "still")
    assert still.commit != "2fdf90d"


def test_a_tape_still_being_written_is_refused(grove):
    """spectre: chi6 read 1,036 frames in the index against 1,035 in the trailer."""
    repo, trees, out = grove
    tape = repo / "results/tapes/ab"
    trailer = json.loads((tape / "trailer.json").read_text())
    trailer["frames"] -= 1
    (tape / "trailer.json").write_text(json.dumps(trailer))
    rows = H.harvest("fake", out_root=out, only=["tape"], verbose=False)
    assert rows[0]["status"].startswith("refused: trailer says 1 frames, index has 2")
    assert not out.exists()
    (tape / "trailer.json").unlink()
    rows = H.harvest("fake", out_root=out, only=["tape"], verbose=False)
    assert rows[0]["status"] == "refused: no trailer.json: the writer has not finished"


def test_a_tape_digest_moves_when_a_frame_is_appended_not_only_the_header(grove):
    repo, trees, out = grove
    tape = repo / "results/tapes/ab"
    before = H.source_digest("tape", tape)
    with open(tape / "frames.jsonl", "a") as f:
        f.write(json.dumps({"i": 2, "step": 20, "t": 1.0, "n": 40, "off": 0, "len": 0}) + "\n")
    assert H.source_digest("tape", tape) != before
    assert H.tape_incomplete(tape)          # and the trailer now disagrees


def test_a_row_with_the_old_header_only_digest_stays_current_and_is_upgraded(grove):
    """The tapes hanging in the grove keep their ids across the digest change."""
    repo, trees, out = grove
    H.harvest("fake", out_root=out, only=["tape"], verbose=False)
    doc = yaml.safe_load((trees / "fake.yaml").read_text())
    row = doc["artefacts"][0]
    new_digest, bundle = row["sha256"], row["bundle"]
    row["sha256"] = H.legacy_tape_digest(repo / "results/tapes/ab")
    (trees / "fake.yaml").write_text(yaml.safe_dump(doc))
    rows = H.harvest("fake", out_root=out, only=["tape"], verbose=False)
    assert rows[0]["status"] == "current" and rows[0].get("note")
    tape = next(a for a in load(trees / "fake.yaml").artefacts if a.kind == "tape")
    assert tape.bundle == bundle and tape.sha256 == new_digest


def test_one_unreadable_manifest_does_not_block_the_other_trees(grove, capsys):
    """einstruct's harvest died on phototroph's manifest mid-edit."""
    import orchard.portfolio as P
    repo, trees, out = grove
    (trees / "broken.yaml").write_text("name: broken\npath: /nowhere\nquestion: 'unterminated\n")
    names = [t.name for t in P.load_all()]
    assert names == ["fake"]
    assert list(P.BROKEN) == [str(trees / "broken.yaml")]
    assert "skipping unreadable manifest" in capsys.readouterr().err
    with pytest.raises(KeyError, match="unreadable"):
        P.get("broken")
    rows = H.harvest("fake", out_root=out, dry_run=True, verbose=False)
    assert any(r["status"] == "would bundle" for r in rows)
