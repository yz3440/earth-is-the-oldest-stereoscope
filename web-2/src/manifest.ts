// Manifest loader. Reads video_meta.json + frame_to_utc.json directly from
// /footage/<station>/ (symlinked to repo root /videos/). Produces the shape
// that sync.ts needs: startUTC + speedup + videoUrl + station identity.

// The stabilized-rotated videos play at 30 fps and each frame represents
// 1 second of real time (capture was 1 fps). So 1 video-second = 30 real-sec.
const PLAYBACK_FPS = 30;
const NAIVE_TIMELAPSE_FPS = 1;
const SPEEDUP = PLAYBACK_FPS / NAIVE_TIMELAPSE_FPS;  // 30 real-sec per video-sec

export type Side = 'boston' | 'santiago';

interface VideoMeta {
  camera: string;
  location: { city: string; lat: number; lon: number };
  video_start_utc: string;
  timezone: string;
  timelapse_fps: number;
}

interface FrameToUtc {
  source_video: string;
  video_start_utc: string;
  effective_timelapse_fps: number;
}

export interface StationManifest {
  side: Side;
  city: string;
  lat: number;
  lon: number;
  timezone: string;      // raw string from meta, e.g. "EST (UTC-5)"
  startUTC: Date;
  videoUrl: string;
  speedup: number;       // real-sec per video-sec
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
  const [metaRes, frameRes] = await Promise.all([
    fetch(`${dir}/video_meta.json`),
    fetch(`${dir}/frame_to_utc.json`),
  ]);
  if (!metaRes.ok) throw new Error(`meta fetch failed: ${side}`);
  if (!frameRes.ok) throw new Error(`frame fetch failed: ${side}`);
  const meta: VideoMeta = await metaRes.json();
  const frame: FrameToUtc = await frameRes.json();

  const rotated = frame.source_video.replace(/_stabilized\.mp4$/, '_stabilized_rotated_web.mp4');
  const videoUrl = `${dir}/${rotated}`;

  return {
    side,
    city: meta.location.city,
    lat: meta.location.lat,
    lon: meta.location.lon,
    timezone: meta.timezone,
    startUTC: new Date(meta.video_start_utc),
    videoUrl,
    speedup: SPEEDUP,
  };
}

export async function loadManifest(): Promise<Manifest> {
  const [boston, santiago] = await Promise.all([
    loadStation('boston'),
    loadStation('santiago'),
  ]);
  return { boston, santiago };
}
