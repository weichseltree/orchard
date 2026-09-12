"""The tape, forced to fail on purpose.

A tape is a MEASUREMENT ARTIFACT: if it is wrong the film is wrong and there
is no way to tell from the film. So every property that a renderer relies on
is pinned here, and each assertion is written to fail against the specific
mistake it is guarding — not against a mutant nobody would write.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import warnings

import numpy as np
import pytest

from orchard_tape import (SCHEMA, TapeIntegrityError, TapeReader, TapeWriter,
                          subset_indices)


class Measured(UserWarning):
    """Not a problem: a measured number raised into pytest's warnings summary
    (spectre's `tests/conftest.py`, carried over with the tests that use it)."""


def announce(msg):
    print(msg)
    warnings.warn(msg, Measured, stacklevel=2)


BOX = (10.0, 10.0, 20.0)


def _walk(n, frames, seed=0, box=BOX, speed=0.05):
    """A deterministic drifting cloud — positions only, no physics."""
    rng = np.random.default_rng(seed)
    p = rng.random((n, 3)) * np.asarray(box)
    v = (rng.random((n, 3)) - 0.5) * speed
    for k in range(frames):
        yield k, k * 0.1, np.clip(p + k * v, 0, np.asarray(box) - 1e-6), v


def _write(tmp, n=64, frames=5, speed=0.05, **kw):
    w = TapeWriter(tmp / "tape", box=BOX, n_total=n, run_seed=1234, **kw)
    for step, t, p, v in _walk(n, frames, speed=speed):
        w.append(step, t, p, vel=v if kw.get("velocity") else None)
    w.close()
    return TapeReader(tmp / "tape")


# ------------------------------------------------------------- the subset


def test_the_subset_is_a_pure_function_of_the_header(tmp_path):
    """THE BUG THIS EXISTS FOR: a subset drawn at writer construction
    re-draws on resume, splicing two particle populations into one tape with
    every frame count still lining up."""
    a = subset_indices(10_000, 500, run_seed=42)
    b = subset_indices(10_000, 500, run_seed=42)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, subset_indices(10_000, 500, run_seed=43))
    assert len(np.unique(a)) == 500


def test_the_subset_survives_a_fresh_interpreter(tmp_path):
    """`hash()` on strings is SALTED PER PROCESS in CPython, so a
    hash()-derived subset differs between the run that wrote a tape and the
    run that resumed it. This is the test that catches that substitution —
    within one process the salt is constant and every other assertion passes.
    """
    prog = ("import numpy as np;from orchard_tape import subset_indices;"
            "print(','.join(map(str, subset_indices(10000, 20, 42))))")
    outs = set()
    for _ in range(2):
        r = subprocess.run([sys.executable, "-c", prog], capture_output=True,
                           text=True,
                           env={"PYTHONHASHSEED": "random", "PATH": "/usr/bin"})
        assert r.returncode == 0, r.stderr
        outs.add(r.stdout.strip())
    assert len(outs) == 1, "subset membership changed between processes"
    assert outs.pop() == ",".join(map(str, subset_indices(10000, 20, 42)))


def test_the_writer_re_derives_the_subset_and_refuses_a_tampered_one(tmp_path):
    """The re-derivation on append is not belt-and-braces: it is the only
    thing standing between "the header says which particles these are" and
    "the header says something, and the frames hold something else"."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=100, run_seed=5,
                   mode="subset", n_subset=10)
    w.append(0, 0.0, np.zeros((100, 3)))
    w._idx = np.arange(10)                     # a different population
    with pytest.raises(TapeIntegrityError, match="pure function"):
        w.append(1, 0.1, np.zeros((100, 3)))
    w.close()


def test_a_subset_tape_keeps_the_same_particles_every_frame(tmp_path):
    r = _write(tmp_path, n=200, frames=4, mode="subset", n_subset=40)
    assert all(f["n"] == 40 for f in r.frames)
    idx = subset_indices(200, 40, 1234)
    # the first frame's positions must BE those particles, not merely 40 of them
    _, _, p0, _ = next(iter(_walk(200, 1)))
    assert np.allclose(r.frame(0)["pos"], p0[idx], atol=BOX[2] / 65535.0)


# ------------------------------------------------------- round trip + bytes


def test_positions_round_trip_inside_the_declared_quantization(tmp_path):
    r = _write(tmp_path, n=128, frames=3)
    res = np.asarray(r.header["quantize_resolution"])
    _, _, p0, _ = next(iter(_walk(128, 1)))
    err = np.abs(r.frame(0)["pos"] - p0)
    assert (err <= res / 2 + 1e-6).all(), err.max()


def test_fp32_mode_is_exact_and_costs_double(tmp_path):
    q = _write(tmp_path / "q", n=100, frames=3)
    f = _write(tmp_path / "f", n=100, frames=3, quantize="fp32")
    _, _, p0, _ = next(iter(_walk(100, 1)))
    assert np.allclose(f.frame(0)["pos"], p0.astype(np.float32), atol=0)
    assert f.frames[0]["len"] == 2 * q.frames[0]["len"]


def test_a_position_outside_the_box_is_clamped_AND_COUNTED(tmp_path):
    """Rule 9. Silently folding a stray particle back into the box would draw
    it somewhere it never was, and the film would look fine."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=4, run_seed=1)
    p = np.array([[0., 0., 0.], [1., 1., 1.], [-5., 0., 0.], [0., 0., 99.]])
    w.append(0, 0.0, p)
    w.close()
    trailer = json.loads((tmp_path / "t" / "trailer.json").read_text())
    assert trailer["clamped_positions_total"] == 2


