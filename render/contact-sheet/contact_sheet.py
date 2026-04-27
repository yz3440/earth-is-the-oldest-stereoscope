#!/usr/bin/env python3
"""
Stereo Moon contact sheet.

Builds a multi-panel grid (or single tall strip with --panels 1) where each
row is one UTC minute that both telescopes were filming, showing
[UTC timestamp | Boston frame | Santiago frame] with a per-panel header
band ("Boston, USA" / "Santiago, Chile"). Each eye is rotated by the
per-frame stereo-correction angle from `stereo_angles.json`, mirroring the
rotation the website's shader applies in `frontend/src/stereo.ts`.

Usage (defaults match the layout in this repo):
    uv run contact_sheet.py
    uv run contact_sheet.py --panels 8
    uv run contact_sheet.py --single-utc 2026-03-03T04:00:00Z
"""

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import numpy as np
from tqdm import tqdm


def parse_iso_utc(s: str) -> datetime:
    s = s.strip()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass
    s = s.replace(" UTC", "").replace("Z", "").replace("T", " ")
    fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in s else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


class Station:
    """One telescope: video + meta + per-frame timing/angle tables."""

    def __init__(self, folder: Path):
        self.folder = folder
        meta_path = folder / "video_meta.json"
        angles_path = folder / "stereo_angles.json"
        videos = sorted(folder.glob("*_web.mp4"))
        if not videos:
            raise FileNotFoundError(f"no *_web.mp4 in {folder}")
        if not meta_path.exists() or not angles_path.exists():
            raise FileNotFoundError(f"missing video_meta.json or stereo_angles.json in {folder}")

        with open(meta_path) as f:
            self.meta = json.load(f)
        with open(angles_path) as f:
            ang = json.load(f)

        self.camera = self.meta["camera"]
        self.video_start_utc = parse_iso_utc(self.meta["video_start_utc"])
        self.frame_real_times_sec = np.asarray(ang["frame_real_times_sec"], dtype=np.float64)
        self.angles_deg = np.asarray(ang["angles_deg"], dtype=np.float64)
        self.video_fps = float(ang["video_fps"])
        self.total_frames = int(ang["total_frames"])

        self.cap = cv2.VideoCapture(str(videos[0]))
        if not self.cap.isOpened():
            raise IOError(f"cannot open {videos[0]}")

        self._cur_idx = -1
        self._cur_frame = None
        self._exhausted = False

    @property
    def coverage_start_utc(self) -> datetime:
        return self.video_start_utc + timedelta(seconds=float(self.frame_real_times_sec[0]))

    @property
    def coverage_end_utc(self) -> datetime:
        return self.video_start_utc + timedelta(seconds=float(self.frame_real_times_sec[-1]))

    def frame_idx_for_utc(self, t: datetime) -> int:
        """Floor index: largest i with frame_real_times_sec[i] <= real_sec.
        Mirrors `int(np.searchsorted(arr, x, side='right')) - 1` in 07_stereo.py."""
        real_sec = (t - self.video_start_utc).total_seconds()
        i = int(np.searchsorted(self.frame_real_times_sec, real_sec, side="right")) - 1
        return max(0, min(self.total_frames - 1, i))

    def angle_deg_for_utc(self, t: datetime) -> float:
        return float(self.angles_deg[self.frame_idx_for_utc(t)])

    def frame_at(self, target_idx: int):
        """Sequential decode up to target_idx (StreamingEye pattern from 07_stereo.py)."""
        if target_idx < 0:
            return None
        if target_idx >= self.total_frames:
            target_idx = self.total_frames - 1
        while self._cur_idx < target_idx and not self._exhausted:
            ret, frame = self.cap.read()
            if not ret:
                self._exhausted = True
                break
            self._cur_frame = frame
            self._cur_idx += 1
        return self._cur_frame

    def release(self):
        self.cap.release()


# Visual rotation direction: the shader rotates sampling UVs by `+angle_rad`
# with the matrix [c -s; s c] applied to (uv - 0.5). Sampling-CCW => image-CW.
# OpenCV `getRotationMatrix2D(..., +deg, ..)` rotates the IMAGE CCW. So to
# match the website we pass `-deg`.
ROTATION_SIGN = -1.0


