import json

from orchard.bundle import bundle_audio, verify_bundle


def test_audio_bundle_covers_opus_tracks_and_score_bytes(tmp_path):
    track = tmp_path / "room.opus"
    track.write_bytes(b"OpusHead\x00test")
    score = tmp_path / "score.json"
    score.write_text(json.dumps({
        "schema": "orchard/score/1",
        "rate_hz": 10,
        "fields": [],
        "nodes": [],
        "frames": [],
    }))

    out = bundle_audio([track], score, tree="orchard", title="A room", out_root=tmp_path / "bundles", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())

    assert doc["kind"] == "audio"
    assert doc["tracks"] == ["room.opus"]
    assert doc["score_file"] == "score.json"
    assert doc["score_schema"] == "orchard/score/1"
    assert set(doc["files"]) == {"room.opus", "score.json"}
    assert verify_bundle(out)["ok"] is True


def test_audio_bundle_requires_an_opus_track_and_json_score(tmp_path):
    bad_track = tmp_path / "room.mp3"
    bad_track.write_bytes(b"not opus")
    score = tmp_path / "score.json"
    score.write_text("{}")

    import pytest

    with pytest.raises(ValueError, match=r"\.opus"):
        bundle_audio([bad_track], score, tree="orchard", title="A room", out_root=tmp_path / "bundles", verbose=False)
    with pytest.raises(ValueError, match="at least one"):
        bundle_audio([], score, tree="orchard", title="A room", out_root=tmp_path / "bundles", verbose=False)
    good_track = tmp_path / "room.opus"
    good_track.write_bytes(b"OpusHead")
    with pytest.raises(ValueError, match="expected 'orchard/score/1'"):
        bundle_audio([good_track], score, tree="orchard", title="A room", out_root=tmp_path / "bundles", verbose=False)
