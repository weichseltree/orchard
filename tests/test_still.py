"""Still bundles: AVIF with a JPEG fallback at three widths, provenance carried."""
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from orchard.bundle import bundle_still, provenance_sidecar, verify_bundle
from orchard.push import content_type, verify_local

ffmpeg_missing = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


def make_png(path: Path, w=2000, h=1200) -> Path:
    from PIL import Image
    rng = np.random.default_rng(3)
    a = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    a[:, : w // 2] //= 4
    Image.fromarray(a).save(path)
    return path


@ffmpeg_missing
def test_a_still_bundles_at_three_widths_with_a_jpeg_at_each(tmp_path):
    png = make_png(tmp_path / "frame.png")
    out = bundle_still(png, "einstruct", "a frame", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["kind"] == "still" and doc["id"] == out.name
    assert [t["name"] for t in doc["tiers"]] == ["full", "phone", "thumb"]
    assert [t["width"] for t in doc["tiers"]] == [2000, 1600, 640]
    assert doc["tiers"][2]["height"] == 384
    for t in doc["tiers"]:
        assert (out / t["jpg"]).stat().st_size > 0
        assert content_type(t["jpg"]) == "image/jpeg"
    assert doc["poster"] == "thumb.jpg"
    # AVIF where libaom is present, and never on the thumb.
    if doc["avif"]:
        assert (out / doc["tiers"][0]["avif"]).stat().st_size > 0
        assert content_type(doc["tiers"][0]["avif"]) == "image/avif"
    assert "avif" not in doc["tiers"][2]
    assert doc["source"]["file_sha256"] and doc["source"]["bytes"] == png.stat().st_size


@ffmpeg_missing
def test_every_served_file_is_named_in_media_json_and_the_id_is_the_recipe(tmp_path):
    png = make_png(tmp_path / "frame.png", 640, 400)
    out = bundle_still(png, "einstruct", "a frame", tmp_path / "b", verbose=False)
    rep = verify_local(out)
    assert not rep["mismatched"] and not rep["missing"] and not rep["unclaimed"]
    assert verify_bundle(out)["ok"]
    again = bundle_still(png, "einstruct", "a frame", tmp_path / "b2", verbose=False)
    assert again.name == out.name, "same source, same recipe, same address"


@ffmpeg_missing
def test_a_stock_sidecar_is_carried_into_source_provenance(tmp_path):
    png = make_png(tmp_path / "mars.png", 320, 200)
    side = {"provider": "nasa", "id": "PIA05445", "license": "public domain",
            "author": "NASA/JPL", "sha256": "abc", "bytes": 1, "retrieved_unix": 1756800000}
    (tmp_path / "mars.png.json").write_text(json.dumps(side))
    assert provenance_sidecar(png) == {"sidecar": "mars.png.json", **side}
    out = bundle_still(png, "spectre", "mars", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["source"]["provenance"]["provider"] == "nasa"
    assert doc["source"]["provenance"]["license"] == "public domain"


def test_no_sidecar_means_no_provenance_key(tmp_path):
    f = tmp_path / "x.png"; f.write_bytes(b"")
    assert provenance_sidecar(f) is None
    (tmp_path / "x.png.json").write_text("not json")
    assert provenance_sidecar(f)["error"]
