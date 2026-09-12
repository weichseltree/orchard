"""A width-1 channel comes back (n,), not (n, 1) -- pinned, because it WAS a trap.

`frame()` used to reshape every channel to (n, width), so a scalar channel like
`species` or `ke` arrived two-dimensional. That was defensible (one rule for all
widths) and it was a footgun with no error attached: the natural arithmetic

    mass = np.where(species == 0, 2.0, 1.0)     # (n, 1), not (n,)
    com  = (pos * mass[:, None]).sum(0) / ...   # (n, 1, 1) against (n, 3)

broadcasts to (n, n, 3) and the process dies with no traceback and no output.
On the R=55 tapes that is a 1.5 PB allocation from a line that reads correctly.
It cost four runs before it was spotted, and it was misdiagnosed twice as the
job wrappers killing the process, because the symptom is silence.

The reader now flattens width-1 channels, so the trap is UNREACHABLE rather
than documented. This file keeps the demonstration anyway: a fix explains
itself only while someone remembers what it fixed, and the (n, n, 3) case below
is the entire reason the rule exists.

Why the reader and not the format: every committed consumer already called
`.reshape(-1)`, so the repo was clean -- but that was one file's habits, not a
property of the format, and habits do not reach the next throwaway script.
Changing the reader makes those calls no-ops that stay correct, and changes no
tape on disk, which mattered because four members were mid-sweep.
"""
import numpy as np
from orchard_tape import TapeReader, TapeWriter


def _tape(tmp_path):
    w = TapeWriter(
        tmp_path / "t",
        box=(10.0, 10.0, 10.0),
        n_total=4,
        run_seed=1,
        mode="full",
        quantize="fp32",
        periodic=(False, False, False),
        scalars=(("species", "uint8"), "ke"),
    )
    w.append(step=0, time=0.0,
             pos=np.zeros((4, 3), np.float32),
             species=np.array([0, 1, 0, 1], np.uint8),
             ke=np.ones(4, np.float32))
    w.close()
    return TapeReader(tmp_path / "t")


def test_width_one_channel_is_one_dimensional(tmp_path):
    f = _tape(tmp_path).frame(0)
    assert f["species"].shape == (4,), (
        "a width-1 channel must be (n,); (n, 1) reintroduces the broadcast "
        "trap demonstrated below")
    assert f["ke"].shape == (4,)
    assert f["pos"].shape == (4, 3), "a real multi-component channel is 2-D"


def test_the_broadcast_that_used_to_kill_a_run(tmp_path):
    """The failure mode itself, so nobody has to rediscover it at 500k particles.

    The first half shows what (n, 1) did; the second shows the same line now
    doing the right thing because the reader hands back (n,). Keeping the bad
    case explicit is the point -- it is why the flatten is not gratuitous.
    """
    f = _tape(tmp_path).frame(0)

    two_d = f["species"].reshape(-1, 1)     # what the reader used to return
    mass_bad = np.where(two_d == 0, 2.0, 1.0)
    assert mass_bad.shape == (4, 1)
    assert (f["pos"] * mass_bad[:, None]).shape == (4, 4, 3), (
        "the silent killer: at n=508744 this is an (n, n, 3) allocation from "
        "a line that reads correctly -- no traceback, no output")

    mass = np.where(f["species"] == 0, 2.0, 1.0)
    assert mass.shape == (4,)
    assert (f["pos"] * mass[:, None]).shape == (4, 3), (
        "the same natural line is now correct as written")


def test_existing_callers_are_unaffected(tmp_path):
    """`.reshape(-1)` is what every committed consumer already does.

    This is the test that made the change safe to land: it is a no-op on (n,)
    and a flatten on (n, 1), so ep03_previews, ep03_sequence, mts/sequence and
    mts/tape_frame stay correct under either shape without being touched.
    """
    f = _tape(tmp_path).frame(0)
    for shaped in (f["species"], f["species"].reshape(-1, 1)):
        assert np.asarray(shaped).reshape(-1).shape == (4,)
