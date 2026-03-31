#!/usr/bin/env python3
"""
Moon Video Rotator (Gaze Correction)

Applies per-frame rotation from the viewer's exported keyframes JSON to a
stabilized video. This aligns the stereo baseline horizontally so the two
camera views form a proper stereo pair.

Run this AFTER stabilize_moon.py.

The keyframes JSON contains rotation values sampled every 30s of real time.
This script uses video_meta.json to map video frames to real-time seconds,
then interpolates to get a rotation for every frame.

Usage:
    uv run rotate_moon.py <stabilized.mp4> <keyframes.json> <video_meta.json>
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def main():
    parser = argparse.ArgumentParser(description="Moon Video Rotator (Gaze Correction)")
    parser.add_argument("video", help="Stabilized video (from stabilize_moon.py)")
    parser.add_argument("keyframes", help="Keyframes JSON exported from the viewer")
    parser.add_argument("meta", help="video_meta.json for this video")
    parser.add_argument("--output", "-o", default=None,
                        help="Output path (default: <video>_rotated.mp4)")
    parser.add_argument("--preview", type=int, default=None,
                        help="Only process first N frames")
    args = parser.parse_args()

    # Load video metadata
    with open(args.meta) as f:
        meta = json.load(f)

    camera = meta["camera"]  # "boston" or "santiago"
    timelapse_fps = meta["timelapse_fps"]

    # Load keyframes
    with open(args.keyframes) as f:
        keyframes = json.load(f)

    # Pick the right columns based on camera
    time_key = f"{camera}_video_sec"
    rot_key = f"{camera}_rotation_deg"

    # Build interpolation arrays from keyframes where video time >= 0
    kf_times = []
    kf_rots = []
    for kf in keyframes:
        t = kf[time_key]
        if t >= 0:
            kf_times.append(t)
            kf_rots.append(kf[rot_key])

    if len(kf_times) < 2:
        print(f"Error: Not enough keyframes with {time_key} >= 0")
        sys.exit(1)

    kf_times = np.array(kf_times)
    kf_rots = np.array(kf_rots)

    print(f"Camera: {camera}")
    print(f"Timelapse rate: {timelapse_fps} frame/s real time")
    print(f"Keyframes: {len(kf_times)} points, "
          f"time range [{kf_times[0]:.1f}s, {kf_times[-1]:.1f}s]")
    print(f"Rotation range: [{kf_rots.min():.3f}°, {kf_rots.max():.3f}°]")

    # Open video
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: Cannot open {args.video}")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if args.preview is not None:
        total = min(total, args.preview)

    if args.output is None:
        args.output = str(Path(args.video).parent / (Path(args.video).stem + "_rotated.mp4"))

    print(f"\nVideo: {Path(args.video).name} ({width}x{height}, {fps}fps, {total} frames)")

    # Each video frame = 1/timelapse_fps real seconds
    # (timelapse_fps=1 means each frame is 1 real second)
    frame_real_times = np.arange(total) / timelapse_fps
    frame_rots = np.interp(frame_real_times, kf_times, kf_rots)

    print(f"Real time span: {frame_real_times[-1]:.0f}s ({frame_real_times[-1]/3600:.2f}h)")
    print(f"Per-frame rotation: [{frame_rots.min():.3f}°, {frame_rots.max():.3f}°]")

    # Output video (same fps as input)
    fourcc = cv2.VideoWriter.fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.output, fourcc, fps, (width, height))
    if not writer.isOpened():
        print("Error: Cannot create output video")
        sys.exit(1)

    center = (width / 2, height / 2)

    print(f"\nRotating...")
    for i in tqdm(range(total), desc="  Processing"):
        ret, frame = cap.read()
        if not ret:
            break

        angle = frame_rots[i]
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        out = cv2.warpAffine(
            frame, M, (width, height),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0),
        )
        writer.write(out)

    writer.release()
    cap.release()

    print(f"\nDone! {args.output}")
    print(f"  {width}x{height}, {total} frames, {total/fps:.1f}s")


if __name__ == "__main__":
    main()
