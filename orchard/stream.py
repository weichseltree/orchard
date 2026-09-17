"""The club floor's live stream: an encoder on this box, published to R2.

    uv run orchard stream run                   # the floor, to the media host
    uv run orchard stream run --local DIR       # to a directory (dev: results/bundles/audio/live/club/floor)
    uv run orchard stream render out.wav --bars 16

AUDIO-STREAM.md §1–§3 and CLUB.md §5. The stream is an EXHIBIT: a name with
no bytes behind it, `audio/live/<provider>/<stream-id>/live.m3u8`, never
cached and never hashed. ffmpeg encodes Opus into fMP4 segments of two
seconds under a live playlist; this module uploads each new segment, then
the playlist, and deletes what fell out of the window. The media host is a
plain R2 bucket (orchard/push.py), so the playlist is put with `no-store`
and the segments with a minute's cache.

What plays is a directory of tracks the venue may distribute (the ruling of
2026-09-17: own or licensed recordings only), looped; without one, the
seeded set of `orchard/setgen.py`. Nothing is recorded.

The encoder runs only while someone is in the club (AUDIO-STREAM.md §6: an
exhibit with no listeners for a minute stops encoding). Listeners are the
rows of the live `whereabouts` table in the venue's presence room. While
idle the playlist stays published but empty, so a player waits quietly;
when someone arrives the encoder starts within a poll and the playlist fills.
Every accounted minute is appended to the ledger's `.audio_usage.jsonl`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import EXP_STATUS

PLAYLIST = "live.m3u8"
INIT = "init.mp4"
SEGMENT_S = 2
LIST_SIZE = 8
"""Segments kept on the host beyond the playlist's window, for a player mid-fetch."""
KEEP_EXTRA = 2
CONTENT_TYPES = {".m3u8": "application/vnd.apple.mpegurl", ".m4s": "video/iso.segment", ".mp4": "video/mp4"}
CACHE_PLAYLIST = "no-store"
CACHE_SEGMENT = "public, max-age=60"
"""R2 class A operations (a PUT or a DELETE) per million, USD; the encode itself runs on the host's own machine."""
R2_CLASS_A_USD = 4.5e-6
TRACK_SUFFIXES = (".opus", ".ogg", ".mp3", ".flac", ".wav", ".m4a", ".aac")


# -- pure rules ---------------------------------------------------------------

def playlist_media(text: str) -> list[str]:
    """Every file the playlist refers to, in order: the init segment named by EXT-X-MAP, then the media segments."""
    out: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#EXT-X-MAP:"):
            attrs = line[len("#EXT-X-MAP:"):]
            key = 'URI="'
            i = attrs.find(key)
            if i >= 0:
                j = attrs.find('"', i + len(key))
                if j > i:
                    uri = attrs[i + len(key):j]
                    if uri not in out:
                        out.append(uri)
        elif not line.startswith("#"):
            out.append(line)
    return out


def playlist_sequence(text: str) -> tuple[int, int]:
    """(media sequence of the first segment, number of segments); (0, 0) for an empty or absent playlist."""
    seq, count = 0, 0
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            try:
                seq = int(line.split(":", 1)[1])
            except ValueError:
                seq = 0
        elif line and not line.startswith("#"):
            count += 1
    return seq, count


def playlist_complete(text: str) -> bool:
    """A playlist ffmpeg has finished writing: it has its header and ends on a newline."""
    return text.startswith("#EXTM3U") and text.endswith("\n")


def empty_playlist(sequence: int) -> str:
    """A live playlist with nothing in it yet: what an idle floor publishes, so a player waits rather than fails."""
    return (
        "#EXTM3U\n#EXT-X-VERSION:7\n"
        f"#EXT-X-TARGETDURATION:{SEGMENT_S}\n#EXT-X-MEDIA-SEQUENCE:{sequence}\n"
    )


def plan_sync(listed: list[str], uploaded: set[str], keep: int = KEEP_EXTRA) -> tuple[list[str], list[str]]:
    """What to put and what to delete so the host holds the playlist's files, plus `keep` older segments.

    Puts come in playlist order, so the init segment goes first; the playlist
    itself is not in either list, the caller puts it after the segments.
    Deletions are the oldest uploaded segments no longer listed, beyond the
    `keep` most recent of them, so a player fetching a segment that just
    slipped out of the window still finds it.
    """
    to_put = [name for name in listed if name not in uploaded]
    stale = sorted((name for name in uploaded if name not in listed and name != INIT), key=segment_number)
    to_delete = stale[: max(0, len(stale) - keep)]
    return to_put, to_delete


