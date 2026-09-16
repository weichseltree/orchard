"""The tape — what a run recorded, and the only thing a renderer reads.

PROVENANCE OF THIS FILE. Copied from spectre's `core/video/tape.py` at spectre
commit fd0f465 (fd0f4652e6aa281a1c279c1706614109c96f39f1; the file itself last
changed there in 68239c4), sha256 of the copied bytes 4c36a881b8d1e955...
It is the `orchard-tape` package now and spectre's copy becomes a re-export of
it. One behavioural change, and only in what the header's `git` field holds:
see `_git_sha` and `TapeWriter.git_sha`. Every other byte a writer puts on
disk, and everything a reader accepts, is spectre's. Header strings that name
`core.video.tape` (the subset derivation) are kept verbatim for that reason:
changing them would make a tape written through this package distinguishable
from one written before it by more than the commit it records.

THE FILM'S CLOCK IS THE MASTER AND THE TAPE IS SAMPLED (RENDERING.md §1).

(RENDERING.md, cited throughout, was retired with the splat renderer at
92bc53d: `git show 92bc53d^:video/RENDERING.md`. This format's own spec is
TAPE_WISHLIST.md beside this file. The renderers that read tapes live in the
orchard repo since 2026-09-12; spectre writes tapes and renders nothing.)
This module is the sampled side: an indexed, appendable, crash-resumable
record of particle state against physical time, from which `at(t)` can
reconstruct any instant the shot asks for.

It is NOT a picture format and NOT a checkpoint. A checkpoint restores a run;
a tape is a MEASUREMENT ARTIFACT and carries the provenance any number in this
repo carries — git sha, the source run's EXP_NAME, the rule-10 environment
record, the kernel's terms tag. The F line reads tapes too (restrict pairs,
lift conditioning, commuting-square audits), which is why the schema has a
velocity channel and an fp32 mode from the start: one ruler for "what a run
recorded", pictures and training alike (RENDERING.md §5d).

LAYOUT — a directory, because appending to a single file with an index in its
header cannot survive a kill:

    <tape>/header.json   written once at open, never rewritten
    <tape>/frames.jsonl  one line per frame, appended and flushed
    <tape>/data.bin      raw frame payloads, appended and flushed

A kill leaves at worst a torn final line in `frames.jsonl` and a partial tail
in `data.bin`; the reader drops both and the tape is still valid up to the
last complete frame. Nothing is rewritten in place, so there is no window in
which a crash loses earlier frames.

QUANTIZATION is a declared PUT-IN and it is checked against the TIGHTEST shot
the tape will serve, not the widest (RENDERING.md §4). `uint16` per axis over
the box halves the bytes and is lossless relative to a microscope objective;
it is NOT lossless relative to a zoom that ends on individual particles. When
in doubt use `fp32` — the tape is usually not the thing that is too big.

SCALAR CHANNELS carry a dtype, and an integer one is LOSSLESS OR IT RAISES.
A coordination count is a small integer, so float32 spends four bytes to
carry a number that fits in one; `("coordination", "uint8")` gets the byte
back. What it must not get back is a wrap: a count of 260 stored as uint8 is
4, and rule 8 would then draw the densest particle in the frame with the
colour of the emptiest. That is the failure the eye cannot catch, so
`append` refuses non-integral, negative and over-cap values instead of
truncating them, and it refuses to saturate — saturation is the silent
version of the same bug. `at()` refuses to interpolate an integer channel
for the same reason and reports, per channel in `channel_interpolation`,
which rule it actually applied.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SCHEMA = "video/tape/1"

__all__ = ["SCHEMA", "TapeWriter", "TapeReader", "subset_indices",
           "TapeIntegrityError"]


class TapeIntegrityError(RuntimeError):
    """The tape on disk does not match what its header says it is."""


# --------------------------------------------------------------- the subset


def subset_indices(n_total: int, n_subset: int, run_seed: int,
                   mode: str = "subset") -> np.ndarray:
    """WHICH particles a `subset` tape keeps — derived, never drawn.

    Membership is a pure function of `(run_seed, mode, n_subset, n_total)`, so
    it is reproducible from the header alone and identical across restarts of
    the same run. A writer that instead drew a fresh subset at construction
    would splice two different particle populations into one tape on resume,
    and no header field would show it: the frame counts would line up, the
    particle count would be right, and every trajectory would silently jump.

    `hashlib`, NOT the builtin `hash()` — string hashing is salted per process
    in CPython, so a `hash()`-derived subset would differ between the run that
    wrote a tape and the run that resumed it, which is exactly the bug this
    function exists to make impossible.
    """
    if n_subset > n_total:
        raise ValueError(f"n_subset {n_subset} > n_total {n_total}")
    key = f"{SCHEMA}|{mode}|{int(run_seed)}|{int(n_subset)}|{int(n_total)}"
    digest = hashlib.blake2b(key.encode(), digest_size=8).digest()
    rng = np.random.default_rng(int.from_bytes(digest, "little"))
    return np.sort(rng.choice(n_total, size=n_subset, replace=False))


# --------------------------------------------------------------- provenance


def _git_sha(cwd=None) -> str:
    """The commit of the repository the CALLER is working in, `-dirty` if so.

    The header's `git` field names the code that produced the numbers on the
    tape, and that code is the calling repo's (a spectre lane, einstruct's
    exporter, phototroph's converter) — never this module's. So the question
    is put to git in the process's working directory (or `cwd`), and NEVER
    in `Path(__file__).parent`: installed as a package this file sits in
    site-packages, where the answer is "not a repository", or — for an
    editable install inside another repo — the commit of a repo that did not
    produce the run. This is what spectre's copy always did (it ran git with
    no `cwd`, i.e. in the process's own); it is written out here because
    moving the file into a package is exactly what would tempt someone to
    "fix" it to the module's location. A caller whose working directory is
    not its repo passes `TapeWriter(git_sha=...)` instead.
    """
    try:
        where = str(cwd) if cwd is not None else None      # None: inherit
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5,
                             cwd=where)
        sha = out.stdout.strip() or "unknown"
        dirty = subprocess.run(["git", "status", "--porcelain"],
                               capture_output=True, text=True, timeout=5,
                               cwd=where)
        return sha + ("-dirty" if dirty.stdout.strip() else "")
    except Exception:                                    # noqa: BLE001
        return "unknown"


def _env_record() -> dict:
    """Rule 10: anything whose presence OR ABSENCE changes numerics."""
    try:
        import torch
        torch_v, cuda_v = torch.__version__, torch.version.cuda
        gpu = (torch.cuda.get_device_name(0)
               if torch.cuda.is_available() else None)
    except Exception:                                    # noqa: BLE001
        torch_v = cuda_v = gpu = None
    return {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "torch": torch_v,
        "torch_cuda": cuda_v,
        "gpu": gpu,
        "CUDA_VISIBLE_DEVICES": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "EXP_NAME": os.environ.get("EXP_NAME"),
        "EXP_SWEEP": os.environ.get("EXP_SWEEP"),
    }


# ------------------------------------------------------------------ channels


SCALAR_DTYPES = ("float32", "uint8", "uint16")


@dataclass(frozen=True)
class Channel:
    """One per-particle array on the tape."""
    name: str
    dtype: str
    width: int          # components per particle
    quantized: bool = False

    @property
    def itemsize(self) -> int:
        return np.dtype(self.dtype).itemsize * self.width

    @property
    def is_integer(self) -> bool:
        """An integer channel counts something; it does not approximate it.

        `quantized` is the discriminator that matters here: the uint16
        position channel is stored in an integer dtype but MEANS a real
        number, so it decodes to float and interpolates. An unquantized
        integer channel means the integer itself, and reading it back as a
        float — or lerping it — invents a value no particle held.
        """
        return not self.quantized and np.issubdtype(np.dtype(self.dtype),
                                                    np.integer)

    @property
    def int_max(self) -> int | None:
        return int(np.iinfo(self.dtype).max) if self.is_integer else None

    @property
    def interpolation(self) -> str:
        return "nearest" if self.is_integer else "linear"


def _pos_channel(quantize: str) -> Channel:
    if quantize == "uint16":
        return Channel("pos", "uint16", 3, quantized=True)
    if quantize == "fp32":
        return Channel("pos", "float32", 3)
    raise ValueError(f"quantize must be 'uint16' or 'fp32', got {quantize!r}")


def _scalar_channel(spec) -> Channel:
    """A `scalars` entry: `"name"` (float32, the original meaning) or
    `("name", dtype)`. The bare string form is load-bearing back-compat —
    tapes written before dtypes existed declare their scalars that way and
    must still write and read byte for byte identically."""
    if isinstance(spec, str):
        name, dtype = spec, "float32"
    else:
        try:
            name, dtype = spec
        except (TypeError, ValueError):
            raise ValueError(
                f"scalar channel spec {spec!r} must be 'name' or "
                "('name', dtype)") from None
    if not isinstance(name, str):
        raise ValueError(f"scalar channel name must be a string, got {name!r}")
    if dtype not in SCALAR_DTYPES:
        raise ValueError(
            f"scalar channel {name!r}: dtype must be one of "
            f"{SCALAR_DTYPES}, got {dtype!r}")
    return Channel(name, dtype, 1)


# -------------------------------------------------------------------- writer


@dataclass
class TapeWriter:
    """Append frames to a tape. Off the clock (rule 11) — a run that tapes
    records `rendered_in_block` and its steps/s is not comparable with one
    that did not.
    """
    path: Path
    box: tuple                      # (Lx, Ly, Lz), the quantization range
    n_total: int
    run_seed: int
    mode: str = "full"              # full | subset | roi
    n_subset: int | None = None
    roi: tuple | None = None        # ((x0,y0,z0), (x1,y1,z1))
    quantize: str = "uint16"
    periodic: tuple = (True, True, True)
    velocity: bool = False
    scalars: tuple = ()             # "name" (float32) or ("name", dtype)
    units: str = "reduced (sigma, tau)"
    #: What t = 0 in this tape MEANS on the producing run's own clock, and how
    #: far it sits from that clock's origin. TAPE_WISHLIST SS6: SS1 already makes
    #: the header carry units, box, periodicity and cadence because a renderer
    #: that guesses any of them draws the wrong picture, and a time origin is
    #: the same class of fact -- it was simply the last one left implicit. It is
    #: also the one whose absence fails WORST: guessing units wrong makes an
    #: obviously broken frame, while guessing the origin wrong makes a perfectly
    #: correct frame confidently labelled with the wrong instant, which survives
    #: review. Concretely, a ball run with --relax-tdyn 1 opens its tape at the
    #: END of relaxation, so tape t=0 is already one t_dyn into the run's clock.
    t0_origin: str = "unspecified"
    t0_offset_tau: float | None = None
    meta: dict = field(default_factory=dict)
    #: Continue an existing tape instead of truncating it. For CHUNKED runs:
    #: NOT named `append` -- that is the method that writes a frame, and a
    #: dataclass field of the same name shadows it and silently breaks every
    #: write on this class.
    #: a long story is a sequence of short jobs so the GPU lock is released
    #: between them, and each chunk appends to the one tape the film reads.
    #: Refuses a header that does not match, because appending frames of a
    #: different shape to a tape produces a file whose index lies about it.
    resume: bool = False
    #: The header's `git` field: the commit of the code that PRODUCED this
    #: tape. None (the default) asks git in the process's working directory,
    #: which is the calling repo whenever the producer runs from its own root
    #: — the only behaviour spectre's copy of this module ever had. Pass it
    #: when that is not so (a script launched from elsewhere, a worktree, a
    #: job whose cwd is a results directory). Last among the fields so every
    #: positional construction written before it existed still means the same.
    git_sha: str | None = None

    def __post_init__(self):
        self.path = Path(self.path)
        self.path.mkdir(parents=True, exist_ok=True)
        if self.mode not in ("full", "subset", "roi"):
            raise ValueError(f"unknown tape mode {self.mode!r}")
        self._idx = None
        if self.mode == "subset":
            if not self.n_subset:
                raise ValueError("subset mode needs n_subset")
            self._idx = subset_indices(self.n_total, self.n_subset,
                                       self.run_seed)
        self._channels = [_pos_channel(self.quantize)]
        if self.velocity:
            self._channels.append(Channel("vel", "float32", 3))
        for s in self.scalars:
            self._channels.append(_scalar_channel(s))
        self._clamped_total = 0
        self._last_step = None
        self._last_time = None
        self._n_frames = 0
        self._offset = 0
        hpath = self.path / "header.json"
        if self.resume and hpath.exists():
            old = json.loads(hpath.read_text())
            new = self.header()
            # These are compared BY NAME against the header on disk, so a name
            # that is not a header key compares None to None and passes on
            # every tape forever. "n" was exactly that -- the key is n_total --
            # so the particle count this guard claimed to check was never
            # checked (append() catches a row-count mismatch later, but the
            # open-time refusal this list exists to be did not exist).
            #
            # run_seed, mode and n_subset are here because subset_indices is a
            # pure function of (run_seed, mode, n_subset, n_total): changing any
            # of them splices a DIFFERENT PARTICLE POPULATION into one tape on
            # resume, which subset_indices' own docstring calls "exactly the bug
            # this pins" while nothing pinned it. n_total does not move in that
            # case, so append()'s row check cannot see it either.
            # NOT here, deliberately: t0_origin and t0_offset_tau. They look
            # like they belong -- two tapes with different time origins must
            # never be appended to each other -- but a RESUMED chunk computes
            # them from its OWN --relax-tdyn, which is 0 for every chunk after
            # the first. It would compute "start of the run (no relaxation)"
            # against a header that says "end of relaxation" and refuse the
            # whole chain. The origin belongs to the tape, is written once, and
            # is not a property the resuming chunk knows. The cross-story splice
            # this would appear to guard is caught where the knowledge actually
            # is: ball.py refuses a checkpoint whose --out is not this run's.
            for k in ("schema", "channels", "box", "n_total", "periodic",
                      "units", "quantize", "mode", "run_seed", "n_subset"):
                if k not in new:
                    raise TapeIntegrityError(
                        f"cannot append to {self.path}: {k!r} is not a header "
                        f"field, so comparing it would pass on every tape. Fix "
                        f"the name -- a guard that reads a key nobody writes "
                        f"checks nothing and says nothing.")
                if old.get(k) != new.get(k):
                    raise TapeIntegrityError(
                        f"cannot append to {self.path}: header field {k!r} differs "
                        f"({old.get(k)!r} vs {new.get(k)!r}). A tape whose frames "
                        "change shape mid-file has an index that lies about it.")
            # CONTINUE the counters, do not restart them: `off` in the index
            # is a byte offset into data.bin, so a resumed writer that starts
            # at 0 writes an index pointing every appended frame at the start
            # of the file. The frame count carries over for the same reason.
            dpath = self.path / "data.bin"
            self._offset = dpath.stat().st_size if dpath.exists() else 0
            ipath = self.path / "frames.jsonl"
            lines = [ln for ln in ipath.read_text().splitlines() if ln.strip()] \
                if ipath.exists() else []
            self._n_frames = len(lines)
            if lines:
                # the monotonicity guard compares against these, and a resumed
                # writer with _n_frames set but _last_step still None crashes on
                # its first frame instead of refusing a non-monotone one
                last = json.loads(lines[-1])
                self._last_step = last.get("step")
                self._last_time = last.get("t")
            self._data = open(dpath, "ab")
            self._index = open(ipath, "a")
            self._appended_to = True
            return
        self._appended_to = False
        self._data = open(self.path / "data.bin", "wb")
        self._index = open(self.path / "frames.jsonl", "w")
        (self.path / "header.json").write_text(json.dumps(self.header(),
                                                          indent=2))

    # ---------------------------------------------------------------- header
    def header(self) -> dict:
        return {
            "schema": SCHEMA,
            "box": [float(x) for x in self.box],
            "units": self.units,
            "t0_origin": self.t0_origin,
            "t0_offset_tau": (float(self.t0_offset_tau)
                              if self.t0_offset_tau is not None else None),
            "t0_note": (
                "run_clock_time = tape_time + t0_offset_tau. t0_origin names "
                "what tape t=0 IS on the producing run's clock; 'unspecified' "
                "means the producer did not say and the two clocks must NOT be "
                "assumed equal."),
            "n_total": int(self.n_total),
            "run_seed": int(self.run_seed),
            "mode": self.mode,
            "n_subset": int(self.n_subset) if self.n_subset else None,
            "subset_derivation": (
                "blake2b(schema|mode|run_seed|n_subset|n_total) -> "
                "np.random.default_rng -> sorted choice without replacement. "
                "A pure function of the header, so it is identical across "
                "restarts; see core.video.tape.subset_indices"),
            "roi": [[float(x) for x in c] for c in self.roi] if self.roi else None,
            "periodic": [bool(x) for x in self.periodic],
            "periodic_note": (
                "which axes wrap. Load-bearing for BOTH the displacement bound "
                "and interpolation: a particle crossing from L-eps to eps did "
                "not travel the box, it took one short step, and treating that "
                "as motion reports the box length as a displacement and draws "
                "the particle sweeping across the frame."),
            "quantize": self.quantize,
            "quantize_note": (
                "uint16 maps [0, L) per axis onto [0, 65535]; the resolution "
                "is L/65535 per axis and MUST be checked against the tightest "
                "shot this tape will serve, not the widest (RENDERING.md 4)"),
            "quantize_resolution": (
                [float(L) / 65535.0 for L in self.box]
                if self.quantize == "uint16" else None),
            "channels": [{"name": c.name, "dtype": c.dtype, "width": c.width,
                          "quantized": c.quantized,
                          "range": ([0, c.int_max] if c.is_integer else None),
                          "interpolation": c.interpolation}
                         for c in self._channels],
            "channel_dtype_note": (
                "an unquantized integer channel is the integer itself: it is "
                "written losslessly or `append` raises (no truncation, no "
                "saturation), it reads back as an integer array, and `at()` "
                "takes the nearest sample rather than lerping a count no "
                "particle held (AGENTS rule 9). `range` is DERIVED from "
                "`dtype` and written for a reader that is not this module; "
                "TapeReader ignores it and re-derives, which is what lets a "
                "tape written before these fields existed still open. If the "
                "two ever disagree, `dtype` is the authority."),
            "git": (str(self.git_sha) if self.git_sha is not None
                    else _git_sha()),
            "env": _env_record(),
            "terms_tag": self.meta.get("terms_tag"),
            "rendered_in_block": True,
            "rendered_in_block_note": (
                "taping is off the clock but not free; a run that taped does "
                "not publish a comparable steps/s (AGENTS rule 11)"),
            "meta": self.meta,
        }

    # ---------------------------------------------------------------- append
    def append(self, step: int, time: float, pos, vel=None, **scalars):
        """One frame. `pos` is (n, 3) in world coordinates."""
        pos = np.asarray(_to_numpy(pos), dtype=np.float64)
        if pos.ndim != 2 or pos.shape[1] != 3:
            raise ValueError(f"pos must be (n, 3), got {pos.shape}")
        if pos.shape[0] != self.n_total:
            raise ValueError(
                f"pos has {pos.shape[0]} rows but the header says n_total="
                f"{self.n_total}; a tape whose particle count changes between "
                "frames cannot be interpolated")
        keep = self._select(pos)
        p = pos[keep] if keep is not None else pos
        payload = [self._encode_pos(p)]
        if self.velocity:
            if vel is None:
                raise ValueError("this tape declares a velocity channel")
            v = np.asarray(_to_numpy(vel), dtype=np.float32)
            payload.append((v[keep] if keep is not None else v).ravel())
        for c in self._channels[1 + int(self.velocity):]:
            if c.name not in scalars:
                raise ValueError(f"missing declared scalar channel {c.name!r}")
            a = np.asarray(_to_numpy(scalars[c.name]))
            if a.shape[0] != self.n_total:
                raise ValueError(
                    f"scalar channel {c.name!r} has {a.shape[0]} rows but the "
                    f"header says n_total={self.n_total}; a short scalar would "
                    "be written as a short payload and read back misaligned "
                    "against pos")
            if c.is_integer:
                a = self._encode_int(c, a)
            else:
                a = a.astype(np.float32)
            payload.append((a[keep] if keep is not None else a).ravel())
        # A TAPE'S TIMELINE MUST ONLY GO FORWARD. Measured 2026-08-27: E02's
        # tape hook numbered production's steps from zero again, so a
        # --tape-phase both tape folded back to step 0 at the phase boundary.
        # `TapeReader.at` searchsorts `times`, so the fold made every later
        # frame unreachable BY TIME — and nothing said so. The file was
        # written, the frame count was right, `max_displacement` still returned
        # a plausible number because positions are continuous across the fold
        # even when the clock is not. A silent success (AGENTS rule 12), and
        # the guard belongs HERE rather than in each caller: the writer is the
        # one place that sees every frame of every tape.
        if self._n_frames:
            if step <= self._last_step or time <= self._last_time:
                raise ValueError(
                    f"tape timeline went backwards at frame {self._n_frames}: "
                    f"step {self._last_step} -> {step}, t {self._last_time!r} "
                    f"-> {time!r}. A tape is a trajectory and its clock only "
                    "increases; TapeReader.at() searchsorts `times` and cannot "
                    "read past a fold. If two phases are being taped, number "
                    "the second one from where the first ended.")
        self._last_step, self._last_time = int(step), float(time)

        blob = b"".join(x.tobytes() for x in payload)
        self._data.write(blob)
        self._data.flush()
        rec = {"i": self._n_frames, "step": int(step), "t": float(time),
               "n": int(p.shape[0]), "off": self._offset, "len": len(blob)}
        self._index.write(json.dumps(rec) + "\n")
        self._index.flush()
        self._offset += len(blob)
        self._n_frames += 1
        return rec

    def _select(self, pos):
        if self.mode == "subset":
            # RE-DERIVED AND VERIFIED, not trusted. If a caller ever mutated
            # the writer's index this catches it here rather than in a film.
            want = subset_indices(self.n_total, self.n_subset, self.run_seed)
            if not np.array_equal(want, self._idx):
                raise TapeIntegrityError(
                    "the subset index changed after construction; membership "
                    "must be a pure function of the header")
            return self._idx
        if self.mode == "roi":
            (x0, y0, z0), (x1, y1, z1) = self.roi
            m = ((pos[:, 0] >= x0) & (pos[:, 0] < x1)
                 & (pos[:, 1] >= y0) & (pos[:, 1] < y1)
                 & (pos[:, 2] >= z0) & (pos[:, 2] < z1))
            return np.nonzero(m)[0]
        return None

    def _encode_int(self, c: Channel, a):
        """LOSSLESS OR IT RAISES — the opposite of `_encode_pos`, deliberately.

        A position is a real number and clamping it is a bounded, countable,
        reportable error. A count is not: `astype(uint8)` turns 260 into 4 and
        3.5 into 3, and both land in the file as ordinary-looking numbers with
        nothing downstream able to tell. Saturating to 255 is no better — it
        is the same lie with a flatter tail. So the check is on the values
        BEFORE any cast, and it fires.

        Checked on the whole input rather than on the selected rows: a value
        that raises only when its particle happens to fall inside an `roi`
        would make the same physics pass on one frame and fail on the next.
        """
        f = np.asarray(a, dtype=np.float64).reshape(-1)
        cap = c.int_max
        where = f"scalar channel {c.name!r} ({c.dtype}, representable 0..{cap})"

        def _offender(mask):
            hit = np.nonzero(mask)[0]
            if not hit.size:
                return None, None
            i = int(hit[0])
            v = float(f[i])
            return i, (int(v) if v.is_integer() else v)

        # NaN fails `!=` against its own floor, so it is reported here rather
        # than surviving the range test.
        i, v = _offender(f != np.floor(f))
        if i is not None:
            raise ValueError(
                f"{where}: value {v} at index {i} is not an integer, and the "
                f"cap is {cap}; an integer channel is lossless or it raises, "
                "and casting would have truncated it")
        i, v = _offender((f < 0) | (f > cap))
        if i is not None:
            raise ValueError(
                f"{where}: value {v} at index {i} is outside [0, {cap}], the "
                f"cap for {c.dtype}; storing it would wrap (260 -> 4) and "
                "saturating it would flatten the tail, so neither is done — "
                "widen the dtype or fix the producer")
        return f.astype(c.dtype)

    def _encode_pos(self, p):
        if self.quantize == "fp32":
            return p.astype(np.float32).ravel()
        L = np.asarray(self.box, dtype=np.float64)
        q = p / L * 65535.0
        # RULE 9: a position outside the box is CLAMPED AND COUNTED, never
        # silently wrapped into a different place in the world. `clamped` in
        # the trailer says how many, so "no particle left the box" and "the
        # tape quietly folded some back in" cannot look the same.
        out = int(np.count_nonzero((q < 0) | (q > 65535.0)))
        self._clamped_total += out
        return np.clip(q, 0.0, 65535.0).round().astype(np.uint16).ravel()

    # ----------------------------------------------------------------- close
    def close(self):
        self._data.close()
        self._index.close()
        (self.path / "trailer.json").write_text(json.dumps({
            "schema": SCHEMA,
            "frames": self._n_frames,
            "bytes": self._offset,
            "clamped_positions_total": self._clamped_total,
            "clamped_note": ("positions outside the box were clamped into it "
                             "by the uint16 mapping; nonzero means the tape "
                             "does not show where those particles were"),
        }, indent=2))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _to_numpy(a):
    return a.detach().cpu().numpy() if hasattr(a, "detach") else np.asarray(a)


# -------------------------------------------------------------------- reader


class TapeReader:
    """Random access by frame index or by physical time."""

    def __init__(self, path):
        self.path = Path(path)
        self.header = json.loads((self.path / "header.json").read_text())
        if self.header["schema"] != SCHEMA:
            raise TapeIntegrityError(
                f"tape schema {self.header['schema']} != reader's {SCHEMA}")
        self.channels = [Channel(c["name"], c["dtype"], c["width"],
                                 c["quantized"]) for c in self.header["channels"]]
        self.frames = self._read_index()
        self._blob = None
        self.trailer = None
        tp = self.path / "trailer.json"
        if tp.exists():
            self.trailer = json.loads(tp.read_text())
        # MEMO for `max_displacement`, which scans every frame of the tape.
        # Safe on the instance because `self.frames` is already a snapshot
        # taken at construction: this reader's view of the tape does not grow,
        # so a quantity derived from it cannot go stale within its lifetime.
        self._max_disp = None

    def _blob_for_reads(self):
        if self._blob is None and self.frames:
            self._blob = np.memmap(self.path / "data.bin", dtype=np.uint8,
                                  mode="r")
        return self._blob

    def __del__(self):
        blob = getattr(self, "_blob", None)
        if blob is not None:
            try:
                blob.flush()
            except Exception:  # pragma: no cover - interpreter shutdown
                pass
            try:
                del self._blob
            except AttributeError:  # pragma: no cover - partially torn state
                pass

    def _read_index(self):
        """A TORN FINAL LINE IS EXPECTED, not an error. The writer flushes
        after every frame, so a kill lands mid-line at worst; that frame is
        dropped and everything before it is intact."""
        out, path = [], self.path / "frames.jsonl"
        if not path.exists():
            return out
        size = (self.path / "data.bin").stat().st_size
        for line in path.read_text().splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                break                       # torn tail: stop, keep the rest
            if rec["off"] + rec["len"] > size:
                break                       # payload never made it to disk
            out.append(rec)
        return out

    def __len__(self):
        return len(self.frames)

    @property
    def times(self):
        return np.array([f["t"] for f in self.frames], dtype=np.float64)

    def frame(self, i: int) -> dict:
        rec = self.frames[i]
        raw = self._blob_for_reads()[rec["off"]: rec["off"] + rec["len"]]
        n, pos_ = rec["n"], 0
        out = {"i": rec["i"], "step": rec["step"], "t": rec["t"], "n": n}
        for c in self.channels:
            nbytes = n * c.itemsize
            # A WIDTH-1 CHANNEL COMES BACK (n,), NOT (n, 1) -- and the
            # reshape happens AFTER _decode so decode still sees the shape it
            # has always seen. `species` and `ke` used to arrive 2-D, and
            # `np.where(sp == 0, 2., 1.)[:, None]` against `pos` then
            # broadcasts to (n, n, 3): at n=508744 that is a 1.5 PB
            # allocation from a line that reads correctly, dying with no
            # traceback and no output. It killed four analysis runs in one
            # night and was twice misdiagnosed as the job wrapper.
            #
            # Every reader in this repo already called `.reshape(-1)`, so the
            # repo was clean -- but that was a property of one file's habits,
            # not of the format, and habits do not reach the next throwaway
            # script. Fixing it HERE makes the trap unreachable rather than
            # documented: those `.reshape(-1)` calls become no-ops and stay
            # correct, nothing in the repo indexes these channels 2-D
            # (grepped: zero occurrences), and NO TAPE ON DISK CHANGES, which
            # is why this was the right lever -- a format change would have
            # stranded four members mid-sweep.
            # Contract pinned by tests/test_tape_channel_shape.py.
            a = np.frombuffer(raw[pos_: pos_ + nbytes].tobytes(),
                              dtype=c.dtype).reshape(n, c.width)
            pos_ += nbytes
            v = self._decode(c, a)
            out[c.name] = v.reshape(-1) if c.width == 1 else v
        return out

    # ------------------------------------------------------ periodic images
    def _periodic(self):
        """Which axes wrap, and whether the tape actually said so.

        A tape written before `periodic` existed does not carry it. All-periodic
        is the right reading for such a tape — the quantization range IS the box
        and every writer in this repo was fully periodic — but it is an
        ASSUMPTION, so `max_displacement` and `at` both report that they made it
        rather than presenting the result as if the file had stated it.
        """
        raw = self.header.get("periodic")
        if raw is None:
            return (True, True, True), True
        return tuple(bool(x) for x in raw), False

    def _min_image(self, d):
        """Displacement folded to the SHORT path on periodic axes.

        Without this, a particle stepping from `L-eps` to `eps` reads as having
        moved `L-2eps`. Measured 2026-08-27 on a 6x6x5 E02 slab: the reported
        max displacement was 14.44 sigma in a box 14.5 sigma across — the
        instrument was returning the box size, and the cadence bound the whole
        interpolation claim rests on was being checked against it.
        """
        per, _ = self._periodic()
        L = np.asarray(self.header["box"], dtype=np.float64)
        d = np.asarray(d, dtype=np.float64).copy()
        for k in range(3):
            if per[k] and L[k] > 0:
                d[:, k] -= L[k] * np.round(d[:, k] / L[k])
        return d

    def _decode(self, c: Channel, a):
        if c.is_integer:
            # `.copy()` because the caller gets a writable array from every
            # other channel (they are all cast) and a read-only one here would
            # be a difference between channels that nothing declares.
            return a.copy()
        if not c.quantized:
            return a.astype(np.float32)
        L = np.asarray(self.header["box"], dtype=np.float64)
        return (a.astype(np.float64) / 65535.0 * L).astype(np.float32)

    # ------------------------------------------------------------------ time
    def at(self, t: float, interpolation: str = "linear") -> dict:
        """The state at physical time `t`.

        `interpolation` is a DECLARED field of the Shot and lands in the
        artifact — a picture whose in-between frames were invented one way
        rather than another is not the same picture (RENDERING.md §5b).

        Linear interpolation is honest only while the tape's own displacement
        bound holds between ADJACENT SAMPLES under the shot's maximum
        slow-motion factor. Past that, the fix is a denser tape, not a
        smoother curve: smoothing past the bound is inventing trajectory.

        `interpolation` is what was ASKED FOR; `channel_interpolation` in the
        returned dict is what was DONE, per channel, because the two differ.
        An integer channel is never lerped — a coordination of 11.4 is a
        number no particle had, and colouring by it would show a fluid that
        does not exist — so it takes the nearer bracketing sample and says so.
        A caller that renders colour from a count reads that field rather than
        assuming the mode it passed.
        """
        if not self.frames:
            raise TapeIntegrityError("empty tape")
        ts = self.times
        if interpolation == "nearest" or len(ts) == 1:
            return self._as_nearest(self.frame(int(np.argmin(np.abs(ts - t)))))
        if interpolation != "linear":
            raise ValueError(f"unknown interpolation {interpolation!r}")
        j = int(np.searchsorted(ts, t))
        if j <= 0:
            return self._as_nearest(self.frame(0))
        if j >= len(ts):
            return self._as_nearest(self.frame(len(ts) - 1))
        a, b = self.frame(j - 1), self.frame(j)
        if a["n"] != b["n"]:
            # An `roi` tape's population changes between frames, so there is
            # no correspondence to interpolate along. Say so rather than
            # lerping two different particles into each other.
            raise TapeIntegrityError(
                f"frames {j-1} and {j} hold {a['n']} and {b['n']} particles; "
                "interpolation needs a fixed population — use "
                "interpolation='nearest' on an roi tape")
        w = (t - a["t"]) / (b["t"] - a["t"])
        near = a if w <= 0.5 else b       # ties to the earlier sample, as
                                          # `argmin` does on the nearest path
        out = {"i": None, "step": None, "t": float(t), "n": a["n"],
               "between": (a["i"], b["i"]), "w": float(w),
               "interpolation": "linear",
               "channel_interpolation": {c.name: c.interpolation
                                         for c in self.channels},
               "nearest_frame": near["i"]}
        for c in self.channels:
            if c.is_integer:
                out[c.name] = near[c.name]
            elif c.name == "pos":
                # Along the MINIMUM IMAGE, then wrapped back into the box. A
                # straight lerp between a particle at `eps` and the same
                # particle at `L-eps` walks it the long way across the entire
                # frame at enormous speed — a motion that never happened, drawn
                # in full view, which is exactly what AGENTS rule 8 forbids.
                # The short path IS what the particle did.
                per, _ = self._periodic()
                L = np.asarray(self.header["box"], dtype=np.float64)
                pa = np.asarray(a["pos"], dtype=np.float64)
                q = pa + w * self._min_image(np.asarray(b["pos"],
                                                        dtype=np.float64) - pa)
                for k in range(3):
                    if per[k] and L[k] > 0:
                        q[:, k] = np.mod(q[:, k], L[k])
                q = q.astype(np.float32)
                # `mod` in fp64 can leave a value a hair under L that fp32
                # ROUNDS UP to exactly L, which is outside the [0, L) this tape
                # promises — measured here on a particle interpolated across
                # the x boundary. Fold it once more in the output dtype.
                # core/engine/box.py `_out_of_range` documents the same fp32 fact.
                for k in range(3):
                    if per[k] and L[k] > 0:
                        q[:, k][q[:, k] >= np.float32(L[k])] = np.float32(0.0)
                out["pos"] = q
            else:
                out[c.name] = ((1.0 - w) * a[c.name]
                               + w * b[c.name]).astype(np.float32)
        out["pos_interpolation"] = "minimum image, rewrapped into the box"
        return out

    def _as_nearest(self, frame: dict) -> dict:
        """A whole-frame readout still declares its per-channel rule, so a
        caller can read `channel_interpolation` unconditionally instead of
        branching on which path inside `at` happened to fire."""
        frame["interpolation"] = "nearest"
        frame["channel_interpolation"] = {c.name: "nearest"
                                          for c in self.channels}
        frame["nearest_frame"] = frame["i"]
        return frame

    # ------------------------------------------------------------- the bound
    def _disp_cache_key(self) -> dict:
        """What the cached scan must match to be reusable.

        The frame COUNT and the payload SIZE, plus a digest of the header —
        never a digest of `data.bin`, which is 3.76 GB and would cost more to
        hash than the scan costs to redo. A tape that grew, was re-recorded,
        or changed its channel layout misses on one of the three and the scan
        runs again.
        """
        try:
            size = (self.path / "data.bin").stat().st_size
        except OSError:
            size = None
        h = hashlib.sha256(
            (self.path / "header.json").read_bytes()).hexdigest()[:16]
        return {"schema": SCHEMA, "n_frames": len(self.frames),
                "data_bytes": size, "header_sha256": h}

    def _read_disp_cache(self):
        p = self.path / "max_displacement.json"
        if not p.exists():
            return None
        try:
            d = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            return None
        if d.get("key") != self._disp_cache_key():
            return None
        v = dict(d.get("value") or {})
        if "max" not in v:
            return None
        v["source"] = f"READ from {p}, key verified against this tape"
        return v

    def _write_disp_cache(self, value) -> str:
        p = self.path / "max_displacement.json"
        mode = self.path.stat().st_mode if self.path.exists() else 0
        if os.name == "nt" and not (mode & stat.S_IWUSR):
            return "not written (read-only results dir)"
        try:
            p.write_text(json.dumps(
                {"schema": "video/tape/maxdisp/1",
                 "key": self._disp_cache_key(),
                 "value": {k: v for k, v in value.items() if k != "source"},
                 "note": ("a pure function of this tape's bytes, cached "
                          "because a chunked render calls it once per shot "
                          "segment per job. The key is checked on read; a "
                          "tape that grew or was re-recorded misses it")},
                indent=2))
            return str(p)
        except OSError as exc:                           # read-only results dir
            return f"not written ({exc!r})"

    def max_displacement(self, *, cache=True) -> dict:
        """The largest distance any particle moved between ADJACENT TAPE
        SAMPLES — the quantity RENDERING.md §5b's cadence bound is stated on.

        Measured, not assumed. A shot checks its own slow-motion factor
        against this at storyboard time; a tape that fails the bound needs to
        be denser, and finding that out before the render is the point.
        """
        if self._max_disp is not None:
            return self._max_disp
        if len(self.frames) < 2:
            return {"max": None, "reason": "fewer than two frames"}
        if cache:
            got = self._read_disp_cache()
            if got is not None:
                self._max_disp = got
                return got
        t_scan = time.perf_counter()
        worst, where = 0.0, None
        prev = self.frame(0)
        for i in range(1, len(self.frames)):
            cur = self.frame(i)
            if cur["n"] != prev["n"]:
                prev = cur
                continue
            d = float(np.sqrt(
                (self._min_image(cur["pos"] - prev["pos"]) ** 2).sum(1)).max())
            if d > worst:
                worst, where = d, (i - 1, i)
            prev = cur
        per, assumed = self._periodic()
        secs = time.perf_counter() - t_scan
        out = {"max": worst, "between_frames": where,
                "frames": len(self.frames),
                "scan_seconds": round(secs, 2),
                "periodic": list(per),
                "periodic_assumed": assumed,
                "meaning": ("largest single-particle displacement between "
                            "adjacent tape samples, in world units, along the "
                            "MINIMUM IMAGE — a wrap is one short step, not a "
                            "traverse of the box")}
        out["source"] = (f"COMPUTED by a full scan of {len(self.frames)} "
                         f"frames in {secs:.1f} s")
        if cache:
            out["cached_to"] = self._write_disp_cache(out)
        self._max_disp = out
        return out
