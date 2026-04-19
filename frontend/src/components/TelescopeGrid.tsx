// Two perspective windows for the SIMULATION view.
//
//   LOCAL HORIZON            EARTH STEREOSCOPY
//   horizon-leveled (raw)    baseline-aligned (corrected)
//
//                BOSTON  SANTIAGO                 BOSTON  SANTIAGO
//       SIM      [    ]   [    ]         SIM      [    ]   [    ]
//       VIDEO    [    ]   [    ]         VIDEO    [    ]   [    ]
//
// Desktop: two draggable FloatingWindow instances, top-left / top-right.
// Mobile: bottom-sheet tab stack (bullet-time-style) — single container
// above the main bottom bar, 2-tab row, one active panel at a time.

import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import type { PlanetaryScene, EyeSide } from '../scene';
import { showTelescopes, isNarrow, flipHead, scrubbing } from '../state';
import { FloatingWindow } from './FloatingWindow';
import { getNoSignalCanvas } from '../noSignal';
import { getLoadingCanvas } from '../loading';

export interface TelescopeGridProps {
  scene: PlanetaryScene | null;
  videos: {
    boston: HTMLVideoElement | null;
    santiago: HTMLVideoElement | null;
  };
  getAngleRad: (side: EyeSide) => number;
  getCovers: (side: EyeSide) => boolean;
}

const DESKTOP_TILE = 140;
const DESKTOP_LABEL_W = 44;
const DESKTOP_GAP = 4;
// Mobile renders a single horizontal row of 4 tiles (sim+video × B+S) per
// perspective window. 82 px × 4 + 6 px × 3 gaps + 20 px side padding =
// 358 px — fits a 390 px phone-portrait viewport.
const MOBILE_TILE = 82;
const MOBILE_ROW_GAP = 6;

function drawTo(
  c: HTMLCanvasElement | null,
  src: HTMLCanvasElement | HTMLVideoElement | null | undefined,
  angleRad = 0,
) {
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  // Decide drawability *before* clearing. At 1x/2x the sync layer pauses
  // each video and seeks per integer frame, briefly dropping readyState
  // below 2. If we cleared first and then bailed, the tile would flash
  // black every seek — visible as flicker. Skipping the clear keeps the
  // previous frame on the canvas until the next decode lands.
  if (!src) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    return;
  }
  const ok =
    src instanceof HTMLVideoElement
      ? src.readyState >= 2 && src.videoWidth > 0
      : src.width > 0 && src.height > 0;
  if (!ok) return;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  if (angleRad) {
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(angleRad);
    ctx.translate(-c.width / 2, -c.height / 2);
  }
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const srcAspect = sw / sh;
  const tileAspect = c.width / c.height;
  let dx = 0,
    dy = 0,
    dw = c.width,
    dh = c.height;
  if (srcAspect > tileAspect) {
    dw = c.height * srcAspect;
    dx = (c.width - dw) / 2;
  } else {
    dh = c.width / srcAspect;
    dy = (c.height - dh) / 2;
  }
  ctx.drawImage(src, dx, dy, dw, dh);
  ctx.restore();
}

function Tile({
  bind,
  size,
}: {
  bind: (el: HTMLCanvasElement | null) => void;
  size: number;
}) {
  return (
    <canvas
      ref={bind}
      width={size * 2}
      height={size * 2}
      style={{
        display: 'block',
        width: size,
        height: size,
        background: '#000',
        border: '1px solid var(--line-2)',
      }}
    />
  );
}

function ColHeader({
  label,
  eye,
  tile,
}: {
  label: string;
  eye?: 'L' | 'R';
  tile: number;
}) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: '0.18em',
        opacity: 0.7,
        textAlign: 'center',
        width: tile,
      }}
    >
      {label}
      {eye && (
        <span style={{ opacity: 0.6, letterSpacing: 0, marginLeft: 4 }}>
          ({eye})
        </span>
      )}
    </div>
  );
}

function RowLabel({ label, labelW }: { label: string; labelW: number }) {
  return (
    <div
      style={{
        width: labelW,
        fontSize: 10,
        letterSpacing: '0.18em',
        opacity: 0.55,
        textAlign: 'right',
        paddingRight: 8,
        alignSelf: 'center',
      }}
    >
      {label}
    </div>
  );
}

interface GridSizing {
  tile: number;
  labelW: number;
  gap: number;
}

