#!/usr/bin/env python3
"""
bake_hall.py -- build the M0 hall procedurally and bake its lightmap (WP3).

Run headless, never with a bare CUDA context:

    exprun /home/manuel/tools/blender/blender --background \
        --python grove/tools/bake_hall.py -- --samples 256 --out grove/public/assets/hall

Outputs into --out:
    hall.glb        glTF binary, Y-up, no Draco, uv2 exported as TEXCOORD_1
    lightmap.png    2048x2048 sRGB-encoded diffuse (direct+indirect, no colour)
    lightmap.ktx2   only if `toktx` is on PATH
    hall.json       the same provenance record that is patched into asset.extras
    preview.png     1280x720 Cycles view from the spawn point, lightmap as emission
    grid_1m.png     only with --grid-floor (debug)

COORDINATES (Blender, Z up, origin at the centre of the floor):
    x in [-7, +7]   long walls: -X carries the six windows, +X the poster panel
    y in [-10, +10] short walls: +Y carries the doorway, -Y is blank
    z in [0, 7]     0 is the floor, 7 the beam soffits of the coffered ceiling
glTF export is Y-up, so the client sees (x, y, z)_blender -> (x, z, -y)_gltf.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time

import bpy
import bmesh
import numpy as np
from mathutils import Vector

# --------------------------------------------------------------------------
# the hall, in metres.  Every number here also lands in hall.json.
# --------------------------------------------------------------------------
W, D, H = 14.0, 20.0, 7.0          # interior width (X), depth (Y), height (Z)

WAINSCOT_H, WAINSCOT_P = 1.10, 0.06     # height, how far it stands proud
CORNICE_Z0, CORNICE_Z1, CORNICE_P = 6.55, 6.85, 0.12

DOOR_W, DOOR_H, DOOR_DEPTH = 2.40, 3.20, 0.45   # centred on the +Y wall, at z=0
WIN_N, WIN_W = 6, 1.60
WIN_SILL, WIN_HEAD, WIN_DEPTH = 1.60, 5.60, 0.35
PANEL_W, PANEL_H, PANEL_Z0, PANEL_DEPTH = 6.00, 3.40, 1.40, 0.04
COFFER_NX, COFFER_NY, BEAM_W, COFFER_D = 4, 6, 0.50, 0.35

SPAWN_XY = (0.0, -8.0)     # floor position; faces +Y, i.e. towards the doorway
EYE_H = 1.60

SUN_DIR = (0.78, 0.30, -0.55)   # travel direction of the sunlight, normalised below
SUN_STRENGTH = 3.6
SUN_ANGLE_DEG = 1.6
SKY_STRENGTH = 0.85

M_FLOOR, M_WALL, M_CEIL, M_TRIM, M_PANEL = 0, 1, 2, 3, 4
MAT_NAMES = ["hall_floor", "hall_wall", "hall_ceiling", "hall_trim", "hall_poster_panel"]
MAT_BASE = {
    M_FLOOR: (0.150, 0.135, 0.125),
    M_WALL:  (0.520, 0.505, 0.480),
    M_CEIL:  (0.585, 0.570, 0.545),
    M_TRIM:  (0.400, 0.380, 0.355),
    M_PANEL: (0.720, 0.710, 0.690),
}
MAT_ROUGH = {M_FLOOR: 0.38, M_WALL: 0.88, M_CEIL: 0.90, M_TRIM: 0.62, M_PANEL: 0.92}

EPS = 1e-6
Z = Vector((0.0, 0.0, 1.0))


def log(msg):
    print("[bake_hall] %s" % msg, flush=True)


# --------------------------------------------------------------------------
# mesh builder -- explicit quads, welded afterwards so UV islands stay whole
# --------------------------------------------------------------------------
class Build:
    def __init__(self):
        self.verts: list[Vector] = []
        self.faces: list[tuple] = []
        self.mats: list[int] = []

    def quad(self, p, e1, e2, mat, want=None):
        p, e1, e2 = Vector(p), Vector(e1), Vector(e2)
        if e1.length < 1e-5 or e2.length < 1e-5:
            return
        if want is not None and e1.cross(e2).dot(Vector(want)) < 0.0:
            e1, e2 = e2, e1
        i = len(self.verts)
        self.verts += [p, p + e1, p + e1 + e2, p + e2]
        self.faces.append((i, i + 1, i + 2, i + 3))
        self.mats.append(mat)

    def rect_holes(self, p, u, v, holes, mat, want=None):
        """Rectangle p + [0,|u|] x [0,|v|] minus axis-aligned holes, as a guillotine
        grid of quads.  holes are (u0, v0, u1, v1) in metres along u and v."""
        u, v = Vector(u), Vector(v)
        U, V = u.length, v.length
        uh, vh = u.normalized(), v.normalized()
        cuts_u = sorted({0.0, U} | {round(h[0], 6) for h in holes} | {round(h[2], 6) for h in holes})
        cuts_v = sorted({0.0, V} | {round(h[1], 6) for h in holes} | {round(h[3], 6) for h in holes})
        cuts_u = [c for c in cuts_u if -EPS <= c <= U + EPS]
        cuts_v = [c for c in cuts_v if -EPS <= c <= V + EPS]
        for i in range(len(cuts_u) - 1):
            du = cuts_u[i + 1] - cuts_u[i]
            if du < 1e-4:
                continue
            for j in range(len(cuts_v) - 1):
                dv = cuts_v[j + 1] - cuts_v[j]
                if dv < 1e-4:
                    continue
                cu, cv = cuts_u[i] + du / 2, cuts_v[j] + dv / 2
                if any(h[0] - EPS < cu < h[2] + EPS and h[1] - EPS < cv < h[3] + EPS for h in holes):
                    continue
                self.quad(Vector(p) + uh * cuts_u[i] + vh * cuts_v[j], uh * du, vh * dv, mat, want)

    def reveal(self, p, u, v, hole, depth, mat, inward, sides="lrtb"):
        """The ring of jamb faces around a hole, running `depth` into the wall
        (away from `inward`, the wall's interior normal).  They face into the
        opening, so they are what you see when you look through it."""
        u, v = Vector(u), Vector(v)
        uh, vh = u.normalized(), v.normalized()
        o = Vector(p)
        u0, u1, v0, v1 = hole          # same (u0, u1, v0, v1) order as build_wall
        d = -Vector(inward).normalized() * depth
        if "l" in sides:
            self.quad(o + uh * u0 + vh * v0, vh * (v1 - v0), d, mat, want=uh)
        if "r" in sides:
            self.quad(o + uh * u1 + vh * v0, vh * (v1 - v0), d, mat, want=-uh)
        if "b" in sides:
            self.quad(o + uh * u0 + vh * v0, uh * (u1 - u0), d, mat, want=vh)
        if "t" in sides:
            self.quad(o + uh * u0 + vh * v1, uh * (u1 - u0), d, mat, want=-vh)


def build_wall(b: Build, A, B, holes):
    """One wall of the room.  A -> B are floor corners in plan; the interior is
    on the left of A->B, so the four walls are listed counter-clockwise.
    `holes` are (u0, u1, z0, z1) with u measured along A->B from A.

    The wall is a stepped profile -- proud wainscot, wall field, cornice, frieze
    -- built out of visible faces only, so nothing is hidden behind anything and
    the shell stays closed (no light leaks, no wasted lightmap texels)."""
    a = Vector((A[0], A[1], 0.0))
    bb = Vector((B[0], B[1], 0.0))
    uh = (bb - a).normalized()
    L = (bb - a).length
    n = Z.cross(uh)                       # interior normal

    strips = [
        (0.0, WAINSCOT_H, WAINSCOT_P, M_TRIM),
        (WAINSCOT_H, CORNICE_Z0, 0.0, M_WALL),
        (CORNICE_Z0, CORNICE_Z1, CORNICE_P, M_TRIM),
        (CORNICE_Z1, H, 0.0, M_WALL),
    ]
    for z0, z1, inset, mat in strips:
        s = inset                          # mitre: shorten by the inset at both ends
        origin = a + uh * s + n * inset + Z * z0
        loc = []
        for hu0, hu1, hz0, hz1 in holes:
            if hz1 <= z0 + EPS or hz0 >= z1 - EPS:
                continue
            loc.append((hu0 - s, max(hz0, z0) - z0, hu1 - s, min(hz1, z1) - z0))
        b.rect_holes(origin, uh * (L - 2 * s), Z * (z1 - z0), loc, mat, want=n)

    caps = [(WAINSCOT_H, WAINSCOT_P, 0.0), (CORNICE_Z0, 0.0, CORNICE_P), (CORNICE_Z1, CORNICE_P, 0.0)]
    for z, i0, i1 in caps:
        s = max(i0, i1)
        up = Z if i1 < i0 else -Z          # step back = faces up, step out = faces down
        origin = a + uh * s + n * min(i0, i1) + Z * z
        loc = [(hu0 - s, 0.0, hu1 - s, abs(i1 - i0))
               for hu0, hu1, hz0, hz1 in holes if hz0 < z - EPS < hz1]
        b.rect_holes(origin, uh * (L - 2 * s), n * abs(i1 - i0), loc, M_TRIM, want=up)


def build_corner_caps(b: Build, corners):
    """The little squares the mitred wainscot/cornice caps leave open at each
    room corner."""
    for k, c in enumerate(corners):
        prev = corners[k - 1]
        uh = (Vector((c[0], c[1], 0.0)) - Vector((prev[0], prev[1], 0.0))).normalized()
        n = Z.cross(uh)
        p = Vector((c[0], c[1], 0.0))
        for z, i0, i1 in [(WAINSCOT_H, WAINSCOT_P, 0.0), (CORNICE_Z0, 0.0, CORNICE_P),
                          (CORNICE_Z1, CORNICE_P, 0.0)]:
            t = max(i0, i1)
            up = Z if i1 < i0 else -Z
            b.quad(p + Z * z - uh * t, n * t, uh * t, M_TRIM, want=up)


def build_ceiling(b: Build):
    x0, y0 = -W / 2, -D / 2
    cw = (W - (COFFER_NX + 1) * BEAM_W) / COFFER_NX
    ch = (D - (COFFER_NY + 1) * BEAM_W) / COFFER_NY
    cells = []
    for i in range(COFFER_NX):
        for j in range(COFFER_NY):
            u0 = BEAM_W + i * (cw + BEAM_W)
            v0 = BEAM_W + j * (ch + BEAM_W)
            cells.append((u0, v0, u0 + cw, v0 + ch))
    b.rect_holes((x0, y0, H), (W, 0, 0), (0, D, 0), cells, M_CEIL, want=(0, 0, -1))
    for u0, v0, u1, v1 in cells:
        b.quad((x0 + u0, y0 + v0, H + COFFER_D), (u1 - u0, 0, 0), (0, v1 - v0, 0),
               M_CEIL, want=(0, 0, -1))
        b.quad((x0 + u0, y0 + v0, H), (0, v1 - v0, 0), (0, 0, COFFER_D), M_TRIM, want=(1, 0, 0))
        b.quad((x0 + u1, y0 + v0, H), (0, v1 - v0, 0), (0, 0, COFFER_D), M_TRIM, want=(-1, 0, 0))
        b.quad((x0 + u0, y0 + v0, H), (u1 - u0, 0, 0), (0, 0, COFFER_D), M_TRIM, want=(0, 1, 0))
        b.quad((x0 + u0, y0 + v1, H), (u1 - u0, 0, 0), (0, 0, COFFER_D), M_TRIM, want=(0, -1, 0))
    return cw, ch


def window_centres():
    step = D / WIN_N
    return [-D / 2 + step * (i + 0.5) for i in range(WIN_N)]


def build_hall():
    b = Build()
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2

    b.quad((x0, y0, 0.0), (W, 0, 0), (0, D, 0), M_FLOOR, want=(0, 0, 1))

    # counter-clockwise in plan, interior on the left of each segment
    corners = [(x1, y0), (x1, y1), (x0, y1), (x0, y0)]

    # +X wall: poster panel.  u runs +Y from y0.
    pu0 = (0.0 - PANEL_W / 2) - y0
    panel_holes = [(pu0, pu0 + PANEL_W, PANEL_Z0, PANEL_Z0 + PANEL_H)]
    build_wall(b, corners[0], corners[1], panel_holes)
    # recessed panel + its shadow-line reveal
    pw_o = Vector((x1, y0, 0.0))
    pw_u, pw_v = Vector((0, D, 0)), Vector((0, 0, H))
    b.reveal(pw_o, pw_u, pw_v, panel_holes[0], PANEL_DEPTH, M_TRIM, inward=(-1, 0, 0))
    b.quad((x1 + PANEL_DEPTH, y0 + pu0, PANEL_Z0), (0, PANEL_W, 0), (0, 0, PANEL_H),
           M_PANEL, want=(-1, 0, 0))

    # +Y wall: the doorway.  u runs -X from x1.
    du0 = x1 - DOOR_W / 2
    door_holes = [(du0, du0 + DOOR_W, 0.0, DOOR_H)]
    build_wall(b, corners[1], corners[2], door_holes)
    dw_o = Vector((x1, y1, 0.0))
    dw_u, dw_v = Vector((-W, 0, 0)), Vector((0, 0, H))
    b.reveal(dw_o, dw_u, dw_v, door_holes[0], DOOR_DEPTH, M_TRIM, inward=(0, -1, 0),
             sides="lrt")
    b.quad((-DOOR_W / 2, y1, 0.0), (DOOR_W, 0, 0), (0, DOOR_DEPTH, 0), M_TRIM, want=(0, 0, 1))

    # -X wall: six windows.  u runs -Y from y1.
    win_holes = []
    for yc in window_centres():
        u = y1 - yc
        win_holes.append((u - WIN_W / 2, u + WIN_W / 2, WIN_SILL, WIN_HEAD))
    build_wall(b, corners[2], corners[3], win_holes)
    ww_o = Vector((x0, y1, 0.0))
    ww_u, ww_v = Vector((0, -D, 0)), Vector((0, 0, H))
    for hole in win_holes:
        b.reveal(ww_o, ww_u, ww_v, hole, WIN_DEPTH, M_TRIM, inward=(1, 0, 0))

    # -Y wall: blank
    build_wall(b, corners[3], corners[0], [])

    build_corner_caps(b, corners)
    cw, ch = build_ceiling(b)
    return b, cw, ch


def to_object(b: Build, name="hall"):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in b.verts], [], b.faces)
    me.validate(verbose=False)
    me.polygons.foreach_set("material_index", b.mats)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


# --------------------------------------------------------------------------
# UVs
# --------------------------------------------------------------------------
def make_uvs(ob, res, margin_px):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv0 = me.uv_layers.new(name="UVMap")     # TEXCOORD_0, 1 unit == 1 metre
    uv2 = me.uv_layers.new(name="uv2")       # TEXCOORD_1, the lightmap

    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)

    me.uv_layers.active = me.uv_layers["UVMap"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.0, correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    island_margin = float(margin_px) / float(res)
    me.uv_layers.active = me.uv_layers["uv2"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=island_margin,
                             area_weight=1.0, correct_aspect=False, scale_to_bounds=False,
                             margin_method="SCALED", rotate_method="AXIS_ALIGNED")
    try:
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(rotate=True, rotate_method="AXIS_ALIGNED", scale=True,
                                margin_method="SCALED", margin=island_margin,
                                shape_method="AABB")
    except Exception as exc:                                    # pragma: no cover
        log("pack_islands unavailable (%s); keeping smart_project's packing" % exc)
    bpy.ops.object.mode_set(mode="OBJECT")

    me.uv_layers.active = me.uv_layers["UVMap"]
    me.uv_layers["UVMap"].active_render = True
    return uv0.name, uv2.name


# --------------------------------------------------------------------------
# materials, sun, sky
# --------------------------------------------------------------------------
def grid_texture(path, px=256, line_px=3):
    a = np.zeros((px, px, 4), dtype=np.float32)
    a[..., :3] = 0.16
    a[..., 3] = 1.0
    a[:line_px, :, :3] = 0.55
    a[:, :line_px, :3] = 0.55
    a[px // 2 - 1:px // 2 + 1, :, :3] = 0.30
    a[:, px // 2 - 1:px // 2 + 1, :3] = 0.30
    img = bpy.data.images.new("grid_1m", px, px, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(a.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def make_materials(bake_img, uv2_name, grid_img=None):
    mats = []
    for idx, name in enumerate(MAT_NAMES):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*MAT_BASE[idx], 1.0)
        bsdf.inputs["Roughness"].default_value = MAT_ROUGH[idx]
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.35

        if idx == M_FLOOR:
            if grid_img is not None:
                tex = nt.nodes.new("ShaderNodeTexImage")
                tex.image = grid_img
                tex.location = (-500, 200)
                uvn = nt.nodes.new("ShaderNodeUVMap")
                uvn.uv_map = "UVMap"
                uvn.location = (-700, 200)
                nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            else:
                # subtle procedural stone: 1 m checker of two near-identical greys,
                # mottled by noise.  Procedurals do not travel through glTF, so this
                # only shapes the bake's bounce light; the exported baseColor is flat.
                coord = nt.nodes.new("ShaderNodeTexCoord")
                coord.location = (-1100, 0)
                chk = nt.nodes.new("ShaderNodeTexChecker")
                chk.location = (-900, 100)
                chk.inputs["Scale"].default_value = 1.0
                chk.inputs["Color1"].default_value = (0.150, 0.135, 0.125, 1.0)
                chk.inputs["Color2"].default_value = (0.185, 0.170, 0.155, 1.0)
                noise = nt.nodes.new("ShaderNodeTexNoise")
                noise.location = (-900, -200)
                noise.inputs["Scale"].default_value = 7.0
                noise.inputs["Detail"].default_value = 6.0
                mix = nt.nodes.new("ShaderNodeMixRGB")
                mix.location = (-600, 0)
                mix.blend_type = "OVERLAY"
                mix.inputs["Fac"].default_value = 0.12
                nt.links.new(coord.outputs["Object"], chk.inputs["Vector"])
                nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
                nt.links.new(chk.outputs["Color"], mix.inputs["Color1"])
                nt.links.new(noise.outputs["Color"], mix.inputs["Color2"])
                nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
                rough = nt.nodes.new("ShaderNodeMapRange")
                rough.location = (-600, -300)
                rough.inputs["To Min"].default_value = 0.30
                rough.inputs["To Max"].default_value = 0.48
                nt.links.new(noise.outputs["Fac"], rough.inputs["Value"])
                nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])

        # the bake target: an image node that is active but connected to nothing,
        # so the exporter never writes the lightmap into the glb.
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


def make_lighting(scene):
    d = Vector(SUN_DIR).normalized()
    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = SUN_STRENGTH
    sun_data.angle = math.radians(SUN_ANGLE_DEG)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = Vector((0.0, 0.0, -1.0)).rotation_difference(d).to_euler()
    sun.location = (-20.0, 0.0, 14.0)
    scene.collection.objects.link(sun)

    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    bg.inputs["Strength"].default_value = SKY_STRENGTH
    try:
        sky = nt.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"
        sky.sun_disc = False
        sky.sun_elevation = math.asin(max(-d.z, 0.02))
        sky.sun_rotation = math.atan2(d.y, d.x) + math.pi
        sky.altitude = 120.0
        sky.air_density = 1.0
        sky.dust_density = 1.6
        nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    except Exception as exc:                                    # pragma: no cover
        log("no Nishita sky (%s); flat blue world" % exc)
        bg.inputs["Color"].default_value = (0.32, 0.45, 0.68, 1.0)
    return sun


# --------------------------------------------------------------------------
# bake
# --------------------------------------------------------------------------
def configure_cycles(scene, args):
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    prefs = bpy.context.preferences.addons.get("cycles")
    if args.device == "CPU":
        cy.device = "CPU"
        if prefs is not None:
            try:
                prefs.preferences.compute_device_type = "NONE"
            except Exception:
                pass
    else:
        if os.environ.get("ORCHARD_GPU_LANE_HELD") != "1":
            raise SystemExit(
                "--device GPU refused: nothing here holds the GPU lane, and an unserialised "
                "CUDA context freezes WSL2. The CPU bake fits the 30 min budget; if you really "
                "need the card, take the lane and say so:\n"
                "  exp run orchard-hall-bake-gpu --prio 10 -- env ORCHARD_GPU_LANE_HELD=1 "
                "<blender> --background --python grove/tools/bake_hall.py -- --device GPU ...")
        cy.device = "GPU"
        if prefs is not None:
            for kind in ("OPTIX", "CUDA"):
                try:
                    prefs.preferences.compute_device_type = kind
                    prefs.preferences.get_devices()
                    for dev in prefs.preferences.devices:
                        dev.use = dev.type in (kind, "CPU")
                    log("cycles GPU backend %s" % kind)
                    break
                except Exception:
                    continue
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = args.adaptive_threshold
    cy.max_bounces = 8
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 2
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 4
    cy.sample_clamp_indirect = 10.0
    # Cycles 4.2 ignores scene denoising when baking (measured: a 64 spp bake is
    # identically grainy with it on and off), so the lightmap is denoised after the
    # fact with the compositor's OIDN node instead.
    cy.use_denoising = False
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
        cy.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        cy.denoising_prefilter = "ACCURATE"
    except Exception:
        pass
    scene.render.threads_mode = "AUTO"


def noise_metric(rgba, res):
    """Mean |Laplacian| of luminance over baked texels -- a cheap, comparable
    measure of how grainy a bake is."""
    a = rgba.reshape(res, res, 4)
    lum = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    cov = a[..., 3] > 0.5
    lap = np.abs(4 * lum[1:-1, 1:-1] - lum[:-2, 1:-1] - lum[2:, 1:-1]
                 - lum[1:-1, :-2] - lum[1:-1, 2:])
    m = cov[1:-1, 1:-1]
    return float(lap[m].mean()) if m.any() else float("nan")


def compositor_denoise(img, res):
    """OIDN via the compositor, for Blender versions where the bake itself does
    not denoise.  Writes and re-reads an EXR in Blender's own temp dir."""
    sc = bpy.data.scenes.new("denoise")
    sc.use_nodes = True
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGBA"
    nt = sc.node_tree
    nt.nodes.clear()
    n_img = nt.nodes.new("CompositorNodeImage")
    n_img.image = img
    n_dn = nt.nodes.new("CompositorNodeDenoise")
    n_out = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(n_img.outputs["Image"], n_dn.inputs["Image"])
    nt.links.new(n_dn.outputs["Image"], n_out.inputs["Image"])
    path = os.path.join(bpy.app.tempdir, "lightmap_denoised.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    out = bpy.data.images.load(path)
    buf = np.empty(res * res * 4, dtype=np.float32)
    out.pixels.foreach_get(buf)
    bpy.data.images.remove(out)
    bpy.data.scenes.remove(sc)
    return buf


def bake(scene, ob, img, args, uv2_name):
    bake_s = scene.render.bake
    bake_s.use_pass_direct = True
    bake_s.use_pass_indirect = True
    bake_s.use_pass_color = False
    bake_s.margin = args.margin
    bake_s.margin_type = "ADJACENT_FACES"
    bake_s.use_clear = True
    bake_s.target = "IMAGE_TEXTURES"
    scene.cycles.bake_type = args.bake_type

    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

    pass_filter = {"DIRECT", "INDIRECT"}
    if args.bake_type == "COMBINED":
        pass_filter |= {"DIFFUSE"}
    t0 = time.time()
    bpy.ops.object.bake(type=args.bake_type, pass_filter=pass_filter, uv_layer=uv2_name,
                        margin=args.margin, margin_type="ADJACENT_FACES", use_clear=True)
    return time.time() - t0


def srgb_encode(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0.0), 1 / 2.4) - 0.055)


