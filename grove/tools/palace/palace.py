#!/usr/bin/env python3
"""
palace.py -- build the palace from mansion.json and bake it room by room.

Grown out of bake_hall.py (imported for its mesh builder, bake, denoise and
export helpers). Run inside Blender 4.2, headless, on the CPU:

    exprun /home/manuel/tools/blender/blender --background \
        --python grove/tools/palace/palace.py -- --room hall --samples 512

Modes (one per run):
    --room <id> [--bake] [--samples N] [--res R] [--preview]
        build every room of the mansion as occluders, bake <id>'s lightmap,
        export <id>.glb + lightmap tiers + <id>.json into --out/<id>/
    --room <id> --no-bake
        the same without the bake (a flat grey lightmap), for the pipeline
    --stills [--samples N]
        Cycles renders of the look from a few spawns, no bake (docs/img)
    --list
        the rooms the mansion carries a `palace` block for

The look (Manuel's ruling, 2026-09-12 evening: "white and gold and marble,
like the Naturhistorisches Museum"): cream stucco walls, a red-brown marble
wainscot, pale veined-marble dressings and pilasters with gilt capitals, a
patterned marble floor, white coffered ceilings. Every albedo is a linear
constant or one tiling texture generated here (value-noise marble), so the
glb carries nothing lifted.

Coordinates: mansion.json is glTF (Y up). Blender is Z up. (x, y, z)_gltf
<-> (x, -z, y)_blender. Every room is built in ABSOLUTE coordinates, so the
exported glb needs no placement: the client adds it at the origin.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS)
import bake_hall as hb  # noqa: E402  (Build, reveal, uvs, bake, denoise, export helpers)

REPO = os.path.dirname(os.path.dirname(TOOLS))
MANSION = os.path.join(REPO, "grove", "src", "world", "mansion.json")
Z = Vector((0.0, 0.0, 1.0))
EPS = 1e-6


def log(msg):
    print("[palace] %s" % msg, flush=True)


# --------------------------------------------------------------------------
# the look: materials
# --------------------------------------------------------------------------
# part -> (linear albedo, roughness, texture name or None, tile metres, metallic)
LOOK = {
    "floor_marble":  ((0.62, 0.60, 0.56), 0.18, "floor_pattern", 4.0, 0.0),
    "floor_parquet": ((0.30, 0.20, 0.12), 0.45, "parquet", 2.4, 0.0),
    "floor_stone":   ((0.42, 0.41, 0.38), 0.70, "stone", 2.0, 0.0),
    "floor_dark":    ((0.045, 0.045, 0.05), 0.25, None, 1.0, 0.0),
    "wall_stucco":   ((0.66, 0.62, 0.55), 0.90, None, 1.0, 0.0),
    "wall_limewash": ((0.72, 0.70, 0.66), 0.92, None, 1.0, 0.0),
    "wall_dark":     ((0.02, 0.02, 0.025), 0.95, None, 1.0, 0.0),
    "ceiling":       ((0.74, 0.72, 0.68), 0.92, None, 1.0, 0.0),
    "ceiling_dark":  ((0.015, 0.015, 0.02), 0.95, None, 1.0, 0.0),
    "marble_white":  ((0.60, 0.59, 0.57), 0.30, "marble_white", 2.0, 0.0),
    "marble_red":    ((0.30, 0.14, 0.11), 0.28, "marble_red", 2.0, 0.0),
    "gilt":          ((0.85, 0.65, 0.30), 0.35, None, 1.0, 1.0),
    "panel":         ((0.78, 0.77, 0.74), 0.92, None, 1.0, 0.0),
    "door_leaf":     ((0.18, 0.11, 0.07), 0.55, "parquet", 1.2, 0.0),
}

PARTS = ["floor", "wall", "ceiling", "trim", "wainscot", "pilaster", "gilt", "panel", "leaf"]
P_FLOOR, P_WALL, P_CEIL, P_TRIM, P_WAINSCOT, P_PILASTER, P_GILT, P_PANEL, P_LEAF = range(9)

TYPE_DEFAULTS = {
    # H, wainscot h, cornice z0, z1, coffers (nx, ny) hint size, floor look, wall look
    "hall":       dict(h=7.0, wainscot=1.10, cornice=(6.55, 6.85), coffer=3.4, floor="floor_marble", wall="wall_stucco"),
    "state-room": dict(h=6.0, wainscot=1.10, cornice=(5.55, 5.85), coffer=3.2, floor="floor_parquet", wall="wall_stucco"),
    "cabinet":    dict(h=6.0, wainscot=1.10, cornice=(5.55, 5.85), coffer=3.2, floor="floor_parquet", wall="wall_stucco"),
    "planet":     dict(h=6.0, wainscot=0.0,  cornice=(5.70, 5.85), coffer=3.5, floor="floor_dark", wall="wall_dark"),
    "gallery":    dict(h=7.0, wainscot=1.10, cornice=(6.55, 6.85), coffer=3.6, floor="floor_marble", wall="wall_stucco"),
    "orangery":   dict(h=7.0, wainscot=0.0,  cornice=(6.55, 6.85), coffer=3.6, floor="floor_stone", wall="wall_limewash"),
    "greenhouse": dict(h=5.0, wainscot=0.0,  cornice=(4.70, 4.85), coffer=2.6, floor="floor_stone", wall="wall_limewash"),
}

WAINSCOT_P, CORNICE_P = 0.06, 0.12
DOOR_DEPTH, WIN_DEPTH = 0.45, 0.35
PANEL_DEPTH = 0.04
PIL_W, PIL_P = 0.50, 0.12
CAP_W, CAP_H, CAP_P = 0.72, 0.32, 0.20
BASE_W, BASE_H, BASE_P = 0.62, 0.28, 0.16
SURR_W, SURR_H, SURR_P = 0.30, 0.35, 0.08
CREST_H, CREST_P = 0.26, 0.10
COFFER_D, BEAM_W = 0.35, 0.50
EYE_H = 1.60


# --------------------------------------------------------------------------
# textures: value-noise marble, generated once, tiling
# --------------------------------------------------------------------------
def _value_noise(px, freq, rng):
    g = rng.random((freq + 1, freq + 1)).astype(np.float32)
    g[-1, :] = g[0, :]
    g[:, -1] = g[:, 0]
    xs = np.linspace(0, freq, px, endpoint=False)
    i = np.floor(xs).astype(int)
    f = xs - i
    f = f * f * (3 - 2 * f)
    a = g[np.ix_(i, i)]
    b = g[np.ix_(i + 1, i)]
    c = g[np.ix_(i, i + 1)]
    d = g[np.ix_(i + 1, i + 1)]
    fx, fy = f[:, None], f[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _fbm(px, rng, octaves=6, base=4):
    out = np.zeros((px, px), dtype=np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += amp * _value_noise(px, base * 2 ** o, rng)
        tot += amp
        amp *= 0.5
    return out / tot


def marble(px, rng, base, vein, vein_width=0.05, warp=0.9, veins=5.0):
    n = _fbm(px, rng)
    w = _fbm(px, rng, octaves=4, base=2)
    xs = np.linspace(0, 1, px, endpoint=False)
    phase = xs[:, None] * veins * 2 * math.pi + warp * 12.0 * (n - 0.5) + 3.0 * (w - 0.5)
    v = np.abs(np.sin(phase))
    v = np.exp(-((1 - v) / vein_width) ** 2)           # thin bright lines where sin ~ 1
    mottle = 0.86 + 0.28 * (n - 0.5)
    rgb = np.array(base, dtype=np.float32)[None, None, :] * mottle[..., None]
    rgb = rgb * (1 - v[..., None]) + np.array(vein, dtype=np.float32)[None, None, :] * v[..., None]
    return np.clip(rgb, 0, 1)


def floor_pattern(px, rng):
    """Light marble field, a dark-grey diagonal grid of inlay bands, dark
    border squares at the crossings: the museum's floor, simplified."""
    light = marble(px, rng, (0.66, 0.64, 0.60), (0.50, 0.49, 0.47), veins=3.0)
    dark = marble(px, rng, (0.10, 0.10, 0.11), (0.22, 0.22, 0.23), veins=4.0)
    xs = np.linspace(0, 1, px, endpoint=False)
    u, v = xs[:, None], xs[None, :]
    band = 0.028
    d1 = np.abs(((u + v) % 0.5) - 0.25) < band
    d2 = np.abs(((u - v) % 0.5) - 0.25) < band
    sq = (np.abs((u % 0.5) - 0.25) < 0.06) & (np.abs((v % 0.5) - 0.25) < 0.06)
    m = (d1 | d2 | sq)[..., None]
    return np.where(m, dark, light)


