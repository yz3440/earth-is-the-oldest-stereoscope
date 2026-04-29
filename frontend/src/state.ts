import { signal, computed, effect, type Signal } from '@preact/signals';
import { OVERLAP_START } from './astronomy';

export type Layout = 'sbs-full' | 'sbs-half' | 'tb-full' | 'tb-half';
export type Encoding =
  | 'none'
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
export const encoding = persisted<Encoding>('encoding', 'none');
export const sourceMode = persisted<SourceMode>('sourceMode', 'video-only');
export const correction = persisted<boolean>('correction', true);
// Head-flip: rotate the full presentation by 180° and swap L/R eye
// assignment. The shown image ends up upside-down with correct stereo
// depth. In the sim view this flips the 3D canvas too.
export const flipHead = persisted<boolean>('flipHead', false);
export const parallaxPx = persisted<number>('parallaxPx', 0);

// Stereo render of the orbital diagram (sim view). When true, the sim view
// renders the scene from two slightly offset cameras and pipes both through
// the StereoRenderer so the geometry is visible in actual 3D depth.
export const simStereo = persisted<boolean>('simStereo', false);

// Stereo toggle for the introduction view. Default false so the text card
// is always readable at first; the user opts in to a stereo render of the
// orbital diagram (and a duplicated card per eye region for sbs/tb
// layouts) by flipping this. While the introduction is active, simStereo
// is kept in sync with this signal.
export const introductionStereo = persisted<boolean>('introductionStereo', false);

// Measured height (CSS px) of the introduction card. Written by the
// IntroductionView via a ResizeObserver, read by the camera-keyframe
// pipeline to lift bodies above the card so the card never occludes
// Earth/Moon.
export const introductionCardHeight = signal<number>(0);

// Default first-time landing view is the introduction — a guided tour that
// explains the parallax geometry with a stereo render of the orbital
// diagram. Returning users land on whichever view they last selected.
export const view = persisted<View>('view', 'introduction');
export const panelOpen = signal<boolean>(false);
export const showTelescopes = persisted<boolean>('showTelescopes', true);
// Per-eye overlay text toggles (stereo view). `showEyeTop` = city name +
// coords + local time block; `showEyeBottom` = weather + UTC/video time +
// eclipse phase block.
export const showEyeTop = persisted<boolean>('showEyeTop', true);
export const showEyeBottom = persisted<boolean>('showEyeBottom', true);

// Introduction view — a multi-page guided tour explaining the parallax
// geometry, with the stereo orbital diagram rendered behind the text card.
// Tied to the 'introduction' value of `view`; the page index is reset to 0
// each time the user enters the view.
export const INTRODUCTION_PAGE_COUNT = 4;
export const introductionPage = signal<number>(0);
export function nextIntroductionPage() {
  if (introductionPage.value < INTRODUCTION_PAGE_COUNT - 1) {
    introductionPage.value += 1;
  } else {
    // ENTER on the last page leaves the introduction for the stereo (videos) view.
    view.value = 'stereo';
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