def test_an_out_of_box_position_lands_at_the_EDGE_and_never_wraps(tmp_path):
    """COUNTING THE CLAMP IS NOT ENOUGH — the count is identical whether the
    stray particle is pinned to the wall or wrapped to the far side, and a
    wrapped particle is drawn at the opposite end of the world from where it
    was. That is the rule-8 violation the count alone cannot see."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=2, run_seed=1)
    w.append(0, 0.0, np.array([[-5.0, 0.0, 0.0], [0.0, 0.0, 99.0]]))
    w.close()
    got = TapeReader(tmp_path / "t").frame(0)["pos"]
    assert got[0][0] == pytest.approx(0.0, abs=1e-4), "x below the box -> 0"
    assert got[1][2] == pytest.approx(BOX[2], rel=1e-4), "z above -> Lz"


# ------------------------------------------------------------ crash safety


def test_a_torn_final_line_costs_one_frame_and_no_more(tmp_path):
    r = _write(tmp_path, n=32, frames=6)
    idx = tmp_path / "tape" / "frames.jsonl"
    idx.write_text(idx.read_text()[:-12])          # kill mid-line
    r2 = TapeReader(tmp_path / "tape")
    assert len(r2) == 5
    assert np.allclose(r2.frame(4)["pos"], r.frame(4)["pos"])


def test_an_index_line_whose_payload_never_landed_is_dropped(tmp_path):
    """The other half of a kill: the index line flushed, the data did not."""
    r = _write(tmp_path, n=32, frames=6)
    d = tmp_path / "tape" / "data.bin"
    d.write_bytes(d.read_bytes()[: r.frames[-1]["off"] + 4])
    assert len(TapeReader(tmp_path / "tape")) == 5


# ------------------------------------------------------------ time sampling


def test_at_interpolates_linearly_between_samples(tmp_path):
    r = _write(tmp_path, n=16, frames=4)
    a, b = r.frame(1), r.frame(2)
    mid = r.at(0.5 * (a["t"] + b["t"]))
    assert mid["w"] == pytest.approx(0.5, abs=1e-6)
    assert np.allclose(mid["pos"], 0.5 * (a["pos"] + b["pos"]), atol=1e-5)


def test_at_clamps_outside_the_taped_interval_instead_of_extrapolating(tmp_path):
    """Extrapolation would invent trajectory beyond anything recorded."""
    r = _write(tmp_path, n=16, frames=4)
    assert np.allclose(r.at(-99.0)["pos"], r.frame(0)["pos"])
    assert np.allclose(r.at(+99.0)["pos"], r.frame(len(r) - 1)["pos"])


def test_an_roi_tape_refuses_to_interpolate_a_changing_population(tmp_path):
    """Two frames holding different particles have no correspondence to lerp
    along; averaging them would blend unrelated trajectories into a smooth
    lie. Nearest is the honest readout there."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=200, run_seed=7,
                   mode="roi", roi=((0., 0., 0.), (5., 5., 10.)))
    for step, t, p, _ in _walk(200, 3, speed=1.0):
        w.append(step, t, p)
    w.close()
    r = TapeReader(tmp_path / "t")
    # find an ADJACENT pair whose population actually differs — that is the
    # pair a lerp would blend, and asserting on any other pair proves nothing
    pair = next((i for i in range(len(r) - 1)
                 if r.frames[i]["n"] != r.frames[i + 1]["n"]), None)
    assert pair is not None, "the walk must push particles across the roi edge"
    t_mid = 0.5 * (r.frames[pair]["t"] + r.frames[pair + 1]["t"])
    with pytest.raises(TapeIntegrityError, match="fixed population"):
        r.at(t_mid)
    near = r.at(t_mid, interpolation="nearest")
    assert near["n"] in (r.frames[pair]["n"], r.frames[pair + 1]["n"])


def test_max_displacement_is_measured_not_assumed(tmp_path):
    """CORRECTED 2026-08-27: this test's own reference was the bug.

    It recomputed the displacement as a raw difference — the same formula the
    implementation used — so it agreed with a routine that reported a periodic
    wrap as a traverse of the whole box. A reference that mirrors the code
    checks that the code is self-consistent, not that it is right. The
    reference here now folds to the minimum image independently.
    """
    r = _write(tmp_path, n=64, frames=5, speed=0.4)
    m = r.max_displacement()
    assert m["max"] > 0 and m["between_frames"] is not None
    L = np.asarray(r.header["box"], dtype=np.float64)
    worst = 0.0
    for i in range(len(r) - 1):
        d = (r.frame(i + 1)["pos"] - r.frame(i)["pos"]).astype(np.float64)
        d -= L * np.round(d / L)
        worst = max(worst, float(np.sqrt((d ** 2).sum(1)).max()))
    assert m["max"] == pytest.approx(worst, rel=1e-9)
    # and it must be a real displacement, not a box crossing
    assert m["max"] < 0.5 * float(L.min()), (
        f"max displacement {m['max']} is over half the shortest box edge "
        f"{L.min()} — that is a wrap being counted as motion")


