#!/usr/bin/env python3
"""
typeface.py -- a three.js typeface JSON out of a TrueType or OpenType font.

    python3 grove/tools/typeface.py Cinzel[wght].ttf grove/src/world/fonts/cinzel.json \
        --chars latin --name "Cinzel" --weight 700

The door signs (grove/src/world/door-signs.ts) extrude the room names out of
this file themselves (flattened curves, earcut, their own side walls), not
with three's TextGeometry, which would drag three's shape and extrusion
classes into the startup chunk. The format is the one three's FontLoader reads:
per glyph the advance (`ha`) and an outline in font units as a path string,
"m x y", "l x y", "q cx cy x y", "b c1x c1y c2x c2y x y", "z". Only the
characters asked for go in, so the file stays a few tens of kilobytes and
loads lazily. Cinzel (Natanael Gama) is under the SIL Open Font License 1.1;
the licence text ships beside the JSON.

A variable font is instanced at --weight before its outlines are read.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

LATIN = (
    [chr(c) for c in range(0x20, 0x7F)]
    + [chr(c) for c in range(0xA0, 0x180)]  # Latin-1 Supplement and Latin Extended-A
    + ["–", "—", "‘", "’", "“", "”", "…"]
)


class PathPen(BasePen):
    """Writes the outline the way three's Font.createPath reads it."""

    def __init__(self, glyph_set) -> None:
        super().__init__(glyph_set)
        self.parts: list[str] = []

    @staticmethod
    def _n(v: float) -> str:
        return str(int(round(v)))

    def _moveTo(self, p):
        self.parts.append(f"m {self._n(p[0])} {self._n(p[1])}")

    def _lineTo(self, p):
        self.parts.append(f"l {self._n(p[0])} {self._n(p[1])}")

    def _qCurveToOne(self, c, p):
        self.parts.append(f"q {self._n(c[0])} {self._n(c[1])} {self._n(p[0])} {self._n(p[1])}")

    def _curveToOne(self, c1, c2, p):
        self.parts.append(
            f"b {self._n(c1[0])} {self._n(c1[1])} {self._n(c2[0])} {self._n(c2[1])} {self._n(p[0])} {self._n(p[1])}"
        )

    def _closePath(self):
        self.parts.append("z")

    def _endPath(self):
        self.parts.append("z")


def convert(source: str, chars: list[str], name: str, weight: int | None) -> dict:
    font = TTFont(source)
    if weight is not None and "fvar" in font:
        font = instantiateVariableFont(font, {"wght": weight})
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    upem = font["head"].unitsPerEm
    scale = 1000 / upem
    glyphs: dict[str, dict] = {}
    missing: list[str] = []
    for ch in chars:
        gid = cmap.get(ord(ch))
        if gid is None:
            missing.append(ch)
            continue
        glyph = glyph_set[gid]
        pen = PathPen(glyph_set)
        glyph.draw(pen)
        # Font units -> a 1000-unit em, which is what three assumes for `resolution`.
        parts = []
        for part in pen.parts:
            tokens = part.split()
            parts.append(" ".join(tokens[:1] + [str(int(round(float(t) * scale))) for t in tokens[1:]]))
        bounds = getattr(glyph, "_glyph", None)
        glyphs[ch] = {
            "ha": int(round(glyph.width * scale)),
            "x_min": 0,
            "x_max": int(round(glyph.width * scale)),
            "o": " ".join(parts),
        }
        del bounds
    os2 = font["OS/2"]
    head = font["head"]
    doc = {
        "glyphs": glyphs,
        "familyName": name,
        "ascender": int(round(font["hhea"].ascent * scale)),
        "descender": int(round(font["hhea"].descent * scale)),
        "underlinePosition": int(round(font["post"].underlinePosition * scale)),
        "underlineThickness": int(round(font["post"].underlineThickness * scale)),
        "boundingBox": {
            "xMin": int(round(head.xMin * scale)),
            "xMax": int(round(head.xMax * scale)),
            "yMin": int(round(head.yMin * scale)),
            "yMax": int(round(head.yMax * scale)),
        },
        "resolution": 1000,
        "original_font_information": {
            "format": 0,
            "copyright": "Cinzel: Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel), SIL Open Font License 1.1",
            "fontFamily": name,
            "fontSubfamily": f"weight {weight}" if weight else "regular",
        },
        "cssFontWeight": str(weight or os2.usWeightClass),
        "cssFontStyle": "normal",
    }
    if missing:
        print(f"typeface: {len(missing)} characters not in the font: {''.join(missing)!r}", file=sys.stderr)
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("out")
    ap.add_argument("--chars", default="latin", help="'latin' (default) or a string of characters")
    ap.add_argument("--name", default="Cinzel")
    ap.add_argument("--weight", type=int, default=None, help="instance a variable font at this wght")
    args = ap.parse_args()
    chars = LATIN if args.chars == "latin" else list(dict.fromkeys(args.chars))
    doc = convert(args.source, chars, args.name, args.weight)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"typeface: {len(doc['glyphs'])} glyphs -> {args.out}")


if __name__ == "__main__":
    main()
