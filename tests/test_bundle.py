"""WP1: the tape bundle, against docs/specs/M0-hall.md.

The writer here is deliberately NOT spectre's `TapeWriter`: the point of these
tests is that `orchard.bundle` reads `video/tape/1` as the format is written
down, not as one implementation happens to behave, so the fixture is a
from-scratch writer of the three files the format names.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pytest

from orchard import bundle
from orchard.bundle import (BYTES_PER_SLOT_FRAME, CHUNK_HEADER_BYTES, MAGIC,
                            bundle_tape, canonical, compute_id, hash_rank_take,
                            sha256_file, slot_indices, variant_plan, verify_id)

BOX = [10.0, 20.0, 1.0]


# ------------------------------------------------------------- minimal writer


def write_tape(path: Path, pos, species, alive, *, box=BOX, times=None,
               periodic=(True, True, False), meta=None, quantize="fp32") -> Path:
    """`video/tape/1`: header.json + frames.jsonl + data.bin.

    Frame payload is the channels back to back in header order: positions
    (`float32[n,3]`, or `uint16[n,3]` over `[0, L)` when `quantize="uint16"`),
    then `uint8[n]` species, then `uint8[n]` alive.
    """
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    pos = np.asarray(pos, dtype=np.float32)
    species = np.asarray(species, dtype=np.uint8)
    alive = np.asarray(alive, dtype=np.uint8)
    frames, n, _ = pos.shape
    times = np.arange(frames, dtype=float) * 0.5 if times is None else np.asarray(times)
    if quantize == "uint16":
        enc = np.clip(pos.astype(np.float64) / np.array(box) * 65535.0,
                      0, 65535).round().astype(np.uint16)
        pos_channel = {"name": "pos", "dtype": "uint16", "width": 3,
                       "quantized": True, "range": None,
                       "interpolation": "linear"}
    else:
        enc = pos.astype(np.float32)
        pos_channel = {"name": "pos", "dtype": "float32", "width": 3,
                       "quantized": False, "range": None,
                       "interpolation": "linear"}
    header = {
        "schema": "video/tape/1",
        "box": list(box),
        "units": "reduced (sigma, tau)",
        "t0_origin": "run start",
        "t0_offset_tau": 0.0,
        "n_total": int(n),
        "run_seed": 0,
        "mode": "full",
        "n_subset": None,
        "roi": None,
        "periodic": list(periodic),
        "quantize": quantize,
        "quantize_resolution": None,
        "channels": [
            pos_channel,
            {"name": "species", "dtype": "uint8", "width": 1, "quantized": False,
             "range": [0, 255], "interpolation": "nearest"},
            {"name": "alive", "dtype": "uint8", "width": 1, "quantized": False,
             "range": [0, 255], "interpolation": "nearest"},
        ],
        "git": "test",
        "env": {},
        "meta": meta or {"producer": "tests.test_bundle", "scene": "synthetic"},
    }
    (path / "header.json").write_text(json.dumps(header, indent=2))
    off = 0
    with open(path / "data.bin", "wb") as data, open(path / "frames.jsonl", "w") as idx:
        for i in range(frames):
            blob = (enc[i].tobytes() + species[i].tobytes() + alive[i].tobytes())
            data.write(blob)
            idx.write(json.dumps({"i": i, "step": i * 10, "t": float(times[i]),
                                  "n": int(n), "off": off, "len": len(blob)}) + "\n")
            off += len(blob)
    (path / "trailer.json").write_text(json.dumps(
        {"schema": "video/tape/1", "frames": frames, "bytes": off,
         "clamped_positions_total": 0}))
    return path


def synthetic(rng, frames=3, n=2500):
    """Positions strictly inside [0, L), two species, the tail of slots dead."""
    box = np.array(BOX)
    pos = rng.random((frames, n, 3)) * box * 0.999
    pos[:, :, 2] = 0.0                       # a 2D tape: z = 0, Lz = 1
    species = (np.arange(n) % 2).astype(np.uint8)
    alive = np.ones((frames, n), dtype=np.uint8)
    alive[1:, -100:] = 0                     # 100 slots die after frame 0
    for f in range(1, frames):               # a dead slot keeps its position
        pos[f, -100:] = pos[0, -100:]
    return pos.astype(np.float32), species[None, :].repeat(frames, 0), alive


# ------------------------------------------------------------------- decoding


def read_chunk(blob: bytes) -> dict:
    """The spec's table, offset by offset, with nothing inferred."""
    assert blob[0:4] == MAGIC
    n, frames, frame0 = struct.unpack_from("<III", blob, 4)
    t0, dt = struct.unpack_from("<ff", blob, 16)
    reserved = blob[24:32]
    body = blob[CHUNK_HEADER_BYTES:]
    stride = n * BYTES_PER_SLOT_FRAME
    pos = np.empty((frames, n, 3), np.uint16)
    species = np.empty((frames, n), np.uint8)
    alive = np.empty((frames, n), np.uint8)
    for f in range(frames):
        at = f * stride
        pos[f] = np.frombuffer(body, "<u2", count=n * 3, offset=at).reshape(n, 3)
        species[f] = np.frombuffer(body, np.uint8, count=n, offset=at + n * 6)
        alive[f] = np.frombuffer(body, np.uint8, count=n, offset=at + n * 7)
    return {"n": n, "frames": frames, "frame0": frame0, "t0": t0, "dt": dt,
            "reserved": reserved, "pos": pos, "species": species, "alive": alive,
            "stride": stride}


def read_variant(bundle_dir: Path, name: str) -> dict:
    doc = json.loads((bundle_dir / "bundle.json").read_text())
    v = doc["variants"][name]
    parts = [read_chunk((bundle_dir / c["file"]).read_bytes()) for c in v["chunks"]]
    return {"doc": v, "chunks": parts,
            "pos": np.concatenate([p["pos"] for p in parts]),
            "species": np.concatenate([p["species"] for p in parts]),
            "alive": np.concatenate([p["alive"] for p in parts])}


@pytest.fixture
def tape(tmp_path):
    rng = np.random.default_rng(0)
    pos, species, alive = synthetic(rng)
    write_tape(tmp_path / "tape", pos, species, alive)
    return tmp_path / "tape", pos, species, alive


# ---------------------------------------------------------------- round trip


def test_round_trip(tape, tmp_path):
    tape_dir, pos, species, alive = tape
    out = bundle_tape(tape_dir, "einstruct", "synthetic", tmp_path / "bundles",
                      chunk_frames=2, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())

    assert doc["schema"] == "orchard/bundle/1"
    assert doc["kind"] == "tape"
    assert out.name == doc["id"]
    assert doc["box"] == BOX
    assert doc["periodic"] == [True, True, False]
    assert doc["n_slots"] == pos.shape[1]
    assert doc["species_names"] == ["A", "B"]        # two species, no meta names
    assert doc["poster"] == "poster.png"
    assert (out / "poster.png").exists()
    assert set(doc["variants"]) == {"vr-high", "vr-quest", "phone"}

    got = read_variant(out, "vr-high")
    assert got["doc"]["frames"] == pos.shape[0]
    assert got["doc"]["frame_stride"] == 1
    assert got["doc"]["slot_stride"] == 1            # 2500 slots fits the budget
    assert got["doc"]["n"] == pos.shape[1]

    # positions come back within one quantization step of the source
    L = np.array(BOX)
    back = got["pos"].astype(np.float64) / 65535.0 * L
    assert np.abs(back - pos).max() <= (L / 65535.0).max()
    assert (got["pos"][:, :, 2] == 0).all()          # 2D tape: z is exactly 0
    # species and alive are exact, never interpolated, never rescaled
    assert (got["species"] == species).all()
    assert (got["alive"] == alive).all()


def test_poster_is_1280x720(tape, tmp_path):
    tape_dir, *_ = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    from PIL import Image
    with Image.open(out / "poster.png") as im:
        assert im.size == (1280, 720)


