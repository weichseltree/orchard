"""Bundles: what the grove downloads, content-addressed, no server in the path.

`orchard/bundle/1`, specified in docs/specs/M0-hall.md. Two kinds:

    tape    a particle tape resampled into fixed-layout chunks a WebGL client
            can upload to the GPU without parsing anything per frame
    video   an HLS ladder produced by ffmpeg

A bundle is a directory named by the first 16 hex of the sha256 of its own
`bundle.json` with the `id` field emptied, serialized
`json.dumps(sort_keys=True, separators=(",", ":"))`. Nothing in `bundle.json`
may be a wall-clock timestamp or the id would move on every run; provenance
that does move (the tree's git sha) is content, and moving the id is then the
correct behaviour.

READING TAPES. `orchard_tape.TapeReader` (packages/tape, a workspace member)
is the authority on `video/tape/1` and the same code every producing repo
writes with, so a tape written with a uint16 position channel decodes through
the same `/65535*L` that wrote it and a torn final frame is dropped by the same
rule. There is one reader and no fallback: the package ships with orchard, so
the day spectre's checkout is absent is no longer a day a second
implementation runs. Its release is recorded in
`bundle.json:source.tape_reader`.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import orchard_tape
from orchard_tape import TapeReader

from . import RESULTS, WEICHSELTREE

SCHEMA = "orchard/bundle/1"
TAPE_SCHEMA = "video/tape/1"
MAGIC = b"OTC1"
CHUNK_HEADER_BYTES = 32
BYTES_PER_SLOT_FRAME = 8          # u16[3] pos + u8 species + u8 alive

#: Slots the richest variant keeps. The spec's worked example is a 4,000-slot
#: tape at slot_stride 1; ab_d2 has 200,000 slots, which at stride 1 is a
#: 1.28 GB "vr-high" against a definition of done that says 72 Hz on a Quest
#: and under 20 MB on a phone. See docs/impl/WP1-bundle.md.
SLOT_BUDGET = 4000
CHUNK_FRAMES = 60
#: The variant whose slot set the others are strides of.
BASE_VARIANT = "vr-high"

#: Species colours for the poster, dark ground. Index is the species value.
PALETTE = ["#ff6f4d", "#4dc3ff", "#9be564", "#f2c14e", "#c792ea", "#ff8fb1",
           "#7ee8c9", "#e0e0e0"]
POSTER_BG = "#0b0d10"
POSTER_PX = (1280, 720)

# --------------------------------------------------------------- tape reading


def tape_reader(tape_dir) -> tuple[TapeReader, str]:
    """(reader, which): the package's TapeReader and the release that read."""
    return TapeReader(tape_dir), f"orchard-tape {orchard_tape.__version__}"


# ----------------------------------------------------------------- provenance


#: The manifest harvest writes back into a tree after bundling. Its own edits
#: are not dirt: counting them, every harvest after the first would refuse.
MANIFEST_NAME = "orchard.yaml"


def tracked_changes(repo: Path, *paths) -> list[str] | None:
    """Tracked files with uncommitted changes, staged or not; None outside git.

    Untracked files are not counted (a tree's results are untracked or
    ignored, and a new file changes nothing that was committed), and neither
    is `orchard.yaml` at `repo`. `paths` narrows the question to those paths.
    Paths come back relative to the repository's top.
    """
    spec = [str(p) for p in paths] or [":/", f":(exclude){MANIFEST_NAME}"]
    try:
        r = subprocess.run(["git", "-C", str(repo), "status", "--porcelain=v1", "-z",
                            "--untracked-files=no", "--", *spec],
                           capture_output=True, text=True, timeout=30)
    except Exception:                                             # noqa: BLE001
        return None
    if r.returncode:
        return None
    out, parts, i = [], r.stdout.split("\0"), 0
    while i < len(parts):
        entry, i = parts[i], i + 1
        if len(entry) < 4:
            continue
        if set(entry[:2]) & {"R", "C"}:  # a rename or copy: its origin follows
            i += 1
        out.append(entry[3:])
    return out


def last_commit(repo: Path, path: Path) -> str | None:
    """The short commit that last touched `path`, when git tracks it; else None.

    A result the tree gitignores has no such commit: only the tree knows when
    it was made, and `None` says so rather than inventing HEAD.
    """
    try:
        tracked = subprocess.run(["git", "-C", str(repo), "ls-files", "--", str(path)],
                                 capture_output=True, text=True, timeout=30)
        if tracked.returncode or not tracked.stdout.strip():
            return None
        log = subprocess.run(["git", "-C", str(repo), "log", "-1", "--format=%h",
                              "--", str(path)],
                             capture_output=True, text=True, timeout=30)
    except Exception:                                             # noqa: BLE001
        return None
    if log.returncode:
        return None
    return log.stdout.strip() or None


def _git_describe(repo: Path) -> str:
    """`<short HEAD>`, with `-dirty` when tracked files other than the
    manifest have uncommitted changes (`tracked_changes`)."""
    try:
        sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=10)
        if sha.returncode:
            return "unknown"
        return sha.stdout.strip() + ("-dirty" if tracked_changes(repo) else "")
    except Exception:                                             # noqa: BLE001
        return "unknown"


def _tree_root(tree: str) -> Path | None:
    p = WEICHSELTREE / tree
    return p if (p / ".git").exists() else None


def _rel_to_tree(path: Path, tree: str) -> str:
    """`results/film/tapes/ab_d2` when the path lives in the tree's repo.

    The spec's example writes `source.tape_dir` relative to the producing
    repo, which is the only spelling that is the same on another machine.
    """
    root = _tree_root(tree)
    path = Path(path).resolve()
    if root:
        try:
            return str(path.relative_to(root.resolve()))
        except ValueError:
            pass
    return str(path)


