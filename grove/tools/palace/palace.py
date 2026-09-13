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
    "floor_marble":  ((0.62, 0.60, 0.56), 0.35, "floor_pattern", 6.0, 0.0),   # 0.18 read as wet; ruled 2026-09-13
    "floor_parquet": ((0.30, 0.20, 0.12), 0.45, "parquet", 2.4, 0.0),
    "floor_stone":   ((0.42, 0.41, 0.38), 0.70, "stone", 2.0, 0.0),
    "floor_dark":    ((0.045, 0.045, 0.05), 0.35, None, 1.0, 0.0),
    "wall_stucco":   ((0.66, 0.62, 0.55), 0.90, None, 1.0, 0.0),
    "wall_limewash": ((0.72, 0.70, 0.66), 0.92, None, 1.0, 0.0),
    "wall_dark":     ((0.02, 0.02, 0.025), 0.95, None, 1.0, 0.0),
    "ceiling":       ((0.74, 0.72, 0.68), 0.92, None, 1.0, 0.0),
    "ceiling_dark":  ((0.015, 0.015, 0.02), 0.95, None, 1.0, 0.0),
    # a grey-white stone a step below the cream wall, so pilasters and surrounds read in relief
    "marble_white":  ((0.46, 0.46, 0.45), 0.30, "marble_white", 1.5, 0.0),
    "marble_red":    ((0.30, 0.14, 0.11), 0.28, "marble_red", 1.5, 0.0),
    # matte gold, not metal: a diffuse bake of a metal is black and the client
    # has no environment map yet (PALACE.md 4.3, the reflection probe)
    "gilt":          ((0.85, 0.65, 0.30), 0.35, None, 1.0, 0.0),
    "panel":         ((0.78, 0.77, 0.74), 0.92, None, 1.0, 0.0),
    "door_leaf":     ((0.18, 0.11, 0.07), 0.55, "parquet", 1.2, 0.0),
    # the grounds
    "gravel":        ((0.34, 0.32, 0.29), 0.95, "gravel", 3.0, 0.0),
    "grass":         ((0.11, 0.17, 0.06), 0.95, "grass", 5.0, 0.0),
    "hedge":         ((0.06, 0.10, 0.05), 0.95, None, 1.0, 0.0),
    "water":         ((0.03, 0.06, 0.08), 0.05, None, 1.0, 0.0),
    "facade":        ((0.56, 0.54, 0.50), 0.90, None, 1.0, 0.0),
    "slate":         ((0.05, 0.05, 0.06), 0.80, None, 1.0, 0.0),
    "trunk":         ((0.13, 0.09, 0.06), 0.90, None, 1.0, 0.0),
    "leaf":          ((1.0, 1.0, 1.0), 0.90, "leaf", 1.0, 0.0),
}
CELL_PARTS = ["ground", "hedge", "water", "facade", "slate", "stone", "trunk", "leaf"]
C_GROUND, C_HEDGE, C_WATER, C_FACADE, C_SLATE, C_STONE, C_TRUNK, C_LEAF = range(8)

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
    "cell":       dict(h=8.0, wainscot=0.0,  cornice=(7.0, 7.2),   coffer=8.0, floor="grass", wall="facade"),
}

WAINSCOT_P, CORNICE_P = 0.06, 0.12
# Walls run this far past the floor and the ceiling planes: the long wall edge
# meets the ceiling's coffer vertices and the floor's corners in T-junctions,
# and the hairline cracks the rasterizer leaves there showed the sky dome
# and the void. Behind the crack there is now wall.
WALL_LAP = 0.05
# Each room's wall faces stand WALL_HALF inside its bounds, so two rooms
# sharing a plane have their faces 2 * WALL_HALF apart (a wall that thick)
# and every room's geometry lies within its own bounds: coplanar faces
# shadow each other black in the bake and z-fight in the client, and walls
# standing outside the bounds ran 2 * WALL_HALF into the neighbour along
# every shared plane (its side walls, floor, wainscot and cornice showed
# through). Door reveals run to the bounds plane and meet the neighbour's
# there. The body clamp (BODY_RADIUS 0.35) keeps the visitor off the face.
WALL_HALF = 0.10
DOOR_DEPTH, WIN_DEPTH = WALL_HALF, 0.40
FACADE_X = -7.5            # the garden front's outer face (blender x); interior faces are at -6.9
STEP_H = 0.02              # the facade's door thresholds stand this much above the terrace
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


def marble(px, rng, base, vein, vein_width=0.03, warp=2.2, veins=7.0, strength=0.55):
    """Real marble: a few thin, strongly warped veins over a soft mottle, not
    stripes. `strength` scales how far a vein departs from the base."""
    n = _fbm(px, rng, octaves=7, base=3)
    w = _fbm(px, rng, octaves=5, base=2)
    xs = np.linspace(0, 1, px, endpoint=False)
    phase = xs[:, None] * veins * 2 * math.pi + warp * 12.0 * (n - 0.5) + 9.0 * (w - 0.5)
    v = np.abs(np.sin(phase))
    v = np.exp(-((1 - v) / vein_width) ** 2) * strength
    fine = _fbm(px, rng, octaves=4, base=24)
    v = v * (0.6 + 0.8 * fine)                          # veins fade in and out along their length
    mottle = 0.92 + 0.16 * (n - 0.5)
    rgb = np.array(base, dtype=np.float32)[None, None, :] * mottle[..., None]
    rgb = rgb * (1 - v[..., None]) + np.array(vein, dtype=np.float32)[None, None, :] * v[..., None]
    return np.clip(rgb, 0, 1)


def floor_pattern(px, rng):
    """Light marble field, a dark-grey diagonal grid of inlay bands, dark
    border squares at the crossings: the museum's floor, simplified."""
    light = marble(px, rng, (0.66, 0.64, 0.60), (0.46, 0.45, 0.44), veins=5.0, strength=0.4)
    dark = marble(px, rng, (0.10, 0.10, 0.11), (0.24, 0.24, 0.25), veins=6.0, strength=0.5)
    xs = np.linspace(0, 1, px, endpoint=False)
    u, v = xs[:, None], xs[None, :]
    # a 6 m tile: 1.5 m diagonal lattice of 7 cm bands with a 24 cm square at each crossing
    band = 0.006
    d1 = np.abs(((u + v) % 0.25) - 0.125) < band
    d2 = np.abs(((u - v) % 0.25) - 0.125) < band
    sq = (np.abs((u % 0.25) - 0.125) < 0.02) & (np.abs((v % 0.25) - 0.125) < 0.02)
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


def gravel(px, rng):
    n = _fbm(px, rng, octaves=6, base=16)
    tone = 0.55 + 0.5 * (n - 0.5)
    return np.clip(np.stack([tone * 1.0, tone * 0.95, tone * 0.88], axis=-1), 0, 1)


def grass(px, rng):
    n = _fbm(px, rng, octaves=6, base=12)
    m = _fbm(px, rng, octaves=3, base=2)
    g = 0.75 + 0.5 * (n - 0.5) + 0.3 * (m - 0.5)
    return np.clip(np.stack([g * 0.42, g * 0.82, g * 0.26], axis=-1), 0, 1)


def leaf_card(px, rng):
    """A cherry crown on a card: clustered leaf blobs with alpha, dark red
    fruit dots. RGBA, alpha is what the card's alpha test cuts."""
    xs = np.linspace(-1, 1, px)
    u, v = xs[:, None], xs[None, :]
    alpha = np.zeros((px, px), dtype=np.float32)
    rgb = np.zeros((px, px, 3), dtype=np.float32)
    for _ in range(140):
        cx, cy = rng.normal(0, 0.42), rng.normal(0.05, 0.40)
        r = rng.uniform(0.10, 0.22)
        d = ((u - cx) ** 2 + (v - cy) ** 2) / (r * r)
        blob = np.exp(-d * 2.2)
        tone = rng.uniform(0.6, 1.1)
        col = np.array([0.10 * tone, 0.22 * tone, 0.06 * tone], dtype=np.float32)
        w = blob[..., None]
        rgb = rgb * (1 - w * 0.9) + col[None, None, :] * (w * 0.9)
        alpha = np.maximum(alpha, blob)
    n = _fbm(px, rng, octaves=5, base=10)
    alpha = np.clip(alpha * (0.7 + 0.8 * n), 0, 1)
    for _ in range(90):                                   # sour cherries: small, dark red
        cx, cy = rng.normal(0, 0.45), rng.normal(0.0, 0.42)
        d = ((u - cx) ** 2 + (v - cy) ** 2)
        dot = (d < 0.00012) & (alpha > 0.35)
        rgb[dot] = (0.40, 0.03, 0.04)
    return np.concatenate([np.clip(rgb, 0, 1), (alpha > 0.35).astype(np.float32)[..., None]], axis=-1)