def segment_number(name: str) -> int:
    """The number in `seg000042.m4s`, so ordering survives the day the digits grow; a stranger sorts first."""
    m = re.match(r"seg(\d+)\.", name)
    return int(m.group(1)) if m else -1


@dataclass
class IdleRule:
    """Start the encoder when someone is in the club; stop it once nobody has been for `stop_after_s`.

    An unknown count (the database did not answer) changes nothing: a hiccup
    in the count must not stop the music.
    """

    stop_after_s: float = 60.0
    running: bool = False
    empty_since: float | None = None

    def update(self, listeners: int | None, now: float) -> str | None:
        if listeners is None:
            return None
        if listeners > 0:
            self.empty_since = None
            if not self.running:
                self.running = True
                return "start"
            return None
        if self.empty_since is None:
            self.empty_since = now
        if self.running and now - self.empty_since >= self.stop_after_s:
            self.running = False
            return "stop"
        return None


def usage_entry(stream_id: str, provider: str, seconds: float, operations: int) -> dict:
    """One accounted interval for `orchard ledger` (AUDIO-STREAM.md §6): the hours encoded and what the host's operations cost."""
    return {
        "stream_id": stream_id,
        "provider": provider,
        "kind": "encode",
        "hours": round(seconds / 3600.0, 6),
        "cost_usd": round(operations * R2_CLASS_A_USD, 6),
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def tracks_in(directory: Path | None) -> list[Path]:
    if not directory or not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if p.suffix.lower() in TRACK_SUFFIXES and p.is_file())


# -- publishers ---------------------------------------------------------------

