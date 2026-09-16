#!/usr/bin/env python3
"""
patch_hall_glb.py -- post-bake corrections to grove/public/assets/hall.

Applied once, after the review of 2026-09-12, so the 21-minute lightmap did not
have to be re-baked.  `bake_hall.py` was fixed to produce all of this directly,
so a future bake needs no patch; this script exists so the edit that was made to
the shipped bytes is reproducible and reviewable.

    exp run orchard-patch-hall --prio 5 --lane cpu -- uv run python grove/tools/patch_hall_glb.py grove/public/assets/hall

What it changes, and why (review findings 1, 3, 4, 5):

  * marker rotations -- the Y-up export conjugates the Blender rotation, so the
    empties' local -Z came out pointing at the ceiling and their local -Y at the
    intended facing.  Rewritten so local -Z IS the facing, the camera convention.
  * hall_floor baseColorFactor / roughnessFactor -- the floor's procedural left
    both inputs node-linked, so the exporter wrote the glTF defaults (white, 1.0)
    instead of the intended constants.
  * lightmap.three_light_map_intensity -- three.js r155+ dropped the 1/pi in the
    light map path, so the client needs scale * pi, not scale.
  * lightmap.encoding -- the PNG is RGBA, not RGB.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import sys
import time

# node name -> (rotation quaternion xyzw, what its local -Z then points at)
ROTATIONS = {
    "spawn":          ([0.0, 0.0, 0.0, 1.0],                    "(0, 0, -1), down the hall at the doorway"),
    "door_einstruct": ([0.0, 1.0, 0.0, 0.0],                    "(0, 0, +1), back into the hall"),
    "poster_wall":    ([0.0, 0.7071067811865476, 0.0, 0.7071067811865476], "(-1, 0, 0), the panel normal"),
}
FLOOR_BASE_COLOR = [0.150, 0.135, 0.125, 1.0]     # linear, == MAT_BASE[M_FLOOR]
FLOOR_ROUGHNESS = 0.38                            # == MAT_ROUGH[M_FLOOR]


def read_glb(path):
    with open(path, "rb") as fh:
        blob = fh.read()
    magic, version, total = struct.unpack("<III", blob[:12])
    assert magic == 0x46546C67, "not a glb"
    off, chunks = 12, []
    while off < total:
        clen, ctype = struct.unpack("<II", blob[off:off + 8])
        chunks.append((ctype, blob[off + 8:off + 8 + clen]))
        off += 8 + clen
    return version, chunks


def write_glb(path, version, doc, chunks):
    js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js
    for ctype, data in chunks[1:]:
        pad = b"\x00" * ((4 - len(data) % 4) % 4)
        body += struct.pack("<II", len(data) + len(pad), ctype) + data + pad
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, version, 12 + len(body)) + body)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 16), b""):
            h.update(blk)
    return h.hexdigest()


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "grove/public/assets/hall"
    glb = os.path.join(d, "hall.glb")
    rec_path = os.path.join(d, "hall.json")
    me = os.path.abspath(__file__)

    version, chunks = read_glb(glb)
    doc = json.loads(chunks[0][1].decode("utf-8"))
    changes = []

    by_name = {n.get("name"): n for n in doc.get("nodes", [])}
    for name, (quat, meaning) in ROTATIONS.items():
        node = by_name.get(name)
        assert node is not None, "no node %r in %s" % (name, glb)
        before = node.get("rotation")
        node["rotation"] = list(quat)
        changes.append("node %s rotation %s -> %s, local -Z now %s"
                       % (name, [round(c, 4) for c in (before or [0, 0, 0, 1])],
                          [round(c, 4) for c in quat], meaning))

    for mat in doc.get("materials", []):
        if mat.get("name") != "hall_floor":
            continue
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        changes.append("material hall_floor baseColorFactor %s -> %s, roughnessFactor %s -> %s"
                       % (pbr.get("baseColorFactor"), FLOOR_BASE_COLOR,
                          pbr.get("roughnessFactor"), FLOOR_ROUGHNESS))
        pbr["baseColorFactor"] = list(FLOOR_BASE_COLOR)
        pbr["roughnessFactor"] = FLOOR_ROUGHNESS

    orchard = doc["asset"]["extras"]["orchard"]
    lm = orchard["lightmap"]
    rec = json.load(open(rec_path))

    def fix_lightmap(block):
        block["three_light_map_intensity"] = round(block["scale"] * math.pi, 6)
        block["encoding"] = "sRGB transfer, 8 bit RGBA PNG (alpha constant 1)"
        block["scale_meaning"] = "irradiance/pi = srgb_decode(texel) * scale"
        block["binding"] = ("texture.colorSpace = SRGBColorSpace, flipY = false, channel = 1 "
                            "(TEXCOORD_1), material.lightMapIntensity = three_light_map_intensity")
        return block["three_light_map_intensity"]

    intensity = fix_lightmap(lm)
    fix_lightmap(rec["lightmap"])
    changes.append("lightmap.three_light_map_intensity = %.6f (scale * pi); encoding string "
                   "corrected to RGBA" % intensity)

    for block in (orchard, rec):
        spawn = block["geometry"]["spawn"]
        spawn["marker_translation_gltf"] = [0.0, 0.0, 8.0]
        spawn["note"] = ("the marker sits on the FLOOR (y = 0 in glTF): it is the body position, "
                         "the client adds its own eye height (view.ts EYE_HEIGHT). "
                         "eye_height_m = 1.6 in the node's extras is what preview.png was "
                         "rendered from, not an instruction. Facing is the node's local -Z, "
                         "(0, 0, -1), which is three.js' default camera forward.")
        block["geometry"]["doorway"]["marker_facing_gltf"] = [0.0, 0.0, 1.0]
        block["geometry"]["doorway"]["marker_facing_note"] = (
            "the door_einstruct node's local -Z points back INTO the hall; you travel "
            "through the doorway the other way, towards -Z world")

    patch = {
        "script": "grove/tools/patch_hall_glb.py",
        "script_sha256": sha256_file(me),
        "applied_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "reason": "review docs/reviews/WP3-hall-bake-review.md, findings 1, 3, 4, 5",
        "rebaked": False,
        "changes": changes,
    }
    orchard["post_bake_patch"] = patch
    rec["post_bake_patch"] = patch

    write_glb(glb, version, doc, chunks)

    for name, meta in rec["files"].items():
        p = os.path.join(d, name)
        if os.path.exists(p):
            meta["bytes"] = os.path.getsize(p)
            meta["sha256"] = sha256_file(p)
    with open(rec_path, "w") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")

    for c in changes:
        print("  " + c)
    print("PATCH OK %s" % glb)


if __name__ == "__main__":
    main()
