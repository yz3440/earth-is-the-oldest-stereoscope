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
// <video> fails with MEDIA_ERR_SRC_NOT_SUPPORTED. Decide *before* downloading
// ~96 MB of footage, in two stages:
//   1. What the browser claims (mediaCapabilities / canPlayType). Fast; a "no"
//      is trusted. A "yes" is not - low-end Android Chrome reports a Main10
//      decoder that then fails on the real stream.
//   2. Actually decode one frame of a 1 s clip cut with the same encoder
//      settings (64 KB, /footage/probe/). Only a decoded frame counts; a
//      decode error or a timeout means "use the 8-bit H.264 encode".
// Unknown -> assume HEVC (the previous behaviour) so a probe failure never
// regresses working browsers.
const HEVC_MAIN10 = 'video/mp4; codecs="hvc1.2.4.L120.B0"';
const HEVC_PROBE_URL = '/footage/probe/hevc-main10-1s.mp4';
const HEVC_PROBE_TIMEOUT_MS = 6000;

async function browserClaimsHevc(): Promise<boolean> {
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
}

// Decode test. The clip is fetched into a blob first so a network failure
// (e.g. a build that omitted it) is told apart from a decode failure: the
// former keeps stage 1's answer, the latter is a definite "no". Playing from a
// blob URL also mirrors exactly how the real footage is played.
async function decodesHevcClip(): Promise<boolean | null> {
  let blobUrl: string;
  try {
    const res = await fetch(HEVC_PROBE_URL);
    if (!res.ok) return null;
    blobUrl = URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
  return new Promise<boolean>((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let settled = false;
    const finish = (ok: boolean, why: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      console.log(`[hevc-probe] ${ok ? 'decoded' : 'failed'} (${why})`);
      v.pause();
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(blobUrl);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false, 'timeout'), HEVC_PROBE_TIMEOUT_MS);
    // Only a decoded frame counts: metadata parses fine on devices that then
    // fail to decode. play() drives the decoder past Android's preload cap;
    // an autoplay refusal isn't a decode failure, so its rejection is ignored.
    v.addEventListener('loadeddata', () => finish(true, 'loadeddata'), { once: true });
    v.addEventListener('timeupdate', () => {
      if (v.currentTime > 0) finish(true, 'timeupdate');
    });
    v.addEventListener('error', () => {
      const e = v.error;
      finish(false, `error code=${e?.code ?? '?'} ${e?.message ?? ''}`.trim());
    }, { once: true });
    v.src = blobUrl;
    v.play().catch(() => {});
  });
}

let hevcProbe: Promise<boolean> | null = null;
export function canPlayHevc(): Promise<boolean> {
  return (hevcProbe ??= (async () => {
    if (!(await browserClaimsHevc())) return false;
    const decoded = await decodesHevcClip();
    return decoded ?? true;
  })());
}

// HEAD-check a footage URL. Requires a video content type, not just 200: SPA
// hosts (and Vite's dev server) answer unknown paths with the HTML shell.
async function isDeployed(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('video/');
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
  // Only switch to an H.264 fallback that is actually deployed (HEAD check),
  // else stay on HEVC — guards against a build that omitted the files.
  const urlFor = (suffix: string) =>
    `${dir}/${angles.source_video.replace(/_stabilized\.mp4$/, suffix)}`;
  const hevcUrl = urlFor('_stabilized_web.mp4');
  // The H.264 files ship in the repo next to the HEVC ones. Set
  // VITE_FOOTAGE_H264_BASE (e.g. an R2 / S3 bucket URL that sends CORS
  // headers for GET + HEAD) to serve them from elsewhere instead; empty
  // means same-origin.
  const h264Base = (import.meta.env.VITE_FOOTAGE_H264_BASE ?? '').replace(/\/$/, '');
  const h264Url = `${h264Base}${urlFor('_stabilized_h264_web.mp4')}`;
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
  void canPlayHevc(); // kick off the decode probe alongside the JSON fetches
  const [boston, santiago] = await Promise.all([
    loadStation('boston'),
    loadStation('santiago'),
  ]);
  return { boston, santiago };
}
