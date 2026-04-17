#!/usr/bin/env python3
"""
Simulate the per-frame stereo-correction rotation curve for a stabilized
moon video. Pure astronomy — does not touch the video pixels.

Inputs:
    * `<stabilized.mp4>` (opened only to read fps + total_frames)
    * `video_meta.json`  (camera + start UTC)
    * `frame_to_utc.json` (anchor table from 03_calibrate.py)

Output:
    * `stereo_angles.json` — per-frame `angles_deg` + `frame_real_times_sec`,
      plus metadata. Consumed by 05_apply_rotation.py and by the in-browser
      viewer (web-2).

The correction is `astro.stereo_correction(observer, moon, baseline)` with a
shared Boston→Santiago baseline. See astro.py for details.

Usage:
    uv run python 04_simulate_rotation.py \\
        <stabilized.mp4> <video_meta.json> <frame_to_utc.json> \\
        [-o stereo_angles.json]
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
    if a_frames[-1] < total - 1:
        slope = (a_secs[-1] - a_secs[-2]) / (a_frames[-1] - a_frames[-2])
        mask = idxs > a_frames[-1]
        times[mask] = a_secs[-1] + slope * (idxs[mask] - a_frames[-1])
    if a_frames[0] > 0:
        slope = (a_secs[1] - a_secs[0]) / (a_frames[1] - a_frames[0])
        mask = idxs < a_frames[0]
        times[mask] = a_secs[0] + slope * (idxs[mask] - a_frames[0])
    return times


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Simulate per-frame stereo-correction rotation angles.")
    parser.add_argument("video", help="Stabilized video (opened only for fps/frame count)")
    parser.add_argument("meta", help="video_meta.json for the camera")
    parser.add_argument("anchors", help="frame_to_utc.json from 03_calibrate.py")
    parser.add_argument("-o", "--out", default=None,
                        help="Output stereo_angles.json (default: <video-dir>/stereo_angles.json)")
    parser.add_argument("--angle-cache-step", type=float, default=5.0,
                        help="Seconds between precomputed stereo_correction "
                             "samples; per-frame angles are linearly interpolated "
                             "from this grid (default: 5.0)")
    parser.add_argument("--angle-decimals", type=int, default=4,
                        help="Rounding for angles_deg / frame_real_times_sec "
                             "in the emitted JSON (default 4 ≈ 0.36 arcsec)")
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
    cap.release()

    print(f"Camera: {camera_name}")
    print(f"Video start UTC: {video_start.isoformat()}")
    print(f"Video: {total} frames @ {fps:g} fps")
    print(f"Anchors: {len(anchor_data['anchors'])} rows from {Path(args.anchors).name}")
    print(f"Effective fps from calibrator: {anchor_data.get('effective_timelapse_fps', 'n/a')}")

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
        moon_pos = astro.moon_j2000(when)
        baseline = astro.observer_j2000(astro.SANTIAGO, when) - astro.observer_j2000(astro.BOSTON, when)
        sim_angles[i] = astro.stereo_correction(this_pos, moon_pos, baseline)
    print(f"  stereo_correction range: [{sim_angles.min():+.3f}°, {sim_angles.max():+.3f}°]")

    frame_angles = np.interp(frame_real_times, sim_secs, sim_angles)

    out_path = args.out or str(Path(args.video).parent / "stereo_angles.json")
    nd = max(0, int(args.angle_decimals))
    angles_doc = {
        "source_video": Path(args.video).name,
        "camera": camera_name,
        "video_start_utc": video_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "effective_timelapse_fps": anchor_data.get("effective_timelapse_fps"),
        "video_fps": fps,
        "total_frames": int(total),
        "angle_cache_step_sec": sim_step,
        "angle_range_deg": [float(sim_angles.min()), float(sim_angles.max())],
        "frame_real_times_sec": [round(float(t), nd) for t in frame_real_times],
        "angles_deg": [round(float(a), nd) for a in frame_angles],
    }
    with open(out_path, "w") as f:
        json.dump(angles_doc, f)  # compact single-line
    size = Path(out_path).stat().st_size
    print(f"\nStereo-angles JSON → {out_path}")
    print(f"  {total} frames, {nd}-decimal precision, {size/1024:.1f} KB")
    print(f"Use with: 05_apply_rotation.py <stabilized.mp4> {out_path}")


if __name__ == "__main__":
    main()
