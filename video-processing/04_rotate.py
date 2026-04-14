#!/usr/bin/env python3
"""
Apply per-frame stereo-correction rotation to a stabilized moon video.

Computes the correction on-the-fly from astro.py — no keyframes JSON
required. Reads the frame_to_utc anchor table produced by 03_calibrate.py
to map each frame index to an absolute UTC, then asks
astro.stereo_correction for the roll angle that brings the shared
Boston→Santiago baseline horizontal in the image plane.

Run this AFTER 03_calibrate.py has produced frame_to_utc.json.

Usage:
    uv run python 04_rotate.py \\
        <stabilized.mp4> <video_meta.json> <frame_to_utc.json> \\
        [-o out.mp4] [--preview N]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

import astro


def parse_iso_utc(s: str) -> datetime:
    s = s.strip().replace(" UTC", "").replace("Z", "").replace("T", " ")
    fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in s else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


def build_frame_real_times(total: int,
                           anchors: list[dict],
                           video_start: datetime) -> np.ndarray:
    """frame_idx → seconds-since-video-start, piecewise-linear through anchors
    with linear extrapolation past the endpoints.
    """
    if len(anchors) < 2:
        raise ValueError("anchor table has <2 entries")
    a_frames = np.array([a["frame_idx"] for a in anchors], float)
    a_secs = np.array([(parse_iso_utc(a["utc"]) - video_start).total_seconds()
                       for a in anchors])
    order = np.argsort(a_frames)
    a_frames, a_secs = a_frames[order], a_secs[order]

    idxs = np.arange(total, dtype=float)
    times = np.interp(idxs, a_frames, a_secs)
    # Extrapolate linearly past the final anchor.
    if a_frames[-1] < total - 1:
        slope = (a_secs[-1] - a_secs[-2]) / (a_frames[-1] - a_frames[-2])
        mask = idxs > a_frames[-1]
        times[mask] = a_secs[-1] + slope * (idxs[mask] - a_frames[-1])
    # Extrapolate linearly before the first anchor.
    if a_frames[0] > 0:
        slope = (a_secs[1] - a_secs[0]) / (a_frames[1] - a_frames[0])
        mask = idxs < a_frames[0]
        times[mask] = a_secs[0] + slope * (idxs[mask] - a_frames[0])
    return times


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply stereo-correction rotation from an anchor table.")
    parser.add_argument("video", help="Stabilized video (output of 02_stabilize_moon.py)")
    parser.add_argument("meta", help="video_meta.json for the camera")
    parser.add_argument("anchors", help="frame_to_utc.json from calibrate.py")
    parser.add_argument("-o", "--output", default=None,
                        help="Output path (default: <video>_rotated.mp4)")
    parser.add_argument("--preview", type=int, default=None,
                        help="Only write the first N frames")
    parser.add_argument("--angle-cache-step", type=float, default=5.0,
                        help="Seconds between precomputed stereo_correction "
                             "samples; per-frame angles are linearly interpolated "
                             "from this grid (default: 5.0)")
    args = parser.parse_args()

    with open(args.meta) as f:
        meta = json.load(f)
    camera_name = meta["camera"]
    video_start = parse_iso_utc(meta["video_start_utc"])
    this_site = astro.BOSTON if camera_name == "boston" else astro.SANTIAGO
    other_site = astro.SANTIAGO if camera_name == "boston" else astro.BOSTON

    with open(args.anchors) as f:
        anchor_data = json.load(f)

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: cannot open {args.video}", file=sys.stderr)
        sys.exit(1)
    fps = cap.get(cv2.CAP_PROP_FPS)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if args.preview is not None:
        total = min(total, args.preview)

    if args.output is None:
        args.output = str(Path(args.video).parent / (Path(args.video).stem + "_rotated.mp4"))

    print(f"Camera: {camera_name}")
    print(f"Video start UTC: {video_start.isoformat()}")
    print(f"Anchors: {len(anchor_data['anchors'])} rows from {Path(args.anchors).name}")
    print(f"Effective fps from calibrator: {anchor_data.get('effective_timelapse_fps', 'n/a')}")

    # Precompute per-frame UTC offsets and stereo-correction angles.
    frame_real_times = build_frame_real_times(total, anchor_data["anchors"], video_start)
    print(f"  Frame 0 UTC    : {video_start + timedelta(seconds=float(frame_real_times[0]))}")
    print(f"  Frame {total-1} UTC: {video_start + timedelta(seconds=float(frame_real_times[-1]))}")

    # Per-frame stereo_correction is ~8 ms from astronomy-engine, so for a
    # 25 k-frame video that's ~200 s of pure astro work. The correction is
    # smooth (sinusoidal-ish over a sidereal day), so precompute on a coarse
    # sim-time grid and linearly interpolate. At 5 s spacing the interp
    # error is well under 1e-3° — see --angle-cache-step to override.
    sim_step = float(args.angle_cache_step)
    print(f"\nPrecomputing stereo-correction angles at {sim_step:g}s cadence...")
    t_lo = frame_real_times.min() - sim_step
    t_hi = frame_real_times.max() + sim_step
    sim_secs = np.arange(t_lo, t_hi + sim_step, sim_step)
    sim_angles = np.empty_like(sim_secs)
    for i, s in enumerate(tqdm(sim_secs, desc="  astro")):
        when = video_start + timedelta(seconds=float(s))
        this_pos = astro.observer_j2000(this_site, when)
        other_pos = astro.observer_j2000(other_site, when)
        moon_pos = astro.moon_j2000(when)
        # Boston→Santiago baseline for both cameras (shared-baseline stereo).
        baseline = astro.observer_j2000(astro.SANTIAGO, when) - astro.observer_j2000(astro.BOSTON, when)
        sim_angles[i] = astro.stereo_correction(this_pos, moon_pos, baseline)
    print(f"  stereo_correction range: [{sim_angles.min():+.3f}°, {sim_angles.max():+.3f}°]")

    # Per-frame correction angles = linear interpolation of sim_angles at frame_real_times.
    frame_angles = np.interp(frame_real_times, sim_secs, sim_angles)

    fourcc = cv2.VideoWriter.fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.output, fourcc, fps, (width, height))
    if not writer.isOpened():
        print("Error: cannot create output video", file=sys.stderr)
        sys.exit(1)

    center = (width / 2, height / 2)
    print(f"\nRotating...")
    for i in tqdm(range(total), desc="  frames"):
        ret, frame = cap.read()
        if not ret:
            break
        # Apply -angle so the projected Boston→Santiago baseline ends up along
        # the image's horizontal axis (stereo convention).
        angle = -float(frame_angles[i])
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        out = cv2.warpAffine(frame, M, (width, height),
                             borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        writer.write(out)
    writer.release()
    cap.release()

    print(f"\nDone! {args.output}")
    print(f"  {width}x{height}, {total} frames, {total/fps:.1f}s")


if __name__ == "__main__":
    main()
