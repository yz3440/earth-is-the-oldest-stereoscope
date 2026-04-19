// Per-eye source resolver. The `mode` arg overrides the default auto logic:
//   auto       → video if ready + covers, else NO SIGNAL, else sim PIP
//   video-only → video if ready + covers, else NO SIGNAL
//   sim-only   → sim PIP always
// The `correction` flag selects raw vs corrected PIP canvas for sim fallback.
//
// Note: we intentionally DO NOT switch to PIP while `video.seeking` is true.
// Pause-and-seek mode (simRate 1x/2x, where desiredRate falls under the
// browser's playbackRate floor) issues a seek per integer frame; during the
// seek `readyState` can briefly drop to 1 (HAVE_METADATA). Returning the
// sim PIP canvas in that window uploads an Earth/Moon sim render into the
// eye texture — visible as a flash between frames. Instead we keep the
// video as the source: StereoRenderer.uploadSource early-returns when
// readyState < 2, and the sticky `leftReady`/`rightReady` + prev-frame
// crossfade hold the last good frame until the decoder lands.

import type { PlanetaryScene, EyeSide } from './scene';
import { getNoSignalCanvas } from './noSignal';
import type { SourceMode } from './state';

export interface SourcesContext {
  scene: PlanetaryScene | null;
  boston: HTMLVideoElement | null;
  santiago: HTMLVideoElement | null;
  covers: Record<EyeSide, boolean>;
  mode: SourceMode;
  correction: boolean;
  // True while the user is actively dragging the progress bar. We swap to
  // the sim PIP for the duration: the video element lags the seek and
  // applying the new correction angle to the still-displayed previous frame
  // looks visibly wrong. The sim PIP is rendered live at the scrubbed sim
  // time and already includes the correction roll, so image and angle stay
  // matched while the user drags.
  scrubbing: boolean;
}

export interface ResolvedSource {
  kind: 'video' | 'canvas';
  el: HTMLVideoElement | HTMLCanvasElement;
}

export function resolveEyeSource(side: EyeSide, ctx: SourcesContext): ResolvedSource {
  const video = side === 'boston' ? ctx.boston : ctx.santiago;
  const covers = ctx.covers[side];
  const pipKind = ctx.correction ? 'corrected' : 'raw';

  if (ctx.mode === 'sim-only') {
    if (!ctx.scene) return { kind: 'canvas', el: getNoSignalCanvas() };
    return { kind: 'canvas', el: ctx.scene.getPIPCanvas(side, pipKind) };
  }

  // While scrubbing, prefer the sim PIP over the video for any side that
  // has scene + coverage. Out-of-coverage still shows NO SIGNAL so the
  // viewer can see the coverage edges they're scrubbing past.
  if (ctx.scrubbing && ctx.scene && covers) {
    return { kind: 'canvas', el: ctx.scene.getPIPCanvas(side, pipKind) };
  }

  if (ctx.mode === 'video-only') {
    if (video && !covers) return { kind: 'canvas', el: getNoSignalCanvas() };
    if (video && video.videoWidth > 0 && (video.readyState >= 2 || video.seeking)) {
      return { kind: 'video', el: video };
    }
    return { kind: 'canvas', el: getNoSignalCanvas() };
  }

  // auto
  if (video && !covers) return { kind: 'canvas', el: getNoSignalCanvas() };
  if (video && video.videoWidth > 0 && (video.readyState >= 2 || video.seeking)) {
    return { kind: 'video', el: video };
  }
  if (!ctx.scene) return { kind: 'canvas', el: getNoSignalCanvas() };
  return { kind: 'canvas', el: ctx.scene.getPIPCanvas(side, pipKind) };
}