def make_textures(out_dir, px=1024):
    """PNGs on disk, then Blender images. Deterministic (seed 7) so a rebake
    ships the same bytes."""
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(7)
    gens = {
        "marble_white": lambda: marble(px, rng, (0.50, 0.50, 0.49), (0.30, 0.30, 0.33), veins=6.0, strength=0.55),
        "marble_red": lambda: marble(px, rng, (0.30, 0.13, 0.10), (0.58, 0.48, 0.42), vein_width=0.025, veins=8.0, strength=0.45),
        "floor_pattern": lambda: floor_pattern(px, rng),
        "parquet": lambda: parquet(px, rng),
        "stone": lambda: stone(px, rng),
        "gravel": lambda: gravel(px, rng),
        "grass": lambda: grass(px, rng),
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
            img.pixels.foreach_set(np.ascontiguousarray(a, dtype=np.float32).reshape(-1))
            img.filepath_raw = path
            img.file_format = "JPEG"
            bpy.context.scene.render.image_settings.quality = 90
            img.save()
            bpy.data.images.remove(img)
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = "sRGB"
        images[name] = img
    leaf = os.path.join(out_dir, "leaf.png")
    if not os.path.exists(leaf):
        rgba = leaf_card(512, np.random.default_rng(3))
        rgba[..., :3] = hb.srgb_encode(rgba[..., :3])
        img = bpy.data.images.new("leaf", 512, 512, alpha=True)
        img.colorspace_settings.name = "sRGB"
        img.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).reshape(-1))
        img.filepath_raw = leaf
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)
    img = bpy.data.images.load(leaf)
    img.colorspace_settings.name = "sRGB"
    images["leaf"] = img
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
        # the bounds themselves, and the wall faces WALL_HALF inside them
        self.bx0, self.bx1 = float(gx0), float(gx1)
        self.by0, self.by1 = -float(gz1), -float(gz0)                          # blender y = -gltf z
        self.x0, self.x1 = self.bx0 + WALL_HALF, self.bx1 - WALL_HALF
        self.y0, self.y1 = self.by0 + WALL_HALF, self.by1 - WALL_HALF
        self.extends = {}                              # wall -> how far a reveal runs past the bounds
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
            return "-x" if abs(d["at"] - self.bx0) < 1e-6 else "+x"
        by = -d["at"]
        return "-y" if abs(by - self.by0) < 1e-6 else "+y"

    def u_of(self, wall, x=None, y=None):
        """Distance along the wall from its A corner, for a point given by the
        coordinate that varies along that wall."""
        A, B = self.walls()[wall]
        if wall in ("+x", "-x"):
            return (y - A[1]) if wall == "+x" else (A[1] - y)
        return (A[0] - x) if wall == "+y" else (x - A[0])

    def interior_normal(self, wall):
        return {"+x": (-1, 0, 0), "-x": (1, 0, 0), "+y": (0, -1, 0), "-y": (0, 1, 0)}[wall]

    def on_garden_front(self, wall):
        """This wall is the -x face at the facade's line: its reveals run to FACADE_X."""
        return wall == "-x" and abs(self.bx0 + 7.0) < 1e-6

    def neighbour_is_cell(self, d):
        other = next((r for r in self.mansion["rooms"] if r["id"] == d["to"]), None)
        return other is not None and (other.get("palace") or {}).get("type") == "cell"

    def door_depth(self, d, wall):
        """How far this room's reveal runs into an open doorway. A doorway's
        reveal belongs to ONE room, so no jamb is two half-jambs from two
        bakes meeting at the bounds plane: on the garden front the room runs
        it to the facade's outer face; between two rooms the one whose wall
        is the +x or +y face runs it the full two half-walls, and the other
        builds none. Doors into any other cell keep the half-wall."""
        if self.on_garden_front(wall) and self.neighbour_is_cell(d):
            return self.x0 - FACADE_X
        if self.neighbour_is_cell(d):
            return WALL_HALF
        return 2 * WALL_HALF if wall in ("+x", "+y") else 0.0

    def wall_hangings(self):
        """(wall, u0, u1) for every still or video the plan hangs on a wall,
        so pilasters keep clear of the picture."""
        out = []
        for h in self.raw.get("hangings", []):
            if h.get("kind") not in ("still", "video"):
                continue
            px, pz = float(h["position"][0]), float(h["position"][2])
            x, y = px, -pz
            dist = {"+x": abs(x - self.x1), "-x": abs(x - self.x0), "+y": abs(y - self.y1), "-y": abs(y - self.y0)}
            wall = min(dist, key=dist.get)
            if dist[wall] > 0.5:
                continue
            u = self.u_of(wall, y=y) if wall in ("+x", "-x") else self.u_of(wall, x=x)
            w = float(h.get("widthMeters", 6.0))
            out.append((wall, u - w / 2, u + w / 2))
        return out

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
            # on the garden front the reveal runs from the face to the facade's
            # outer plane exactly; anywhere else it is the window's own depth
            depth = (self.x0 - FACADE_X) if self.on_garden_front(wall) else float(w.get("reveal", WIN_DEPTH))
            for u in us:
                out.append((wall, (u - width / 2, u + width / 2, sill, head), depth))
        return out


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def build_wall(b, plan, wall, holes, cutouts=()):
    """A stepped wall: wainscot, field, cornice, frieze. Adapted from
    bake_hall.build_wall with the room's own heights. `cutouts` are holes
    that apply to the wainscot only: the strip and its ledge stop where a
    door surround stands, instead of running hidden through its box."""
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
        strips.append((-WALL_LAP, wh, WAINSCOT_P, P_WAINSCOT))
        strips.append((wh, c0, 0.0, P_WALL))
    else:
        strips.append((-WALL_LAP, c0, 0.0, P_WALL))
    strips.append((c0, c1, CORNICE_P, P_TRIM))
    strips.append((c1, H + WALL_LAP, 0.0, P_WALL))
    # A moulding that stands proud starts its own thickness past the corner
    # and runs to the far corner: the previous wall's moulding fills the
    # corner square, so no corner cap is needed (a cap was a tiny island
    # that baked black) and nothing overlaps.
    # every proud strip and ledge starts its own inset past the corner, so a
    # face that starts at 0 gets a vertex at each of those insets (welded, no T)
    def cuts_from(s):
        return [c - s for c in (WAINSCOT_P, CORNICE_P) if c - s > 1e-6]
    for z0, z1, inset, mat in strips:
        s = inset
        origin = a + uh * s + n * inset + Z * z0
        loc = []
        hs = list(holes) + [c for c in cutouts if z1 <= wh + EPS]
        for hu0, hu1, hz0, hz1 in hs:
            if hz1 <= z0 + EPS or hz0 >= z1 - EPS:
                continue
            loc.append((hu0 - s, max(hz0, z0) - z0, hu1 - s, min(hz1, z1) - z0))
        b.rect_holes(origin, uh * (L - s), Z * (z1 - z0), loc, mat, want=n, cuts=cuts_from(s))
    caps = []
    if wh > 0:
        caps.append((wh, WAINSCOT_P, 0.0, P_WAINSCOT))
    caps.append((c0, 0.0, CORNICE_P, P_GILT))      # the cornice's underside bead: gilt
    caps.append((c1, CORNICE_P, 0.0, P_TRIM))
    for z, i0, i1, mat in caps:
        s = max(i0, i1)
        up = Z if i1 < i0 else -Z
        origin = a + uh * s + n * min(i0, i1) + Z * z
        hs = list(holes) + ([c for c in cutouts] if z <= wh + EPS else [])
        loc = [(hu0 - s, 0.0, hu1 - s, abs(i1 - i0)) for hu0, hu1, hz0, hz1 in hs if hz0 < z - EPS < hz1 + EPS]
        b.rect_holes(origin, uh * (L - s), n * abs(i1 - i0), loc, mat, want=up, cuts=cuts_from(s))


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
        # the corner pilasters belong to the x walls alone: one on each wall
        # overlapped its neighbour by 2 cm, and the capitals by more
        us = [pitch * i for i in range(1, bays)] + ([0.45, L - 0.45] if wall in ("+x", "-x") else [])
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
    box_on_wall(b, plan, wall, u0 - SURR_W, u0, -WALL_LAP, z1 + SURR_H, SURR_P, P_TRIM)
    box_on_wall(b, plan, wall, u1, u1 + SURR_W, -WALL_LAP, z1 + SURR_H, SURR_P, P_TRIM)
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
    reveals = []          # (wall, hole, depth, sides, mat, kind)
    surrounds = []
    leaves = []
    markers = []

    cutouts_by_wall = {w: [] for w in holes_by_wall}
    for d in plan.doorways:
        wall, hole = plan.hole_for_door(d)
        closed = bool(d.get("closed"))
        holes_by_wall[wall].append(hole)
        if closed:
            # a door leaf set into the wall to the bounds plane, framed: the wall stays solid behind it
            leaves.append((wall, hole))
        else:
            depth = plan.door_depth(d, wall)
            if depth > 0:
                reveals.append((wall, hole, depth, "lrt", P_TRIM, "door"))
        surrounds.append((wall, hole))
        u0, u1 = hole[0], hole[1]
        cutouts_by_wall[wall].append((u0 - SURR_W, u1 + SURR_W, -WALL_LAP, plan.style["wainscot"]))
        markers.append(("door", d, wall, hole))
    for wall, hole, depth in plan.window_holes():
        holes_by_wall[wall].append(hole)
        # a window down to the floor is an opening you walk through: no bottom
        # reveal in the ground's plane, a threshold instead, like a door
        sides = "lrtb" if hole[2] > EPS else "lrt"
        reveals.append((wall, hole, depth, sides, P_TRIM, "window"))
        markers.append(("window", None, wall, hole))
    for k, p in enumerate(plan.posters):
        wall = p["wall"]
        u = plan.u_of(wall, y=-p["center"]) if wall in ("+x", "-x") else plan.u_of(wall, x=p["center"])
        hole = (u - p["width"] / 2, u + p["width"] / 2, p["z0"], p["z0"] + p["height"])
        holes_by_wall[wall].append(hole)
        reveals.append((wall, hole, PANEL_DEPTH, "lrtb", P_TRIM, "poster"))
        markers.append(("poster", k, wall, hole))
    for nch in plan.niches:
        wall = nch["wall"]
        for c in nch["centers"]:
            u = plan.u_of(wall, y=-c) if wall in ("+x", "-x") else plan.u_of(wall, x=c)
            hole = (u - nch["width"] / 2, u + nch["width"] / 2, 0.0, nch["height"])
            holes_by_wall[wall].append(hole)
            reveals.append((wall, hole, nch["depth"], "lrt", P_TRIM, "niche"))
            markers.append(("niche", nch, wall, hole))

    for wall in ("+x", "+y", "-x", "-y"):
        build_wall(b, plan, wall, holes_by_wall[wall], cutouts_by_wall[wall])

    for wall, hole, depth, sides, mat, kind in reveals:
        plan.extends[wall] = max(plan.extends.get(wall, 0.0), depth - WALL_HALF)
        A, B = plan.walls()[wall]
        o = Vector((A[0], A[1], 0.0))
        u = Vector((B[0] - A[0], B[1] - A[1], 0.0))
        v = Vector((0, 0, plan.h))
        u0, u1, z0, z1 = hole
        b.reveal(o, u, v, (u0, u1, z0, z1), depth, mat, inward=plan.interior_normal(wall), sides=sides)
        n = Vector(plan.interior_normal(wall))
        uh = u.normalized()
        back = o + uh * u0 + Z * z0 - n * depth
        if kind == "door" or (kind == "window" and z0 <= EPS):    # a doorway: threshold strip, open beyond
            b.quad(o + uh * u0, uh * (u1 - u0), -n * depth, P_TRIM, want=Z)
        elif kind == "niche":                                     # a niche: floor and back
            b.quad(o + uh * u0, uh * (u1 - u0), -n * depth, P_FLOOR, want=Z)
            b.quad(back, uh * (u1 - u0), Z * (z1 - z0), P_WALL, want=n)
        elif kind == "poster":                                    # a shallow recess: the panel face
            b.quad(back, uh * (u1 - u0), Z * (z1 - z0), P_PANEL, want=n)
        # a window stays an open aperture: the sun and sky come in through it
    for wall, hole in leaves:
        A, B = plan.walls()[wall]
        o = Vector((A[0], A[1], 0.0))
        u = Vector((B[0] - A[0], B[1] - A[1], 0.0))
        uh = u.normalized()
        n = Vector(plan.interior_normal(wall))
        u0, u1, z0, z1 = hole
        b.reveal(o, u, Vector((0, 0, plan.h)), hole, WALL_HALF, P_TRIM, inward=plan.interior_normal(wall), sides="lrt")
        b.quad(o + uh * u0 - n * WALL_HALF, uh * (u1 - u0), Z * (z1 - z0), P_LEAF, want=n)
    for wall, hole in surrounds:
        build_surround(b, plan, wall, hole)
    if plan.pilasters:
        avoid = {w: list(hs) for w, hs in holes_by_wall.items()}
        for wall, u0, u1 in plan.wall_hangings():
            avoid[wall].append((u0, u1, 0.0, plan.h))
        build_pilasters(b, plan, avoid)
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
            out.append(empty("door_%s" % d["to"], tuple(a + uh * uc - Vector(n) * WALL_HALF), n,
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
# the grounds: cells
# --------------------------------------------------------------------------
def tri(b, p0, p1, p2, mat):
    i = len(b.verts)
    b.verts += [Vector(p0), Vector(p1), Vector(p2)]
    b.faces.append((i, i + 1, i + 2))
    b.mats.append(mat)


def box(b, x0, x1, y0, y1, z0, z1, mat, top=True, bottom=False):
    """An axis-aligned box, outward faces only."""
    b.quad((x0, y0, z0), (0, y1 - y0, 0), (0, 0, z1 - z0), mat, want=(-1, 0, 0))
    b.quad((x1, y0, z0), (0, y1 - y0, 0), (0, 0, z1 - z0), mat, want=(1, 0, 0))
    b.quad((x0, y0, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), mat, want=(0, -1, 0))
    b.quad((x0, y1, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), mat, want=(0, 1, 0))
    if top:
        b.quad((x0, y0, z1), (x1 - x0, 0, 0), (0, y1 - y0, 0), mat, want=(0, 0, 1))
    if bottom:
        b.quad((x0, y0, z0), (x1 - x0, 0, 0), (0, y1 - y0, 0), mat, want=(0, 0, -1))


def garden_front(mansion):
    """The rooms on the garden front (interior x from -7) with the holes their
    -x walls carry, in blender y, for the facade."""
    out = []
    for room in mansion["rooms"]:
        pal = room.get("palace") or {}
        if pal.get("type") == "cell" or abs(room["bounds"]["min"][0] + 7) > 1e-6:
            continue
        plan = RoomPlan(room, mansion)
        holes = []
        for wall, hole, depth in plan.window_holes():
            if wall != "-x":
                continue
            u0, u1, z0, z1 = hole
            A, B = plan.walls()["-x"]
            holes.append((A[1] - u1, A[1] - u0, z0, z1, "window"))       # u runs -y from A
        for d in plan.doorways:
            if d["axis"] == "x" and abs(d["at"] + 7) < 1e-6:
                cy = -d["center"]
                holes.append((cy - d["width"] / 2, cy + d["width"] / 2, 0.0, float(d["height"]), "door"))
        out.append((plan, holes))
    return out


def facade_frame(b, x0, x1, y0, y1, z0, z1, mat, top=True, bottom=False):
    """A stone block standing proud of the facade: every face but the one
    against the wall (x1 is the facade's plane), so nothing hides behind it."""
    b.quad((x0, y0, z0), (0, y1 - y0, 0), (0, 0, z1 - z0), mat, want=(-1, 0, 0))
    b.quad((x0, y0, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), mat, want=(0, -1, 0))
    b.quad((x0, y1, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), mat, want=(0, 1, 0))
    if top:
        b.quad((x0, y0, z1), (x1 - x0, 0, 0), (0, y1 - y0, 0), mat, want=(0, 0, 1))
    if bottom:
        b.quad((x0, y0, z0), (x1 - x0, 0, 0), (0, y1 - y0, 0), mat, want=(0, 0, -1))


def build_facade(b, mansion):
    """The garden front seen from outside: one wall at FACADE_X with every
    window and door of the rooms behind it, a parapet, end returns and a
    flat slate roof over the whole plan. The openings' reveals belong to the
    rooms (they run from the interior face to FACADE_X); the facade cuts the
    holes and dresses them in stone."""
    fronts = garden_front(mansion)
    y_lo = min(p.by0 for p, _ in fronts)
    y_hi = max(p.by1 for p, _ in fronts)
    top = 8.2
    holes = [h for _, hs in fronts for h in hs]            # absolute blender y, z
    # the wall, facing -x, u runs +y from y_lo: holes in the wall's own coordinates
    b.rect_holes((FACADE_X, y_lo, 0.0), (0, y_hi - y_lo, 0), (0, 0, top),
                 [(y0 - y_lo, z0, y1 - y_lo, z1) for y0, y1, z0, z1, _ in holes], C_FACADE, want=(-1, 0, 0))
    # stone surrounds round every opening, standing proud of the limewash by
    # exactly the plinth band's depth, so the band ends flush against a jamb
    fw, fp = 0.28, 0.12
    for y0, y1, z0, z1, kind in holes:
        # jambs stand on the sill (a window) or the ground (a door) and stop
        # under the head, which alone owns the top: no face is doubled anywhere
        facade_frame(b, FACADE_X - fp, FACADE_X, y0 - fw, y0, z0, z1, C_STONE, top=False)
        facade_frame(b, FACADE_X - fp, FACADE_X, y1, y1 + fw, z0, z1, C_STONE, top=False)
        facade_frame(b, FACADE_X - fp, FACADE_X, y0 - fw, y1 + fw, z1, z1 + fw, C_STONE, top=True, bottom=True)
        if z0 > EPS:
            facade_frame(b, FACADE_X - 0.16, FACADE_X, y0 - fw, y1 + fw, z0 - 0.12, z0, C_STONE, top=True, bottom=True)
    # a plinth band with a string course on top, broken at every opening that
    # reaches below it (a door, a window to the floor): it used to run across
    # the doors as a 1.1 m parapet
    low = [(y0 - fw - y_lo, y1 + fw - y_lo) for y0, y1, z0, z1, _ in holes if z0 < 1.1 - EPS]
    b.rect_holes((FACADE_X - 0.12, y_lo, 1.1), (0, y_hi - y_lo, 0), (0.12, 0, 0),
                 [(a, 0.0, c, 0.12) for a, c in low], C_STONE, want=(0, 0, 1))
    b.rect_holes((FACADE_X - 0.12, y_lo, 0.0), (0, y_hi - y_lo, 0), (0, 0, 1.1),
                 [(a, 0.0, c, 1.1) for a, c in low], C_STONE, want=(-1, 0, 0))
    b.quad((FACADE_X - 0.15, y_lo, top - 0.8), (0, y_hi - y_lo, 0), (0, 0, 0.8), C_STONE, want=(-1, 0, 0))
    b.quad((FACADE_X - 0.15, y_lo, top - 0.8), (0, y_hi - y_lo, 0), (0.15, 0, 0), C_STONE, want=(0, 0, -1))
    b.quad((FACADE_X - 0.15, y_lo, top), (0, y_hi - y_lo, 0), (21.1 - FACADE_X + 0.15, 0, 0), C_SLATE, want=(0, 0, 1))
    # end returns and the court side, plain
    b.quad((FACADE_X, y_hi, 0.0), (21.1 - FACADE_X, 0, 0), (0, 0, top), C_FACADE, want=(0, 1, 0))
    b.quad((FACADE_X, y_lo, 0.0), (21.1 - FACADE_X, 0, 0), (0, 0, top), C_FACADE, want=(0, -1, 0))
    b.quad((21.1, y_lo, 0.0), (0, y_hi - y_lo, 0), (0, 0, top), C_FACADE, want=(1, 0, 0))


def build_balustrade(b, plan, spec):
    x = float(spec["x"])
    openings = [(-float(z1), -float(z0)) for z0, z1 in spec.get("openings", [])]   # gltf z -> blender y
    # the rail runs between the piers, not through them
    segs, cursor = [], plan.y0
    for o0, o1 in sorted(openings):
        if o0 - 0.35 > cursor:
            segs.append((cursor, o0 - 0.35))
        cursor = o1 + 0.35
    if cursor < plan.y1:
        segs.append((cursor, plan.y1))
    for y0, y1 in segs:
        box(b, x - 0.15, x + 0.15, y0, y1, 0.0, 0.25, C_STONE)                 # plinth
        box(b, x - 0.20, x + 0.20, y0, y1, 0.95, 1.10, C_STONE)                # coping
        n = max(1, int((y1 - y0) / 0.45))
        step = (y1 - y0) / n
        for i in range(n):
            yc = y0 + step * (i + 0.5)
            box(b, x - 0.07, x + 0.07, yc - 0.07, yc + 0.07, 0.25, 0.95, C_STONE)
    for o0, o1 in openings:                                                    # piers either side
        for yp in (o0 - 0.35, o1):
            box(b, x - 0.3, x + 0.3, yp, yp + 0.35, 0.0, 1.25, C_STONE)


def build_parterre(b, plan):
    """Four quarters of gravel edged with box hedge, an axial cross of paths,
    a round basin at the centre of the axis."""
    x0, x1, y0, y1 = plan.x0, plan.x1, plan.y0, plan.y1
    cx, cy = -35.0, 0.0
    # the paths are wide enough that a quarter's inner corner (path * sqrt 2
    # from the centre) clears the basin's rim by a hedge's width
    path = 4.5
    rim_r, water_r = 5.4, 5.0
    assert path * math.sqrt(2) > rim_r + 0.6
    for (qx0, qx1) in ((x0 + 2.0, cx - path), (cx + path, x1 - 2.0)):
        for (qy0, qy1) in ((y0 + 2.0, cy - path), (cy + path, y1 - 2.0)):
            h, w = 0.6, 0.6
            # a mitred ring: the long sides run the full length, the short
            # sides fill between them, so no two boxes share any volume
            for (a0, a1, b0, b1) in ((qx0, qx0 + w, qy0, qy1), (qx1 - w, qx1, qy0, qy1),
                                     (qx0 + w, qx1 - w, qy0, qy0 + w), (qx0 + w, qx1 - w, qy1 - w, qy1)):
                box(b, a0, a1, b0, b1, 0.0, h, C_HEDGE)
    n = 24
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p0 = (cx + rim_r * math.cos(a0), cy + rim_r * math.sin(a0))
        p1 = (cx + rim_r * math.cos(a1), cy + rim_r * math.sin(a1))
        q0 = (cx + (rim_r - 0.4) * math.cos(a0), cy + (rim_r - 0.4) * math.sin(a0))
        q1 = (cx + (rim_r - 0.4) * math.cos(a1), cy + (rim_r - 0.4) * math.sin(a1))
        b.quad((p0[0], p0[1], 0.0), (p1[0] - p0[0], p1[1] - p0[1], 0), (0, 0, 0.45), C_STONE,
               want=(math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0))
        b.quad((q0[0], q0[1], 0.0), (q1[0] - q0[0], q1[1] - q0[1], 0), (0, 0, 0.45), C_STONE,
               want=(-math.cos((a0 + a1) / 2), -math.sin((a0 + a1) / 2), 0))
        b.quad((q0[0], q0[1], 0.45), (q1[0] - q0[0], q1[1] - q0[1], 0), (p0[0] - q0[0], p0[1] - q0[1], 0), C_STONE, want=Z)
        tri(b, (cx, cy, 0.30), (q0[0], q0[1], 0.30), (q1[0], q1[1], 0.30), C_WATER)


def tree_positions(plan, seed, pitch=7.0, margin=6.0, jitter=1.2):
    rng = np.random.default_rng(seed)
    xs = np.arange(plan.x0 + margin, plan.x1 - margin, pitch)
    ys = np.arange(plan.y0 + margin, plan.y1 - margin, pitch)
    out = []
    for x in xs:
        for y in ys:
            out.append((float(x + rng.uniform(-jitter, jitter)), float(y + rng.uniform(-jitter, jitter)),
                        float(rng.uniform(0.85, 1.15)), float(rng.uniform(0, math.pi))))
    return out


def build_trees(positions):
    """Card trees: an 8-sided trunk and three crossed crown cards plus one
    flat card, each 4.6 m square, alpha-cut. Vertex colour carries a simple
    sun term so the cards read lit without any runtime light."""
    b = hb.Build()
    sun = -Vector(hb.SUN_DIR).normalized()
    shade = []
    def card(cx, cy, s, ang, zc, horizontal=False):
        if horizontal:
            o = Vector((cx - s / 2, cy - s / 2, zc))
            b.quad(o, (s, 0, 0), (0, s, 0), C_LEAF, want=(0, 0, 1))
            shade.extend([0.95] * 4)
            return
        dx, dy = math.cos(ang) * s / 2, math.sin(ang) * s / 2
        o = Vector((cx - dx, cy - dy, zc - s / 2))
        b.quad(o, (2 * dx, 2 * dy, 0), (0, 0, s), C_LEAF)
        n = Vector((-math.sin(ang), math.cos(ang), 0))
        lit = 0.55 + 0.45 * abs(n.dot(sun))
        shade.extend([lit] * 4)
    for x, y, scale, yaw in positions:
        h_trunk, r = 2.2 * scale, 0.14 * scale
        n = 8
        for i in range(n):
            a0, a1 = yaw + 2 * math.pi * i / n, yaw + 2 * math.pi * (i + 1) / n
            p0 = (x + r * math.cos(a0), y + r * math.sin(a0))
            p1 = (x + r * math.cos(a1), y + r * math.sin(a1))
            b.quad((p0[0], p0[1], 0.0), (p1[0] - p0[0], p1[1] - p0[1], 0), (0, 0, h_trunk + 0.6), C_TRUNK,
                   want=(math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0))
            shade.extend([0.7] * 4)
        s = 4.6 * scale
        zc = h_trunk + s * 0.42
        for k in range(3):
            card(x, y, s, yaw + k * math.pi / 3, zc)
    return b, shade


class CellPlan(RoomPlan):
    def __init__(self, room, mansion):
        super().__init__(room, mansion)
        self.ground = (room.get("palace") or {}).get("ground", "grass")
        self.spec = room.get("palace") or {}
        # cells have no walls: the bounds are the ground's edge
        self.x0, self.x1 = float(room["bounds"]["min"][0]), float(room["bounds"]["max"][0])
        self.y0, self.y1 = -float(room["bounds"]["max"][2]), -float(room["bounds"]["min"][2])


def build_cell(plan, mansion):
    b = hb.Build()
    # the ground ends where the facade stands: the strip inside it belongs to
    # the rooms' thresholds, which are in the same plane and would fight it
    x1 = min(plan.x1, FACADE_X) if plan.spec.get("facade") else plan.x1
    W, D = x1 - plan.x0, plan.y1 - plan.y0
    # the ground as a grid of 10 m quads so the lightmap packer gives it area
    nx, ny = max(1, int(W / 10)), max(1, int(D / 10))
    for i in range(nx):
        for j in range(ny):
            b.quad((plan.x0 + W * i / nx, plan.y0 + D * j / ny, 0.0), (W / nx, 0, 0), (0, D / ny, 0), C_GROUND, want=Z)
    if plan.spec.get("balustrade"):
        build_balustrade(b, plan, plan.spec["balustrade"])
    if plan.spec.get("facade"):
        build_facade(b, mansion)
    if plan.ground == "parterre":
        build_parterre(b, plan)
    trees = None
    if plan.spec.get("trees"):
        trees = build_trees(tree_positions(plan, int(plan.spec.get("seed", 1))))
    return b, trees


def cell_look(plan, part):
    return {C_GROUND: {"gravel": "gravel", "grass": "grass", "parterre": "gravel"}[plan.ground],
            C_HEDGE: "hedge", C_WATER: "water", C_FACADE: "facade", C_SLATE: "slate",
            C_STONE: "marble_white", C_TRUNK: "trunk", C_LEAF: "leaf"}[part]


def make_cell_materials(plan, bake_img, uv2_name, textures):
    mats = []
    for idx, part in enumerate(CELL_PARTS):
        look = cell_look(plan, idx)
        base, rough, tex, tile, metal = LOOK[look]
        mat = bpy.data.materials.new("%s_%s" % (plan.id, part))
        mat.use_nodes = True
        mat.use_backface_culling = idx != C_LEAF
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*base, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        if tex and tex in textures:
            ti = nt.nodes.new("ShaderNodeTexImage")
            ti.image = textures[tex]
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "UVMap"
            if idx == C_LEAF:
                nt.links.new(uvn.outputs["UV"], ti.inputs["Vector"])
                # alpha-cut leaves for the bake: dappled shade on the grass
                mix = nt.nodes.new("ShaderNodeMixShader")
                tr = nt.nodes.new("ShaderNodeBsdfTransparent")
                out = nt.nodes["Material Output"]
                nt.links.new(ti.outputs["Alpha"], mix.inputs["Fac"])
                nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
                nt.links.new(bsdf.outputs["BSDF"], mix.inputs[2])
                nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
                mat.blend_method = "CLIP"
                try:
                    mat.alpha_threshold = 0.5
                except Exception:
                    pass
            else:
                mp = nt.nodes.new("ShaderNodeMapping")
                mp.inputs["Scale"].default_value = (1.0 / tile, 1.0 / tile, 1.0)
                nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
                nt.links.new(mp.outputs["Vector"], ti.inputs["Vector"])
            nt.links.new(ti.outputs["Color"], bsdf.inputs["Base Color"])
        tgt = nt.nodes.new("ShaderNodeTexImage")
        tgt.name = tgt.label = "lightmap_bake_target"
        tgt.image = bake_img
        uvl = nt.nodes.new("ShaderNodeUVMap")
        uvl.uv_map = uv2_name
        nt.links.new(uvl.outputs["UV"], tgt.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        tgt.select = True
        nt.nodes.active = tgt
        mats.append(mat)
    return mats


def unlit_trees_for_export(tree_ob, textures):
    """Before export the trees become unlit: colour = leaf texture x vertex
    shade, alpha-clipped. The exporter writes KHR_materials_unlit for an
    emission-only tree, and three.js makes it a MeshBasicMaterial, which the
    client never binds a lightmap to."""
    for mat in tree_ob.data.materials:
        nt = mat.node_tree
        is_leaf = "_leaf" in mat.name
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emi = nt.nodes.new("ShaderNodeEmission")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "shade"
        # The exporter recognises "Emission (from an image) mixed with
        # Transparent by that image's alpha" as KHR_materials_unlit + MASK;
        # anything between the image and the emission breaks the match, so
        # the per-vertex shade goes out as COLOR_0 (export_vertex_color
        # ACTIVE) and three.js multiplies it in.
        nt.nodes.remove(vc)
        if is_leaf:
            ti = nt.nodes.new("ShaderNodeTexImage")
            ti.image = textures["leaf"]
            nt.links.new(ti.outputs["Color"], emi.inputs["Color"])
            mix = nt.nodes.new("ShaderNodeMixShader")
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            nt.links.new(ti.outputs["Alpha"], mix.inputs["Fac"])
            nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
            nt.links.new(emi.outputs["Emission"], mix.inputs[2])
            nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
            mat.blend_method = "CLIP"
        else:
            emi.inputs["Color"].default_value = (*LOOK["trunk"][0], 1.0)
            nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
        mat.use_backface_culling = False

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
    trees_of = {}
    for room in mansion["rooms"]:
        if not room.get("palace"):
            continue
        is_cell = room["palace"].get("type") == "cell"
        if is_cell:
            plan = CellPlan(room, mansion)
            b, trees = build_cell(plan, mansion)
            markers = []
            if trees is not None:
                tb, shade = trees
                tob = hb.to_object(tb, plan.id + "-trees")
                col = tob.data.color_attributes.new("shade", "FLOAT_COLOR", "POINT")
                # to_object welds vertices; the shade is per pre-weld quad corner, so
                # take the nearest by position (all corners of one card share a shade)
                import bmesh as _bm
                pre = np.array([tuple(v) for v in tb.verts])
                post = np.array([tuple(v.co) for v in tob.data.vertices])
                from mathutils.kdtree import KDTree
                kd = KDTree(len(pre))
                for i, v in enumerate(pre):
                    kd.insert(Vector(v), i)
                kd.balance()
                vals = np.ones((len(post), 4), dtype=np.float32)
                for i, v in enumerate(post):
                    _, idx, _ = kd.find(Vector(v))
                    vals[i, :3] = shade[idx]
                col.data.foreach_set("color", vals.reshape(-1))
                me = tob.data
                while me.uv_layers:
                    me.uv_layers.remove(me.uv_layers[0])
                me.uv_layers.new(name="UVMap")
                # leaf cards: unit square UVs; trunk: anything
                uv = me.uv_layers["UVMap"].data
                for poly in me.polygons:
                    if poly.material_index == C_LEAF:
                        for k, li in enumerate(poly.loop_indices):
                            uv[li].uv = [(0, 0), (1, 0), (1, 1), (0, 1)][k % 4]
                trees_of[plan.id] = tob
        else:
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
        if is_cell:
            mats = make_cell_materials(plan, img, uv2, textures)
            tob = trees_of.get(plan.id)
            if tob is not None:
                for part in ("trunk", "leaf"):
                    tob.data.materials.append(mats[CELL_PARTS.index(part)].copy())
                for i, m in enumerate(tob.data.materials):
                    m.name = "%s_%s" % (plan.id, ("trunk", "leaf")[i])
                # the tree object's material slots are trunk (0) and leaf (1)
                for poly in tob.data.polygons:
                    poly.material_index = 0 if poly.material_index == C_TRUNK else 1
        else:
            mats = make_room_materials(plan, img, uv2, textures)
        for m in mats:
            ob.data.materials.append(m)
        ob["orchard_role"] = plan.id
        ob["orchard_lightmap_uv"] = uv2
        objects[plan.id] = (ob, mats)
        plans[plan.id] = plan
        ob.select_set(False)
    return objects, plans, target, trees_of


FILL_COLOUR = (1.0, 0.91, 0.80)        # warm, a chandelier's; (1.0, 0.86, 0.68) turned the window heads gold
AO_STRENGTH, AO_DISTANCE, AO_SAMPLES = 0.4, 1.0, 128   # "a bit of ambient occlusion", ruled 2026-09-13
FILL_W = 400.0                         # per lamp; probe 2026-09-13: 300 lifts the cornice underside from 0.19 to 0.30 of the floor, 900 flattens the sun


def add_fill_lights(scene, plans, power):
    """Interior fill: warm point lights along each interior room's long
    axis, one per 8 m, hung at 0.55 of the height. The sun and sky alone
    leave every underside (the cornice bead, the capitals) at a fifth of
    the floor's irradiance, which AgX crushes to black; a palace hall has
    its chandeliers. Returns the light objects."""
    out = []
    if power <= 0:
        return out
    for plan in plans.values():
        if isinstance(plan, CellPlan):
            continue
        W, D = plan.x1 - plan.x0, plan.y1 - plan.y0
        along_x = W >= D
        L = max(W, D)
        n = max(1, int(round(L / 8.0)))
        cx, cy = (plan.x0 + plan.x1) / 2, (plan.y0 + plan.y1) / 2
        z = 0.55 * plan.h
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            loc = (cx + t * L, cy, z) if along_x else (cx, cy + t * L, z)
            ld = bpy.data.lights.new("fill_%s_%d" % (plan.id, i), type="POINT")
            ld.energy = float(power)
            ld.color = FILL_COLOUR
            ld.shadow_soft_size = 0.5
            ob = bpy.data.objects.new(ld.name, ld)
            ob.location = loc
            scene.collection.objects.link(ob)
            out.append(ob)
    return out


def render_still(scene, cam_pos, facing, out_path, samples, lens=22.0, exposure=0.0):
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
    scene.view_settings.exposure = exposure
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
        look = cell_look(plan, idx) if isinstance(plan, CellPlan) else look_for(plan, idx)
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


def export_glb(path, objects, vertex_color=False):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_image_format="AUTO", export_draco_mesh_compression_enable=False, export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False, export_skins=False,
        export_morph=False, export_unused_images=False, export_unused_textures=False,
        export_vertex_color="ACTIVE" if vertex_color else "MATERIAL",
    )


def patch_glb_json(path, fn):
    """Rewrite the glb's JSON chunk through fn(doc); the binary chunk rides along."""
    import struct
    with open(path, "rb") as fh:
        blob = fh.read()
    magic, version, total = struct.unpack("<III", blob[:12])
    off, chunks = 12, []
    while off < total:
        clen, ctype = struct.unpack("<II", blob[off:off + 8])
        chunks.append((ctype, blob[off + 8:off + 8 + clen]))
        off += 8 + clen
    doc = json.loads(chunks[0][1].decode("utf-8"))
    fn(doc)
    js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js
    for ctype, data in chunks[1:]:
        pad = b"\x00" * ((4 - len(data) % 4) % 4)
        body += struct.pack("<II", len(data) + len(pad), ctype) + data + pad
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", magic, version, 12 + len(body)) + body)


def unlit_tree_materials(doc):
    """Blender 4.2's exporter writes an emission-only material as black PBR
    with an emissive texture. The client wants the trees unlit and alpha-cut:
    move the emissive into the base colour, add KHR_materials_unlit, MASK."""
    used = set(doc.get("extensionsUsed", []))
    for m in doc.get("materials", []):
        name = m.get("name", "")
        if "_leaf" not in name and "_trunk" not in name:
            continue
        pbr = m.setdefault("pbrMetallicRoughness", {})
        if "emissiveTexture" in m:
            pbr["baseColorTexture"] = m.pop("emissiveTexture")
            pbr["baseColorFactor"] = [1.0, 1.0, 1.0, 1.0]
        else:
            ef = m.pop("emissiveFactor", [1, 1, 1])
            pbr["baseColorFactor"] = [float(ef[0]), float(ef[1]), float(ef[2]), 1.0]
        m.pop("emissiveFactor", None)
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0
        m.setdefault("extensions", {})["KHR_materials_unlit"] = {}
        m["doubleSided"] = True
        if "_leaf" in name:
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
        used.add("KHR_materials_unlit")
    doc["extensionsUsed"] = sorted(used)


# The full tier ships to desktops and headsets on room entry; 4096 px bakes
# (gallery, orangery) came out at 10 MB each as UASTC, so the tier is capped
# and the bake's extra resolution serves the PNG and the denoiser only.
FULL_TIER_PX = 2048


def ktx_tiers(png, out_dir, res=None):
    toktx = shutil.which("toktx") or "/home/manuel/tools/ktx/KTX-Software-4.4.2-Linux-x86_64/bin/toktx"
    if not os.path.exists(toktx):
        return {}
    out = {}
    full = "%dx%d" % (FULL_TIER_PX, FULL_TIER_PX) if res and res > FULL_TIER_PX else None
    for name, resize in (("lightmap.ktx2", full), ("lightmap-1024.ktx2", "1024x1024")):
        path = os.path.join(out_dir, name)
        cmd = [toktx, "--t2", "--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18",
               "--assign_oetf", "srgb", "--genmipmap"]
        if resize:
            cmd += ["--resize", resize]
        subprocess.run(cmd + [path, png], check=True)
        out[name] = os.path.getsize(path)
    return out


# --------------------------------------------------------------------------
def check_bounds(objects, plans):
    """Every interior room's vertices lie within its bounds (plus what its
    reveals run past them) and under its ceiling: nothing of one room can
    then show inside another. Cells are the grounds and carry the facade,
    the roof and the returns, which reach over the rooms by design."""
    bad = 0
    for rid, (ob, _) in objects.items():
        plan = plans[rid]
        if isinstance(plan, CellPlan):
            continue
        lo = (plan.bx0 - plan.extends.get("-x", 0.0), plan.by0 - plan.extends.get("-y", 0.0), -WALL_LAP - EPS)
        hi = (plan.bx1 + plan.extends.get("+x", 0.0), plan.by1 + plan.extends.get("+y", 0.0), plan.h + COFFER_D + WALL_LAP + EPS)
        co = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
        ob.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        out = np.zeros(len(co), dtype=bool)
        for k in range(3):
            out |= (co[:, k] < lo[k] - 1e-4) | (co[:, k] > hi[k] + 1e-4)
        n = int(out.sum())
        if n:
            bad += n
            worst = co[out]
            log("%s: %d vertices outside %s..%s, e.g. %s" % (rid, n, lo, hi, worst[:3].tolist()))
        else:
            log("%s: %d vertices, all within bounds" % (rid, len(co)))
    # and no two rooms' bounds overlap
    ids = list(plans)
    for i, a in enumerate(ids):
        for bname in ids[i + 1:]:
            pa, pb = plans[a], plans[bname]
            if isinstance(pa, CellPlan) or isinstance(pb, CellPlan):
                continue
            if pa.bx0 < pb.bx1 - 1e-6 and pb.bx0 < pa.bx1 - 1e-6 and pa.by0 < pb.by1 - 1e-6 and pb.by0 < pa.by1 - 1e-6:
                bad += 1
                log("%s and %s: bounds overlap" % (a, bname))
    return bad



# --------------------------------------------------------------------------
# face collisions: found before any bake, never in a screenshot
# --------------------------------------------------------------------------
# A pair of faces in one plane facing the same way and overlapping z-fights,
# and a bake paints one of them black. A face whose edge passes through the
# interior of another means two bodies share volume (the hedge corners, a
# jamb run into a sill). Both are found on the raw quads of every room in
# world space, which is where a room's faces meet its neighbour's.
FACE_TOL_PLANE = 1e-4     # metres: within this of a plane is on it
FACE_TOL_AREA = 1e-3      # m^2: smaller overlaps are numerical dust
FACE_TOL_INSIDE = 1e-3    # metres: a crossing this close to an edge is a touch
# pierces that are the design: the walls lap the floor and the ceiling by
# WALL_LAP so no seam shows, and a card tree's crown crosses its trunk
FACE_LAPS = ({"floor", "wainscot"}, {"floor", "wall"}, {"floor", "trim"}, {"wall", "ceiling"},
             {"trim", "ceiling"}, {"wainscot", "wall"}, {"trunk", "leaf"})


def _face_list(room_id, tag, b, mat_names):
    out = []
    for face, mat in zip(b.faces, b.mats):
        vs = [Vector(b.verts[i]) for i in face]
        n = (vs[1] - vs[0]).cross(vs[-1] - vs[0])
        if n.length < 1e-9:
            n = (vs[2] - vs[0]).cross(vs[-1] - vs[1])
        if n.length < 1e-9:
            continue
        n.normalize()
        lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
        out.append((room_id, tag, mat_names[mat], vs, n, n.dot(vs[0]), (lo, hi)))
    return out


def _basis(n):
    a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
    u = a.cross(n).normalized()
    return u, n.cross(u)


def _to2d(vs, o, u, v):
    return [((p - o).dot(u), (p - o).dot(v)) for p in vs]


def _ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a >= 0 else poly[::-1]


def _area(poly):
    return 0.5 * abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                         for i in range(len(poly))))