class LocalPublisher:
    """Publishes into a directory: the dev server serves `results/bundles/` as `/local-bundles/`."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.operations = 0

    def put(self, rel: str, data: bytes, ctype: str, cache: str) -> None:
        tmp = self.directory / (rel + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, self.directory / rel)
        self.operations += 1

    def delete(self, rel: str) -> None:
        try:
            (self.directory / rel).unlink()
        except FileNotFoundError:
            pass
        self.operations += 1

    def describe(self) -> str:
        return str(self.directory)


class R2Publisher:
    """Publishes under `audio/live/<provider>/<stream>/` on the media bucket (orchard/push.py's client)."""

    def __init__(self, provider: str, stream: str):
        from .push import CF
        self.prefix = f"audio/live/{provider}/{stream}/"
        self.cf = CF(scope="r2")
        self.operations = 0

    def put(self, rel: str, data: bytes, ctype: str, cache: str) -> None:
        self.cf.put_object(self.prefix + rel, data, ctype, cache_control=cache)
        self.operations += 1

    def delete(self, rel: str) -> None:
        self.cf.delete_object(self.prefix + rel)
        self.operations += 1

    def describe(self) -> str:
        from .push import PUBLIC_HOST
        return f"https://{PUBLIC_HOST}/{self.prefix}{PLAYLIST}"


# -- the encoder --------------------------------------------------------------

class Encoder:
    """One ffmpeg writing a live fMP4/Opus playlist into `workdir`, fed by tracks or by the generator."""

    def __init__(self, workdir: Path, *, tracks: list[Path] | None = None, seed: int = 0,
                 start_number: int = 0, realtime: bool = True, bitrate: str = "96k", ffmpeg: str = "ffmpeg",
                 start_bar: int = 0):
        self.workdir = Path(workdir)
        self.tracks = tracks or []
        self.seed = seed
        self.start_number = start_number
        self.start_bar = start_bar
        self._stderr = None
        self.realtime = realtime
        self.bitrate = bitrate
        self.ffmpeg = ffmpeg
        self.process: subprocess.Popen | None = None
        self._feeder: threading.Thread | None = None
        self._stop = threading.Event()
        self.bars_fed = 0

    @property
    def playlist(self) -> Path:
        return self.workdir / PLAYLIST

    def command(self) -> list[str]:
        cmd = [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats"]
        if self.realtime:
            cmd.append("-re")
        if self.tracks:
            listing = self.workdir / "tracks.txt"
            listing.write_text("".join("file '" + p.as_posix().replace("'", "'\\''") + "'\n" for p in self.tracks))
            cmd += ["-stream_loop", "-1", "-f", "concat", "-safe", "0", "-i", str(listing)]
        else:
            cmd += ["-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0"]
        cmd += [
            "-vn", "-c:a", "libopus", "-b:a", self.bitrate, "-application", "audio", "-ar", "48000", "-ac", "2",
            "-f", "hls", "-hls_time", str(SEGMENT_S), "-hls_list_size", str(LIST_SIZE),
            "-hls_flags", "delete_segments+independent_segments+omit_endlist+program_date_time+temp_file",
            "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", INIT,
            "-hls_segment_filename", str(self.workdir / "seg%06d.m4s"),
            "-start_number", str(self.start_number),
            str(self.playlist),
        ]
        return cmd

    def start(self) -> None:
        self.workdir.mkdir(parents=True, exist_ok=True)
        for old in self.workdir.glob("*.m4s"):
            old.unlink()
        if self.playlist.exists():
            self.playlist.unlink()
        self._stop.clear()
        stdin = subprocess.PIPE if not self.tracks else subprocess.DEVNULL
        # stderr to a file, never a pipe nobody drains: a chatty ffmpeg would block on a full pipe and stall the floor.
        self._stderr = (self.workdir / "ffmpeg.log").open("wb")
        self.process = subprocess.Popen(self.command(), stdin=stdin, stdout=subprocess.DEVNULL, stderr=self._stderr)
        if not self.tracks:
            self._feeder = threading.Thread(target=self._feed, name="setgen-feeder", daemon=True)
            self._feeder.start()

    def _feed(self) -> None:
        from .setgen import SetGenerator
        gen = SetGenerator(self.seed)
        process = self.process
        stdin = process.stdin if process else None
        if stdin is None:
            return  # stopped before the feeder got going
        # The set goes on from where the sequence says it is, so a restart is not the opening again.
        bar = self.start_bar
        try:
            while not self._stop.is_set():
                stdin.write(gen.pcm16(bar))
                bar += 1
                self.bars_fed = bar
        except (BrokenPipeError, ValueError, OSError):
            pass

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self) -> str:
        """Stops ffmpeg; returns the tail of its log, for ours."""
        self._stop.set()
        if self.process:
            # Close the pipe ourselves and forget it, or `communicate` flushes a closed file.
            stdin, self.process.stdin = self.process.stdin, None
            try:
                if stdin:
                    stdin.close()
            except OSError:
                pass
            try:
                self.process.send_signal(signal.SIGINT)
                self.process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.communicate()
        if self._feeder:
            self._feeder.join(timeout=5)
        if self._stderr:
            self._stderr.close()
            self._stderr = None
        self.process = None
        try:
            return (self.workdir / "ffmpeg.log").read_text(errors="replace")[-400:].strip()
        except OSError:
            return ""

    def read_playlist(self) -> str | None:
        """The playlist as ffmpeg last finished writing it, or None while it is absent or mid-write."""
        try:
            text = self.playlist.read_text()
        except FileNotFoundError:
            return None
        return text if playlist_complete(text) else None


# -- listeners ----------------------------------------------------------------

def listeners(room: str = "club", db: str = "orchard", timeout_s: float = 5.0) -> int | None:
    """How many visitors stand in the venue's presence room right now; None when the database did not answer."""
    try:
        out = subprocess.run(
            ["spacetime", "sql", db, "--format", "json", "SELECT room FROM whereabouts"],
            capture_output=True, text=True, timeout=timeout_s, check=True,
        ).stdout
        doc = json.loads(out[out.index("[{"):])
        rows = doc[0].get("rows", [])
    except (subprocess.SubprocessError, FileNotFoundError, ValueError, IndexError, KeyError):
        return None
    return sum(1 for row in rows if row and row[0] == room)


class Counter:
    """Counts listeners on a thread of its own, so a slow database never holds the publish loop (and the players) up."""

    def __init__(self, count, log):
        self._count, self._log = count, log
        self.value: int | None = None
        self.failures = 0
        self._thread: threading.Thread | None = None

    def poll(self, wait_s: float = 0.0) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="listener-count", daemon=True)
        self._thread.start()
        if wait_s > 0:
            self._thread.join(wait_s)

    def _run(self) -> None:
        n = self._count()
        if n is None:
            self.failures += 1
            if self.failures in (1, 10, 100) or self.failures % 1000 == 0:
                self._log(f"stream: the listener count did not answer ({self.failures} times); is the spacetime CLI installed and logged in?")
        elif self.failures:
            self._log(f"stream: the listener count is back after {self.failures} misses")
            self.failures = 0
        self.value = n


# -- the loop -----------------------------------------------------------------