def test_irregular_source_times_and_origin_survive_every_variant(tmp_path):
    times = np.array([10.0, 10.1, 11.9, 12.0, 14.0])
    pos, species, alive = synthetic(np.random.default_rng(4), frames=len(times), n=8)
    tape_dir = write_tape(tmp_path / "clock", pos, species, alive, times=times)
    header = json.loads((tape_dir / "header.json").read_text())
    header.update(units="reduced (sigma, t0)", t0_origin="end of relaxation",
                  t0_offset_tau=250.0)
    (tape_dir / "header.json").write_text(json.dumps(header))
    out = bundle_tape(tape_dir, "clock", "irregular clock", tmp_path / "bundles",
                      chunk_frames=2, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["time_unit"] == doc["poster_info"]["time_unit"] == "t0"
    assert doc["source"]["t0_origin"] == "end of relaxation"
    assert doc["source"]["t0_offset_tau"] == 250.0
    for variant in doc["variants"].values():
        assert variant["times_tau"] == times[::variant["frame_stride"]].tolist()
        assert variant["source_dt_tau"] == 1.0
        assert variant["timing"]["source_frames"] == len(times)
        assert variant["payload_bytes"] == variant["frames"] * variant["n"] * 8
    assert doc["variants"]["vr-high"]["timing"]["max_uniform_error_tau"] == 1.0
    # The sidecar correction leaves the deployed OTC1 binary layout intact.
    first = read_chunk((out / doc["variants"]["vr-high"]["chunks"][0]["file"]).read_bytes())
    assert first["reserved"] == b"\x00" * 8
    assert first["t0"] == 10.0
    assert verify_id(out)[0]


@pytest.mark.parametrize("times", [[0.0, 0.0], [1.0, 0.0], [0.0, float("nan")],
                                   [0.0, float("inf")]])
def test_bundle_rejects_ambiguous_source_clocks(tmp_path, times):
    pos, species, alive = synthetic(np.random.default_rng(2), frames=2, n=8)
    tape_dir = write_tape(tmp_path / "invalid-clock", pos, species, alive, times=times)
    with pytest.raises(ValueError, match="finite and strictly increasing"):
        bundle_tape(tape_dir, "clock", "invalid", tmp_path / "bundles", verbose=False)
    assert not (tmp_path / "bundles").exists(), "invalid source timing must not publish a bundle"


@pytest.mark.parametrize("header,expected", [
    ({"units": "reduced (sigma, tau)"}, "tau"),
    ({"units": "reduced (sigma, t0)"}, "t0"),
    ({"units": "SI", "time_unit": "s"}, "s"),
    ({"units": "unknown producer convention"}, None),
    ({}, None),
])
def test_time_units_are_stated_or_known_not_guessed(header, expected):
    assert bundle.tape_time_unit(header) == expected


def test_unknown_units_and_omitted_channels_are_explicit(tmp_path):
    from orchard_tape import TapeWriter
    tape_dir = tmp_path / "with-heat"
    writer = TapeWriter(tape_dir, box=tuple(BOX), n_total=2, run_seed=0, units="producer clock",
                        scalars=("ke",), git_sha="test")
    writer.append(0, 17.0, np.array([[1, 1, 0], [2, 2, 0]]), ke=np.array([2, 3]))
    writer.close()
    out = bundle_tape(tape_dir, "clock", "heat", tmp_path / "bundles", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert "time_unit" not in doc
    assert doc["poster_info"]["time_unit"] is None
    assert doc["source"]["omitted_channels"] == ["ke"]
    assert doc["source"]["channels"] == json.loads((tape_dir / "header.json").read_text())["channels"]
    assert doc["variants"]["vr-high"]["times_tau"] == [17.0]


def test_empty_poster_reports_zero_drawn_particles(tmp_path):
    pos, species, alive = synthetic(np.random.default_rng(2), frames=3, n=8)
    alive[:] = 0
    tape_dir = write_tape(tmp_path / "empty-frame", pos, species, alive)
    out = bundle_tape(tape_dir, "clock", "no survivors", tmp_path / "bundles", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["poster_info"]["drawn"] == 0


# --------------------------------------------------------------- chunk header


def test_chunk_header_matches_the_spec_table(tape, tmp_path):
    tape_dir, pos, _s, _a = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b",
                      chunk_frames=2, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    v = doc["variants"]["vr-high"]
    assert [c["frames"] for c in v["chunks"]] == [2, 1]   # 3 frames, 2 per chunk
    assert [c["frame0"] for c in v["chunks"]] == [0, 2]

    for c in v["chunks"]:
        blob = (out / c["file"]).read_bytes()
        # offset 0: magic; 4/8/12: u32 n, frames, frame0; 16/20: f32 t0, dt;
        # 24..32: eight reserved zero bytes; 32: the frames.
        assert blob[0:4] == b"OTC1"
        n = struct.unpack_from("<I", blob, 4)[0]
        frames = struct.unpack_from("<I", blob, 8)[0]
        frame0 = struct.unpack_from("<I", blob, 12)[0]
        t0 = struct.unpack_from("<f", blob, 16)[0]
        dt = struct.unpack_from("<f", blob, 20)[0]
        assert blob[24:32] == b"\x00" * 8
        assert n == pos.shape[1]
        assert frames == c["frames"]
        assert frame0 == c["frame0"]
        assert t0 == pytest.approx(frame0 * 0.5)
        assert dt == pytest.approx(0.5)
        # frame stride is n x 8 bytes and the file is header + frames x stride
        assert len(blob) == CHUNK_HEADER_BYTES + frames * n * 8
        assert n * BYTES_PER_SLOT_FRAME == n * 8
        assert c["bytes"] == len(blob)
        import hashlib
        assert c["sha256"] == hashlib.sha256(blob).hexdigest()

    # within a frame: u16[3] x n, then u8 x n, then u8 x n
    ch = read_chunk((out / v["chunks"][0]["file"]).read_bytes())
    assert ch["stride"] == ch["n"] * 8
    assert ch["pos"].dtype == np.uint16 and ch["pos"].shape[2] == 3


# ------------------------------------------------------------------ the id


def test_id_is_the_spec_s_hash_and_is_stable(tape, tmp_path):
    tape_dir, *_ = tape
    a = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "a", verbose=False)
    b = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    assert a.name == b.name, "same inputs must give the same id"

    doc = json.loads((a / "bundle.json").read_text())
    import hashlib
    payload = json.dumps({**doc, "id": ""}, sort_keys=True, separators=(",", ":"))
    assert doc["id"] == hashlib.sha256(payload.encode()).hexdigest()[:16]
    assert len(doc["id"]) == 16
    assert canonical(doc) == payload
    ok, on_disk, recomputed = verify_id(a)
    assert ok, (on_disk, recomputed)

    # the title is content: change it and the id moves
    c = bundle_tape(tape_dir, "einstruct", "other", tmp_path / "c", verbose=False)
    assert c.name != a.name


def test_compute_id_ignores_the_id_field():
    doc = {"schema": "orchard/bundle/1", "id": "deadbeef", "x": 1}
    assert compute_id(doc) == compute_id({**doc, "id": "0" * 16})


# ------------------------------------------------------------------ variants


def test_variant_plan():
    # spec's worked example: a 4,000-slot tape strides 1/1/2
    assert variant_plan(4000) == {"vr-high": (1, 1), "vr-quest": (2, 1),
                                  "phone": (2, 2)}
    # at or below 2000 slots the phone keeps every slot
    assert variant_plan(2000) == {"vr-high": (1, 1), "vr-quest": (2, 1),
                                  "phone": (2, 1)}
    # ab_d2: 200,000 slots against the 4,000 budget
    assert variant_plan(200000) == {"vr-high": (1, 50), "vr-quest": (2, 50),
                                    "phone": (2, 100)}
    # once the budget has already brought the variant under 2000 slots the
    # phone does not stride again: vr-high keeps 1000 slots, so does the phone
    assert variant_plan(10000, slot_budget=1000) == {"vr-high": (1, 10),
                                                     "vr-quest": (2, 10),
                                                     "phone": (2, 10)}
    # ...and it does stride again as soon as the budget leaves more than 2000
    assert variant_plan(200000, slot_budget=6000)["phone"] == (2, 68)


def test_phone_variant_strides(tape, tmp_path):
    tape_dir, pos, species, alive = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    high, quest, phone = (read_variant(out, k)
                          for k in ("vr-high", "vr-quest", "phone"))

    n = pos.shape[1]
    assert doc["n_slots"] == n == 2500
    # vr-quest: the same slots, every 2nd frame
    assert quest["doc"]["frame_stride"] == 2
    assert quest["doc"]["slot_stride"] == high["doc"]["slot_stride"]
    assert quest["doc"]["n"] == high["doc"]["n"]
    assert quest["doc"]["frames"] == len(range(0, pos.shape[0], 2))
    # phone: every 2nd frame AND every 2nd slot, because n_slots > 2000
    assert phone["doc"]["frame_stride"] == 2
    assert phone["doc"]["slot_stride"] == 2 * high["doc"]["slot_stride"]
    assert phone["doc"]["n"] == len(range(0, n, 2))
    assert phone["doc"]["frames"] == len(range(0, pos.shape[0], 2))
    # and the bytes are the strided bytes, not merely labelled as such
    assert (phone["pos"] == high["pos"][::2, ::2]).all()
    assert (phone["species"] == high["species"][::2, ::2]).all()
    assert (phone["alive"] == high["alive"][::2, ::2]).all()
    assert (quest["pos"] == high["pos"][::2]).all()
    # dt doubles with the frame stride
    assert phone["doc"]["dt_tau"] == pytest.approx(2 * high["doc"]["dt_tau"])
    # the declared byte count is the bytes on disk
    for v in doc["variants"].values():
        assert v["bytes"] == sum((out / c["file"]).stat().st_size
                                 for c in v["chunks"])
        assert v["payload_bytes"] == v["frames"] * v["n"] * 8


def test_slot_budget_binds(tmp_path):
    rng = np.random.default_rng(1)
    pos, species, alive = synthetic(rng, frames=4, n=1000)
    write_tape(tmp_path / "tape", pos, species, alive)
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      slot_budget=100, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["slot_budget"] == 100
    assert doc["n_slots"] == 1000
    assert doc["variants"]["vr-high"]["slot_stride"] == 10
    assert doc["variants"]["vr-high"]["n"] == 100
    assert doc["variants"]["phone"]["slot_stride"] == 10   # 100 slots < 2000
    keep, _sel = slot_indices(1000, 10, alive[-1])
    got = read_variant(out, "vr-high")
    L = np.array(BOX)
    back = got["pos"].astype(np.float64) / 65535.0 * L
    assert np.abs(back - pos[:, keep]).max() <= (L / 65535.0).max()


def test_slot_indices_is_the_identity_when_nothing_is_decimated():
    keep, sel = slot_indices(2500, 1)
    assert (keep == np.arange(2500)).all()
    assert sel["rule"] == "identity"


def test_slot_indices_is_deterministic_and_sorted():
    alive = np.zeros(200000, bool)
    alive[np.arange(7, 200000, 97)] = True
    a, sa = slot_indices(200000, 50, alive)
    b, sb = slot_indices(200000, 50, alive)
    assert (a == b).all() and sa == sb
    assert a.size == 4000
    assert (np.diff(a) > 0).all()
    assert a.min() >= 0 and a.max() < 200000


def test_hash_rank_take_is_pinned_to_literals():
    """F4: the draw must not ride on NumPy's RNG stream (NEP 19).

    These literals are the contract. If they change, every tape bundled
    before the change is at a different address than the same command
    produces now, and nothing else would say so.
    """
    seed = "orchard/bundle/1|slots|200000|4000"
    got = hash_rank_take(np.arange(200000), 4000, seed)
    assert got[:8].tolist() == [16, 85, 121, 286, 306, 314, 389, 494]
    assert got.size == 4000 and (np.diff(got) > 0).all()
    # a subset of candidates, not a subset of range()
    odd = hash_rank_take(np.arange(1, 200000, 2), 10, seed)
    assert (odd % 2 == 1).all()
    assert hash_rank_take(np.arange(5), 9, seed).tolist() == [0, 1, 2, 3, 4]
    assert hash_rank_take(np.arange(5), 0, seed).size == 0


def test_the_sampler_does_not_alias_against_a_species_layout(tmp_path):
    """einstruct lays A and B out by index parity; a stride would drop one.

    Measured on results/film/tapes/ab_d2: range(0, 200000, 50) selects 4,000
    particles that are 100% species A. Any decimation this bundler does must
    keep both species, or the room shows one colour and the annihilation the
    tape is about is invisible.
    """
    frames, n = 3, 1000
    rng = np.random.default_rng(11)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.9
    pos[:, :, 2] = 0.0
    species = np.tile((np.arange(n) % 2).astype(np.uint8), (frames, 1))
    write_tape(tmp_path / "tape", pos, species, np.ones((frames, n), np.uint8))
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      slot_budget=100, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())

    assert doc["variants"]["vr-high"]["slot_stride"] == 10   # an EVEN stride
    assert doc["species_names"] == ["A", "B"]
    got = read_variant(out, "vr-high")["species"]
    counts = np.bincount(got[0], minlength=2)
    assert counts.min() > 0, "a decimation that deletes a species is a bug"
    assert abs(int(counts[0]) - int(counts[1])) <= 30, counts
    assert doc["species_counts"] == counts.tolist()
    sel = doc["variants"]["vr-high"]["slot_selection"]
    assert sel["rule"] == "alive-last-then-blake2b"
    assert "blake2b" in sel["note"]


# ------------------------------------------------------- species and alive


def test_species_names_come_from_header_meta(tmp_path):
    rng = np.random.default_rng(2)
    pos, species, alive = synthetic(rng, n=100)
    write_tape(tmp_path / "tape", pos, species, alive,
               meta={"species_names": ["red", "blue"]})
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["species_names"] == ["red", "blue"]
    assert "header.meta" in doc["source"]["species_names_from"]


def test_alive_is_derived_when_the_tape_has_no_alive_channel(tmp_path):
    """A slot that stopped moving is dead from the frame after its last move."""
    n, frames = 6, 5
    rng = np.random.default_rng(3)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.9
    pos[:, :, 2] = 0.0
    pos[2:, 0] = pos[1, 0]        # slot 0 stops moving after frame 1
    pos[:, 1] = pos[0, 1]         # slot 1 never moves at all
    species = np.zeros((frames, n), np.uint8)
    path = tmp_path / "tape"
    write_tape(path, pos, species, np.ones((frames, n), np.uint8))
    # strip the alive channel from the header and rewrite the payload without it
    header = json.loads((path / "header.json").read_text())
    header["channels"] = [c for c in header["channels"] if c["name"] != "alive"]
    (path / "header.json").write_text(json.dumps(header))
    off = 0
    with open(path / "data.bin", "wb") as d, open(path / "frames.jsonl", "w") as i:
        for f in range(frames):
            blob = pos[f].astype(np.float32).tobytes() + species[f].tobytes()
            d.write(blob)
            i.write(json.dumps({"i": f, "step": f, "t": f * 0.5, "n": n,
                                "off": off, "len": len(blob)}) + "\n")
            off += len(blob)

    out = bundle_tape(path, "einstruct", "t", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["source"]["alive_source"].startswith("derived")
    alive = read_variant(out, "vr-high")["alive"]
    assert list(alive[:, 0]) == [1, 1, 0, 0, 0]      # last moved into frame 1
    assert list(alive[:, 1]) == [1, 1, 1, 1, 1]      # never moved: not killed
    assert (alive[:, 2:] == 1).all()


# ------------------------------------------------------------ the one reader


def test_the_bundle_names_the_tape_release_that_read_it(tape, tmp_path):
    """One reader, `orchard_tape`, and `source.tape_reader` says which release.

    There used to be two (spectre's module off `$SPECTRE_ROOT`, and a local
    re-implementation when spectre was absent) and a test that they agreed.
    The package removed the second, and with it the only reason the answer
    could depend on what else was on the disk.
    """
    import orchard_tape
    tape_dir, *_ = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["source"]["tape_reader"] == f"orchard-tape {orchard_tape.__version__}"
    assert not hasattr(bundle, "SPECTRE_ROOT")


# --------------------------------------------------------------- refusals


def test_an_roi_tape_is_refused(tmp_path):
    """A tape whose population changes has no fixed slot grid to bundle."""
    path = tmp_path / "tape"
    rng = np.random.default_rng(4)
    pos, species, alive = synthetic(rng, frames=2, n=10)
    write_tape(path, pos, species, alive)
    lines = (path / "frames.jsonl").read_text().splitlines()
    rec = json.loads(lines[1]); rec["n"] = 9; rec["len"] = 9 * 14
    (path / "frames.jsonl").write_text(lines[0] + "\n" + json.dumps(rec) + "\n")
    with pytest.raises(ValueError, match="changes between frames"):
        bundle_tape(path, "einstruct", "t", tmp_path / "b", verbose=False)


def test_a_torn_final_frame_is_dropped_not_fatal(tmp_path):
    path = tmp_path / "tape"
    rng = np.random.default_rng(5)
    pos, species, alive = synthetic(rng, frames=4, n=10)
    write_tape(path, pos, species, alive)
    with open(path / "frames.jsonl", "a") as f:
        f.write('{"i": 4, "step": 40, "t": 2.0, "n": 10, "of')   # killed mid-line
    out = bundle_tape(path, "einstruct", "t", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["source"]["tape_frames"] == 4
    assert doc["variants"]["vr-high"]["frames"] == 4


def test_a_bad_box_is_refused(tmp_path):
    path = tmp_path / "tape"
    rng = np.random.default_rng(6)
    pos, species, alive = synthetic(rng, frames=2, n=10)
    write_tape(path, pos, species, alive)
    (path / "header.json").write_text(json.dumps(
        {**json.loads((path / "header.json").read_text()), "box": [1.0, 2.0]}))
    with pytest.raises(ValueError, match="3 axes"):
        bundle_tape(path, "einstruct", "t", tmp_path / "b", verbose=False)


def test_no_staging_directory_is_left_behind(tmp_path, monkeypatch):
    """A half-written bundle must not survive as a `.bundle-*` in results/."""
    path = tmp_path / "tape"
    rng = np.random.default_rng(7)
    pos, species, alive = synthetic(rng, frames=2, n=10)
    write_tape(path, pos, species, alive)

    def boom(*a, **k):
        raise RuntimeError("poster failed")

    monkeypatch.setattr(bundle, "_poster", boom)
    with pytest.raises(RuntimeError, match="poster failed"):
        bundle_tape(path, "einstruct", "t", tmp_path / "b", verbose=False)
    assert list((tmp_path / "b").iterdir()) == []


def test_the_cli_defaults_match_the_module():
    from orchard import cli
    assert (cli.SLOT_BUDGET, cli.CHUNK_FRAMES) == (bundle.SLOT_BUDGET,
                                                   bundle.CHUNK_FRAMES)


# ------------------------------------------------------------------- video


ffmpeg_missing = pytest.mark.skipif(
    __import__("shutil").which("ffmpeg") is None, reason="ffmpeg is not installed")


def make_clip(path: Path, w: int, h: int, seconds: int = 13) -> Path:
    import subprocess
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"testsrc=size={w}x{h}:rate=30:duration={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


@ffmpeg_missing
def test_video_ladder_skips_rungs_it_would_have_to_upscale(tmp_path):
    from orchard.bundle import bundle_video
    clip = make_clip(tmp_path / "in.mp4", 854, 480)
    out = bundle_video(clip, "einstruct", "smoke", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["kind"] == "video"
    assert out.name == doc["id"]
    assert [r["name"] for r in doc["ladder"]] == ["360p"]
    assert [r["name"] for r in doc["skipped_rungs"]] == ["720p", "1080p"]
    assert all("never upscales" in r["reason"] for r in doc["skipped_rungs"])
    assert doc["width"] == 854 and doc["height"] == 480
    assert doc["duration_s"] == pytest.approx(13, abs=0.5)
    assert doc["poster"] == "poster.jpg" and (out / "poster.jpg").exists()
    assert doc["poster_at_s"] == pytest.approx(0.1 * doc["duration_s"])

    master = (out / "master.m3u8").read_text()
    assert master.startswith("#EXTM3U")
    assert "360p/index.m3u8" in master
    # 13 s at 6 s segments is 3 segments, and every declared one is on disk
    pl = (out / "360p/index.m3u8").read_text()
    assert "#EXT-X-PLAYLIST-TYPE:VOD" in pl and "#EXT-X-ENDLIST" in pl
    assert doc["ladder"][0]["keyint_frames"] == 180        # 6 s at 30 fps
    assert doc["ladder"][0]["segments"] == 3

    # every file the bundle ships is named, with its digest, in bundle.json
    # itself, so the id covers the encoder's bytes and not only the recipe
    from orchard.bundle import sha256_file
    files = doc["files"]
    assert set(files) == {str(p.relative_to(out)) for p in out.rglob("*")
                          if p.is_file() and p.name != "bundle.json"}
    for rel, m in files.items():
        assert sha256_file(out / rel) == m["sha256"]
        assert (out / rel).stat().st_size == m["bytes"]
    assert sum(1 for rel in files if rel.endswith(".ts")) == 3
    assert all(rel.split("/")[-1] in pl for rel in files if rel.endswith(".ts"))
    assert not (out / "media.json").exists() and "media" not in doc
    assert doc["source"]["file_sha256"]
    assert bundle.verify_bundle(out)["ok"]


@ffmpeg_missing
def test_a_video_id_follows_the_bytes_of_a_re_encode(tmp_path):
    """x264 under VBV is not bit-reproducible, so the address follows the bytes.

    Measured on the real 40 s 1080p clip: two runs of the same command gave
    22.08 MB and 22.07 MB of 1080p. WP1 kept one address for both by leaving
    the output out of the id, which let one id stand for two sets of bytes.
    Now the same bytes share an address and different bytes do not.
    """
    from orchard.bundle import bundle_video
    clip = make_clip(tmp_path / "in.mp4", 640, 480, seconds=7)
    out = tmp_path / "b"
    a = bundle_video(clip, "einstruct", "twice", out, verbose=False)
    b = bundle_video(clip, "einstruct", "twice", out, verbose=False)
    da = json.loads((a / "bundle.json").read_text())
    db = json.loads((b / "bundle.json").read_text())
    assert (a.name == b.name) == (da["files"] == db["files"])
    assert bundle.verify_bundle(a)["ok"] and bundle.verify_bundle(b)["ok"]
    assert da["source"]["file_sha256"] and da["ffmpeg"].startswith("ffmpeg")
    assert da["tools"] == {"ffmpeg": da["ffmpeg"]}, "the encoder that made the bytes"
    assert not list(out.glob(".bundle-*")), "a no-op finalize leaves no staging"


def _staged(root: Path, payload: bytes) -> tuple[dict, Path]:
    """A minimal still-shaped bundle in a staging directory, for `_finalize`."""
    from orchard.bundle import file_digests
    staging = root / f".bundle-{payload.hex()[:8]}"
    staging.mkdir(parents=True)
    (staging / "thumb.jpg").write_bytes(payload)
    doc = {"schema": "orchard/bundle/1", "kind": "still", "id": "", "tree": "t",
           "title": "t", "poster": "thumb.jpg", "files": file_digests(staging)}
    return doc, staging


def test_different_bytes_from_one_recipe_are_two_bundles(tmp_path):
    """A re-encode that differs is a new directory, never a silent replacement."""
    from orchard.bundle import _finalize
    out = tmp_path / "bundles"
    a = _finalize(*_staged(tmp_path / "s1", b"first encode"), out)
    b = _finalize(*_staged(tmp_path / "s2", b"second encode"), out)
    assert a != b and a.is_dir() and b.is_dir()
    assert (a / "thumb.jpg").read_bytes() == b"first encode"
    assert bundle.verify_bundle(a)["ok"] and bundle.verify_bundle(b)["ok"]


def test_finalize_onto_an_existing_id_is_a_no_op(tmp_path):
    from orchard.bundle import _finalize
    out = tmp_path / "bundles"
    a = _finalize(*_staged(tmp_path / "s1", b"same bytes"), out)
    mtime = (a / "thumb.jpg").stat().st_mtime_ns
    doc, staging = _staged(tmp_path / "s2", b"same bytes")
    b = _finalize(doc, staging, out)
    assert b == a and (a / "thumb.jpg").stat().st_mtime_ns == mtime
    assert not staging.exists(), "the redundant staging copy is removed"
    # ...unless the existing directory no longer matches its own bundle.json,
    # in which case the fresh copy, which does, replaces it
    (a / "thumb.jpg").write_bytes(b"same bytez")
    doc, staging = _staged(tmp_path / "s3", b"same bytes")
    assert _finalize(doc, staging, out) == a
    assert (a / "thumb.jpg").read_bytes() == b"same bytes"
    assert bundle.verify_bundle(a)["ok"]


def test_a_bundle_with_the_old_media_json_still_verifies(tmp_path):
    """Video and still bundles written before 2026-09-13 keep their ids."""
    from orchard.bundle import compute_id
    from orchard.push import expected_digests
    d = tmp_path / "staging"
    (d / "360p").mkdir(parents=True)
    (d / "360p/s0000.ts").write_bytes(b"segment")
    (d / "poster.jpg").write_bytes(b"poster")
    doc = {"schema": "orchard/bundle/1", "kind": "video", "id": "", "tree": "t",
           "title": "t", "master": "master.m3u8", "poster": "poster.jpg",
           "media": "media.json"}
    doc["id"] = compute_id(doc)
    (d / "bundle.json").write_text(json.dumps(doc, indent=1))
    (d / "media.json").write_text(json.dumps({"schema": "orchard/bundle-media/1", "files": [
        {"file": "360p/s0000.ts", "bytes": 7, "sha256": sha256_file(d / "360p/s0000.ts")},
        {"file": "poster.jpg", "bytes": 6, "sha256": sha256_file(d / "poster.jpg")}]}))
    old = d.rename(tmp_path / doc["id"])
    assert set(expected_digests(old)) == {"360p/s0000.ts", "poster.jpg"}
    assert bundle.verify_bundle(old)["ok"]
    (old / "poster.jpg").write_bytes(b"other")
    assert bundle.verify_bundle(old)["mismatched"] == ["poster.jpg"]


@ffmpeg_missing
def test_a_source_below_every_rung_is_encoded_at_its_own_height(tmp_path):
    from orchard.bundle import bundle_video
    clip = make_clip(tmp_path / "in.mp4", 320, 240, seconds=3)
    out = bundle_video(clip, "einstruct", "tiny", tmp_path / "b", verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert [r["name"] for r in doc["ladder"]] == ["240p"]
    assert len(doc["skipped_rungs"]) == 3


# -------------------------------------------------------------------- push


def test_content_types_are_the_ones_players_need():
    from orchard.push import content_type
    assert content_type("a/master.m3u8") == "application/vnd.apple.mpegurl"
    assert content_type("a/s0000.ts") == "video/mp2t"
    assert content_type("a/c0000.bin") == "application/octet-stream"
    assert content_type("bundle.json") == "application/json"
    assert content_type("poster.png") == "image/png"
    assert content_type("poster.jpg") == "image/jpeg"
    assert content_type("x.unknown") == "application/octet-stream"


def test_push_is_a_dry_run_without_a_token(tape, tmp_path):
    from orchard.push import push
    tape_dir, *_ = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    rep = push(out, dry_run=True, verbose=False)
    assert rep["dry_run"] and rep["id"] == out.name
    assert rep["uploaded"] == rep["files"] > 0
    assert rep["url"] == f"https://media.weichseltree.com/{out.name}/bundle.json"


def test_bundle_json_is_uploaded_last(tape, tmp_path):
    """It names every other file; it must never arrive before them."""
    from orchard.push import bundle_files
    tape_dir, *_ = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    keys = [k for k, _ in bundle_files(out)]
    assert keys[-1] == "bundle.json"
    assert "poster.png" in keys
    assert any(k.startswith("vr-high/c") for k in keys)


def test_push_refuses_a_directory_whose_name_is_not_its_id(tape, tmp_path):
    from orchard.push import push
    tape_dir, *_ = tape
    out = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "b", verbose=False)
    moved = out.parent / "not-the-id"
    out.rename(moved)
    with pytest.raises(ValueError, match="the directory name IS the address"):
        push(moved, dry_run=True, verbose=False)


def test_every_served_file_is_covered_by_the_id(tape, tmp_path):
    """Redraw the poster and the address must move."""
    tape_dir, *_ = tape
    a = bundle_tape(tape_dir, "einstruct", "t", tmp_path / "a", verbose=False)
    doc = json.loads((a / "bundle.json").read_text())
    from orchard.bundle import sha256_file
    assert doc["poster_sha256"] == sha256_file(a / "poster.png")
    named = {doc["poster_sha256"]}
    for v in doc["variants"].values():
        named |= {c["sha256"] for c in v["chunks"]}
    on_disk = {sha256_file(p) for p in a.rglob("*")
               if p.is_file() and p.name != "bundle.json"}
    assert on_disk <= named, "a file the bundle serves is not named by its id"

    before = compute_id(doc)
    doc["poster_sha256"] = "0" * 64
    assert compute_id(doc) != before


# ------------------------------------------------- the budget buys survivors


def test_alive_at_the_last_frame_is_kept_first(tmp_path):
    """F2: a uniform draw spends the budget on particles that are gone.

    Measured on ab_d2 before the fix: 4,000 uniformly chosen slots held 4,000
    live points at frame 0 and 56 at the last one. The ruling is survivors
    first, then a hash-ranked fill of the rest.
    """
    frames, n, budget = 4, 1000, 100
    rng = np.random.default_rng(21)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.9
    pos[:, :, 2] = 0.0
    species = np.zeros((frames, n), np.uint8)
    alive = np.ones((frames, n), np.uint8)
    survivors = np.array([3, 17, 42, 99, 250, 251, 700, 999])   # the known set
    dead = np.setdiff1d(np.arange(n), survivors)
    alive[-1, dead] = 0
    write_tape(tmp_path / "tape", pos, species, alive)

    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      slot_budget=budget, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    sel = doc["variants"]["vr-high"]["slot_selection"]
    assert sel["rule"] == "alive-last-then-blake2b"
    assert sel["alive_last"] == len(survivors)
    assert sel["filled"] == budget - len(survivors)
    assert sel["seed"] == f"orchard/bundle/1|slots|{n}|{budget}"

    keep, _ = slot_indices(n, 10, alive[-1])
    assert set(survivors) <= set(keep.tolist()), "a survivor was dropped"
    assert keep.size == budget

    # and the room is not empty at the end: every survivor is in the variant
    got = read_variant(out, "vr-high")
    assert got["alive"][-1].sum() == len(survivors)
    assert doc["variants"]["vr-high"]["alive"]["last"] == len(survivors)
    assert doc["variants"]["vr-high"]["alive"]["first"] == budget


def test_more_survivors_than_the_budget_are_ranked_down_to_it(tmp_path):
    frames, n = 3, 1000
    rng = np.random.default_rng(22)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.9
    pos[:, :, 2] = 0.0
    alive = np.ones((frames, n), np.uint8)          # everything survives
    write_tape(tmp_path / "tape", pos, np.zeros((frames, n), np.uint8), alive)
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      slot_budget=50, verbose=False)
    sel = json.loads((out / "bundle.json").read_text())["variants"]["vr-high"]["slot_selection"]
    assert (sel["alive_last"], sel["filled"]) == (50, 0)


def test_slot_selection_describes_the_slots_each_variant_holds(tmp_path):
    """F3: phone is vr-high strided, NOT the base rule re-run at 2x stride."""
    # 6,000 slots against a 3,000 budget: the base stride is 2 (so the alive
    # rule really runs) and the base variant still holds more than 2,000
    # slots (so the phone strides again). Both conditions are needed for the
    # two records to be able to disagree at all.
    frames, n = 3, 6000
    rng = np.random.default_rng(23)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.9
    pos[:, :, 2] = 0.0
    alive = np.ones((frames, n), np.uint8)
    alive[-1, 500:] = 0
    write_tape(tmp_path / "tape", pos, np.zeros((frames, n), np.uint8), alive)
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      slot_budget=3000, verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["variants"]["vr-high"]["slot_stride"] == 2
    assert doc["variants"]["phone"]["slot_stride"] == 4

    base = doc["variants"]["vr-high"]["slot_selection"]
    assert base["rule"] == "alive-last-then-blake2b"
    assert (base["alive_last"], base["filled"]) == (500, 2500)

    quest = doc["variants"]["vr-quest"]["slot_selection"]
    phone = doc["variants"]["phone"]["slot_selection"]
    assert quest == {"rule": "the same slots as vr-high", "from": "vr-high",
                     "take_every": 1}
    assert phone["from"] == "vr-high" and phone["take_every"] == 2
    assert "every 2th slot of vr-high" in phone["rule"]
    assert phone != base, "the base rule is false for a derived variant"

    # and the claim is the truth: phone holds vr-high's slots, strided
    high, ph = read_variant(out, "vr-high"), read_variant(out, "phone")
    assert (ph["pos"] == high["pos"][::2, ::2]).all()
    # the record phone used to carry — the base rule at phone's own stride —
    # names a DIFFERENT set of particles, which is why copying it was a bug
    kept, _ = slot_indices(n, 2, alive[-1])
    rerun, _ = slot_indices(n, 4, alive[-1])
    assert not np.array_equal(rerun, kept[::2])


# ------------------------------------------------------- quantization edges


def test_quantization_boundaries_are_clipped_and_counted(tmp_path):
    frames, n = 2, 6
    L = np.array(BOX)
    pos = np.zeros((frames, n, 3))
    pos[:, 0] = [0.0, 0.0, 0.0]                       # -> 0
    pos[:, 1] = L / 2                                  # -> 32768
    pos[:, 2] = L - 1e-9                               # -> 65535
    pos[:, 3] = L                                      # at L: clipped to 65535
    pos[:, 4] = L * 1.0001                             # outside: clipped
    pos[:, 5] = [-0.001, -0.001, -0.001]               # outside: clipped
    write_tape(tmp_path / "tape", pos, np.zeros((frames, n), np.uint8),
               np.ones((frames, n), np.uint8))
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    q = read_variant(out, "vr-high")["pos"][0]
    assert q[0].tolist() == [0, 0, 0]
    assert q[1].tolist() == [32768, 32768, 32768]
    assert q[2].tolist() == [65535, 65535, 65535]
    assert q[3].tolist() == [65535, 65535, 65535]
    assert q[4].tolist() == [65535, 65535, 65535]
    assert q[5].tolist() == [0, 0, 0]
    # two slots per frame are outside the box, over two frames, three axes
    assert doc["source"]["clamped_positions"] == 2 * 2 * 3


def test_a_3d_tape_keeps_z(tmp_path):
    frames, n = 2, 50
    box = [10.0, 20.0, 40.0]
    rng = np.random.default_rng(31)
    pos = rng.random((frames, n, 3)) * np.array(box) * 0.9
    write_tape(tmp_path / "tape", pos, np.zeros((frames, n), np.uint8),
               np.ones((frames, n), np.uint8), box=box,
               periodic=(True, True, True))
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["box"] == box and doc["periodic"] == [True, True, True]
    q = read_variant(out, "vr-high")["pos"]
    assert q[:, :, 2].max() > 0, "a 3D tape must not be flattened"
    back = q.astype(np.float64) / 65535.0 * np.array(box)
    assert np.abs(back - pos).max() <= (np.array(box) / 65535.0).max()


def test_a_zero_length_axis_is_coerced_to_one(tmp_path):
    """F10: Lz = 1 is einstruct's habit, not the format's promise."""
    frames, n = 2, 20
    box = [10.0, 20.0, 0.0]
    rng = np.random.default_rng(32)
    pos = rng.random((frames, n, 3)) * np.array([10.0, 20.0, 0.0]) * 0.9
    write_tape(tmp_path / "tape", pos, np.zeros((frames, n), np.uint8),
               np.ones((frames, n), np.uint8), box=box)
    out = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                      verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["box"] == [10.0, 20.0, 1.0]
    assert doc["source"]["box_raw"] == box
    assert (read_variant(out, "vr-high")["pos"][:, :, 2] == 0).all()


# -------------------------------------------------------- the uint16 branch


def test_a_uint16_tape_round_trips_through_the_reader(tmp_path):
    """The quantized-position branch of the reader, which nothing else runs."""
    frames, n = 3, 400
    rng = np.random.default_rng(41)
    pos = rng.random((frames, n, 3)) * np.array(BOX) * 0.99
    pos[:, :, 2] = 0.0
    species = np.tile((np.arange(n) % 2).astype(np.uint8), (frames, 1))
    alive = np.ones((frames, n), np.uint8)
    write_tape(tmp_path / "tape", pos, species, alive, quantize="uint16")

    a = bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "a",
                    verbose=False)
    da = json.loads((a / "bundle.json").read_text())
    assert da["source"]["tape_quantize"] == "uint16"
    got = read_variant(a, "vr-high")
    L = np.array(BOX)
    back = got["pos"].astype(np.float64) / 65535.0 * L
    assert np.abs(back - pos).max() <= 2 * (L / 65535.0).max()
    assert (got["species"] == species).all()


# ------------------------------------------------------- video with audio


@ffmpeg_missing
def test_a_clip_with_an_audio_track_bundles(tmp_path):
    """F1: `name=` in var_stream_map exits 234 on any clip that has audio."""
    import subprocess
    clip = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=854x480:rate=30:duration=8",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-shortest", str(clip)], check=True)

    from orchard.bundle import bundle_video
    out = bundle_video(clip, "einstruct", "with sound", tmp_path / "b",
                       verbose=False)
    doc = json.loads((out / "bundle.json").read_text())
    assert doc["has_audio"] is True
    assert [r["name"] for r in doc["ladder"]] == ["360p"]
    master = (out / "master.m3u8").read_text()
    assert "360p/index.m3u8" in master
    assert list((out / "360p").glob("s*.ts")), "no segments were written"
    # the audio really is in the segments
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0",
         str(sorted((out / "360p").glob("s*.ts"))[0])],
        capture_output=True, text=True, check=True)
    assert "aac" in probe.stdout


