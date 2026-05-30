# Earth is the Oldest Stereoscope

A stereo pair of the Moon, captured simultaneously from Boston and Santiago
during the [lunar eclipse on 2026-03-02/03](https://www.timeanddate.com/eclipse/lunar/2026-march-3).
Two rooftops, two Seestar S50 telescopes, one Moon. The baseline between the
cameras is about 11,000 km — Earth itself.

This repository holds the processing pipeline, metadata, and browser viewer
for the project.

## Contents

```text
stereo-moon/
├── video-processing/                 # Python pipeline (uv): track → stabilize →
│                                     # calibrate → simulate → rotate → stereo
├── videos/
│   ├── yufeng_boston/
│   │   ├── 2026-03-02-174133-Lunar-timelapse.mp4   ← raw (not in repo)
│   │   └── video_meta.json                          ← committed
│   └── carlos_santiago/
│       ├── 2026-03-02-214004-Lunar-timelapse.mp4   ← raw (not in repo)
│       └── video_meta.json                          ← committed
└── frontend/                         # Vite + Preact + Three.js browser viewer
    └── public/
        ├── footage/                  # *_web.mp4 (committed) + stereo_angles.json
        └── textures/                 # Earth + Moon maps (CC BY 4.0 / NASA SVS)
```

## What's committed, what isn't

Most of the pipeline's output is large binary data that is regenerable from
the raw captures, so only the small JSON artifacts and the compressed
browser-viewer videos are tracked. See [.gitignore](.gitignore).

**Committed:**

- All Python pipeline scripts in [`video-processing/`](video-processing/)
- `video_meta.json` for each capture (observer lat/lon, UTC start, fps)
- `stereo_angles.json` (per-frame roll angle; viewer input)
- `frontend/public/footage/**/*_web.mp4` — the CRF 30 stabilized videos the
  browser viewer streams (allow-listed exception to the `*.mp4` ignore)
- All frontend code and textures

**Not committed (regenerable or too large):**

- Raw telescope captures (`.mp4`) — see [Getting the raw videos](#getting-the-raw-videos)
- Intermediate pipeline outputs: `*_offsets.json`, `*_measured_rotation.json`,
  `frame_to_utc.json`, `*_stabilized*.mp4`, `*_rotated*.mp4`, `stereo_moon.mp4`
- `.venv/`, `node_modules/`, `dist/`, `__pycache__/`
- `stereo-moon-reference-frames/` (re-exportable from the viewer)

## Getting the raw videos

Download the two raw Seestar S50 captures from the
[Google Drive folder](https://drive.google.com/drive/folders/1du3FQlV5k2nVcaGt13kYVzGiATHTmKKl?usp=sharing)
and drop them into place:

| Site     | File                                    | Source                                                                                               |
| -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Boston   | `2026-03-02-174133-Lunar-timelapse.mp4` | [Google Drive](https://drive.google.com/drive/folders/1du3FQlV5k2nVcaGt13kYVzGiATHTmKKl?usp=sharing) |
| Santiago | `2026-03-02-214004-Lunar-timelapse.mp4` | [Google Drive](https://drive.google.com/drive/folders/1du3FQlV5k2nVcaGt13kYVzGiATHTmKKl?usp=sharing) |

Target paths (must match the filenames above — the pipeline derives sibling
filenames from these):

```text
videos/yufeng_boston/2026-03-02-174133-Lunar-timelapse.mp4
videos/carlos_santiago/2026-03-02-214004-Lunar-timelapse.mp4
```

The accompanying `video_meta.json` files are already in the repo and encode
the observer location, UTC start time, and nominal frame rate used by the
calibration step.

## Reproducing the composite

The processing pipeline is Python, managed with [`uv`](https://docs.astral.sh/uv/).
It takes the two raw captures and produces a stabilized, gaze-corrected,
UTC-aligned side-by-side stereo composite.

```bash
cd video-processing
uv sync
```

Then run the steps end-to-end — see
[`video-processing/README.md`](video-processing/README.md) for the full
copy-paste block, per-step flags, and caveats (e.g. the eclipse-totality
tracker workaround).

At a glance:

```text
raw .mp4
  ├─ 01_track.py              phase-correlation translation
  ├─ 02_stabilize.py          apply offsets + 1080×1080 crop
  ├─ 03_calibrate.py          frame_idx → UTC (ECC vs analytical curve)
  ├─ 04_simulate_rotation.py  stereo_angles.json (per-frame roll, astronomy only)
  ├─ 05_apply_rotation.py     cv2.warpAffine + H.264 encode
  ├─ 06_compress_for_web.py   CRF 30 browser-friendly mp4
  └─ 07_stereo.py             side-by-side union over shared UTC → stereo_moon.mp4
```

Step 04 (pure astronomy, seconds) is decoupled from step 05 (pixel warp +
encode, minutes) so you can iterate on the stereo math without re-encoding.
The same `stereo_angles.json` feeds both the pre-rendered composite and the
in-browser viewer.

## Running the browser viewer

The viewer plays the two stabilized captures, applies the per-frame roll
angle live in WebGL, and renders a side-by-side (or red-cyan) stereo view
with an Earth/Moon/Sun sim in the corner.

```bash
cd frontend
bun install
bun run dev
```

The viewer streams the `*_stabilized_web.mp4` files and `stereo_angles.json`
from `frontend/public/footage/`, both of which are committed — so the viewer
runs without downloading the raw captures.

## Stereo correction, briefly

Each telescope is a horizon-leveled alt-az mount, so the Moon's image rotates
through the frame as the sky rotates overhead. Boston and Santiago see
different fields of rotation because they are in different hemispheres. To
fuse stereoscopically, every frame is stabilized, then rolled by the angle
that aligns the Boston↔Santiago baseline horizontally in that camera's image
plane at that UTC instant. The roll is computed from observer geodetics and
the Moon's J2000 position; see
[`video-processing/astro.py`](video-processing/astro.py) (and its TS twin at
[`frontend/src/astronomy.ts`](frontend/src/astronomy.ts)) for the math.

## Credits

- **Boston capture:** Yufeng Zhao, 42.36°N / -71.06°E
- **Santiago capture:** Carlos, -33.45°N / -70.66°E
- **Hardware:** two [Seestar S50](https://www.seestar.com/) smart telescopes
- **Earth textures:** [Solar System Scope](https://www.solarsystemscope.com/textures/),
  CC BY 4.0
- **Moon textures:** [NASA SVS — CGI Moon Kit](https://svs.gsfc.nasa.gov/4720)
- **Astronomy:** [`astronomy-engine`](https://github.com/cosinekitty/astronomy)
  (Don Cross)
