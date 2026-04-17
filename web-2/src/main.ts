import './style.css';
import {
  computeFrame,
  SIM_START,
  SIM_END,
} from './astronomy';
import { PlanetaryScene } from './scene';
import { StereoRenderer } from './stereo';
import { StereoSync } from './sync';
import type { VideoTrack } from './sync';
import { resolveEyeSource } from './sources';
import { loadManifest } from './manifest';
import type { Manifest, Side } from './manifest';
import { localTime, localDate, tzAbbrev } from './localtime';
import { weatherFor } from './weather';
import { Overlay } from './overlay';
import type { EyeData } from './overlay';
import { getLoadingCanvas } from './loading';

// Playback speed steps (sim-seconds per wall-second). [ / ] step through;
// 0 resets to DEFAULT_RATE_INDEX.
//
// - Capped at 120× because the camera speedup is ~30–42 real-sec/video-sec,
//   so simRate / speedup is the playbackRate we ask the browser for. H.264
//   decoders smear past ~3×, showing up as black flashes in the texture.
// - For rates below ~5× the desired playbackRate would fall under Chrome's
//   0.0625 floor; sync.ts detects this and switches that track into pause-
//   and-seek mode (one seek per integer frame crossing). The cross-fade
//   layer smooths the seek transitions into a continuous dissolve.
const RATE_STEPS = [1, 2, 5, 10, 30, 60, 120] as const;
const DEFAULT_RATE_INDEX = 4; // 30× — 16 h sim in ~32 min wall time
let rateIndex = DEFAULT_RATE_INDEX;
let simRate: number = RATE_STEPS[rateIndex];

// --- State ---
let currentTime = SIM_START.getTime();
let playing = false;         // auto-starts when both videos reach canplaythrough
let videosReady = false;
let lastRealTime = 0;
let manifest: Manifest | null = null;

// --- DOM ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <canvas id="stereo-canvas"></canvas>
  <div id="overlay-root"></div>
  <div id="timeline">
    <button id="btn-play" type="button">||</button>
    <button id="btn-slower" type="button" title="Slower ([)">&laquo;</button>
    <span id="sim-rate" title="Playback speed — 0 to reset">30&times;</span>
    <button id="btn-faster" type="button" title="Faster (])">&raquo;</button>
    <div id="scrubber-wrap">
      <div class="video-marker boston"   id="mk-boston"></div>
      <div class="video-marker santiago" id="mk-santiago"></div>
      <input id="scrubber" type="range" min="0" max="1000" value="0" />
    </div>
    <span id="t-start"></span>
    <span id="t-end"></span>
  </div>