def _clip(subject, clipper):
    """Sutherland-Hodgman against a convex counter-clockwise clipper."""
    out = subject
    for i in range(len(clipper)):
        if not out:
            break
        ax, ay = clipper[i]
        bx, by = clipper[(i + 1) % len(clipper)]
        inp, out = out, []

        def inside(p):
            return (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) >= -1e-9

        def inter(p, q):
            den = (p[0] - q[0]) * (ay - by) - (p[1] - q[1]) * (ax - bx)
            if abs(den) < 1e-12:
                return q
            t = ((p[0] - ax) * (ay - by) - (p[1] - ay) * (ax - bx)) / den
            return (p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))
        for j in range(len(inp)):
            cur, prev = inp[j], inp[j - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
    return out


def _strictly_inside(p, poly):
    poly = _ccw(poly)
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        L = math.hypot(bx - ax, by - ay)
        if L < 1e-9:
            continue
        if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)) / L < FACE_TOL_INSIDE:
            return False
    return True


def _pierce(qa, qb):
    """A point where an edge of qa crosses the interior of qb, or None."""
    va, vb, nb, db = qa[3], qb[3], qb[4], qb[5]
    u, v = _basis(nb)
    poly = _to2d(vb, vb[0], u, v)
    for i in range(len(va)):
        p, q = va[i], va[(i + 1) % len(va)]
        sp, sq = nb.dot(p) - db, nb.dot(q) - db
        if sp * sq >= 0 or abs(sp) < 1e-5 or abs(sq) < 1e-5:     # an endpoint on the plane is a touch (float32 vectors)
            continue
        x = p + (q - p) * (sp / (sp - sq))
        if _strictly_inside(((x - vb[0]).dot(u), (x - vb[0]).dot(v)), poly):
            return x
    return None


