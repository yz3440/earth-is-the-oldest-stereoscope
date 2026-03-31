#!/usr/bin/env python3
"""
Moon Video Stabilizer

Reads an offset JSON file (from track_moon.py), shows frame 1 so you can
click where you want the center of the output to be, then outputs a
stabilized 1080x1080 square video — no zoom, just translation + crop.

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


def pick_center_interactive(video_path: str) -> tuple[int, int]:
    """Show frame 1 and let user click the desired output center."""
    cap = cv2.VideoCapture(video_path)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        print(f"Error: Cannot read {video_path}")
        sys.exit(1)

    h, w = frame.shape[:2]
    scale = min(1.0, 900 / max(w, h))
    display = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame.copy()

    # Draw 1080x1080 guide rectangle at frame center initially
    half = int(OUTPUT_SIZE / 2 * scale)
    cx_d, cy_d = display.shape[1] // 2, display.shape[0] // 2

    center = [None]

    def draw_guide(disp, mx, my):
        """Draw the 1080x1080 crop rectangle guide."""
        overlay = disp.copy()
        x1 = mx - half
        y1 = my - half
        x2 = mx + half
        y2 = my + half
        cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.drawMarker(overlay, (mx, my), (0, 255, 0), cv2.MARKER_CROSS, 30, 1)
        return overlay

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            center[0] = (int(x / scale), int(y / scale))
            cv2.imshow("Select center", draw_guide(display, x, y))
        elif event == cv2.EVENT_MOUSEMOVE and center[0] is None:
            # Live preview of crop rectangle as mouse moves
            cv2.imshow("Select center", draw_guide(display, x, y))

    cv2.namedWindow("Select center")
    cv2.setMouseCallback("Select center", on_mouse)
    cv2.imshow("Select center", draw_guide(display, cx_d, cy_d))

    print(f"\n  Click where you want the center of the 1080x1080 output.")
    print(f"  Green rectangle shows the crop area. Press any key to confirm.")
    cv2.waitKey(0)
    cv2.destroyAllWindows()

    if center[0] is None:
        center[0] = (w // 2, h // 2)
        print(f"  No click — using frame center: {center[0]}")
    else:
        print(f"  Selected center: {center[0]}")

    return center[0]


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
    if args.preview is not None:
        frame_count = min(frame_count, args.preview)
    fps = data["fps"]
    w, h = data["width"], data["height"]

    print(f"Video: {video_path} ({w}x{h}, {fps}fps)")
    print(f"Frames to process: {frame_count}")
    print(f"Output size: {OUTPUT_SIZE}x{OUTPUT_SIZE} (no zoom, translation only)")

    # Get center point
    if args.center:
        cx, cy = map(int, args.center.split(","))
    else:
        cx, cy = pick_center_interactive(video_path)

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
