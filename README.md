# new-mono

Consolidated stereo-moon monorepo.

```text
new-mono/
├── videos/                 # raw telescope captures + metadata
│   ├── yufeng_boston/
│   │   ├── 2026-03-02-174133-Lunar-timelapse.mp4
│   │   └── video_meta.json
│   └── carlos_santaigo/
│       ├── 2026-03-02-214004-Lunar-timelapse.mp4
│       └── video_meta.json
└── video-processing/       # full Python pipeline (track → stabilize → calibrate → rotate → stereo)
    └── README.md
```

See [video-processing/README.md](video-processing/README.md) for the end-to-end
pipeline.

## What's here vs. what's not

- **Here:** raw video + video_meta.json, and the Python pipeline.
- **Not here yet:** the frontend viewer. That migration is a separate
  follow-up.

## Provenance

The Python pipeline merges and supersedes:

- the repo's original `stabilize/` folder (tracking, stabilization,
  legacy rotation, stereo compositing)
- the `calibration/` folder (analytical, all-Python calibration +
  rotation, shipped alongside this repo's move to the monorepo layout)

Those two folders are left in place at the repo root during the
transition. Once this folder's pipeline has regenerated the derived
artifacts in `videos/`, both legacy folders can be deleted.