def sha256_file(path, chunk=1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(chunk), b""):
            h.update(blk)
    return h.hexdigest()


# ------------------------------------------------------------ the content id


def canonical(doc: dict) -> str:
    """The exact bytes the id is taken over: `id` emptied, compact, sorted.

    Content addressing only holds if `bundle.json` names a digest of EVERY
    file the bundle serves. It does: a tape names `sha256` per chunk and
    `poster_sha256`; a video or a still names every file it ships in `files`
    (`{relpath: {sha256, bytes}}`). Redraw the poster or re-encode a segment
    and the id must move, or two different bundles collide on one address.
    """
    d = dict(doc)
    d["id"] = ""
    return json.dumps(d, sort_keys=True, separators=(",", ":"))


def compute_id(doc: dict) -> str:
    return hashlib.sha256(canonical(doc).encode()).hexdigest()[:16]


def verify_id(bundle_dir) -> tuple[bool, str, str]:
    """(ok, id_on_disk, id_recomputed) for a written bundle."""
    doc = json.loads((Path(bundle_dir) / "bundle.json").read_text())
    got = compute_id(doc)
    return doc["id"] == got, doc["id"], got


def file_digests(root: Path, exclude=("bundle.json",)) -> dict[str, dict]:
    """`{relpath: {sha256, bytes}}` for every file under `root`, sorted.

    What a video or still bundle puts in `bundle.json:files`, so its id covers
    the bytes it ships and not only the recipe that made them.
    """
    root = Path(root)
    return {str(p.relative_to(root)).replace(os.sep, "/"):
            {"sha256": sha256_file(p), "bytes": p.stat().st_size}
            for p in sorted(root.rglob("*"))
            if p.is_file() and str(p.relative_to(root)) not in exclude}


def _intact(bundle_dir: Path, bid: str) -> bool:
    """True when `bundle_dir` is the bundle `bid` and its bytes match its claims."""
    from .push import verify_local                              # noqa: PLC0415
    try:
        ok, on_disk, _ = verify_id(bundle_dir)
    except (OSError, ValueError, KeyError):
        return False
    if not ok or on_disk != bid:
        return False
    rep = verify_local(bundle_dir)
    return not rep["mismatched"] and not rep["missing"]


def _finalize(doc: dict, staging: Path, out_root: Path) -> Path:
    """Name the directory after the bytes, then move it into place.

    Every bundle's id covers the digest of every file it ships, so an existing
    directory with the same id holds the same bytes by definition and this is
    a no-op. The one exception is a directory that no longer matches its own
    `bundle.json` (a truncated chunk, a hand edit): that one is replaced from
    the fresh staging copy, which does, and it says so.
    """
    bid = compute_id(doc)
    doc["id"] = bid
    (staging / "bundle.json").write_text(json.dumps(doc, indent=1) + "\n")
    out_root = Path(out_root)
    out_root.mkdir(parents=True, exist_ok=True)
    dest = out_root / bid
    if dest.exists():
        if _intact(dest, bid):
            shutil.rmtree(staging)
            return dest
        print(f"  replacing {dest}: it does not match its own bundle.json",
              flush=True)
        shutil.rmtree(dest)
    shutil.move(str(staging), str(dest))
    dest.chmod(0o755)
    return dest


# ------------------------------------------------------------------- the tape


def _quantize(pos: np.ndarray, box: np.ndarray) -> tuple[np.ndarray, int]:
    """[0, L) per axis onto [0, 65535], clamped and counted (never wrapped).

    Same mapping the tape's own uint16 mode uses, so a uint16 tape survives
    the round trip. An axis with L <= 0 (a padding axis) quantizes to 0.
    """
    L = np.where(box > 0, box, 1.0)
    q = np.asarray(pos, dtype=np.float64) / L * 65535.0
    q = np.where(np.asarray(box) > 0, q, 0.0)
    out = int(np.count_nonzero((q < 0.0) | (q > 65535.0)))
    return np.clip(q, 0.0, 65535.0).round().astype(np.uint16), out


def hash_rank_take(candidates, k: int, seed: str) -> np.ndarray:
    """The `k` members of `candidates` with the smallest `blake2b(seed|slot)`.

    Returned sorted by SLOT INDEX, not by digest. Version-stable on purpose:
    the first draw went through `np.random.default_rng(...).choice`, and NumPy
    guarantees nothing about that stream across versions (NEP 19), so a routine
    `uv sync` could have changed which particles a tape bundles — different
    chunk bytes, a new address for the same tape, every test still green. A
    digest per slot and an `argsort` depend on blake2b alone.

    Ties (two slots sharing an 8-byte digest) break by index: the sort is
    stable and `candidates` arrives sorted.
    """
    c = np.asarray(candidates, dtype=np.int64)
    if k <= 0:
        return np.empty(0, dtype=np.int64)
    if k >= c.size:
        return np.sort(c)
    blob = b"".join(hashlib.blake2b(f"{seed}|{int(x)}".encode(),
                                    digest_size=8).digest() for x in c)
    keys = np.frombuffer(blob, dtype=">u8")   # big-endian: u64 order IS byte order
    order = np.argsort(keys, kind="stable")[:k]
    return np.sort(c[order])


