#!/usr/bin/env python3
"""
Compress a moon video for web playback.

H.264 / yuv420p / +faststart so it streams in any browser. CRF 30 with
the slow preset — for a stabilized moon on a black sky this gives
~7-8x reduction over the source bitrate while staying visually
indistinguishable.

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
    parser = argparse.ArgumentParser(description="H.264 compress a video for web playback.")
    parser.add_argument("video", help="Input video")
    parser.add_argument("-o", "--output", default=None,
                        help="Output path (default: <video>_web.mp4)")
    parser.add_argument("--crf", type=int, default=30,
                        help="x264 CRF, lower = higher quality (default: 30)")
    parser.add_argument("--preset", default="slow",
                        help="x264 preset (default: slow)")
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
        "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
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
