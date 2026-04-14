// Per-eye source resolver for stereo mode.
//
// Each eye in the stereo compositor can be fed from one of four sources:
//
//   video.rotated   — real telescope footage, post-rotation correction
//   video.raw       — real footage, stabilized but NOT rotation-corrected
//   sim.rotated     — Three.js telescope PIP with baseline-aligned up
//   sim.raw         — Three.js telescope PIP with horizon-leveled up
//
// The sim.* sources are driven by `PlanetaryScene.getPIPCanvas(camera, kind)`
// — persistent 2D canvases kept fresh by `renderPIPOutputs()` every frame.
// The video.* sources are plain <video> elements loaded elsewhere (currently
// stubbed via the manifest in `public/footage/`).

import type { PlanetaryScene } from './scene';

export type EyeSource = 'video.rotated' | 'video.raw' | 'sim.rotated' | 'sim.raw';
export type EyeSide = 'boston' | 'santiago';

export const EYE_SOURCE_LABELS: Record<EyeSource, string> = {
  'video.rotated': 'video / rotated',
  'video.raw': 'video / raw (stabilized)',
  'sim.rotated': 'sim / rotated',
  'sim.raw': 'sim / raw',
};

export interface VideoPair {
  raw: HTMLVideoElement | null;
  rotated: HTMLVideoElement | null;
}

export interface SourcesContext {
  scene: PlanetaryScene;
  boston: VideoPair;
  santiago: VideoPair;
}

export interface ResolvedSource {
  kind: 'video' | 'canvas';
  el: HTMLVideoElement | HTMLCanvasElement;
}

export function resolveEyeSource(
  side: EyeSide,
  which: EyeSource,
  ctx: SourcesContext,
): ResolvedSource | null {
  if (which === 'sim.raw') {
    return { kind: 'canvas', el: ctx.scene.getPIPCanvas(side, 'raw') };
  }
  if (which === 'sim.rotated') {
    return { kind: 'canvas', el: ctx.scene.getPIPCanvas(side, 'corrected') };
  }
  const pair = side === 'boston' ? ctx.boston : ctx.santiago;
  const video = which === 'video.raw' ? pair.raw : pair.rotated;
  return video ? { kind: 'video', el: video } : null;
}