# -------------------------------------------------------------- provenance


def test_the_header_carries_what_a_measurement_carries(tmp_path):
    r = _write(tmp_path, n=16, frames=2)
    h = r.header
    assert h["schema"] == SCHEMA
    for k in ("git", "env", "box", "units", "run_seed", "mode",
              "quantize", "channels", "rendered_in_block"):
        assert k in h, k
    assert h["env"]["numpy"] == np.__version__
    assert h["rendered_in_block"] is True


def test_a_frame_whose_particle_count_changed_is_refused(tmp_path):
    """A tape whose n moves between frames cannot be interpolated at all, so
    it is refused at write time rather than discovered at render time."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=10, run_seed=1)
    w.append(0, 0.0, np.zeros((10, 3)))
    with pytest.raises(ValueError, match="n_total"):
        w.append(1, 0.1, np.zeros((9, 3)))
    w.close()


def test_a_reader_refuses_a_tape_from_another_schema(tmp_path):
    r = _write(tmp_path, n=8, frames=2)
    hp = tmp_path / "tape" / "header.json"
    h = json.loads(hp.read_text()); h["schema"] = "video/tape/999"
    hp.write_text(json.dumps(h))
    with pytest.raises(TapeIntegrityError, match="schema"):
        TapeReader(tmp_path / "tape")


def test_velocity_channel_round_trips_and_is_declared(tmp_path):
    r = _write(tmp_path, n=32, frames=3, velocity=True)
    assert [c["name"] for c in r.header["channels"]] == ["pos", "vel"]
    _, _, _, v = next(iter(_walk(32, 1)))
    assert np.allclose(r.frame(0)["vel"], v.astype(np.float32), atol=0)


# --------------------------------------------------- integer scalar channels
#
# A coordination count is a small integer. float32 spends four bytes on it and
# the storyboard's budget assumed one. The byte is worth having ONLY if the
# narrower channel cannot lie: a count that wraps at 256 recolours the densest
# particle in the frame as the emptiest, and rule 8 says the picture is then
# wrong with nothing in the picture to say so. Every test below is written
# against that specific lie, not against a mutant nobody would write.


def _write_scalar(tmp, spec, values, n=8, frames=3, **kw):
    """One tape, one declared scalar channel, `values` a per-frame callable."""
    w = TapeWriter(tmp, box=BOX, n_total=n, run_seed=1234, scalars=(spec,), **kw)
    for step, t, p, _ in _walk(n, frames):
        w.append(step, t, p, **{_scalar_name(spec): values(step)})
    w.close()
    return TapeReader(tmp)


def _scalar_name(spec):
    return spec if isinstance(spec, str) else spec[0]


def test_an_integer_channel_costs_its_dtype_and_no_more(tmp_path):
    """The whole point of the feature: one byte per particle per frame, not
    four. If this passes at 4 bytes the channel bought nothing."""
    n, frames = 8, 3
    u8 = _write_scalar(tmp_path / "u8", ("c", "uint8"),
                       lambda k: np.full(n, 3), n=n, frames=frames)
    u16 = _write_scalar(tmp_path / "u16", ("c", "uint16"),
                        lambda k: np.full(n, 3), n=n, frames=frames)
    f32 = _write_scalar(tmp_path / "f32", "c",
                        lambda k: np.full(n, 3.0), n=n, frames=frames)
    pos_bytes = n * 3 * 2
    assert u8.frames[0]["len"] == pos_bytes + n * 1
    assert u16.frames[0]["len"] == pos_bytes + n * 2
    assert f32.frames[0]["len"] == pos_bytes + n * 4


def test_an_integer_channel_reads_back_as_integers_not_floats(tmp_path):
    """`frame()` returning float32 for a count is not a cosmetic difference:
    downstream `== 12` comparisons and bincounts silently stop matching."""
    n = 8
    counts = np.arange(n, dtype=np.int64) + 1
    r = _write_scalar(tmp_path / "t", ("coordination", "uint8"),
                      lambda k: counts, n=n, frames=2)
    got = r.frame(0)["coordination"]
    assert got.dtype == np.uint8, got.dtype
    assert np.array_equal(got.reshape(-1), counts.astype(np.uint8))


def test_the_header_declares_the_dtype_and_the_representable_range(tmp_path):
    """A reader that must decide whether to lerp a channel cannot infer the
    cap from the bytes — 255 in a uint8 channel and 255 in a uint16 one are
    the same byte pattern and different distances from the ceiling."""
    r = _write_scalar(tmp_path / "t", ("c", "uint16"),
                      lambda k: np.full(8, 300), frames=2)
    ch = {c["name"]: c for c in r.header["channels"]}
    assert ch["c"]["dtype"] == "uint16"
    assert ch["c"]["range"] == [0, 65535]
    assert ch["c"]["interpolation"] == "nearest"
    assert ch["pos"]["range"] is None, "a quantized position is not a count"
    assert ch["pos"]["interpolation"] == "linear"


def test_a_count_above_the_cap_raises_naming_channel_value_and_cap(tmp_path):
    """THE BUG THIS EXISTS FOR: `astype(uint8)` turns 260 into 4, and 4 is a
    perfectly ordinary coordination number. Nothing downstream can tell."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=4, run_seed=1,
                   scalars=(("coordination", "uint8"),))
    bad = np.array([2, 5, 260, 1])
    with pytest.raises(ValueError) as e:
        w.append(0, 0.0, np.zeros((4, 3)), coordination=bad)
    msg = str(e.value)
    assert "coordination" in msg, msg
    assert "260" in msg, msg
    assert "255" in msg, msg
    assert "2" in msg, "the offending index is worth naming too"
    w.close()


