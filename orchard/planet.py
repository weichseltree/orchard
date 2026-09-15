"""The planet bundle: spectre's quarter-cutaway worlds as one walk-around exhibit.

    uv run orchard bundle planet <delivery> --tree spectre --title "..." \
        [--atlas beauty=<video bundle id> ...]

A delivery is a completed bake directory of spectre's `lanes.m04_planet.exhibit`
(`manifest.json` schema `m04/planet-exhibit/3`): a glTF with three nodes whose
vertices carry a placement recipe, a surface stream of per-frame vertex radii
in one file per second of video, and four atlas videos that are the meshes'
texture. The videos travel as ordinary video bundles (spectre runs
`orchard bundle video` on each); this bundle ships the mesh, the stream, the
legends and a poster, and names the atlas bundles by id so the client needs
one address for the whole exhibit.

The client contract (grove/src/world/planet-exhibit.ts) reads `surface` as the
stream's format description and `worlds` as the atlas column order; every file
the bundle serves is in `files` so the id covers the bytes, as for a video.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from . import RESULTS
from .bundle import SCHEMA, _finalize, _git_describe, _rel_to_tree, _tree_root, _ensure, \
    file_digests, sha256_file

MANIFEST_SCHEMA = "m04/planet-exhibit/3"
STREAM_FORMAT = "m04/planet-surface-stream/1"
MODES = ("beauty", "species", "temperature", "pressure")
#: Where the removed quarter sits in the glTF's node axes (+X, -Z), as a unit
#: vector along its bisector; the client turns it toward the visitor.
CUT_BISECTOR = [0.7071067811865476, 0.0, -0.7071067811865476]


def read_manifest(delivery: Path) -> dict:
    manifest = json.loads((delivery / "manifest.json").read_text())
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"{delivery}/manifest.json is {manifest.get('schema')!r}; "
                         f"this bundler reads {MANIFEST_SCHEMA}")
    stream = manifest.get("surface_stream") or {}
    if stream.get("format") != STREAM_FORMAT:
        raise ValueError(f"surface stream is {stream.get('format')!r}, not {STREAM_FORMAT}")
    frames = manifest["frames"]
    if stream["frames"] != frames or len(manifest["per_frame"]) != frames:
        raise ValueError("the manifest's frame counts disagree")
    return manifest


def stream_segments(manifest: dict, delivery: Path) -> list[dict]:
    """The segment table, checked against the bytes on disk before anything is copied."""
    stream = manifest["surface_stream"]
    segments, next_frame, total = [], 0, 0
    for seg in stream["segments"]:
        path = delivery / seg["file"]
        if not path.is_file():
            raise FileNotFoundError(path)
        if seg["first_frame"] != next_frame:
            raise ValueError(f"{seg['file']} starts at frame {seg['first_frame']}, expected {next_frame}")
        if path.stat().st_size != seg["bytes"] or sha256_file(path) != seg["sha256"]:
            raise ValueError(f"{seg['file']} does not match the manifest's bytes or SHA-256")
        segments.append({"file": seg["file"], "first_frame": seg["first_frame"],
                         "frames": seg["frames"], "bytes": seg["bytes"], "sha256": seg["sha256"]})
        next_frame += seg["frames"]
        total += seg["bytes"]
    if next_frame != manifest["frames"] or total != stream["bytes"]:
        raise ValueError(f"segments cover {next_frame} frames and {total} bytes; the manifest says "
                         f"{manifest['frames']} and {stream['bytes']}")
    return segments


def world_table(manifest: dict) -> list[dict]:
    """Worlds in atlas-column order, with the glTF node that draws each."""
    columns = manifest["atlas"]["columns"]
    worlds = sorted(manifest["worlds"], key=lambda w: columns[w])
    if [columns[w] for w in worlds] != list(range(len(worlds))):
        raise ValueError(f"atlas columns are not 0..n-1: {columns}")
    if manifest["surface_stream"]["worlds"] != worlds:
        raise ValueError("the surface stream's world order disagrees with the atlas columns")
    return [{"world": w, "chi": manifest["worlds"][w]["chi"], "column": columns[w],
             "node": f"planet_chi{manifest['worlds'][w]['chi']}",
             "R_s_sigma": manifest["per_frame"][0]["R_s"][w],
             "t_dyn_tau": manifest["worlds"][w].get("t_dyn_tau")}
            for w in worlds]


def bundle_planet(delivery, tree: str, title: str, out_root=None, *,
                  atlases: dict[str, str] | None = None, poster_frame: int | None = None,
                  verbose: bool = True, commit: str | None = None) -> Path:
    """Write `<out_root>/<id>/`: mesh, stream, legends, poster, bundle.json."""
    delivery = Path(delivery).resolve()
    out_root = Path(out_root) if out_root else RESULTS / "bundles"
    t0 = time.perf_counter()
    manifest = read_manifest(delivery)
    segments = stream_segments(manifest, delivery)
    worlds = world_table(manifest)
    atlases = dict(atlases or {})
    if not atlases:
        # spectre's own HLS delivery beside the bake names the video bundles.
        index = delivery / "hls" / "index.json"
        if index.is_file():
            for mode, row in (json.loads(index.read_text()).get("videos") or {}).items():
                if mode in MODES and row.get("bundle_id"):
                    atlases[mode] = row["bundle_id"]
    unknown = sorted(set(atlases) - set(MODES))
    if unknown:
        raise ValueError(f"unknown atlas modes {unknown}; the modes are {MODES}")
    if "beauty" not in atlases:
        raise ValueError("the beauty atlas is the one the client shows first; name its video bundle "
                         "(--atlas beauty=<id>, or the delivery's hls/index.json)")
    mesh = delivery / manifest["mesh"]
    if not mesh.is_file():
        raise FileNotFoundError(mesh)

    staging = Path(tempfile.mkdtemp(prefix=".bundle-", dir=str(_ensure(out_root))))
    try:
        shutil.copy2(mesh, staging / "planet_cutaway.glb")
        (staging / "surface").mkdir()
        for seg in segments:
            shutil.copy2(delivery / seg["file"], staging / seg["file"])
        legends = {}
        for mode in atlases:
            legend = delivery / manifest["legends"][mode]
            legends[mode] = f"legend_{mode}.png"
            shutil.copy2(legend, staging / legends[mode])
        # The poster is the hero still of a settled moment (frame 94 is about
        # eight dynamical times after relaxation), as JPEG at most 1280 wide.
        stills = delivery / "stills"
        frame = poster_frame if poster_frame is not None else 94
        hero = stills / f"hero_f{frame:04d}.png"
        if not hero.is_file():
            hero = next(iter(sorted(stills.glob("hero_f*.png"))), None)
            frame = int(hero.stem.split("_f")[1]) if hero else -1
        if hero is None:
            raise FileNotFoundError(f"{stills}/hero_f*.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(hero),
                        "-frames:v", "1", "-q:v", "3", "-vf", "scale='min(1280,iw)':-2",
                        str(staging / "poster.jpg")], check=True)
        files = file_digests(staging)

        stream = manifest["surface_stream"]
        rel = _rel_to_tree(delivery, tree)
        doc = {
            "schema": SCHEMA,
            "kind": "planet",
            "id": "",
            "tree": tree,
            "title": title,
            "produced_by": (f"uv run orchard bundle planet {rel} --tree {tree} "
                            f"--title {json.dumps(title)}"
                            + "".join(f" --atlas {m}={i}" for m, i in sorted(atlases.items()))),
            "source": {
                "delivery": rel,
                "exhibit_schema": manifest["schema"],
                "manifest_sha256": sha256_file(delivery / "manifest.json"),
                "render_commit": manifest.get("git"),
                "bake": manifest.get("produced_by"),
                "tree_commit": commit or _git_describe(_tree_root(tree) or delivery),
                "tapes": {w["world"]: manifest["worlds"][w["world"]].get("tape") for w in worlds},
            },
            "what": manifest.get("what", ""),
            "mesh": "planet_cutaway.glb",
            "poster": "poster.jpg",
            "poster_frame": frame,
            "fps": manifest["fps"],
            "frames": manifest["frames"],
            "seconds": manifest["seconds"],
            "time": manifest.get("time", ""),
            "R_REF_sigma": manifest["R_REF_sigma"],
            "worlds": worlds,
            "cut": {"removed_quarter": "node-space +X, -Z", "bisector": CUT_BISECTOR,
                    "up": "glTF +Y is the simulation's +z; the bodies do not rotate"},
            "atlas": {"size": manifest["atlas"]["size"], "columns": manifest["atlas"]["columns"],
                      "tiles": manifest["atlas"]["tiles"]},
            "atlases": {mode: {"bundle": bid, "legend": legends[mode],
                               "description": manifest["modes"].get(mode, "")}
                        for mode, bid in sorted(atlases.items())},
            "surface": {
                "format": stream["format"],
                "frames": stream["frames"],
                "bytes": stream["bytes"],
                "worlds": stream["worlds"],
                "vertices_per_world": stream["vertices_per_world"],
                "grid": stream["grid"],
                "header": stream["header"],
                "decode": stream["decode"],
                "place": stream["place"],
                "quantisation_sigma": stream["quantisation_sigma"],
                "zero_code": stream["zero_code"],
                "range_sigma": stream["range_sigma"],
                "segment_frames": stream["segment_frames"],
                "segments": segments,
            },
            "lights": manifest.get("lights"),
            "domains": manifest.get("domains"),
            "honesty": manifest.get("honesty", []),
            "surface_summary": {w["world"]: manifest["worlds"][w["world"]].get("surface_summary")
                                for w in worlds},
            "hydrostatic": {w["world"]: manifest["worlds"][w["world"]].get("hydrostatic_diagnostic")
                            for w in worlds},
            "files": files,
        }
        dest = _finalize(doc, staging, out_root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if verbose:
        total = sum(f["bytes"] for f in files.values())
        print(f"bundle {dest.name}  {total / 1e6:.1f} MB in {len(files)} files, "
              f"{len(segments)} stream segments, atlases {sorted(atlases)}  "
              f"{time.perf_counter() - t0:.1f}s", flush=True)
    return dest
