"""Compare fresh station shots with the accepted references.

    python3 grove/tools/palace/stations_diff.py [docs/img/stations] [--threshold 0.02]

For every <name>.new.jpg beside a <name>.jpg: the fraction of pixels whose
luminance moved by more than 24/255, after a 2 px blur so JPEG noise and
one-pixel antialiasing do not count. Above the threshold the station is
listed as CHANGED with the fraction; a look decides whether the change is
the fix or the regression, then `stations.mjs --accept` makes it the
reference.

A <name>.probe.new.jpg is the same station 2 mm to the side: pixels that
flip between the two frames beyond what a 2 mm shift explains (the blur
absorbs the shift) are faces fighting the depth buffer. Reported as
FLICKER with the fraction and the pixel row/column of the worst patch.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def lum(path):
    img = Image.open(path).convert("L").filter(ImageFilter.GaussianBlur(2))
    return np.asarray(img, dtype=np.float32)


def worst_patch(mask, cell=32):
    h, w = mask.shape
    best, where = 0.0, (0, 0)
    for y in range(0, h - cell + 1, cell // 2):
        for x in range(0, w - cell + 1, cell // 2):
            f = mask[y:y + cell, x:x + cell].mean()
            if f > best:
                best, where = f, (y, x)
    return best, where


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else "docs/img/stations"
    threshold = float(sys.argv[sys.argv.index("--threshold") + 1]) if "--threshold" in sys.argv else 0.02
    changed = flicker = missing = 0
    for new in sorted(glob.glob(os.path.join(out, "*.new.jpg"))):
        name = os.path.basename(new)[:-len(".new.jpg")]
        if name.endswith(".probe"):
            base = os.path.join(out, name[:-len(".probe")] + ".new.jpg")
            if not os.path.exists(base):
                continue
            a, b = lum(base), lum(new)
            mask = np.abs(a - b) > 24
            frac = float(mask.mean())
            worst, (y, x) = worst_patch(mask)
            tag = "FLICKER" if worst > 0.25 else "steady "
            if tag == "FLICKER":
                flicker += 1
            print("%s %-28s %.4f of pixels, worst patch %.2f at row %d col %d" % (tag, name[:-6], frac, worst, y, x))
            continue
        ref = os.path.join(out, name + ".jpg")
        if not os.path.exists(ref):
            missing += 1
            print("NEW     %-28s no reference" % name)
            continue
        a, b = lum(ref), lum(new)
        if a.shape != b.shape:
            print("CHANGED %-28s size %s -> %s" % (name, a.shape, b.shape))
            changed += 1
            continue
        frac = float((np.abs(a - b) > 24).mean())
        tag = "CHANGED" if frac > threshold else "same   "
        if tag == "CHANGED":
            changed += 1
        print("%s %-28s %.4f of pixels differ" % (tag, name, frac))
    print("stations: %d changed, %d flicker, %d without reference; %s"
          % (changed, flicker, missing, "STATIONS OK" if not (changed or flicker) else "STATIONS DIFFER"))
    return 1 if (changed or flicker) else 0


if __name__ == "__main__":
    sys.exit(main())
