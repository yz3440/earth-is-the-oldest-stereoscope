#!/usr/bin/env python3
"""
Moon Video Stabilizer

Reads an offset JSON file (from track_moon.py), opens a scrubber so you
can pick a reference frame with a clean moon, auto-detects the moon's
bounding box on that frame, and uses its center (back-compensated to
frame 0 via the tracked offsets) as the output crop center. Then
outputs a stabilized 1080x1080 square video — no zoom, just
translation + crop.

Usage:
    uv run stabilize_moon.py <offsets.json> [--center X,Y] [--output out.mp4] [--preview N]
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm

OUTPUT_SIZE = 1080


def load_offsets(json_path: str) -> dict:
    with open(json_path) as f:
        return json.load(f)


def parse_video_time(s: str) -> float:
    """Accept 'HH:MM:SS', 'MM:SS', 'SS' (ints or floats). Returns seconds."""
    parts = [float(p) for p in str(s).split(":")]
    if len(parts) == 3:
        h, m, sec = parts
    elif len(parts) == 2:
        h, m, sec = 0.0, parts[0], parts[1]
    elif len(parts) == 1:
        h, m, sec = 0.0, 0.0, parts[0]
    else:
        raise ValueError(f"unrecognized video-time string: {s!r}")
    return h * 3600 + m * 60 + sec


def detect_moon_bbox(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    """Threshold + largest-contour bounding box. Moon is the biggest bright
    blob against dark sky, so Otsu + max-area contour is enough."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 50:  # spurious speck
        return None
    x, y, w, h = cv2.boundingRect(c)
    return int(x), int(y), int(w), int(h)