def test_the_cap_is_not_saturated_to(tmp_path):
    """Saturation is the silent version of the same bug — it keeps the frame
    plausible and puts the wrong particle at the top of the colour ramp. The
    tape must hold no frame at all rather than a saturated one."""
    p = tmp_path / "t"
    w = TapeWriter(p, box=BOX, n_total=3, run_seed=1,
                   scalars=(("c", "uint8"),))
    w.append(0, 0.0, np.zeros((3, 3)), c=np.array([1, 2, 3]))
    with pytest.raises(ValueError):
        w.append(1, 0.1, np.zeros((3, 3)), c=np.array([1, 2, 999]))
    w.close()
    r = TapeReader(p)
    assert len(r) == 1, "the refused frame must not be on the tape"
    assert 255 not in r.frame(0)["c"]


def test_a_negative_count_raises_rather_than_wrapping_to_the_top(tmp_path):
    """uint8(-1) is 255: the emptiest particle in the frame drawn as the
    densest. Exactly the inversion the eye cannot catch."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=2, run_seed=1,
                   scalars=(("c", "uint8"),))
    with pytest.raises(ValueError) as e:
        w.append(0, 0.0, np.zeros((2, 3)), c=np.array([-1, 4]))
    assert "-1" in str(e.value) and "255" in str(e.value)
    w.close()


def test_a_non_integral_value_raises_instead_of_truncating(tmp_path):
    """3.5 -> 3 is the failure mode this channel is guarding: a float dressed
    as a count, rounded toward zero by the cast, with no record of it."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=3, run_seed=1,
                   scalars=(("c", "uint8"),))
    with pytest.raises(ValueError) as e:
        w.append(0, 0.0, np.zeros((3, 3)), c=np.array([1.0, 3.5, 2.0]))
    msg = str(e.value)
    assert "3.5" in msg and "not an integer" in msg, msg
    assert "'c'" in msg, msg
    w.close()


def test_a_float_channel_still_takes_non_integral_values(tmp_path):
    """The check must be scoped to integer channels; a speed of 3.5 is fine."""
    r = _write_scalar(tmp_path / "t", "speed",
                      lambda k: np.full(8, 3.5), frames=2)
    assert np.allclose(r.frame(0)["speed"], 3.5)


def test_at_refuses_to_interpolate_an_integer_channel(tmp_path):
    """A lerp between coordinations 8 and 12 gives 10.0 at the midpoint — a
    coordination no particle in either frame had. The float channel beside it
    IS lerped, so this pins the per-channel behaviour, not a global switch."""
    n = 8
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=n, run_seed=1,
                   scalars=(("coordination", "uint8"), "speed"))
    w.append(0, 0.0, np.zeros((n, 3)),
             coordination=np.full(n, 8), speed=np.full(n, 8.0))
    w.append(1, 1.0, np.zeros((n, 3)),
             coordination=np.full(n, 12), speed=np.full(n, 12.0))
    w.close()
    r = TapeReader(tmp_path / "t")

    mid = r.at(0.4)
    assert mid["channel_interpolation"] == {
        "pos": "linear", "coordination": "nearest", "speed": "linear"}
    assert mid["nearest_frame"] == 0
    assert np.array_equal(mid["coordination"].reshape(-1), np.full(n, 8))
    assert mid["coordination"].dtype == np.uint8
    assert np.allclose(mid["speed"], 9.6)

    late = r.at(0.6)
    assert late["nearest_frame"] == 1
    assert np.array_equal(late["coordination"].reshape(-1), np.full(n, 12))
    assert np.allclose(late["speed"], 10.4)


def test_every_at_path_declares_what_it_actually_did(tmp_path):
    """`interpolation` is what was asked for and `channel_interpolation` is
    what was done. A caller colouring by a count must be able to read the
    second one unconditionally, not guess which branch of `at` fired."""
    r = _write_scalar(tmp_path / "t", ("c", "uint8"),
                      lambda k: np.full(8, k + 1), frames=3)
    for got in (r.at(-99.0), r.at(+99.0), r.at(0.05, interpolation="nearest"),
                r.at(0.05)):
        assert got["channel_interpolation"]["c"] == "nearest", got
        assert got["nearest_frame"] is not None


