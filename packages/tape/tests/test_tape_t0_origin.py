"""The tape header must say what its t = 0 MEANS, and a migrated header must resume.

TAPE_WISHLIST SS6. SS1 already makes the header carry units, box, periodicity and
cadence because a renderer that guesses any of them draws the wrong picture. A
time origin is the same class of fact and was the last one left implicit -- and
it is the one whose absence fails worst: guessing units wrong makes an obviously
broken frame, while guessing the origin wrong makes a perfectly correct frame
confidently labelled with the wrong instant, which survives review.

A ball run with --relax-tdyn 1 opens its tape at the END of relaxation, so tape
t = 0 sits one t_dyn into the run's own clock. The film side was carrying that
as a hand-copied constant, which is exactly the thing that goes stale silently.
"""
import json, pathlib, tempfile
import numpy as np
import pytest

from orchard_tape import TapeWriter, TapeReader

N = 64
META = {"relaxation_steps_before_tape": 2910, "dt": 0.008, "t_dyn": 23.2812}


def _writer(tp, resume=False, **kw):
    return TapeWriter(tp, box=(10.0, 10.0, 10.0), n_total=N, run_seed=1,
                      mode="full", quantize="fp32", periodic=(False,) * 3,
                      meta=META, resume=resume, **kw)


def _pos():
    return (np.random.rand(N, 3) * 10).astype(np.float32)


def _migrate_by_hand(tp):
    """What spectre's `tools/migrate_tape_t0.py` does to a header, inlined: the
    tool is spectre's and stays there, and the property under test is only that
    a header whose t0 fields were rewritten after the fact still resumes."""
    h = json.loads((tp / "header.json").read_text())
    h["t0_offset_tau"] = (h["meta"]["relaxation_steps_before_tape"]
                          * h["meta"]["dt"])
    h["t0_origin"] = "end of relaxation"
    (tp / "header.json").write_text(json.dumps(h, indent=2))


def test_declared_origin_reaches_the_header():
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _writer(tp, t0_origin="end of relaxation", t0_offset_tau=23.28)
        w.append(step=0, time=0.0, pos=_pos())
        w.close()
        h = TapeReader(tp).header
        assert h["t0_origin"] == "end of relaxation"
        assert h["t0_offset_tau"] == pytest.approx(23.28)


def test_an_undeclared_origin_says_so_rather_than_implying_zero():
    """The default must not read as "the clocks agree" -- that is the wrong frame
    label, confidently applied."""
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _writer(tp)
        w.append(step=0, time=0.0, pos=_pos())
        w.close()
        h = TapeReader(tp).header
        assert h["t0_origin"] == "unspecified"
        assert h["t0_offset_tau"] is None


def test_a_migrated_header_still_accepts_a_resumed_writer():
    """The live sweep tapes were migrated with 33 chunks queued against them. A
    header comparison that rejected the new fields would have failed every
    resume, which is the same shape as the four chunking bugs already paid for."""
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _writer(tp)                                # opened pre-migration
        w.append(step=0, time=0.0, pos=_pos())
        w.append(step=10, time=1.0, pos=_pos())
        w.close()
        _migrate_by_hand(tp)
        w2 = _writer(tp, resume=True, t0_origin="end of relaxation",
                     t0_offset_tau=23.28)             # the queued-chunk case
        w2.append(step=20, time=2.0, pos=_pos())
        w2.close()
        r = TapeReader(tp)
        assert [f["t"] for f in r.frames] == [0.0, 1.0, 2.0]
        offs = [f["off"] for f in r.frames]
        # a resumed writer that restarts byte offsets points every appended
        # frame at the start of the file, and nothing downstream would notice
        assert offs == sorted(offs) and len(set(offs)) == 3


# --------------------------------------------------------------------------
# The resume guard itself: a comparison key that is not a header field compares
# None to None and passes on every tape forever. "n" was that key for the life
# of the tape format -- the header writes n_total -- so the particle count this
# guard advertised was never checked at open. Found by auditing every by-name
# read in the function after the film session hit the same shape twice.

def _seeded(tp, **kw):
    base = dict(box=(10.0, 10.0, 10.0), n_total=N, run_seed=1, mode="full",
                quantize="fp32", periodic=(False,) * 3, meta=META)
    base.update(kw)
    return TapeWriter(tp, **base)


def test_every_compared_key_is_a_real_header_field():
    """A name nobody writes is a check nobody runs."""
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _seeded(tp)
        w.append(step=0, time=0.0, pos=_pos())
        w.close()
        w2 = _seeded(tp, resume=True)          # must not raise
        w2.append(step=1, time=1.0, pos=_pos())
        w2.close()
        assert len(TapeReader(tp).frames) == 2


def test_resume_refuses_a_different_particle_count():
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _seeded(tp)
        w.append(step=0, time=0.0, pos=_pos())
        w.close()
        with pytest.raises(Exception) as e:
            _seeded(tp, n_total=N + 1, resume=True)
        assert "n_total" in str(e.value)


def test_resume_refuses_a_different_run_seed():
    """subset_indices is a pure function of (run_seed, mode, n_subset, n_total),
    so a changed seed splices a different particle population into one tape --
    and n_total does not move, so append()'s row check cannot see it."""
    with tempfile.TemporaryDirectory() as d:
        tp = pathlib.Path(d) / "tape"
        w = _seeded(tp)
        w.append(step=0, time=0.0, pos=_pos())
        w.close()
        with pytest.raises(Exception) as e:
            _seeded(tp, run_seed=999, resume=True)
        assert "run_seed" in str(e.value)