# --------------------------------------------------------------- push, faked


class FakeCF:
    """Enough of `CF` for `push`, with a bucket in a dict.

    `keeps_headers=False` is R2 as every push before 2026-09-13 left it: the
    bytes and the type stored, no Cache-Control.
    """

    def __init__(self, objects=None, fail_get=None, keeps_headers=True):
        self.objects = dict(objects or {})
        self.meta = {k: {"contentType": "application/octet-stream"} for k in self.objects}
        self.puts, self.gets, self.heads, self.deletes = [], [], [], []
        self.cache = {}
        self.fail_get = fail_get
        self.keeps_headers = keeps_headers
        self.closed = False

    def get_object(self, key, bucket="b"):
        self.gets.append(key)
        if self.fail_get is not None:
            raise self.fail_get
        return self.objects.get(key)

    def put_object(self, key, data, ctype, bucket="b", cache_control=None):
        self.puts.append((key, ctype, len(data)))
        self.cache[key] = cache_control
        self.objects[key] = data
        self.meta[key] = {"contentType": ctype,
                          **({"cacheControl": cache_control}
                             if cache_control and self.keeps_headers else {})}

    def list_objects(self, prefix="", bucket="b", delimiter=None, per_page=1000):
        import hashlib
        keys = sorted(k for k in self.objects if k.startswith(prefix))
        objs = [{"key": k, "size": len(self.objects[k]),
                 "etag": hashlib.md5(self.objects[k]).hexdigest(),
                 "last_modified": "2026-09-12T14:28:15.170Z",
                 "http_metadata": dict(self.meta.get(k, {}))} for k in keys]
        if delimiter:
            tops = sorted({k[len(prefix):].split(delimiter)[0] + delimiter
                           for k in keys if delimiter in k[len(prefix):]})
            return [o for o in objs if delimiter not in o["key"][len(prefix):]], \
                [prefix + t for t in tops]
        return objs, []

    def delete_object(self, key, bucket="b"):
        self.deletes.append(key)
        self.objects.pop(key, None)
        self.meta.pop(key, None)

    def head_object(self, key, bucket="b"):
        self.heads.append(key)
        d = self.objects.get(key)
        return None if d is None else {"Content-Length": str(len(d))}

    def close(self):
        self.closed = True


