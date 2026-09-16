"""`score.live.json`: the archive's document, as a rolling window (#14)."""
import json

import pytest

from orchard_score import LIVE_WINDOW, LiveScoreWriter, NodeState, SCHEMA, ScoreIntegrityError, ScoreReader


def _state(**over) -> NodeState:
    base = dict(rate=1.0, burstiness=0.1, template_entropy=0.5, fan_out=2, anomaly_z=0.0, health=1.0)
    base.update(over)
    return NodeState(**base)


def test_the_live_file_is_the_archived_document(tmp_path):
    # No second schema: the archive's reader reads it unchanged.
    path = tmp_path / "score.live.json"
    w = LiveScoreWriter(path, provider="logswarm", run_seed=7)
    w.append(0, 0.0, {"api": _state(rate=3.0)})
    r = ScoreReader(path)
    assert json.loads(path.read_text())["schema"] == SCHEMA
    assert r.provider == "logswarm"
    assert r.value_at(0, "api", "rate") == 3.0


def test_it_keeps_only_the_window(tmp_path):
    path = tmp_path / "score.live.json"
    w = LiveScoreWriter(path, window=3)
    for i in range(10):
        w.append(i, i / 10, {"api": _state(rate=float(i))})
    r = ScoreReader(path)
    assert len(r) == 3
    assert r.value_at(9, "api", "rate") == 9.0
    with pytest.raises(KeyError):
        r.frame(6)


def test_the_default_window_outlasts_a_one_second_poll():
    # The grove polls once a second at a 10 Hz score; fewer than 10 frames would drop some.
    assert LIVE_WINDOW > 10


def test_it_lists_only_the_nodes_still_in_the_window(tmp_path):
    path = tmp_path / "score.live.json"
    w = LiveScoreWriter(path, window=2)
    w.append(0, 0.0, {"gone": _state()})
    w.append(1, 0.1, {"api": _state()})
    w.append(2, 0.2, {"api": _state()})
    assert ScoreReader(path).nodes == ("api",)


def test_every_write_is_whole_and_leaves_no_temporary_file(tmp_path):
    # A reader polling mid-write must see a whole window, never half of one.
    path = tmp_path / "score.live.json"
    w = LiveScoreWriter(path)
    for i in range(5):
        w.append(i, i / 10, {"api": _state()})
        json.loads(path.read_text())
    assert sorted(p.name for p in tmp_path.iterdir()) == ["score.live.json"]


def test_indices_only_move_forward(tmp_path):
    w = LiveScoreWriter(tmp_path / "score.live.json")
    w.append(5, 0.5, {"api": _state()})
    with pytest.raises(ScoreIntegrityError):
        w.append(5, 0.6, {"api": _state()})


def test_a_window_of_nothing_is_refused(tmp_path):
    with pytest.raises(ValueError):
        LiveScoreWriter(tmp_path / "score.live.json", window=0)
