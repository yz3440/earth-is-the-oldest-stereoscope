#!/usr/bin/env python3
"""
Calibrate a stabilized moon video against the analytical raw-view field
rotation curve.

Emits an anchor table `frame_to_utc.json` of (frame_idx, utc) pairs that
04_rotate.py uses to convert each output frame into an absolute UTC, then
computes the stereo correction on-the-fly from astro.py.

Derives the target rotation curve analytically from astronomy-engine — no
viewer involvement, no reference-PNG export.

Pipeline:
    1. Measure cumulative rotation of the real stabilized video via ECC
       (cv2.findTransformECC, Euclidean motion model), sampled every --step
       frames, with clamps for spurious ECC local minima.
    2. Build the analytical target curve `field_angle_in_raw(t)` at 30 s
       cadence from SIM_START to SIM_END, unwrapped and zeroed.
    3. Pass 1 (linear fit): search effective_fps such that interpolating the
       target at `frame_idx / fps` best overlays the measured curve (min
       std of residual).
    4. Pass 2 (per-sample inversion): smooth the measured curve with
       Savitzky-Golay, then for each sample invert the target curve inside
       a ±60 min window around the linear-fit seed UTC.
    5. Emit anchors compatible with 04_rotate.py's --frame-to-utc consumer.

Pass --end-frame only to exclude known-bad tails (e.g. the eclipse-totality
window on Boston where 02_stabilize.py loses lock on the moon).

Usage (full video):
    uv run python 03_calibrate.py \\
        ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized.mp4 \\
        ../videos/yufeng_boston/video_meta.json \\
        -o ../videos/yufeng_boston/frame_to_utc.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.signal import savgol_filter
from tqdm import tqdm

import astro

ECC_CRITERIA = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-6)


def parse_iso_utc(s: str) -> datetime:
    s = s.strip().replace(" UTC", "").replace("Z", "").replace("T", " ")
    fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in s else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


def measure_rotation_ecc(prev_gray: np.ndarray,
                         curr_gray: np.ndarray,
                         init_angle_deg: float = 0.0) -> tuple[float, float]:
    """Return (angle_deg, ecc_score). Positive angle = visual CCW.

    Uses findTransformECC with MOTION_EUCLIDEAN (rotation + translation);
    angle recovered from the top-left 2×2 block of the returned warp.
    """
    h, w = prev_gray.shape
    if init_angle_deg != 0.0:
        center = (w / 2.0, h / 2.0)
        warp = cv2.getRotationMatrix2D(center, init_angle_deg, 1.0).astype(np.float32)
    else:
        warp = np.eye(2, 3, dtype=np.float32)

    try:
        score, warp = cv2.findTransformECC(prev_gray, curr_gray, warp,
                                           cv2.MOTION_EUCLIDEAN, ECC_CRITERIA, None, 5)
    except cv2.error:
        return 0.0, 0.0

    angle_rad = float(np.arctan2(warp[0, 1], warp[0, 0]))
    return float(np.degrees(angle_rad)), float(score)


def build_target_curve(site: astro.Site,
                       video_start: datetime,
                       ) -> tuple[np.ndarray, np.ndarray]:
    """Analytical raw-view moon-image rotation curve at 30 s cadence.

    Returns (seconds_since_video_start, cumulative_rotation_deg). Uses a
    body-fixed fiducial (moon prime-meridian direction in J2000) so the
    curve captures the moon's own ~0.549°/h rotation on top of the alt-az
    camera-basis drift — matching what ECC measures on the real pixels.
    """
    times = []
    t = astro.SIM_START
    while t <= astro.SIM_END:
        times.append(t)
        t += timedelta(seconds=30)

    # Use the camera-basis-only curve (J2000 north fiducial). The moon's own
    # body rotation about its pole is nearly in the image plane for this
    # capture geometry (dot(moon_pole, gaze) ≈ 0 for Boston/Santiago during
    # the event window), so body rotation produces limb sliding rather than
    # in-plane image rotation — ECC doesn't see it. Empirically, J2000 north
    # produces a much lower residual than a body-X fiducial here.
    cumul = astro.cumulative_field_rotation(times, site)
    secs = np.array([(t - video_start).total_seconds() for t in times])
    return secs, cumul


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calibrate a stabilized video via the analytical raw-view "
                    "field-rotation curve (no reference PNGs).")
    parser.add_argument("video", help="Stabilized moon video")
    parser.add_argument("meta", help="video_meta.json")
    parser.add_argument("-o", "--out", default=None,
                        help="Output anchor table (default: <video-dir>/frame_to_utc.json)")
    parser.add_argument("--step", type=int, default=30,
                        help="Sample every Nth video frame (default 30)")
    parser.add_argument("--start-frame", type=int, default=0)
    parser.add_argument("--end-frame", type=int, default=None,
                        help="Stop at this frame (exclusive). Use this to skip "
                             "late frames where the moon has left the FOV.")
    parser.add_argument("--min-ecc", type=float, default=0.5,
                        help="Drop measurement samples with score below this (default 0.5)")
    parser.add_argument("--rate-bounds", type=float, nargs=2, default=[0.1, 10.0],
                        metavar=("MIN_FPS", "MAX_FPS"))
    parser.add_argument("--smooth-window", type=int, default=51,
                        help="Savitzky-Golay window (in samples). Odd. 0 disables.")
    parser.add_argument("--anchor-stride", type=int, default=10,
                        help="Emit one anchor every Nth measurement sample (default 10)")
    parser.add_argument("--min-local-rate-deg-per-sec", type=float, default=0.001,
                        help="Turning-point threshold: below this, inversion "
                             "falls back to the linear seed (default 0.001)")
    parser.add_argument("--max-delta-deg", type=float, default=5.0,
                        help="Reject per-sample deltas with |value| > this. Guards "
                             "against ECC converging 60-120° off the truth (the "
                             "moon is nearly circular).")
    parser.add_argument("--target-sign", type=int, choices=[1, -1], default=None,
                        help="Manually flip the analytical curve sign if the "
                             "shape-match residual is high. By default the script "
                             "tries both and picks the better fit.")
    args = parser.parse_args()

    # ---- Load metadata ----
    with open(args.meta) as f:
        meta = json.load(f)
    camera_name = meta["camera"]
    video_start = parse_iso_utc(meta["video_start_utc"])
    site = astro.BOSTON if camera_name == "boston" else astro.SANTIAGO

    print(f"Camera: {camera_name}")
    print(f"Video start UTC: {video_start.isoformat()}")

    # ---- Build analytical target curve ----
    print("\nBuilding analytical target curve from astro.py...")
    target_secs, target_rots = build_target_curve(site, video_start)
    print(f"  {len(target_secs)} samples, sec-since-video-start range "
          f"[{target_secs[0]:.0f}, {target_secs[-1]:.0f}], "
          f"rotation range [{target_rots.min():+.2f}°, {target_rots.max():+.2f}°]")

    # ---- Measure real video rotation ----
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"Error: cannot open {args.video}", file=sys.stderr)
        sys.exit(1)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    end_frame = args.end_frame if args.end_frame is not None else total

    print(f"\nMeasuring rotation in [{args.start_frame}, {end_frame}) every {args.step}...")
    cap.set(cv2.CAP_PROP_POS_FRAMES, args.start_frame)
    ret, bgr = cap.read()
    if not ret:
        print(f"Error: cannot read frame {args.start_frame}", file=sys.stderr)
        sys.exit(1)
    prev_gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    sample_frames = [args.start_frame]
    cumul = [0.0]
    scores = [1.0]
    last_delta = 0.0
    running = 0.0
    clamped = 0

    next_idx = args.start_frame + args.step
    pbar = tqdm(total=max(0, (end_frame - args.start_frame - 1) // args.step), desc="  ECC")
    while next_idx < end_frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, next_idx)
        ret, bgr = cap.read()
        if not ret:
            break
        curr_gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        delta, score = measure_rotation_ecc(prev_gray, curr_gray, init_angle_deg=last_delta)
        if abs(delta) > args.max_delta_deg:
            clamped += 1
            delta = 0.0
            score = 0.0
        running += delta
        sample_frames.append(next_idx)
        cumul.append(running)
        scores.append(score)
        prev_gray = curr_gray
        last_delta = delta
        next_idx += args.step
        pbar.update(1)
    pbar.close()
    cap.release()

    sample_frames = np.array(sample_frames, dtype=float)
    cumul = np.array(cumul)
    scores = np.array(scores)

    if clamped:
        print(f"  Clamped {clamped} samples with |delta| > {args.max_delta_deg}°")

    keep = scores >= args.min_ecc
    n_kept = int(keep.sum())
    print(f"  Measured {len(sample_frames)} samples, kept {n_kept} with ECC ≥ {args.min_ecc}")
    print(f"  Cumulative range on kept samples: "
          f"[{cumul[keep].min():+.2f}°, {cumul[keep].max():+.2f}°]")
    if n_kept < 10:
        print("Error: <10 high-confidence samples", file=sys.stderr)
        sys.exit(1)

    kept_frames = sample_frames[keep]
    kept_rots = cumul[keep]

    # ---- Pass 1: linear-fit effective_fps ----
    def cost(fps: float, target: np.ndarray) -> float:
        if fps <= 0:
            return 1e9
        secs = kept_frames / fps
        expected = np.interp(secs, target_secs, target)
        resid = kept_rots - expected
        return float((resid - resid.mean()).std())

    # If user didn't pin the sign, pick the one that gives the better linear fit.
    if args.target_sign is not None:
        sign = args.target_sign
    else:
        print("\nAuto-detecting analytical-curve sign (trying both ±1)...")
        result_pos = minimize_scalar(lambda f: cost(f, target_rots),
                                     bounds=tuple(args.rate_bounds), method="bounded",
                                     options={"xatol": 1e-6})
        result_neg = minimize_scalar(lambda f: cost(f, -target_rots),
                                     bounds=tuple(args.rate_bounds), method="bounded",
                                     options={"xatol": 1e-6})
        sign = 1 if result_pos.fun <= result_neg.fun else -1
        print(f"  sign=+1 residual std: {result_pos.fun:.3f}°")
        print(f"  sign=-1 residual std: {result_neg.fun:.3f}°")
        print(f"  Selected sign={sign:+d}")
    signed_target = sign * target_rots

    print("\nFitting effective_timelapse_fps by rotation-curve overlay...")
    result = minimize_scalar(lambda f: cost(f, signed_target),
                             bounds=tuple(args.rate_bounds), method="bounded",
                             options={"xatol": 1e-6})
    best_fps = float(result.x)
    best_spf = 1.0 / best_fps
    best_resid = float(result.fun)

    print(f"\n  effective_fps   sec/frame   residual_std")
    seeds = sorted(set([args.rate_bounds[0], 0.5, 0.65, 0.7, 0.735, 0.8, 1.0, best_fps, args.rate_bounds[1]]))
    for f in seeds:
        if not (args.rate_bounds[0] <= f <= args.rate_bounds[1]):
            continue
        c = cost(f, signed_target)
        mark = "  ← best" if abs(f - best_fps) < 1e-4 else ""
        print(f"  {f:>13.4f}   {1/f:>9.4f}   {c:>12.3f}°{mark}")

    print(f"\nLinear fit (seed for per-sample anchoring):")
    print(f"  sec/frame:  {best_spf:.4f}")
    print(f"  fps:        {best_fps:.4f}")
    print(f"  resid std:  {best_resid:.3f}°")

    # ---- Pass 2: per-sample inversion with savgol smoothing ----
    print("\nBuilding rich anchor table (analytical target)...")
    if args.smooth_window > 1 and len(kept_rots) >= args.smooth_window:
        win = args.smooth_window + (args.smooth_window + 1) % 2  # force odd
        smoothed = savgol_filter(kept_rots, win, polyorder=3)
        print(f"  Smoothed measured curve (savgol window={win} ≈ "
              f"{win * args.step * best_spf:.0f}s real time)")
    else:
        smoothed = kept_rots
        print("  Smoothing disabled")

    seed_first = best_spf * kept_frames[0]
    target_at_seed = float(np.interp(seed_first, target_secs, signed_target))

    target_rate = np.gradient(signed_target, target_secs)
    # Fine sampling for windowed argmin inversion (~2 s resolution)
    fine_secs = np.linspace(target_secs[0], target_secs[-1],
                             int((target_secs[-1] - target_secs[0]) / 2.0) + 1)
    fine_rots = np.interp(fine_secs, target_secs, signed_target)
    fine_rates = np.interp(fine_secs, target_secs, target_rate)

    max_window_sec = 3600.0
    n = len(kept_frames)
    anchor_secs = np.empty(n)
    fallbacks = 0
    for i in range(n):
        seed = best_spf * kept_frames[i]
        tgt = target_at_seed + smoothed[i]
        lo, hi = seed - max_window_sec, seed + max_window_sec
        mask = (fine_secs >= lo) & (fine_secs <= hi)
        if not mask.any():
            anchor_secs[i] = seed
            fallbacks += 1
            continue
        win_secs = fine_secs[mask]
        win_rots = fine_rots[mask]
        win_rates = fine_rates[mask]
        if np.max(np.abs(win_rates)) < args.min_local_rate_deg_per_sec:
            anchor_secs[i] = seed
            fallbacks += 1
            continue
        anchor_secs[i] = float(win_secs[int(np.argmin(np.abs(win_rots - tgt)))])

    print(f"  Per-sample anchors: {n - fallbacks} matched, {fallbacks} fell back to linear seed")

    # Monotonicity clamp
    mono_fixes = 0
    for i in range(1, n):
        if anchor_secs[i] <= anchor_secs[i - 1]:
            anchor_secs[i] = anchor_secs[i - 1] + 1e-3
            mono_fixes += 1
    if mono_fixes:
        print(f"  Monotonicity fixes: {mono_fixes} anchors clamped")

    # Subsample
    stride = max(1, args.anchor_stride)
    anchor_ix = list(range(0, n, stride))
    if anchor_ix[-1] != n - 1:
        anchor_ix.append(n - 1)
    print(f"  Output {len(anchor_ix)} anchors (stride={stride} from {n} samples)")

    final_expected = np.interp(anchor_secs, target_secs, signed_target) - target_at_seed
    final_resid = smoothed - final_expected
    print(f"  Per-anchor residual std: {final_resid.std():.4f}°")

    # ---- Write output ----
    if args.out is None:
        args.out = str(Path(args.video).parent / "frame_to_utc.json")

    anchors_out = []
    for ai in anchor_ix:
        fi = int(kept_frames[ai])
        utc = video_start + timedelta(seconds=float(anchor_secs[ai]))
        anchors_out.append({
            "frame_idx": fi,
            "utc": utc.strftime("%Y-%m-%dT%H:%M:%S") + f".{utc.microsecond // 1000:03d}Z",
        })

    out = {
        "source_video": Path(args.video).name,
        "video_start_utc": video_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "naive_timelapse_fps": meta.get("timelapse_fps"),
        "effective_timelapse_fps": best_fps,
        "linear_fit_slope_sec_per_frame": best_spf,
        "rotation_residual_std_deg_linear": best_resid,
        "rotation_residual_std_deg_per_anchor": float(final_resid.std()),
        "target_curve_sign": sign,
        "kept_samples": n_kept,
        "smooth_window": args.smooth_window,
        "anchor_stride": args.anchor_stride,
        "fit_frame_range": [int(args.start_frame), int(end_frame)],
        "calibration_method": "analytical_field_rotation",
        "anchors": anchors_out,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nAnchor table → {args.out}")
    print(f"Use with: 04_rotate.py ... --frame-to-utc {args.out}")


if __name__ == "__main__":
    main()