def parquet(px, rng):
    """Dark oak, herringbone-ish: alternating strips with a grain."""
    n = _fbm(px, rng, octaves=5, base=8)
    xs = np.linspace(0, 1, px, endpoint=False)
    u, v = xs[:, None], xs[None, :]
    strip = np.floor((u * 8 + np.floor(v * 4) * 0.5) % 2)
    tone = 0.32 + 0.12 * strip + 0.16 * (n - 0.5)
    rgb = np.stack([tone * 0.95, tone * 0.66, tone * 0.40], axis=-1)
    seam = (np.abs((u * 8) % 1 - 0.5) > 0.47) | (np.abs((v * 4) % 1 - 0.5) > 0.485)
    rgb[seam] *= 0.7
    return np.clip(rgb, 0, 1)


def stone(px, rng):
    n = _fbm(px, rng, octaves=5, base=3)
    xs = np.linspace(0, 1, px, endpoint=False)
    u, v = xs[:, None], xs[None, :]
    tone = 0.40 + 0.18 * (n - 0.5)
    seam = (np.abs((u * 2) % 1 - 0.5) > 0.485) | (np.abs((v * 2) % 1 - 0.5) > 0.485)
    tone = np.where(seam, tone * 0.6, tone)
    return np.clip(np.stack([tone * 1.02, tone, tone * 0.94], axis=-1), 0, 1)


def make_textures(out_dir, px=1024):
    """PNGs on disk, then Blender images. Deterministic (seed 7) so a rebake
    ships the same bytes."""
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(7)
    gens = {
        "marble_white": lambda: marble(px, rng, (0.62, 0.61, 0.59), (0.36, 0.36, 0.38), veins=4.0),
        "marble_red": lambda: marble(px, rng, (0.30, 0.13, 0.10), (0.62, 0.52, 0.46), vein_width=0.04, veins=6.0),
        "floor_pattern": lambda: floor_pattern(px, rng),
        "parquet": lambda: parquet(px, rng),
        "stone": lambda: stone(px, rng),
    }
    images = {}
    for name, gen in gens.items():
        path = os.path.join(out_dir, name + ".jpg")
        if not os.path.exists(path):
            rgb = gen()
            # No alpha: the glTF exporter then embeds a JPEG, a fifth of the PNG.
            a = np.ones((px, px, 4), dtype=np.float32)
            a[..., :3] = hb.srgb_encode(rgb)
            img = bpy.data.images.new(name, px, px, alpha=False)
            img.colorspace_settings.name = "sRGB"
            img.pixels.foreach_set(a.reshape(-1))
            img.filepath_raw = path
            img.file_format = "JPEG"
            bpy.context.scene.render.image_settings.quality = 90
            img.save()
            bpy.data.images.remove(img)
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = "sRGB"
        images[name] = img
    return images


