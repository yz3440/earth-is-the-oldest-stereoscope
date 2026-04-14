import './style.css';
import {
  computeFrame,
  SIM_START,
  SIM_END,
  OVERLAP_START,
  ECLIPSE_PENUMBRAL_START,
  ECLIPSE_TOTALITY_START,
} from './astronomy';
import type { FrameData } from './astronomy';
import { PlanetaryScene } from './scene';
import { StereoRenderer, MODE_LABELS } from './stereo';
import type { StereoMode } from './stereo';
import { StereoSync } from './sync';
import type { VideoTrack } from './sync';
import {
  resolveEyeSource,
  EYE_SOURCE_LABELS,
} from './sources';
import type { EyeSource, SourcesContext } from './sources';

// --- Shared state ---
type Mode = 'sim' | 'stereo';
let mode: Mode = 'sim';
let currentTime = SIM_START.getTime();
let playing = true;
let speedMultiplier = 120;
let lastRealTime = 0;
let currentFrame: FrameData;

// --- Stereo state ---
let leftEyeSrc: EyeSource = 'sim.rotated';
let rightEyeSrc: EyeSource = 'sim.rotated';
let stereoEncoding: StereoMode = 'sbs-half';
let parallaxPx = 0;
let eyeSwap = false;
let uiHidden = false;

