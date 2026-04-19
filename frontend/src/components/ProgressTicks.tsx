// Restrained tick-mark progress bar.
//
// Layers (bottom → top):
//   - base 1px track
//   - per-station coverage underlays (differentiated by vertical offset,
//     not color, to stay grayscale)
//   - minor ticks every 30 min
//   - event ticks at start/eclipse phases (taller, on hover show label)
//   - playhead (filled triangle)
//
// Click anywhere to seek. Drag the mouse along the bar to scrub.

import { currentTime, videosReady, scrubbing } from '../state';
import {
  SIM_START,
  SIM_END,
  BOSTON_VIDEO_START,
  SANTIAGO_VIDEO_START,
  ECLIPSE_PENUMBRAL_START,
  ECLIPSE_TOTALITY_START,
  ECLIPSE_TOTALITY_END,
  ECLIPSE_PENUMBRAL_END,
} from '../astronomy';
import type { Manifest } from '../manifest';
import { useRef, useState } from 'preact/hooks';

interface Event {
  t: number;
  label: string;  // full, shown in hover tooltip
  short: string;  // 3–7 char abbrev, shown always-on beneath the tick
}

const HEIGHT = 36;
const TICK_CENTER_Y = 16; // keeps ticks in the upper half so the always-
                          // on label row sits unambiguously below them