# --------------------------------------------------------------------------
# the plan: rooms from mansion.json
# --------------------------------------------------------------------------
def load_mansion():
    with open(MANSION) as fh:
        return json.load(fh)


class RoomPlan:
    """One room in Blender coordinates, with its style resolved."""

    def __init__(self, room, mansion):
        self.id = room["id"]
        self.raw = room
        p = room.get("palace") or {}
        self.type = p.get("type", "state-room")
        d = dict(TYPE_DEFAULTS[self.type])
        d.update({k: v for k, v in p.items() if k in d})
        self.style = d
        (gx0, gy0, gz0), (gx1, gy1, gz1) = room["bounds"]["min"], room["bounds"]["max"]
        self.x0, self.x1 = float(gx0), float(gx1)
        self.y0, self.y1 = -float(gz1), -float(gz0)          # blender y = -gltf z
        self.h = float(gy1 - gy0) if not p.get("h") else float(p["h"])
        self.h = d["h"] if abs(self.h - d["h"]) > 1e-6 and not p.get("h") else self.h
        self.windows = p.get("windows", [])            # [{wall, bays|centers, width, sill, head, reveal}]
        self.posters = p.get("posters", [])            # [{wall, center, width, height, z0}]
        self.niches = p.get("niches", [])              # [{wall, centers, width, height, depth}]
        self.floor_look = p.get("floor", d["floor"])
        self.wall_look = p.get("wall", d["wall"])
        self.pilasters = p.get("pilasters", self.type in ("hall", "state-room", "gallery", "cabinet"))
        self.doorways = room.get("doorways", [])
        self.spawn = room.get("spawn", {"position": [0, 0, 0], "yawDeg": 0})
        self.mansion = mansion

    # wall descriptors: name -> (A, B) floor corners CCW, interior on the left of A->B
    def walls(self):
        x0, x1, y0, y1 = self.x0, self.x1, self.y0, self.y1
        return {
            "+x": ((x1, y0), (x1, y1)),   # u runs +y
            "+y": ((x1, y1), (x0, y1)),   # u runs -x   (gltf -z)
            "-x": ((x0, y1), (x0, y0)),   # u runs -y
            "-y": ((x0, y0), (x1, y0)),   # u runs +x   (gltf +z)
        }

    def wall_of_door(self, d):
        if d["axis"] == "x":
            return "-x" if abs(d["at"] - self.x0) < 1e-6 else "+x"
        by = -d["at"]
        return "-y" if abs(by - self.y0) < 1e-6 else "+y"

    def u_of(self, wall, x=None, y=None):
        """Distance along the wall from its A corner, for a point given by the
        coordinate that varies along that wall."""
        A, B = self.walls()[wall]
        if wall in ("+x", "-x"):
            return (y - A[1]) if wall == "+x" else (A[1] - y)
        return (A[0] - x) if wall == "+y" else (x - A[0])

    def interior_normal(self, wall):
        return {"+x": (-1, 0, 0), "-x": (1, 0, 0), "+y": (0, -1, 0), "-y": (0, 1, 0)}[wall]

    def hole_for_door(self, d):
        wall = self.wall_of_door(d)
        if d["axis"] == "x":
            u = self.u_of(wall, y=-d["center"])
        else:
            u = self.u_of(wall, x=d["center"])
        w, h = float(d["width"]), float(d["height"])
        return wall, (u - w / 2, u + w / 2, 0.0, min(h, self.h))

    def window_holes(self):
        out = []
        for w in self.windows:
            wall = w["wall"]
            A, B = self.walls()[wall]
            L = math.dist(A, B)
            width = float(w.get("width", 1.6))
            sill, head = float(w.get("sill", 1.6)), float(w.get("head", 5.6))
            if "centers" in w:
                us = [self.u_of(wall, x=c, y=-c) if False else None for c in w["centers"]]
                us = []
                for c in w["centers"]:
                    us.append(self.u_of(wall, y=-c) if wall in ("+x", "-x") else self.u_of(wall, x=c))
            else:
                n = int(w.get("bays", 3))
                step = L / n
                us = [step * (i + 0.5) for i in range(n)]
            for u in us:
                out.append((wall, (u - width / 2, u + width / 2, sill, head), float(w.get("reveal", WIN_DEPTH))))
        return out


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def build_wall(b, plan, wall, holes):
    """A stepped wall: wainscot, field, cornice, frieze. Adapted from
    bake_hall.build_wall with the room's own heights."""
    A, B = plan.walls()[wall]
    a = Vector((A[0], A[1], 0.0))
    bb = Vector((B[0], B[1], 0.0))
    uh = (bb - a).normalized()
    L = (bb - a).length
    n = Z.cross(uh)
    H = plan.h
    wh = plan.style["wainscot"]
    c0, c1 = plan.style["cornice"]
    strips = []
    if wh > 0:
        strips.append((0.0, wh, WAINSCOT_P, P_WAINSCOT))
        strips.append((wh, c0, 0.0, P_WALL))
    else:
        strips.append((0.0, c0, 0.0, P_WALL))
    strips.append((c0, c1, CORNICE_P, P_TRIM))
    strips.append((c1, H, 0.0, P_WALL))
    for z0, z1, inset, mat in strips:
        s = inset
        origin = a + uh * s + n * inset + Z * z0
        loc = []
        for hu0, hu1, hz0, hz1 in holes:
            if hz1 <= z0 + EPS or hz0 >= z1 - EPS:
                continue
            loc.append((hu0 - s, max(hz0, z0) - z0, hu1 - s, min(hz1, z1) - z0))
        b.rect_holes(origin, uh * (L - 2 * s), Z * (z1 - z0), loc, mat, want=n)
    caps = []
    if wh > 0:
        caps.append((wh, WAINSCOT_P, 0.0, P_WAINSCOT))
    caps.append((c0, 0.0, CORNICE_P, P_GILT))      # the cornice's underside bead: gilt
    caps.append((c1, CORNICE_P, 0.0, P_TRIM))
    for z, i0, i1, mat in caps:
        s = max(i0, i1)
        up = Z if i1 < i0 else -Z
        origin = a + uh * s + n * min(i0, i1) + Z * z
        loc = [(hu0 - s, 0.0, hu1 - s, abs(i1 - i0)) for hu0, hu1, hz0, hz1 in holes if hz0 < z - EPS < hz1]
        b.rect_holes(origin, uh * (L - 2 * s), n * abs(i1 - i0), loc, mat, want=up)