// --- DOM setup ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="canvas-container" class="absolute inset-0"></div>
  <canvas id="stereo-canvas" class="absolute inset-0 w-full h-full hidden" style="image-rendering: pixelated;"></canvas>

  <div id="mode-switch" class="absolute top-4 left-4 bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg flex text-xs font-mono tracking-wide select-none">
    <button data-mode="sim" class="px-3 py-2 bg-white/20 text-white/90 rounded-l-lg">SIM</button>
    <button data-mode="stereo" class="px-3 py-2 bg-white/5 text-white/50 rounded-r-lg hover:bg-white/15">STEREO</button>
  </div>

  <div id="panel-sim" class="absolute top-4 right-4 w-80 bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg p-4 text-xs leading-relaxed select-none overflow-y-auto max-h-[calc(100vh-120px)]">
    <h1 class="text-sm font-bold mb-3 text-white/90 tracking-wide">PLANETARY STEREOSCOPY</h1>

    <div class="mb-3">
      <div id="time-display" class="text-white/80 font-mono text-sm"></div>
      <div id="phase-display" class="text-white/40 mt-1"></div>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3">
      <div class="flex justify-between mb-1">
        <span class="text-red-400">Boston</span>
        <span id="boston-altaz" class="text-white/60 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-red-400">Correction</span>
        <span id="boston-rot" class="text-white/80 font-mono"></span>
      </div>
      <div class="flex justify-between mb-2">
        <span class="text-red-400">Video time</span>
        <span id="boston-vt" class="text-white/60 font-mono"></span>
      </div>

      <div class="flex justify-between mb-1">
        <span class="text-green-400">Santiago</span>
        <span id="santiago-altaz" class="text-white/60 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-green-400">Correction</span>
        <span id="santiago-rot" class="text-white/80 font-mono"></span>
      </div>
      <div class="flex justify-between mb-2">
        <span class="text-green-400">Video time</span>
        <span id="santiago-vt" class="text-white/60 font-mono"></span>
      </div>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3">
      <div class="flex justify-between mb-1">
        <span class="text-yellow-400">Parallax</span>
        <span id="parallax" class="text-white/80 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-white/40">Baseline</span>
        <span class="text-white/40 font-mono">~8,000 km</span>
      </div>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3">
      <div class="text-white/40 mb-2">Eclipse</div>
      <div class="flex justify-between mb-1">
        <span class="text-orange-400">Phase</span>
        <span id="eclipse-phase" class="text-white/80 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-orange-400">Umbral</span>
        <span id="eclipse-umbral" class="text-white/60 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-orange-400">Penumbral</span>
        <span id="eclipse-penumbral" class="text-white/60 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-white/40">Shadow sep</span>
        <span id="eclipse-sep" class="text-white/40 font-mono"></span>
      </div>
      <div class="flex justify-between mb-1">
        <span class="text-white/40">Umbra radius</span>
        <span id="eclipse-umbra-r" class="text-white/40 font-mono"></span>
      </div>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3">
      <div class="text-white/40 mb-2">Camera views</div>
      <button id="btn-system" class="px-2 py-1 bg-white/10 rounded text-white/70 hover:bg-white/20 mr-1 text-xs">System</button>
      <button id="btn-earth" class="px-2 py-1 bg-white/10 rounded text-white/70 hover:bg-white/20 mr-1 text-xs">Earth</button>
      <button id="btn-moon" class="px-2 py-1 bg-white/10 rounded text-white/70 hover:bg-white/20 text-xs">Moon</button>
      <button id="btn-telescopes" class="px-2 py-1 bg-white/20 rounded text-white/70 hover:bg-white/20 text-xs">Telescopes</button>
    </div>

  </div>

  <div id="panel-stereo" class="hidden absolute top-4 right-4 w-80 bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg p-4 text-xs leading-relaxed select-none overflow-y-auto max-h-[calc(100vh-120px)]">
    <h1 class="text-sm font-bold mb-3 text-white/90 tracking-wide">PLANETARY STEREOSCOPY</h1>

    <div class="mb-3">
      <div id="time-display-s" class="text-white/80 font-mono text-sm"></div>
      <div id="phase-display-s" class="text-white/40 mt-1"></div>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3 space-y-2">
      <div>
        <div class="flex justify-between mb-1">
          <span class="text-red-400">LEFT EYE</span>
          <span class="text-white/40 font-mono">boston</span>
        </div>
        <select id="left-eye-src" class="w-full bg-white/10 rounded px-2 py-1 text-white/80 outline-none border border-white/10 text-xs font-mono"></select>
      </div>
      <div>
        <div class="flex justify-between mb-1">
          <span class="text-green-400">RIGHT EYE</span>
          <span class="text-white/40 font-mono">santiago</span>
        </div>
        <select id="right-eye-src" class="w-full bg-white/10 rounded px-2 py-1 text-white/80 outline-none border border-white/10 text-xs font-mono"></select>
      </div>
      <button id="btn-swap-eyes" class="w-full py-1.5 bg-white/10 rounded text-white/70 hover:bg-white/20 text-xs font-mono tracking-wide">
        SWAP L \u2194 R
      </button>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3 space-y-2">
      <div class="text-white/40 text-[10px] uppercase tracking-wide">Encoding</div>
      <select id="stereo-mode-sel" class="w-full bg-white/10 rounded px-2 py-1 text-white/80 outline-none border border-white/10 text-xs font-mono"></select>
    </div>

    <div class="border-t border-white/10 pt-3 mb-3 space-y-2">
      <div class="flex justify-between">
        <span class="text-yellow-400">PARALLAX</span>
        <span id="parallax-val" class="text-white/80 font-mono">+0 px</span>
      </div>
      <input id="parallax-slider" type="range" min="-200" max="200" value="0" step="1"
        class="w-full h-1 accent-yellow-400/60 cursor-pointer" />
      <button id="btn-parallax-reset" class="px-2 py-1 bg-white/10 rounded text-white/70 hover:bg-white/20 text-xs font-mono">RESET</button>
    </div>

    <div class="border-t border-white/10 pt-3 space-y-1">
      <div class="text-white/40 text-[10px] uppercase tracking-wide mb-1">Video</div>
      <div class="flex justify-between text-xs font-mono">
        <span class="text-red-400/80">boston</span>
        <span id="video-boston-info" class="text-white/50"></span>
      </div>
      <div class="flex justify-between text-xs font-mono">
        <span class="text-green-400/80">santiago</span>
        <span id="video-santiago-info" class="text-white/50"></span>
      </div>
    </div>

    <div class="border-t border-white/10 pt-3 mt-3 text-white/30 text-[10px] font-mono leading-snug">
      space&nbsp;&nbsp;play/pause &nbsp; \u2190\u2192 seek &nbsp; [ ] parallax<br>
      m&nbsp;&nbsp;cycle mode &nbsp; s swap &nbsp; 0 reset &nbsp; f fullscreen<br>
      tab&nbsp;switch sim/stereo
    </div>
  </div>

  <div id="telescope-insets" class="absolute bottom-0 left-0 pointer-events-none" style="z-index: 10;"></div>

  <div id="timeline" class="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm border-t border-white/10 px-4 py-3">
    <div class="flex items-center gap-3">
      <button id="btn-play" class="text-white/70 hover:text-white text-sm font-mono w-6">||</button>
      <input id="scrubber" type="range" min="0" max="1000" value="0"
        class="flex-1 h-1 accent-white/50 cursor-pointer" />
      <select id="speed-select" class="bg-white/10 text-white/70 text-xs rounded px-2 py-1 border border-white/10">
        <option value="1">1x</option>
        <option value="10">10x</option>
        <option value="60">60x</option>
        <option value="120" selected>120x</option>
        <option value="600">600x</option>
        <option value="3600">3600x</option>
      </select>
    </div>
    <div class="flex justify-between text-white/30 text-xs mt-1 font-mono">
      <span>${formatUTC(SIM_START)}</span>
      <span class="text-yellow-400/40">overlap ${formatUTC(OVERLAP_START)}</span>
      <span class="text-orange-400/40">penumbra ${formatUTC(ECLIPSE_PENUMBRAL_START)}</span>
      <span class="text-red-400/40">totality ${formatUTC(ECLIPSE_TOTALITY_START)}</span>
      <span>${formatUTC(SIM_END)}</span>
    </div>
  </div>
