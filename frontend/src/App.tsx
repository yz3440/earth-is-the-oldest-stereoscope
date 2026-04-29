import { BottomBar } from './components/BottomBar';
import { ProgressTicks } from './components/ProgressTicks';
import { EyeOverlay } from './components/EyeOverlay';
import { SimView } from './components/SimView';
import { TelescopeGrid } from './components/TelescopeGrid';
import { SceneLabels } from './components/SceneLabels';
import { IntroductionView } from './components/IntroductionView';
import type { EyeData } from './components/EyeOverlay';
import type { PlanetaryScene, EyeSide } from './scene';
import type { Manifest } from './manifest';
import { view, panelOpen, isNarrow, fullscreen } from './state';

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
  const v = view.value;
  const isStereo = v === 'stereo';
  const isSim = v === 'sim';
  const isIntroduction = v === 'introduction';
  // Desktop horizontal controls bar sits at bottom:40 (above BottomBar);
  // lift ProgressTicks above it when shown.
  const progressBottom = !isNarrow.value && panelOpen.value ? 80 : 40;
  return (
    <div class="relative w-full h-full overflow-hidden">
      {/* Stereo canvas — always mounted, hidden outside the stereo view */}
      <canvas
        id="stereo-canvas"
        class="absolute inset-0"
        style={{ display: isStereo ? 'block' : 'none', zIndex: 1 }}
      />

      {/* Sim view — always mounted to keep WebGL context. Hidden when the
          stereo (videos) view is active. The introduction view re-uses
          the sim view's stereo render as its background. */}
      {scene && <SimView scene={scene} />}

      {/* Body labels (Earth / Sun / Moon) — shown on the sim and
          introduction views, where naming each body is helpful. The
          telescope grid stays off in the introduction so the diagram
          reads clean. */}
      {(isSim || isIntroduction) && scene && <SceneLabels scene={scene} />}

      {/* Per-eye overlay text (stereo view only) */}
      {isStereo && <EyeOverlay boston={boston} santiago={santiago} />}

      {/* Telescope grid — sim view only. */}
      {isSim && (
        <TelescopeGrid scene={scene} videos={videos} getAngleRad={getAngleRad} getCovers={getCovers} />
      )}

      {/* Progress bar + bottom bar (bottom bar hosts the controls popover).
          Hidden in fullscreen for an unobstructed viewing surface, and
          hidden in introduction view to keep the guided tour minimal —
          exit fullscreen with Esc or `f` to bring them back. */}
      {!fullscreen.value && !isIntroduction && (
        <>
          <div class="absolute left-0 right-0" style={{ bottom: progressBottom, zIndex: 20, background: 'rgba(0,0,0,0.85)', padding: '0 14px' }}>
            <ProgressTicks manifest={manifest} />
          </div>
        </>
      )}
      {/* BottomBar stays mounted even in introduction view — it carries
          the tab switcher, which is the user's way out of the tour. */}
      {!fullscreen.value && <BottomBar />}

      {/* Introduction view — guided tour explaining the parallax geometry,
          rendered over the stereo orbital diagram. Active when
          view==='introduction'. */}
      <IntroductionView />
    </div>
  );
}