def write_lightmap_png(buf, res, path):
    """Normalise, sRGB-encode and save.  The scale factor is recorded so the
    client can recover irradiance; three.js wants colorSpace = SRGBColorSpace."""
    a = buf.reshape(-1, 4)
    rgb = a[:, :3]
    cov = a[:, 3] > 0.5
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    if cov.any():
        hi = float(np.percentile(lum[cov], 99.9))
        mean = float(lum[cov].mean())
    else:
        hi, mean = 1.0, 0.0
    scale = 0.95 / max(hi, 1e-6)
    clipped = float((lum[cov] * scale > 1.0).mean()) if cov.any() else 0.0
    out = np.clip(rgb * scale, 0.0, 1.0)
    enc = np.empty((out.shape[0], 4), dtype=np.float32)
    enc[:, :3] = srgb_encode(out)
    enc[:, 3] = 1.0

    img = bpy.data.images.new("lightmap_out", res, res, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(enc.reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return {
        "scale": round(1.0 / scale, 6),
        "coverage": round(float(cov.mean()), 4),
        "mean_irradiance_over_pi": round(mean, 5),
        "p999_irradiance_over_pi": round(hi, 5),
        "clipped_fraction": round(clipped, 6),
    }


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------
def add_markers(scene):
    """Empties WP2 can read straight out of the glb.  Convention: the empty's
    local -Z is the facing direction, exactly like a camera, so in glTF the
    node's -Z points the way you look / walk."""
    def empty(name, loc, facing, props):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "SINGLE_ARROW"
        e.empty_display_size = 0.5
        e.location = loc
        # The Y-up export conjugates each node's rotation by the Z-up -> Y-up
        # change of basis, which sends the object's local +Y to the exported
        # node's local -Z.  So to make the node's -Z (the camera convention) the
        # facing, aim the BLENDER-local +Y at it here -- aiming Blender's own -Z
        # lands the facing on the node's local -Y and points -Z at the ceiling.
        e.rotation_euler = Vector(facing).normalized().to_track_quat("Y", "Z").to_euler()
        for k, v in props.items():
            e[k] = v
        scene.collection.objects.link(e)
        return e

    out = [
        empty("spawn", (SPAWN_XY[0], SPAWN_XY[1], 0.0), (0, 1, 0),
              {"role": "spawn", "eye_height_m": EYE_H}),
        # the doorway marker faces back INTO the hall (you travel the other way)
        empty("door_einstruct", (0.0, D / 2, 0.0), (0, -1, 0),
              {"role": "doorway", "width_m": DOOR_W, "height_m": DOOR_H, "to": "einstruct"}),
        empty("poster_wall", (W / 2 + PANEL_DEPTH, 0.0, PANEL_Z0 + PANEL_H / 2), (-1, 0, 0),
              {"role": "poster", "width_m": PANEL_W, "height_m": PANEL_H}),
    ]
    return out


def flatten_materials_for_export(mats):
    """glTF carries a constant baseColor and roughness, not a node graph: any
    input still driven by a procedural exports as the glTF DEFAULT (white, 1.0),
    not as what the bake saw.  Drop those links and restore the constants.  An
    image texture is left alone -- that one the exporter can carry."""
    for idx, mat in enumerate(mats):
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        for socket, value in (("Base Color", (*MAT_BASE[idx], 1.0)),
                              ("Roughness", MAT_ROUGH[idx])):
            inp = bsdf.inputs[socket]
            for link in list(inp.links):
                source = link.from_node.type
                if source == "TEX_IMAGE":
                    continue
                nt.links.remove(link)
                inp.default_value = value
                log("export: %s.%s unlinked from %s, constant %s"
                    % (mat.name, socket, source, value))


def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_draco_mesh_compression_enable=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_unused_images=False,
        export_unused_textures=False,
    )


def patch_glb_extras(path, extras):
    with open(path, "rb") as fh:
        blob = fh.read()
    magic, version, total = struct.unpack("<III", blob[:12])
    assert magic == 0x46546C67, "not a glb"
    off, chunks = 12, []
    while off < total:
        clen, ctype = struct.unpack("<II", blob[off:off + 8])
        chunks.append((ctype, blob[off + 8:off + 8 + clen]))
        off += 8 + clen
    doc = json.loads(chunks[0][1].decode("utf-8"))
    doc.setdefault("asset", {}).setdefault("extras", {}).update(extras)
    js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js
    for ctype, data in chunks[1:]:
        pad = b"\x00" * ((4 - len(data) % 4) % 4)
        body += struct.pack("<II", len(data) + len(pad), ctype) + data + pad
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", magic, version, 12 + len(body)) + body)


def maybe_ktx2(png, out_dir):
    toktx = shutil.which("toktx")
    if not toktx:
        return None, "toktx not on PATH -- shipping lightmap.png only"
    ktx = os.path.join(out_dir, "lightmap.ktx2")
    # UASTC, not ETC1S: a lightmap is a smooth low-frequency signal and ETC1S
    # bands visibly across large walls.  UASTC + zstd is ~1 byte/texel before
    # supercompression; ETC1S would be ~4x smaller and is the fallback if the
    # download budget bites.
    cmd = [toktx, "--t2", "--encode", "uastc", "--uastc_quality", "2", "--zcmp", "18",
           "--assign_oetf", "srgb", "--genmipmap", ktx, png]
    subprocess.run(cmd, check=True)
    return ktx, "UASTC quality 2 + zstd 18 (smooth signal; ETC1S bands on large walls)"


# --------------------------------------------------------------------------
# preview
# --------------------------------------------------------------------------
def render_preview(scene, ob, mats, png_path, out_path, scale, samples):
    img = bpy.data.images.load(png_path)
    img.colorspace_settings.name = "sRGB"
    for idx, mat in enumerate(mats):
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        emi = nt.nodes.new("ShaderNodeEmission")
        mul = nt.nodes.new("ShaderNodeMixRGB")
        mul.blend_type = "MULTIPLY"
        mul.inputs["Fac"].default_value = 1.0
        mul.inputs["Color2"].default_value = (*MAT_BASE[idx], 1.0)
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

    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.sensor_width = 36.0
    cam_data.lens = 22.0
    cam = bpy.data.objects.new("preview_cam", cam_data)
    cam.location = (SPAWN_XY[0], SPAWN_XY[1], EYE_H)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)   # looks +Y, at the doorway
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.cycles.samples = samples
    scene.cycles.max_bounces = 0
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.filepath = out_path
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        log("view transform 'Standard' unavailable; leaving %s"
            % scene.view_settings.view_transform)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t0