def build_corner_caps(b, plan):
    corners = [plan.walls()[w][0] for w in ("+x", "+y", "-x", "-y")]
    wh = plan.style["wainscot"]
    c0, c1 = plan.style["cornice"]
    caps = ([(wh, WAINSCOT_P, 0.0, P_WAINSCOT)] if wh > 0 else []) + [(c0, 0.0, CORNICE_P, P_GILT), (c1, CORNICE_P, 0.0, P_TRIM)]
    for k, c in enumerate(corners):
        prev = corners[k - 1]
        uh = (Vector((c[0], c[1], 0.0)) - Vector((prev[0], prev[1], 0.0))).normalized()
        n = Z.cross(uh)
        p = Vector((c[0], c[1], 0.0))
        for z, i0, i1, mat in caps:
            t = max(i0, i1)
            up = Z if i1 < i0 else -Z
            b.quad(p + Z * z - uh * t, n * t, uh * t, mat, want=up)


def box_on_wall(b, plan, wall, u0, u1, z0, z1, proud, mat):
    """A box standing proud of the wall between u0..u1 along it and z0..z1 up:
    front face plus the four returns (the back is the wall)."""
    A, B = plan.walls()[wall]
    a = Vector((A[0], A[1], 0.0))
    uh = (Vector((B[0], B[1], 0.0)) - a).normalized()
    n = Z.cross(uh)
    o = a + uh * u0 + Z * z0
    du, dz = uh * (u1 - u0), Z * (z1 - z0)
    b.quad(o + n * proud, du, dz, mat, want=n)                 # front
    b.quad(o, dz, n * proud, mat, want=-uh)                     # left return
    b.quad(o + du, dz, n * proud, mat, want=uh)                 # right return
    b.quad(o + dz, du, n * proud, mat, want=Z)                  # top
    if z0 > EPS:
        b.quad(o, du, n * proud, mat, want=-Z)                  # underside


def build_pilasters(b, plan, holes_by_wall):
    """Pilasters on the bay rhythm of the long walls, skipping openings."""
    wh = plan.style["wainscot"]
    c0, _ = plan.style["cornice"]
    z_base = wh if wh > 0 else 0.0
    for wall in ("+x", "-x", "+y", "-y"):
        A, B = plan.walls()[wall]
        L = math.dist(A, B)
        bays = max(2, int(round(L / 4.0)))
        pitch = L / bays
        us = [pitch * i for i in range(1, bays)] + [0.45, L - 0.45]
        holes = holes_by_wall.get(wall, [])
        for u in us:
            if any(h[0] - 0.6 < u < h[1] + 0.6 for h in holes):
                continue
            box_on_wall(b, plan, wall, u - PIL_W / 2, u + PIL_W / 2, z_base + BASE_H, c0 - CAP_H, PIL_P, P_PILASTER)
            box_on_wall(b, plan, wall, u - BASE_W / 2, u + BASE_W / 2, z_base, z_base + BASE_H, BASE_P, P_PILASTER)
            box_on_wall(b, plan, wall, u - CAP_W / 2, u + CAP_W / 2, c0 - CAP_H, c0, CAP_P, P_GILT)


def build_surround(b, plan, wall, hole):
    """A marble frame round a doorway on this room's face, a gilt crest above."""
    u0, u1, z0, z1 = hole
    box_on_wall(b, plan, wall, u0 - SURR_W, u0, 0.0, z1 + SURR_H, SURR_P, P_TRIM)
    box_on_wall(b, plan, wall, u1, u1 + SURR_W, 0.0, z1 + SURR_H, SURR_P, P_TRIM)
    box_on_wall(b, plan, wall, u0, u1, z1, z1 + SURR_H, SURR_P, P_TRIM)
    if z1 + SURR_H + CREST_H < plan.style["cornice"][0] - 0.1:
        box_on_wall(b, plan, wall, u0 - SURR_W * 0.5, u1 + SURR_W * 0.5, z1 + SURR_H, z1 + SURR_H + CREST_H, CREST_P, P_GILT)