@pytest.fixture
def small_bundle(tmp_path):
    rng = np.random.default_rng(51)
    pos, species, alive = synthetic(rng, frames=2, n=40)
    write_tape(tmp_path / "tape", pos, species, alive)
    return bundle_tape(tmp_path / "tape", "einstruct", "t", tmp_path / "b",
                       verbose=False)


def test_push_uploads_every_file_with_the_right_content_type(small_bundle):
    from orchard.push import INDEX_KEY, push
    cf = FakeCF()
    rep = push(small_bundle, bucket="b", cf=cf, verbose=False)
    bid = small_bundle.name
    keys = [k for k, _c, _n in cf.puts]
    assert keys[-1] == f"{bid}/{INDEX_KEY}"
    assert keys[-2] == f"{bid}/bundle.json", "bundle.json must land last"
    assert all(k.startswith(bid + "/") for k in keys)
    types = {k.rsplit(".", 1)[-1]: c for k, c, _ in cf.puts}
    assert types["bin"] == "application/octet-stream"
    assert types["png"] == "image/png"
    assert types["json"] == "application/json"
    assert rep["uploaded"] == rep["files"] and rep["skipped"] == 0
    assert rep["unverified"] == [] and rep["verified"] == rep["uploaded"]


def test_push_skips_what_is_already_there_and_force_ignores_the_index(small_bundle):
    from orchard.push import push
    cf = FakeCF()
    push(small_bundle, bucket="b", cf=cf, verbose=False)
    first = len(cf.puts)

    cf.puts.clear()
    rep = push(small_bundle, bucket="b", cf=cf, verbose=False)
    assert rep["uploaded"] == 0 and rep["skipped"] == rep["files"]
    assert len(cf.puts) == 1, "only the index should be rewritten"

    cf.puts.clear()
    rep = push(small_bundle, bucket="b", cf=cf, force=True, verbose=False)
    assert rep["uploaded"] == rep["files"]
    assert len(cf.puts) == first


