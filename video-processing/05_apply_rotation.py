#!/usr/bin/env python3
"""
Apply a precomputed per-frame rotation to a stabilized moon video.

Dumb and pixel-only: reads `stereo_angles.json` (emitted by
04_simulate_rotation.py) and warps each frame by `-angles_deg[i]` so the
projected Boston→Santiago baseline ends up along the image's horizontal
axis (stereo convention).

Usage:
    uv run python 05_apply_rotation.py \\
        <stabilized.mp4> <stereo_angles.json> [-o out.mp4] [--preview N]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply a precomputed stereo-correction rotation to a stabilized video.")
    parser.add_argument("video", help="Stabilized video (output of 02_stabilize.py)")
    parser.add_argument("angles", help="stereo_angles.json (from 04_simulate_rotation.py)")
    parser.add_argument("-o", "--output", default=None,
                        help="Output path (default: <video>_rotated.mp4)")
    parser.add_argument("--preview", type=int, default=None,
                        help="Only write the first N frames")
    args = parser.parse_args()

    with open(args.angles) as f:
        angles_doc = json.load(f)
    frame_angles = np.asarray(angles_doc["angles_deg"], dtype=np.float32)
    angles_source = angles_doc.get("source_video")

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: cannot open {args.video}", file=sys.stderr)
        sys.exit(1)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if angles_source and angles_source != Path(args.video).name:
        print(f"Warning: angles JSON was produced for '{angles_source}', "
              f"applying to '{Path(args.video).name}'", file=sys.stderr)
    if len(frame_angles) < total:
        print(f"Error: angles JSON has {len(frame_angles)} entries but video has "
              f"{total} frames — regenerate stereo_angles.json", file=sys.stderr)
        sys.exit(1)

    if args.preview is not None:
        total = min(total, args.preview)

    if args.output is None:
        args.output = str(Path(args.video).parent / (Path(args.video).stem + "_rotated.mp4"))

    print(f"Video: {total} frames, {width}x{height} @ {fps:g} fps")
    print(f"Angles: {len(frame_angles)} entries from {Path(args.angles).name}")
    print(f"  range: [{frame_angles.min():+.3f}°, {frame_angles.max():+.3f}°]")

    if shutil.which("ffmpeg") is None:
        print("Error: ffmpeg not found on PATH", file=sys.stderr)
        sys.exit(1)
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}", "-r", f"{fps}",
        "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "medium", "-crf", "18",
        "-movflags", "+faststart",
        args.output,
    ]
    writer = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    assert writer.stdin is not None

    center = (width / 2, height / 2)
    print(f"\nRotating...")
    try:
        for i in tqdm(range(total), desc="  frames"):
            ret, frame = cap.read()
            if not ret:
                break
            angle = -float(frame_angles[i])
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            out = cv2.warpAffine(frame, M, (width, height),
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            writer.stdin.write(out.tobytes())
    finally:
        writer.stdin.close()
        rc = writer.wait()
        cap.release()
    if rc != 0:
        print(f"Error: ffmpeg exited with code {rc}", file=sys.stderr)
        sys.exit(rc)

    print(f"\nDone! {args.output}")
    print(f"  {width}x{height}, {total} frames, {total/fps:.1f}s")


if __name__ == "__main__":
    main()
