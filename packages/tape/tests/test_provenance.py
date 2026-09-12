"""The header's `git` field names the CALLER's commit, and the bytes are spectre's.

Two properties the extraction into a package could have broken without any
other test noticing:

1. `git` must describe the repository that produced the run. Installed, this
   module lives in site-packages (or, as a workspace member, inside orchard),
   and asking git about the module's own location would stamp every tape with
   "unknown" or with orchard's commit — a provenance field that reads fine
   and names the wrong code.
2. Every other byte must be what spectre's `core/video/tape.py` wrote. The
   golden tape under `data/` was written by spectre's copy at fd0f465 (see
   `data/README`), and the package must read it and write it again byte for
   byte.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from orchard_tape import TapeReader, TapeWriter

GOLDEN = Path(__file__).parent / "data" / "golden_fd0f465"

needs_git = pytest.mark.skipif(shutil.which("git") is None,
                               reason="git is not installed")


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def _repo(path: Path) -> str:
    path.mkdir(parents=True)
    _git(path, "init", "-q")
    (path / "run.py").write_text("print('a producer')\n")
    _git(path, "add", "run.py")
    _git(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c")
    return _git(path, "rev-parse", "--short", "HEAD")


def _one_frame(path, **kw):
    with TapeWriter(path, box=(1.0, 1.0, 1.0), n_total=2, run_seed=0,
                    quantize="fp32", **kw) as w:
        w.append(0, 0.0, np.full((2, 3), 0.5))
    return TapeReader(path).header


# ------------------------------------------------------------------- the git


@needs_git
def test_git_names_the_repo_the_caller_runs_in(tmp_path, monkeypatch):
    sha = _repo(tmp_path / "producer")
    monkeypatch.chdir(tmp_path / "producer")
    h = _one_frame(tmp_path / "tape")
    assert h["git"] == sha


@needs_git
def test_a_dirty_caller_says_so(tmp_path, monkeypatch):
    sha = _repo(tmp_path / "producer")
    (tmp_path / "producer" / "run.py").write_text("print('edited')\n")
    monkeypatch.chdir(tmp_path / "producer")
    assert _one_frame(tmp_path / "tape")["git"] == f"{sha}-dirty"


@needs_git
def test_the_packages_own_location_is_never_asked(tmp_path, monkeypatch):
    """Outside any repository the answer is `unknown` — NOT the commit of the
    repo this module happens to be installed from (orchard, for a workspace
    member), which would be a well-formed sha naming code that did not run."""
    outside = tmp_path / "not-a-repo"
    outside.mkdir()
    monkeypatch.chdir(outside)
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path))
    assert _one_frame(tmp_path / "tape")["git"] == "unknown"


def test_an_explicit_sha_wins_and_nothing_else_moves(tmp_path):
    a = _one_frame(tmp_path / "a", git_sha="abc1234")
    b = _one_frame(tmp_path / "b")
    assert a["git"] == "abc1234"
    assert list(a) == list(b), "the header's keys and their order are unchanged"
    a.pop("git"), b.pop("git")
    assert a == b


def test_git_sha_is_the_last_field_so_positional_calls_keep_their_meaning():
    import dataclasses
    names = [f.name for f in dataclasses.fields(TapeWriter)]
    assert names[-2:] == ["resume", "git_sha"]


# ------------------------------------------------------------ spectre's bytes


def golden_inputs():
    """The frames the golden tape was written from. Deterministic, and every
    channel kind at once: uint16 positions (some out of the box, so the
    clamp counter is exercised), velocity, a float scalar and a uint8 one, in
    subset mode so the derived membership is on the line too.

    Integer arithmetic, NOT `np.random`: NumPy promises nothing about its
    generator streams across versions (NEP 19), and a fixture whose inputs
    move with a `uv sync` fails for a reason that is not the tape's. (The
    subset membership does go through `default_rng` — that is the format's
    own dependency, and a NumPy that changed it SHOULD fail this test.)"""
    box = (10.0, 12.0, 8.0)
    n = 40
    i = np.arange(n, dtype=np.int64)

    def u(k, salt, width):
        """(n, width) in [0, 1) from integers alone: one LCG step, exact."""
        j = i[:, None] * width + np.arange(width, dtype=np.int64)[None, :]
        x = (j * 1103515245 + k * 12345 + salt * 2654435761) % 2147483648
        return x / 2147483648.0

    frames = []
    for k in range(4):
        pos = u(k, 1, 3) * np.asarray(box)
        if k == 2:
            pos[::4, 0] = box[0] + 0.5                 # clamped and counted
        frames.append(dict(step=10 * k, time=0.25 * k, pos=pos,
                           vel=u(k, 2, 3) - 0.5,
                           ke=u(k, 3, 1)[:, 0] * 3.0,
                           coordination=(u(k, 4, 1)[:, 0] * 13).astype(np.int64)))
    kw = dict(box=box, n_total=n, run_seed=77, mode="subset", n_subset=16,
              quantize="uint16", velocity=True,
              scalars=("ke", ("coordination", "uint8")),
              t0_origin="run start", t0_offset_tau=0.0,
              meta={"producer": "orchard_tape golden fixture"})
    return kw, frames


def write_golden(writer_cls, path):
    kw, frames = golden_inputs()
    with writer_cls(path, **kw) as w:
        for f in frames:
            w.append(f["step"], f["time"], f["pos"], vel=f["vel"], ke=f["ke"],
                     coordination=f["coordination"])


def test_spectres_golden_tape_reads_back(tmp_path):
    r = TapeReader(GOLDEN)
    kw, frames = golden_inputs()
    assert len(r) == len(frames)
    assert r.trailer["clamped_positions_total"] > 0     # the clamp is on the line
    f = r.frame(1)
    assert f["coordination"].dtype == np.uint8 and f["coordination"].shape == (16,)
    assert f["ke"].shape == (16,) and f["vel"].shape == (16, 3)


def test_the_package_writes_spectres_bytes(tmp_path):
    """data.bin, frames.jsonl and trailer.json byte for byte; header.json
    equal in every field but the two that describe the writing process."""
    write_golden(TapeWriter, tmp_path / "t")
    for name in ("data.bin", "frames.jsonl", "trailer.json"):
        assert (tmp_path / "t" / name).read_bytes() == (GOLDEN / name).read_bytes(), name
    mine = json.loads((tmp_path / "t" / "header.json").read_text())
    theirs = json.loads((GOLDEN / "header.json").read_text())
    assert list(mine) == list(theirs)
    for h in (mine, theirs):
        h.pop("git"), h.pop("env")
    assert mine == theirs
