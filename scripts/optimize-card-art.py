#!/usr/bin/env python3
"""Compress house-rule Skull King faces into public/cards/*.webp.

Enlarges the painted top-left and bottom-right corner badges (numbers,
suit marks, and special icons) so they stay readable at hand-card size.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "cards"
SRC = Path("/workspace/card-art/originals")
LONG_SIDE = 1100
WEBP_QUALITY = 80

# Badge enlargement. Scale is applied about the corner-side of the badge
# so growth runs inward; specials fade sooner so names stay visible.
BORDER = 70
CENTER_INSET = 200
RADIUS_SPECIAL = 232
RADIUS_NUMBER = 286
SCALE = 1.58
FEATHER = 42
CORNER_SHIFT = 26
SPECIAL_FADE = (500, 590)
NUMBER_FADE = (700, 820)

ART = {}
for rank in range(1, 15):
    ART[f"yellow-{rank}"] = 80 - rank  # 79..66
    ART[f"green-{rank}"] = 42 - rank   # 41..28
    ART[f"purple-{rank}"] = 66 - rank  # 65..52
for rank in range(1, 14):
    ART[f"black-{rank}"] = 16 - rank   # 15..3 for ranks 1..13
ART["black-14"] = 1
ART["black-14-1"] = 2
ART["kraken"] = 18
ART["whiteWhale"] = 19
ART["escape"] = 23
ART["tigress-0"] = 26
ART["tigress-1"] = 27
ART["skullKing"] = 42
ART["mermaid-0"] = 43
ART["mermaid-1"] = 44
for i, n in enumerate((46, 47, 48, 49, 50)):
    ART[f"pirate-{i}"] = n

FORBIDDEN = {51, 80}  # Buggy, duplicate escape

SPECIAL_NAMES = {
    "kraken", "whiteWhale", "escape", "tigress-0", "tigress-1",
    "skullKing", "mermaid-0", "mermaid-1",
    "pirate-0", "pirate-1", "pirate-2", "pirate-3", "pirate-4",
}


def src(n: int) -> Path:
    return SRC / f"正面-{n}.png"


def _feathered_circle(size: tuple[int, int], cx: float, cy: float, radius: float, feather: float) -> np.ndarray:
    ww, hh = size
    ys = np.arange(hh, dtype=np.float32)[:, None]
    xs = np.arange(ww, dtype=np.float32)[None, :]
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    feat = max(feather, 1.0)
    alpha = np.clip((radius + feat - d) / (2 * feat), 0, 1)
    return (1 - np.cos(alpha * np.pi)) / 2


def enlarge_corner_badges(im: Image.Image, special: bool) -> Image.Image:
    rgb = im.convert("RGB")
    w, h = rgb.size
    base = rgb.convert("RGBA")
    fade_in, fade_out = SPECIAL_FADE if special else NUMBER_FADE
    radius = RADIUS_SPECIAL if special else RADIUS_NUMBER
    for corner in ("TL", "BR"):
        if corner == "TL":
            cx, cy = BORDER + CENTER_INSET, BORDER + CENTER_INSET
            tx, ty = BORDER, BORDER
        else:
            cx, cy = w - BORDER - CENTER_INSET, h - BORDER - CENTER_INSET
            tx, ty = w - BORDER, h - BORDER
        vx, vy = tx - cx, ty - cy
        length = math.hypot(vx, vy) or 1.0
        ux, uy = vx / length, vy / length
        ax, ay = cx + ux * radius, cy + uy * radius
        pad = int(radius + FEATHER + 8)
        x0, y0 = max(0, int(round(cx - pad))), max(0, int(round(cy - pad)))
        x1, y1 = min(w, int(round(cx + pad))), min(h, int(round(cy + pad)))
        crop = rgb.crop((x0, y0, x1, y1))
        sw, sh = max(1, round(crop.size[0] * SCALE)), max(1, round(crop.size[1] * SCALE))
        scaled = crop.resize((sw, sh), Image.Resampling.LANCZOS)
        # Keep the corner-side point fixed, then ease the badge a little closer to the frame.
        px = int(round(ax + SCALE * (x0 - ax) + ux * CORNER_SHIFT))
        py = int(round(ay + SCALE * (y0 - ay) + uy * CORNER_SHIFT))
        ncx = ax + SCALE * (cx - ax) + ux * CORNER_SHIFT
        ncy = ay + SCALE * (cy - ay) + uy * CORNER_SHIFT
        circle = _feathered_circle((sw, sh), ncx - px, ncy - py, radius * SCALE, FEATHER * SCALE)
        # Soft cap so enlarged specials do not swallow bottom names.
        ys = np.arange(sh, dtype=np.float32)[:, None] + py
        xs = np.arange(sw, dtype=np.float32)[None, :] + px
        if corner == "TL":
            dist = np.maximum(xs, ys)
        else:
            dist = np.maximum((w - 1) - xs, (h - 1) - ys)
        span = max(fade_out - fade_in, 1.0)
        cap = np.clip((fade_out - dist) / span, 0, 1)
        cap = (1 - np.cos(cap * np.pi)) / 2
        alpha = np.clip(circle * cap, 0, 1)
        mask = Image.fromarray((alpha * 255).astype(np.uint8), mode="L")
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        layer.paste(scaled.convert("RGBA"), (px, py))
        full = Image.new("L", (w, h), 0)
        full.paste(mask, (px, py))
        la = np.array(full)
        la[:BORDER, :] = 0
        la[h - BORDER :, :] = 0
        la[:, :BORDER] = 0
        la[:, w - BORDER :] = 0
        layer.putalpha(Image.fromarray(la, mode="L"))
        base = Image.alpha_composite(base, layer)
    return base.convert("RGB")



COLOR_SUITS = ("yellow-", "green-", "purple-")


def bolden_rank_numbers(im: Image.Image) -> Image.Image:
    """Thicken the painted rank glyphs on colour-suit badges only.

    Leaves the circular frame and any +10/+20 bonus marks alone.
    """
    arr = np.array(im.convert("RGB"))
    h, w = arr.shape[:2]
    scale = h / 1100.0
    frame = max(8, int(round(34 * scale)))
    region = max(80, int(round(280 * scale)))
    number_h = max(40, int(round(125 * scale)))
    # 3 / 2 in 784×1100 webp space (the proven prototype); scale up for the 1824×2560 original.
    black_r = max(2, int(round(3 * scale)))
    outline_r = max(1, int(round(2 * scale)))
    out = arr.copy()
    for corner in ("TL", "BR"):
        if corner == "TL":
            x0, y0 = frame, frame
            x1, y1 = min(w, frame + region), min(h, frame + region)
        else:
            x0, y0 = max(0, w - frame - region), max(0, h - frame - region)
            x1, y1 = w - frame, h - frame
        roi = arr[y0:y1, x0:x1]
        lum = roi.mean(axis=2)
        dark = lum < 42
        ys, xs = np.where(dark)
        if len(xs) < 80:
            continue
        bw, bh = int(xs.max() - xs.min()), int(ys.max() - ys.min())
        if bh > bw + max(12, int(16 * scale)):
            if corner == "TL":
                ycut = int(ys.min() + max(bw, number_h) + 8 * scale)
                keep = ys <= ycut
            else:
                ycut = int(ys.max() - max(bw, number_h) - 8 * scale)
                keep = ys >= ycut
            if int(keep.sum()) >= 80:
                xs, ys = xs[keep], ys[keep]
                dark = np.zeros_like(dark)
                dark[ys, xs] = True
        cx, cy = float(xs.mean()), float(ys.mean())
        rad = max(float(np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()) * 1.05, 36 * scale)
        yy, xx = np.ogrid[0:roi.shape[0], 0:roi.shape[1]]
        core = dark & (((xx - cx) ** 2 + (yy - cy) ** 2) <= rad ** 2)
        if int(core.sum()) < 80:
            continue
        mask = Image.fromarray((core.astype(np.uint8) * 255), "L")
        k = black_r * 2 + 1
        if k % 2 == 0:
            k += 1
        dil = np.array(mask.filter(ImageFilter.MaxFilter(k))) > 127
        ok = outline_r * 2 + 1
        if ok % 2 == 0:
            ok += 1
        ring = np.array(Image.fromarray((dil.astype(np.uint8) * 255), "L").filter(ImageFilter.MaxFilter(ok))) > 127
        ring = ring & ~dil
        sub = out[y0:y1, x0:x1]
        near = np.array(mask.filter(ImageFilter.MaxFilter(max(9, int(9 * scale) | 1)))) > 127
        light = near & (lum > 190)
        lc = roi[light].mean(axis=0) if light.any() else np.array([236, 236, 228])
        darkc = roi[core].mean(axis=0)
        sub[ring] = lc
        sub[dil] = darkc
    return Image.fromarray(out)


def compress_one(name: str, number: int) -> tuple[str, int, tuple[int, int]]:
    path = src(number)
    if not path.exists():
        raise FileNotFoundError(path)
    if number in FORBIDDEN:
        raise RuntimeError(f"refusing to pack unused original {number}")
    im = Image.open(path)
    im = enlarge_corner_badges(im, special=name in SPECIAL_NAMES)
    if name.startswith(COLOR_SUITS):
        im = bolden_rank_numbers(im)
    w, h = im.size
    scale = LONG_SIDE / max(w, h)
    if scale < 1:
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    dest = OUT / f"{name}.webp"
    im.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    return name, dest.stat().st_size, im.size


def main() -> int:
    if not SRC.is_dir():
        print(f"missing originals: {SRC}", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not only:
        for old in OUT.glob("*.webp"):
            old.unlink()
        names = sorted(ART.keys())
    else:
        names = only
    sizes = []
    for name in names:
        number = ART[name]
        name, size, dim = compress_one(name, number)
        sizes.append((size, name, dim))
        print(f"{name:16} {dim[0]}x{dim[1]}  {size/1024:.1f} KB  (正面-{number})")
    total = sum(s for s, _, _ in sizes)
    biggest = max(sizes)
    print(f"wrote {len(sizes)} files, {total/1024/1024:.2f} MB, largest {biggest[1]} {biggest[0]/1024:.1f} KB")
    if any(s > 200 * 1024 for s, _, _ in sizes):
        print("warning: some files exceed 200 KB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
