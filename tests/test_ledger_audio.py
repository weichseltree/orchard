import json

from orchard.ledger import stream_usage


def test_stream_usage_groups_encode_hours_and_tts_cost_by_stream(tmp_path):
    entries = [
        {"stream_id": "repo-a", "provider": "logswarm", "kind": "encode", "hours": 0.5, "cost_usd": 0.12},
        {"stream_id": "repo-a", "provider": "logswarm", "kind": "encode", "hours": 1.0, "cost_usd": 0.24},
        {"stream_id": "repo-a", "provider": "logswarm", "kind": "tts", "cost_usd": 0.08},
        {"stream_id": "repo-b", "provider": "other", "kind": "encode", "hours": 2, "cost_usd": 0.5},
    ]
    (tmp_path / ".audio_usage.jsonl").write_text(
        "\n".join(json.dumps(entry) for entry in entries) + "\n"
    )

    assert stream_usage(tmp_path) == {
        "repo-a": {
            "provider": "logswarm",
            "encode_hours": 1.5,
            "encode_cost_usd": 0.36,
            "tts_cost_usd": 0.08,
        },
        "repo-b": {
            "provider": "other",
            "encode_hours": 2.0,
            "encode_cost_usd": 0.5,
            "tts_cost_usd": 0.0,
        },
    }


def test_stream_usage_ignores_malformed_or_invalid_records(tmp_path):
    (tmp_path / ".audio_usage.jsonl").write_text(
        "\n".join([
            "not json",
            json.dumps({"kind": "encode", "hours": 1}),
            json.dumps({"stream_id": "x", "kind": "unknown", "hours": 1}),
            json.dumps({"stream_id": "x", "kind": "encode", "hours": "not a number"}),
        ])
    )

    assert stream_usage(tmp_path) == {}


def test_stream_usage_returns_empty_when_no_meter_exists(tmp_path):
    assert stream_usage(tmp_path) == {}