def build_ceiling(b, plan):
    W, D, H = plan.x1 - plan.x0, plan.y1 - plan.y0, plan.h
    size = plan.style["coffer"]
    nx, ny = max(1, int(round(W / size))), max(1, int(round(D / size)))
    cw = (W - (nx + 1) * BEAM_W) / nx
    ch = (D - (ny + 1) * BEAM_W) / ny
    cells = []
    for i in range(nx):
        for j in range(ny):
            u0 = BEAM_W + i * (cw + BEAM_W)
            v0 = BEAM_W + j * (ch + BEAM_W)
            cells.append((u0, v0, u0 + cw, v0 + ch))
    x0, y0 = plan.x0, plan.y0
    b.rect_holes((x0, y0, H), (W, 0, 0), (0, D, 0), cells, P_CEIL, want=(0, 0, -1))
    dark = plan.type == "planet"
    field = P_CEIL
    side = P_CEIL if dark else P_TRIM
    for u0, v0, u1, v1 in cells:
        b.quad((x0 + u0, y0 + v0, H + COFFER_D), (u1 - u0, 0, 0), (0, v1 - v0, 0), field, want=(0, 0, -1))
        b.quad((x0 + u0, y0 + v0, H), (0, v1 - v0, 0), (0, 0, COFFER_D), side, want=(1, 0, 0))
        b.quad((x0 + u1, y0 + v0, H), (0, v1 - v0, 0), (0, 0, COFFER_D), side, want=(-1, 0, 0))
        b.quad((x0 + u0, y0 + v0, H), (u1 - u0, 0, 0), (0, 0, COFFER_D), side, want=(0, 1, 0))
        b.quad((x0 + u0, y0 + v1, H), (u1 - u0, 0, 0), (0, 0, COFFER_D), side, want=(0, -1, 0))


def build_room(plan):
    b = hb.Build()
    W, D = plan.x1 - plan.x0, plan.y1 - plan.y0
    b.quad((plan.x0, plan.y0, 0.0), (W, 0, 0), (0, D, 0), P_FLOOR, want=(0, 0, 1))

    holes_by_wall = {w: [] for w in ("+x", "+y", "-x", "-y")}
    reveals = []          # (wall, hole, depth, sides, mat)
    surrounds = []
    leaves = []
    markers = []

    for d in plan.doorways:
        wall, hole = plan.hole_for_door(d)
        closed = bool(d.get("closed"))
        if closed:
            # a door leaf set 0.12 m into the wall, framed: the wall stays solid behind it
            holes_by_wall[wall].append(hole)
            leaves.append((wall, hole))
        else:
            holes_by_wall[wall].append(hole)
            if plan.id < d["to"]:
                reveals.append((wall, hole, DOOR_DEPTH, "lrt", P_TRIM))
        surrounds.append((wall, hole))
        markers.append(("door", d, wall, hole))
    for wall, hole, depth in plan.window_holes():
        holes_by_wall[wall].append(hole)
        reveals.append((wall, hole, depth, "lrtb", P_TRIM))
        markers.append(("window", None, wall, hole))
    for k, p in enumerate(plan.posters):
        wall = p["wall"]
        u = plan.u_of(wall, y=-p["center"]) if wall in ("+x", "-x") else plan.u_of(wall, x=p["center"])
        hole = (u - p["width"] / 2, u + p["width"] / 2, p["z0"], p["z0"] + p["height"])
        holes_by_wall[wall].append(hole)
        reveals.append((wall, hole, PANEL_DEPTH, "lrtb", P_TRIM))
        markers.append(("poster", k, wall, hole))
    for nch in plan.niches:
        wall = nch["wall"]
        for c in nch["centers"]:
            u = plan.u_of(wall, y=-c) if wall in ("+x", "-x") else plan.u_of(wall, x=c)
            hole = (u - nch["width"] / 2, u + nch["width"] / 2, 0.0, nch["height"])
            holes_by_wall[wall].append(hole)
            reveals.append((wall, hole, nch["depth"], "lrt", P_TRIM))
            markers.append(("niche", nch, wall, hole))

    for wall in ("+x", "+y", "-x", "-y"):
        build_wall(b, plan, wall, holes_by_wall[wall])
    build_corner_caps(b, plan)

    for wall, hole, depth, sides, mat in reveals:
        A, B = plan.walls()[wall]
        o = Vector((A[0], A[1], 0.0))
        u = Vector((B[0] - A[0], B[1] - A[1], 0.0))
        v = Vector((0, 0, plan.h))
        u0, u1, z0, z1 = hole
        b.reveal(o, u, v, (u0, u1, z0, z1), depth, mat, inward=plan.interior_normal(wall), sides=sides)
        n = Vector(plan.interior_normal(wall))
        uh = u.normalized()
        back = o + uh * u0 + Z * z0 - n * depth
        if sides == "lrt":                                        # a doorway: threshold strip
            b.quad(o + uh * u0, uh * (u1 - u0), -n * depth, P_TRIM, want=Z)
        else:                                                     # a recess: its back face
            b.quad(back, uh * (u1 - u0), Z * (z1 - z0), P_PANEL if depth <= PANEL_DEPTH + EPS else P_WALL, want=n)
    for wall, hole in leaves:
        A, B = plan.walls()[wall]
        o = Vector((A[0], A[1], 0.0))
        u = Vector((B[0] - A[0], B[1] - A[1], 0.0))
        uh = u.normalized()
        n = Vector(plan.interior_normal(wall))
        u0, u1, z0, z1 = hole
        b.reveal(o, u, Vector((0, 0, plan.h)), hole, 0.12, P_TRIM, inward=plan.interior_normal(wall), sides="lrt")
        b.quad(o + uh * u0 - n * 0.12, uh * (u1 - u0), Z * (z1 - z0), P_LEAF, want=n)
    for wall, hole in surrounds:
        build_surround(b, plan, wall, hole)
    if plan.pilasters:
        build_pilasters(b, plan, holes_by_wall)
    build_ceiling(b, plan)
    return b, markers


# --------------------------------------------------------------------------
# materials per room
# --------------------------------------------------------------------------
def look_for(plan, part):
    if part == P_FLOOR:
        return plan.floor_look
    if part == P_WALL:
        return plan.wall_look
    if part == P_CEIL:
        return "ceiling_dark" if plan.type == "planet" else "ceiling"
    if part == P_TRIM:
        return "wall_dark" if plan.type == "planet" else "marble_white"
    if part == P_WAINSCOT:
        return "marble_red"
    if part == P_PILASTER:
        return "marble_white"
    if part == P_GILT:
        return "gilt"
    if part == P_PANEL:
        return "panel"
    return "door_leaf"


