import pytest

from orchard_score import (FIELDS, RATE_HZ, SCHEMA, NodeState, ScoreIntegrityError,
                           ScoreReader, ScoreWriter)


def _state(**over) -> NodeState:
    base = dict(rate=1.0, burstiness=0.1, template_entropy=0.5, fan_out=2,
                anomaly_z=0.0, health=1.0)
    base.update(over)
    return NodeState(**base)


def test_round_trip(tmp_path):
    path = tmp_path / "score.json"
    with ScoreWriter(path, provider="logswarm", run_seed=7) as w:
        w.append(0, 0.0, {"api": _state(rate=1.0), "db": _state(rate=2.0)})
        w.append(1, 0.1, {"api": _state(rate=1.5), "db": _state(rate=2.5)})

    r = ScoreReader(path)
    assert len(r) == 2
    assert r.rate_hz == RATE_HZ
    assert r.provider == "logswarm"
    assert r.run_seed == 7
    assert r.fields == FIELDS
    assert set(r.nodes) == {"api", "db"}
    assert r.value_at(0, "api", "rate") == 1.0
    assert r.value_at(1, "db", "rate") == 2.5


def test_frame_index_must_increase(tmp_path):
    w = ScoreWriter(tmp_path / "score.json")
    w.append(1, 0.1, {"api": _state()})
    with pytest.raises(ScoreIntegrityError):
        w.append(1, 0.2, {"api": _state()})
    with pytest.raises(ScoreIntegrityError):
        w.append(0, 0.0, {"api": _state()})


def test_unknown_field_raises(tmp_path):
    path = tmp_path / "score.json"
    with ScoreWriter(path) as w:
        w.append(0, 0.0, {"api": _state()})
    r = ScoreReader(path)
    with pytest.raises(KeyError):
        r.value_at(0, "api", "not_a_field")


def test_missing_frame_raises(tmp_path):
    path = tmp_path / "score.json"
    with ScoreWriter(path) as w:
        w.append(0, 0.0, {"api": _state()})
    r = ScoreReader(path)
    with pytest.raises(KeyError):
        r.frame(5)


def test_schema_mismatch_raises(tmp_path):
    path = tmp_path / "score.json"
    path.write_text('{"schema": "not/it", "rate_hz": 10, "fields": [], "nodes": [], "frames": []}')
    with pytest.raises(ScoreIntegrityError):
        ScoreReader(path)


def test_silence_share(tmp_path):
    path = tmp_path / "score.json"
    with ScoreWriter(path) as w:
        w.append(0, 0.0, {"api": _state(rate=0.0)})
        w.append(1, 0.1, {"api": _state(rate=0.0)})
        w.append(2, 0.2, {"api": _state(rate=5.0)})
    r = ScoreReader(path)
    near_silent = lambda fr: all(n.rate < 1.0 for n in fr.nodes.values())  # noqa: E731
    assert r.silence_share(near_silent) == pytest.approx(2 / 3)


def test_schema_string_is_versioned():
    assert SCHEMA == "orchard/score/1"
