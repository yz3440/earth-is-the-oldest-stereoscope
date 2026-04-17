// Per-eye source resolver. Priority per eye:
//   1. video ready + covers sim time                     → video
//   2. video loaded but does NOT cover sim time          → "NO SIGNAL" canvas
//   3. video covers sim time but is seeking/not ready    → sim PIP (pulsing)
//   4. no video loaded at all (manifest missing)         → sim PIP (static)

import type { PlanetaryScene, EyeSide } from './scene';
import { getNoSignalCanvas } from './noSignal';

export interface SourcesContext {
  scene: PlanetaryScene;
  boston: HTMLVideoElement | null;
  santiago: HTMLVideoElement | null;
  covers: Record<EyeSide, boolean>;
}

export interface ResolvedSource {
  kind: 'video' | 'canvas';
  el: HTMLVideoElement | HTMLCanvasElement;
  loading: boolean;
}

export function resolveEyeSource(side: EyeSide, ctx: SourcesContext): ResolvedSource {
  const video = side === 'boston' ? ctx.boston : ctx.santiago;
  const covers = ctx.covers[side];

  if (video && !covers) {
    return { kind: 'canvas', el: getNoSignalCanvas(), loading: false };
  }
  if (video && video.readyState >= 2 && video.videoWidth > 0 && !video.seeking) {
    return { kind: 'video', el: video, loading: false };
  }
  return {
    kind: 'canvas',
    el: ctx.scene.getPIPCanvas(side),
    loading: video != null,
  };
}