def test_push_refuses_a_bundle_that_does_not_match_its_manifest(small_bundle):
    """F5: a chunk truncated after bundling used to upload happily."""
    from orchard.push import push, verify_local
    chunk = next(small_bundle.glob("vr-high/c*.bin"))
    chunk.write_bytes(chunk.read_bytes()[:-8])
    assert verify_local(small_bundle)["mismatched"] == [
        chunk.relative_to(small_bundle).as_posix()]
    cf = FakeCF()
    with pytest.raises(ValueError, match="does not match its own manifest"):
        push(small_bundle, bucket="b", cf=cf, verbose=False)
    assert cf.puts == [], "nothing may be uploaded from a bundle that lies"


def test_push_notices_bytes_that_did_not_survive_the_upload(small_bundle):
    from orchard.push import push

    class Corrupting(FakeCF):
        def put_object(self, key, data, ctype, bucket="b", cache_control=None):
            super().put_object(key, data[:-1] if key.endswith(".bin") else data,
                               ctype, bucket, cache_control)

    with pytest.raises(ValueError, match="did not survive the upload"):
        push(small_bundle, bucket="b", cf=Corrupting(), verbose=False)


def test_push_surfaces_r2_being_off(small_bundle):
    from orchard.push import R2NotEnabled, R2_OFF, push
    cf = FakeCF(fail_get=R2NotEnabled(R2_OFF))
    with pytest.raises(R2NotEnabled, match="Purchase R2"):
        push(small_bundle, bucket="b", cf=cf, verbose=False)


