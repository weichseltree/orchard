"""The chunked run's tape: a long story is a sequence of short jobs, each
appending to the one tape the film reads.

The tape half of spectre's `tests/test_adiabatic_and_chunking.py` (the ball and
the metrics reporter stay in spectre). spectre fed `torch` tensors; numpy
arrays here, because this package does not depend on torch and `_to_numpy`
treats both the same way.
"""
from __future__ import annotations

import numpy as np
import pytest

from orchard_tape import TapeIntegrityError, TapeReader, TapeWriter


def _write(path, steps, resume=False):
    w = TapeWriter(path, box=(10.0, 10.0, 10.0), n_total=4, run_seed=1,
                   quantize="fp32", periodic=(False, False, False),
                   scalars=(("ke", "float32"),), resume=resume)
    for s in steps:
        w.append(s, s * 0.1, np.full((4, 3), float(s)), species=None,
                 ke=np.zeros(4))
    w.close()


def test_a_resumed_tape_continues_instead_of_restarting(tmp_path):
    """The byte offset and the frame count must carry over: a writer that
    restarts them writes an index pointing every appended frame at byte 0."""
    d = tmp_path / "t"
    _write(d, [0, 1, 2])
    _write(d, [3, 4], resume=True)
    r = TapeReader(d)
    assert len(r) == 5
    for i in range(5):
        assert float(np.asarray(r.frame(i)["pos"])[0, 0]) == pytest.approx(i)


def test_a_tape_whose_shape_changed_refuses_the_append(tmp_path):
    d = tmp_path / "t"
    _write(d, [0, 1])
    with pytest.raises(TapeIntegrityError, match="cannot append"):
        TapeWriter(d, box=(11.0, 10.0, 10.0), n_total=4, run_seed=1,
                   quantize="fp32", periodic=(False, False, False),
                   scalars=(("ke", "float32"),), resume=True)


def test_resume_is_not_named_append(tmp_path):
    """`append` is the method that writes a frame. A dataclass field of that
    name shadows it and breaks every write on the class — which is what the
    first version of this feature did."""
    assert callable(TapeWriter.append)
