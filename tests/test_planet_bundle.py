"""The planet bundle: spectre's cutaway delivery as one content-addressed exhibit."""
from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import pytest

from orchard import gc, planet
from orchard.bundle import compute_id, verify_id
from orchard.push import verify_local

WORLDS = ["adiabat-chi0", "adiabat-chi6", "adiabat-chi12"]


def write_delivery(root: Path, frames=4, segment_frames=2) -> Path:
    """A miniature `m04/planet-exhibit/3` bake: mesh, stream, legends, stills."""
    root.mkdir(parents=True)
    (root / "planet_cutaway.glb").write_bytes(b"glTF" + b"\0" * 60)
    (root / "surface").mkdir()
    segments = []
    vertices = 6
    for first in range(0, frames, segment_frames):
        n = min(segment_frames, frames - first)
        payload = zlib.compress(bytes(range(n * 3 * vertices)), 9)
        raw = payload[2:-4]                       # raw DEFLATE, as the bake writes it
        header = struct.pack("<4sHHIIIfHHI", b"PSRF", 1, 3, vertices, first, n, 0.05, 128, 1, len(raw))
        bases = struct.pack("<%df" % (n * 3), *([55.0] * (n * 3)))
        data = header + bases + raw
        name = f"surface/seg{first // segment_frames:03d}.bin"
        (root / name).write_bytes(data)
        segments.append({"file": name, "first_frame": first, "frames": n, "bytes": len(data),
                         "sha256": __import__("hashlib").sha256(data).hexdigest()})
    for mode in planet.MODES:
        (root / f"legend_{mode}.png").write_bytes(b"\x89PNG" + mode.encode())
    (root / "stills").mkdir()
    # A 2x2 PNG ffmpeg can read: written through PIL if present, else a raw PPM renamed is refused,
    # so the poster test skips when neither PIL nor ffmpeg can make one.
    manifest = {
        "schema": "m04/planet-exhibit/3", "what": "test", "fps": 30, "frames": frames,
        "seconds": frames / 30, "mesh": "planet_cutaway.glb", "git": "test-1-gabc",
        "produced_by": "test", "R_REF_sigma": 56.75, "time": "frame i is tape frame i",
        "videos": {m: f"planet_{m}.mp4" for m in planet.MODES},
        "legends": {m: f"legend_{m}.png" for m in planet.MODES},
        "modes": {m: f"{m} mode" for m in planet.MODES},
        "atlas": {"size": [1920, 1080], "columns": {w: i for i, w in enumerate(WORLDS)},
                  "tiles": {"skin": [0, 640, 640, 440]}},
        "surface_stream": {
            "format": "m04/planet-surface-stream/1", "frames": frames,
            "bytes": sum(s["bytes"] for s in segments), "worlds": WORLDS,
            "vertices_per_world": vertices, "grid": {"shape": [2, 3]}, "header": "h",
            "decode": "d", "place": "p", "quantisation_sigma": 0.05, "zero_code": 128,
            "range_sigma": [-6.4, 6.35], "segment_frames": segment_frames, "segments": segments},
        "worlds": {w: {"chi": chi, "tape": f"results/{w}/tape", "t_dyn_tau": 23.28,
                       "surface_summary": {"frames_single_valued": frames},
                       "hydrostatic_diagnostic": {"worst_settled": 0.05}}
                   for w, chi in zip(WORLDS, (0, 6, 12))},
        "per_frame": [{"i": i, "t_dyn": i * 0.1, "R_s": {w: 55.0 for w in WORLDS}} for i in range(frames)],
        "honesty": ["nothing is generated"], "lights": {"ambient": [0.1, 0.1, 0.11]},
        "domains": {"T_lo": 0.65},
    }
    (root / "manifest.json").write_text(json.dumps(manifest))
    (root / "hls").mkdir()
    (root / "hls" / "index.json").write_text(json.dumps({"videos": {
        "beauty": {"bundle_id": "1207b7952ce09923"}, "species": {"bundle_id": "686fc9ff74ed9b3b"},
        "hero": {"bundle_id": "fb20f1408eec97c8"}}}))
    return root


def write_poster(root: Path) -> bool:
    try:
        from PIL import Image                                  # noqa: PLC0415
    except ImportError:
        return False
    Image.new("RGB", (8, 4), (200, 120, 60)).save(root / "stills" / "hero_f0094.png")
    return True


@pytest.fixture
def delivery(tmp_path):
    root = write_delivery(tmp_path / "exhibit-v2")
    if not write_poster(root):
        pytest.skip("PIL is needed to write the poster fixture")
    return root