`;

document.getElementById('t-start')!.textContent = fmtUTC(SIM_START);
document.getElementById('t-end')!.textContent = fmtUTC(SIM_END);

const stereoCanvas = document.getElementById('stereo-canvas') as HTMLCanvasElement;
const stereo = new StereoRenderer(stereoCanvas);

function resize() {
  const w = Math.floor(window.innerWidth * window.devicePixelRatio);
  const h = Math.floor(window.innerHeight * window.devicePixelRatio);
  stereo.resize(w, h);
}
resize();
window.addEventListener('resize', resize);

const scene = new PlanetaryScene();
const overlay = new Overlay(document.getElementById('overlay-root')!);
const sync = new StereoSync();
sync.setSimRate(simRate);  // seed before setTracks() so the first applyVirtual() sees the right rate

// --- Videos ---
let bostonVideo: HTMLVideoElement | null = null;
let santiagoVideo: HTMLVideoElement | null = null;

// Cross-fade state per side. At low sim rates (< 30×) each video frame is
// visible for hundreds of ms, so we cross-fade between the previous frame
// (kept in `prevCanvas` — the pending snapshot that was promoted when the
// video element swapped to a new frame) and the current video element.
// `pendingCanvas` is the rolling 1-tick-behind snapshot used to populate
// `prevCanvas` when a frame transition is detected.
const CROSSFADE_THRESHOLD_RATE = 30; // simRate strictly below this enables the effect
interface FadeState {
  prevCanvas: HTMLCanvasElement;
  pendingCanvas: HTMLCanvasElement;
  lastShownFrame: number;
  transitionWallMs: number;
  prevInitialized: boolean;
}
const fadeState: Record<Side, FadeState> = {
  boston: makeFadeState(),
  santiago: makeFadeState(),
};
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

function makeVideo(src: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = src;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  return v;
}

async function bootManifest() {
  try {
    manifest = await loadManifest();
  } catch (err) {
    console.warn('[web-2] manifest failed; sim-only fallback:', err);
    return;
  }
  positionVideoMarkers(manifest);
  bostonVideo = makeVideo(manifest.boston.videoUrl);
  santiagoVideo = makeVideo(manifest.santiago.videoUrl);

  const onceReady = (v: HTMLVideoElement) => new Promise<void>((resolve) => {
    if (v.readyState >= 1) resolve();
    else v.addEventListener('loadedmetadata', () => resolve(), { once: true });
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

  // Gate controls on both videos being downloaded far enough to play forward
  // without an immediate stall — `readyState >= 3` (HAVE_FUTURE_DATA). We
  // avoid `canplaythrough` because Chrome often never fires it for dev-server
  // hosted videos even after the element is clearly playable.
  let bostonOk = false;
  let santiagoOk = false;
  const markReady = (side: Side) => {
    if (side === 'boston') bostonOk = true;
    else santiagoOk = true;
    if (bostonOk && santiagoOk) onVideosReady();
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
    const onEvt = () => { if (check()) cleanup(); };
    const poll = window.setInterval(() => { if (check()) cleanup(); }, 200);
    const cleanup = () => {
      window.clearInterval(poll);
      v.removeEventListener('canplay', onEvt);
      v.removeEventListener('canplaythrough', onEvt);
      v.removeEventListener('loadeddata', onEvt);
    };
    v.addEventListener('canplay', onEvt);
    v.addEventListener('canplaythrough', onEvt);
    v.addEventListener('loadeddata', onEvt);
    // Nudge the browser: some buffering stalls without this.
    v.load();
  };
  watch(bostonVideo, 'boston');
  watch(santiagoVideo, 'santiago');
}

// --- Controls ---
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnSlower = document.getElementById('btn-slower') as HTMLButtonElement;
const btnFaster = document.getElementById('btn-faster') as HTMLButtonElement;
const rateLabel = document.getElementById('sim-rate') as HTMLElement;
const scrubber = document.getElementById('scrubber') as HTMLInputElement;

// Everything starts disabled — onVideosReady() enables once canplaythrough fires.
btnPlay.disabled = true;
btnSlower.disabled = true;
btnFaster.disabled = true;
scrubber.disabled = true;

function setPlaying(p: boolean) {
  playing = p;
  btnPlay.textContent = playing ? '||' : '>';
}
setPlaying(false);

function onVideosReady() {
  videosReady = true;
  btnPlay.disabled = false;
  btnSlower.disabled = false;
  btnFaster.disabled = false;
  scrubber.disabled = false;
  setPlaying(true);
}

btnPlay.addEventListener('click', () => setPlaying(!playing));

bootManifest();

function setRateIndex(ix: number) {
  rateIndex = clamp(ix, 0, RATE_STEPS.length - 1);
  simRate = RATE_STEPS[rateIndex];
  rateLabel.textContent = `${simRate}\u00d7`;
}
setRateIndex(DEFAULT_RATE_INDEX);

btnSlower.addEventListener('click', () => setRateIndex(rateIndex - 1));
btnFaster.addEventListener('click', () => setRateIndex(rateIndex + 1));

scrubber.addEventListener('input', () => {
  const t = parseInt(scrubber.value) / 1000;
  currentTime = SIM_START.getTime() + t * (SIM_END.getTime() - SIM_START.getTime());
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  // Fullscreen is always allowed; playback/rate/seek shortcuts wait for the
  // video download to complete.
  if (e.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    return;
  }
  if (!videosReady) return;

  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const step = 60_000 * (e.shiftKey ? 10 : 1) * dir;
    currentTime = clamp(currentTime + step, SIM_START.getTime(), SIM_END.getTime());
  }
  else if (e.key === '[') { setRateIndex(rateIndex - 1); }
  else if (e.key === ']') { setRateIndex(rateIndex + 1); }
  else if (e.key === '0') { setRateIndex(DEFAULT_RATE_INDEX); }
});

// --- Animation loop ---
function animate(realTime: number) {
  requestAnimationFrame(animate);

  if (lastRealTime > 0 && playing) {
    const dt = (realTime - lastRealTime) / 1000;
    currentTime += dt * simRate * 1000;
    if (currentTime > SIM_END.getTime()) currentTime = SIM_START.getTime();
  }
  lastRealTime = realTime;

  const nowDate = new Date(currentTime);
  const frame = computeFrame(nowDate);

  // Keep scrubber in sync
  const t = (currentTime - SIM_START.getTime()) / (SIM_END.getTime() - SIM_START.getTime());
  scrubber.value = String(Math.round(t * 1000));

  // Always run the sim — fallback PIP canvases stay fresh in case footage isn't ready
  scene.applyFrameState(frame);
  scene.renderPIPOutputs();

  // Drive the video sync against the master clock
  if (sync.hasTracks()) {
    sync.syncToExternalUTC(currentTime / 1000, playing, simRate);
  }

  // Upload per-eye sources. While the videos are still downloading we show
  // a static LOADING canvas on both eyes; normal NO_SIGNAL / sim / video
  // source resolution resumes after canplaythrough.
  if (!videosReady) {
    const loading = getLoadingCanvas();
    stereo.uploadSource('left', loading);
    stereo.uploadSource('right', loading);
    stereo.render(0, 0, 1, 1);
  } else {
    const covers = {
      boston: sideCovers('boston', currentTime),
      santiago: sideCovers('santiago', currentTime),
    };
    const ctx = { scene, boston: bostonVideo, santiago: santiagoVideo, covers };
    const leftSrc = resolveEyeSource('boston', ctx);
    const rightSrc = resolveEyeSource('santiago', ctx);
    stereo.uploadSource('left', leftSrc.el);
    stereo.uploadSource('right', rightSrc.el);

    const leftAngleRad = leftSrc.kind === 'video'
      ? sideAngleRad('boston', bostonVideo) : 0;
    const rightAngleRad = rightSrc.kind === 'video'
      ? sideAngleRad('santiago', santiagoVideo) : 0;

    // Cross-fade between prev- and current-frame textures when sim is slow
    // enough that per-frame wall-time is long enough to perceive as stutter.
    const leftAlpha  = leftSrc.kind  === 'video' && bostonVideo
      ? advanceCrossfade('boston', bostonVideo, realTime) : 1;
    const rightAlpha = rightSrc.kind === 'video' && santiagoVideo
      ? advanceCrossfade('santiago', santiagoVideo, realTime) : 1;

    stereo.render(leftAngleRad, rightAngleRad, leftAlpha, rightAlpha);
  }

  // Overlay
  overlay.update({
    boston: buildEyeData('boston', nowDate, frame.bostonVideoSec, frame.eclipse),
    santiago: buildEyeData('santiago', nowDate, frame.santiagoVideoSec, frame.eclipse),
  });
}
requestAnimationFrame(animate);

// --- Helpers ---
function buildEyeData(
  side: Side,
  nowDate: Date,
  videoSec: number,
  eclipse: ReturnType<typeof computeFrame>['eclipse'],
): EyeData {
  const m = manifest;
  const city = m ? m[side].city : (side === 'boston' ? 'Boston' : 'Santiago');
  const lat = m ? m[side].lat : (side === 'boston' ? 42.36 : -33.45);
  const lon = m ? m[side].lon : (side === 'boston' ? -71.06 : -70.66);

  return {
    city,
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

function formatPhase(e: ReturnType<typeof computeFrame>['eclipse']): string {
  if (e.phase === 'total') return 'TOTALITY';
  const pct = (e.phase === 'penumbral' ? e.penumbralImmersion : e.umbralImmersion) * 100;
  return `${e.phase.toUpperCase()} ${pct.toFixed(1)}%`;
}

function eclipseBar(e: ReturnType<typeof computeFrame>['eclipse']): string {
  const v = e.phase === 'penumbral' ? e.penumbralImmersion : e.umbralImmersion;
  const N = 12;
  const filled = Math.round(v * N);
  return '▓'.repeat(filled) + '░'.repeat(N - filled);
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Map each side's real-world coverage window to a span on the scrubber. Runs
// once after the manifest loads; positions are relative to [SIM_START, SIM_END].
function positionVideoMarkers(m: Manifest) {
  const simStart = SIM_START.getTime();
  const simEnd = SIM_END.getTime();
  const totalMs = simEnd - simStart;
  const place = (id: string, side: Side) => {
    const s = m[side];
    const n = s.frameRealTimesSec.length;
    if (n < 2) return;
    const startMs = s.startUTC.getTime();
    const endMs = startMs + s.frameRealTimesSec[n - 1] * 1000;
    const leftPct = clamp((startMs - simStart) / totalMs, 0, 1) * 100;
    const rightPct = clamp((endMs - simStart) / totalMs, 0, 1) * 100;
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = `${leftPct}%`;
    el.style.width = `${rightPct - leftPct}%`;
  };
  place('mk-boston', 'boston');
  place('mk-santiago', 'santiago');
}

function sideCovers(side: Side, utcMs: number): boolean {
  // Use the calibrator's per-frame real-time anchors directly — last anchor
  // = total_frames / effective_fps (modulo the per-sample drift the anchor
  // table captures). The linear speedup-based check drifted at the endpoints.
  if (!manifest) return false;
  const m = manifest[side];
  const n = m.frameRealTimesSec.length;
  if (n < 2) return false;
  const realSec = (utcMs - m.startUTC.getTime()) / 1000;
  return realSec >= m.frameRealTimesSec[0] && realSec < m.frameRealTimesSec[n - 1];
}

const DEG2RAD = Math.PI / 180;

// Per-tick cross-fade driver.
//
// The tick order matters for the snapshot:
//   1. DETECT whether the decoder has advanced since last tick — comparing
//      `floor(video.currentTime * videoFps)` against our recorded frame.
//   2. If it advanced, `pendingCanvas` still holds the snapshot captured
//      LAST tick (back when the video was on the OLD frame). Swap it into
//      `prevCanvas` and upload to the prev texture. Reset fade timer.
//   3. NOW snapshot the video (which shows the NEW frame) into
//      `pendingCanvas` for next tick's eventual promotion.
//
// Above CROSSFADE_THRESHOLD_RATE the alpha is pinned to 1 so we skip the
// blend cost and show the pure current texture.
function advanceCrossfade(side: Side, video: HTMLVideoElement, wallNow: number): number {
  if (!manifest) return 1;
  const m = manifest[side];
  const st = fadeState[side];

  if (video.videoWidth === 0 || video.readyState < 2) return 1;

  const curFrame = Math.floor(video.currentTime * m.videoFps);
  const slot: 'left' | 'right' = side === 'boston' ? 'left' : 'right';

  if (!st.prevInitialized) {
    // Seed both textures to the same frame so the first render isn't a fade
    // from black.
    stereo.uploadPrevSource(slot, video);
    const pctx = st.pendingCanvas.getContext('2d');
    if (pctx) pctx.drawImage(video, 0, 0, st.pendingCanvas.width, st.pendingCanvas.height);
    st.prevInitialized = true;
    st.lastShownFrame = curFrame;
    st.transitionWallMs = wallNow;
    return 1;
  }

  const advance = curFrame - st.lastShownFrame;
  if (advance !== 0) {
    if (advance === 1) {
      // Natural forward advance — promote last tick's snapshot.
      const tmp = st.prevCanvas;
      st.prevCanvas = st.pendingCanvas;
      st.pendingCanvas = tmp;
      stereo.uploadPrevSource(slot, st.prevCanvas);
    } else {
      // Scrub / seek / restart — skip the fade, reset prev = cur so we
      // don't cross-fade across a 100-frame jump.
      stereo.uploadPrevSource(slot, video);
    }
    st.lastShownFrame = curFrame;
    st.transitionWallMs = wallNow;
  }

  // Always snapshot the currently displayed frame into pendingCanvas AFTER
  // the transition check, so next tick's promotion captures the frame we
  // were just showing (which by then will be "old").
  const pctx = st.pendingCanvas.getContext('2d');
  if (pctx) pctx.drawImage(video, 0, 0, st.pendingCanvas.width, st.pendingCanvas.height);

  if (simRate >= CROSSFADE_THRESHOLD_RATE) return 1;

  // Fade linearly across the wall-time that one video frame is visible.
  const playbackRate = Math.max(0.001, simRate / m.speedup);
  const wallPerFrameMs = 1000 / (m.videoFps * playbackRate);
  return clamp((wallNow - st.transitionWallMs) / wallPerFrameMs, 0, 1);
}

function sideAngleRad(side: Side, v: HTMLVideoElement | null): number {
  if (!manifest || !v) return 0;
  const m = manifest[side];
  const frameIdx = Math.round(v.currentTime * m.videoFps);
  const idx = clamp(frameIdx, 0, m.anglesDeg.length - 1);
  return m.anglesDeg[idx] * DEG2RAD;
}
