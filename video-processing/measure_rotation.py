#!/usr/bin/env python3
"""
Stabilized Video Rotation Measurer (diagnostic)

Measures the per-frame rotation rate of a stabilized moon video using OpenCV's
ECC (Enhanced Correlation Coefficient) image alignment with a Euclidean
(translation + rotation) motion model. Optionally compares the measured curve
against the expected rotation from the viewer's keyframes JSON to diagnose
sign / magnitude errors in the rotation correction.

How it works:
  1. For each consecutive sampled frame pair, convert to grayscale.
  2. Run cv2.findTransformECC with MOTION_EUCLIDEAN, which gradient-descents
     a 2x3 warp matrix [[cos -sin tx], [sin cos ty]] that best maps the prior
     frame onto the next. The rotation comes out of the matrix's top-left 2x2.
  3. Cumulate the per-pair rotations into an absolute rotation curve over time.

ECC is much more robust than polar phase correlation for small rotations of a
centered, low-contrast subject like the moon (where the lunar disk's overall
brightness dominates and feature-based methods can find spurious near-zero
matches).

Sign convention: positive = CCW rotation of the visible image content (matches
the cv2.warpAffine convention used by 04_rotate.py). Verified at startup
by a self-test that rotates the first frame by a known angle.

Usage:
    uv run python measure_rotation.py <stabilized.mp4>

Diagnostic comparison vs keyframes:
    uv run python measure_rotation.py <stabilized.mp4> \\
        --keyframes ../../stereo-moon-keyframes.json \\
        --meta ../videos/yufeng_boston/video_meta.json \\
        --plot rotation_compare.png
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np
from tqdm import tqdm


ECC_CRITERIA = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-6)


def measure_rotation_ecc(prev_gray: np.ndarray,
                         curr_gray: np.ndarray,
                         init_angle_deg: float = 0.0) -> tuple[float, float]:
    """
    Measure rotation between two grayscale frames using cv2.findTransformECC
    with a Euclidean motion model (translation + rotation).

    Returns (angle_deg, ecc_score). angle_deg is positive for CCW rotation of
    the visible image content. ecc_score in [-1, 1]: higher is better, ~1.0
    means near-perfect alignment, < 0.5 means the fit is unreliable.

    init_angle_deg is an optional initial guess (in degrees, CCW positive).
    Defaults to 0 — fine for small frame-to-frame rotations. For large gaps,
    seed with the previous result to help convergence.

    Inputs must be float32 of equal shape.
    """
    # Build initial warp matrix from init_angle_deg.
    # cv2 ECC convention: warp_matrix = [[cos α, -sin α, tx], [sin α, cos α, ty]]
    # where positive α is the visual CCW rotation, matching cv2.warpAffine.
    # Note: getRotationMatrix2D uses the SAME (cos, -sin) layout for positive
    # angles meaning visual CCW, so we can use it directly.
    h, w = prev_gray.shape
    if init_angle_deg != 0.0:
        center = (w / 2.0, h / 2.0)
        warp = cv2.getRotationMatrix2D(center, init_angle_deg, 1.0).astype(np.float32)
    else:
        warp = np.eye(2, 3, dtype=np.float32)

    try:
        ecc_score, warp = cv2.findTransformECC(
            prev_gray, curr_gray, warp,
            cv2.MOTION_EUCLIDEAN, ECC_CRITERIA, None, 5,
        )
    except cv2.error:
        # ECC can fail to converge on very low-contrast frames (e.g. eclipse totality).
        return 0.0, 0.0

    # Recover rotation from the warp matrix's top-left 2x2.
    # cv2.getRotationMatrix2D with positive angle ("CCW") returns
    #   [[cos α, sin α, tx], [-sin α, cos α, ty]]
    # in image coordinates (y points down), so reading the rotation back is
    # arctan2(warp[0, 1], warp[0, 0]) = α.
    angle_rad = float(np.arctan2(warp[0, 1], warp[0, 0]))
    angle_deg = float(np.degrees(angle_rad))
    return angle_deg, float(ecc_score)


def self_test(reference_frame: np.ndarray, test_angle: float = 5.0) -> None:
    """
    Sanity-check the rotation measurement by rotating the reference frame by a
    known angle and verifying the measurement comes back with the right sign
    and magnitude.
    """
    h, w = reference_frame.shape
    center = (w / 2.0, h / 2.0)

    # cv2.getRotationMatrix2D positive angle = visually CCW.
    M = cv2.getRotationMatrix2D(center, test_angle, 1.0)
    rotated = cv2.warpAffine(reference_frame, M, (w, h),
                             borderMode=cv2.BORDER_CONSTANT,
                             borderValue=0)

    measured, score = measure_rotation_ecc(reference_frame, rotated)
    err = measured - test_angle

    print(f"Self-test: rotated reference by +{test_angle}° (CCW),")
    print(f"  measured = {measured:+.4f}°  (error {err:+.4f}°, ecc_score {score:.4f})")

    if abs(err) > 0.1:
        print(f"  WARNING: self-test error >0.1°. Sign convention may be wrong.",
              file=sys.stderr)
    if score < 0.95:
        print(f"  WARNING: self-test ecc_score is low ({score:.4f}).",
              file=sys.stderr)


def iter_video_frames(path: str, start_frame: int, end_frame: int, step: int
                      ) -> Iterator[tuple[int, np.ndarray]]:
    """
    Yield (frame_idx, gray_float32) pairs from a video file.

    frame_idx is the absolute video frame number (0-based).
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {path}")
    try:
        idx = start_frame
        while idx < end_frame:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, bgr = cap.read()
            if not ret:
                return
            yield idx, cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
            idx += step
    finally:
        cap.release()


