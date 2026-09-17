"""The club floor's stream: the rules that decide what is published and when, and the generator that plays."""
import json
import shutil
import threading
import time
from pathlib import Path

import numpy as np
import pytest

from orchard import setgen, stream

PLAYLIST_TEXT = """#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.000000,
seg000012.m4s
#EXTINF:2.000000,
seg000013.m4s
#EXTINF:2.000000,
seg000014.m4s
"""


def test_playlist_media_names_the_init_segment_first_then_each_segment():
    assert stream.playlist_media(PLAYLIST_TEXT) == ["init.mp4", "seg000012.m4s", "seg000013.m4s", "seg000014.m4s"]
    assert stream.playlist_media(stream.empty_playlist(3)) == []
    assert stream.playlist_sequence(PLAYLIST_TEXT) == (12, 3)
    assert stream.playlist_sequence(stream.empty_playlist(7)) == (7, 0)


def test_a_playlist_is_complete_only_with_its_header_and_a_final_newline():
    assert stream.playlist_complete(PLAYLIST_TEXT)
    assert not stream.playlist_complete(PLAYLIST_TEXT[:-1])
    assert not stream.playlist_complete("")
    assert stream.playlist_complete(stream.empty_playlist(0))


def test_plan_sync_puts_new_files_in_playlist_order_and_deletes_stale_ones_beyond_the_kept():
    listed = stream.playlist_media(PLAYLIST_TEXT)
    to_put, to_delete = stream.plan_sync(listed, set())
    assert to_put == listed and to_delete == []
    uploaded = {"init.mp4", "seg000008.m4s", "seg000009.m4s", "seg000010.m4s", "seg000011.m4s", "seg000012.m4s"}
    to_put, to_delete = stream.plan_sync(listed, uploaded, keep=2)
    assert to_put == ["seg000013.m4s", "seg000014.m4s"]
    assert to_delete == ["seg000008.m4s", "seg000009.m4s"]


def test_the_idle_rule_starts_on_the_first_listener_and_stops_a_minute_after_the_last_leaves():
    rule = stream.IdleRule(stop_after_s=60)
    assert rule.update(0, 0) is None
    assert rule.update(None, 1) is None
    assert rule.update(2, 2) == "start"
    assert rule.update(1, 10) is None
    assert rule.update(0, 20) is None
    assert rule.update(None, 50) is None  # a hiccup in the count changes nothing
    assert rule.update(0, 79) is None
    assert rule.update(0, 80) == "stop"
    assert rule.update(0, 200) is None
    assert rule.update(1, 201) == "start"


def test_a_usage_entry_meters_hours_and_the_hosts_operations():
    entry = stream.usage_entry("floor", "club", 3600, 1000)
    assert entry["stream_id"] == "floor" and entry["provider"] == "club" and entry["kind"] == "encode"
    assert entry["hours"] == 1.0
    assert entry["cost_usd"] == pytest.approx(0.0045)


def test_the_set_is_the_same_set_twice_and_stays_in_range():
    a, b = setgen.SetGenerator(3), setgen.SetGenerator(3)
    bars = [a.bar(i) for i in range(3)]
    assert all(np.array_equal(b.bar(i), bars[i]) for i in range(3))
    assert bars[0].shape == (setgen.BAR_N, 2)
    assert max(float(np.abs(x).max()) for x in bars) <= 1.0
    assert float(np.sqrt(np.mean(bars[1] ** 2))) > 0.05
    assert len(a.pcm16(3)) == setgen.BAR_N * 4
    assert not np.array_equal(setgen.SetGenerator(4).bar(0), bars[0])


def test_the_loop_publishes_an_empty_playlist_while_idle_and_fills_it_when_someone_arrives(tmp_path):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not installed")
    out = tmp_path / "public"
    publisher = stream.LocalPublisher(out)
    counts = iter([0, 1, 1, 1, 1, 1, 0, 0])
    listening = [0]

    def count():
        try:
            listening[0] = next(counts)
        except StopIteration:
            pass
        return listening[0]

    ledger = tmp_path / "usage.jsonl"
    run = stream.StreamRun("club", "floor", publisher, tmp_path / "work", poll_s=0.5, idle_s=1.0, count=count,
                           ledger=ledger, log=lambda line: None)
    # Faster than real time for the test: the encoder does not pace itself, the pipe does.
    real = stream.Encoder.__init__

    def quick(self, *args, **kwargs):
        kwargs["realtime"] = False
        real(self, *args, **kwargs)

    stream.Encoder.__init__ = quick
    stop = threading.Event()
    try:
        worker = threading.Thread(target=run.run, args=(stop,), daemon=True)
        worker.start()
        deadline = time.time() + 40
        while time.time() < deadline:
            text = (out / stream.PLAYLIST).read_text() if (out / stream.PLAYLIST).exists() else ""
            if stream.playlist_media(text):
                break
            time.sleep(0.25)
        media = stream.playlist_media((out / stream.PLAYLIST).read_text())
        assert media and media[0] == stream.INIT and all((out / m).exists() for m in media)
        # The last listener leaves: within the idle time the playlist empties and the segments go.
        deadline = time.time() + 20
        while time.time() < deadline:
            text = (out / stream.PLAYLIST).read_text()
            if not stream.playlist_media(text) and not list(out.glob("*.m4s")):
                break
            time.sleep(0.25)
        text = (out / stream.PLAYLIST).read_text()
        assert stream.playlist_media(text) == []
        assert list(out.glob("*.m4s")) == []
        seq, _ = stream.playlist_sequence(text)
        assert seq > 0, "the sequence carries on past the retired segments"
    finally:
        stop.set()
        worker.join(timeout=15)
        stream.Encoder.__init__ = real
    assert ledger.exists()
    entries = [json.loads(line) for line in ledger.read_text().splitlines()]
    assert entries and entries[-1]["kind"] == "encode" and entries[-1]["hours"] > 0