function PerspectiveGrid({
  refs,
  prefix,
  sizing,
}: {
  refs: { current: Record<string, HTMLCanvasElement | null> };
  prefix: 'lh' | 'es';
  sizing: GridSizing;
}) {
  const bind = (k: string) => (el: HTMLCanvasElement | null) => {
    refs.current[`${prefix}-${k}`] = el;
  };
  const { tile, labelW, gap } = sizing;
  // Match EyeOverlay's L/R assignment: flipHead flips which station feeds
  // which eye (Boston=L by default; Boston=R when head is flipped).
  const flipped = flipHead.value;
  const bostonEye: 'L' | 'R' = flipped ? 'R' : 'L';
  const santiagoEye: 'L' | 'R' = flipped ? 'L' : 'R';
  return (
    <div
      style={{
        padding: '8px 10px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap,
      }}
    >
      <div style={{ display: 'flex', gap, paddingLeft: labelW }}>
        <ColHeader label='BOSTON' eye={bostonEye} tile={tile} />
        <ColHeader label='SANTIAGO' eye={santiagoEye} tile={tile} />
      </div>
      <div style={{ display: 'flex', gap }}>
        <RowLabel label='SIM' labelW={labelW} />
        <Tile bind={bind('sim-b')} size={tile} />
        <Tile bind={bind('sim-s')} size={tile} />
      </div>
      <div style={{ display: 'flex', gap }}>
        <RowLabel label='VIDEO' labelW={labelW} />
        <Tile bind={bind('vid-b')} size={tile} />
        <Tile bind={bind('vid-s')} size={tile} />
      </div>
    </div>
  );
}

// One perspective window rendered as a horizontal 1×4 row of labeled tiles.
// Order: SIM-B, SIM-S, VIDEO-B, VIDEO-S. Labels sit above each tile.
function MobileRow({
  refs,
  prefix,
  tile,
}: {
  refs: { current: Record<string, HTMLCanvasElement | null> };
  prefix: 'lh' | 'es';
  tile: number;
}) {
  const cells = [
    { k: 'sim-b', label: 'SIM·B' },
    { k: 'sim-s', label: 'SIM·S' },
    { k: 'vid-b', label: 'VID·B' },
    { k: 'vid-s', label: 'VID·S' },
  ];
  const bind = (k: string) => (el: HTMLCanvasElement | null) => {
    refs.current[`${prefix}-${k}`] = el;
  };
  return (
    <div
      style={{
        padding: '8px 10px 10px',
        display: 'flex',
        gap: MOBILE_ROW_GAP,
        justifyContent: 'center',
      }}
    >
      {cells.map((c) => (
        <div
          key={c.k}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.14em',
              opacity: 0.6,
            }}
          >
            {c.label}
          </div>
          <Tile bind={bind(c.k)} size={tile} />
        </div>
      ))}
    </div>
  );
}

