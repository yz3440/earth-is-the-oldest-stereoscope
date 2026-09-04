// Manifest loader. Reads video_meta.json + stereo_angles.json (emitted by
// 04_simulate_rotation.py) directly from /footage/<station>/. The station
// dirs under /frontend/public/footage/ hold the compressed stabilized videos
// plus the per-frame angle + timing anchors the viewer needs to rotate
// frames on-the-fly.

export type Side = 'boston' | 'santiago';

interface VideoMeta {
  camera: string;
  location: { city: string; lat: number; lon: number };
  video_start_utc: string;
  timezone: string;
  timelapse_fps: number;
}

interface StereoAngles {
  source_video: string;
  camera: string;
  video_start_utc: string;
  effective_timelapse_fps: number;
  video_fps: number;
  total_frames: number;
  angle_range_deg: [number, number];
  frame_real_times_sec: number[];
  angles_deg: number[];
}

export interface StationManifest {
  side: Side;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
  startUTC: Date;
  videoUrl: string;
  speedup: number;               // real-sec per video-sec (linear approximation)
  videoFps: number;              // encoded playback fps
  totalFrames: number;
  frameRealTimesSec: Float32Array; // per-frame seconds since video start
  anglesDeg: Float32Array;         // per-frame stereo correction angle
}

export interface Manifest {
  boston: StationManifest;
  santiago: StationManifest;
}

const STATION_DIRS: Record<Side, string> = {
  boston: '/footage/yufeng_boston',
  santiago: '/footage/carlos_santiago',
};

// The primary web encode is HEVC Main 10 (`hvc1`, level 4.0 -> "L120"). Chrome
// on Android only plays it when the SoC has a hardware Main10 decoder, and
// Firefox Android / Linux desktop often can't at all - in which case the
// <video> fails with MEDIA_ERR_SRC_NOT_SUPPORTED. Probe once and fall back to
// the 8-bit H.264 encode (`*_stabilized_h264_web.mp4`, produced by
// 06_compress_for_web.py --codec h264). Unknown -> assume HEVC (the previous
// behaviour) so a probe failure never regresses working browsers.
const HEVC_MAIN10 = 'video/mp4; codecs="hvc1.2.4.L120.B0"';
let hevcProbe: Promise<boolean> | null = null;
function canPlayHevc(): Promise<boolean> {
  return (hevcProbe ??= (async () => {
    try {
      const mc = navigator.mediaCapabilities;
      if (mc?.decodingInfo) {
        const r = await mc.decodingInfo({
          type: 'file',
          video: {
            contentType: HEVC_MAIN10,
            width: 1080,
            height: 1080,
            bitrate: 450_000,
            framerate: 30,
          },
        });
        return r.supported;
      }
      return document.createElement('video').canPlayType(HEVC_MAIN10) !== '';
    } catch {
      return true;
    }
  })());
}

async function isDeployed(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

async function loadStation(side: Side): Promise<StationManifest> {
  const dir = STATION_DIRS[side];
  const [metaRes, anglesRes] = await Promise.all([
    fetch(`${dir}/video_meta.json`),
    fetch(`${dir}/stereo_angles.json`),
  ]);
  if (!metaRes.ok) throw new Error(`meta fetch failed: ${side}`);
  if (!anglesRes.ok) throw new Error(`stereo_angles fetch failed: ${side}`);
  const meta: VideoMeta = await metaRes.json();
  const angles: StereoAngles = await anglesRes.json();

  // Serve the unrotated stabilized video; rotation is applied in the shader.
  // The H.264 fallbacks are too large for git, so a deployment may not ship
  // them: only switch to one that is actually there, else stay on HEVC.
  const urlFor = (suffix: string) =>
    `${dir}/${angles.source_video.replace(/_stabilized\.mp4$/, suffix)}`;
  const hevcUrl = urlFor('_stabilized_web.mp4');
  const h264Url = urlFor('_stabilized_h264_web.mp4');
  const videoUrl = (await canPlayHevc()) || !(await isDeployed(h264Url)) ? hevcUrl : h264Url;

  // Real-sec per video-sec. Seestar reports timelapse_fps=1 but the
  // calibrator measures ~0.71; for a 30 fps encode that's ~42.2.
  const speedup = angles.video_fps / angles.effective_timelapse_fps;

  return {
    side,
    city: meta.location.city,
    lat: meta.location.lat,
    lon: meta.location.lon,
    timezone: meta.timezone,
    startUTC: new Date(meta.video_start_utc),
    videoUrl,
    speedup,
    videoFps: angles.video_fps,
    totalFrames: angles.total_frames,
    frameRealTimesSec: Float32Array.from(angles.frame_real_times_sec),
    anglesDeg: Float32Array.from(angles.angles_deg),
  };
}

export async function loadManifest(): Promise<Manifest> {
  const [boston, santiago] = await Promise.all([
    loadStation('boston'),
    loadStation('santiago'),
  ]);
  return { boston, santiago };
}