def make_room_materials(plan, bake_img, uv2_name, textures):
    mats = []
    for idx, part in enumerate(PARTS):
        look = look_for(plan, idx)
        base, rough, tex, tile, metal = LOOK[look]
        mat = bpy.data.materials.new("%s_%s" % (plan.id, part))
        mat.use_nodes = True
        mat.use_backface_culling = True            # single-sided: shared walls do not fight
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*base, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.4
        if tex and tex in textures:
            ti = nt.nodes.new("ShaderNodeTexImage")
            ti.image = textures[tex]
            ti.location = (-500, 200)
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "UVMap"
            uvn.location = (-900, 200)
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.location = (-700, 200)
            mp.inputs["Scale"].default_value = (1.0 / tile, 1.0 / tile, 1.0)
            nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
            nt.links.new(mp.outputs["Vector"], ti.inputs["Vector"])
            nt.links.new(ti.outputs["Color"], bsdf.inputs["Base Color"])
        tgt = nt.nodes.new("ShaderNodeTexImage")
        tgt.name = tgt.label = "lightmap_bake_target"
        tgt.image = bake_img
        tgt.location = (-300, 500)
        uvl = nt.nodes.new("ShaderNodeUVMap")
        uvl.uv_map = uv2_name
        uvl.location = (-500, 500)
        nt.links.new(uvl.outputs["UV"], tgt.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        tgt.select = True
        nt.nodes.active = tgt
        mats.append(mat)
    return mats


def flatten_for_export(mats):
    """The Mapping node between UV and texture is not something glTF carries
    (KHR_texture_transform is, and the exporter writes it only from a Mapping
    node fed by a UV Map node, which is the graph here). Constants stay."""
    return


# --------------------------------------------------------------------------
# markers
# --------------------------------------------------------------------------
def add_room_markers(scene, plan, markers):
    def empty(name, loc, facing, props):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "SINGLE_ARROW"
        e.empty_display_size = 0.5
        e.location = loc
        e.rotation_euler = Vector(facing).normalized().to_track_quat("Y", "Z").to_euler()
        for k, v in props.items():
            e[k] = v
        scene.collection.objects.link(e)
        return e

    out = []
    sp = plan.spawn
    yaw = math.radians(float(sp.get("yawDeg", 0)))
    out.append(empty("spawn", (sp["position"][0], -sp["position"][2], 0.0),
                     (-math.sin(yaw), math.cos(yaw), 0.0), {"role": "spawn", "eye_height_m": EYE_H}))
    posters = 0
    windows = 0
    for kind, ref, wall, hole in markers:
        A, B = plan.walls()[wall]
        a = Vector((A[0], A[1], 0.0))
        uh = (Vector((B[0], B[1], 0.0)) - a).normalized()
        n = plan.interior_normal(wall)
        u0, u1, z0, z1 = hole
        uc = (u0 + u1) / 2
        if kind == "door":
            d = ref
            out.append(empty("door_%s" % d["to"], tuple(a + uh * uc), n,
                             {"role": "doorway", "width_m": float(d["width"]), "height_m": float(d["height"]),
                              "to": d["to"], **({"closed": True} if d.get("closed") else {})}))
        elif kind == "poster":
            posters += 1
            name = "poster_wall" if plan.id == "hall" and posters == 1 else "poster_%d" % posters
            loc = a + uh * uc + Vector(n) * PANEL_DEPTH * -1.0 + Z * ((z0 + z1) / 2)
            out.append(empty(name, tuple(loc), n, {"role": "poster", "width_m": u1 - u0, "height_m": z1 - z0}))
        elif kind == "window":
            windows += 1
            out.append(empty("window_%d" % windows, tuple(a + uh * uc + Z * z0), n,
                             {"role": "window", "width_m": u1 - u0, "height_m": z1 - z0, "sill_m": z0}))
    return out


# --------------------------------------------------------------------------
# scene assembly
# --------------------------------------------------------------------------
def build_scene(mansion, textures, bake_res, margin, target_id):
    """Every room with a palace block, as one object each. Only the target
    gets UVs packed for its own lightmap image; the others get a throwaway
    uv2 and a dummy image so their materials are complete for the bounce."""
    scene = bpy.context.scene
    objects, plans, target = {}, {}, None
    dummy = bpy.data.images.new("dummy_lm", 64, 64, alpha=True, float_buffer=True)
    for room in mansion["rooms"]:
        if not room.get("palace"):
            continue
        plan = RoomPlan(room, mansion)
        b, markers = build_room(plan)
        ob = hb.to_object(b, plan.id)
        if plan.id == target_id:
            img = bpy.data.images.new("lightmap_%s" % plan.id, bake_res, bake_res, alpha=True, float_buffer=True)
            img.colorspace_settings.name = "Non-Color"
            uv0, uv2 = hb.make_uvs(ob, bake_res, margin)
            target = (plan, ob, img, uv2, markers)
        else:
            img = dummy
            uv0, uv2 = hb.make_uvs(ob, 256, 2)
        mats = make_room_materials(plan, img, uv2, textures)
        for m in mats:
            ob.data.materials.append(m)
        ob["orchard_role"] = plan.id
        ob["orchard_lightmap_uv"] = uv2
        objects[plan.id] = (ob, mats)
        plans[plan.id] = plan
        ob.select_set(False)
    return objects, plans, target


def render_still(scene, cam_pos, facing, out_path, samples, lens=22.0):
    cam_data = bpy.data.cameras.new("still_cam")
    cam_data.sensor_width = 36.0
    cam_data.lens = lens
    cam = bpy.data.objects.new("still_cam", cam_data)
    cam.location = cam_pos
    f = Vector(facing).normalized()
    cam.rotation_euler = f.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = out_path
    try:
        scene.view_settings.view_transform = "AgX"
    except Exception:
        pass
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    scene.collection.objects.unlink(cam)
    bpy.data.objects.remove(cam)
    return time.time() - t0


def preview_from_lightmap(scene, plan, ob, mats, png_path, scale, out_path, samples=48):
    """The hall's preview: the baked lightmap as emission times the albedo."""
    img = bpy.data.images.load(png_path)
    img.colorspace_settings.name = "sRGB"
    for idx, mat in enumerate(mats):
        nt = mat.node_tree
        base_tex = None
        for n in nt.nodes:
            if n.type == "TEX_IMAGE" and n.name != "lightmap_bake_target":
                base_tex = n
        look = look_for(plan, idx)
        base = LOOK[look][0]
        nodes_keep = [n for n in nt.nodes if n in (base_tex,)]
        for n in list(nt.nodes):
            if n not in nodes_keep and n.type not in ("MAPPING", "UVMAP"):
                nt.nodes.remove(n)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emi = nt.nodes.new("ShaderNodeEmission")
        mul = nt.nodes.new("ShaderNodeMixRGB")
        mul.blend_type = "MULTIPLY"
        mul.inputs["Fac"].default_value = 1.0
        mul.inputs["Color2"].default_value = (*base, 1.0)
        if base_tex is not None:
            nt.links.new(base_tex.outputs["Color"], mul.inputs["Color2"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.extension = "EXTEND"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "uv2"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], mul.inputs["Color1"])
        nt.links.new(mul.outputs["Color"], emi.inputs["Color"])
        nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
        emi.inputs["Strength"].default_value = scale
    sp = plan.spawn
    yaw = math.radians(float(sp.get("yawDeg", 0)))
    scene.cycles.max_bounces = 0
    return render_still(scene, (sp["position"][0], -sp["position"][2], EYE_H),
                        (-math.sin(yaw), math.cos(yaw), 0.0), out_path, samples)


def ktx_tiers(png, out_dir):
    toktx = shutil.which("toktx") or "/home/manuel/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin/toktx"
    if not os.path.exists(toktx):
        return {}
    out = {}
    for name, resize in (("lightmap.ktx2", None), ("lightmap-1024.ktx2", "1024x1024")):
        path = os.path.join(out_dir, name)
        cmd = [toktx, "--t2", "--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18",
               "--assign_oetf", "srgb", "--genmipmap"]
        if resize:
            cmd += ["--resize", resize]
        subprocess.run(cmd + [path, png], check=True)
        out[name] = os.path.getsize(path)
    return out


# --------------------------------------------------------------------------
def parse_args(argv):
    p = argparse.ArgumentParser(prog="palace.py")
    p.add_argument("--out", default="grove/public/assets/palace")
    p.add_argument("--room", default="")
    p.add_argument("--list", action="store_true")
    p.add_argument("--stills", action="store_true")
    p.add_argument("--still-rooms", default="hall,einstruct,spectre,gallery,orangery")
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--margin", type=int, default=8)
    p.add_argument("--no-bake", action="store_true")
    p.add_argument("--no-preview", dest="preview", action="store_false")
    p.add_argument("--adaptive-threshold", type=float, default=0.01)
    p.add_argument("--save-blend", default="")
    p.set_defaults(preview=True)
    return p.parse_args(argv)


class Args:
    pass


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse_args(argv)
    mansion = load_mansion()
    rooms = [r for r in mansion["rooms"] if r.get("palace")]
    if args.list:
        for r in rooms:
            print("%-14s %-11s %s" % (r["id"], r["palace"].get("type", "state-room"), r["bounds"]))
        return
    out_root = args.out if os.path.isabs(args.out) else os.path.join(REPO, args.out)
    os.makedirs(out_root, exist_ok=True)
    t_start = time.time()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    textures = make_textures(os.path.join(out_root, "textures"))
    hb.make_lighting(scene)
    bake_args = Args()
    bake_args.device = "CPU"
    bake_args.samples = args.samples
    bake_args.adaptive_threshold = args.adaptive_threshold
    bake_args.bake_type = "DIFFUSE"
    bake_args.margin = args.margin
    hb.configure_cycles(scene, bake_args)

    if args.stills:
        objects, plans, _ = build_scene(mansion, textures, 256, 2, None)
        img_dir = os.path.join(REPO, "docs", "img")
        os.makedirs(img_dir, exist_ok=True)
        for rid in args.still_rooms.split(","):
            plan = plans.get(rid)
            if plan is None:
                continue
            sp = plan.spawn
            yaw = math.radians(float(sp.get("yawDeg", 0)))
            out = os.path.join(img_dir, "palace-still-%s.png" % rid)
            t = render_still(scene, (sp["position"][0], -sp["position"][2], EYE_H),
                             (-math.sin(yaw), math.cos(yaw), 0.0), out, args.samples)
            log("still %s %.0f s -> %s" % (rid, t, out))
        log("STILLS OK")
        return

    if not args.room:
        raise SystemExit("--room <id>, --stills or --list")
    objects, plans, target = build_scene(mansion, textures, args.res, args.margin, args.room)
    if target is None:
        raise SystemExit("no palace block for room %r" % args.room)
    plan, ob, bake_img, uv2, markers = target
    out_dir = os.path.join(out_root, plan.id)
    os.makedirs(out_dir, exist_ok=True)
    area = sum(p.area for p in ob.data.polygons)
    log("%s: %d faces, %.0f m^2, %.1f px/m at %d^2" % (plan.id, len(ob.data.polygons), area,
                                                        math.sqrt(args.res ** 2 / area), args.res))
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))

    denoise_how, t_denoise, t_bake, noise_raw = "none", 0.0, 0.0, float("nan")
    if args.no_bake:
        buf = np.tile(np.array([0.5, 0.5, 0.5, 1.0], dtype=np.float32), args.res * args.res)
    else:
        log("baking %s: %d spp at %d^2" % (plan.id, args.samples, args.res))
        t_bake = hb.bake(scene, ob, bake_img, bake_args, uv2)
        buf = np.empty(args.res * args.res * 4, dtype=np.float32)
        bake_img.pixels.foreach_get(buf)
        noise_raw = hb.noise_metric(buf, args.res)
        log("bake %.1f s, noise %.5f" % (t_bake, noise_raw))
        t_dn = time.time()
        dn = hb.compositor_denoise(bake_img, args.res)
        dn.reshape(-1, 4)[:, 3] = buf.reshape(-1, 4)[:, 3]
        buf = dn
        t_denoise = time.time() - t_dn
        denoise_how = "OpenImageDenoise via the compositor Denoise node"
    png = os.path.join(out_dir, "lightmap.png")
    stats = hb.write_lightmap_png(buf, args.res, png)
    tiers = ktx_tiers(png, out_dir)
    log("lightmap: coverage %.1f%%, scale %.3f, tiers %s" % (100 * stats["coverage"], stats["scale"], tiers))

    marker_objs = add_room_markers(scene, plan, markers)
    glb = os.path.join(out_dir, "%s.glb" % plan.id)
    bpy.ops.object.select_all(action="DESELECT")
    hb.export_glb(glb, [ob] + marker_objs)
    record = {
        "schema": "orchard/room/1",
        "asset": plan.id,
        "generated_by": "grove/tools/palace/palace.py",
        "script_sha256": hb.sha256_file(os.path.abspath(__file__)),
        "blender": bpy.app.version_string,
        "git": hb.git_info(REPO),
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "look": "white, gold and marble (Naturhistorisches Museum), ruled 2026-09-12",
        "bake": {
            "engine": "cycles", "type": "DIFFUSE", "passes": ["direct", "indirect"], "colour_pass": False,
            "samples": args.samples, "resolution": args.res, "margin_px": args.margin, "uv_layer": uv2,
            "device": "CPU", "threads": os.cpu_count(), "denoise": denoise_how,
            "seconds_bake": round(t_bake, 2), "seconds_denoise": round(t_denoise, 2),
            "noise_metric": None if math.isnan(noise_raw) else round(noise_raw, 6),
            "skipped": bool(args.no_bake),
        },
        "lightmap": {
            "file": "lightmap.png", "ktx2": "lightmap.ktx2" if tiers else None,
            "ktx2_phone": "lightmap-1024.ktx2" if tiers else None,
            "scale": stats["scale"], "three_light_map_intensity": round(stats["scale"] * math.pi, 6),
            "coverage": stats["coverage"], "clipped_fraction": stats["clipped_fraction"],
            "binding": "texture.colorSpace = SRGBColorSpace, flipY = false, channel = 1, "
                       "material.lightMapIntensity = three_light_map_intensity",
        },
        "geometry": {
            "units": "metres", "type": plan.type, "bounds_gltf": plan.raw["bounds"],
            "height": plan.h, "faces": len(ob.data.polygons), "surface_area_m2": round(area, 1),
            "doorways": plan.doorways, "windows": plan.windows, "posters": plan.posters,
            "style": plan.style, "floor": plan.floor_look, "wall": plan.wall_look,
            "materials": ["%s_%s" % (plan.id, p) for p in PARTS],
            "albedo_linear": {p: list(LOOK[look_for(plan, i)][0]) for i, p in enumerate(PARTS)},
            "textures": {p: LOOK[look_for(plan, i)][2] for i, p in enumerate(PARTS)},
        },
        "lighting": {"sun_direction_blender": [round(c, 4) for c in Vector(hb.SUN_DIR).normalized()],
                     "sun_strength": hb.SUN_STRENGTH, "world": "Nishita sky", "world_strength": hb.SKY_STRENGTH,
                     "occluders": sorted(objects)},
        "files": {},
    }
    hb.patch_glb_extras(glb, {"orchard": {k: record[k] for k in ("asset", "schema", "script_sha256", "blender",
                                                                   "look", "bake", "lightmap", "geometry", "lighting")}})
    t_preview = 0.0
    if args.preview:
        t_preview = preview_from_lightmap(scene, plan, ob, objects[plan.id][1], png, stats["scale"],
                                          os.path.join(out_dir, "preview.png"))
        log("preview %.1f s" % t_preview)
    for name in ("%s.glb" % plan.id, "lightmap.png", "lightmap.ktx2", "lightmap-1024.ktx2", "preview.png"):
        p = os.path.join(out_dir, name)
        if os.path.exists(p):
            record["files"][name] = {"bytes": os.path.getsize(p), "sha256": hb.sha256_file(p)}
    record["bake"]["seconds_preview"] = round(t_preview, 2)
    record["bake"]["seconds_wall_clock"] = round(time.time() - t_start, 2)
    with open(os.path.join(out_dir, "%s.json" % plan.id), "w") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")
    for name, meta in record["files"].items():
        log("%-20s %8.1f kB" % (name, meta["bytes"] / 1024.0))
    log("BAKE OK room=%s samples=%d res=%d bake_s=%.1f total_s=%.1f"
        % (plan.id, args.samples, args.res, t_bake, time.time() - t_start))


if __name__ == "__main__":
    main()