def test_the_declared_dtype_is_checked_at_construction(tmp_path):
    with pytest.raises(ValueError, match="uint8"):
        TapeWriter(tmp_path / "t", box=BOX, n_total=2, run_seed=1,
                   scalars=(("c", "int8"),))
    with pytest.raises(ValueError, match="uint8"):
        TapeWriter(tmp_path / "t2", box=BOX, n_total=2, run_seed=1,
                   scalars=(("c", "float64"),))


def test_a_scalar_of_the_wrong_length_is_refused(tmp_path):
    """A short scalar array is written as a short payload, and every channel
    after it in the frame is then read back misaligned against pos."""
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=4, run_seed=1,
                   scalars=("c",))
    with pytest.raises(ValueError, match="n_total"):
        w.append(0, 0.0, np.zeros((4, 3)), c=np.zeros(3))
    w.close()


def test_an_integer_channel_survives_a_subset_tape(tmp_path):
    """The subset selection happens after the check, so the values that reach
    the file are the taped particles' own counts and not a shifted window."""
    n = 40
    counts = np.arange(n, dtype=np.int64) % 200
    w = TapeWriter(tmp_path / "t", box=BOX, n_total=n, run_seed=1234,
                   mode="subset", n_subset=10, scalars=(("c", "uint8"),))
    w.append(0, 0.0, np.zeros((n, 3)), c=counts)
    w.close()
    idx = subset_indices(n, 10, 1234)
    got = TapeReader(tmp_path / "t").frame(0)["c"].reshape(-1)
    assert np.array_equal(got, counts[idx].astype(np.uint8))


# ------------------------------------------------------- back-compatibility


def test_a_plain_string_scalar_is_byte_identical_to_before_dtypes(tmp_path):
    """THE PIN. `scalars=("foo",)` predates dtypes and existing tapes are
    written that way. The sha is of `data.bin` from a deterministic tape,
    recorded from the code BEFORE integer channels existed; if the float32
    path ever grows a header byte, a reordering or a cast, this fails."""
    p = tmp_path / "t"
    w = TapeWriter(p, box=BOX, n_total=8, run_seed=1234, scalars=("foo",))
    rng = np.random.default_rng(7)
    for k in range(3):
        w.append(k, k * 0.1, rng.random((8, 3)) * np.asarray(BOX),
                 foo=np.arange(8, dtype=np.float64) + k)
    w.close()
    blob = (p / "data.bin").read_bytes()
    assert len(blob) == 3 * 8 * (3 * 2 + 4)
    assert hashlib.sha256(blob).hexdigest() == (
        "cd4aecd024185615979b9fae958e3142306ab973a8b769f8d70b3c5a3e1ed484")

    r = TapeReader(p)
    ch = {c["name"]: c for c in r.header["channels"]}
    assert ch["foo"]["dtype"] == "float32" and ch["foo"]["width"] == 1
    assert np.allclose(r.frame(2)["foo"].reshape(-1), np.arange(8) + 2)
    assert r.frame(2)["foo"].dtype == np.float32


def test_a_tape_written_before_this_change_still_opens(tmp_path):
    """Built BY HAND in the old header format — no `range`, no
    `interpolation`, no `channel_dtype_note` — because the only honest test
    of back-compat is a header this version of the writer cannot produce."""
    p = tmp_path / "old"
    p.mkdir()
    n, box = 5, [10.0, 10.0, 20.0]
    old_header = {
        "schema": SCHEMA,
        "box": box,
        "units": "reduced (sigma, tau)",
        "n_total": n,
        "run_seed": 99,
        "mode": "full",
        "n_subset": None,
        "roi": None,
        "quantize": "uint16",
        "quantize_resolution": [L / 65535.0 for L in box],
        "channels": [
            {"name": "pos", "dtype": "uint16", "width": 3, "quantized": True},
            {"name": "vel", "dtype": "float32", "width": 3, "quantized": False},
            {"name": "foo", "dtype": "float32", "width": 1, "quantized": False},
        ],
        "git": "deadbee",
        "env": {"numpy": "1.0.0"},
        "rendered_in_block": True,
        "meta": {},
    }
    (p / "header.json").write_text(json.dumps(old_header))

    pos = np.array([[i, i, 2.0 * i] for i in range(n)], dtype=np.float64)
    vel = np.full((n, 3), 0.25, dtype=np.float32)
    foo = np.arange(n, dtype=np.float32)
    q = np.clip(pos / np.asarray(box) * 65535.0, 0, 65535).round().astype(np.uint16)
    blob = q.tobytes() + vel.tobytes() + foo.tobytes()
    (p / "data.bin").write_bytes(blob + blob)
    (p / "frames.jsonl").write_text(
        json.dumps({"i": 0, "step": 0, "t": 0.0, "n": n, "off": 0,
                    "len": len(blob)}) + "\n" +
        json.dumps({"i": 1, "step": 4, "t": 0.5, "n": n, "off": len(blob),
                    "len": len(blob)}) + "\n")

    r = TapeReader(p)
    assert len(r) == 2
    f = r.frame(0)
    assert np.allclose(f["pos"], pos, atol=box[2] / 65535.0)
    assert np.allclose(f["vel"], 0.25, atol=0)
    assert np.allclose(f["foo"].reshape(-1), foo, atol=0)
    # and it still interpolates: nothing in the old header marks a channel
    # integer, so every channel keeps the pre-change rule
    mid = r.at(0.25)
    assert mid["channel_interpolation"] == {
        "pos": "linear", "vel": "linear", "foo": "linear"}
    assert r.max_displacement()["max"] == pytest.approx(0.0, abs=1e-3)


