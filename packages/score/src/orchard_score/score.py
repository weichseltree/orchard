"""`orchard/score/1`: the score behind an audio bundle.

A score is a versioned, fixed-rate stream of per-node state recorded
alongside every `audio` bundle: rate, burstiness, template entropy, fan-out,
anomaly z-score, health (`docs/specs/AUDIO-STREAM.md` §4). It is what lets a
spoken number in a narration take satisfy LAWS 24 mechanically -- the number
names a field and a frame index of a named score, not a repo detail nobody
can check -- and what LAWS 17's silence budget is measured against.

One writer (`ScoreWriter`), one reader (`ScoreReader`), the standard library
and nothing else. LogSwarm produces scores; orchard reads and bundles them
(`orchard.bundle.bundle_audio`).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

#: The format's version. Changes only on a breaking change to the bytes; a
#: reader keeps reading every schema it ever wrote (the tape package's rule).
SCHEMA = "orchard/score/1"

#: Frames per second, the format's fixed rate (AUDIO-STREAM.md §4, budget).
RATE_HZ = 10

#: The per-node fields every frame carries, in a fixed order. A field is
#: added beside the others, not instead of one; a reader that does not know
#: a new field still reads every field it did know.
FIELDS = ("rate", "burstiness", "template_entropy", "fan_out", "anomaly_z", "health")


class ScoreIntegrityError(ValueError):
    """A score.json, or a frame inside it, does not match its own header."""


@dataclass(frozen=True)
class NodeState:
    """One node's state at one frame. Field names are internal (AUDIO-STREAM.md
    §4, LAWS 5): narration is written against the value, never the field
    name, and the banned-word gate runs on the narration line, not on this."""
    rate: float
    burstiness: float
    template_entropy: float
    fan_out: int
    anomaly_z: float
    health: float

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class Frame:
    """One tick of the score: every observed node's state at a frame index."""
    index: int
    t: float
    nodes: dict[str, NodeState] = field(default_factory=dict)


class ScoreWriter:
    """Builds a `score.json`. A score is archived whole beside its `audio`
    bundle, never read while still being written the way a tape is, so this
    buffers frames in memory and writes once, on `close()`."""

    def __init__(self, path, *, rate_hz: float = RATE_HZ, provider: str = "",
                run_seed: int | None = None):
        self.path = Path(path)
        self.rate_hz = rate_hz
        self.provider = provider
        self.run_seed = run_seed
        self._frames: list[Frame] = []
        self._node_ids: list[str] = []

    def append(self, index: int, t: float, nodes: dict[str, NodeState]) -> None:
        """A frame's index must increase, the same rule the tape's `t` and
        `step` follow: the timeline only moves forward."""
        if self._frames and index <= self._frames[-1].index:
            raise ScoreIntegrityError(
                f"frame index must increase: {index} after {self._frames[-1].index}")
        for node_id in nodes:
            if node_id not in self._node_ids:
                self._node_ids.append(node_id)
        self._frames.append(Frame(index=index, t=t, nodes=dict(nodes)))

    def close(self) -> None:
        doc = {
            "schema": SCHEMA,
            "rate_hz": self.rate_hz,
            "provider": self.provider,
            "run_seed": self.run_seed,
            "fields": list(FIELDS),
            "nodes": list(self._node_ids),
            "frames": [
                {"index": fr.index, "t": fr.t,
                 "nodes": {nid: ns.as_dict() for nid, ns in fr.nodes.items()}}
                for fr in self._frames
            ],
        }
        self.path.write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.close()


class ScoreReader:
    """Reads a `score.json` written by `ScoreWriter` or a compatible producer."""

    def __init__(self, path):
        self.path = Path(path)
        doc = json.loads(self.path.read_text())
        if doc.get("schema") != SCHEMA:
            raise ScoreIntegrityError(
                f"{self.path}: schema {doc.get('schema')!r}, expected {SCHEMA!r}")
        self.rate_hz = doc["rate_hz"]
        self.provider = doc.get("provider", "")
        self.run_seed = doc.get("run_seed")
        self.fields = tuple(doc.get("fields") or FIELDS)
        self.nodes = tuple(doc.get("nodes") or ())
        self._frames = [
            Frame(index=fr["index"], t=fr["t"],
                  nodes={nid: NodeState(**vals) for nid, vals in fr["nodes"].items()})
            for fr in doc["frames"]
        ]

    def __len__(self) -> int:
        return len(self._frames)

    def frame(self, index: int) -> Frame:
        """The frame recorded at `index` (frame indices only increase, so this
        is a binary search, not a scan)."""
        lo, hi = 0, len(self._frames) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if self._frames[mid].index == index:
                return self._frames[mid]
            if self._frames[mid].index < index:
                lo = mid + 1
            else:
                hi = mid - 1
        raise KeyError(f"no frame at index {index}")

    def value_at(self, index: int, node_id: str, field_name: str) -> float:
        """The number a spoken line names: a field of a node at a frame index
        (LAWS 24 -- the gate runs against this, mechanically, before a take
        is recorded)."""
        if field_name not in self.fields:
            raise KeyError(f"unknown field {field_name!r}")
        return getattr(self.frame(index).nodes[node_id], field_name)

    def silence_share(self, near_silent) -> float:
        """The share of frames for which `near_silent(frame)` is true -- what
        LAWS 17's near-silent-20%-of-60s budget (AUDIO-STREAM.md §4, §7 item 4)
        is measured against."""
        if not self._frames:
            return 0.0
        return sum(1 for fr in self._frames if near_silent(fr)) / len(self._frames)
