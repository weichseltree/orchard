"""Model bundles: a glb on a plinth, checked, costed and measured from its JSON."""
import json
import struct
from pathlib import Path

import pytest

from orchard import exhibit as X
from orchard import harvest, scout
from orchard.bundle import (MODEL_MAX_TRIANGLES, ModelRefused, bundle_model,
                            inspect_glb, verify_bundle)
from orchard.push import content_type, verify_local


def glb_bytes(doc: dict, binary: bytes | None = None, *, magic=b"glTF", version=2,
              length_delta=0) -> bytes:
    """A binary glTF: header, a space-padded JSON chunk, a zero-padded BIN chunk."""
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js
    if binary is not None:
        binary += b"\0" * (-len(binary) % 4)
        body += struct.pack("<II", len(binary), 0x004E4942) + binary
    total = 12 + len(body)
    return struct.pack("<4sII", magic, version, total + length_delta) + body


def triangle_doc(*, nodes=None, scenes=None, primitives=1, index_count=None,
                 extra: dict | None = None) -> tuple[dict, bytes]:
    """One unit triangle (0..1 on x and y), placed by `nodes`; real vertex bytes."""
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    accessors = [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
                  "min": [0, 0, 0], "max": [1, 1, 0]}]
    prim = {"attributes": {"POSITION": 0}}
    binary = positions
    views = [{"buffer": 0, "byteOffset": 0, "byteLength": len(positions)}]
    if index_count is not None:
        idx = struct.pack(f"<{index_count}H", *([0, 1, 2] * (index_count // 3 + 1))[:index_count])
        idx += b"\0" * (-len(idx) % 4)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(idx)})
        accessors.append({"bufferView": 1, "componentType": 5123, "count": index_count, "type": "SCALAR"})
        binary += idx
        prim["indices"] = 1
    doc = {
        "asset": {"version": "2.0", "generator": "test_model"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
        "meshes": [{"primitives": [dict(prim) for _ in range(primitives)]}],
        "nodes": nodes if nodes is not None else [{"mesh": 0}],
        "scenes": scenes if scenes is not None else [{"nodes": [0]}],
        "scene": 0,
    }
    doc.update(extra or {})
    return doc, binary


def write_glb(path: Path, **kw) -> Path:
    doc, binary = triangle_doc(**kw)
    path.write_bytes(glb_bytes(doc, binary))
    return path


def test_a_triangle_is_one_draw_and_one_triangle_with_its_extent(tmp_path):
    stats = inspect_glb(write_glb(tmp_path / "t.glb"))
    assert stats["triangles"] == 1 and stats["draws"] == 1
    assert stats["bbox"] == {"min": [0, 0, 0], "max": [1, 1, 0]}
    assert stats["size"] == [1, 1, 0]
    assert stats["bytes"] == (tmp_path / "t.glb").stat().st_size
    assert stats["generator"] == "test_model" and stats["extensions_required"] == []


def test_the_bbox_follows_the_node_hierarchy_and_a_mesh_placed_twice_draws_twice(tmp_path):
    # Parent scales by 2 and moves up 3; the child turns 90 degrees about z and
    # places the mesh; a second root places it again at x = 10 by matrix.
    s = 2 ** -0.5
    nodes = [
        {"translation": [0, 3, 0], "scale": [2, 2, 2], "children": [1]},
        {"rotation": [0, 0, s, s], "mesh": 0},
        {"matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1], "mesh": 0},
    ]
    stats = inspect_glb(write_glb(tmp_path / "t.glb", nodes=nodes, scenes=[{"nodes": [0, 2]}],
                                  primitives=2, index_count=6))
    assert stats["draws"] == 4 and stats["triangles"] == 8
    # The turned child spans x in [-2, 0], y in [3, 5]; the matrix copy x in [10, 11], y in [0, 1].
    assert stats["bbox"]["min"] == pytest.approx([-2, 0, 0], abs=1e-6)
    assert stats["bbox"]["max"] == pytest.approx([11, 5, 0], abs=1e-6)


def test_strips_fans_and_lines_count_what_they_draw(tmp_path):
    doc, binary = triangle_doc(index_count=5)
    doc["meshes"][0]["primitives"] = [
        {"attributes": {"POSITION": 0}, "indices": 1, "mode": 5},   # strip: 3
        {"attributes": {"POSITION": 0}, "indices": 1, "mode": 1},   # lines: 0
    ]
    (tmp_path / "t.glb").write_bytes(glb_bytes(doc, binary))
    stats = inspect_glb(tmp_path / "t.glb")
    assert stats["triangles"] == 3 and stats["draws"] == 2


@pytest.mark.parametrize("mutate, message", [
    (dict(magic=b"gltf"), "magic"),
    (dict(version=1), "version 1"),
    (dict(length_delta=4), "header says"),
])
def test_a_broken_container_is_refused(tmp_path, mutate, message):
    doc, binary = triangle_doc()
    (tmp_path / "t.glb").write_bytes(glb_bytes(doc, binary, **mutate))
    with pytest.raises(ModelRefused, match=message):
        inspect_glb(tmp_path / "t.glb")


def test_external_buffers_draco_and_missing_bounds_are_refused(tmp_path):
    doc, binary = triangle_doc()
    doc["buffers"][0]["uri"] = "model.bin"
    (tmp_path / "a.glb").write_bytes(glb_bytes(doc, binary))
    with pytest.raises(ModelRefused, match="outside the file"):
        inspect_glb(tmp_path / "a.glb")
    doc, binary = triangle_doc(extra={"extensionsRequired": ["KHR_draco_mesh_compression"]})
    (tmp_path / "b.glb").write_bytes(glb_bytes(doc, binary))
    with pytest.raises(ModelRefused, match="meshopt"):
        inspect_glb(tmp_path / "b.glb")
    doc, binary = triangle_doc(extra={"extensionsRequired": ["EXT_meshopt_compression"]})
    (tmp_path / "c.glb").write_bytes(glb_bytes(doc, binary))
    assert inspect_glb(tmp_path / "c.glb")["extensions_required"] == ["EXT_meshopt_compression"]
    doc, binary = triangle_doc()
    del doc["accessors"][0]["min"]
    (tmp_path / "d.glb").write_bytes(glb_bytes(doc, binary))
    with pytest.raises(ModelRefused, match="min/max"):
        inspect_glb(tmp_path / "d.glb")


def test_a_bundle_ships_the_glb_and_poster_named_and_addressed_by_their_bytes(tmp_path):
    glb = write_glb(tmp_path / "chair.glb")
    poster = tmp_path / "chair.jpeg"
    poster.write_bytes(b"\xff\xd8\xff\xe0fake jpeg")
    out = bundle_model(glb, "arcedit", "a chair", tmp_path / "b", poster=poster, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["kind"] == "model" and doc["id"] == out.name
    assert doc["model"] == "model.glb" and doc["poster"] == "poster.jpg"
    assert (out / "model.glb").read_bytes() == glb.read_bytes()
    assert doc["triangles"] == 1 and doc["draws"] == 1 and doc["size"] == [1, 1, 0]
    assert doc["source"]["bytes"] == glb.stat().st_size and doc["source"]["file_sha256"]
    assert set(doc["files"]) == {"model.glb", "poster.jpg"}
    assert content_type("model.glb") == "model/gltf-binary"
    rep = verify_local(out)
    assert not rep["mismatched"] and not rep["missing"] and not rep["unclaimed"]
    assert verify_bundle(out)["ok"]
    again = bundle_model(glb, "arcedit", "a chair", tmp_path / "b2", poster=poster, verbose=False)
    assert again.name == out.name, "the same bytes land at the same address"
    bare = bundle_model(glb, "arcedit", "a chair", tmp_path / "b3", verbose=False)
    assert bare.name != out.name and json.loads((bare / "bundle.json").read_text())["poster"] == ""
    urls = X.entry_urls(doc)
    base = f"https://media.weichseltree.com/{out.name}/"
    assert urls == {"url": base + "bundle.json", "thumb_url": base + "poster.jpg", "tape_url": ""}


def test_over_budget_is_refused_with_every_limit_named(tmp_path, monkeypatch):
    import orchard.bundle as B
    doc, binary = triangle_doc(primitives=3)
    doc["accessors"][0]["count"] = 3 * (MODEL_MAX_TRIANGLES + 1)
    (tmp_path / "big.glb").write_bytes(glb_bytes(doc, binary))
    monkeypatch.setattr(B, "MODEL_MAX_DRAWS", 2)
    with pytest.raises(ModelRefused) as err:
        bundle_model(tmp_path / "big.glb", "arcedit", "big", tmp_path / "b", verbose=False)
    assert "triangles" in str(err.value) and "draw calls > 2" in str(err.value)
    assert not (tmp_path / "b").exists() or not any((tmp_path / "b").iterdir())
    monkeypatch.setattr(B, "MODEL_MAX_BYTES", 10)
    with pytest.raises(ModelRefused, match="MB"):
        bundle_model(write_glb(tmp_path / "small.glb"), "arcedit", "s", tmp_path / "b", verbose=False)


def test_the_kind_reaches_harvest_scout_the_manifest_and_the_exhibit_table():
    from orchard.manifest import Artefact
    assert "model" in X.EXHIBIT_KINDS and "model" in harvest.BUNDLED_KINDS
    assert harvest._bundler("model") is bundle_model
    assert scout.MEDIA["model"] == ("*.glb",)
    assert Artefact(kind="model", path="env.glb").kind == "model"
    module = (Path(__file__).resolve().parents[1] / "spacetime" / "spacetimedb" / "src" / "index.ts").read_text()
    kinds = next(line for line in module.splitlines() if line.startswith("const EXHIBIT_KINDS"))
    assert all(f"'{k}'" in kinds for k in X.EXHIBIT_KINDS), "the CLI and the module agree on kinds"