# --------------------------------------------------------------- periodicity
#
# Found 2026-08-27 by running E02 with --tape for the first time: a 6x6x5 slab
# reported a max displacement of 14.44 sigma in a box 14.5 sigma across. The
# instrument was returning the BOX SIZE. A particle stepping from L-eps to eps
# has taken one short step, not a traverse, and both consumers of that
# displacement — the cadence bound and the interpolation — were reading the
# long way round.
#
# It matters twice over. The bound is the whole justification for interpolating
# between tape frames at all, so an inflated bound would have condemned a tape
# that was fine; and a straight lerp across the seam draws a particle sweeping
# the full width of the frame at enormous speed, a motion that never happened,
# in full view (AGENTS rule 8).


def _seam_tape(tmp_path, L=(10.0, 10.0, 10.0), x0=9.9, x1=0.1):
    """One particle taking a 0.2 step ACROSS the x boundary."""
    d = tmp_path / "seam"
    with TapeWriter(d, box=L, n_total=1, run_seed=1) as w:
        w.append(step=0, time=0.0, pos=np.array([[x0, 5.0, 5.0]]))
        w.append(step=8, time=1.0, pos=np.array([[x1, 5.0, 5.0]]))
    return TapeReader(d)


def test_a_wrap_is_one_short_step_not_a_traverse_of_the_box(tmp_path):
    m = _seam_tape(tmp_path).max_displacement()
    # the raw difference would be 9.8; the motion is 0.2
    assert m["max"] == pytest.approx(0.2, abs=0.01), (
        f"max_displacement={m['max']} — that is the box, not the motion")


def test_the_displacement_says_which_axes_it_folded(tmp_path):
    m = _seam_tape(tmp_path).max_displacement()
    assert m["periodic"] == [True, True, True]
    assert m["periodic_assumed"] is False
    assert "minimum image" in m["meaning"].lower()


def test_interpolating_across_the_seam_takes_the_short_path(tmp_path):
    mid = _seam_tape(tmp_path).at(0.5, interpolation="linear")
    x = float(mid["pos"][0, 0])
    # the short path passes through the boundary; a straight lerp says 5.0,
    # which is the particle crossing the whole box in half a frame
    assert min(abs(x - 0.0), abs(x - 10.0)) < 0.02, (
        f"interpolated to x={x} — it went the long way round")


def test_an_interpolated_position_stays_inside_the_box(tmp_path):
    """fp64 `mod` can leave a value a hair under L that fp32 rounds UP to L.

    Measured on exactly this case: the midpoint came back as 10.0 in a box of
    length 10, which is outside the [0, L) the tape promises and which the
    quantizer would clamp on a re-write.
    """
    mid = _seam_tape(tmp_path).at(0.5, interpolation="linear")
    x = float(mid["pos"][0, 0])
    assert 0.0 <= x < 10.0, f"x={x!r} is outside [0, L)"


def test_a_non_periodic_axis_is_not_folded(tmp_path):
    """Folding a non-periodic axis would HIDE a real traverse."""
    d = tmp_path / "open"
    with TapeWriter(d, box=(10.0, 10.0, 10.0), n_total=1, run_seed=1,
                    periodic=(False, True, True)) as w:
        w.append(step=0, time=0.0, pos=np.array([[9.9, 5.0, 5.0]]))
        w.append(step=8, time=1.0, pos=np.array([[0.1, 5.0, 5.0]]))
    m = TapeReader(d).max_displacement()
    assert m["max"] == pytest.approx(9.8, abs=0.01), (
        "a non-periodic axis was folded — a real 9.8 traverse was hidden")


def test_a_tape_without_the_periodic_field_says_it_assumed(tmp_path):
    """Back-compat: older tapes carry no `periodic`. All-periodic is the right
    reading, but it is an assumption and must be reported as one."""
    r = _seam_tape(tmp_path)
    hdr = json.loads((r.path / "header.json").read_text())
    del hdr["periodic"]
    (r.path / "header.json").write_text(json.dumps(hdr))
    m = TapeReader(r.path).max_displacement()
    assert m["periodic_assumed"] is True
    assert m["max"] == pytest.approx(0.2, abs=0.01)


