# video-processing

The full stereo-moon processing pipeline in one uv project. Takes two raw
telescope captures (Boston + Santiago) and produces a stabilized,
gaze-corrected, UTC-aligned side-by-side stereo composite.

All sky-geometry math is in Python — no viewer round-trip, no
reference-PNG export.

## Setup

```bash
cd new-mono/video-processing
uv sync
```

## Pipeline

```text
raw .mp4 (from telescope)
    │
    ▼  01_track.py       — phase-correlation translation tracking
*_offsets.json
    │
    ▼  02_stabilize.py   — apply offsets, crop to 1080×1080
*_stabilized.mp4
    │
    ▼  03_calibrate.py           — analytical raw-view rotation curve vs real-video ECC
frame_to_utc.json                (per-frame UTC anchor table, ~85 anchors)
    │
    ▼  04_simulate_rotation.py   — per-frame stereo_correction via astro.py
stereo_angles.json               (per-frame roll angles, ~600 KB / side)
    │
    ▼  05_apply_rotation.py      — warp + H.264 encode (pixel-only)
*_stabilized_rotated.mp4
    ├──▶ 06_compress_for_web.py  — CRF 30 + faststart for browser playback
    │    *_stabilized_rotated_web.mp4
    │
    ▼  07_stereo.py              — union-of-UTC side-by-side composite (off the CRF 18 source)
stereo_moon.mp4
```

Each step writes outputs next to its input video. The pipeline runs
end-to-end per camera, then `07_stereo.py` combines both cameras.

Splitting the rotation into `04_simulate_rotation.py` (astronomy, seconds)
and `05_apply_rotation.py` (warp + encode, minutes) lets you iterate on the
stereo math without re-encoding the video, and the same `stereo_angles.json`
feeds both the pre-rendered output and the in-browser viewer.

## Run the whole pipeline

Copy-paste this from `new-mono/video-processing/` after `uv sync`. It
runs 01→06 for Boston, 01→06 for Santiago, then 07 to composite. The
two cameras are independent through step 06 — feel free to split them
across two shells if you want them to run in parallel.

```bash
# --- paths (edit if the raw filenames change) ---
L_DIR=../videos/yufeng_boston
R_DIR=../videos/carlos_santiago
L_RAW=$L_DIR/2026-03-02-174133-Lunar-timelapse.mp4
R_RAW=$R_DIR/2026-03-02-214004-Lunar-timelapse.mp4

L_STEM=${L_RAW%.mp4}
R_STEM=${R_RAW%.mp4}

# --- 01 track (phase correlation, --scale 2 for ~4x speedup) ---
uv run python 01_track.py "$L_RAW" --scale 2
uv run python 01_track.py "$R_RAW" --scale 2

# --- 02 stabilize + crop to 1080x1080 ---
# Omit --center to pick the crop center interactively in the GUI.
uv run python 02_stabilize.py "${L_STEM}_offsets.json"
uv run python 02_stabilize.py "${R_STEM}_offsets.json"

# --- 03 calibrate frame_idx -> UTC ---
# Add --end-frame N on Boston if the eclipse-totality tail breaks the fit.
uv run python 03_calibrate.py \
  "${L_STEM}_stabilized.mp4" "$L_DIR/video_meta.json" \
  -o "$L_DIR/frame_to_utc.json"
uv run python 03_calibrate.py \
  "${R_STEM}_stabilized.mp4" "$R_DIR/video_meta.json" \
  -o "$R_DIR/frame_to_utc.json"

# --- 04 simulate stereo-correction rotation angles (pure astronomy) ---
uv run python 04_simulate_rotation.py \
  "${L_STEM}_stabilized.mp4" "$L_DIR/video_meta.json" "$L_DIR/frame_to_utc.json"
uv run python 04_simulate_rotation.py \
  "${R_STEM}_stabilized.mp4" "$R_DIR/video_meta.json" "$R_DIR/frame_to_utc.json"

# --- 05 apply rotation (warp + H.264 encode) ---
uv run python 05_apply_rotation.py \
  "${L_STEM}_stabilized.mp4" "$L_DIR/stereo_angles.json"
uv run python 05_apply_rotation.py \
  "${R_STEM}_stabilized.mp4" "$R_DIR/stereo_angles.json"

# --- 06 compress for web (CRF 30 H.264, ~7-8x smaller) ---
uv run python 06_compress_for_web.py "${L_STEM}_stabilized_rotated.mp4"
uv run python 06_compress_for_web.py "${R_STEM}_stabilized_rotated.mp4"

# --- 07 stereo side-by-side (union of UTC ranges, off the CRF 18 source) ---
uv run python 07_stereo.py \
  "${L_STEM}_stabilized_rotated.mp4" "$L_DIR/video_meta.json" \
  "${R_STEM}_stabilized_rotated.mp4" "$R_DIR/video_meta.json" \
  --left-frame-to-utc  "$L_DIR/frame_to_utc.json" \
  --right-frame-to-utc "$R_DIR/frame_to_utc.json" \
  -o stereo_moon.mp4

# --- optional: verify rotated output drifts smoothly ---
uv run python measure_rotation.py \
  "${L_STEM}_stabilized_rotated.mp4" --start-frame 0 --end-frame 25000 --step 30
```

Per-step details, flags, and known caveats are below.

## Steps

### 01 — Track moon offsets

Phase correlation measures frame-by-frame translation, re-anchoring to
frame 0 every 100 frames to bound drift. Low-response frames (clouds,
eclipse dimming) are interpolated from neighbors. Use `--scale 2` for a
~4× speedup on the correlation math (downsamples before phaseCorrelate,
scales offsets back up).

```bash
uv run python 01_track.py ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse.mp4
uv run python 01_track.py ../videos/carlos_santiago/2026-03-02-214004-Lunar-timelapse.mp4
```