export function ProgressTicks({ manifest }: { manifest: Manifest | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const simStart = SIM_START.getTime();
  const simEnd = SIM_END.getTime();
  const span = simEnd - simStart;

  const pctOf = (ms: number) => ((ms - simStart) / span) * 100;
  const inRange = (ms: number) => ms >= simStart && ms <= simEnd;

  const events: Event[] = [
    { t: BOSTON_VIDEO_START.getTime(),     label: 'BOSTON START',    short: 'BOS'     },
    { t: SANTIAGO_VIDEO_START.getTime(),   label: 'SANTIAGO START',  short: 'SAN'     },
    { t: ECLIPSE_PENUMBRAL_START.getTime(),label: 'PENUMBRAL START', short: 'PEN'     },
    { t: ECLIPSE_TOTALITY_START.getTime(), label: 'TOTALITY START',  short: 'TOT'     },
    { t: ECLIPSE_TOTALITY_END.getTime(),   label: 'TOTALITY END',    short: 'TOT END' },
    { t: ECLIPSE_PENUMBRAL_END.getTime(),  label: 'PENUMBRAL END',   short: 'PEN END' },
  ].filter((e) => inRange(e.t));

  // Minor ticks every 30 minutes starting on the half-hour after SIM_START.
  const minorTicks: number[] = [];
  const startHalfMs = Math.ceil(simStart / (30 * 60_000)) * (30 * 60_000);
  for (let t = startHalfMs; t < simEnd; t += 30 * 60_000) minorTicks.push(t);

  const coverage = (side: 'boston' | 'santiago') => {
    if (!manifest) return null;
    const s = manifest[side];
    const n = s.frameRealTimesSec.length;
    if (n < 2) return null;
    const a = s.startUTC.getTime();
    const b = a + s.frameRealTimesSec[n - 1] * 1000;
    return { a: Math.max(a, simStart), b: Math.min(b, simEnd) };
  };
  const bostonCov = coverage('boston');
  const santiagoCov = coverage('santiago');

  const fmtHMS = (ms: number) => {
    const d = new Date(ms);
    return d.toISOString().slice(11, 16) + ' UTC';
  };

  const msFromClientX = (clientX: number): number => {
    if (!ref.current) return simStart;
    const r = ref.current.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return simStart + f * span;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!videosReady.value) return;
    setDragging(true);
    scrubbing.value = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    currentTime.value = msFromClientX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent) => {
    setHoverMs(msFromClientX(e.clientX));
    if (dragging) currentTime.value = msFromClientX(e.clientX);
  };
  const onPointerUp = (e: PointerEvent) => {
    setDragging(false);
    scrubbing.value = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };
  const onPointerLeave = () => setHoverMs(null);

  const playheadPct = pctOf(currentTime.value);

  // Nearest event to hover for label display
  const hoverLabel = (() => {
    if (hoverMs == null) return null;
    const PX_PER_MS = 0; // computed from bar width in px — tooltip reach in ms
    void PX_PER_MS;
    const tolerance = span * 0.015;
    const near = events.find((e) => Math.abs(e.t - hoverMs) < tolerance);
    return near ? near.label : fmtHMS(hoverMs);
  })();

  return (
    <div
      ref={ref}
      class="relative"
      style={{
        height: HEIGHT,
        cursor: videosReady.value ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {/* Base track */}
      <div
        class="absolute"
        style={{
          left: 0,
          right: 0,
          top: TICK_CENTER_Y - 0.5,
          height: 1,
          background: 'rgba(255,255,255,0.2)',
        }}
      />

      {/* Coverage underlays — boston above track, santiago below track */}
      {bostonCov && (
        <div
          class="absolute"
          title="Boston coverage"
          style={{
            left: `${pctOf(bostonCov.a)}%`,
            width: `${pctOf(bostonCov.b) - pctOf(bostonCov.a)}%`,
            top: TICK_CENTER_Y - 4,
            height: 2,
            background: 'rgba(255,255,255,0.4)',
          }}
        />
      )}
      {santiagoCov && (
        <div
          class="absolute"
          title="Santiago coverage"
          style={{
            left: `${pctOf(santiagoCov.a)}%`,
            width: `${pctOf(santiagoCov.b) - pctOf(santiagoCov.a)}%`,
            top: TICK_CENTER_Y + 2,
            height: 2,
            background: 'rgba(255,255,255,0.4)',
          }}
        />
      )}

      {/* Minor ticks */}
      {minorTicks.map((t) => (
        <div
          class="absolute"
          style={{
            left: `${pctOf(t)}%`,
            top: TICK_CENTER_Y - 2,
            width: 1,
            height: 4,
            background: 'rgba(255,255,255,0.18)',
          }}
        />
      ))}

      {/* Event ticks */}
      {events.map((e) => (
        <div
          key={`tk-${e.label}`}
          class="absolute pointer-events-none"
          style={{
            left: `${pctOf(e.t)}%`,
            top: TICK_CENTER_Y - 5,
            width: 1,
            height: 10,
            background: 'var(--text)',
            opacity: 0.75,
          }}
        />
      ))}

      {/* Always-on abbrev labels under each event tick */}
      {events.map((e) => (
        <div
          key={`lb-${e.label}`}
          class="absolute pointer-events-none"
          style={{
            left: `${pctOf(e.t)}%`,
            top: TICK_CENTER_Y + 8,
            transform: 'translateX(-50%)',
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--text-4)',
            whiteSpace: 'nowrap',
          }}
        >
          {e.short}
        </div>
      ))}

      {/* Playhead */}
      <div
        class="absolute pointer-events-none"
        style={{
          left: `${playheadPct}%`,
          top: TICK_CENTER_Y - 6,
          width: 0,
          height: 0,
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: '6px solid var(--text)',
          transform: 'translateX(-4px)',
        }}
      />
      <div
        class="absolute pointer-events-none"
        style={{
          left: `${playheadPct}%`,
          top: 0,
          height: HEIGHT,
          width: 1,
          background: 'rgba(255,255,255,0.5)',
        }}
      />

      {/* Hover tooltip — dimmer, underlined instead of boxed */}
      {hoverLabel && (
        <div
          class="absolute pointer-events-none"
          style={{
            left: `${pctOf(hoverMs!)}%`,
            bottom: HEIGHT + 2,
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.85)',
            borderBottom: '1px solid var(--line)',
            padding: '1px 5px',
            fontSize: 9,
            letterSpacing: '0.06em',
            color: 'var(--text-2)',
            whiteSpace: 'nowrap',
          }}
        >
          {hoverLabel}
        </div>
      )}
    </div>
  );
}
