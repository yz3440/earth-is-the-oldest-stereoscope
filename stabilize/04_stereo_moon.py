#!/usr/bin/env python3
"""
Stereo Moon Compositor

Combines two rotated moon videos (left/right eye) into a side-by-side stereo
video. Aligns frames by UTC time using each video's video_meta.json.

The output spans from the earliest video start to the latest video end.
Frames outside a video's time range are black.

Usage:
    uv run stereo_moon.py <left_video> <left_meta> <right_video> <right_meta>
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def parse_utc(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def main():
    parser = argparse.ArgumentParser(description="Stereo Moon Compositor")
    parser.add_argument("left_video", help="Left eye video (rotated)")
    parser.add_argument("left_meta", help="video_meta.json for left eye")
    parser.add_argument("right_video", help="Right eye video (rotated)")
    parser.add_argument("right_meta", help="video_meta.json for right eye")
    parser.add_argument("--output", "-o", default="stereo_moon.mp4",
                        help="Output path (default: stereo_moon.mp4)")
    parser.add_argument("--fps", type=float, default=30.0,
                        help="Output video fps (default: 30)")
    parser.add_argument("--preview", type=int, default=None,
                        help="Only process first N output frames")
    args = parser.parse_args()

    # Load metadata
    with open(args.left_meta) as f:
        left_meta = json.load(f)
    with open(args.right_meta) as f:
        right_meta = json.load(f)

    left_start = parse_utc(left_meta["video_start_utc"])
    right_start = parse_utc(right_meta["video_start_utc"])
    left_tlfps = left_meta["timelapse_fps"]
    right_tlfps = right_meta["timelapse_fps"]

    # Open videos
    left_cap = cv2.VideoCapture(args.left_video)
    right_cap = cv2.VideoCapture(args.right_video)
    if not left_cap.isOpened() or not right_cap.isOpened():
        print("Error: Cannot open one or both videos")
        sys.exit(1)

    left_total = int(left_cap.get(cv2.CAP_PROP_FRAME_COUNT))
    right_total = int(right_cap.get(cv2.CAP_PROP_FRAME_COUNT))
    left_w = int(left_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    left_h = int(left_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    right_w = int(right_cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    right_h = int(right_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Compute real-time duration of each video
    left_duration_s = left_total / left_tlfps
    right_duration_s = right_total / right_tlfps

    left_end = datetime.fromtimestamp(
        left_start.timestamp() + left_duration_s, tz=timezone.utc)
    right_end = datetime.fromtimestamp(
        right_start.timestamp() + right_duration_s, tz=timezone.utc)

    # Global time range
    global_start = min(left_start, right_start)
    global_end = max(left_end, right_end)
    global_duration_s = (global_end - global_start).total_seconds()

    # Output: 1 frame per real second, played back at output fps
    total_output_frames = int(global_duration_s)
    if args.preview is not None:
        total_output_frames = min(total_output_frames, args.preview)

    # Use the larger dimensions for the output frame size
    frame_w = max(left_w, right_w)
    frame_h = max(left_h, right_h)
    out_w = frame_w * 2
    out_h = frame_h

    print(f"Left  ({left_meta['camera']}): {left_w}x{left_h}, {left_total} frames, "
          f"{left_duration_s/3600:.2f}h")
    print(f"  Start: {left_start.isoformat()}")
    print(f"  End:   {left_end.isoformat()}")
    print(f"Right ({right_meta['camera']}): {right_w}x{right_h}, {right_total} frames, "
          f"{right_duration_s/3600:.2f}h")
    print(f"  Start: {right_start.isoformat()}")
    print(f"  End:   {right_end.isoformat()}")
    print(f"\nGlobal time range: {global_start.isoformat()} → {global_end.isoformat()}")
    print(f"  Duration: {global_duration_s:.0f}s ({global_duration_s/3600:.2f}h)")
    print(f"  Output: {out_w}x{out_h}, {total_output_frames} frames at {args.fps}fps")
    print(f"  Playback: {total_output_frames/args.fps:.1f}s")

    # Compute overlap
    overlap_start = max(left_start, right_start)
    overlap_end = min(left_end, right_end)
    if overlap_start < overlap_end:
        overlap_s = (overlap_end - overlap_start).total_seconds()
        print(f"  Overlap: {overlap_s:.0f}s ({overlap_s/3600:.2f}h)")
    else:
        print(f"  Warning: No overlap between videos!")

    # Preload all frames into memory for random access
    # (needed because videos may not start at the same time)
    print(f"\nPreloading left video ({left_total} frames)...")
    left_frames = []
    for _ in tqdm(range(left_total), desc="  Left"):
        ret, frame = left_cap.read()
        if not ret:
            break
        left_frames.append(frame)
    left_cap.release()

    print(f"Preloading right video ({right_total} frames)...")
    right_frames = []
    for _ in tqdm(range(right_total), desc="  Right"):
        ret, frame = right_cap.read()
        if not ret:
            break
        right_frames.append(frame)
    right_cap.release()

    # Output video
    fourcc = cv2.VideoWriter.fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.output, fourcc, args.fps, (out_w, out_h))
    if not writer.isOpened():
        print("Error: Cannot create output video")
        sys.exit(1)

    black_frame = np.zeros((frame_h, frame_w, 3), dtype=np.uint8)

    # Offsets in real seconds from global start to each video start
    left_offset_s = (left_start - global_start).total_seconds()
    right_offset_s = (right_start - global_start).total_seconds()

    print(f"\nCompositing stereo video...")
    for i in tqdm(range(total_output_frames), desc="  Processing"):
        # Real second i since global start
        t = i

        # Left eye: which frame?
        left_sec = t - left_offset_s
        left_idx = int(left_sec * left_tlfps)
        if 0 <= left_idx < len(left_frames):
            left_frame = left_frames[left_idx]
        else:
            left_frame = black_frame

        # Right eye: which frame?
        right_sec = t - right_offset_s
        right_idx = int(right_sec * right_tlfps)
        if 0 <= right_idx < len(right_frames):
            right_frame = right_frames[right_idx]
        else:
            right_frame = black_frame

        # Side by side
        stereo = np.hstack([left_frame, right_frame])
        writer.write(stereo)

    writer.release()

    print(f"\nDone! {args.output}")
    print(f"  {out_w}x{out_h}, {total_output_frames} frames, "
          f"{total_output_frames/args.fps:.1f}s playback")


if __name__ == "__main__":
    main()
