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
    # node name -> (glTF translation, the direction its local -Z must point)
    # translation is (x, z_blender, -y_blender); facing is the camera convention,
    # so a three.js object given this quaternion looks the documented way.
    "spawn": ((0.0, 0.0, 8.0), (0.0, 0.0, -1.0)),          # down the hall, at the doorway
    "door_einstruct": ((0.0, 0.0, -10.0), (0.0, 0.0, 1.0)),  # back into the hall
    "poster_wall": ((7.04, 3.1, 0.0), (-1.0, 0.0, 0.0)),   # the panel normal
}
EXPECT_FLOOR = ((0.150, 0.135, 0.125, 1.0), 0.38)

fails: list[str] = []
notes: list[str] = []


def check(cond, msg):
    if cond:
        notes.append("  ok    %s" % msg)
    else:
        fails.append("  FAIL  %s" % msg)
    return cond


def qrot(q, v):
    """Rotate v by quaternion q, which glTF stores as (x, y, z, w)."""
    x, y, z, w = q
    ux, uy, uz = x, y, z
    dot = ux * v[0] + uy * v[1] + uz * v[2]
    uu = ux * ux + uy * uy + uz * uz
    cx = uy * v[2] - uz * v[1]
    cy = uz * v[0] - ux * v[2]
    cz = ux * v[1] - uy * v[0]
    k = w * w - uu
    return (2 * dot * ux + k * v[0] + 2 * w * cx,
            2 * dot * uy + k * v[1] + 2 * w * cy,
            2 * dot * uz + k * v[2] + 2 * w * cz)


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
    for want, (xyz, facing) in EXPECT_NODES.items():
        node = names.get(want)
        if not check(node is not None, "node %r present" % want):
            continue
        got = tuple(round(c, 3) for c in (node.translation or (0.0, 0.0, 0.0)))
        check(all(abs(a - b) < 0.02 for a, b in zip(got, xyz)),
              "node %r at %s (expected %s)" % (want, got, xyz))
        q = node.rotation or (0.0, 0.0, 0.0, 1.0)
        aim = tuple(round(c, 4) for c in qrot(q, (0.0, 0.0, -1.0)))
        up = tuple(round(c, 4) for c in qrot(q, (0.0, 1.0, 0.0)))
        check(all(abs(a - b) < 0.01 for a, b in zip(aim, facing)),
              "node %r local -Z points %s (expected %s)" % (want, aim, facing))
        check(abs(up[1] - 1.0) < 0.01, "node %r is upright, local +Y -> %s" % (want, up))
    check(abs((names["spawn"].translation or (0, 0, 0))[1]) < 1e-6,
          "spawn marker sits on the floor (y = 0): it is the body, the client adds eye height")

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

    floor = [m for m in g.materials if m.name == "hall_floor"]
    if check(bool(floor), "material hall_floor present"):
        pbr = floor[0].pbrMetallicRoughness
        base = tuple(pbr.baseColorFactor or (1.0, 1.0, 1.0, 1.0))
        rough = 1.0 if pbr.roughnessFactor is None else pbr.roughnessFactor
        check(all(abs(a - b) < 1e-3 for a, b in zip(base, EXPECT_FLOOR[0])),
              "hall_floor baseColorFactor %s (not the white glTF default)"
              % (tuple(round(c, 3) for c in base),))
        check(abs(rough - EXPECT_FLOOR[1]) < 1e-3, "hall_floor roughnessFactor %.2f" % rough)
    for m in g.materials:
        b = tuple(m.pbrMetallicRoughness.baseColorFactor or (1.0, 1.0, 1.0, 1.0))
        check(b != (1.0, 1.0, 1.0, 1.0), "%s carries a real baseColorFactor" % m.name)

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
    import math
    check(abs(lm.get("three_light_map_intensity", 0) - lm["scale"] * math.pi) < 1e-3,
          "three_light_map_intensity %.4f == scale * pi (three r155+ has no 1/pi)"
          % lm.get("three_light_map_intensity", float("nan")))
    check(lm.get("three_light_map_intensity") == orchard["lightmap"].get(
        "three_light_map_intensity"), "glb extras carry the same intensity")
    check("RGBA" in lm["encoding"] and ctype == 6, "encoding string matches the PNG colour type")
    check("channel = 1" in lm.get("binding", ""), "lightmap.binding spells out the client binding")
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
