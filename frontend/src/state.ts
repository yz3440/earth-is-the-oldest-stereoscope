import { signal, computed, effect, type Signal } from '@preact/signals';
import { OVERLAP_START } from './astronomy';

export type Layout = 'sbs-full' | 'sbs-half' | 'tb-full' | 'tb-half';
export type Encoding =
  | 'none'
  | 'wiggle'
  | 'anaglyph-rc'
  | 'anaglyph-rc-dubois'
  | 'anaglyph-gm'
  | 'anaglyph-amber'
  | 'frame-seq';
export type SourceMode = 'video-only' | 'sim-only';
export type View = 'stereo' | 'sim' | 'introduction';

// Wrap `signal` with localStorage persistence so the user's control choices
// survive reloads. Reads the stored value at construction; writes any
// mutation back. Failures (private mode, quota, malformed JSON) fall through
// to the in-memory default — persistence is best-effort, not load-bearing.
function persisted<T>(key: string, initial: T): Signal<T> {
  const storageKey = `stereo-moon:${key}`;
  let value = initial;
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) value = JSON.parse(raw) as T;
    } catch {}
  }
  const sig = signal<T>(value);
  if (typeof localStorage !== 'undefined') {
    effect(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(sig.value));
      } catch {}
    });
  }
  return sig;
}

export const RATE_STEPS = [1, 2, 5, 10, 30, 60, 120, 240, 480] as const;
export const DEFAULT_RATE_INDEX = 4;

export const currentTime = signal<number>(OVERLAP_START.getTime());
export const playing = signal<boolean>(false);
export const videosReady = signal<boolean>(false);
// Aggregate download progress across both telescope videos, 0..1. Drives the
// progress bar in the welcome modal. 1 means bytes are fully fetched; videos
// may still be decoding — `videosReady` is the definitive "can play" flag.
export const loadProgress = signal<number>(0);
export const rateIdx = persisted<number>('rateIdx', DEFAULT_RATE_INDEX);

export const layout = persisted<Layout>('layout', 'sbs-half');
// Default first-time visitors to raw side-by-side (`none` + `sbs-half`): two
// Moons sat next to each other read immediately as a stereo *pair* — the piece
// is literally a stereoscope, and the side-by-side arrangement makes the "two
// viewpoints, one subject" idea legible at a glance (fuse by crossing/relaxing
// the eyes, or use a stereoscope). The glasses-free `wiggle` and the anaglyph /
// shutter modes are one click away in CONTROLS. Returning users keep their
// persisted choice.
export const encoding = persisted<Encoding>('encoding', 'none');

// Viewing METHOD — a UI-only grouping derived from `encoding` (which stays the
// single persisted source of truth). The control bar presents the method as the
// primary choice and then shows only that method's secondary control: `split`
// → LAYOUT, `wiggle` → speed, `anaglyph` → color variant, `shutter` → none.
// `split` covers the raw stereo pair in either side-by-side or top-bottom
// arrangement (chosen via LAYOUT); its user-facing label is "side-by-side".
export type Method = 'split' | 'wiggle' | 'anaglyph' | 'shutter';
export const ANAGLYPH_ENCODINGS: Encoding[] = [
  'anaglyph-rc',
  'anaglyph-rc-dubois',
  'anaglyph-gm',
  'anaglyph-amber',
];
export function methodOf(enc: Encoding): Method {
  switch (enc) {
    case 'none':
      return 'split';
    case 'wiggle':
      return 'wiggle';
    case 'frame-seq':
      return 'shutter';
    case 'anaglyph-rc':
    case 'anaglyph-rc-dubois':
    case 'anaglyph-gm':
    case 'anaglyph-amber':
      return 'anaglyph';
  }
}
export const method = computed<Method>(() => methodOf(encoding.value));
export function setMethod(m: Method) {
  switch (m) {
    case 'split':
      encoding.value = 'none';
      break;
    case 'wiggle':
      encoding.value = 'wiggle';
      break;
    case 'shutter':
      encoding.value = 'frame-seq';
      break;
    case 'anaglyph':
      // Keep the current anaglyph variant if we're already on one; otherwise
      // default to red/cyan. Switching away and back doesn't remember the
      // previous variant — `encoding` is the only source of truth.
      if (!ANAGLYPH_ENCODINGS.includes(encoding.value)) encoding.value = 'anaglyph-rc';
      break;
  }
}