def test_expected_digests_covers_the_files_the_bundle_serves(small_bundle):
    from orchard.push import bundle_files, expected_digests
    want = expected_digests(small_bundle)
    served = {k for k, _ in bundle_files(small_bundle)} - {"bundle.json"}
    assert served == set(want)
    for rel, digest in want.items():
        assert sha256_file(small_bundle / rel) == digest


# ----------------------------------------------------------- Cache-Control


def test_every_object_is_cached_forever_except_the_push_index(small_bundle):
    from orchard.push import CACHE_IMMUTABLE, INDEX_KEY, push
    cf = FakeCF()
    push(small_bundle, bucket="b", cf=cf, verbose=False)
    bid = small_bundle.name
    assert cf.cache.pop(f"{bid}/{INDEX_KEY}") == "no-cache"
    assert cf.cache and set(cf.cache.values()) == {CACHE_IMMUTABLE}
    assert CACHE_IMMUTABLE == "public, max-age=31536000, immutable"
    index = json.loads(cf.objects[f"{bid}/{INDEX_KEY}"])["files"]
    assert {f["cache_control"] for f in index.values()} == {CACHE_IMMUTABLE}


def test_put_object_sends_the_header_the_rest_api_maps_to_http_metadata(monkeypatch):
    """The same header `wrangler r2 object put --cache-control` sends to this path."""
    cf, conn = _wired(monkeypatch, [_Resp(200), _Resp(200)])
    sent = []
    conn.request = lambda m, p, body=None, headers=None: sent.append((m, p, headers))
    cf.put_object("abc/x.bin", b"123", "application/octet-stream", bucket="b",
                  cache_control="public, max-age=31536000, immutable")
    cf.put_object("abc/y.bin", b"1", "application/octet-stream", bucket="b")
    (m, p, h), (_m, _p, h2) = sent
    assert m == "PUT" and p.endswith("/r2/buckets/b/objects/abc/x.bin")
    assert h["Cache-Control"] == "public, max-age=31536000, immutable"
    assert "Cache-Control" not in h2


