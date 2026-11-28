#!/usr/bin/env python3
"""Compress house-rule Skull King faces into public/cards/*.webp."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "cards"
# Sources live outside the repo in this workspace.
SRC = Path("/workspace/card-art/originals")
LONG_SIDE = 1100
WEBP_QUALITY = 80

def src(n: int) -> Path:
    return SRC / f"正面-{n}.png"

# dest name -> original number
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

def compress_one(name: str, number: int) -> tuple[str, int, tuple[int, int]]:
    path = src(number)
    if not path.exists():
        raise FileNotFoundError(path)
    if number in FORBIDDEN:
        raise RuntimeError(f"refusing to pack unused original {number}")
    im = Image.open(path)
    im = im.convert("RGB")
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
    # Remove previous generated faces so unused files cannot linger.
    for old in OUT.glob("*.webp"):
        old.unlink()
    sizes = []
    for name, number in sorted(ART.items(), key=lambda kv: kv[0]):
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