### 02 — Stabilize + crop

Applies the translation offsets and crops to 1080×1080. Opens a GUI so you
can click the output center, or pass `--center X,Y`.

```bash
uv run python 02_stabilize.py ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_offsets.json
uv run python 02_stabilize.py ../videos/carlos_santiago/2026-03-02-214004-Lunar-timelapse_offsets.json
```

### 03 — Calibrate `frame_idx → UTC`

The Seestar Z50's reported `timelapse_fps: 1` is off by ~30 % and drifts
non-linearly across the night (autofocus pauses, write hiccups). This
step measures the video's rotation curve via ECC and shape-matches it
against an analytical field-rotation curve (`astro.cumulative_field_rotation`)
to derive a per-frame UTC anchor table.

```bash
uv run python 03_calibrate.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized.mp4 \
  ../videos/yufeng_boston/video_meta.json \
  -o ../videos/yufeng_boston/frame_to_utc.json

uv run python 03_calibrate.py \
  ../videos/carlos_santiago/2026-03-02-214004-Lunar-timelapse_stabilized.mp4 \
  ../videos/carlos_santiago/video_meta.json \
  -o ../videos/carlos_santiago/frame_to_utc.json
```

Pass `--end-frame N` only to exclude a known-bad tail (e.g. the
eclipse-totality window on Boston where 02_stabilize loses lock on the
moon). By default the calibrator processes every frame of the video.

### 04 — Simulate rotation (pure astronomy)

Looks up each frame's UTC from the anchor table (with linear extrapolation
past the anchors) and computes `astro.stereo_correction` on a coarse sim-time
grid (default 5 s cadence, interp error < 1e-3°), then interpolates to
per-frame. Emits `stereo_angles.json` with per-frame `angles_deg` and
`frame_real_times_sec`. No video pixels touched — runs in seconds.

```bash
uv run python 04_simulate_rotation.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized.mp4 \
  ../videos/yufeng_boston/video_meta.json \
  ../videos/yufeng_boston/frame_to_utc.json
```

### 05 — Apply rotation (pixel-only warp + encode)

Reads `stereo_angles.json` and applies `cv2.warpAffine(..., -angles_deg[i])`
per frame, encoding H.264 / yuv420p / +faststart so the output plays in
browsers. Decoupled from step 04 so you can iterate on the stereo math
without re-encoding.

```bash
uv run python 05_apply_rotation.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized.mp4 \
  ../videos/yufeng_boston/stereo_angles.json
```

### 06 — Compress for web

H.264 / yuv420p / +faststart at CRF 30 + slow preset. For a stabilized moon
on a black sky this gives ~7-8x reduction over the rotated source while
staying visually indistinguishable. Produces `<input>_web.mp4` by default.

```bash
uv run python 06_compress_for_web.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized_rotated.mp4
```

### 07 — Stereo side-by-side

Composites both rotated videos into a single side-by-side stereo stream
aligned by UTC. The output spans the **union** of the two recordings —
Boston's pre-overlap solo footage, the overlap, and any solo tail — with
black frames filling whichever panel isn't recording.

```bash
uv run python 07_stereo.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/yufeng_boston/video_meta.json \
  ../videos/carlos_santiago/2026-03-02-214004-Lunar-timelapse_stabilized_rotated.mp4 \
  ../videos/carlos_santiago/video_meta.json \
  --left-frame-to-utc  ../videos/yufeng_boston/frame_to_utc.json \
  --right-frame-to-utc ../videos/carlos_santiago/frame_to_utc.json
```

### Diagnostic — measure rotation

`measure_rotation.py` reports the cumulative ECC rotation curve of any moon
video (or directory of PNGs). Useful for verifying that a rotated output
drifts smoothly and minimally.

```bash
uv run python measure_rotation.py \
  ../videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse_stabilized_rotated.mp4 \
  --start-frame 0 --end-frame 25000 --step 30
# Expect monotonic drift of a few degrees over the clean range.
```

## Library

[`astro.py`](astro.py) ports the relevant parts of
[`../../viewer/src/astronomy.ts`](../../viewer/src/astronomy.ts):

- `BOSTON`, `SANTIAGO` — observer locations
- `observer_j2000(site, when)` — GAST-rotated ECEF → J2000 (AU)
- `moon_j2000(when)` — `GeoVector(Body.Moon, ..., aberration=True)`
- `stereo_correction(this_pos, moon_pos, shared_baseline)` — roll angle to
  align the shared baseline horizontally in the raw image plane
- `cumulative_field_rotation(times, site)` — analytical target curve used
  by `03_calibrate.py`

Self-test:

```bash
uv run python astro.py
# Boston/Santiago stereo_correction at 2026-03-02 22:41:00 UTC must match
# the TS viewer's exported keyframes to ±0.01°.
```

## Known issue: eclipse-totality tracker

`01_track.py`'s phase correlation can lock onto stars or noise instead of
the moon during eclipse totality (moon dims, phaseCorrelate finds a
higher-scoring wrong match). The practical workaround is to pass
`--end-frame <N>` to `03_calibrate.py` to exclude the bad tail from the
anchor table. A proper fix (luminance-aware tracker or calibration-seeded
position prediction) is a separate task.

## Empirical reference (Boston, clean range 0–25 000)

| Metric                                         | Value  |
| ---------------------------------------------- | ------ |
| `effective_timelapse_fps` from 03_calibrate.py | ~0.707 |
| Per-anchor residual std                        | 0.71°  |
| Residual drift in rotated output               | +6.94° |

For the same clean range, the output is qualitatively indistinguishable
from the legacy PNG-reference-based calibration (+6.09° drift).