def check_faces(mansion, only=()):
    """Builds every room's raw quads and reports the face pairs that would
    render wrongly; returns the number of defects. Also checks that the
    facade's wall leaves every garden-front opening clear."""
    quads = []
    for room in mansion["rooms"]:
        if not room.get("palace") or (only and room["id"] not in only):
            continue
        if room["palace"].get("type") == "cell":
            plan = CellPlan(room, mansion)
            b, trees = build_cell(plan, mansion)
            quads += _face_list(plan.id, "cell", b, CELL_PARTS)
            if trees is not None:
                quads += _face_list(plan.id, "trees", trees[0], CELL_PARTS)
        else:
            plan = RoomPlan(room, mansion)
            b, _ = build_room(plan)
            quads += _face_list(plan.id, "room", b, PARTS)
    cell = 2.0
    grid = {}
    for idx, q in enumerate(quads):
        lo, hi = q[6]
        for ix in range(int(math.floor(lo.x / cell)), int(math.floor(hi.x / cell)) + 1):
            for iy in range(int(math.floor(lo.y / cell)), int(math.floor(hi.y / cell)) + 1):
                for iz in range(int(math.floor(lo.z / cell)), int(math.floor(hi.z / cell)) + 1):
                    grid.setdefault((ix, iy, iz), []).append(idx)
    pairs = set()
    for members in grid.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = members[i], members[j]
                pairs.add((a, b) if a < b else (b, a))
    found = {}
    for a, b in pairs:
        qa, qb = quads[a], quads[b]
        (alo, ahi), (blo, bhi) = qa[6], qb[6]
        if not all(alo[k] <= bhi[k] + FACE_TOL_PLANE and blo[k] <= ahi[k] + FACE_TOL_PLANE for k in range(3)):
            continue
        na, nb = qa[4], qb[4]
        dot = na.dot(nb)
        if abs(dot) > 1 - 1e-6:
            if not all(abs(na.dot(p) - qa[5]) < FACE_TOL_PLANE for p in qb[3]):
                continue
            if dot < 0:
                continue                       # back to back: single-sided faces, hidden, harmless
            u, v = _basis(na)
            ov = _area(_clip(_ccw(_to2d(qa[3], qa[3][0], u, v)), _ccw(_to2d(qb[3], qa[3][0], u, v))))
            if ov > FACE_TOL_AREA:
                c = sum(qa[3], Vector()) / len(qa[3])
                found.setdefault(("overlap", qa[0], qb[0], qa[2], qb[2]), []).append((ov, c))
            continue
        if qa[1] == "trees" and qb[1] == "trees":
            continue
        if {qa[2], qb[2]} in FACE_LAPS:
            continue
        x = _pierce(qa, qb) or _pierce(qb, qa)
        if x is not None:
            found.setdefault(("pierce", qa[0], qb[0], qa[2], qb[2]), []).append((0.0, x))
    # the facade must not stand in front of any opening of the rooms behind it
    # anything of the cell facing the garden at or outside the facade's plane
    facade = [q for q in quads if q[1] == "cell" and abs(q[4].x) > 0.99
              and FACADE_X - 0.5 <= q[3][0].x <= FACADE_X + FACE_TOL_PLANE]
    for plan, holes in garden_front(mansion):
        if only and plan.id not in only:
            continue
        for y0, y1, z0, z1, kind in holes:
            for q in facade:
                lo, hi = q[6]
                oy = min(y1, hi.y) - max(y0, lo.y)
                oz = min(z1, hi.z) - max(z0, lo.z)
                if oy > 1e-3 and oz > 1e-3 and oy * oz > FACE_TOL_AREA:
                    found.setdefault(("blocked", "terrace", plan.id, q[2], kind), []).append(
                        (oy * oz, Vector((lo.x, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))))
    bad = 0
    for key in sorted(found, key=lambda k: (k[0], k[1], k[2])):
        kind, ra, rb, ma, mb = key
        hits = found[key]
        bad += len(hits)
        log("face %-8s %-14s %-14s %-9s %-9s n=%-4d area=%.3f m2  e.g. (%.2f, %.2f, %.2f)"
            % (kind, ra, rb, ma, mb, len(hits), sum(h[0] for h in hits), *hits[0][1]))
    log("faces: %d quads, %d defects" % (len(quads), bad))
    return bad