def test_the_wrangler_path_passes_cache_control(tmp_path, monkeypatch):
    from orchard import push as pushmod
    ran = []
    monkeypatch.setattr(pushmod, "require", lambda name: "x")
    # Command construction must not depend on a local frontend installation.
    monkeypatch.setattr(pushmod, "wrangler", lambda: "mock-wrangler")
    monkeypatch.setattr(pushmod.subprocess, "run",
                        lambda cmd, **kw: ran.append(cmd) or type("R", (), {"returncode": 0})())
    f = tmp_path / "c.bin"; f.write_bytes(b"1")
    pushmod._wrangler_put("id/c.bin", f, "application/octet-stream", "b",
                          pushmod.CACHE_IMMUTABLE)
    assert ran[0][0] == "mock-wrangler"
    assert ran[0][-2:] == ["--cache-control", pushmod.CACHE_IMMUTABLE]


def test_a_plain_push_of_an_old_bundle_does_not_rewrite_its_objects(small_bundle):
    """Re-putting published objects is `--refresh-headers`' decision, not push's."""
    from orchard.push import INDEX_KEY, push
    cf = FakeCF(keeps_headers=False)
    push(small_bundle, bucket="b", cf=cf, verbose=False)
    bid = small_bundle.name
    index = json.loads(cf.objects[f"{bid}/{INDEX_KEY}"])
    for f in index["files"].values():
        f.pop("cache_control")                       # an index from before
    cf.objects[f"{bid}/{INDEX_KEY}"] = json.dumps(index).encode()
    cf.puts.clear()
    rep = push(small_bundle, bucket="b", cf=cf, verbose=False)
    assert rep["uploaded"] == 0 and len(cf.puts) == 1
    index = json.loads(cf.objects[f"{bid}/{INDEX_KEY}"])["files"]
    assert {f["cache_control"] for f in index.values()} == {None}, \
        "the index must not claim a header the object does not have"


