import './style.css';
import {
  computeFrame,
  exportKeyframesJSON,
  SIM_START,
  SIM_END,
  OVERLAP_START,
  ECLIPSE_PENUMBRAL_START,
  ECLIPSE_TOTALITY_START,
} from './astronomy';
import type { FrameData } from './astronomy';
import { PlanetaryScene } from './scene';

// --- State ---
let currentTime = SIM_START.getTime();
let playing = true;
let speedMultiplier = 120;
let lastRealTime = 0;
let scene: PlanetaryScene;
let currentFrame: FrameData;

// --- DOM setup ---
const app = document.getElementById('app')!;
app.innerHTML = `
  <div id="canvas-container" class="absolute inset-0"></div>

  <div id="panel" class="absolute top-4 right-4 w-80 bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg p-4 text-xs leading-relaxed select-none overflow-y-auto max-h-[calc(100vh-120px)]">
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

    <div class="border-t border-white/10 pt-3">
      <button id="btn-export" class="w-full py-2 bg-white/10 rounded text-white/70 hover:bg-white/20 text-xs font-bold tracking-wide">
        EXPORT KEYFRAMES (JSON)
      </button>
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

// --- Initialize ---
const container = document.getElementById('canvas-container')!;
scene = new PlanetaryScene(container);
currentFrame = computeFrame(new Date(currentTime));

// --- Telescope inset overlays ---
const INSET_SIZE = 200;
const INSET_GAP = 8;
const INSET_MARGIN = 16;

function createInsetOverlays() {
  const el = document.getElementById('telescope-insets')!;
  const timelineH = document.getElementById('timeline')!.offsetHeight;
  const baseY = timelineH + INSET_MARGIN;
  const baseX = INSET_MARGIN;

  const configs = [
    { label: 'BOSTON RAW',           color: '#ff4444', x: baseX,                         y: baseY },
    { label: 'SANTIAGO RAW',        color: '#44ff44', x: baseX + INSET_SIZE + INSET_GAP, y: baseY },
    { label: 'BOSTON CORRECTED',     color: '#ff4444', x: baseX,                         y: baseY + INSET_SIZE + INSET_GAP },
    { label: 'SANTIAGO CORRECTED',  color: '#44ff44', x: baseX + INSET_SIZE + INSET_GAP, y: baseY + INSET_SIZE + INSET_GAP },
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

// --- UI bindings ---
const scrubber = document.getElementById('scrubber') as HTMLInputElement;
const btnPlay = document.getElementById('btn-play')!;
const speedSelect = document.getElementById('speed-select') as HTMLSelectElement;

btnPlay.addEventListener('click', () => {
  playing = !playing;
  btnPlay.textContent = playing ? '||' : '>';
});

scrubber.addEventListener('input', () => {
  const t = parseInt(scrubber.value) / 1000;
  currentTime = SIM_START.getTime() + t * (SIM_END.getTime() - SIM_START.getTime());
  currentFrame = computeFrame(new Date(currentTime));
  updateUI(currentFrame);
});

speedSelect.addEventListener('change', () => {
  speedMultiplier = parseInt(speedSelect.value);
});

document.getElementById('btn-system')!.addEventListener('click', () => scene.focusSystem());
document.getElementById('btn-earth')!.addEventListener('click', () => scene.focusEarth());
document.getElementById('btn-moon')!.addEventListener('click', () => scene.focusMoon(currentFrame));

let telescopesVisible = true;
document.getElementById('btn-telescopes')!.addEventListener('click', () => {
  telescopesVisible = !telescopesVisible;
  scene.setTelescopesVisible(telescopesVisible);
  document.getElementById('telescope-insets')!.style.display = telescopesVisible ? '' : 'none';
});

document.getElementById('btn-export')!.addEventListener('click', () => {
  const json = exportKeyframesJSON(30);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stereo-moon-keyframes.json';
  a.click();
  URL.revokeObjectURL(url);
});

// --- Animation loop ---
function animate(realTime: number) {
  requestAnimationFrame(animate);

  if (lastRealTime > 0 && playing) {
    const dt = (realTime - lastRealTime) / 1000;
    currentTime += dt * speedMultiplier * 1000;

    if (currentTime > SIM_END.getTime()) {
      currentTime = SIM_START.getTime();
    }

    currentFrame = computeFrame(new Date(currentTime));
  }

  lastRealTime = realTime;

  const t = (currentTime - SIM_START.getTime()) / (SIM_END.getTime() - SIM_START.getTime());
  scrubber.value = String(Math.round(t * 1000));

  updateUI(currentFrame);
  scene.update(currentFrame);
}

requestAnimationFrame(animate);

// --- UI helpers ---
function updateUI(f: FrameData) {
  document.getElementById('time-display')!.textContent = f.utcString;

  let phase = '';
  if (f.eclipse.phase === 'total') phase = 'TOTALITY';
  else if (f.eclipse.phase !== 'none') phase = `Eclipse (${f.eclipse.phase})`;
  else if (f.inOverlap) phase = 'Overlap (both recording)';
  else phase = 'Boston only';
  document.getElementById('phase-display')!.textContent = phase;

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

  // Eclipse data
  const ecl = f.eclipse;
  document.getElementById('eclipse-phase')!.textContent = ecl.phase.toUpperCase();
  document.getElementById('eclipse-umbral')!.textContent =
    `${(ecl.umbralImmersion * 100).toFixed(1)}%`;
  document.getElementById('eclipse-penumbral')!.textContent =
    `${(ecl.penumbralImmersion * 100).toFixed(1)}%`;
  document.getElementById('eclipse-sep')!.textContent =
    `${ecl.shadowSepER.toFixed(3)} ER`;
  document.getElementById('eclipse-umbra-r')!.textContent =
    `${ecl.umbraRadiusER.toFixed(3)} ER`;
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