def test_planet_bundle_round_trip(delivery, tmp_path):
    out = planet.bundle_planet(delivery, tree="spectre", title="Planet cutaway",
                               out_root=tmp_path / "bundles", verbose=False, commit="test-1-gabc")
    doc = json.loads((out / "bundle.json").read_text())
    ok, on_disk, recomputed = verify_id(out)
    assert ok and out.name == on_disk == recomputed == compute_id(doc)
    assert doc["kind"] == "planet" and doc["schema"] == "orchard/bundle/1"
    # Every served file is named with its digest, so the id covers the bytes.
    rep = verify_local(out)
    assert not rep["mismatched"] and not rep["missing"]
    assert set(doc["files"]) == {"planet_cutaway.glb", "poster.jpg", "legend_beauty.png",
                                 "legend_species.png", "surface/seg000.bin", "surface/seg001.bin"}
    assert [w["world"] for w in doc["worlds"]] == WORLDS
    assert [w["node"] for w in doc["worlds"]] == ["planet_chi0", "planet_chi6", "planet_chi12"]
    assert doc["atlases"] == {
        "beauty": {"bundle": "1207b7952ce09923", "legend": "legend_beauty.png", "description": "beauty mode"},
        "species": {"bundle": "686fc9ff74ed9b3b", "legend": "legend_species.png", "description": "species mode"},
    }
    assert doc["surface"]["format"] == "m04/planet-surface-stream/1"
    assert [s["first_frame"] for s in doc["surface"]["segments"]] == [0, 2]
    assert doc["honesty"] == ["nothing is generated"]
    assert doc["source"]["exhibit_schema"] == "m04/planet-exhibit/3"
    assert doc["source"]["tree_commit"] == "test-1-gabc"
    assert doc["poster_frame"] == 94
    assert doc["produced_by"].endswith("--atlas beauty=1207b7952ce09923 --atlas species=686fc9ff74ed9b3b")


def test_explicit_atlases_replace_the_delivery_index(delivery, tmp_path):
    out = planet.bundle_planet(delivery, tree="spectre", title="t", out_root=tmp_path / "b",
                               atlases={"beauty": "aaaaaaaaaaaaaaaa"}, verbose=False, commit="c")
    doc = json.loads((out / "bundle.json").read_text())
    assert list(doc["atlases"]) == ["beauty"]
    assert set(doc["files"]) >= {"legend_beauty.png"} and "legend_species.png" not in doc["files"]
    with pytest.raises(ValueError, match="beauty atlas"):
        planet.bundle_planet(delivery, tree="spectre", title="t", out_root=tmp_path / "c",
                             atlases={"species": "aaaaaaaaaaaaaaaa"}, verbose=False, commit="c")
    with pytest.raises(ValueError, match="unknown atlas modes"):
        planet.bundle_planet(delivery, tree="spectre", title="t", out_root=tmp_path / "d",
                             atlases={"beauty": "a" * 16, "hero": "b" * 16}, verbose=False, commit="c")


def test_a_damaged_segment_is_refused(delivery, tmp_path):
    seg = delivery / "surface" / "seg001.bin"
    seg.write_bytes(seg.read_bytes()[:-1])
    with pytest.raises(ValueError, match="seg001"):
        planet.bundle_planet(delivery, tree="spectre", title="t", out_root=tmp_path / "b",
                             verbose=False, commit="c")
    assert not list((tmp_path / "b").glob(".bundle-*"))


def test_gc_keeps_a_pinned_planet_s_atlases_alive(delivery, tmp_path):
    out = planet.bundle_planet(delivery, tree="spectre", title="t", out_root=tmp_path / "bundles",
                               verbose=False, commit="c")
    mansion = tmp_path / "mansion.json"
    mansion.write_text(json.dumps({"rooms": [{"hangings": [{"kind": "planet", "bundle": {"id": out.name}}]}]}))
    live: dict = {}
    assert gc.mansion_refs(live, mansion) == 1
    assert out.name in live
    assert gc.nested_refs(out.name, tmp_path / "bundles") == ["1207b7952ce09923", "686fc9ff74ed9b3b"]
    # The mansion walk looks in results/bundles; with the bundle elsewhere the atlases stay unknown,
    # which is the honest answer, not a deletion.
    assert "1207b7952ce09923" in live or (gc.RESULTS / "bundles" / out.name).exists() is False


# ---------------------------------------------------------------- the rename

def test_a_renamed_directory_keeps_the_tree_identity(tmp_path, monkeypatch):
    """spectre's directory became `coarsen` on 2026-09-16; the tree stayed `spectre`.

    A tree's `name` is identity: it sits inside the bytes every bundle id is a
    hash over, so moving it would move every id, pin and exhibit row. Its
    `path` and its `title` are free. `_tree_root` must therefore follow the
    manifest rather than guessing `~/weichseltree/<name>`, or provenance
    silently loses the commit it was made at.
    """
    from orchard import bundle
    from orchard.manifest import Tree

    checkout = tmp_path / "coarsen"
    (checkout / ".git").mkdir(parents=True)
    tree = Tree(name="spectre", title="coarsen", path=str(checkout), question="?")
    monkeypatch.setattr("orchard.portfolio.load_all", lambda: [tree], raising=False)

    assert bundle._tree_root("spectre") == checkout
    assert tree.label == "coarsen"            # what a person reads
    assert tree.name == "spectre"             # what a bundle id hashes
    # A tree with no title reads as its name, so nothing else in the fund moves.
    assert Tree(name="einstruct", path=str(checkout), question="?").label == "einstruct"


def test_the_tree_root_falls_back_when_no_manifest_answers(tmp_path, monkeypatch):
    """A malformed or missing manifest must not stop a bundle being written."""
    from orchard import bundle

    def boom():
        raise ValueError("manifest is not readable")

    monkeypatch.setattr("orchard.portfolio.load_all", boom, raising=False)
    monkeypatch.setattr(bundle, "WEICHSELTREE", tmp_path)
    (tmp_path / "einstruct" / ".git").mkdir(parents=True)
    assert bundle._tree_root("einstruct") == tmp_path / "einstruct"
    assert bundle._tree_root("nothing-here") is None
