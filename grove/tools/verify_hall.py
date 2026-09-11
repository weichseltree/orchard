#!/usr/bin/env python3
"""
verify_hall.py -- check the WP3 hall asset the way the client will meet it.

    exprun uv run --with pygltflib python grove/tools/verify_hall.py \
        grove/public/assets/hall

Exits 0 and prints "VERIFY OK" only if every assertion holds.
"""
from __future__ import annotations

import json
import os
import struct
import sys

import pygltflib

MAX_GLB_BYTES = 8 * 1024 * 1024
EXPECT_NODES = {
    # node name -> glTF translation (Y up): (x, z_blender, -y_blender)
    "spawn": (0.0, 0.0, 8.0),
    "door_einstruct": (0.0, 0.0, -10.0),
    "poster_wall": (7.04, 3.1, 0.0),
}

fails: list[str] = []
notes: list[str] = []


def check(cond, msg):
    if cond:
        notes.append("  ok    %s" % msg)
    else:
        fails.append("  FAIL  %s" % msg)
    return cond


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(26)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "%s is not a PNG" % path
    w, h = struct.unpack(">II", head[16:24])
    return w, h, head[24], head[25]      # width, height, bit depth, colour type


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "grove/public/assets/hall"
    glb_path = os.path.join(d, "hall.glb")
    png_path = os.path.join(d, "lightmap.png")
    json_path = os.path.join(d, "hall.json")
    prev_path = os.path.join(d, "preview.png")

    for p in (glb_path, png_path, json_path):
        if not os.path.exists(p):
            print("missing %s" % p)
            return 2

    size = os.path.getsize(glb_path)
    check(size < MAX_GLB_BYTES, "hall.glb %.1f kB < 8 MB" % (size / 1024))

    g = pygltflib.GLTF2().load(glb_path)
    check(len(g.meshes) <= 2, "%d mesh(es)" % len(g.meshes))
    prims = [p for m in g.meshes for p in m.primitives]
    check(len(prims) >= 1, "%d primitives" % len(prims))
    with_uv2 = [p for p in prims if p.attributes.TEXCOORD_1 is not None]
    check(len(with_uv2) == len(prims),
          "TEXCOORD_1 on every primitive (%d/%d)" % (len(with_uv2), len(prims)))
    check(all(p.attributes.TEXCOORD_0 is not None for p in prims), "TEXCOORD_0 on every primitive")
    check(not (g.extensionsRequired or []), "no required extensions (Draco off): %r"
          % (g.extensionsRequired or []))
    check(all("draco" not in (e or "").lower() for e in (g.extensionsUsed or [])),
          "no Draco in extensionsUsed: %r" % (g.extensionsUsed or []))

    extras = (g.asset.extras or {})
    orchard = extras.get("orchard", {}) if isinstance(extras, dict) else {}
    check(bool(orchard), "asset.extras.orchard present")
    for key in ("script", "script_sha256", "blender", "git_commit", "bake", "lightmap", "geometry"):
        check(key in orchard, "asset.extras.orchard.%s" % key)
    bake = orchard.get("bake", {})
    for key in ("samples", "resolution", "denoise", "seconds_bake", "device"):
        check(key in bake, "asset.extras.orchard.bake.%s = %r" % (key, bake.get(key)))
    check(bake.get("resolution") == 2048, "baked at 2048^2 (got %r)" % bake.get("resolution"))

    names = {n.name: n for n in g.nodes}
    for want, xyz in EXPECT_NODES.items():
        node = names.get(want)
        if not check(node is not None, "node %r present" % want):
            continue
        got = tuple(round(c, 3) for c in (node.translation or (0.0, 0.0, 0.0)))
        check(all(abs(a - b) < 0.02 for a, b in zip(got, xyz)),
              "node %r at %s (expected %s)" % (want, got, xyz))

    # mesh bounds, in glTF axes
    pos = [g.accessors[p.attributes.POSITION] for p in prims]
    lo = [min(a.min[i] for a in pos) for i in range(3)]
    hi = [max(a.max[i] for a in pos) for i in range(3)]
    check(abs(hi[1] - 7.35) < 0.02 and abs(lo[1]) < 0.02,
          "Y-up: floor at y=%.2f, coffer tops at y=%.2f" % (lo[1], hi[1]))
    check(abs(lo[2] + 10.45) < 0.02 and abs(hi[2] - 10.0) < 0.02,
          "doorway wall towards -Z: z in [%.2f, %.2f]" % (lo[2], hi[2]))
    check(abs(lo[0] + 7.35) < 0.02 and abs(hi[0] - 7.04) < 0.02,
          "windows towards -X: x in [%.2f, %.2f]" % (lo[0], hi[0]))

    w, h, depth, ctype = png_size(png_path)
    check((w, h) == (2048, 2048), "lightmap.png %dx%d" % (w, h))
    check(depth == 8, "lightmap.png 8 bit (colour type %d)" % ctype)
    notes.append("  --    lightmap.png %.1f kB" % (os.path.getsize(png_path) / 1024))

    if os.path.exists(prev_path):
        pw, ph, _, _ = png_size(prev_path)
        check((pw, ph) == (1280, 720), "preview.png %dx%d" % (pw, ph))
    else:
        fails.append("  FAIL  preview.png missing")

    rec = json.load(open(json_path))
    check(rec.get("schema") == "orchard/hall/1", "hall.json schema %r" % rec.get("schema"))
    check(rec["bake"]["samples"] == bake.get("samples"), "hall.json and extras agree on samples")
    check(rec["script_sha256"] == orchard.get("script_sha256"), "script sha256 agrees")
    import hashlib
    for name, meta in rec["files"].items():
        fp = os.path.join(d, name)
        h = hashlib.sha256(open(fp, "rb").read()).hexdigest() if os.path.exists(fp) else ""
        check(h == meta["sha256"] and os.path.getsize(fp) == meta["bytes"],
              "hall.json digest matches %s on disk" % name)
    lm = rec["lightmap"]
    check(0.05 < lm["scale"] < 100.0, "lightmap scale %.3f" % lm["scale"])
    check(lm["clipped_fraction"] < 0.01, "clipped %.4f%% of baked texels"
          % (100 * lm["clipped_fraction"]))
    check(lm["coverage"] > 0.35, "atlas coverage %.1f%%" % (100 * lm["coverage"]))

    print("\n".join(notes))
    if fails:
        print("\n".join(fails))
        print("VERIFY FAILED (%d)" % len(fails))
        return 1
    print("VERIFY OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