def rotate_keep_size(frame, angle_deg: float):
    h, w = frame.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), ROTATION_SIGN * angle_deg, 1.0)
    return cv2.warpAffine(frame, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))


def thumb(frame, size: int):
    """Center-crop to square then resize to size×size."""
    h, w = frame.shape[:2]
    s = min(h, w)
    y0 = (h - s) // 2
    x0 = (w - s) // 2
    sq = frame[y0:y0 + s, x0:x0 + s]
    return cv2.resize(sq, (size, size), interpolation=cv2.INTER_AREA)


def make_timestamp_col(t: datetime, height: int, width: int):
    """Black canvas with two-line UTC stamp on the left."""
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    date_str = t.strftime("%Y-%m-%d")
    time_str = t.strftime("%H:%M UTC")
    # Auto-scale font to ~1/16th of row height — readable across row sizes
    scale = max(0.45, height / 320.0 * 0.7)
    thickness = max(1, int(round(scale * 1.6)))
    color = (220, 220, 220)
    pad = max(6, height // 24)
    cv2.putText(canvas, date_str, (pad, height // 2 - pad),
                cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
    cv2.putText(canvas, time_str, (pad, height // 2 + int(scale * 30) + pad),
                cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
    return canvas


def make_panel_header(panel_w: int, ts_width: int, row_size: int, height: int):
    """One panel's header band: 'Boston, USA' centered above the Boston column,
    'Santiago, Chile' centered above the Santiago column."""
    canvas = np.zeros((height, panel_w, 3), dtype=np.uint8)
    scale = max(0.6, height / 80.0 * 0.7)
    thickness = max(1, int(round(scale * 1.8)))
    color = (240, 240, 240)
    font = cv2.FONT_HERSHEY_SIMPLEX
    for label, col_x0, col_w in (
        ("Boston, USA",     ts_width,             row_size),
        ("Santiago, Chile", ts_width + row_size,  row_size),
    ):
        (tw, th), _ = cv2.getTextSize(label, font, scale, thickness)
        x = col_x0 + (col_w - tw) // 2
        y = (height + th) // 2
        cv2.putText(canvas, label, (x, y), font, scale, color, thickness, cv2.LINE_AA)
    return canvas


def render_row(boston: Station, santiago: Station, t: datetime,
               row_size: int, ts_width: int):
    b_idx = boston.frame_idx_for_utc(t)
    s_idx = santiago.frame_idx_for_utc(t)
    b_frame = boston.frame_at(b_idx)
    s_frame = santiago.frame_at(s_idx)

    if b_frame is None:
        b_thumb = np.zeros((row_size, row_size, 3), dtype=np.uint8)
    else:
        b_thumb = thumb(rotate_keep_size(b_frame, boston.angles_deg[b_idx]), row_size)
    if s_frame is None:
        s_thumb = np.zeros((row_size, row_size, 3), dtype=np.uint8)
    else:
        s_thumb = thumb(rotate_keep_size(s_frame, santiago.angles_deg[s_idx]), row_size)

    ts_col = make_timestamp_col(t, row_size, ts_width)
    return np.hstack([ts_col, b_thumb, s_thumb])


def overlap_minute_ticks(boston: Station, santiago: Station):
    start = max(boston.coverage_start_utc, santiago.coverage_start_utc)
    end = min(boston.coverage_end_utc, santiago.coverage_end_utc)
    # Snap start UP to next whole minute, end DOWN to previous whole minute.
    start = (start + timedelta(seconds=59)).replace(second=0, microsecond=0)
    end = end.replace(second=0, microsecond=0)
    ticks = []
    t = start
    while t <= end:
        ticks.append(t)
        t += timedelta(minutes=1)
    return ticks, start, end


def main():
    here = Path(__file__).resolve().parent
    repo_root = here.parent.parent
    parser = argparse.ArgumentParser(description="Stereo moon contact sheet (1 row per UTC minute)")
    parser.add_argument("--boston", default=str(repo_root / "frontend/public/footage/yufeng_boston"),
                        help="Boston station folder (mp4 + jsons)")
    parser.add_argument("--santiago", default=str(repo_root / "frontend/public/footage/carlos_santiago"),
                        help="Santiago station folder (mp4 + jsons)")
    parser.add_argument("--output", default=str(here / "contact_sheet.png"),
                        help="Output PNG path")
    parser.add_argument("--row-size", type=int, default=240, help="Per-eye thumbnail edge (px)")
    parser.add_argument("--ts-width", type=int, default=160, help="Timestamp column width (px)")
    parser.add_argument("--interval-sec", type=int, default=60, help="UTC step between rows")
    parser.add_argument("--panels", type=int, default=16,
                        help="Number of side-by-side grid panels (1 = single tall strip).")
    parser.add_argument("--panel-gap", type=int, default=16, help="Pixel gap between panels")
    parser.add_argument("--header-height", type=int, default=72, help="Header band height (px)")
    parser.add_argument("--single-utc", default=None,
                        help="If set, render just this UTC moment (e.g. 2026-03-03T04:00:00Z) and write a single-row PNG. Useful for sign-checking rotation against the website.")
    args = parser.parse_args()

    boston = Station(Path(args.boston))
    santiago = Station(Path(args.santiago))

    print(f"Boston   start={boston.video_start_utc.isoformat()}  "
          f"coverage {boston.coverage_start_utc.isoformat()} → {boston.coverage_end_utc.isoformat()}")
    print(f"Santiago start={santiago.video_start_utc.isoformat()}  "
          f"coverage {santiago.coverage_start_utc.isoformat()} → {santiago.coverage_end_utc.isoformat()}")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if args.single_utc:
        t = parse_iso_utc(args.single_utc)
        row = render_row(boston, santiago, t, args.row_size, args.ts_width)
        cv2.imwrite(str(out_path), row)
        print(f"\nSingle row at {t.isoformat()}")
        print(f"  Boston angle:   {boston.angle_deg_for_utc(t):+.2f}°  (frame {boston.frame_idx_for_utc(t)})")
        print(f"  Santiago angle: {santiago.angle_deg_for_utc(t):+.2f}°  (frame {santiago.frame_idx_for_utc(t)})")
        print(f"  Wrote {out_path}  ({row.shape[1]}×{row.shape[0]})")
        boston.release()
        santiago.release()
        return

    ticks, snap_start, snap_end = overlap_minute_ticks(boston, santiago)
    if args.interval_sec != 60:
        # Re-bucket if user picked a non-1-minute interval
        ticks = []
        t = snap_start
        while t <= snap_end:
            ticks.append(t)
            t += timedelta(seconds=args.interval_sec)

    print(f"\nOverlap: {snap_start.isoformat()} → {snap_end.isoformat()}")
    print(f"  Rows: {len(ticks)} (interval={args.interval_sec}s)")

    n_panels = max(1, args.panels)
    rows_per_panel = (len(ticks) + n_panels - 1) // n_panels   # ceil
    panel_w = args.ts_width + 2 * args.row_size
    panel_gap = args.panel_gap if n_panels > 1 else 0
    header_h = args.header_height
    total_w = n_panels * panel_w + (n_panels - 1) * panel_gap
    total_h = header_h + rows_per_panel * args.row_size
    img = np.zeros((total_h, total_w, 3), dtype=np.uint8)

    print(f"  Grid: {n_panels} panels × {rows_per_panel} rows  →  {total_w}×{total_h} PNG → {out_path}")

    # Header band: one per panel.
    for p in range(n_panels):
        x0 = p * (panel_w + panel_gap)
        img[0:header_h, x0:x0 + panel_w] = make_panel_header(
            panel_w, args.ts_width, args.row_size, header_h)

    # Rows: ticks are still iterated in chronological order (StreamingEye
    # advances forward), but their (x, y) destination is determined by
    # which panel/row they fall into.
    for i, t in enumerate(tqdm(ticks, desc="  Rendering")):
        panel = i // rows_per_panel
        row_in_panel = i % rows_per_panel
        x0 = panel * (panel_w + panel_gap)
        y0 = header_h + row_in_panel * args.row_size
        row = render_row(boston, santiago, t, args.row_size, args.ts_width)
        img[y0:y0 + args.row_size, x0:x0 + panel_w] = row

    boston.release()
    santiago.release()

    print("  Encoding PNG…")
    ok = cv2.imwrite(str(out_path), img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise IOError(f"cv2.imwrite failed for {out_path}")
    size_mb = out_path.stat().st_size / 1e6
    print(f"\nDone. {out_path}  ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