def test_refresh_headers_re_puts_the_objects_without_it_and_nothing_else(small_bundle):
    from orchard.push import CACHE_IMMUTABLE, INDEX_KEY, push, refresh_headers
    cf = FakeCF(keeps_headers=False)                 # pushed before 2026-09-13
    push(small_bundle, bucket="b", cf=cf, verbose=False)
    cf.keeps_headers = True
    bid, n = small_bundle.name, len(list(small_bundle.rglob("*.*")))
    before = {k: v for k, v in cf.objects.items() if k != f"{bid}/{INDEX_KEY}"}

    cf.puts.clear()
    rep = refresh_headers(small_bundle, bucket="b", cf=cf, dry_run=True, verbose=False)
    assert rep["refreshed"] == n and cf.puts == [], "a dry run puts nothing"

    rep = refresh_headers(small_bundle, bucket="b", cf=cf, verbose=False)
    assert rep["refreshed"] == n and rep["still_wrong"] == []
    keys = [k for k, _c, _n in cf.puts]
    assert keys[-2:] == [f"{bid}/bundle.json", f"{bid}/{INDEX_KEY}"]
    assert {k: v for k, v in cf.objects.items() if k != f"{bid}/{INDEX_KEY}"} == before, \
        "only metadata changes"
    objs, _ = cf.list_objects(prefix=f"{bid}/")
    assert {o["http_metadata"]["cacheControl"] for o in objs
            if not o["key"].endswith(INDEX_KEY)} == {CACHE_IMMUTABLE}
    index = json.loads(cf.objects[f"{bid}/{INDEX_KEY}"])["files"]
    assert {f["cache_control"] for f in index.values()} == {CACHE_IMMUTABLE}

    cf.puts.clear()
    rep = refresh_headers(small_bundle, bucket="b", cf=cf, verbose=False)
    assert rep["refreshed"] == 0 and rep["current"] == n
    assert [k for k, _c, _n in cf.puts] == [f"{bid}/{INDEX_KEY}"]


def test_refresh_headers_refuses_to_change_bytes_under_a_published_address(small_bundle):
    from orchard.push import push, refresh_headers
    cf = FakeCF(keeps_headers=False)
    push(small_bundle, bucket="b", cf=cf, verbose=False)
    bid = small_bundle.name
    chunk = next(k for k in cf.objects if k.endswith(".bin"))
    old = cf.objects[chunk]
    cf.objects[chunk] = old[:-1] + bytes([old[-1] ^ 0xFF])    # an older encode
    cf.puts.clear()
    with pytest.raises(ValueError, match="push --force"):
        refresh_headers(small_bundle, bucket="b", cf=cf, verbose=False)
    assert cf.puts == []
    with pytest.raises(ValueError, match="never pushed"):
        refresh_headers(small_bundle, bucket="b", cf=FakeCF(), verbose=False)
    assert bid


# ------------------------------------------------------------ retry policy


class _Resp:
    def __init__(self, status, body=b'{"success":true,"result":{}}', headers=None):
        self.status, self._body = status, body
        self.headers = headers or {}
        self.will_close = False

    def read(self):
        return self._body


class _Conn:
    def __init__(self, script):
        self.script, self.calls = list(script), []

    def request(self, method, path, body=None, headers=None):
        self.calls.append(method)

    def getresponse(self):
        return self.script.pop(0)

    def close(self):
        pass


def _wired(monkeypatch, script):
    from orchard.push import CF
    cf = CF(token="not-a-real-token", account="acct")
    conn = _Conn(script)
    monkeypatch.setattr(cf, "_connect", lambda: setattr(cf, "_conn", conn) or conn)
    return cf, conn


def test_an_idempotent_request_retries_429_and_5xx(monkeypatch):
    cf, conn = _wired(monkeypatch, [_Resp(429, headers={"Retry-After": "0"}),
                                    _Resp(503, headers={"Retry-After": "0"}),
                                    _Resp(200)])
    status, _body, _h = cf.raw("GET", "/x")
    assert status == 200
    assert conn.calls == ["GET", "GET", "GET"]


def test_a_post_is_never_retried(monkeypatch):
    """F6: `POST /r2/buckets` creates a bucket; a lost reply is not a lost one."""
    cf, conn = _wired(monkeypatch, [_Resp(503, headers={"Retry-After": "0"}),
                                    _Resp(200)])
    status, _body, _h = cf.raw("POST", "/x", b"{}")
    assert status == 503
    assert conn.calls == ["POST"]


def test_retries_give_up_and_return_the_last_status(monkeypatch):
    cf, conn = _wired(monkeypatch, [_Resp(500, headers={"Retry-After": "0"})] * 3)
    status, _b, _h = cf.raw("GET", "/x")
    assert status == 500 and conn.calls == ["GET"] * 3


def test_backoff_prefers_retry_after():
    from orchard.push import RETRY_MAX_SLEEP, _backoff
    assert _backoff(0, "2") == 2.0
    assert _backoff(0, None) == 0.5
    assert _backoff(3, None) == 4.0
    assert _backoff(0, "99999") == RETRY_MAX_SLEEP
    assert _backoff(0, "soon") == 0.5          # a date form, not seconds


def test_the_cors_fallback_only_fires_on_an_origin_error(monkeypatch):
    """F7: an auth failure used to resurface as a wildcard problem."""
    from orchard import push as pushmod
    calls = []

    class Boom(pushmod.CF):
        def __init__(self):
            self.account = "acct"
            self._token = "x"

        def api(self, method, path, payload=None, ok=(200, 201)):
            calls.append((method, path))
            if path.endswith("/cors"):
                raise pushmod.CloudflareError(
                    403, path, [{"code": 10000, "message": "Authentication error"}])
            return {} if method == "GET" else None

        def close(self):
            pass

    with pytest.raises(pushmod.CloudflareError, match="Authentication error"):
        pushmod.ensure_bucket("b", cf=Boom(), verbose=False)
    assert sum(1 for m, p in calls if p.endswith("/cors")) == 1


def test_a_large_object_is_read_back_when_the_api_refuses_head(tmp_path):
    """R2's REST API answered 405 to every HEAD on 2026-09-12; that is not 'missing'."""
    from orchard.push import _verify_uploaded
    data = bytes(range(256)) * 8192                      # 2 MB, over a 1 MB inline cap
    f = tmp_path / "c0000.bin"; f.write_bytes(data)
    digest = __import__("hashlib").sha256(data).hexdigest()

    class NoHead(FakeCF):
        def head_object(self, key, bucket="b"):
            self.heads.append(key)
            return {"unsupported": True}

    cf = NoHead({"bid/c0000.bin": data})
    assert _verify_uploaded(cf, "bid", "c0000.bin", f, digest, "b", inline_max=1 << 20) == "ok"
    assert cf.heads == ["bid/c0000.bin"] and cf.gets == ["bid/c0000.bin"]
    cf = NoHead({"bid/c0000.bin": data[:-1]})
    assert _verify_uploaded(cf, "bid", "c0000.bin", f, digest, "b", inline_max=1 << 20).startswith("length")
    cf = NoHead({})
    assert _verify_uploaded(cf, "bid", "c0000.bin", f, digest, "b", inline_max=1 << 20) == "missing after upload"
    # And by default nothing a bundle ships reaches the HEAD path at all.
    cf = NoHead({"bid/c0000.bin": data})
    assert _verify_uploaded(cf, "bid", "c0000.bin", f, digest, "b") == "ok" and cf.heads == []


def test_tapes_with_the_same_slot_count_and_survivors_bundle_the_same_particles():
    """spectre's trio: three worlds, one number apart, must show the same
    particle identities so the visitor compares like with like. The seed is
    a function of the slot counts alone and the alive-first rule of the final
    frame, so identical survivor sets give identical slots. A guarantee, not
    an accident."""
    from orchard.bundle import slot_indices
    alive = np.ones(508_744, dtype=np.uint8)
    a, sel_a = slot_indices(508_744, 128, alive_last=alive)
    b, sel_b = slot_indices(508_744, 128, alive_last=alive.copy())
    assert np.array_equal(a, b) and sel_a == sel_b
    # A tape in which one CHOSEN particle has died keeps every other choice:
    # the alive-first rule drops that slot and only that slot.
    alive2 = alive.copy(); alive2[a[0]] = 0
    c, _ = slot_indices(508_744, 128, alive_last=alive2)
    assert a[0] not in c and np.array_equal(np.setdiff1d(a, c), np.array([a[0]]))