def lightmap_stats(ob, uv2_name, buf, res, hi, mat_names):
    """Mean and 10th percentile of the baked value at each face's centre,
    per material, as fractions of the lightmap's white point: an island that
    comes out near black is enclosed geometry or a lamp that does not reach."""
    me = ob.data
    uvl = me.uv_layers[uv2_name].data
    lum = (buf.reshape(res, res, 4)[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)) / max(hi, 1e-6)
    per = {}
    for poly in me.polygons:
        u = v = 0.0
        for li in poly.loop_indices:
            u += uvl[li].uv[0]
            v += uvl[li].uv[1]
        k = len(poly.loop_indices)
        col = min(res - 1, max(0, int(u / k * res)))
        row = min(res - 1, max(0, int(v / k * res)))
        per.setdefault(poly.material_index, []).append(float(lum[row, col]))
    out = {}
    for mi, vals in sorted(per.items()):
        a = np.array(vals)
        name = mat_names[mi] if mi < len(mat_names) else str(mi)
        out[name] = {"faces": len(vals), "mean": round(float(a.mean()), 4),
                     "p10": round(float(np.percentile(a, 10)), 4), "p90": round(float(np.percentile(a, 90)), 4)}
        flag = "  DARK" if out[name]["p10"] < 0.03 else ""
        log("lmstats %-9s n=%-5d mean %.3f  p10 %.3f  p90 %.3f%s" % (name, len(vals), a.mean(),
                                                                       np.percentile(a, 10), np.percentile(a, 90), flag))
    return out