// Bullet-time-style mobile bottom sheet. Sits above the progress bar
// (progress 26 px + bottom bar 40 px = bottom:66). Tab row below the active
// panel. Tap active tab to close; tap a different tab to swap.
function MobileBottomSheet({
  refs,
  tile,
}: {
  refs: { current: Record<string, HTMLCanvasElement | null> };
  tile: number;
}) {
  const openIndex = useSignal<number | null>(0);
  const tabs = [
    {
      key: 'lh',
      title: 'HORIZON',
      full: 'LOCAL HORIZON (BOSTON / SANTIAGO)' as const,
    },
    { key: 'es', title: 'STEREOSCOPY', full: 'EARTH STEREOSCOPY' as const },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 66, // above progress bar (26) + bottom bar (40)
        zIndex: 18,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      }}
    >
      {openIndex.value !== null && (
        <div
          style={{
            background: 'rgba(0,0,0,0.9)',
            borderTop: '1px solid var(--line)',
            overflowX: 'auto',
          }}
        >
          {/* STEREOSCOPY tab on narrow viewports loses the title suffix —
              surface the NORTH indicator inline instead so the info isn't
              lost on phones. */}
          {tabs[openIndex.value].key === 'es' && (
            <div
              style={{
                padding: '4px 10px 0',
                fontSize: 9,
                letterSpacing: '0.18em',
                opacity: 0.6,
              }}
            >
              NORTH = {flipHead.value ? 'RIGHT' : 'LEFT'}
            </div>
          )}
          <MobileRow
            refs={refs}
            prefix={tabs[openIndex.value].key as 'lh' | 'es'}
            tile={tile}
          />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {tabs.map((t, i) => {
          const active = openIndex.value === i;
          return (
            <button
              key={t.key}
              type='button'
              title={t.full}
              style={{
                height: 30,
                fontSize: 11,
                letterSpacing: '0.1em',
                background: active ? 'var(--accent-fill)' : 'rgba(0,0,0,0.85)',
                border: `1px solid ${active ? 'var(--text)' : 'var(--line)'}`,
                color: active ? 'var(--text)' : 'var(--text-2)',
                padding: '0 6px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onClick={() => {
                openIndex.value = openIndex.value === i ? null : i;
              }}
            >
              {t.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TelescopeGrid({
  scene,
  videos,
  getAngleRad,
  getCovers,
}: TelescopeGridProps) {
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const narrow = isNarrow.value;
  const desktopSizing: GridSizing = {
    tile: DESKTOP_TILE,
    labelW: DESKTOP_LABEL_W,
    gap: DESKTOP_GAP,
  };

  useEffect(() => {
    if (!showTelescopes.value) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = refs.current;
      const flip = flipHead.value ? Math.PI : 0;
      // Sim tiles need a live PIP canvas; skip if WebGL scene isn't up.
      if (scene) {
        drawTo(r['lh-sim-b'], scene.getPIPCanvas('boston', 'raw'), flip);
        drawTo(r['lh-sim-s'], scene.getPIPCanvas('santiago', 'raw'), flip);
        drawTo(r['es-sim-b'], scene.getPIPCanvas('boston', 'corrected'), flip);
        drawTo(
          r['es-sim-s'],
          scene.getPIPCanvas('santiago', 'corrected'),
          flip,
        );
      }
      const bCov = getCovers('boston');
      const sCov = getCovers('santiago');
      // While scrubbing, the video element is mid-seek and any frame it
      // holds is stale (and would be rotated by the *new* angle, looking
      // wrong). Show a LOADING placeholder until the seek settles. NO
      // SIGNAL still wins for out-of-coverage so the viewer can see the
      // coverage edges they're scrubbing past.
      const scrub = scrubbing.value;
      const bSrc: HTMLCanvasElement | HTMLVideoElement | null = !bCov
        ? getNoSignalCanvas(130)
        : scrub
          ? getLoadingCanvas(130)
          : videos.boston;
      const sSrc: HTMLCanvasElement | HTMLVideoElement | null = !sCov
        ? getNoSignalCanvas(130)
        : scrub
          ? getLoadingCanvas(130)
          : videos.santiago;
      // getAngleRad already includes the flip π (from main.tsx); LOCAL
      // HORIZON tiles add flip locally since they show the raw orientation.
      // LOADING/NO SIGNAL placeholders stay upright in every tile — rotating
      // the text 180° on flipHead is user-hostile, so placeholders use angle
      // 0 regardless of flipHead state.
      const bIsVideo = bCov && !scrub;
      const sIsVideo = sCov && !scrub;
      drawTo(r['lh-vid-b'], bSrc, bIsVideo ? flip : 0);
      drawTo(r['lh-vid-s'], sSrc, sIsVideo ? flip : 0);
      drawTo(r['es-vid-b'], bSrc, bIsVideo ? getAngleRad('boston') : 0);
      drawTo(r['es-vid-s'], sSrc, sIsVideo ? getAngleRad('santiago') : 0);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [scene, videos, getAngleRad, getCovers, showTelescopes.value]);

  if (!showTelescopes.value) return null;

  if (narrow) {
    return <MobileBottomSheet refs={refs} tile={MOBILE_TILE} />;
  }

  const stereoscopyTitle = `EARTH STEREOSCOPY (NORTH=${flipHead.value ? 'RIGHT' : 'LEFT'})`;
  return (
    <>
      <FloatingWindow
        title='LOCAL HORIZON (BOSTON / SANTIAGO)'
        anchor='left'
        vAnchor='bottom'
        x={14}
        y={80}
      >
        <PerspectiveGrid refs={refs} prefix='lh' sizing={desktopSizing} />
      </FloatingWindow>
      <FloatingWindow
        title={stereoscopyTitle}
        anchor='right'
        vAnchor='bottom'
        x={14}
        y={80}
      >
        <PerspectiveGrid refs={refs} prefix='es' sizing={desktopSizing} />
      </FloatingWindow>
    </>
  );
}