def slot_indices(n_slots: int, stride: int,
                 alive_last=None) -> tuple[np.ndarray, dict]:
    """WHICH slots a decimated variant keeps, and a truthful record of why.

    TWO THINGS GO WRONG WITH A PLAIN STRIDE, both measured on ab_d2.

    1. It aliases. einstruct lays A and B out by index parity, so
       `range(0, 200000, 50)` selects 4,000 particles of which 4,000 are
       species A and none are B — the annihilation the tape exists to show,
       deleted by the sampler, with every chunk hashing correctly.
    2. It empties the room. A uniform 4,000 of 200,000 slots holds 4,000 live
       points at frame 0 and **56** at the last frame, because 98.7% of the
       tape's particles have annihilated by then: a 25 MB download that buys
       about 200 visible points after t = 25 tau, while the survivors would
       have fitted inside the budget with room to spare.

    So the budget is spent on the particles that are still there: **every slot
    alive in the tape's FINAL frame first**, then the remainder filled by
    `hash_rank_take` over the slots not already taken. Survivors that exceed
    the budget are themselves hash-ranked down to it. `stride == 1` is the
    identity, so a tape at or under the budget is bundled exactly as the
    spec's worked example describes.

    Returns `(indices, slot_selection)`; the second value is what lands in
    `bundle.json`, and it states this variant's actual counts rather than a
    template with the numbers left in.
    """
    n = len(range(0, n_slots, max(1, stride)))
    seed = f"orchard/bundle/1|slots|{n_slots}|{n}"
    if n >= n_slots:
        return np.arange(n_slots), {
            "rule": "identity", "alive_last": 0, "filled": 0, "seed": seed,
            "note": "the tape fits the slot budget; every slot is kept"}
    survivors = (np.empty(0, dtype=np.int64) if alive_last is None
                 else np.nonzero(np.asarray(alive_last).reshape(-1))[0])
    if survivors.size >= n:
        keep = hash_rank_take(survivors, n, seed + "|alive")
        kept_alive, filled = int(keep.size), 0
    else:
        rest = np.setdiff1d(np.arange(n_slots, dtype=np.int64), survivors)
        fill = hash_rank_take(rest, n - int(survivors.size), seed)
        keep = np.sort(np.concatenate([survivors.astype(np.int64), fill]))
        kept_alive, filled = int(survivors.size), int(fill.size)
    return keep, {
        "rule": "alive-last-then-blake2b",
        "alive_last": kept_alive,
        "filled": filled,
        "seed": seed,
        "note": ("every slot alive in the tape's final frame, then the "
                 "remainder taken as the smallest "
                 "blake2b(seed|slot, digest_size=8) digests over the slots "
                 "not already kept, sorted by slot index; see "
                 "orchard.bundle.slot_indices"),
    }


def derived_selection(base: dict, take_every: int, of: str = "vr-high") -> dict:
    """What a variant derived from `vr-high` must say about its own slots.

    A variant is `vr-high`'s slot list strided, NOT the base rule re-run at a
    bigger stride, and the two are different sets. Copying `vr-high`'s record
    into `phone` told a client to map the wrong particles onto the points it
    downloaded; saying "every 2nd slot of vr-high" is the fact.
    """
    if take_every == 1:
        return {"rule": f"the same slots as {of}", "from": of, "take_every": 1}
    return {"rule": f"every {take_every}th slot of {of}, in slot order",
            "from": of, "take_every": take_every,
            "note": f"{of}'s own rule is {base['rule']!r}"}


def alive_at_last_frame(reader):
    """The tape's alive mask at its final frame, without reading every frame.

    From the `alive` channel when the tape has one. When it has none, the
    spec's only stated fact is that a dead slot keeps its last position, so a
    slot that MOVED into the final frame was alive in it. That is a lower
    bound on the survivors and it costs two frames instead of all of them.
    """
    if not len(reader.frames):
        return None
    last = reader.frame(len(reader.frames) - 1)
    if last.get("alive") is not None:
        return np.asarray(last["alive"]).reshape(-1) != 0
    if len(reader.frames) < 2:
        return None
    prev = reader.frame(len(reader.frames) - 2)
    return (np.asarray(last["pos"]) != np.asarray(prev["pos"])).any(axis=1)


def _derive_alive(pos_q: np.ndarray) -> np.ndarray:
    """`alive` for a tape that has no alive channel.

    The spec states the only fact available: "a dead slot keeps its last
    position". So a slot is dead from the frame AFTER the last one at which it
    moved. A slot that never moves at all is NOT read as dead-on-arrival — the
    tape cannot distinguish "annihilated before frame 0" from "stationary",
    and marking a static tape entirely dead would hide every particle.
    """
    frames, n, _ = pos_q.shape
    alive = np.ones((frames, n), dtype=np.uint8)
    if frames < 2:
        return alive
    moved = (pos_q[1:] != pos_q[:-1]).any(axis=2)          # (frames-1, n)
    ever = moved.any(axis=0)
    last_move = np.where(ever, moved.shape[0] - 1 - moved[::-1].argmax(axis=0), 0)
    idx = np.arange(frames)[:, None]
    dead = ever[None, :] & (idx > (last_move + 1)[None, :])
    alive[dead] = 0
    return alive


def _species_names(meta: dict, n_species: int) -> tuple[list[str], str]:
    for key in ("species_names", "species_labels", "species"):
        v = meta.get(key)
        if isinstance(v, list) and v and all(isinstance(x, str) for x in v):
            return list(v), f"header.meta[{key!r}]"
    if n_species <= len(PALETTE) + 18:
        return [chr(ord("A") + i) for i in range(n_species)], "derived (letters)"
    return [f"S{i}" for i in range(n_species)], "derived (S<i>)"


