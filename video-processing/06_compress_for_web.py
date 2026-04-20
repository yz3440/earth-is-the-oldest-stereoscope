#!/usr/bin/env python3
"""
Compress a moon video for web playback.

AV1 (SVT-AV1) / yuv420p10le / +faststart. Played by all modern browsers
(Chrome, Firefox, Edge, Safari 17+). For a stabilized moon on a black
sky the content is extremely low-entropy, so we lean hard on CRF:
default 45 gives a very small file while staying visually clean.

CRF is a quality knob (0–63 for AV1). Higher = smaller file.

Usage:
    uv run python compress_for_web.py <input.mp4> [-o out.mp4] [--crf N]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="AV1 compress a video for web playback.")
    parser.add_argument("video", help="Input video")
    parser.add_argument("-o", "--output", default=None,
                        help="Output path (default: <video>_web.mp4)")
    parser.add_argument("--crf", type=int, default=45,
                        help="SVT-AV1 CRF 0–63, higher = smaller file (default: 45)")
    parser.add_argument("--preset", type=int, default=4,
                        help="SVT-AV1 preset 0–13, lower = slower/smaller (default: 4)")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("Error: ffmpeg not found on PATH", file=sys.stderr)
        sys.exit(1)

    src = Path(args.video)
    if not src.exists():
        print(f"Error: input not found: {src}", file=sys.stderr)
        sys.exit(1)

    out = Path(args.output) if args.output else src.with_name(src.stem + "_web.mp4")

    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-c:v", "libsvtav1", "-preset", str(args.preset), "-crf", str(args.crf),
        "-svtav1-params", "tune=0",
        "-pix_fmt", "yuv420p10le", "-movflags", "+faststart", "-an",
        str(out),
    ]
    print(" ".join(cmd))
    rc = subprocess.call(cmd)
    if rc != 0:
        sys.exit(rc)

    src_mb = src.stat().st_size / 1e6
    out_mb = out.stat().st_size / 1e6
    print(f"\n{src.name}: {src_mb:.1f} MB → {out.name}: {out_mb:.1f} MB "
          f"({src_mb / out_mb:.1f}x reduction)")


if __name__ == "__main__":
    main()