// Wiggle (a.k.a. wobble / wigglegram) half-period in milliseconds: how long
// each eye is shown before swapping to the other. ~150ms ≈ 3.3 swaps/sec,
// the sweet spot where the brain reads parallax as depth without the flicker
// being distracting. Only used when `encoding === 'wiggle'`.
export const wiggleMs = persisted<number>('wiggleMs', 150);
export const sourceMode = persisted<SourceMode>('sourceMode', 'video-only');
export const correction = persisted<boolean>('correction', true);
// Head-flip: rotate the full presentation by 180° and swap L/R eye
// assignment. The shown image ends up upside-down with correct stereo
// depth. In the sim view this flips the 3D canvas too.
export const flipHead = persisted<boolean>('flipHead', false);
export const parallaxPx = persisted<number>('parallaxPx', 0);

// Per-eye horizontal squeeze, as a percentage. 100 = no change. >100
// compresses the source horizontally inside each eye region (useful when
// the downstream display anamorphically stretches each eye, e.g. half-SBS
// 3D TVs). <100 stretches it. Range 50–200 → factor 0.5×–2×.
export const squeezePct = persisted<number>('squeezePct', 100);

// Loop the stereo videos within the Boston/Santiago overlap window. When
// true and the stereo view is active, playback wraps back to the start of
// the overlap once it crosses the end — so the user can sit on the
// double-camera segment without having to scrub manually.
export const loopOverlap = persisted<boolean>('loopOverlap', false);

// Measured height (CSS px) of the introduction card. Written by the
// IntroductionView via a ResizeObserver, read by the camera-keyframe
// pipeline to lift bodies above the card so the card never occludes
// Earth/Moon.
export const introductionCardHeight = signal<number>(0);

// The app always opens on the stereoscopy view. Which tab the user was last on
// is intentionally NOT remembered across sessions (every other setting still
// persists) — a fresh load should greet the visitor with the Moon, not wherever
// they happened to leave off. The introduction is a dismissible pop-up over the
// stereo video (see `showIntro`), not a standalone view.
export const view = signal<View>('stereo');
export const panelOpen = signal<boolean>(false);
export const showTelescopes = persisted<boolean>('showTelescopes', true);
// Per-eye overlay text toggles (stereo view). `showEyeTop` = city name +
// coords + local time block; `showEyeBottom` = weather + UTC/video time +
// eclipse phase block.
export const showEyeTop = persisted<boolean>('showEyeTop', true);
export const showEyeBottom = persisted<boolean>('showEyeBottom', true);

// Introduction — a short guided tour explaining the parallax geometry, shown
// as a dismissible pop-up (the 2-page card) over the stereo video. `showIntro`
// controls its visibility: it opens for first-time visitors and is reopenable
// from the bottom-bar INTRODUCTION button. Not persisted, so each fresh load
// greets the visitor with the card over the video.
export const showIntro = signal<boolean>(true);
export const INTRODUCTION_PAGE_COUNT = 3;
export const introductionPage = signal<number>(0);
export function openIntroduction() {
  introductionPage.value = 0;
  showIntro.value = true;
}
export function closeIntroduction() {
  showIntro.value = false;
}
export function nextIntroductionPage() {
  if (introductionPage.value < INTRODUCTION_PAGE_COUNT - 1) {
    introductionPage.value += 1;
  } else {
    // ENTER on the last page dismisses the pop-up, leaving the stereo video.
    closeIntroduction();
  }
}
export function prevIntroductionPage() {
  if (introductionPage.value > 0) introductionPage.value -= 1;
}

// True while the user is actively dragging the progress bar. Sources fall
// back to the sim PIP during a scrub: the video element lags the seek and
// applying the new correction angle to the still-painted previous frame
// looks visibly wrong. The sim PIP is rendered live at the scrubbed sim
// time and already includes the correction roll, so image and angle stay
// matched while the user drags.
export const scrubbing = signal<boolean>(false);

export const simRate = () => RATE_STEPS[rateIdx.value];

// Viewport-width signal, updated on resize. Components derive compact/narrow
// layouts from this. Breakpoints: narrow < 640 (phones), compact < 960 (small
// tablets / narrow windows), else desktop.
export const viewportWidth = signal<number>(
  typeof window === 'undefined' ? 1280 : window.innerWidth,
);
export const viewportHeight = signal<number>(
  typeof window === 'undefined' ? 720 : window.innerHeight,
);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    viewportWidth.value = window.innerWidth;
    viewportHeight.value = window.innerHeight;
  });
}
export const isNarrow  = computed(() => viewportWidth.value < 640);
export const isCompact = computed(() => viewportWidth.value < 960);

// Fullscreen state, synced to the browser's own flag. The user can leave
// fullscreen via Escape, OS gestures, or the browser UI, so we can't treat
// our toggle calls as authoritative — listen to `fullscreenchange` instead.
export const fullscreen = signal<boolean>(
  typeof document !== 'undefined' && !!document.fullscreenElement,
);
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    fullscreen.value = !!document.fullscreenElement;
  });
}
export function toggleFullscreen() {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}
