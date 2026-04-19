import { BottomBar } from './components/BottomBar';
import { ProgressTicks } from './components/ProgressTicks';
import { EyeOverlay } from './components/EyeOverlay';
import { SimView } from './components/SimView';
import { TelescopeGrid } from './components/TelescopeGrid';
import { SceneLabels } from './components/SceneLabels';
import type { EyeData } from './components/EyeOverlay';
import type { PlanetaryScene, EyeSide } from './scene';
import type { Manifest } from './manifest';
import { view, panelOpen, isNarrow } from './state';

export interface AppProps {
  scene: PlanetaryScene | null;
  manifest: Manifest | null;
  boston: EyeData;
  santiago: EyeData;
  videos: { boston: HTMLVideoElement | null; santiago: HTMLVideoElement | null };
  getAngleRad: (side: EyeSide) => number;
  getCovers: (side: EyeSide) => boolean;
}

export function App({ scene, manifest, boston, santiago, videos, getAngleRad, getCovers }: AppProps) {
  const showStereo = view.value === 'stereo';
  // Desktop horizontal controls bar sits at bottom:40 (above BottomBar);
  // lift ProgressTicks above it when shown.
  const progressBottom = !isNarrow.value && panelOpen.value ? 80 : 40;
  return (
    <div class="relative w-full h-full overflow-hidden">
      {/* Stereo canvas — always mounted, hidden in sim view */}
      <canvas
        id="stereo-canvas"
        class="absolute inset-0"
        style={{ display: showStereo ? 'block' : 'none', zIndex: 1 }}
      />

      {/* Sim view — always mounted to keep WebGL context, hidden in stereo view */}
      {scene && <SimView scene={scene} />}

      {/* Body labels (Earth / Sun / Moon) — sim view only */}
      {!showStereo && scene && <SceneLabels scene={scene} />}

      {/* Per-eye overlay text (stereo view only) */}
      {showStereo && <EyeOverlay boston={boston} santiago={santiago} />}

      {/* Telescope grid (sim view only). Renders even when WebGL scene is
          absent — video tiles still work, sim tiles gracefully blank. */}
      {!showStereo && (
        <TelescopeGrid scene={scene} videos={videos} getAngleRad={getAngleRad} getCovers={getCovers} />
      )}

      {/* Progress bar + bottom bar (bottom bar hosts the controls popover) */}
      <div class="absolute left-0 right-0" style={{ bottom: progressBottom, zIndex: 20, background: 'rgba(0,0,0,0.85)', padding: '0 14px' }}>
        <ProgressTicks manifest={manifest} />
      </div>
      <BottomBar />
    </div>
  );
}
