# HEVC decode probe

`hevc-main10-1s.mp4` is one second (30 frames) of the Boston footage encoded
with exactly the settings of the shipped `*_stabilized_web.mp4` files: HEVC
Main 10, `yuv420p10le`, 1080x1080, tagged `hvc1`. The viewer decodes one frame
of it before downloading the ~96 MB of footage; if the device can't, it loads
the 8-bit H.264 encodes instead (see `frontend/src/manifest.ts`).

Regenerate after changing the web encode settings:

```
ffmpeg -ss 300 -t 1 -i videos/yufeng_boston/<...>_stabilized.mp4 \
  -c:v libx265 -preset medium -crf 28 -tag:v hvc1 -pix_fmt yuv420p10le \
  -movflags +faststart -an frontend/public/footage/probe/hevc-main10-1s.mp4
```