def bake_ao(scene, ob, mats, uv2_name, res, margin, samples, distance, hidden):
    """Cycles' AO pass to its own image on the same UVs: a fraction 0..1 per
    texel. `hidden` objects (the card trees) do not occlude."""
    img = bpy.data.images.new("ao_%s" % ob.name, res, res, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    for m in mats:
        m.node_tree.nodes["lightmap_bake_target"].image = img
    was = [(o, o.hide_render) for o in hidden]
    for o, _ in was:
        o.hide_render = True
    old_samples, old_type = scene.cycles.samples, scene.cycles.bake_type
    scene.cycles.samples = samples
    scene.cycles.bake_type = "AO"
    scene.world.light_settings.distance = distance
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    t0 = time.time()
    bpy.ops.object.bake(type="AO", uv_layer=uv2_name, margin=margin, margin_type="ADJACENT_FACES", use_clear=True)
    dn = hb.compositor_denoise(img, res).reshape(-1, 4)
    ao = np.clip(dn[:, 0], 0.0, 1.0)
    scene.cycles.samples, scene.cycles.bake_type = old_samples, old_type
    for o, h in was:
        o.hide_render = h
    return ao, time.time() - t0


def recompose_ao(out_root, room, strength):
    """A new AO strength without a bake: lightmap.png is diffuse * mix_old
    (then normalised and sRGB-encoded); divide the old mix out in linear,
    multiply the new one in, re-encode, re-tier, and update the record."""
    out_dir = os.path.join(out_root, room)
    rec_path = os.path.join(out_dir, "%s.json" % room)
    with open(rec_path) as fh:
        rec = json.load(fh)
    ao_rec = rec["lightmap"].get("ao")
    if not ao_rec:
        raise SystemExit("%s: no AO in its record; bake it first" % room)
    res = rec["bake"]["resolution"]
    lm = bpy.data.images.load(os.path.join(out_dir, "lightmap.png"))
    lm.colorspace_settings.name = "Non-Color"
    ao_img = bpy.data.images.load(os.path.join(out_dir, "ao.png"))
    ao_img.colorspace_settings.name = "Non-Color"
    buf = np.empty(res * res * 4, dtype=np.float32)
    lm.pixels.foreach_get(buf)
    aob = np.empty(res * res * 4, dtype=np.float32)
    ao_img.pixels.foreach_get(aob)
    ao = aob.reshape(-1, 4)[:, 0]
    rgba = buf.reshape(-1, 4)
    enc = rgba[:, :3]
    lin = np.where(enc <= 0.04045, enc / 12.92, np.power((enc + 0.055) / 1.055, 2.4))
    s_old = float(ao_rec["strength"])
    old_mix = (1.0 - s_old) + s_old * ao
    new_mix = (1.0 - strength) + strength * ao
    # the old normalisation stays (scale in the record is unchanged): the
    # texel is diffuse * mix / white, so only the mix ratio moves
    ratio = np.where(old_mix > 1e-4, new_mix / np.maximum(old_mix, 1e-4), 1.0)
    out = np.clip(lin * ratio[:, None], 0.0, 1.0)
    rgba[:, :3] = hb.srgb_encode(out)
    img = bpy.data.images.new("recomposed", res, res, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.reshape(-1))
    png = os.path.join(out_dir, "lightmap.png")
    img.filepath_raw = png
    img.file_format = "PNG"
    img.save()
    tiers = ktx_tiers(png, out_dir, res)
    ao_rec["strength"] = strength
    ao_rec["recomposed_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for name in ("lightmap.png", "lightmap.ktx2", "lightmap-1024.ktx2"):
        p = os.path.join(out_dir, name)
        rec["files"][name] = {"bytes": os.path.getsize(p), "sha256": hb.sha256_file(p)}
    with open(rec_path, "w") as fh:
        json.dump(rec, fh, indent=2)
        fh.write("\n")
    log("recomposed %s at AO %.2f (was %.2f): tiers %s" % (room, strength, s_old, tiers))


def write_grey_png(values, res, path):
    img = bpy.data.images.new("grey_out", res, res, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    px = np.empty((res * res, 4), dtype=np.float32)
    px[:, 0] = px[:, 1] = px[:, 2] = values
    px[:, 3] = 1.0
    img.pixels.foreach_set(px.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def parse_args(argv):
    p = argparse.ArgumentParser(prog="palace.py")
    p.add_argument("--out", default="grove/public/assets/palace")
    p.add_argument("--room", default="")
    p.add_argument("--list", action="store_true")
    p.add_argument("--check", action="store_true",
                   help="build every room, verify bounds and face collisions; bake_all.sh refuses to queue without CHECK OK")
    p.add_argument("--ao-strength", type=float, default=AO_STRENGTH, help="ambient occlusion multiplied into the lightmap; 0 for none")
    p.add_argument("--ao-distance", type=float, default=AO_DISTANCE)
    p.add_argument("--ao-samples", type=int, default=AO_SAMPLES)
    p.add_argument("--recompose", action="store_true",
                   help="with --room and --ao-strength: rewrite the room's lightmap at that strength, no bake")
    p.add_argument("--stills", action="store_true")
    p.add_argument("--still-rooms", default="hall,einstruct,spectre,gallery,orangery")
    p.add_argument("--still-yaw", type=float, default=None, help="override the spawn yaw for every still")
    p.add_argument("--still-suffix", default="")
    p.add_argument("--samples", type=int, default=512)
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--margin", type=int, default=8)
    p.add_argument("--no-bake", action="store_true")
    p.add_argument("--fill", type=float, default=FILL_W, help="interior fill light power per lamp, W; 0 for none")
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
    if args.recompose:
        for room in [r for r in args.room.split(",") if r]:
            recompose_ao(out_root, room, args.ao_strength)
        log("RECOMPOSE OK")
        return

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

    if args.check:
        objects, plans, _, _ = build_scene(mansion, textures, 256, 2, None)
        bad = check_bounds(objects, plans)
        bad += check_faces(mansion, only=[r for r in args.room.split(",") if r])
        log("CHECK %s" % ("OK" if not bad else "FAILED: %d" % bad))
        return

    if args.stills:
        objects, plans, _, _ = build_scene(mansion, textures, 256, 2, None)
        add_fill_lights(scene, plans, args.fill)
        img_dir = os.path.join(REPO, "docs", "img")
        os.makedirs(img_dir, exist_ok=True)
        for rid in args.still_rooms.split(","):
            plan = plans.get(rid)
            if plan is None:
                continue
            sp = plan.spawn
            yaw = math.radians(float(sp.get("yawDeg", 0)) if args.still_yaw is None else args.still_yaw)
            out = os.path.join(img_dir, "palace-still-%s%s.png" % (rid, args.still_suffix))
            t = render_still(scene, (sp["position"][0], -sp["position"][2], EYE_H),
                             (-math.sin(yaw), math.cos(yaw), 0.0), out, args.samples,
                             exposure=-1.6 if isinstance(plan, CellPlan) else 0.0)
            log("still %s %.0f s -> %s" % (rid, t, out))
        log("STILLS OK")
        return

    if not args.room:
        raise SystemExit("--room <id>, --stills or --list")
    objects, plans, target, trees_of = build_scene(mansion, textures, args.res, args.margin, args.room)
    fills = add_fill_lights(scene, plans, args.fill)
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
    ao_record = None
    if args.ao_strength > 0 and not args.no_bake:
        # a bit of ambient occlusion: the diffuse bake already carries the
        # physics of bounced light; this is the contact darkening on top of
        # the fill's even light, multiplied in at a ruled strength
        ao, t_ao = bake_ao(scene, ob, objects[plan.id][1], uv2, args.res, args.margin, args.ao_samples,
                           args.ao_distance, list(trees_of.values()))
        mix = (1.0 - args.ao_strength) + args.ao_strength * ao
        buf.reshape(-1, 4)[:, :3] *= mix[:, None]
        write_grey_png(ao, args.res, os.path.join(out_dir, "ao.png"))
        ao_record = {"strength": args.ao_strength, "distance_m": args.ao_distance, "samples": args.ao_samples,
                     "file": "ao.png", "seconds": round(t_ao, 2), "mean": round(float(ao.mean()), 4),
                     "applied": "lightmap *= (1 - strength) + strength * ao, before normalisation"}
        log("ao %.1f s, mean %.3f, strength %.2f at %.1f m" % (t_ao, ao.mean(), args.ao_strength, args.ao_distance))
        for m in objects[plan.id][1]:
            m.node_tree.nodes["lightmap_bake_target"].image = bake_img
    png = os.path.join(out_dir, "lightmap.png")
    stats = hb.write_lightmap_png(buf, args.res, png)
    lm_stats = lightmap_stats(ob, uv2, buf, args.res, stats["p999_irradiance_over_pi"],
                              CELL_PARTS if isinstance(plan, CellPlan) else PARTS)
    tiers = ktx_tiers(png, out_dir, args.res)
    log("lightmap: coverage %.1f%%, scale %.3f, tiers %s" % (100 * stats["coverage"], stats["scale"], tiers))

    marker_objs = add_room_markers(scene, plan, markers)
    glb = os.path.join(out_dir, "%s.glb" % plan.id)
    bpy.ops.object.select_all(action="DESELECT")
    extra = []
    if plan.id in trees_of:
        unlit_trees_for_export(trees_of[plan.id], textures)
        extra = [trees_of[plan.id]]
        trees_of[plan.id].data.color_attributes.active_color_index = 0
    export_glb(glb, [ob] + extra + marker_objs, vertex_color=bool(extra))
    if extra:
        patch_glb_json(glb, unlit_tree_materials)
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
            "ktx2_px": min(args.res, FULL_TIER_PX), "ktx2_phone_px": 1024,
            "scale": stats["scale"], "three_light_map_intensity": round(stats["scale"] * math.pi, 6),
            "coverage": stats["coverage"], "clipped_fraction": stats["clipped_fraction"],
            "ao": ao_record, "stats_per_material": lm_stats,
            "binding": "texture.colorSpace = SRGBColorSpace, flipY = false, channel = 1, "
                       "material.lightMapIntensity = three_light_map_intensity",
        },
        "geometry": {
            "units": "metres", "type": plan.type, "bounds_gltf": plan.raw["bounds"],
            "height": plan.h, "faces": len(ob.data.polygons), "surface_area_m2": round(area, 1),
            "doorways": plan.doorways, "windows": plan.windows, "posters": plan.posters,
            "style": plan.style, "floor": plan.floor_look, "wall": plan.wall_look,
            "materials": ["%s_%s" % (plan.id, p) for p in (CELL_PARTS if isinstance(plan, CellPlan) else PARTS)],
        },
        "lighting": {"sun_direction_blender": [round(c, 4) for c in Vector(hb.SUN_DIR).normalized()],
                     "sun_strength": hb.SUN_STRENGTH, "world": "Nishita sky", "world_strength": hb.SKY_STRENGTH,
                     "fill": {"lamps": len(fills), "watts_each": args.fill, "colour": FILL_COLOUR,
                              "placement": "one per 8 m along each interior room's long axis at 0.55 h"},
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
    for name in ("%s.glb" % plan.id, "lightmap.png", "ao.png", "lightmap.ktx2", "lightmap-1024.ktx2", "preview.png"):
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
