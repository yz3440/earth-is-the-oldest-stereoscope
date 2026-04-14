#!/usr/bin/env python3
"""
Moon Video Tracker — phase-correlation frame-to-frame translation.

Tracks the moon's translation across a video via `cv2.phaseCorrelate`,
periodically re-anchoring to frame 0 to bound cumulative drift, gates
low-response frames (clouds / blur / eclipse dimming) as unreliable, then
interpolates them from neighbors and smooths the whole curve with
Savitzky-Golay.

`--scale N` downsamples grayscale frames by N× before correlation for ~N²
speedup (offsets are scaled back to original resolution before writing).
`--scale 2` is the old `01a_track_moon_fast.py` behavior; `--scale 1`
matches the old `01_track_moon.py` exactly.

Usage:
    uv run python 01_track.py <video_path> [--scale N] [--preview N]
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import savgol_filter
from tqdm import tqdm

REANCHOR_INTERVAL = 100  # re-anchor to frame 0 every N frames to bound drift
MIN_RESPONSE = 0.15      # phaseCorrelate response below this = unreliable


def phase_correlate(ref: np.ndarray, cur: np.ndarray, hann: np.ndarray) -> tuple[float, float, float]:
    """Phase correlation between two grayscale frames.

    Returns (dx, dy, response). dx/dy is the shift of `cur` relative to `ref`.
    """
    (dx, dy), response = cv2.phaseCorrelate(ref.astype(np.float64), cur.astype(np.float64), hann)
    return dx, dy, response


def main() -> None:
    parser = argparse.ArgumentParser(description="Moon Video Tracker (phase correlation)")
    parser.add_argument("video", help="Path to video file")
    parser.add_argument("--output", "-o", default=None,
                        help="Output JSON path (default: <video>_offsets.json)")
    parser.add_argument("--preview", type=int, default=None,
                        help="Only process first N frames")
    parser.add_argument("--scale", type=int, default=1,
                        help="Downsample factor for phase correlation (default 1 = full "
                             "resolution; 2 = ~4x speedup, was 01a_track_moon_fast.py)")
    parser.add_argument("--reanchor", type=int, default=REANCHOR_INTERVAL,
                        help=f"Re-anchor to frame 0 every N frames (default {REANCHOR_INTERVAL})")
    args = parser.parse_args()

    video_path = args.video
    scale = max(1, args.scale)
    if args.output is None:
        args.output = str(Path(video_path).parent / (Path(video_path).stem + "_offsets.json"))

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Cannot open {video_path}")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if args.preview is not None:
        total = min(total, args.preview)

    small_w = width // scale
    small_h = height // scale

    print(f"Video: {Path(video_path).name}")
    print(f"  {width}x{height}, {fps}fps, {total} frames ({total / fps:.1f}s)")
    if scale > 1:
        print(f"  Downsampling {scale}x to {small_w}x{small_h} for phase correlation")
    print(f"  Re-anchor interval: every {args.reanchor} frames")

    ret, ref_frame = cap.read()
    if not ret:
        print("Error: Cannot read first frame")
        sys.exit(1)

    ref_gray_full = cv2.cvtColor(ref_frame, cv2.COLOR_BGR2GRAY)
    ref_gray = (cv2.resize(ref_gray_full, (small_w, small_h), interpolation=cv2.INTER_AREA)
                if scale > 1 else ref_gray_full)
    prev_gray = ref_gray.copy()
    hann = cv2.createHanningWindow((small_w, small_h), cv2.CV_64F)

    cum_dx, cum_dy = 0.0, 0.0
    raw_offsets = np.zeros((total, 2), dtype=np.float64)
    responses = np.zeros(total, dtype=np.float64)
    reliable = np.ones(total, dtype=bool)

    responses[0] = 1.0
    bad_count = 0
    reanchor_count = 0

    print(f"\nTracking {total} frames...")
    for i in tqdm(range(1, total), desc="  Phase correlating"):
        ret, frame = cap.read()
        if not ret:
            total = i
            raw_offsets = raw_offsets[:total]
            responses = responses[:total]
            reliable = reliable[:total]
            break

        gray_full = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = (cv2.resize(gray_full, (small_w, small_h), interpolation=cv2.INTER_AREA)
                if scale > 1 else gray_full)

        dx_delta, dy_delta, resp_delta = phase_correlate(prev_gray, gray, hann)

        if resp_delta < MIN_RESPONSE:
            reliable[i] = False
            raw_offsets[i] = raw_offsets[i - 1]
            responses[i] = resp_delta
            bad_count += 1
            continue

        cum_dx += dx_delta
        cum_dy += dy_delta

        if (i % args.reanchor) == 0:
            anchor_dx, anchor_dy, anchor_resp = phase_correlate(ref_gray, gray, hann)
            if anchor_resp > MIN_RESPONSE:
                cum_dx = anchor_dx
                cum_dy = anchor_dy
                reanchor_count += 1

        raw_offsets[i] = [-cum_dx * scale, -cum_dy * scale]
        responses[i] = resp_delta
        prev_gray = gray
    cap.release()

    print(f"\n  Bad frames (low quality/response): {bad_count}")
    print(f"  Re-anchors applied: {reanchor_count}")

    unreliable_indices = np.where(~reliable)[0]
    interpolated_count = len(unreliable_indices)
    if interpolated_count > 0:
        print(f"  Interpolating {interpolated_count} unreliable frames...")
        good_indices = np.where(reliable)[0]
        if len(good_indices) >= 2:
            for axis in range(2):
                raw_offsets[unreliable_indices, axis] = np.interp(
                    unreliable_indices, good_indices, raw_offsets[good_indices, axis])

    smooth_window = min(51, total - 1)
    if smooth_window % 2 == 0:
        smooth_window -= 1
    if smooth_window >= 5:
        print(f"  Applying Savitzky-Golay smoothing (window={smooth_window})...")
        smoothed = raw_offsets.copy()
        for axis in range(2):
            smoothed[:, axis] = savgol_filter(raw_offsets[:, axis], smooth_window, 3)
    else:
        smoothed = raw_offsets

    offsets_list = []
    for i in range(total):
        entry = {
            "frame": i,
            "dx": round(float(smoothed[i, 0]), 2),
            "dy": round(float(smoothed[i, 1]), 2),
            "response": round(float(responses[i]), 4),
        }
        if not reliable[i]:
            entry["interpolated"] = True
        offsets_list.append(entry)

    output_data = {
        "video": str(Path(video_path).name),
        "width": width,
        "height": height,
        "fps": fps,
        "scale": scale,
        "total_frames": total,
        "reanchors": reanchor_count,
        "interpolated_frames": interpolated_count,
        "offsets": offsets_list,
    }
    with open(args.output, "w") as f:
        json.dump(output_data, f, indent=2)

    dxs = smoothed[:, 0]
    dys = smoothed[:, 1]
    print(f"\nDone! Saved {total} frame offsets to {args.output}")
    print(f"  dx range: [{dxs.min():.1f}, {dxs.max():.1f}]")
    print(f"  dy range: [{dys.min():.1f}, {dys.max():.1f}]")
    print(f"  Interpolated frames: {interpolated_count}")


if __name__ == "__main__":
    main()
