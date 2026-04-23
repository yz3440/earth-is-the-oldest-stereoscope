#!/usr/bin/env python3
"""
Compress a moon video for web playback.

HEVC (libx265, Main 10) / yuv420p10le / +faststart, tagged `hvc1` so
Safari will play it. Played natively by all modern browsers: Safari
(every Apple device for years), Chrome/Edge 107+, Firefox 126+.

We previously used AV1 (SVT-AV1); Safari refused the files with
MEDIA_ERR_SRC_NOT_SUPPORTED because it only hardware-decodes 8-bit AV1,
not 10-bit. HEVC Main 10 is decoded natively on every Apple device.

CRF is a quality knob (0–51 for x265). Higher = smaller file. Moon on
black sky is extremely low-entropy so CRF 28 still gives a small file.

Usage:
    uv run python 06_compress_for_web.py <input.mp4> [-o out.mp4] [--crf N]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="HEVC compress a video for web playback.")
    parser.add_argument("video", help="Input video")
    parser.add_argument("-o", "--output", default=None,
                        help="Output path (default: <video>_web.mp4)")
    parser.add_argument("--crf", type=int, default=28,
                        help="x265 CRF 0–51, higher = smaller file (default: 28)")
    parser.add_argument("--preset", default="medium",
                        help="x265 preset: ultrafast…placebo (default: medium)")
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
        "-c:v", "libx265", "-preset", args.preset, "-crf", str(args.crf),
        "-tag:v", "hvc1",
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