`;

// --- Populate select dropdowns ---
const eyeSourceOptions = Object.entries(EYE_SOURCE_LABELS)
  .map(([v, label]) => `<option value="${v}">${label}</option>`)
  .join('');
(document.getElementById('left-eye-src') as HTMLSelectElement).innerHTML = eyeSourceOptions;
(document.getElementById('right-eye-src') as HTMLSelectElement).innerHTML = eyeSourceOptions;
(document.getElementById('left-eye-src') as HTMLSelectElement).value = leftEyeSrc;
(document.getElementById('right-eye-src') as HTMLSelectElement).value = rightEyeSrc;

const stereoModeOptions = Object.entries(MODE_LABELS)
  .map(([v, label]) => `<option value="${v}">${label}</option>`)
  .join('');
const stereoModeSel = document.getElementById('stereo-mode-sel') as HTMLSelectElement;
stereoModeSel.innerHTML = stereoModeOptions;
stereoModeSel.value = stereoEncoding;

// --- Initialize scene and stereo compositor ---
const container = document.getElementById('canvas-container')!;
const scene = new PlanetaryScene(container);
currentFrame = computeFrame(new Date(currentTime));

const stereoCanvas = document.getElementById('stereo-canvas') as HTMLCanvasElement;
const stereoRenderer = new StereoRenderer(stereoCanvas);
stereoRenderer.mode = stereoEncoding;

function sizeStereoCanvas() {
  const w = window.innerWidth * window.devicePixelRatio;
  const h = window.innerHeight * window.devicePixelRatio;
  stereoRenderer.resize(w, h);
}
sizeStereoCanvas();
window.addEventListener('resize', sizeStereoCanvas);

// --- Telescope inset overlays (sim mode only) ---
const INSET_SIZE = 200;
const INSET_GAP = 8;
const INSET_MARGIN = 16;

function createInsetOverlays(): number {
  const el = document.getElementById('telescope-insets')!;
  const timelineH = document.getElementById('timeline')!.offsetHeight;
  const baseY = timelineH + INSET_MARGIN;
  const baseX = INSET_MARGIN;

  const configs = [
    { label: 'BOSTON RAW',          color: '#ff4444', x: baseX,                         y: baseY },
    { label: 'SANTIAGO RAW',        color: '#44ff44', x: baseX + INSET_SIZE + INSET_GAP, y: baseY },
    { label: 'BOSTON CORRECTED',    color: '#ff4444', x: baseX,                         y: baseY + INSET_SIZE + INSET_GAP },
    { label: 'SANTIAGO CORRECTED', color: '#44ff44', x: baseX + INSET_SIZE + INSET_GAP, y: baseY + INSET_SIZE + INSET_GAP },
  ];

  for (const cfg of configs) {
    const div = document.createElement('div');
    div.style.cssText = `
      position: absolute;
      left: ${cfg.x}px;
      bottom: ${cfg.y}px;
      width: ${INSET_SIZE}px;
      height: ${INSET_SIZE}px;
      border: 1px solid ${cfg.color}44;
      border-radius: 4px;
      box-sizing: border-box;
    `;
    const label = document.createElement('span');
    label.textContent = cfg.label;
    label.style.cssText = `
      position: absolute;
      bottom: 4px;
      left: 6px;
      font-size: 9px;
      color: ${cfg.color};
      opacity: 0.7;
      font-family: ui-monospace, 'SF Mono', monospace;
      letter-spacing: 0.05em;
    `;
    div.appendChild(label);
    el.appendChild(div);
  }

  return timelineH;
}

const timelineHeight = createInsetOverlays();
scene.setInsetConfig(INSET_SIZE, timelineHeight);

// --- Stereo sync & sources ---
const sync = new StereoSync();
const videoBoston = { raw: null as HTMLVideoElement | null, rotated: null as HTMLVideoElement | null };
const videoSantiago = { raw: null as HTMLVideoElement | null, rotated: null as HTMLVideoElement | null };
const sourcesCtx: SourcesContext = { scene, boston: videoBoston, santiago: videoSantiago };

// Load stub manifest and wire up any videos it declares.
interface ManifestSide {
  raw: string | null;
  rotated: string | null;
  start_utc: string;
  timelapse_fps: number;
  playback_fps: number;
}
interface Manifest {
  boston: ManifestSide;
  santiago: ManifestSide;
}
let manifest: Manifest | null = null;

async function loadManifest() {
  try {
    const res = await fetch('/footage/manifest.json');
    if (!res.ok) return;
    manifest = await res.json();
    await tryAttachVideos();
  } catch (err) {
    console.warn('[viewer-2] no manifest loaded:', err);
  }
}

async function tryAttachVideos() {
  if (!manifest) return;
  const sides: Array<['boston' | 'santiago', ManifestSide, typeof videoBoston]> = [
    ['boston', manifest.boston, videoBoston],
    ['santiago', manifest.santiago, videoSantiago],
  ];
  for (const [, side, pair] of sides) {
    if (side.raw)     pair.raw     = makeVideo(side.raw);
    if (side.rotated) pair.rotated = makeVideo(side.rotated);
  }
  updateVideoInfo();
  maybeInitSyncTracks();
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

function maybeInitSyncTracks() {
  if (!manifest) return;
  const leftVid = pickVideoForSide('boston');
  const rightVid = pickVideoForSide('santiago');
  if (!leftVid || !rightVid) return;
  const leftTrack: VideoTrack = {
    el: leftVid,
    startUTC: Date.parse(manifest.boston.start_utc) / 1000,
    speedup: manifest.boston.playback_fps / manifest.boston.timelapse_fps,
    duration: leftVid.duration || 0,
  };
  const rightTrack: VideoTrack = {
    el: rightVid,
    startUTC: Date.parse(manifest.santiago.start_utc) / 1000,
    speedup: manifest.santiago.playback_fps / manifest.santiago.timelapse_fps,
    duration: rightVid.duration || 0,
  };
  const onReady = () => {
    leftTrack.duration = leftVid.duration;
    rightTrack.duration = rightVid.duration;
    sync.setTracks(leftTrack, rightTrack);
  };
  let ready = 0;
  for (const v of [leftVid, rightVid]) {
    if (v.readyState >= 1) { ready++; }
    else v.addEventListener('loadedmetadata', () => { if (++ready === 2) onReady(); }, { once: true });
  }
  if (ready === 2) onReady();
}

function pickVideoForSide(side: 'boston' | 'santiago'): HTMLVideoElement | null {
  const pair = side === 'boston' ? videoBoston : videoSantiago;
  return pair.rotated ?? pair.raw;
}

function updateVideoInfo() {
  const fmt = (p: typeof videoBoston) => {
    const parts: string[] = [];
    if (p.rotated) parts.push('rotated');
    if (p.raw) parts.push('raw');
    return parts.length ? parts.join(' + ') : 'not loaded';
  };
  document.getElementById('video-boston-info')!.textContent = fmt(videoBoston);
  document.getElementById('video-santiago-info')!.textContent = fmt(videoSantiago);
}

loadManifest();

// --- UI bindings: shared timeline ---
const scrubber = document.getElementById('scrubber') as HTMLInputElement;
const btnPlay = document.getElementById('btn-play')!;
const speedSelect = document.getElementById('speed-select') as HTMLSelectElement;

function setPlaying(p: boolean) {
  playing = p;
  btnPlay.textContent = playing ? '||' : '>';
}

btnPlay.addEventListener('click', () => setPlaying(!playing));

scrubber.addEventListener('input', () => {
  const t = parseInt(scrubber.value) / 1000;
  currentTime = SIM_START.getTime() + t * (SIM_END.getTime() - SIM_START.getTime());
  currentFrame = computeFrame(new Date(currentTime));
  updateUI(currentFrame);
});

speedSelect.addEventListener('change', () => {
  speedMultiplier = parseInt(speedSelect.value);
});

// --- UI bindings: mode switch ---
function setMode(m: Mode) {
  mode = m;
  const simBtn = document.querySelector<HTMLButtonElement>('#mode-switch button[data-mode="sim"]')!;
  const stBtn  = document.querySelector<HTMLButtonElement>('#mode-switch button[data-mode="stereo"]')!;
  simBtn.className = m === 'sim'
    ? 'px-3 py-2 bg-white/20 text-white/90 rounded-l-lg'
    : 'px-3 py-2 bg-white/5 text-white/50 rounded-l-lg hover:bg-white/15';
  stBtn.className = m === 'stereo'
    ? 'px-3 py-2 bg-white/20 text-white/90 rounded-r-lg'
    : 'px-3 py-2 bg-white/5 text-white/50 rounded-r-lg hover:bg-white/15';

  document.getElementById('panel-sim')!.classList.toggle('hidden', m !== 'sim');
  document.getElementById('panel-stereo')!.classList.toggle('hidden', m !== 'stereo');
  document.getElementById('telescope-insets')!.style.display = m === 'sim' && telescopesVisible ? '' : 'none';
  // Keep the Three.js container laid out (preserves clientWidth/Height on resize).
  // The stereo canvas, when visible, sits on top at a higher z-index and
  // covers it.
  stereoCanvas.classList.toggle('hidden', m !== 'stereo');

  scene.setPIPOutputsEnabled(m === 'stereo');

  if (m === 'stereo') {
    // Ensure videos are paused-or-playing consistent with global state.
    sync.isPlaying = playing;
  } else {
    sync.pause();
  }
}

document.querySelectorAll<HTMLButtonElement>('#mode-switch button').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode as Mode));
});

// --- UI bindings: sim panel ---
document.getElementById('btn-system')!.addEventListener('click', () => scene.focusSystem());
document.getElementById('btn-earth')!.addEventListener('click', () => scene.focusEarth());
document.getElementById('btn-moon')!.addEventListener('click', () => scene.focusMoon(currentFrame));

let telescopesVisible = true;
document.getElementById('btn-telescopes')!.addEventListener('click', () => {
  telescopesVisible = !telescopesVisible;
  scene.setTelescopesVisible(telescopesVisible);
  document.getElementById('telescope-insets')!.style.display = telescopesVisible ? '' : 'none';
});

// --- UI bindings: stereo panel ---
const leftEyeSel = document.getElementById('left-eye-src') as HTMLSelectElement;
const rightEyeSel = document.getElementById('right-eye-src') as HTMLSelectElement;
const parallaxSlider = document.getElementById('parallax-slider') as HTMLInputElement;

leftEyeSel.addEventListener('change', () => { leftEyeSrc = leftEyeSel.value as EyeSource; });
rightEyeSel.addEventListener('change', () => { rightEyeSrc = rightEyeSel.value as EyeSource; });

document.getElementById('btn-swap-eyes')!.addEventListener('click', () => toggleSwap());

stereoModeSel.addEventListener('change', () => {
  stereoEncoding = stereoModeSel.value as StereoMode;
  stereoRenderer.mode = stereoEncoding;
});

parallaxSlider.addEventListener('input', () => {
  parallaxPx = parseInt(parallaxSlider.value);
  stereoRenderer.parallaxPx = parallaxPx;
  document.getElementById('parallax-val')!.textContent =
    `${parallaxPx >= 0 ? '+' : ''}${parallaxPx} px`;
});

document.getElementById('btn-parallax-reset')!.addEventListener('click', () => {
  parallaxPx = 0;
  parallaxSlider.value = '0';
  stereoRenderer.parallaxPx = 0;
  document.getElementById('parallax-val')!.textContent = '+0 px';
});

function toggleSwap() {
  eyeSwap = !eyeSwap;
  stereoRenderer.swap = eyeSwap;
  const btn = document.getElementById('btn-swap-eyes')!;
  btn.classList.toggle('bg-white/20', eyeSwap);
  btn.classList.toggle('bg-white/10', !eyeSwap);
}

function cycleStereoMode() {
  const keys = Object.keys(MODE_LABELS) as StereoMode[];
  const i = keys.indexOf(stereoEncoding);
  stereoEncoding = keys[(i + 1) % keys.length];
  stereoRenderer.mode = stereoEncoding;
  stereoModeSel.value = stereoEncoding;
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    setMode(mode === 'sim' ? 'stereo' : 'sim');
    return;
  }
  if (e.key === '1') { setMode('sim'); return; }
  if (e.key === '2') { setMode('stereo'); return; }
  if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); return; }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const mult = e.shiftKey ? 10 : 1;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const step = 60_000 * mult * dir; // 1 minute per tap
    currentTime = Math.max(SIM_START.getTime(), Math.min(SIM_END.getTime(), currentTime + step));
    currentFrame = computeFrame(new Date(currentTime));
    return;
  }

  if (mode !== 'stereo') return;

  if (e.key === 'm') { cycleStereoMode(); return; }
  if (e.key === 's') { toggleSwap(); return; }
  if (e.key === '0') {
    parallaxPx = 0;
    parallaxSlider.value = '0';
    stereoRenderer.parallaxPx = 0;
    document.getElementById('parallax-val')!.textContent = '+0 px';
    return;
  }
  if (e.key === '[' || e.key === ']') {
    parallaxPx += e.key === '[' ? -2 : 2;
    parallaxPx = Math.max(-200, Math.min(200, parallaxPx));
    parallaxSlider.value = String(parallaxPx);
    stereoRenderer.parallaxPx = parallaxPx;
    document.getElementById('parallax-val')!.textContent =
      `${parallaxPx >= 0 ? '+' : ''}${parallaxPx} px`;
    return;
  }
  if (e.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    return;
  }
  if (e.key === 'h') {
    uiHidden = !uiHidden;
    document.getElementById('panel-stereo')!.classList.toggle('opacity-0', uiHidden);
    document.getElementById('mode-switch')!.classList.toggle('opacity-0', uiHidden);
    document.getElementById('timeline')!.classList.toggle('opacity-0', uiHidden);
    return;
  }
});

// --- Animation loop ---
function animate(realTime: number) {
  requestAnimationFrame(animate);

  if (lastRealTime > 0 && playing) {
    const dt = (realTime - lastRealTime) / 1000;
    currentTime += dt * speedMultiplier * 1000;
    if (currentTime > SIM_END.getTime()) currentTime = SIM_START.getTime();
    currentFrame = computeFrame(new Date(currentTime));
  }
  lastRealTime = realTime;

  const t = (currentTime - SIM_START.getTime()) / (SIM_END.getTime() - SIM_START.getTime());
  scrubber.value = String(Math.round(t * 1000));
  updateUI(currentFrame);

  if (mode === 'sim') {
    scene.update(currentFrame);
  } else {
    scene.applyFrameState(currentFrame);
    scene.renderPIPOutputs();

    if (sync.hasTracks()) {
      // Master rate: sim-seconds per wall-second = speedMultiplier. Video
      // advances (videoRate * speedup) sim-seconds per wall-second, so
      // videoRate = speedMultiplier / speedup. sync uses leftSpeedup.
      const leftSpeedup = sync.left?.speedup ?? 1;
      const rate = speedMultiplier / leftSpeedup;
      sync.syncToExternalUTC(currentTime / 1000, playing, rate);
    }

    const leftRes = resolveEyeSource('boston', leftEyeSrc, sourcesCtx);
    const rightRes = resolveEyeSource('santiago', rightEyeSrc, sourcesCtx);
    if (leftRes) stereoRenderer.uploadSource('left', leftRes.el);
    else stereoRenderer.setEyeBlank('left');
    if (rightRes) stereoRenderer.uploadSource('right', rightRes.el);
    else stereoRenderer.setEyeBlank('right');
    stereoRenderer.render();
  }
}
requestAnimationFrame(animate);

// --- UI helpers ---
function updateUI(f: FrameData) {
  const ids = mode === 'sim'
    ? { time: 'time-display', phase: 'phase-display' }
    : { time: 'time-display-s', phase: 'phase-display-s' };

  document.getElementById(ids.time)!.textContent = f.utcString;

  let phase = '';
  if (f.eclipse.phase === 'total') phase = 'TOTALITY';
  else if (f.eclipse.phase !== 'none') phase = `Eclipse (${f.eclipse.phase})`;
  else if (f.inOverlap) phase = 'Overlap (both recording)';
  else phase = 'Boston only';
  document.getElementById(ids.phase)!.textContent = phase;

  if (mode !== 'sim') return;

  document.getElementById('boston-altaz')!.textContent =
    `alt ${f.bostonAltAz.alt.toFixed(1)}\u00B0 az ${f.bostonAltAz.az.toFixed(1)}\u00B0`;
  document.getElementById('boston-rot')!.textContent =
    `${f.bostonCorrection >= 0 ? '+' : ''}${f.bostonCorrection.toFixed(3)}\u00B0`;
  document.getElementById('boston-vt')!.textContent =
    f.bostonVideoSec >= 0 ? formatDuration(f.bostonVideoSec) : '--:--:--';

  document.getElementById('santiago-altaz')!.textContent =
    `alt ${f.santiagoAltAz.alt.toFixed(1)}\u00B0 az ${f.santiagoAltAz.az.toFixed(1)}\u00B0`;
  document.getElementById('santiago-rot')!.textContent =
    `${f.santiagoCorrection >= 0 ? '+' : ''}${f.santiagoCorrection.toFixed(3)}\u00B0`;
  document.getElementById('santiago-vt')!.textContent =
    f.santiagoVideoSec >= 0 ? formatDuration(f.santiagoVideoSec) : '--:--:--';

  document.getElementById('parallax')!.textContent =
    `${f.parallax.toFixed(4)}\u00B0 (${(f.parallax * 3600).toFixed(1)} arcsec)`;

  const ecl = f.eclipse;
  document.getElementById('eclipse-phase')!.textContent = ecl.phase.toUpperCase();
  document.getElementById('eclipse-umbral')!.textContent = `${(ecl.umbralImmersion * 100).toFixed(1)}%`;
  document.getElementById('eclipse-penumbral')!.textContent = `${(ecl.penumbralImmersion * 100).toFixed(1)}%`;
  document.getElementById('eclipse-sep')!.textContent = `${ecl.shadowSepER.toFixed(3)} ER`;
  document.getElementById('eclipse-umbra-r')!.textContent = `${ecl.umbraRadiusER.toFixed(3)} ER`;
}

function formatUTC(d: Date): string {
  return d.toISOString().slice(11, 16) + ' UTC';
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
