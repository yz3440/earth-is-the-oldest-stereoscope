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
import { MoonPhase } from 'astronomy-engine';

const SIM_RATE = 120; // sim-seconds per wall-second; change via keyboard

// --- State ---
let currentTime = SIM_START.getTime();
let playing = true;
let lastRealTime = 0;
let manifest: Manifest | null = null;

// --- DOM ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <canvas id="stereo-canvas"></canvas>
  <div id="overlay-root"></div>
  <div id="timeline">
    <button id="btn-play" type="button">||</button>
    <input id="scrubber" type="range" min="0" max="1000" value="0" />
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

// --- Videos ---
let bostonVideo: HTMLVideoElement | null = null;
let santiagoVideo: HTMLVideoElement | null = null;

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
  };
  const santiagoTrack: VideoTrack = {
    el: santiagoVideo,
    startUTC: manifest.santiago.startUTC.getTime() / 1000,
    speedup: manifest.santiago.speedup,
    duration: santiagoVideo.duration || 0,
  };
  sync.setTracks(bostonTrack, santiagoTrack);
}
bootManifest();

// --- Controls ---
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const scrubber = document.getElementById('scrubber') as HTMLInputElement;

function setPlaying(p: boolean) {
  playing = p;
  btnPlay.textContent = playing ? '||' : '>';
}

btnPlay.addEventListener('click', () => setPlaying(!playing));

scrubber.addEventListener('input', () => {
  const t = parseInt(scrubber.value) / 1000;
  currentTime = SIM_START.getTime() + t * (SIM_END.getTime() - SIM_START.getTime());
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const step = 60_000 * (e.shiftKey ? 10 : 1) * dir;
    currentTime = clamp(currentTime + step, SIM_START.getTime(), SIM_END.getTime());
  }
  else if (e.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});

// --- Animation loop ---
function animate(realTime: number) {
  requestAnimationFrame(animate);

  if (lastRealTime > 0 && playing) {
    const dt = (realTime - lastRealTime) / 1000;
    currentTime += dt * SIM_RATE * 1000;
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
    sync.syncToExternalUTC(currentTime / 1000, playing, SIM_RATE);
  }

  // Upload per-eye sources (video if covers the sim time, else NO SIGNAL / sim fallback)
  const covers = {
    boston: sideCovers('boston', currentTime),
    santiago: sideCovers('santiago', currentTime),
  };
  const ctx = { scene, boston: bostonVideo, santiago: santiagoVideo, covers };
  const leftSrc = resolveEyeSource('boston', ctx);
  const rightSrc = resolveEyeSource('santiago', ctx);
  stereo.uploadSource('left', leftSrc.el);
  stereo.uploadSource('right', rightSrc.el);

  // Pulse the sim-moon fallback while we're waiting on a video frame to land.
  // Range 0.25..0.85, period 1.3s — fast enough to read as "loading", calm
  // enough not to feel broken.
  const pulse01 = 0.5 + 0.5 * Math.sin((realTime / 1000) * 2 * Math.PI / 1.3);
  const pulse = 0.25 + 0.6 * pulse01;
  const leftB = leftSrc.loading ? pulse : 1;
  const rightB = rightSrc.loading ? pulse : 1;
  stereo.render(leftB, rightB);

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
    weather: weatherFor(side),
    phase: eclipse.phase === 'none' ? '' : formatPhase(eclipse),
    moonGlyph: moonGlyphFor(nowDate),
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

function moonGlyphFor(date: Date): string {
  // MoonPhase returns 0..360 (0 = new moon, 180 = full moon)
  const p = MoonPhase(date);
  if (p < 22.5 || p >= 337.5) return '○';
  if (p < 67.5) return '◐';
  if (p < 112.5) return '◐';
  if (p < 157.5) return '●';
  if (p < 202.5) return '●';
  if (p < 247.5) return '●';
  if (p < 292.5) return '◑';
  return '◑';
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

function sideCovers(side: Side, utcMs: number): boolean {
  if (!manifest) return false;
  const v = side === 'boston' ? bostonVideo : santiagoVideo;
  if (!v || !(v.duration > 0)) return false;
  const m = manifest[side];
  const target = (utcMs / 1000 - m.startUTC.getTime() / 1000) / m.speedup;
  return target >= 0 && target < v.duration;
}
