#!/usr/bin/env python3
"""
Compress a moon video for web playback.

Default: HEVC (libx265, Main 10) / yuv420p10le / +faststart, tagged `hvc1`
so Safari will play it. Played natively by all modern browsers: Safari
(every Apple device for years), Chrome/Edge 107+, Firefox 126+.

We previously used AV1 (SVT-AV1); Safari refused the files with
MEDIA_ERR_SRC_NOT_SUPPORTED because it only hardware-decodes 8-bit AV1,
not 10-bit. HEVC Main 10 is decoded natively on every Apple device.

`--codec h264`: 8-bit H.264 High fallback for devices with no hardware
HEVC Main 10 decoder (many Android phones, Firefox Android, Linux
desktop). The viewer probes HEVC support at runtime (frontend/src/
manifest.ts) and loads `<name>_stabilized_h264_web.mp4` when it fails.
The output name MUST end in `_web.mp4` — that suffix is the .gitignore
exception that keeps web encodes tracked.

CRF is a quality knob (0–51). Higher = smaller file. Moon on black sky
is extremely low-entropy so CRF 28 (x265) / 26 (x264) still gives a
small file. x264 needs roughly twice the bitrate of x265 at the same
visual quality, so expect the H.264 file to be 1.5–2× larger.

Usage:
    uv run python 06_compress_for_web.py <input.mp4> [-o out.mp4] [--crf N]
    uv run python 06_compress_for_web.py <input.mp4> --codec h264
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
    parser.add_argument("--codec", choices=("hevc", "h264"), default="hevc",
                        help="hevc = libx265 Main 10 (default); h264 = libx264 High 8-bit fallback")
    parser.add_argument("--crf", type=int, default=None,
                        help="CRF 0–51, higher = smaller file (default: 28 for hevc, 26 for h264)")
    parser.add_argument("--preset", default=None,
                        help="encoder preset: ultrafast…placebo (default: medium for hevc, slow for h264)")
    args = parser.parse_args()

    crf = args.crf if args.crf is not None else (28 if args.codec == "hevc" else 26)
    preset = args.preset if args.preset is not None else ("medium" if args.codec == "hevc" else "slow")

    if shutil.which("ffmpeg") is None:
        print("Error: ffmpeg not found on PATH", file=sys.stderr)
        sys.exit(1)

    src = Path(args.video)
    if not src.exists():
        print(f"Error: input not found: {src}", file=sys.stderr)
        sys.exit(1)

    default_suffix = "_web.mp4" if args.codec == "hevc" else "_h264_web.mp4"
    out = Path(args.output) if args.output else src.with_name(src.stem + default_suffix)

    if args.codec == "hevc":
        codec_args = [
            "-c:v", "libx265", "-preset", preset, "-crf", str(crf),
            "-tag:v", "hvc1",
            "-pix_fmt", "yuv420p10le",
        ]
    else:
        codec_args = [
            "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
            "-profile:v", "high", "-level", "4.0",
            "-pix_fmt", "yuv420p",
        ]

    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        *codec_args,
        "-movflags", "+faststart", "-an",
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