def read_tape_base(reader, keep: np.ndarray, box: np.ndarray, *, progress=None):
    """One pass over the tape, keeping the slots `keep` names.

    Returns (pos_q, species, alive, times, info). Everything downstream is a
    stride of these arrays: at the slot budget the whole base is ~25 MB, so
    the 2.2 GB on disk is read exactly once.
    """
    nframes = len(reader.frames)
    if nframes == 0:
        raise ValueError("empty tape: frames.jsonl has no complete frame")
    n_slots = reader.frames[0]["n"]
    if any(f["n"] != n_slots for f in reader.frames):
        raise ValueError(
            "this tape's particle count changes between frames (an `roi` tape); "
            "a bundle is a fixed slot grid and there is no correspondence to "
            "carry across frames")
    keep = np.asarray(keep)
    if keep.size and (keep.min() < 0 or keep.max() >= n_slots):
        raise ValueError("slot indices fall outside the tape's slot range")
    n = keep.size
    pos_q = np.empty((nframes, n, 3), dtype=np.uint16)
    times = np.empty(nframes, dtype=np.float64)
    species = np.zeros((nframes, n), dtype=np.uint8)
    have_species = have_alive = False
    alive = np.ones((nframes, n), dtype=np.uint8)
    clamped = 0
    for i in range(nframes):
        f = reader.frame(i)
        times[i] = f["t"]
        q, c = _quantize(np.asarray(f["pos"])[keep], box)
        pos_q[i] = q
        clamped += c
        sp = f.get("species")
        if sp is not None:
            have_species = True
            species[i] = np.asarray(sp).reshape(-1)[keep].astype(np.uint8)
        al = f.get("alive")
        if al is not None:
            have_alive = True
            alive[i] = (np.asarray(al).reshape(-1)[keep] != 0).astype(np.uint8)
        if progress and (i % 50 == 0 or i == nframes - 1):
            progress(i + 1, nframes)
    if not have_alive:
        alive = _derive_alive(pos_q)
    info = {
        "n_slots": int(n_slots),
        "alive_source": "tape channel 'alive'" if have_alive
                        else "derived: a slot is dead after the last frame it moved in",
        "species_source": "tape channel 'species'" if have_species
                          else "absent from the tape; every slot is species 0",
        "clamped_positions": clamped,
    }
    return pos_q, species, alive, times, info


def _chunk_bytes(pos_q, species, alive, frame0: int, t0: float, dt: float) -> bytes:
    """One `OTC1` chunk. Offsets are the spec's table and nothing else."""
    frames, n, _ = pos_q.shape
    head = (MAGIC
            + struct.pack("<III", n, frames, frame0)
            + struct.pack("<ff", t0, dt)
            + b"\x00" * 8)
    assert len(head) == CHUNK_HEADER_BYTES
    body = bytearray()
    for f in range(frames):
        body += np.ascontiguousarray(pos_q[f], dtype="<u2").tobytes()
        body += np.ascontiguousarray(species[f], dtype=np.uint8).tobytes()
        body += np.ascontiguousarray(alive[f], dtype=np.uint8).tobytes()
    return bytes(head) + bytes(body)