@dataclass
class StreamRun:
    provider: str
    stream: str
    publisher: LocalPublisher | R2Publisher
    workdir: Path
    tracks: list[Path] = field(default_factory=list)
    seed: int = 0
    poll_s: float = 5.0
    idle_s: float = 60.0
    always: bool = False
    count: object = listeners
    ledger: Path | None = None
    log: object = print

    # -- what survives a restart: the sequence, in the workdir
    def _read_sequence(self) -> int:
        try:
            return int((self.workdir / "sequence.txt").read_text().strip())
        except (OSError, ValueError):
            return 0

    def _write_sequence(self, seq: int) -> None:
        try:
            self.workdir.mkdir(parents=True, exist_ok=True)
            (self.workdir / "sequence.txt").write_text(f"{seq}\n")
        except OSError as exc:
            self.log(f"stream: could not remember the sequence ({exc})")

    def _encoder(self, next_seq: int) -> Encoder:
        from .setgen import BAR_S
        bar = int(next_seq * SEGMENT_S / BAR_S)
        return Encoder(self.workdir, tracks=self.tracks, seed=self.seed, start_number=next_seq, start_bar=bar)

    def _publish(self, what: str, fn) -> bool:
        """One publisher call; a failure is logged and answered with False, never raised: the loop goes on."""
        try:
            fn()
            return True
        except Exception as exc:  # CloudflareError, ConnectionError, OSError: the host, not us
            self.log(f"stream: {what} failed ({exc!r})")
            return False

    def run(self, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        rule = IdleRule(self.idle_s)
        counter = Counter(self.count, self.log)
        uploaded: set[str] = set()
        encoder: Encoder | None = None
        next_seq = self._read_sequence()
        next_count = 0.0
        usage_since = time.monotonic()
        usage_ops = self.publisher.operations
        # Failures back off, doubling to half a minute, so an outage of the host is waited out and not hammered.
        backoff = 0.0
        next_try = 0.0
        last_advance = time.monotonic()
        last_seq_seen = -1
        deaths = 0
        self._publish("the idle playlist", lambda: self.publisher.put(PLAYLIST, empty_playlist(next_seq).encode(), CONTENT_TYPES[".m3u8"], CACHE_PLAYLIST))
        self.log(f"stream {self.provider}/{self.stream}: idle playlist at {self.publisher.describe()}"
                 f" ({'tracks: ' + str(len(self.tracks)) if self.tracks else 'the seeded set'}), sequence {next_seq}")
        if not self.always:
            counter.poll(wait_s=min(self.poll_s, 6.0))  # the first pass counts, so a full floor is not kept waiting a poll
        try:
            while not stop.is_set():
                now = time.monotonic()
                if now >= next_count:
                    next_count = now + self.poll_s
                    if self.always:
                        n: int | None = 1
                    else:
                        counter.poll()
                        n = counter.value
                    action = rule.update(n, now)
                    if action == "start":
                        encoder = self._encoder(next_seq)
                        encoder.start()
                        uploaded = set()
                        usage_since = now
                        usage_ops = self.publisher.operations
                        last_advance, last_seq_seen = now, -1
                        self.log(f"stream: {n} listening, encoder started at sequence {next_seq}")
                    elif action == "stop" and encoder:
                        self._account(now - usage_since, self.publisher.operations - usage_ops)
                        next_seq = self._retire(encoder, uploaded, next_seq)
                        encoder = None
                        uploaded = set()
                        self.log("stream: the club is empty, encoder stopped")
                if encoder:
                    stalled = now - last_advance > 4 * SEGMENT_S + 2
                    if not encoder.running or stalled:
                        err = encoder.stop()
                        deaths += 1
                        wait = min(30.0, 2.0 ** min(deaths, 5))
                        self.log(f"stream: encoder {'stalled' if stalled else 'died'} ({err or 'no message'}); restarting in {wait:.0f}s")
                        if stop.wait(wait):
                            encoder = None  # stopped meanwhile: nothing to retire, the idle playlist goes out below
                            break
                        encoder = self._encoder(next_seq)
                        encoder.start()
                        # `uploaded` is kept: the names are unique across restarts, so the old run's segments are
                        # deleted by the next sync as no longer listed. The init segment is put again, to be sure.
                        uploaded.discard(INIT)
                        last_advance, last_seq_seen = time.monotonic(), -1
                        continue
                    text = encoder.read_playlist()
                    if text is not None:
                        # The watchdog reads the playlist every pass; only the host is waited for during a backoff.
                        seq, count = playlist_sequence(text)
                        if seq + count != last_seq_seen:
                            last_seq_seen, last_advance = seq + count, now
                        if seq + count > next_seq:
                            next_seq = seq + count
                            self._write_sequence(next_seq)
                    if text is not None and now >= next_try:
                        listed = playlist_media(text)
                        to_put, to_delete = plan_sync(listed, uploaded)
                        ok = True
                        for name in to_put:
                            try:
                                data = (self.workdir / name).read_bytes()
                            except OSError:
                                continue  # already rotated out; the next playlist will not list it
                            if not self._publish(f"put {name}", lambda: self.publisher.put(name, data, CONTENT_TYPES.get(Path(name).suffix, "application/octet-stream"), CACHE_SEGMENT)):
                                ok = False
                                break
                            uploaded.add(name)
                            deaths = 0
                        if ok and to_put:
                            ok = self._publish("put the playlist", lambda: self.publisher.put(PLAYLIST, text.encode(), CONTENT_TYPES[".m3u8"], CACHE_PLAYLIST))
                        for name in to_delete if ok else []:
                            if self._publish(f"delete {name}", lambda: self.publisher.delete(name)):
                                uploaded.discard(name)
                        if ok:
                            backoff = 0.0
                        else:
                            backoff = min(30.0, backoff * 2 if backoff else 2.0)
                            next_try = now + backoff
                    if now - usage_since >= 60:
                        self._account(now - usage_since, self.publisher.operations - usage_ops)
                        usage_since = now
                        usage_ops = self.publisher.operations
                stop.wait(0.25)
        finally:
            if encoder:
                self._account(time.monotonic() - usage_since, self.publisher.operations - usage_ops)
                self._retire(encoder, uploaded, next_seq)
                self.log("stream: stopped; idle playlist left in place")
            elif uploaded:
                # Stopped while waiting to restart a dead encoder: its segments are still on the host.
                self._write_sequence(next_seq)
                self._publish("the idle playlist", lambda: self.publisher.put(PLAYLIST, empty_playlist(next_seq).encode(), CONTENT_TYPES[".m3u8"], CACHE_PLAYLIST))
                for name in sorted(uploaded, key=segment_number):
                    self._publish(f"delete {name}", lambda: self.publisher.delete(name))
                self.log("stream: stopped; idle playlist left in place")

    def _retire(self, encoder: Encoder, uploaded: set[str], known_seq: int) -> int:
        """Stops the encoder, leaves an empty playlist at the next sequence, removes the segments. Returns that sequence.

        Bounded: every host call may fail and none is retried here; what stays behind is cleaned up
        by the next run's puts (same names are overwritten) and by the client's freshness rule.
        """
        text = encoder.read_playlist() or ""
        seq, count = playlist_sequence(text)
        next_seq = max(known_seq, seq + count)
        encoder.stop()
        self._write_sequence(next_seq)
        self._publish("the idle playlist", lambda: self.publisher.put(PLAYLIST, empty_playlist(next_seq).encode(), CONTENT_TYPES[".m3u8"], CACHE_PLAYLIST))
        for name in sorted(uploaded, key=segment_number):
            self._publish(f"delete {name}", lambda: self.publisher.delete(name))
        uploaded.clear()
        return next_seq

    def _account(self, seconds: float, operations: int) -> None:
        if seconds <= 0:
            return
        path = self.ledger or (EXP_STATUS / ".audio_usage.jsonl")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a") as f:
                f.write(json.dumps(usage_entry(self.stream, self.provider, seconds, operations)) + "\n")
        except OSError as exc:
            self.log(f"stream: could not write the ledger entry ({exc})")


def run_from_args(a) -> int:
    if shutil.which(a.ffmpeg) is None:
        print(f"stream: {a.ffmpeg} is not installed", file=sys.stderr)
        return 2
    tracks = tracks_in(Path(a.tracks).expanduser()) if a.tracks else []
    workdir = Path(a.workdir).expanduser() if a.workdir else Path.home() / ".local" / "share" / "orchard-stream" / f"{a.provider}-{a.stream}"
    publisher = LocalPublisher(Path(a.local).expanduser()) if a.local else R2Publisher(a.provider, a.stream)
    run = StreamRun(a.provider, a.stream, publisher, workdir, tracks=tracks, seed=a.seed,
                    poll_s=a.poll, idle_s=a.idle, always=a.always,
                    count=lambda: listeners(a.room, a.db), ledger=Path(a.ledger) if a.ledger else None,
                    log=lambda line: print(line, flush=True))
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    run.run(stop)
    return 0
