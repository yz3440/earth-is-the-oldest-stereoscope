# Stabilize Pipeline

Moon video tracking, stabilization, gaze correction, and stereo compositing.

## Setup

```bash
cd stabilize
uv sync
```

## Pipeline

### 01 — Track moon offsets

Uses phase correlation to measure frame-by-frame translation. Use `01a` for ~4x faster processing (downsampled).

```bash
uv run python 01_track_moon.py ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse.mp4
uv run python 01_track_moon.py ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse.mp4
```

### 02 — Stabilize

Applies translation offsets and crops to 1080x1080. Opens a GUI to pick the crop center, or pass `--center X,Y`.

```bash
uv run python 02_stabilize_moon.py ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_offsets.json
uv run python 02_stabilize_moon.py ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse_offsets.json
```

### 03 — Rotate (gaze correction)

Applies per-frame rotation from the viewer's keyframes to align the stereo baseline horizontally.

```bash
uv run python 03_rotate_moon.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized.mp4 \
  ../stereo-moon-keyframes.json \
  ../videos/yufeng_boston/video_meta.json

uv run python 03_rotate_moon.py \
  ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse_stabilized.mp4 \
  ../stereo-moon-keyframes.json \
  ../videos/carlos_santaigo/video_meta.json
```

### 04 — Stereo composite

Combines both rotated videos side-by-side, aligned by UTC time. Black frames appear when only one camera is recording.

```bash
uv run python 04_stereo_moon.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/yufeng_boston/video_meta.json \
  ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/carlos_santaigo/video_meta.json
```