def _write_variant(out: Path, name: str, pos_q, species, alive, times,
                   *, frame_stride: int, slot_stride: int, base_slot_stride: int,
                   chunk_frames: int, selection: dict) -> dict:
    """Write `<name>/cNNNN.bin` and return the variant's entry in bundle.json.

    `slot_stride` is TAPE-relative and is what lands in bundle.json; the arrays
    in hand are already strided by `base_slot_stride`, so only the remainder
    slices them. Getting this backwards silently ships a variant 50x sparser
    than its own metadata claims, which no reader could detect.
    """
    if slot_stride % base_slot_stride:
        raise ValueError(f"slot_stride {slot_stride} is not a multiple of the "
                         f"base stride {base_slot_stride}")
    # Every variant's slots are a subset of vr-high's, so a client that moved
    # up a tier already holds the points the lower tier drew.
    fsel = slice(None, None, frame_stride)
    ssel = slice(None, None, slot_stride // base_slot_stride)
    p, s, a = pos_q[fsel, ssel], species[fsel, ssel], alive[fsel, ssel]
    t = times[fsel]
    frames, n = p.shape[0], p.shape[1]
    # One dt for the variant. Uniform cadence is what a fixed-stride chunk can
    # express; each chunk still carries its own exact t0, so a tape whose
    # cadence wobbles loses the wobble inside a chunk but never accumulates
    # drift across the timeline.
    dt = float(np.mean(np.diff(t))) if frames > 1 else 0.0
    d = out / name
    d.mkdir(parents=True, exist_ok=True)
    chunks, total = [], 0
    for k, f0 in enumerate(range(0, frames, chunk_frames)):
        f1 = min(f0 + chunk_frames, frames)
        blob = _chunk_bytes(p[f0:f1], s[f0:f1], a[f0:f1], f0, float(t[f0]), dt)
        rel = f"{name}/c{k:04d}.bin"
        (out / rel).write_bytes(blob)
        total += len(blob)
        chunks.append({"file": rel, "frame0": f0, "frames": f1 - f0,
                       "bytes": len(blob),
                       "sha256": hashlib.sha256(blob).hexdigest()})
    return {
        "frames": frames,
        "n": n,
        "frame_stride": frame_stride,
        "slot_stride": slot_stride,
        "dt_tau": dt,
        "chunk_frames": chunk_frames,
        "slot_selection": selection,
        # How many of this variant's slots are actually visible over the
        # timeline. `last` is the number the room still shows at the end, and
        # it is the number a uniform sampler got wrong (56 of 4000 on ab_d2).
        "alive": {"first": int(a[0].sum()), "last": int(a[-1].sum()),
                  "min": int(a.sum(axis=1).min()), "n": int(n)},
        "bytes": total,
        "payload_bytes": frames * n * BYTES_PER_SLOT_FRAME,
        "t0_tau": float(t[0]) if frames else 0.0,
        "chunks": chunks,
    }


def variant_plan(n_slots: int, slot_budget: int = SLOT_BUDGET) -> dict:
    """(frame_stride, slot_stride) per variant, both relative to the TAPE.

    vr-high  every frame, enough slot stride to fit the budget
    vr-quest same slots, every 2nd frame          (spec)
    phone    every 2nd frame, and every 2nd slot again when the richest variant
             would carry more than 2000 slots     (spec, read as a ceiling)

    The spec writes the phone's extra stride as "every 2nd slot when n_slots >
    2000". Read literally against the TAPE's slot count that condition fires
    even when the slot budget has already brought the variant far below 2000 —
    a 200,000-slot tape at a budget of 1000 would ship the phone 500 points
    while vr-high ships 1000. The two readings agree in every case the spec's
    own example contemplates (a tape at or under the budget, where the base
    stride is 1 and the variant's n IS n_slots); they part only once the budget
    binds, and there the ceiling is what the clause is for.
    """
    base = max(1, -(-n_slots // max(1, slot_budget)))       # ceil
    base_n = len(range(0, n_slots, base))
    phone_extra = 2 if base_n > 2000 else 1
    return {
        "vr-high": (1, base),
        "vr-quest": (2, base),
        "phone": (2, base * phone_extra),
    }


def _poster(png: Path, pos_q, species, alive, times, box, *, title,
            tree) -> dict:
    """The middle frame of the BUNDLED slots, species colours on dark, 1280x720.

    Drawn from what the bundle ships, not from the tape. The first version
    drew all 200,000 tape particles and advertised a room of 3,702 points that
    the bundle did not contain — a poster is a promise about the exhibit, and
    the exhibit is the chunks.
    """
    import matplotlib                                          # noqa: PLC0415
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt                            # noqa: PLC0415

    i = len(times) // 2
    L = np.asarray(box, dtype=np.float64)
    pos = pos_q[i].astype(np.float64) / 65535.0 * L
    sp = np.asarray(species[i]).reshape(-1)
    al = np.asarray(alive[i]).reshape(-1) != 0
    Lx, Ly = float(L[0]), float(L[1])

    w, h = POSTER_PX
    dpi = 100
    fig = plt.figure(figsize=(w / dpi, h / dpi), dpi=dpi, facecolor=POSTER_BG)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor(POSTER_BG)
    ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    # The WHOLE box, letterboxed into 16:9 rather than cropped — a poster that
    # crops the periodic box is a picture of a different simulation. The bottom
    # margin is wider than the top so the caption sits on empty ground instead
    # of over the particles.
    pad_top, pad_bottom = 0.02 * Ly, 0.10 * Ly
    span_y = Ly + pad_top + pad_bottom
    span_x = max(Lx * 1.04, span_y * w / h)
    ax.set_xlim(Lx / 2 - span_x / 2, Lx / 2 + span_x / 2)
    ax.set_ylim(-pad_bottom, Ly + pad_top)
    n_draw = max(1, int(al.sum()))
    size = float(np.clip(9000.0 / np.sqrt(n_draw), 0.12, 6.0))
    for v in np.unique(sp[al]) if al.any() else []:
        m = al & (sp == v)
        ax.plot(pos[m, 0], pos[m, 1], linestyle="none", marker=".",
                markersize=size, markeredgewidth=0,
                color=PALETTE[int(v) % len(PALETTE)], rasterized=True)
    label = (f"{title}   ·   {tree}   ·   t = {times[i]:.3g} tau   ·   "
             f"frame {i} of the bundle")
    ax.text(0.5, 0.022, label, transform=ax.transAxes, ha="center", va="bottom",
            color="#8b96a3", fontsize=9, family="monospace")
    fig.savefig(png, dpi=dpi, facecolor=POSTER_BG)
    plt.close(fig)
    return {"variant_frame": i, "t_tau": float(times[i]), "drawn": n_draw,
            "of_slots": int(pos_q.shape[1]), "width": w, "height": h,
            "source": f"the {BASE_VARIANT} slots, not the whole tape"}


def bundle_tape(tape_dir, tree: str, title: str, out_root=None, *,
                slot_budget: int = SLOT_BUDGET, chunk_frames: int = CHUNK_FRAMES,
                verbose: bool = True, commit: str | None = None) -> Path:
    """Write `<out_root>/<id>/` for a `video/tape/1` tape. Returns the directory."""
    tape_dir = Path(tape_dir).resolve()
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    t_start = time.perf_counter()
    reader, which = tape_reader(tape_dir)
    header = reader.header
    box_raw = np.asarray(header["box"], dtype=np.float64)
    if box_raw.size != 3:
        raise ValueError(f"tape box must be 3 axes, got {header['box']!r}")
    # A padding axis of 0 divides by zero in the quantizer and gives the client
    # a degenerate volume. ab_d2 writes Lz = 1, but that is einstruct's habit
    # and not the format's promise, so coerce and record what was on the tape.
    box = np.where(box_raw > 0, box_raw, 1.0)
    meta = header.get("meta") or {}

    n_slots = reader.frames[0]["n"] if reader.frames else 0
    plan = variant_plan(n_slots, slot_budget)
    base_stride = plan[BASE_VARIANT][1]

    def tick(i, n):
        print(f"  read {i}/{n} frames  {time.perf_counter() - t_start:6.1f}s",
              flush=True)

    keep, base_selection = slot_indices(n_slots, base_stride,
                                        alive_at_last_frame(reader))
    pos_q, species, alive, times, info = read_tape_base(
        reader, keep, box, progress=tick if verbose else None)
    t_read = time.perf_counter() - t_start

    n_species = int(species.max()) + 1 if species.size else 1
    names, sp_src = _species_names(meta, n_species)
    counts = (np.bincount(species[0].ravel(), minlength=n_species).tolist()
              if species.size else [])
    tape_rel = _rel_to_tree(tape_dir, tree)

    staging = Path(tempfile.mkdtemp(prefix=".bundle-", dir=str(_ensure(out_root))))
    try:
        variants = {
            name: _write_variant(
                staging, name, pos_q, species, alive, times,
                frame_stride=fstride, slot_stride=sstride,
                base_slot_stride=base_stride, chunk_frames=chunk_frames,
                selection=(base_selection if name == BASE_VARIANT else
                           derived_selection(base_selection,
                                             sstride // base_stride)))
            for name, (fstride, sstride) in plan.items()}
        t_chunks = time.perf_counter() - t_start
        poster = _poster(staging / "poster.png", pos_q, species, alive, times,
                         box, title=title, tree=tree)
        t_poster = time.perf_counter() - t_start
        doc = {
            "schema": SCHEMA,
            "kind": "tape",
            "id": "",
            "tree": tree,
            "title": title,
            "produced_by": (f"uv run orchard bundle tape {tape_rel} "
                            f"--tree {tree} --title {json.dumps(title)}"),
            "source": {
                "tape_dir": tape_rel,
                "tape_header_sha256": sha256_file(tape_dir / "header.json"),
                "tape_schema": header.get("schema", TAPE_SCHEMA),
                "tree_commit": commit or _git_describe(_tree_root(tree) or tape_dir),
                "scene": meta,
                # additions to the spec's `source`: provenance only, and none
                # of it a wall clock, so the id does not move between runs
                "tape_frames": len(reader.frames),
                "tape_quantize": header.get("quantize"),
                "tape_reader": which,
                "alive_source": info["alive_source"],
                "species_source": info["species_source"],
                "species_names_from": sp_src,
                "clamped_positions": info["clamped_positions"],
                **({"box_raw": [float(x) for x in box_raw]}
                   if not np.array_equal(box, box_raw) else {}),
            },
            "box": [float(x) for x in box],
            "periodic": [bool(x) for x
                         in (header.get("periodic") or [True, True, True])],
            "units": header.get("units", "reduced (sigma, tau)"),
            "n_slots": int(n_slots),
            "slot_budget": int(slot_budget),
            "species_names": names,
            "species_counts": counts,
            "variants": variants,
            "poster": "poster.png",
            "poster_sha256": sha256_file(staging / "poster.png"),
            "poster_info": poster,
        }
        dest = _finalize(doc, staging, out_root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if verbose:
        total = time.perf_counter() - t_start
        print(f"bundle {dest.name}  read {t_read:.1f}s  "
              f"chunks {t_chunks - t_read:.1f}s  "
              f"poster {t_poster - t_chunks:.1f}s  total {total:.1f}s", flush=True)
        for k, v in variants.items():
            print(f"  {k:9s} n={v['n']:6d} frames={v['frames']:5d} "
                  f"{v['bytes'] / 1e6:8.2f} MB in {len(v['chunks'])} chunks",
                  flush=True)
    return dest


def _ensure(p: Path) -> Path:
    p = Path(p)
    p.mkdir(parents=True, exist_ok=True)
    return p


# ------------------------------------------------------------------ the video


RUNGS = [("360p", 360, "800k", "1400k"),
         ("720p", 720, "2800k", "4200k"),
         ("1080p", 1080, "5000k", "7500k")]
SEGMENT_SECONDS = 6


def _ffprobe(path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def _fps(stream) -> float:
    for key in ("avg_frame_rate", "r_frame_rate"):
        v = stream.get(key) or ""
        if "/" in v:
            a, b = v.split("/")
            if float(b):
                return float(a) / float(b)
    return 30.0


def bundle_video(mp4, tree: str, title: str, out_root=None, *,
                 verbose: bool = True, commit: str | None = None) -> Path:
    """Write `<out_root>/<id>/` holding an HLS ladder. Returns the directory.

    `commit` is the tree commit the source was made at, when the caller knows
    it (harvest passes the artefact's); otherwise the tree's HEAD.
    """
    mp4 = Path(mp4).resolve()
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    t_start = time.perf_counter()
    probe = _ffprobe(mp4)
    v = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
    if v is None:
        raise ValueError(f"{mp4} has no video stream")
    a = next((s for s in probe["streams"] if s["codec_type"] == "audio"), None)
    src_w, src_h = int(v["width"]), int(v["height"])
    fps = _fps(v)
    duration = float(probe["format"]["duration"])
    keyint = max(1, int(round(fps * SEGMENT_SECONDS)))

    rungs = [r for r in RUNGS if r[1] <= src_h]
    skipped = [{"name": r[0], "height": r[1],
                "reason": f"source is {src_w}x{src_h}; a bundle never upscales"}
               for r in RUNGS if r[1] > src_h]
    if not rungs:
        # Everything is above the source: ship the source height as one rung
        # rather than shipping nothing.
        rungs = [(f"{src_h}p", src_h, "800k", "1400k")]
        skipped = [dict(s, reason=s["reason"] + "; encoded at source height instead")
                   for s in skipped]

    staging = Path(tempfile.mkdtemp(prefix=".bundle-", dir=str(_ensure(out_root))))
    try:
        for name, _h, _b, _m in rungs:
            (staging / name).mkdir()

        split = "".join(f"[v{i}]" for i in range(len(rungs)))
        fc = [f"[0:v]split={len(rungs)}{split}"]
        for i, (_n, h, _b, _m) in enumerate(rungs):
            fc.append(f"[v{i}]scale=-2:{h}[v{i}out]")
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
               "-filter_complex", ";".join(fc)]
        for i, (_n, _h, bitrate, maxrate) in enumerate(rungs):
            cmd += ["-map", f"[v{i}out]",
                    f"-c:v:{i}", "libx264", f"-preset:v:{i}", "medium",
                    f"-profile:v:{i}", "high", f"-pix_fmt:v:{i}", "yuv420p",
                    f"-b:v:{i}", bitrate, f"-maxrate:v:{i}", maxrate,
                    f"-bufsize:v:{i}", maxrate,
                    f"-g:v:{i}", str(keyint), f"-keyint_min:v:{i}", str(keyint),
                    f"-sc_threshold:v:{i}", "0"]
        stream_map = " ".join(f"v:{i},name:{r[0]}" for i, r in enumerate(rungs))
        if a is not None:
            for i in range(len(rungs)):
                cmd += ["-map", "a:0", f"-c:a:{i}", "aac", f"-b:a:{i}", "128k",
                        f"-ac:a:{i}", "2"]
            # `name:`, NOT `name=`. ffmpeg's var_stream_map parses keys by
            # colon; `name=360p` is "Invalid keyval" and the whole encode
            # exits 234 with no output. The video-only branch above was right
            # and this one was not, so it only ever failed on a clip WITH an
            # audio track — ab_d2 is silent, so nothing caught it until a
            # narrated episode would have.
            stream_map = " ".join(f"v:{i},a:{i},name:{r[0]}"
                                  for i, r in enumerate(rungs))
        # Every rendition cuts at the same instants, which is what makes a switch
        # mid-playback seamless; -g alone is a request, force_key_frames is the
        # guarantee, and independent_segments tells the player it may rely on it.
        cmd += ["-force_key_frames", f"expr:gte(t,n_forced*{SEGMENT_SECONDS})",
                "-f", "hls", "-hls_time", str(SEGMENT_SECONDS),
                "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
                "-hls_segment_type", "mpegts",
                "-hls_segment_filename", str(staging / "%v" / "s%04d.ts"),
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", stream_map,
                str(staging / "%v" / "index.m3u8")]
        if verbose:
            print("  " + " ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)
        t_encode = time.perf_counter() - t_start

        poster_at = max(0.0, duration * 0.10)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{poster_at:.3f}",
             "-i", str(mp4), "-frames:v", "1", "-q:v", "3",
             "-vf", "scale='min(1280,iw)':-2", str(staging / "poster.jpg")],
            check=True)

        # THE ID COVERS THE ENCODER'S BYTES. x264's VBV rate control reads the
        # state of frames in flight on other threads, so a re-encode of the
        # same clip can differ by a few kB (22.08 MB, then 22.07 MB of 1080p on
        # this box). WP1 answered that by addressing a video by its RECIPE and
        # parking the digests in an unhashed `media.json`, which let two
        # different sets of bytes share one address and replaced the first
        # silently. Ruled since: every bundle's id covers every file it ships,
        # so a re-encode that differs is a NEW bundle beside the old one, and
        # `orchard bundle gc` removes whichever nothing references. Harvest
        # only re-encodes when the source bytes change or on `--force`, so
        # addresses do not churn in practice. The recipe stays, as provenance.
        ladder = []
        for i, (name, h, bitrate, _m) in enumerate(rungs):
            segs = sorted((staging / name).glob("s*.ts"))
            ladder.append({
                "name": name, "height": h,
                "width": int(round(src_w * h / src_h)) // 2 * 2,
                "target_bitrate": bitrate,
                "playlist": f"{name}/index.m3u8",
                "segments": len(segs),
                "segment_seconds": SEGMENT_SECONDS,
                "keyint_frames": keyint,
            })
        files = file_digests(staging)

        file_rel = _rel_to_tree(mp4, tree)
        prov = provenance_sidecar(mp4)
        doc = {
            "schema": SCHEMA,
            "kind": "video",
            "id": "",
            "tree": tree,
            "title": title,
            "produced_by": (f"uv run orchard bundle video {file_rel} --tree {tree} "
                            f"--title {json.dumps(title)}"),
            "source": {
                "file": file_rel,
                "file_sha256": sha256_file(mp4),
                "bytes": mp4.stat().st_size,
                "codec": v.get("codec_name"),
                "tree_commit": commit or _git_describe(_tree_root(tree) or mp4.parent),
                **({"provenance": prov} if prov else {}),
            },
            "duration_s": duration,
            "width": src_w,
            "height": src_h,
            "fps": fps,
            "has_audio": a is not None,
            "master": "master.m3u8",
            "ladder": ladder,
            "skipped_rungs": skipped,
            "poster": "poster.jpg",
            "poster_at_s": poster_at,
            "ffmpeg": _ffmpeg_banner(),
            "tools": _tools("ffmpeg"),
            "files": files,
        }
        dest = _finalize(doc, staging, out_root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if verbose:
        total = time.perf_counter() - t_start
        print(f"bundle {dest.name}  encode {t_encode:.1f}s  total {total:.1f}s",
              flush=True)
        by_rung = {r["name"]: sum(m["bytes"] for rel, m in files.items()
                                  if rel.startswith(r["name"] + "/"))
                   for r in ladder}
        for r in ladder:
            print(f"  {r['name']:6s} {r['width']}x{r['height']} "
                  f"{by_rung[r['name']] / 1e6:7.2f} MB in {r['segments']} "
                  f"segments", flush=True)
        for s in skipped:
            print(f"  skipped {s['name']}: {s['reason']}", flush=True)
    return dest


# ------------------------------------------------------------------- stills


def provenance_sidecar(path) -> dict | None:
    """spectre's stock sidecar, carried through: `<file>.json` beside the asset.

    `core.film.stock` writes one next to every lifted or generated asset,
    naming provider, id, query or prompt, license, author, sha256 and bytes
    (LAWS 9: stock only with provenance and disclosure). When one is there it
    goes into `source.provenance` verbatim; its `retrieved_unix` is a fact
    about the source, not about this run, so the id stays put.
    """
    p = Path(path)
    side = p.with_name(p.name + ".json")
    if not side.is_file():
        return None
    try:
        meta = json.loads(side.read_text())
    except json.JSONDecodeError:
        return {"sidecar": side.name, "error": "sidecar is not JSON"}
    if not isinstance(meta, dict):
        return None
    return {"sidecar": side.name, **meta}


#: (tier, longest width in px, also encode AVIF). AVIF with a JPEG fallback is
#: the spec's still format (PLATFORM.md); the thumb is JPEG only, it is what
#: the exhibit table's `thumb_url` points at and every browser must show it.
STILL_TIERS = [("full", 4096, True), ("phone", 1600, True), ("thumb", 640, False)]
AVIF_CRF = 28
AVIF_ENCODER = "libaom-av1"


def _ffmpeg_banner() -> str:
    from .toolchain import record                               # noqa: PLC0415
    return record("ffmpeg")["ffmpeg"]


def _tools(*names: str) -> dict[str, str]:
    """`bundle.json:tools`, the banner of every external tool that made the bytes
    (orchard/toolchain.py). The expected versions live there; `orchard doctor`
    compares."""
    from .toolchain import record                               # noqa: PLC0415
    return record(*names)


def _has_avif() -> bool:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"],
                         capture_output=True, text=True)
    return AVIF_ENCODER in out.stdout


def bundle_still(image, tree: str, title: str, out_root=None, *,
                 verbose: bool = True, commit: str | None = None) -> Path:
    """Write `<out_root>/<id>/` holding a still at three widths. Returns the directory.

    Like every bundle the id covers the bytes (`files`) as well as the recipe.
    libaom is not promised to be bit-stable across versions or thread counts,
    so a re-encode that differs lands at a new address beside the old one;
    harvest only re-encodes when the source changes.
    """
    image = Path(image).resolve()
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    t_start = time.perf_counter()
    probe = _ffprobe(image)
    v = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
    if v is None:
        raise ValueError(f"{image} is not an image ffprobe can read")
    src_w, src_h = int(v["width"]), int(v["height"])
    avif = _has_avif()

    staging = Path(tempfile.mkdtemp(prefix=".bundle-", dir=str(_ensure(out_root))))
    try:
        tiers = []
        for name, max_w, want_avif in STILL_TIERS:
            w = max(2, min(src_w, max_w) // 2 * 2)
            vf = f"scale={w}:-2"
            jpg = staging / f"{name}.jpg"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(image),
                            "-vf", vf, "-frames:v", "1", "-q:v", "3", str(jpg)],
                           check=True)
            j = next(s for s in _ffprobe(jpg)["streams"] if s["codec_type"] == "video")
            tier = {"name": name, "width": int(j["width"]), "height": int(j["height"]),
                    "jpg": jpg.name}
            if want_avif and avif:
                out = staging / f"{name}.avif"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(image),
                                "-vf", vf, "-frames:v", "1",
                                "-c:v", AVIF_ENCODER, "-still-picture", "1",
                                "-crf", str(AVIF_CRF), "-b:v", "0", "-cpu-used", "6",
                                "-pix_fmt", "yuv420p", "-f", "avif", str(out)],
                               check=True)
                tier["avif"] = out.name
            tiers.append(tier)
            if verbose:
                print(f"  {name:6s} {tier['width']}x{tier['height']}"
                      f"{'  +avif' if 'avif' in tier else ''}", flush=True)

        files = file_digests(staging)
        file_rel = _rel_to_tree(image, tree)
        prov = provenance_sidecar(image)
        doc = {
            "schema": SCHEMA,
            "kind": "still",
            "id": "",
            "tree": tree,
            "title": title,
            "produced_by": (f"uv run orchard bundle still {file_rel} --tree {tree} "
                            f"--title {json.dumps(title)}"),
            "source": {
                "file": file_rel,
                "file_sha256": sha256_file(image),
                "bytes": image.stat().st_size,
                "codec": v.get("codec_name"),
                "tree_commit": commit or _git_describe(_tree_root(tree) or image.parent),
                **({"provenance": prov} if prov else {}),
            },
            "width": src_w,
            "height": src_h,
            "tiers": tiers,
            "avif": avif,
            "avif_crf": AVIF_CRF if avif else None,
            "encoder": _ffmpeg_banner(),
            "tools": _tools("ffmpeg"),
            "poster": "thumb.jpg",
            "files": files,
        }
        dest = _finalize(doc, staging, out_root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if verbose:
        print(f"bundle {dest.name}  still {src_w}x{src_h}  "
              f"{'avif+jpg' if avif else 'jpg only (no libaom)'}  "
              f"total {time.perf_counter() - t_start:.1f}s", flush=True)
    return dest


def verify_bundle(bundle_dir) -> dict:
    """The check `push` runs, for anyone without a token: id and every digest."""
    from .push import verify_local
    ok, on_disk, recomputed = verify_id(bundle_dir)
    rep = verify_local(bundle_dir)
    rep.update({"id": on_disk, "id_ok": ok and Path(bundle_dir).name == on_disk,
                "id_recomputed": recomputed})
    rep["ok"] = bool(rep["id_ok"] and not rep["mismatched"] and not rep["missing"])
    return rep
