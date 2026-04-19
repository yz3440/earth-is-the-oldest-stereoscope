// Manifest loader. Reads video_meta.json + stereo_angles.json (emitted by
// 04_simulate_rotation.py) directly from /footage/<station>/. The station
// dirs under /web-2/public/footage/ hold the compressed stabilized videos
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
  const stabilizedWeb = angles.source_video.replace(/_stabilized\.mp4$/, '_stabilized_web.mp4');
  const videoUrl = `${dir}/${stabilizedWeb}`;

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
