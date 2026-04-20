import './style.css';
import { render } from 'preact';
import { effect } from '@preact/signals';
import { useState, useEffect } from 'preact/hooks';
import { computeFrame, SIM_START, SIM_END } from './astronomy';
import type { EclipseData } from './astronomy';
import { PlanetaryScene } from './scene';
import { StereoRenderer } from './stereo';
import { StereoSync } from './sync';
import type { VideoTrack } from './sync';
import { resolveEyeSource } from './sources';
import { loadManifest } from './manifest';
import type { Manifest, Side } from './manifest';
import { localTime, localDate, tzAbbrev } from './localtime';
import { weatherFor } from './weather';
import { getLoadingCanvas } from './loading';
import footageSizes from 'virtual:footage-sizes';
import { App } from './App';
import type { EyeData } from './components/EyeOverlay';
import {
  currentTime,
  playing,
  videosReady,
  loadProgress,
  rateIdx,
  layout,
  encoding,
  sourceMode,
  correction,
  flipHead,
  isNarrow,
  parallaxPx,
  view,
  showTelescopes,
  scrubbing,
  RATE_STEPS,
  DEFAULT_RATE_INDEX,
} from './state';

const CROSSFADE_THRESHOLD_RATE = 30;
const DEG2RAD = Math.PI / 180;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// --- Singletons ---
// Scene creation can throw if WebGL2 isn't available. Swallow so the UI
// renders anyway — the stereo renderer is the primary view and has its
// own WebGL2 context that may succeed independently.
let scene: PlanetaryScene;
try {
  scene = new PlanetaryScene();
  scene.setPIPOutputsEnabled(true);
} catch (err) {
  console.error('[frontend] scene init failed (WebGL2 required):', err);
  // Stub scene for typechecks; app will render without sim view.
  scene = null as unknown as PlanetaryScene;
}
const sync = new StereoSync();
sync.setSimRate(RATE_STEPS[DEFAULT_RATE_INDEX]);

let manifest: Manifest | null = null;
let bostonVideo: HTMLVideoElement | null = null;
let santiagoVideo: HTMLVideoElement | null = null;
let stereo: StereoRenderer | null = null;
let frameParity = 0;

// --- Cross-fade per side ---
interface FadeState {
  prevCanvas: HTMLCanvasElement;
  pendingCanvas: HTMLCanvasElement;
  lastShownFrame: number;
  transitionWallMs: number;
  prevInitialized: boolean;
}
function makeFadeState(): FadeState {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1080;
    return c;
  };
  return {
    prevCanvas: mk(),
    pendingCanvas: mk(),
    lastShownFrame: -1,
    transitionWallMs: 0,
    prevInitialized: false,
  };
}
const fadeState: Record<Side, FadeState> = {
  boston: makeFadeState(),
  santiago: makeFadeState(),
};