# --------------------------------------------------------------------------
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 16), b""):
            h.update(blk)
    return h.hexdigest()


def git_info(repo):
    def run(*a):
        return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout.strip()
    sha = run("rev-parse", "HEAD")
    dirty = run("status", "--porcelain") != ""
    return {"commit": sha or "unknown", "dirty": dirty}


def parse_args(argv):
    p = argparse.ArgumentParser(prog="bake_hall.py")
    p.add_argument("--out", default="grove/public/assets/hall")
    p.add_argument("--samples", type=int, default=256)
    p.add_argument("--res", type=int, default=2048)
    p.add_argument("--margin", type=int, default=8, help="bake margin and UV island margin, px")
    p.add_argument("--bake-type", default="DIFFUSE", choices=["DIFFUSE", "COMBINED"])
    p.add_argument("--device", default="CPU", choices=["CPU", "GPU"])
    p.add_argument("--no-denoise", dest="denoise", action="store_false")
    p.add_argument("--adaptive-threshold", type=float, default=0.01)
    p.add_argument("--grid-floor", action="store_true", help="debug: 1 m grid PNG on the floor")
    p.add_argument("--no-bake", action="store_true", help="pipeline test: skip the bake")
    p.add_argument("--no-preview", dest="preview", action="store_false")
    p.add_argument("--preview-samples", type=int, default=48)
    p.add_argument("--save-blend", default="")
    p.set_defaults(denoise=True, preview=True)
    return p.parse_args(argv)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parse_args(argv)

    script = os.path.abspath(__file__)
    repo = os.path.dirname(os.path.dirname(os.path.dirname(script)))
    out_dir = args.out if os.path.isabs(args.out) else os.path.join(repo, args.out)
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.time()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    b, cw, ch = build_hall()
    ob = to_object(b)
    log("mesh: %d verts, %d faces (pre-weld quads %d)" % (len(ob.data.vertices),
                                                          len(ob.data.polygons), len(b.faces)))
    co = np.array([tuple(v.co) for v in ob.data.vertices])
    lo, hi = co.min(0), co.max(0)
    log("bounds x[%.2f %.2f] y[%.2f %.2f] z[%.2f %.2f]"
        % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    limit = np.array([W / 2 + DOOR_DEPTH, D / 2 + DOOR_DEPTH, H + COFFER_D])
    assert (hi <= limit + 1e-3).all() and (lo >= -limit - 1e-3).all() and lo[2] >= -1e-3, \
        "geometry escaped the hall: %s %s" % (lo, hi)

    area = sum(p.area for p in ob.data.polygons)
    log("surface area %.1f m^2 -> %.0f texels/m^2 at %d^2 (%.1f px per metre)"
        % (area, args.res ** 2 / area, args.res, math.sqrt(args.res ** 2 / area)))

    uv0_name, uv2_name = make_uvs(ob, args.res, args.margin)

    bake_img = bpy.data.images.new("lightmap", args.res, args.res, alpha=True, float_buffer=True)
    bake_img.colorspace_settings.name = "Non-Color"
    grid_img = grid_texture(os.path.join(out_dir, "grid_1m.png")) if args.grid_floor else None
    mats = make_materials(bake_img, uv2_name, grid_img)
    for m in mats:
        ob.data.materials.append(m)
    sun = make_lighting(scene)
    configure_cycles(scene, args)

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))

    denoise_how, t_denoise = "none", 0.0
    if args.no_bake:
        buf = np.tile(np.array([0.5, 0.5, 0.5, 1.0], dtype=np.float32), args.res * args.res)
        t_bake, noise_raw = 0.0, float("nan")
    else:
        log("baking %s direct+indirect, no colour: %d spp, %d^2, device %s, denoise %s"
            % (args.bake_type, args.samples, args.res, args.device, args.denoise))
        t_bake = bake(scene, ob, bake_img, args, uv2_name)
        buf = np.empty(args.res * args.res * 4, dtype=np.float32)
        bake_img.pixels.foreach_get(buf)
        noise_raw = noise_metric(buf, args.res)
        log("bake wall clock %.1f s, noise metric %.5f" % (t_bake, noise_raw))
        if args.denoise:
            t_dn = time.time()
            dn = compositor_denoise(bake_img, args.res)
            dn.reshape(-1, 4)[:, 3] = buf.reshape(-1, 4)[:, 3]   # keep the bake's coverage
            buf = dn
            t_denoise = time.time() - t_dn
            denoise_how = "OpenImageDenoise via the compositor Denoise node"
            log("compositor denoise %.1f s, noise metric %.5f -> %.5f"
                % (t_denoise, noise_raw, noise_metric(buf, args.res)))

    png = os.path.join(out_dir, "lightmap.png")
    stats = write_lightmap_png(buf, args.res, png)
    stats["noise_metric"] = None if math.isnan(noise_raw) else round(noise_raw, 6)
    log("lightmap %s: coverage %.1f%%, scale %.3f, clipped %.4f%%"
        % (png, 100 * stats["coverage"], stats["scale"], 100 * stats["clipped_fraction"]))
    ktx, ktx_note = maybe_ktx2(png, out_dir)
    log("ktx2: %s" % ktx_note)

    flatten_materials_for_export(mats)
    markers = add_markers(scene)
    ob["orchard_role"] = "hall"
    ob["orchard_lightmap_uv"] = uv2_name
    glb = os.path.join(out_dir, "hall.glb")
    export_glb(glb, [ob] + markers)

    wall_clock = time.time() - t_start
    record = {
        "schema": "orchard/hall/1",
        "asset": "hall",
        "generated_by": "grove/tools/bake_hall.py",
        "script_sha256": sha256_file(script),
        "blender": bpy.app.version_string,
        "git": git_info(repo),
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bake": {
            "engine": "cycles",
            "type": args.bake_type,
            "passes": ["direct", "indirect"],
            "colour_pass": False,
            "samples": args.samples,
            "adaptive_threshold": scene.cycles.adaptive_threshold,
            "max_bounces": scene.cycles.max_bounces,
            "diffuse_bounces": scene.cycles.diffuse_bounces,
            "clamp_indirect": scene.cycles.sample_clamp_indirect,
            "resolution": args.res,
            "margin_px": args.margin,
            "uv_layer": uv2_name,
            "device": args.device,
            "threads": os.cpu_count(),
            "denoise": denoise_how,
            "seconds_bake": round(t_bake, 2),
            "seconds_denoise": round(t_denoise, 2),
            "seconds_wall_clock": round(wall_clock, 2),
        },
        "lightmap": {
            "file": "lightmap.png",
            "ktx2": os.path.basename(ktx) if ktx else None,
            "ktx2_note": ktx_note,
            "encoding": "sRGB transfer, 8 bit RGBA PNG (alpha constant 1)",
            "colour_space_hint": "THREE.SRGBColorSpace",
            "scale": stats["scale"],
            "scale_meaning": "irradiance/pi = srgb_decode(texel) * scale",
            "three_light_map_intensity": round(stats["scale"] * math.pi, 6),
            "binding": "texture.colorSpace = SRGBColorSpace, flipY = false, channel = 1 "
                       "(TEXCOORD_1), material.lightMapIntensity = three_light_map_intensity",
            "uv": "TEXCOORD_1 (blender uv2)",
            "coverage": stats["coverage"],
            "clipped_fraction": stats["clipped_fraction"],
            "noise_metric": stats["noise_metric"],
        },
        "geometry": {
            "units": "metres",
            "blender_axes": "Z up, origin at the centre of the floor, +Y towards the doorway",
            "gltf_axes": "Y up; (x,y,z)_blender -> (x, z, -y)_gltf",
            "interior": {"width_x": W, "depth_y": D, "height_z": H},
            "extent_blender": {"x": [-W / 2, W / 2], "y": [-D / 2, D / 2], "z": [0.0, H]},
            "doorway": {
                "wall": "+Y (blender) / -Z (gltf)",
                "width": DOOR_W, "height": DOOR_H, "sill_z": 0.0, "reveal_depth": DOOR_DEPTH,
                "centre_blender": [0.0, D / 2, DOOR_H / 2],
                "floor_centre_blender": [0.0, D / 2, 0.0],
                "floor_centre_gltf": [0.0, 0.0, -D / 2],
                "through_direction_blender": [0.0, 1.0, 0.0],
                "through_direction_gltf": [0.0, 0.0, -1.0],
                "marker_node": "door_einstruct",
                "marker_facing_gltf": [0.0, 0.0, 1.0],
                "marker_facing_note": "the door_einstruct node's local -Z points back INTO "
                                      "the hall; you travel through the doorway the other "
                                      "way, towards -Z world",
            },
            "spawn": {
                "floor_blender": [SPAWN_XY[0], SPAWN_XY[1], 0.0],
                "eye_blender": [SPAWN_XY[0], SPAWN_XY[1], EYE_H],
                "eye_gltf": [SPAWN_XY[0], EYE_H, -SPAWN_XY[1]],
                "facing_blender": [0.0, 1.0, 0.0],
                "facing_gltf": [0.0, 0.0, -1.0],
                "eye_height": EYE_H,
                "marker_node": "spawn",
                "marker_translation_gltf": [SPAWN_XY[0], 0.0, -SPAWN_XY[1]],
                "note": "the marker sits on the FLOOR (y = 0 in glTF): it is the body "
                        "position, the client adds its own eye height (view.ts EYE_HEIGHT). "
                        "eye_height_m = %.2f in the node's extras is what preview.png was "
                        "rendered from, not an instruction. Facing is the node's local -Z, "
                        "(0, 0, -1), which is three.js' default camera forward." % EYE_H,
            },
            "poster_panel": {
                "wall": "+X (blender) / +X (gltf)",
                "material": "hall_poster_panel",
                "width": PANEL_W, "height": PANEL_H,
                "recess_depth": PANEL_DEPTH,
                "centre_blender": [W / 2 + PANEL_DEPTH, 0.0, PANEL_Z0 + PANEL_H / 2],
                "centre_gltf": [W / 2 + PANEL_DEPTH, PANEL_Z0 + PANEL_H / 2, 0.0],
                "normal_blender": [-1.0, 0.0, 0.0],
                "marker_node": "poster_wall",
            },
            "windows": {
                "wall": "-X (blender)",
                "count": WIN_N, "width": WIN_W, "sill_z": WIN_SILL, "head_z": WIN_HEAD,
                "reveal_depth": WIN_DEPTH,
                "centres_y": [round(y, 4) for y in window_centres()],
                "glazed": False,
                "note": "open apertures: the sun and sky reach the room through them, "
                        "and the client sees its own environment through them",
            },
            "ceiling": {
                "type": "coffered", "beam_soffit_z": H, "coffer_depth": COFFER_D,
                "beam_width": BEAM_W, "cells": [COFFER_NX, COFFER_NY],
                "cell_size": [round(cw, 4), round(ch, 4)],
            },
            "trim": {
                "wainscot_height": WAINSCOT_H, "wainscot_proud": WAINSCOT_P,
                "cornice_z": [CORNICE_Z0, CORNICE_Z1], "cornice_proud": CORNICE_P,
            },
            "materials": MAT_NAMES,
            "surface_area_m2": round(area, 1),
            "texels_per_m2": round(args.res ** 2 / area, 1),
        },
        "lighting": {
            "sun_direction_blender": [round(c, 4) for c in Vector(SUN_DIR).normalized()],
            "sun_strength": SUN_STRENGTH, "sun_angle_deg": SUN_ANGLE_DEG,
            "world": "Nishita sky", "world_strength": SKY_STRENGTH,
            "exported": False,
            "note": "lights are baked, not exported; the glb carries no KHR_lights_punctual",
        },
        "files": {},
    }

    extras = {
        "orchard": {
            "asset": "hall",
            "schema": record["schema"],
            "script": "grove/tools/bake_hall.py",
            "script_sha256": record["script_sha256"],
            "blender": record["blender"],
            "git_commit": record["git"]["commit"],
            "git_dirty": record["git"]["dirty"],
            "bake": record["bake"],
            "lightmap": record["lightmap"],
            "geometry": record["geometry"],
            # The client's sky dome puts its sun where the bake put it (grove/src/world/sky.ts).
            "lighting": record["lighting"],
        }
    }
    patch_glb_extras(glb, extras)

    t_preview = 0.0
    if args.preview:
        t_preview = render_preview(scene, ob, mats, png, os.path.join(out_dir, "preview.png"),
                                   stats["scale"], args.preview_samples)
        log("preview render %.1f s" % t_preview)

    for name in ("hall.glb", "lightmap.png", "lightmap.ktx2", "preview.png", "grid_1m.png"):
        p = os.path.join(out_dir, name)
        if os.path.exists(p):
            record["files"][name] = {"bytes": os.path.getsize(p), "sha256": sha256_file(p)}
    record["bake"]["seconds_preview"] = round(t_preview, 2)
    record["bake"]["seconds_wall_clock"] = round(time.time() - t_start, 2)
    with open(os.path.join(out_dir, "hall.json"), "w") as fh:
        json.dump(record, fh, indent=2)
        fh.write("\n")

    for name, meta in record["files"].items():
        log("%-14s %8.1f kB" % (name, meta["bytes"] / 1024.0))
    log("BAKE OK samples=%d res=%d bake_s=%.1f total_s=%.1f"
        % (args.samples, args.res, t_bake, time.time() - t_start))


if __name__ == "__main__":
    main()
