import { signal, computed } from '@preact/signals';
import { SIM_START } from './astronomy';

export type Layout = 'sbs-full' | 'sbs-half' | 'tb-full' | 'tb-half';
export type Encoding =
  | 'none'
  | 'anaglyph-rc'
  | 'anaglyph-rc-dubois'
  | 'anaglyph-gm'
  | 'anaglyph-amber'
  | 'frame-seq';
export type SourceMode = 'auto' | 'video-only' | 'sim-only';
export type View = 'stereo' | 'sim';

export const RATE_STEPS = [1, 2, 5, 10, 30, 60, 120] as const;
export const DEFAULT_RATE_INDEX = 4;

export const currentTime = signal<number>(SIM_START.getTime());
export const playing = signal<boolean>(false);
export const videosReady = signal<boolean>(false);
export const rateIdx = signal<number>(DEFAULT_RATE_INDEX);

export const layout = signal<Layout>('sbs-half');
export const encoding = signal<Encoding>('none');
export const sourceMode = signal<SourceMode>('auto');
export const correction = signal<boolean>(true);
export const swap = signal<boolean>(false);
// Head-flip: rotate the full presentation by 180° and swap L/R eye
// assignment (XOR with `swap`). The shown image ends up upside-down with
// correct stereo depth. In the sim view this flips the 3D canvas too.
export const flipHead = signal<boolean>(false);
export const parallaxPx = signal<number>(0);

export const view = signal<View>('stereo');
export const panelOpen = signal<boolean>(false);
export const showTelescopes = signal<boolean>(true);

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
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    viewportWidth.value = window.innerWidth;
  });
}
export const isNarrow  = computed(() => viewportWidth.value < 640);
export const isCompact = computed(() => viewportWidth.value < 960);