// Fetches the entire MP4 into memory and points <video> at a blob URL.
// The deployed CDN/proxy serves these files without HTTP Range support, so
// `<video src=URL>` can only seek inside the linearly-buffered region —
// any scrub past it gets clamped to 0. Holding the file in a blob makes
// `seekable` cover the full duration; every seek is instant memory access.
async function makeVideo(
  src: string,
  onProgress?: (received: number, total: number) => void,
): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  const tag = src.split('/').slice(-2).join('/');
  v.addEventListener('error', () => {
    const e = v.error;
    console.warn(`[video:${tag}] error code=${e?.code} msg=${e?.message}`);
  });
  v.addEventListener('stalled', () => console.warn(`[video:${tag}] stalled`));

  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch ${src} failed: ${res.status}`);
  // Prefer the server-reported size; fall back to the build-time stat of the
  // file in public/footage/ when the server omits Content-Length (e.g.
  // chunked transfer on the deployed CDN — caught in prod logs as "0.0MB").
  const headerTotal = Number(res.headers.get('content-length')) || 0;
  const urlPath = new URL(src, location.href).pathname;
  const total = headerTotal || footageSizes[urlPath] || 0;
  let received = 0;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let lastLog = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
    const now = performance.now();
    if (now - lastLog > 500) {
      const pct = total ? ((received / total) * 100).toFixed(1) : '?';
      console.log(`[video:${tag}] ${(received / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB (${pct}%)`);
      lastLog = now;
    }
  }
  onProgress?.(received, received);
  const blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
  v.src = URL.createObjectURL(blob);
  console.log(`[video:${tag}] ready (${(blob.size / 1e6).toFixed(1)}MB)`);
  return v;
}

async function bootManifest() {
  try {
    manifest = await loadManifest();
  } catch (err) {
    console.warn('[frontend] manifest failed; sim-only fallback:', err);
    return;
  }
  const bytes = {
    boston: { received: 0, total: 0 },
    santiago: { received: 0, total: 0 },
  };
  const updateProgress = () => {
    const totalBoth = bytes.boston.total + bytes.santiago.total;
    const receivedBoth = bytes.boston.received + bytes.santiago.received;
    loadProgress.value = totalBoth > 0 ? Math.min(1, receivedBoth / totalBoth) : 0;
  };
  [bostonVideo, santiagoVideo] = await Promise.all([
    makeVideo(manifest.boston.videoUrl, (r, t) => {
      bytes.boston.received = r;
      bytes.boston.total = t;
      updateProgress();
    }),
    makeVideo(manifest.santiago.videoUrl, (r, t) => {
      bytes.santiago.received = r;
      bytes.santiago.total = t;
      updateProgress();
    }),
  ]);
  loadProgress.value = 1;

  const onceReady = (v: HTMLVideoElement) =>
    new Promise<void>((resolve) => {
      if (v.readyState >= 1) resolve();
      else
        v.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  await Promise.all([onceReady(bostonVideo), onceReady(santiagoVideo)]);

  const bostonTrack: VideoTrack = {
    el: bostonVideo,
    startUTC: manifest.boston.startUTC.getTime() / 1000,
    speedup: manifest.boston.speedup,
    duration: bostonVideo.duration || 0,
    videoFps: manifest.boston.videoFps,
    frameRealTimesSec: manifest.boston.frameRealTimesSec,
  };
  const santiagoTrack: VideoTrack = {
    el: santiagoVideo,
    startUTC: manifest.santiago.startUTC.getTime() / 1000,
    speedup: manifest.santiago.speedup,
    duration: santiagoVideo.duration || 0,
    videoFps: manifest.santiago.videoFps,
    frameRealTimesSec: manifest.santiago.frameRealTimesSec,
  };
  sync.setTracks(bostonTrack, santiagoTrack);

  let bostonOk = false,
    santiagoOk = false;
  const markReady = (side: Side) => {
    if (side === 'boston') bostonOk = true;
    else santiagoOk = true;
    if (bostonOk && santiagoOk) {
      videosReady.value = true;
      playing.value = true;
    }
  };
  const watch = (v: HTMLVideoElement, side: Side) => {
    const check = () => {
      if (v.readyState >= 3) {
        markReady(side);
        return true;
      }
      return false;
    };
    if (check()) return;
    const onEvt = () => {
      if (check()) cleanup();
    };
    const poll = window.setInterval(() => {
      if (check()) cleanup();
    }, 200);
    const cleanup = () => {
      window.clearInterval(poll);
      v.removeEventListener('canplay', onEvt);
      v.removeEventListener('canplaythrough', onEvt);
      v.removeEventListener('loadeddata', onEvt);
    };
    v.addEventListener('canplay', onEvt);
    v.addEventListener('canplaythrough', onEvt);
    v.addEventListener('loadeddata', onEvt);
    v.load();
  };
  watch(bostonVideo, 'boston');
  watch(santiagoVideo, 'santiago');
}

function sideCovers(side: Side, utcMs: number): boolean {
  if (!manifest) return false;
  const m = manifest[side];
  const n = m.frameRealTimesSec.length;
  if (n < 2) return false;
  const realSec = (utcMs - m.startUTC.getTime()) / 1000;
  return (
    realSec >= m.frameRealTimesSec[0] && realSec < m.frameRealTimesSec[n - 1]
  );
}

function sideAngleRad(side: Side, v: HTMLVideoElement | null): number {
  const flip = flipHead.value ? Math.PI : 0;
  if (!manifest || !v) return flip;
  if (!correction.value) return flip;
  const m = manifest[side];
  const frameIdx = Math.round(v.currentTime * m.videoFps);
  const idx = clamp(frameIdx, 0, m.anglesDeg.length - 1);
  return m.anglesDeg[idx] * DEG2RAD + flip;
}

// Angle lookup that ignores the global correction toggle — used by the
// sim-view telescope grid, where RAW vs CORR are explicit rows and must
// always show the corrected version in the CORR row.
function getAngleRadAlways(side: Side): number {
  const flip = flipHead.value ? Math.PI : 0;
  const v = side === 'boston' ? bostonVideo : santiagoVideo;
  if (!manifest || !v) return flip;
  const m = manifest[side];
  const frameIdx = Math.round(v.currentTime * m.videoFps);
  const idx = clamp(frameIdx, 0, m.anglesDeg.length - 1);
  return m.anglesDeg[idx] * DEG2RAD + flip;
}

function advanceCrossfade(
  side: Side,
  video: HTMLVideoElement,
  wallNow: number,
): number {
  if (!manifest || !stereo) return 1;
  const m = manifest[side];
  const st = fadeState[side];
  if (video.videoWidth === 0 || video.readyState < 2) return 1;

  const curFrame = Math.floor(video.currentTime * m.videoFps);
  const slot: 'left' | 'right' = side === 'boston' ? 'left' : 'right';

  if (!st.prevInitialized) {
    stereo.uploadPrevSource(slot, video);
    const pctx = st.pendingCanvas.getContext('2d');
    if (pctx)
      pctx.drawImage(
        video,
        0,
        0,
        st.pendingCanvas.width,
        st.pendingCanvas.height,
      );
    st.prevInitialized = true;
    st.lastShownFrame = curFrame;
    st.transitionWallMs = wallNow;
    return 1;
  }

  const advance = curFrame - st.lastShownFrame;
  if (advance !== 0) {
    if (advance === 1) {
      const tmp = st.prevCanvas;
      st.prevCanvas = st.pendingCanvas;
      st.pendingCanvas = tmp;
      stereo.uploadPrevSource(slot, st.prevCanvas);
    } else {
      stereo.uploadPrevSource(slot, video);
    }
    st.lastShownFrame = curFrame;
    st.transitionWallMs = wallNow;
  }

  const pctx = st.pendingCanvas.getContext('2d');
  if (pctx)
    pctx.drawImage(
      video,
      0,
      0,
      st.pendingCanvas.width,
      st.pendingCanvas.height,
    );

  const simRate = RATE_STEPS[rateIdx.value];
  if (simRate >= CROSSFADE_THRESHOLD_RATE) return 1;
  const playbackRate = Math.max(0.001, simRate / m.speedup);
  const wallPerFrameMs = 1000 / (m.videoFps * playbackRate);
  return clamp((wallNow - st.transitionWallMs) / wallPerFrameMs, 0, 1);
}

function fmtUTC(d: Date): string {
  return d.toISOString().slice(11, 16) + ' UTC';
}
function fmtDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
void fmtUTC;

function formatPhase(e: EclipseData): string {
  if (e.phase === 'total') return 'TOTALITY';
  const pct =
    (e.phase === 'penumbral' ? e.penumbralImmersion : e.umbralImmersion) * 100;
  return `${e.phase.toUpperCase()} ${pct.toFixed(1)}%`;
}
function eclipseBar(e: EclipseData): string {
  const v = e.phase === 'penumbral' ? e.penumbralImmersion : e.umbralImmersion;
  const N = 12;
  const filled = Math.round(v * N);
  return '▓'.repeat(filled) + '░'.repeat(N - filled);
}

function buildEyeData(
  side: Side,
  nowDate: Date,
  videoSec: number,
  eclipse: EclipseData,
): EyeData {
  const m = manifest;
  const city = m ? m[side].city : side === 'boston' ? 'Boston' : 'Santiago';
  // Boston (northern telescope) maps to the left eye by default; flipHead
  // swaps eye assignment, so each pole's side flips with it. Mobile uses
  // abbreviated form (N = L) to save horizontal space.
  const flipped = flipHead.value;
  const narrow = isNarrow.value;
  const baseRegion = side === 'boston' ? 'United States' : 'Chile';
  const hemisphere = side === 'boston' ? (narrow ? 'N' : 'North') : (narrow ? 'S' : 'South');
  const eyeSide =
    side === 'boston'
      ? (flipped ? (narrow ? 'R' : 'Right') : (narrow ? 'L' : 'Left'))
      : (flipped ? (narrow ? 'L' : 'Left') : (narrow ? 'R' : 'Right'));
  const region = `${baseRegion} (${hemisphere} = ${eyeSide})`;
  const lat = m ? m[side].lat : side === 'boston' ? 42.36 : -33.45;
  const lon = m ? m[side].lon : side === 'boston' ? -71.06 : -70.66;
  return {
    city,
    region,
    lat,
    lon,
    tzAbbrev: tzAbbrev(side, nowDate),
    localTime: localTime(side, nowDate),
    localDate: localDate(side, nowDate),
    utcTime: nowDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    videoTime: videoSec >= 0 ? `V ${fmtDuration(videoSec)}` : 'V --:--:--',
    weather: weatherFor(side, nowDate),
    phase: eclipse.phase === 'none' ? '' : formatPhase(eclipse),
    eclipseBar: eclipse.phase === 'none' ? '' : eclipseBar(eclipse),
  };
}

// --- Root wrapper: keeps overlay eye data reactive (30fps refresh) ---
function Root() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = (t: number) => {
      if (t - last > 33) {
        // ~30fps UI refresh is enough for text
        setTick((n) => n + 1);
        last = t;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  void tick;

  const nowDate = new Date(currentTime.value);
  const frame = computeFrame(nowDate);
  const boston = buildEyeData(
    'boston',
    nowDate,
    frame.bostonVideoSec,
    frame.eclipse,
  );
  const santiago = buildEyeData(
    'santiago',
    nowDate,
    frame.santiagoVideoSec,
    frame.eclipse,
  );
  return (
    <App
      scene={scene}
      manifest={manifest}
      boston={boston}
      santiago={santiago}
      videos={{ boston: bostonVideo, santiago: santiagoVideo }}
      getAngleRad={getAngleRadAlways}
      getCovers={(side) => sideCovers(side, currentTime.value)}
    />
  );
}

// --- Mount, then wire animation loop ---
const appRoot = document.getElementById('app')!;
render(<Root />, appRoot);

// Find the stereo canvas that App rendered and attach StereoRenderer.
function initStereoCanvas() {
  const canvas = document.getElementById(
    'stereo-canvas',
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    requestAnimationFrame(initStereoCanvas);
    return;
  }
  try {
    stereo = new StereoRenderer(canvas);
    resize();
    window.addEventListener('resize', resize);
  } catch (err) {
    console.error(
      '[frontend] stereo renderer init failed (WebGL2 required):',
      err,
    );
  }
  requestAnimationFrame(animate);
}
function resize() {
  if (!stereo) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  stereo.resize(w, h);
}

initStereoCanvas();
bootManifest();

// --- Simulation focus buttons (delegated) ---
document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('[data-focus]');
  if (!target || !scene) return;
  const nowFrame = computeFrame(new Date(currentTime.value));
  const kind = target.getAttribute('data-focus');
  if (kind === 'SYSTEM') scene.focusSystem();
  else if (kind === 'EARTH') scene.focusEarth();
  else if (kind === 'MOON') scene.focusMoon(nowFrame);
});

// --- React to telescope toggle ---
effect(() => {
  if (scene) scene.setTelescopesVisible(showTelescopes.value);
});

// --- Drive sync simRate from rateIdx signal ---
effect(() => {
  sync.setSimRate(RATE_STEPS[rateIdx.value]);
});

// --- Animation loop ---
let lastRealTime = 0;
function animate(realTime: number) {
  requestAnimationFrame(animate);
  frameParity = (frameParity + 1) & 1;

  if (lastRealTime > 0 && playing.value) {
    const dt = (realTime - lastRealTime) / 1000;
    const rate = RATE_STEPS[rateIdx.value];
    const t = currentTime.value + dt * rate * 1000;
    // Stop at SIM_END instead of looping: pin time to the end and pause.
    // User can seek back with the scrubber or arrow keys to resume.
    if (t >= SIM_END.getTime()) {
      currentTime.value = SIM_END.getTime();
      playing.value = false;
    } else {
      currentTime.value = t;
    }
  }
  lastRealTime = realTime;

  const nowDate = new Date(currentTime.value);
  const frame = computeFrame(nowDate);

  if (scene) {
    scene.applyFrameState(frame);
    scene.renderPIPOutputs();
  }

  if (sync.hasTracks()) {
    sync.syncToExternalUTC(
      currentTime.value / 1000,
      playing.value,
      RATE_STEPS[rateIdx.value],
    );
  }

  if (!stereo) return;

  if (view.value === 'sim') {
    if (scene) scene.renderMain();
    return;
  }

  if (!videosReady.value) {
    const loading = getLoadingCanvas();
    stereo.uploadSource('left', loading);
    stereo.uploadSource('right', loading);
    // LOADING placeholder stays upright regardless of flipHead — rotating
    // the text 180° is user-hostile. The swap uniform still swaps L/R eye
    // assignment, but neither side is actually flipped visually.
    stereo.render({
      leftAngleRad: 0,
      rightAngleRad: 0,
      leftAlpha: 1,
      rightAlpha: 1,
      layout: layout.value,
      encoding: encoding.value,
      parallaxPx: parallaxPx.value,
      swap: flipHead.value,
      frameParity,
    });
    return;
  }

  const covers = {
    boston: sideCovers('boston', currentTime.value),
    santiago: sideCovers('santiago', currentTime.value),
  };
  const ctx = {
    scene,
    boston: bostonVideo,
    santiago: santiagoVideo,
    covers,
    mode: sourceMode.value,
    correction: correction.value,
    scrubbing: scrubbing.value,
  };
  const leftSrc = resolveEyeSource('boston', ctx);
  const rightSrc = resolveEyeSource('santiago', ctx);
  stereo.uploadSource('left', leftSrc.el);
  stereo.uploadSource('right', rightSrc.el);

  // Use the kind currently in the texture (post-upload), not the intended
  // kind: a video upload silently no-ops while the element is mid-seek with
  // readyState<2, which leaves the previous source (often NO SIGNAL) in the
  // slot. Rotating that stale canvas by a stereo correction angle was the
  // "rotated NO SIGNAL" bug. Placeholders also skip the flipHead 180° — a
  // right-side-up text label is always more useful than an upside-down one.
  const leftAngleRad =
    stereo.getSlotKind('left') === 'video' ? sideAngleRad('boston', bostonVideo) : 0;
  const rightAngleRad =
    stereo.getSlotKind('right') === 'video' ? sideAngleRad('santiago', santiagoVideo) : 0;

  const leftAlpha =
    leftSrc.kind === 'video' && bostonVideo
      ? advanceCrossfade('boston', bostonVideo, realTime)
      : 1;
  const rightAlpha =
    rightSrc.kind === 'video' && santiagoVideo
      ? advanceCrossfade('santiago', santiagoVideo, realTime)
      : 1;

  stereo.render({
    leftAngleRad,
    rightAngleRad,
    leftAlpha,
    rightAlpha,
    layout: layout.value,
    encoding: encoding.value,
    parallaxPx: parallaxPx.value,
    swap: false,
    frameParity,
  });
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (e.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    view.value = view.value === 'stereo' ? 'sim' : 'stereo';
    return;
  }
  if (!videosReady.value) return;

  if (e.key === ' ') {
    e.preventDefault();
    playing.value = !playing.value;
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const step = 60_000 * (e.shiftKey ? 10 : 1) * dir;
    currentTime.value = clamp(
      currentTime.value + step,
      SIM_START.getTime(),
      SIM_END.getTime(),
    );
  } else if (e.key === '[')
    rateIdx.value = clamp(rateIdx.value - 1, 0, RATE_STEPS.length - 1);
  else if (e.key === ']')
    rateIdx.value = clamp(rateIdx.value + 1, 0, RATE_STEPS.length - 1);
  else if (e.key === '0') rateIdx.value = DEFAULT_RATE_INDEX;
  else if (e.key === 'c') correction.value = !correction.value;
  else if (e.key === 'h') flipHead.value = !flipHead.value;
});