# ------------------------------------------------------- a clock only goes forward
#
# Found 2026-08-27 by an agent building the V00 shots against a tape E02 had
# already written and every instrument had already passed. E02's tape hook
# numbered production's steps from zero again, so a `--tape-phase both` tape
# folded back at the phase boundary: frame 123 -> 124 went step 496 -> 4, t
# 1.984 -> 0.016.
#
# Why nothing caught it. The file was written. The frame count was right. The
# header was right. `max_displacement()` still returned a plausible 0.0682
# sigma, because POSITIONS are continuous across the fold even when the CLOCK
# is not. Only `at()` fails, and it fails by silently searchsorting into the
# wrong half rather than by raising. A silent success (AGENTS rule 12).
#
# The guard lives in the WRITER because that is the one place that sees every
# frame of every tape, and because a tape that cannot be read by time should
# never reach the disk in the first place.


def test_a_tape_refuses_a_step_that_goes_backwards(tmp_path):
    d = tmp_path / "fold"
    with TapeWriter(d, box=(10.0, 10.0, 10.0), n_total=1, run_seed=1) as w:
        w.append(step=0, time=0.0, pos=np.zeros((1, 3)))
        w.append(step=8, time=1.0, pos=np.zeros((1, 3)))
        with pytest.raises(ValueError) as e:
            w.append(step=4, time=2.0, pos=np.zeros((1, 3)))
    m = str(e.value)
    assert "backwards" in m and "8" in m and "4" in m
    assert "number the second one" in m, "the message must say how to fix it"


def test_a_tape_refuses_a_time_that_goes_backwards(tmp_path):
    """The exact E02 shape: BOTH step and t fold, but either alone must fire."""
    d = tmp_path / "tfold"
    with TapeWriter(d, box=(10.0, 10.0, 10.0), n_total=1, run_seed=1) as w:
        w.append(step=0, time=0.0, pos=np.zeros((1, 3)))
        w.append(step=8, time=1.0, pos=np.zeros((1, 3)))
        with pytest.raises(ValueError, match="backwards"):
            w.append(step=16, time=0.016, pos=np.zeros((1, 3)))


def test_a_repeated_step_is_refused_too(tmp_path):
    """Equal is not forward. Two frames at one instant make `at()` ambiguous."""
    d = tmp_path / "dup"
    with TapeWriter(d, box=(10.0, 10.0, 10.0), n_total=1, run_seed=1) as w:
        w.append(step=0, time=0.0, pos=np.zeros((1, 3)))
        with pytest.raises(ValueError, match="backwards"):
            w.append(step=0, time=0.0, pos=np.zeros((1, 3)))


def test_the_guard_does_not_fire_on_an_ordinary_tape(tmp_path):
    """It must not cost a correct caller anything."""
    d = tmp_path / "fine"
    with TapeWriter(d, box=(10.0, 10.0, 10.0), n_total=2, run_seed=1) as w:
        for i in range(12):
            w.append(step=i * 4, time=i * 0.016, pos=np.zeros((2, 3)))
    r = TapeReader(d)
    assert len(r) == 12
    # and the whole timeline is reachable BY TIME, which is what the fold broke
    assert r.at(0.10, interpolation="linear")["t"] == pytest.approx(0.10)


# =============================== THE SCAN THAT RAN EIGHT TIMES A JOB


def _scan_counter(monkeypatch):
    """Count the scans that actually happen, not the calls.

    THIS COUNTER HAS BEEN WRONG TWICE and each version passed something it
    should have failed, so it is worth stating what it does now. A scan is a
    DISTINCT result object whose own `source` says COMPUTED.

      * inferring from the memo's state before the call hid a missing memo
        entirely: with it deleted, the second call read the DISK cache the
        first had written, the counter saw one scan, and the test passed
        against code with no memo at all;
      * counting the provenance STRING over-counted, because a memo hit
        returns the same dict and that dict correctly still says COMPUTED.
    """
    n = {"scans": 0}
    seen: set[int] = set()
    real = TapeReader.max_displacement

    def counted(self, **kw):
        out = real(self, **kw)
        # DISTINCT COMPUTED RESULTS, by identity. A memo hit returns the SAME
        # dict object, and its provenance still says COMPUTED — correctly, it
        # WAS computed in this process — so counting the string over-counts
        # every memo hit as a fresh scan. A real scan builds a new dict.
        if (str(out.get("source", "")).startswith("COMPUTED")
                and id(out) not in seen):
            seen.add(id(out))
            n["scans"] += 1
        return out

    monkeypatch.setattr(TapeReader, "max_displacement", counted)
    return n