def iter_folder_frames(path: str, start_frame: int, end_frame: int, step: int
                       ) -> Iterator[tuple[int, np.ndarray]]:
    """
    Yield (frame_idx, gray_float32) pairs from a directory of PNGs.

    frame_idx is the index into the sorted PNG list (0-based).
    """
    files = sorted(Path(path).glob("*.png"))
    if not files:
        raise RuntimeError(f"no PNGs in {path}")
    for idx in range(start_frame, end_frame, step):
        if idx >= len(files):
            return
        bgr = cv2.imread(str(files[idx]))
        if bgr is None:
            continue
        yield idx, cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)


def main():
    parser = argparse.ArgumentParser(
        description="Measure rotation rate of a stabilized moon video or folder of frames")
    parser.add_argument("source",
                        help="Stabilized moon video (.mp4) OR directory of PNG frames "
                             "(e.g. boston/ from the viewer reference export)")
    parser.add_argument("--keyframes", default=None,
                        help="Optional: viewer keyframes JSON for comparison")
    parser.add_argument("--meta", default=None,
                        help="Optional: video_meta.json (required if --keyframes is given "
                             "and source is a video; for folder mode, set --camera instead)")
    parser.add_argument("--camera", default=None, choices=["boston", "santiago"],
                        help="Camera identifier (folder mode only — replaces --meta)")
    parser.add_argument("--interval-sec", type=float, default=None,
                        help="Real seconds between consecutive source frames. Default: "
                             "1/timelapse_fps for video mode (read from --meta or 1.0), "
                             "30 for folder mode (matches the viewer reference export).")
    parser.add_argument("--step", type=int, default=30,
                        help="Sample every Nth source frame (default: 30 — fits a 30fps "
                             "video at 1 timelapse_fps; for folder mode use --step 1)")
    parser.add_argument("--start-frame", type=int, default=0)
    parser.add_argument("--end-frame", type=int, default=None)
    parser.add_argument("--output", "-o", default=None,
                        help="Output measurements JSON path "
                             "(default: <source>_measured_rotation.json)")
    parser.add_argument("--plot", default=None,
                        help="Save matplotlib comparison plot to this path (PNG)")
    args = parser.parse_args()

    source_path = Path(args.source)
    is_folder = source_path.is_dir()

    # Resolve total length, source interval (real seconds per source frame), and camera id
    if is_folder:
        files = sorted(source_path.glob("*.png"))
        if not files:
            print(f"Error: no PNGs in {args.source}", file=sys.stderr)
            sys.exit(1)
        total = len(files)
        source_interval_sec = args.interval_sec if args.interval_sec is not None else 30.0
        camera = args.camera
        sample_w, sample_h = None, None
        first_bgr = cv2.imread(str(files[0]))
        if first_bgr is not None:
            sample_h, sample_w = first_bgr.shape[:2]
        print(f"Folder: {source_path}")
        print(f"  {len(files)} PNGs, {sample_w}x{sample_h}, "
              f"each frame = {source_interval_sec:.1f}s real time")
    else:
        cap = cv2.VideoCapture(args.source)
        if not cap.isOpened():
            print(f"Error: cannot open {args.source}", file=sys.stderr)
            sys.exit(1)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        sample_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        sample_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        # Source interval: 1 / timelapse_fps (1 video frame = 1/timelapse_fps real seconds)
        if args.interval_sec is not None:
            source_interval_sec = args.interval_sec
        elif args.meta:
            with open(args.meta) as f:
                source_interval_sec = 1.0 / json.load(f)["timelapse_fps"]
        else:
            source_interval_sec = 1.0 / fps  # fallback: real-time playback

        camera = args.camera
        if camera is None and args.meta:
            with open(args.meta) as f:
                camera = json.load(f)["camera"]

        print(f"Video: {Path(args.source).name}")
        print(f"  {sample_w}x{sample_h} @ {fps}fps, {total} frames total, "
              f"each frame = {source_interval_sec:.3f}s real time")

    end_frame = args.end_frame if args.end_frame is not None else total
    print(f"  Sampling frames [{args.start_frame}, {end_frame}) every {args.step}")

    # Build the appropriate iterator
    if is_folder:
        frame_iter = iter_folder_frames(args.source, args.start_frame, end_frame, args.step)
    else:
        frame_iter = iter_video_frames(args.source, args.start_frame, end_frame, args.step)

    # Read the first frame for self-test
    try:
        first_idx, prev_gray = next(frame_iter)
    except StopIteration:
        print("Error: no frames to read", file=sys.stderr)
        sys.exit(1)

    self_test(prev_gray, test_angle=5.0)
    print()

    # Walk pairs
    samples = [{
        "frame_idx": first_idx,
        "delta_deg": 0.0,
        "cumulative_deg": 0.0,
        "ecc_score": 1.0,
    }]
    cumulative = 0.0
    last_delta = 0.0  # warm-start ECC with previous result

    pbar_total = max(0, (end_frame - args.start_frame - 1) // args.step)
    pbar = tqdm(total=pbar_total, desc="  Measuring")
    for frame_idx, curr_gray in frame_iter:
        delta, score = measure_rotation_ecc(prev_gray, curr_gray, init_angle_deg=last_delta)
        cumulative += delta
        samples.append({
            "frame_idx": frame_idx,
            "delta_deg": delta,
            "cumulative_deg": cumulative,
            "ecc_score": score,
        })
        prev_gray = curr_gray
        last_delta = delta
        pbar.update(1)
    pbar.close()

    print(f"\nMeasured {len(samples)} samples.")
    print(f"  Total accumulated rotation: {cumulative:+.3f}°")
    print(f"  Mean per-sample delta: {np.mean([s['delta_deg'] for s in samples]):+.4f}°")
    print(f"  Min ecc_score: {min(s['ecc_score'] for s in samples):.4f}")

    output = {
        "source": str(source_path),
        "is_folder": is_folder,
        "interval_sec": source_interval_sec,
        "total_frames": total,
        "step": args.step,
        "start_frame": args.start_frame,
        "end_frame": end_frame,
        "samples": samples,
    }

    # ---- Optional comparison vs keyframes ----
    if args.keyframes:
        if camera is None:
            print("Error: need --camera (or --meta) to compare against keyframes",
                  file=sys.stderr)
            sys.exit(1)

        with open(args.keyframes) as f:
            kf = json.load(f)

        rot_key = f"{camera}_rotation_deg"
        time_key = f"{camera}_video_sec"

        kf_times = []
        kf_rots = []
        for k in kf:
            t = k[time_key]
            if t >= 0:
                kf_times.append(t)
                kf_rots.append(k[rot_key])
        kf_times = np.array(kf_times)
        kf_rots = np.array(kf_rots)

        # Map source frame index to real seconds since the camera's video start.
        # video mode: source_interval_sec = 1/timelapse_fps
        # folder mode: source_interval_sec = 30 (one ref frame per 30s of sim time).
        # Note: in folder mode the first PNG is at SIM_START which equals
        # BOSTON_VIDEO_START, so for Boston the time axes line up directly.
        # For Santiago in folder mode, the first PNG is *before* Santiago's video
        # start (negative santiago_video_sec), so the keyframes-only-with-t≥0
        # filter applied above already trims to the valid range.
        sample_times = np.array([s["frame_idx"] * source_interval_sec for s in samples])
        sample_rots = np.array([s["cumulative_deg"] for s in samples])

        # Interpolate keyframes onto measured sample times. The keyframes record
        # an *absolute* angle in the image plane, so to compare against the
        # measured *relative* rotation we subtract off whatever the keyframes
        # were at the start of the video segment.
        expected_abs = np.interp(sample_times, kf_times, kf_rots)
        kf_at_start = float(np.interp(sample_times[0], kf_times, kf_rots))
        expected = expected_abs - kf_at_start

        # The script applies `cv2 angle = -keyframe`, which means the *applied*
        # rotation rate (CCW positive) is -d(keyframe)/dt. For the corrected
        # video to be stationary, the applied rotation rate must equal the
        # negative of the measured rotation rate, i.e.
        #   measured == -applied  →  measured == d(keyframe)/dt  →  measured ≈ expected
        residual = sample_rots - expected
        residual_neg = sample_rots - (-expected)

        print()
        print(f"Keyframe comparison (camera={camera}):")
        print(f"  Measured cumulative rotation:   {sample_rots[-1]:+8.3f}°")
        print(f"  Expected (from keyframes):      {expected[-1]:+8.3f}°")
        print(f"  Expected, sign-flipped:         {-expected[-1]:+8.3f}°")
        print()
        print(f"  Residual measured − expected:        mean={residual.mean():+.3f}°  std={residual.std():.3f}°")
        print(f"  Residual measured − (−expected):     mean={residual_neg.mean():+.3f}°  std={residual_neg.std():.3f}°")

        if residual.std() < residual_neg.std():
            verdict = "SIGN MATCH — script's `angle = -frame_rots[i]` is correct"
        else:
            verdict = "SIGN MISMATCH — script should use `angle = +frame_rots[i]` (or keyframes have wrong sign)"
        print(f"\n  → {verdict}")

        output["comparison"] = {
            "camera": camera,
            "measured_total_deg": float(sample_rots[-1]),
            "expected_total_deg": float(expected[-1]),
            "residual_mean": float(residual.mean()),
            "residual_std": float(residual.std()),
            "residual_neg_mean": float(residual_neg.mean()),
            "residual_neg_std": float(residual_neg.std()),
            "sign_match": bool(residual.std() < residual_neg.std()),
        }

        if args.plot:
            try:
                import matplotlib
                matplotlib.use("Agg")
                import matplotlib.pyplot as plt

                fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 9))

                hours = sample_times / 3600.0

                ax1.plot(hours, sample_rots, label="Measured (phase correlation)",
                         color="C0", linewidth=2)
                ax1.plot(hours, expected, label="Expected (keyframes, same sign)",
                         color="C1", linewidth=1.5, linestyle="--")
                ax1.plot(hours, -expected, label="Expected, sign-flipped",
                         color="C3", linewidth=1.5, linestyle=":")
                ax1.set_xlabel("Real time (hours from video start)")
                ax1.set_ylabel("Cumulative rotation (degrees)")
                ax1.set_title(f"{camera}: cumulative rotation vs expected from keyframes")
                ax1.axhline(0, color="k", linewidth=0.4, alpha=0.3)
                ax1.legend()
                ax1.grid(True, alpha=0.3)

                deltas = np.array([s["delta_deg"] for s in samples])
                # Per-sample expected rate, in degrees per sample
                expected_deltas = np.gradient(expected)
                ax2.plot(hours, deltas, label="Measured Δ per sample",
                         color="C0", linewidth=1.5)
                ax2.plot(hours, expected_deltas, label="Expected Δ per sample",
                         color="C1", linewidth=1.5, linestyle="--")
                ax2.plot(hours, -expected_deltas, label="Expected Δ, sign-flipped",
                         color="C3", linewidth=1.5, linestyle=":")
                ax2.set_xlabel("Real time (hours from video start)")
                ax2.set_ylabel("Δ rotation per sample (degrees)")
                ax2.set_title(f"{camera}: rotation rate (derivative)")
                ax2.axhline(0, color="k", linewidth=0.4, alpha=0.3)
                ax2.legend()
                ax2.grid(True, alpha=0.3)

                plt.tight_layout()
                plt.savefig(args.plot, dpi=120)
                print(f"\n  Plot saved to {args.plot}")
            except ImportError:
                print(f"\n  matplotlib not installed; skipping plot. Install with: uv add matplotlib",
                      file=sys.stderr)

    if args.output is None:
        if is_folder:
            args.output = str(source_path.parent /
                              (source_path.name + "_measured_rotation.json"))
        else:
            args.output = str(source_path.parent /
                              (source_path.stem + "_measured_rotation.json"))
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nMeasurements saved to {args.output}")


if __name__ == "__main__":
    main()
