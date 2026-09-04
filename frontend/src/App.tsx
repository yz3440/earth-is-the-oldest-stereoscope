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
import {
  view,
  panelOpen,
  isNarrow,
  fullscreen,
  showIntro,
  cardboard,
  exitCardboard,
  playing,
  videosReady,
} from './state';

// Cardboard v2 lever = one capacitive tap at a fixed screen spot; its
// conductive pad can bounce, so debounce. Only bound while in Cardboard mode.
let lastCardboardTap = 0;
function onCardboardTap(e: PointerEvent) {
  e.preventDefault();
  const now = performance.now();
  if (now - lastCardboardTap < 300) return;
  lastCardboardTap = now;
  if (videosReady.value) playing.value = !playing.value;
}

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
  const cb = cardboard.value;
  // Every piece of chrome hides in fullscreen *or* Cardboard mode — the
  // latter matters for the "soft" Cardboard case where the browser refused
  // fullscreen (iPhone Safari) and `fullscreen.value` stays false.
  const chromeHidden = fullscreen.value || cb;
  return (
    <div class="relative w-full h-full overflow-hidden">
      {/* Stereo canvas — always mounted, hidden outside the stereo view.
          touch-action:none + no context menu: a headset lever tap must never
          pinch/double-tap zoom or long-press the stereo pair apart. */}
      <canvas
        id="stereo-canvas"
        class="absolute inset-0"
        style={{
          display: isStereo ? 'block' : 'none',
          zIndex: 1,
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={cb ? onCardboardTap : undefined}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Sim view — always mounted to keep WebGL context. Hidden when the
          stereo (videos) view is active. The introduction view re-uses the
          (mono) orbital diagram as its background. */}
      {scene && <SimView scene={scene} />}

      {/* Body labels (Earth / Sun / Moon) — shown on the sim and
          introduction views, where naming each body is helpful. The
          telescope grid stays off in the introduction so the diagram
          reads clean. */}
      {(isSim || isIntroduction) && scene && <SceneLabels scene={scene} />}

      {/* Per-eye overlay text (stereo view only). Hidden while the intro
          pop-up is open so the centered concept card reads as a clean modal,
          and in Cardboard mode where the outer quarters fall in the lens'
          vignetted edge. */}
      {isStereo && !showIntro.value && !cb && <EyeOverlay boston={boston} santiago={santiago} />}

      {/* Telescope grid — sim view only. */}
      {isSim && (
        <TelescopeGrid scene={scene} videos={videos} getAngleRad={getAngleRad} getCovers={getCovers} />
      )}

      {/* Progress bar + bottom bar (bottom bar hosts the controls popover).
          Hidden in fullscreen for an unobstructed viewing surface, and
          hidden in introduction view to keep the guided tour minimal —
          exit fullscreen with Esc or `f` to bring them back. */}
      {!chromeHidden && !isIntroduction && (
        <>
          <div class="absolute left-0 right-0" style={{ bottom: progressBottom, zIndex: 20, background: 'rgba(0,0,0,0.85)', padding: '0 14px' }}>
            <ProgressTicks manifest={manifest} />
          </div>
        </>
      )}
      {/* BottomBar stays mounted even in introduction view — it carries
          the tab switcher, which is the user's way out of the tour. */}
      {!chromeHidden && <BottomBar />}

      {/* Soft Cardboard mode (browser refused fullscreen): there is no
          `fullscreenchange` to leave on, so offer a faint exit button. */}
      {cb && !fullscreen.value && (
        <button
          type="button"
          onClick={exitCardboard}
          aria-label="Exit Cardboard mode"
          style={{
            position: 'fixed',
            top: 8,
            left: 8,
            zIndex: 50,
            width: 32,
            height: 32,
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
            opacity: 0.5,
            background: 'rgba(0,0,0,0.6)',
          }}
        >
          ✕
        </button>
      )}

      {/* Introduction view — short guided tour explaining the parallax
          geometry, rendered over the (mono) orbital diagram. Active when
          view==='introduction'. Never shown inside the headset. */}
      {!cb && <IntroductionView />}
    </div>
  );
}