def pick_center_interactive(video_path: str, offsets: list[dict]) -> tuple[int, int]:
    """Scrub to a reference frame, auto-detect the moon bbox on that
    frame, and return its center expressed in frame-0 coordinates
    (subtract the tracked offset at the scrubbed frame)."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Cannot open {video_path}")
        sys.exit(1)

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total = max(1, min(total, len(offsets)))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, 900 / max(W, H))
    half = int(OUTPUT_SIZE / 2 * scale)

    window = "Pick reference frame  (scrub, Enter=accept, Esc=cancel)"
    state: dict = {"idx": 0, "frame": None, "bbox": None, "center_f0": None, "dirty": True}

    def load(idx: int) -> None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            return
        state["idx"] = idx
        state["frame"] = frame
        bbox = detect_moon_bbox(frame)
        state["bbox"] = bbox
        if bbox is not None:
            x, y, w, h = bbox
            cxf, cyf = x + w // 2, y + h // 2
            dx = float(offsets[idx].get("dx", 0.0))
            dy = float(offsets[idx].get("dy", 0.0))
            state["center_f0"] = (int(round(cxf - dx)), int(round(cyf - dy)))
        else:
            state["center_f0"] = None
        state["dirty"] = True

    def render() -> None:
        frame = state["frame"]
        if frame is None:
            return
        disp = cv2.resize(frame, (int(W * scale), int(H * scale))) if scale < 1.0 else frame.copy()
        if state["bbox"] is not None:
            x, y, w, h = state["bbox"]
            xs, ys = int(x * scale), int(y * scale)
            xe, ye = int((x + w) * scale), int((y + h) * scale)
            cv2.rectangle(disp, (xs, ys), (xe, ye), (0, 165, 255), 2)
            cxd, cyd = (xs + xe) // 2, (ys + ye) // 2
            cv2.drawMarker(disp, (cxd, cyd), (0, 165, 255), cv2.MARKER_CROSS, 24, 2)
            cv2.rectangle(disp, (cxd - half, cyd - half), (cxd + half, cyd + half), (0, 255, 0), 2)
            cx0, cy0 = state["center_f0"]
            msg = f"frame {state['idx']}/{total - 1}   moon bbox {w}x{h}   frame-0 center ({cx0},{cy0})"
        else:
            msg = f"frame {state['idx']}/{total - 1}   no moon detected — scrub elsewhere"
        cv2.rectangle(disp, (0, 0), (disp.shape[1], 28), (0, 0, 0), -1)
        cv2.putText(disp, msg, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imshow(window, disp)
        state["dirty"] = False

    cv2.namedWindow(window)
    cv2.createTrackbar("frame", window, 0, max(1, total - 1), lambda v: load(v))
    load(0)

    print("\n  Scrub to a frame where the moon is clean and well-exposed.")
    print("  Press ENTER to accept the detected bbox center, ESC to cancel.")
    while True:
        if state["dirty"]:
            render()
        key = cv2.waitKey(20) & 0xFF
        if key == 13:  # Enter
            if state["center_f0"] is not None:
                break
            print("  No detection on this frame — scrub to another.")
        elif key == 27:  # Esc
            state["center_f0"] = None
            break
    cv2.destroyAllWindows()
    cap.release()

    if state["center_f0"] is None:
        fallback = (W // 2, H // 2)
        print(f"  Canceled — using frame center: {fallback}")
        return fallback
    print(f"  Accepted: ref frame {state['idx']}, frame-0 center {state['center_f0']}")
    return state["center_f0"]


def main():
    parser = argparse.ArgumentParser(description="Moon Video Stabilizer")
    parser.add_argument("offsets", help="Offsets JSON from track_moon.py")
    parser.add_argument("--video", default=None, help="Video path (overrides JSON)")
    parser.add_argument("--center", default=None, help="Center as X,Y (skip interactive picker)")
    parser.add_argument("--output", "-o", default=None, help="Output path (default: <video>_stabilized.mp4)")
    parser.add_argument("--preview", type=int, default=None, help="Only process first N frames")
    args = parser.parse_args()

    data = load_offsets(args.offsets)
    offsets_dir = Path(args.offsets).parent
    video_path = args.video or str(offsets_dir / data["video"])
    if args.output is None:
        args.output = str(Path(video_path).parent / (Path(video_path).stem + "_stabilized.mp4"))

    frame_count = data["total_frames"]
    fps = data["fps"]
    w, h = data["width"], data["height"]

    # If a sibling video_meta.json declares moon_out_of_frame_video_time,
    # truncate the output there. The field is a video-time string like
    # "00:16:10" — i.e. position in the source playback, not UTC.
    meta_path = offsets_dir / "video_meta.json"
    if meta_path.exists():
        with open(meta_path) as f:
            meta = json.load(f)
        cutoff_str = meta.get("moon_out_of_frame_video_time")
        if cutoff_str:
            cutoff_sec = parse_video_time(cutoff_str)
            cutoff_frames = int(cutoff_sec * fps)
            if cutoff_frames < frame_count:
                print(f"  Truncating at moon_out_of_frame_video_time={cutoff_str} "
                      f"({cutoff_sec:.1f}s → frame {cutoff_frames})")
                frame_count = cutoff_frames

    if args.preview is not None:
        frame_count = min(frame_count, args.preview)

    print(f"Video: {video_path} ({w}x{h}, {fps}fps)")
    print(f"Frames to process: {frame_count}")
    print(f"Output size: {OUTPUT_SIZE}x{OUTPUT_SIZE} (no zoom, translation only)")

    # Get center point
    if args.center:
        cx, cy = map(int, args.center.split(","))
    else:
        cx, cy = pick_center_interactive(video_path, data["offsets"])

    print(f"Center: ({cx}, {cy})")

    # Validate that a 1080x1080 crop fits at this center
    half = OUTPUT_SIZE // 2
    x1 = cx - half
    y1 = cy - half
    x2 = cx + half
    y2 = cy + half
    if x1 < 0 or y1 < 0 or x2 > w or y2 > h:
        print(f"Warning: Crop region [{x1},{y1}]-[{x2},{y2}] extends outside {w}x{h} frame.")
        print(f"  Pixels outside the frame will be black.")

    offsets = data["offsets"]

    cap = cv2.VideoCapture(video_path)
    fourcc = cv2.VideoWriter.fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.output, fourcc, fps, (OUTPUT_SIZE, OUTPUT_SIZE))

    if not writer.isOpened():
        print("Error: Cannot create output video")
        sys.exit(1)

    interpolated = sum(1 for o in offsets[:frame_count] if o.get("interpolated"))
    if interpolated > 0:
        print(f"  ({interpolated} frames have interpolated offsets)")

    print(f"\nStabilizing...")
    for i in tqdm(range(frame_count), desc="  Processing"):
        ret, frame = cap.read()
        if not ret:
            break

        dx = offsets[i]["dx"]
        dy = offsets[i]["dy"]

        # Translate: shift the frame so the moon returns to its frame-0 position.
        # Then crop 1080x1080 around the chosen center point.
        # We can combine both into a single warpAffine that also repositions
        # the crop region to the output.
        #
        # The output pixel at (ox, oy) should come from input pixel at:
        #   (ox + x1 - dx, oy + y1 - dy)
        #
        # Which is equivalent to translating by (dx - x1, dy - y1)

        tx = dx - x1
        ty = dy - y1
        M = np.float32([[1, 0, tx], [0, 1, ty]])
        out = cv2.warpAffine(
            frame, M, (OUTPUT_SIZE, OUTPUT_SIZE),
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0),
        )
        writer.write(out)

    writer.release()
    cap.release()

    print(f"\nDone! {args.output}")
    print(f"  {OUTPUT_SIZE}x{OUTPUT_SIZE}, {frame_count} frames, {frame_count/fps:.1f}s")


if __name__ == "__main__":
    main()
