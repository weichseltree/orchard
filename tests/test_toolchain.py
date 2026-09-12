"""Toolchain: where each tool is, what version it says, and what the bundles record."""
import json
import shutil

import pytest

from orchard import toolchain as T


@pytest.fixture(autouse=True)
def _fresh_probes():
    T.probe.cache_clear()
    yield
    T.probe.cache_clear()


def fake_tool(path, banner: str):
    path.write_text(f"#!/bin/sh\necho '{banner}'\n")
    path.chmod(0o755)
    return str(path)


def test_an_expected_version_is_a_prefix_of_dotted_components():
    assert T.version_matches("6.1.1-3ubuntu5", "6.1.1")
    assert T.version_matches("22.17.1", "22") and T.version_matches("v22.17.1", "22")
    assert not T.version_matches("6.1.10", "6.1.1")
    assert not T.version_matches("7.1", "6.1.1") and not T.version_matches("21.9.0", "22")
    assert not T.version_matches(None, "22") and not T.version_matches("n/a", "22")


def test_every_tool_the_brief_names_is_expected_at_its_version():
    assert {n: t.expected for n, t in T.TOOLS.items()} == {
        "ffmpeg": "6.1.1", "toktx": "4.4.2", "blender": "4.2.1",
        "spacetime": "2.10.0", "wrangler": "4.131.1", "node": "22"}


def test_probe_reports_ok_mismatch_and_missing(tmp_path, monkeypatch):
    good = fake_tool(tmp_path / "toktx", "toktx v4.4.2")
    old = fake_tool(tmp_path / "toktx-old", "toktx v4.3.0")
    tool = T.TOOLS["toktx"]
    monkeypatch.setitem(T.TOOLS, "toktx", T.Tool(**{**tool.__dict__, "candidates": lambda: [None, good]}))
    p = T.probe("toktx")
    assert (p.status, p.version, p.path, p.banner) == ("ok", "4.4.2", good, "toktx v4.4.2")
    T.probe.cache_clear()
    monkeypatch.setitem(T.TOOLS, "toktx", T.Tool(**{**tool.__dict__, "candidates": lambda: [old, good]}))
    assert T.probe("toktx").status == "mismatch", "the first candidate that exists wins"
    T.probe.cache_clear()
    monkeypatch.setitem(T.TOOLS, "toktx", T.Tool(**{**tool.__dict__,
                        "candidates": lambda: [str(tmp_path / "nope"), None]}))
    assert T.probe("toktx").status == "missing" and T.resolve("toktx") is None


def test_the_banner_patterns_read_what_the_real_tools_print(tmp_path, monkeypatch):
    """The first lines as printed on SirBase, 2026-09-13."""
    said = {
        "ffmpeg": ("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers",
                   "6.1.1-3ubuntu5"),
        "blender": ("Blender 4.2.1 LTS", "4.2.1"),
        "spacetime": ("spacetimedb tool version 2.10.0; spacetimedb-lib version 2.10.0;", "2.10.0"),
        "wrangler": ("4.131.1", "4.131.1"),
        "node": ("v22.17.1", "22.17.1"),
        "toktx": ("toktx v4.4.2", "4.4.2"),
    }
    for name, (banner, version) in said.items():
        exe = fake_tool(tmp_path / name, banner)
        tool = T.TOOLS[name]
        monkeypatch.setitem(T.TOOLS, name, T.Tool(**{**tool.__dict__, "candidates": lambda e=exe: [e]}))
        p = T.probe(name)
        assert (p.version, p.banner, p.status) == (version, banner, "ok"), name


def test_the_grove_s_pinned_wrangler_wins_and_push_uses_it(tmp_path, monkeypatch):
    from orchard import push
    pinned = tmp_path / "grove/node_modules/.bin"
    pinned.mkdir(parents=True)
    exe = fake_tool(pinned / "wrangler", "4.131.1")
    monkeypatch.setattr(T, "ROOT", tmp_path)
    tool = T.TOOLS["wrangler"]
    # the candidate list is evaluated lazily, so ROOT is read at resolve time
    monkeypatch.setitem(T.TOOLS, "wrangler", T.Tool(**{**tool.__dict__, "candidates": lambda: [
        str(T.ROOT / "grove/node_modules/.bin/wrangler"), "/usr/bin/false"]}))
    assert T.resolve("wrangler") == exe == push.wrangler()


def test_doctor_prints_each_tool_against_its_expected_version(monkeypatch, capsys):
    from orchard import cli
    monkeypatch.setattr(T, "report", lambda: [
        T.Probe("ffmpeg", "6.1.1", "/usr/bin/ffmpeg", "6.1.1-3ubuntu5", "ffmpeg version 6.1.1"),
        T.Probe("blender", "4.2.1", "/x/blender", "4.1.0", "Blender 4.1.0"),
        T.Probe("node", "22", None, None, None)])
    monkeypatch.setattr("orchard.ledger.expdash_status", lambda: None)
    cli.main(["doctor"])
    out = capsys.readouterr().out
    rows = {line.split()[0]: line.split() for line in out.splitlines()
            if line.split() and line.split()[0] in ("ffmpeg", "blender", "node")}
    assert rows["ffmpeg"][1:4] == ["ok", "6.1.1-3ubuntu5", "6.1.1"]
    assert rows["blender"][1:4] == ["mismatch", "4.1.0", "4.2.1"]
    assert rows["node"][1:3] == ["missing", "-"]


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_a_still_bundle_records_the_ffmpeg_that_made_it(tmp_path):
    from orchard.bundle import bundle_still
    from test_still import make_png
    out = bundle_still(make_png(tmp_path / "f.png", 320, 200), "t", "t", tmp_path / "b",
                       verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["tools"] == {"ffmpeg": T.probe("ffmpeg").banner}
    assert doc["tools"]["ffmpeg"].startswith("ffmpeg version ")
    assert "/" not in doc["tools"]["ffmpeg"].split(" Copyright")[0], "no path in the id"