def test_the_full_tape_scan_happens_ONCE_per_reader(tmp_path, monkeypatch):
    """MEASURED, and the reason is arithmetic. `max_displacement` walks every
    frame of the tape — 26.3 s on the V00 tape's 43750 frames — and
    `Shot.check_cadence` calls it. `v00.film()` builds the whole shot AND one
    per segment, and `render_shot` calls it again for the manifest, so a
    single chunk job paid for the same pure function of an immutable file
    several times over.

    The memo is safe for a reason worth stating: `self.frames` is a snapshot
    taken at construction, so this reader's view of the tape cannot grow, so a
    quantity derived from it cannot go stale within its lifetime.
    """
    n = _scan_counter(monkeypatch)
    r = _write(tmp_path, n=32, frames=12)
    # cache=False on purpose: this test is about the MEMO, and with the disk
    # cache enabled it would pass against a reader with no memo at all — the
    # second call would simply read the file the first one wrote. Measured:
    # that is exactly how the first version of this test passed a sabotage.
    a = r.max_displacement(cache=False)
    b = r.max_displacement(cache=False)
    c = r.max_displacement(cache=False)
    assert n["scans"] == 1, f"{n['scans']} scans for three calls"
    assert a["max"] == b["max"] == c["max"]
    assert a["source"].startswith("COMPUTED")
    announce(f"[tape] three calls, {n['scans']} scan; the V00 tape's scan is "
             f"26.3 s and a chunk job made several")


def test_a_SECOND_reader_reads_the_cache_instead_of_rescanning(tmp_path,
                                                               monkeypatch):
    """The memo fixes one job. The 33 chunk jobs are 33 processes, and the
    scan is a pure function of bytes that do not change between them."""
    n = _scan_counter(monkeypatch)
    r = _write(tmp_path, n=32, frames=12)
    first = r.max_displacement()
    second = TapeReader(tmp_path / "tape").max_displacement()
    assert n["scans"] == 1
    assert second["max"] == first["max"]
    assert second["source"].startswith("READ from")
    assert (tmp_path / "tape" / "max_displacement.json").exists()


def test_a_tape_that_GREW_misses_the_cache_and_rescans(tmp_path, monkeypatch):
    """THE STALENESS GUARD, and the one that matters: a cache keyed on nothing
    would hand a longer tape the shorter tape's answer, and the cadence check
    — whose entire job is to catch a tape too coarse for its shot — would pass
    on a number measured over frames the film no longer uses."""
    import shutil

    n = _scan_counter(monkeypatch)
    short = _write(tmp_path, n=32, frames=12, speed=0.05)
    small = short.max_displacement()["max"]
    assert (tmp_path / "tape" / "max_displacement.json").exists()

    # the SAME run, recorded longer -- which is what a tape that is still
    # being written looks like to the next job along
    w = TapeWriter(tmp_path / "tape2", box=BOX, n_total=32, run_seed=1234)
    for step, t, pos, _v in _walk(32, 40, speed=0.05):
        w.append(step, t, pos)
    w.close()
    shutil.copy(tmp_path / "tape" / "max_displacement.json",
                tmp_path / "tape2" / "max_displacement.json")

    got = TapeReader(tmp_path / "tape2").max_displacement()
    assert got["source"].startswith("COMPUTED"), (
        f"the 12-frame tape's cache was accepted for a 40-frame tape "
        f"({got['source']}); the key did not bind, and `check_cadence` -- "
        "whose whole job is catching a tape too coarse for its shot -- would "
        "have passed on a number measured over frames the film does not use")
    assert got["frames"] == 40
    # the max itself does not move here -- the walk is at constant velocity,
    # so every frame gap is the same displacement. That is deliberate: it
    # makes the test depend on the KEY binding and not on the answer happening
    # to differ, which is the case a cache silently gets wrong.
    announce(f"[tape] a 12-frame tape's cache is rejected by a 40-frame one "
             f"(frames {got['frames']}, rescanned); both measure "
             f"{small:.4f}, so only the key can catch it")


def test_the_cache_records_which_tape_it_belongs_to(tmp_path):
    r = _write(tmp_path, n=32, frames=12)
    r.max_displacement()
    d = json.loads((tmp_path / "tape" / "max_displacement.json").read_text())
    assert d["key"]["n_frames"] == 12
    assert d["key"]["schema"] == SCHEMA
    assert d["key"]["data_bytes"] == (tmp_path / "tape" / "data.bin").stat().st_size
    assert len(d["key"]["header_sha256"]) == 16


def test_a_cache_that_cannot_be_WRITTEN_does_not_break_the_render(tmp_path):
    """A read-only results directory must cost a rescan, not a crashed job
    half an hour into a lane."""
    r = _write(tmp_path, n=32, frames=12)
    d = tmp_path / "tape"
    mode = d.stat().st_mode
    try:
        d.chmod(0o500)
        out = TapeReader(d).max_displacement()
    finally:
        d.chmod(mode)
    assert out["max"] is not None
    assert "not written" in out["cached_to"], out["cached_to"]


def test_the_cache_can_be_turned_off_and_then_it_really_scans(tmp_path,
                                                              monkeypatch):
    """Guards the guard: a test suite that never scans would pass against a
    `max_displacement` that returned a constant."""
    n = _scan_counter(monkeypatch)
    r = _write(tmp_path, n=32, frames=12)
    r.max_displacement()
    r2 = TapeReader(tmp_path / "tape")
    r2.max_displacement(cache=False)
    assert n["scans"] == 2, (
        "a fresh reader with the disk cache disabled did not rescan, so this "
        "suite would pass against a max_displacement that returned a constant")
