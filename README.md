# Stereo Moon

Two telescopes (Boston + Santiago) film the moon simultaneously during the March 2026 lunar eclipse, creating a stereo pair where the Earth itself is the observer.

## Structure

- `viewer/` — Three.js web app: 3D Earth-Moon visualization, telescope PIP cameras, keyframe export
- `stabilize/` — Python pipeline: tracking, stabilization, gaze correction, stereo compositing
- `videos/` — Raw and processed video files + per-camera metadata

## Viewer

Interactive 3D visualization with ephemeris data, eclipse shadow rendering, and simulated telescope views (before/after stereo correction).

```bash
cd viewer
bun install
bun run dev
```

Click **EXPORT KEYFRAMES (JSON)** to generate `stereo-moon-keyframes.json` — this drives the video rotation pipeline.

## Video Pipeline

All commands run from the `stabilize/` directory.

```bash
cd stabilize
uv sync
```

### Step 1 — Track moon offsets

Phase correlation to measure frame-by-frame translation. Use `01a` for ~4x faster (downsampled).

```bash
uv run python 01_track_moon.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse.mp4

uv run python 01_track_moon.py \
  ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse.mp4
```

### Step 2 — Stabilize

Applies translation offsets and crops to 1080x1080. Opens a GUI to pick the crop center, or pass `--center X,Y`.

```bash
uv run python 02_stabilize_moon.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_offsets.json

uv run python 02_stabilize_moon.py \
  ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse_offsets.json
```

### Step 3 — Rotate (stereo gaze correction)

Applies per-frame rotation from the viewer's exported keyframes to align both cameras to a shared stereo baseline (Boston-Santiago). Both cameras use the same baseline direction so the corrected videos form a proper stereo pair.

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

### Step 4 — Stereo composite

Combines both rotated videos side-by-side, aligned by UTC time.

```bash
uv run python 04_stereo_moon.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/yufeng_boston/video_meta.json \
  ../videos/carlos_santaigo/2026-03-02-214004-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/carlos_santaigo/video_meta.json
```

## Timeline

| Event                   | UTC                      |
| ----------------------- | ------------------------ |
| Boston video start      | 2026-03-02 22:41         |
| Santiago video start    | 2026-03-03 00:40         |
| Eclipse penumbral start | 2026-03-03 09:00         |
| Eclipse totality        | 2026-03-03 11:15 — 12:00 |
| Simulation end          | 2026-03-03 15:00         |
