#!/usr/bin/env python3
"""Compress the hall's baked lightmap to KTX2 and record it, without a rebake.

    exp run orchard-compress-lightmap --prio 5 --lane cpu -- python grove/tools/compress_lightmap.py grove/public/assets/hall

Writes `lightmap.ktx2` (2048², what desktops and headsets load) and
`lightmap-1024.ktx2` (the phone tier) beside `lightmap.png`, UASTC quality 2
with zstd 18 — a lightmap is a smooth signal and ETC1S bands across large
walls (bake_hall.py `maybe_ktx2`, whose flags these are). Then it patches
`hall.json` and the glb's `asset.extras.orchard.lightmap` so the record says
what is on disk, and appends a `post_bake_ktx2` provenance block. Run
verify_hall.py afterwards.

`toktx` is KTX-Software's; on this box it is ~/tools/ktx, symlinked into
~/.local/bin (installed 2026-09-12, v4.4.2).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_hall_glb import read_glb, sha256_file, write_glb  # noqa: E402

TIERS = [("lightmap.ktx2", None), ("lightmap-1024.ktx2", "1024x1024")]
FLAGS = ["--t2", "--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18",
         "--assign_oetf", "srgb", "--genmipmap"]
NOTE = "UASTC quality 2 + zstd 18 (smooth signal; ETC1S bands on large walls)"


def main(out_dir: str) -> int:
    toktx = shutil.which("toktx")
    if not toktx:
        print("toktx not on PATH (KTX-Software; ~/tools/ktx on this box)", file=sys.stderr)
        return 2
    png = os.path.join(out_dir, "lightmap.png")
    if not os.path.exists(png):
        print(f"no {png}", file=sys.stderr)
        return 2
    t0 = time.time()
    written = {}
    for name, resize in TIERS:
        dst = os.path.join(out_dir, name)
        cmd = [toktx, *FLAGS, *(["--resize", resize] if resize else []), dst, png]
        subprocess.run(cmd, check=True)
        written[name] = {"bytes": os.path.getsize(dst), "sha256": sha256_file(dst)}
        print(f"  {name:20s} {written[name]['bytes'] / 1024:8.1f} kB")
    version_line = subprocess.run([toktx, "--version"], capture_output=True, text=True).stdout.strip()

    json_path = os.path.join(out_dir, "hall.json")
    rec = json.load(open(json_path))
    lm_patch = {
        "ktx2": "lightmap.ktx2",
        "ktx2_phone": "lightmap-1024.ktx2",
        "ktx2_note": NOTE + f"; {version_line}; mipmapped; the PNG stays as the fallback",
    }
    rec["lightmap"].update(lm_patch)
    rec["files"].update(written)

    glb_path = os.path.join(out_dir, "hall.glb")
    version, chunks = read_glb(glb_path)
    doc = json.loads(chunks[0][1].decode("utf-8"))
    orchard = doc.setdefault("asset", {}).setdefault("extras", {}).setdefault("orchard", {})
    orchard.setdefault("lightmap", {}).update(lm_patch)
    stamp = {
        "script": "grove/tools/compress_lightmap.py",
        "script_sha256": sha256_file(os.path.abspath(__file__)),
        "applied_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "toktx": version_line,
        "files": list(written),
        "rebaked": False,
    }
    orchard["post_bake_ktx2"] = stamp
    write_glb(glb_path, version, doc, chunks)
    rec["post_bake_ktx2"] = stamp
    rec["files"]["hall.glb"] = {"bytes": os.path.getsize(glb_path), "sha256": sha256_file(glb_path)}
    with open(json_path, "w") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")
    print(f"KTX2 OK {out_dir}  {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "grove/public/assets/hall"))
