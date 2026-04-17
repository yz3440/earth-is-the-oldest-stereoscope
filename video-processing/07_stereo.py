#!/usr/bin/env python3
"""
Stereo Moon Compositor

Combines two rotated moon videos (left/right eye) into a side-by-side stereo
video. Aligns frames by UTC time.

By default, uses each video's `timelapse_fps` from `video_meta.json` to
convert real time → frame index. This is wrong for the Seestar Z50 (the
meta says 1.0, the empirical rate is closer to 0.71 with non-linear drift)
and produces minutes-long misalignment in the side-by-side composite.

Pass `--left-frame-to-utc` and `--right-frame-to-utc` (anchor tables emitted
by 03_calibrate.py) to use the empirical UTC mapping instead.
This is the recommended path — without it, the calibration work done in
03+04 doesn't reach the final composite.

The output spans from the earliest video start to the latest video end.
Frames outside a video's time range are black.

Usage (legacy, uses meta fps — minutes of misalignment):
    uv run 07_stereo.py <left_video> <left_meta> <right_video> <right_meta>

Usage (recommended, anchor-aware alignment):
    uv run 07_stereo.py <left_video> <left_meta> <right_video> <right_meta> \\
        --left-frame-to-utc <left_anchors.json> \\
        --right-frame-to-utc <right_anchors.json>
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def parse_iso_utc(s: str) -> datetime:
    """Robust ISO UTC parser. Handles:
      - '2026-03-02T22:41:00+00:00'   (video_meta.json — fromisoformat path)
      - '2026-03-02 22:41:00+00:00'
      - '2026-03-02T22:41:00Z'         (calibrator anchors)
      - '2026-03-02T22:41:00.123Z'     (calibrator anchors with ms)
      - '2026-03-02 22:41:00 UTC'      (legacy plain text)
    """
    s = s.strip()
    # Path 1: try fromisoformat (handles +HH:MM and naive ISO).
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    # Path 2: manual cleanup for "Z" / " UTC" suffixes.
    s = s.replace(" UTC", "").replace("Z", "").replace("T", " ")
    fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in s else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


def load_frame_to_utc(path: str, video_start: datetime, total_frames: int) -> np.ndarray:
    """
    Load an anchor table emitted by 03_calibrate.py and build a
    per-frame mapping `frame_real_times[i]` = real seconds since `video_start`
    for video frame i ∈ [0, total_frames).

    Uses piecewise-linear interpolation through the anchors with linear
    extrapolation past the endpoints (using the slope between the two nearest
    anchors). Result is monotonic by construction — the calibrator enforces
    a monotonicity clamp on the anchor table.

    Mirrors the loader in 04_simulate_rotation.py.
    """
    with open(path) as f:
        anchor_data = json.load(f)
    anchors = anchor_data["anchors"]
    if len(anchors) < 2:
        raise ValueError(f"anchor table {path} has <2 anchors")

    anchor_frames = np.array([a["frame_idx"] for a in anchors], dtype=float)
    anchor_secs = np.array([
        (parse_iso_utc(a["utc"]) - video_start).total_seconds() for a in anchors
    ])
    order = np.argsort(anchor_frames)
    anchor_frames = anchor_frames[order]
    anchor_secs = anchor_secs[order]

    frame_idxs = np.arange(total_frames, dtype=float)
    frame_real_times = np.interp(frame_idxs, anchor_frames, anchor_secs)

    # Linear extrapolation past the last anchor (np.interp clamps by default)
    if anchor_frames[-1] < total_frames - 1:
        slope = (anchor_secs[-1] - anchor_secs[-2]) / (anchor_frames[-1] - anchor_frames[-2])
        mask = frame_idxs > anchor_frames[-1]
        frame_real_times[mask] = anchor_secs[-1] + slope * (frame_idxs[mask] - anchor_frames[-1])
    # Linear extrapolation before the first anchor
    if anchor_frames[0] > 0:
        slope = (anchor_secs[1] - anchor_secs[0]) / (anchor_frames[1] - anchor_frames[0])
        mask = frame_idxs < anchor_frames[0]
        frame_real_times[mask] = anchor_secs[0] + slope * (frame_idxs[mask] - anchor_frames[0])

    return frame_real_times


# Backwards-compat alias used by older callers / scripts.
parse_utc = parse_iso_utc


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
    parser.add_argument("--left-frame-to-utc", default=None,
                        help="Optional: anchor table from 03_calibrate.py "
                             "for the left video. Replaces the meta's timelapse_fps "
                             "with empirical per-frame UTC mapping. Strongly recommended — "
                             "without it, the side-by-side will be misaligned by minutes "
                             "if timelapse_fps in the meta is wrong.")
    parser.add_argument("--right-frame-to-utc", default=None,
                        help="Optional: anchor table from 03_calibrate.py "
                             "for the right video. See --left-frame-to-utc.")
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

    # Build per-frame "real seconds since this video's start" arrays. Two
    # paths:
    #   - With --(left|right)-frame-to-utc: load the calibrator's anchor
    #     table and interpolate. This is the recommended path; the result
    #     captures the camera's actual non-linear capture rate.
    #   - Without: assume constant `timelapse_fps` from the meta. This is
    #     wrong for the Seestar Z50 (off by ~30% with non-linear drift),
    #     but is preserved for backwards compatibility.
    if args.left_frame_to_utc:
        left_frame_real_times = load_frame_to_utc(
            args.left_frame_to_utc, left_start, left_total)
        left_mode = f"anchor table from {Path(args.left_frame_to_utc).name}"
    else:
        left_frame_real_times = np.arange(left_total, dtype=float) / left_tlfps
        left_mode = f"legacy timelapse_fps={left_tlfps} (likely misaligned)"

    if args.right_frame_to_utc:
        right_frame_real_times = load_frame_to_utc(
            args.right_frame_to_utc, right_start, right_total)
        right_mode = f"anchor table from {Path(args.right_frame_to_utc).name}"
    else:
        right_frame_real_times = np.arange(right_total, dtype=float) / right_tlfps
        right_mode = f"legacy timelapse_fps={right_tlfps} (likely misaligned)"

    # Time of the last captured frame, relative to each video's start.
    # In anchor mode this is the calibrator's empirical end-time; in legacy
    # mode it's (total - 1) / fps.
    left_duration_s = float(left_frame_real_times[-1])
    right_duration_s = float(right_frame_real_times[-1])

    left_end = left_start + timedelta(seconds=left_duration_s)
    right_end = right_start + timedelta(seconds=right_duration_s)

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
    print(f"  Mode:  {left_mode}")
    print(f"  Start: {left_start.isoformat()}")
    print(f"  End:   {left_end.isoformat()}")
    print(f"Right ({right_meta['camera']}): {right_w}x{right_h}, {right_total} frames, "
          f"{right_duration_s/3600:.2f}h")
    print(f"  Mode:  {right_mode}")
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

    # Output time t and both frame_real_times arrays are monotonic, so the
    # per-eye target indices only ever move forward. Stream both captures
    # sequentially instead of preloading (preload cost: ~3.3 MB/frame *
    # ~70k frames ≈ 230 GB).
    class StreamingEye:
        def __init__(self, cap, total):
            self.cap = cap
            self.total = total
            self.cur_idx = -1       # index of frame currently held in `cur`
            self.cur = None
            self.exhausted = False

        def frame_at(self, target_idx):
            if target_idx < 0:
                return None
            if target_idx >= self.total:
                target_idx = self.total - 1
            while self.cur_idx < target_idx and not self.exhausted:
                ret, frame = self.cap.read()
                if not ret:
                    self.exhausted = True
                    break
                self.cur = frame
                self.cur_idx += 1
            return self.cur  # may be None if first read already failed

    left_eye = StreamingEye(left_cap, left_total)
    right_eye = StreamingEye(right_cap, right_total)

    print(f"\nCompositing stereo video...")
    for i in tqdm(range(total_output_frames), desc="  Processing"):
        # Real second i since global start
        t = i

        # At output time t, find the most recently captured frame whose
        # real-time-since-video-start is ≤ {left,right}_sec. searchsorted
        # on a monotonic array is O(log N). The `side='right' - 1` form
        # gives the "floor" index (largest i with frame_real_times[i] <=
        # sec), preserving the original "show the most recent captured
        # frame, never a future one" behavior.
        left_sec = t - left_offset_s
        left_idx = int(np.searchsorted(left_frame_real_times, left_sec, side='right')) - 1
        left_frame = left_eye.frame_at(left_idx)
        if left_frame is None:
            left_frame = black_frame

        right_sec = t - right_offset_s
        right_idx = int(np.searchsorted(right_frame_real_times, right_sec, side='right')) - 1
        right_frame = right_eye.frame_at(right_idx)
        if right_frame is None:
            right_frame = black_frame

        # Side by side
        stereo = np.hstack([left_frame, right_frame])
        writer.write(stereo)

    left_cap.release()
    right_cap.release()
    writer.release()

    print(f"\nDone! {args.output}")
    print(f"  {out_w}x{out_h}, {total_output_frames} frames, "
          f"{total_output_frames/args.fps:.1f}s playback")


if __name__ == "__main__":
    main()
