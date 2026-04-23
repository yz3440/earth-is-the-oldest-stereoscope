// Per-eye instrumentation. Outer-edge text only: left eye's text hugs the
// far-left quarter of the viewport, right eye's the far-right quarter.
// When viewed through stereo glasses, text lives in each eye's peripheral
// vision with no binocular rivalry over the fused moon image.
//
// For TB layouts, the split flips to vertical: top eye (by convention the
// left eye) gets the top quarter; bottom eye gets the bottom quarter.

import { computed } from '@preact/signals';
import { layout, isNarrow, isCompact, flipHead, showEyeTop, showEyeBottom } from '../state';
import type { EclipseData } from '../astronomy';
import type { Weather } from '../weather';

export interface EyeData {
  city: string;
  region: string;
  lat: number;
  lon: number;
  tzAbbrev: string;
  localTime: string;
  localDate: string;
  utcTime: string;
  videoTime: string;
  weather: Weather;
  phase: string;
  eclipseBar: string;
}

const HEMI_LAT = (lat: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
const HEMI_LON = (lon: number) => `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;

function kv(k: string, v: string) {
  return `${k.padEnd(5)} ${v}`;
}

function formatPhase(e: EclipseData): string {
  if (e.phase === 'none') return '';
  if (e.phase === 'total') return 'TOTALITY';
  const pct = (e.phase === 'penumbral' ? e.penumbralImmersion : e.umbralImmersion) * 100;
  return `${e.phase.toUpperCase()} ${pct.toFixed(1)}%`;
}

function Eye({ data, which }: { data: EyeData; which: 'top' | 'bottom' | 'left' | 'right' }) {
  // Outer-edge positioning. On wide viewports each eye gets a quarter; on
  // narrow (phone-portrait) we grow to ~40vw so BOSTON / 20:33:33 don't
  // truncate, and shrink fonts + padding to keep it breathable.
  const narrow = isNarrow.value;
  const compact = isCompact.value;

  const widthVw = narrow ? 42 : (compact ? 32 : 25);
  const heightVh = narrow ? 42 : 50;

  const isHoriz = which === 'left' || which === 'right';
  const box: Record<string, string> = isHoriz
    ? {
        top: '0',
        bottom: '0',
        width: `${widthVw}vw`,
        ...(which === 'left' ? { left: '0' } : { right: '0' }),
      }
    : {
        left: '0',
        right: '0',
        height: `${heightVh}vh`,
        ...(which === 'top' ? { top: '0' } : { bottom: '0' }),
      };
  const align = which === 'right' ? 'right' : 'left';

  const pad = narrow ? 10 : 18;
  const padBottomBar = 80; // progress 26 + bottom bar 40 + breathing room
  // City / localTime shrink on narrow so "BOSTON" and "20:33:33" fit.
  const hFont = narrow ? 15 : 20;
  const bodyFont = narrow ? 10 : 11;

  return (
    <div
      class="absolute select-none pointer-events-none"
      style={{
        ...box,
        padding: `${pad}px`,
        paddingBottom: which === 'left' || which === 'right' || which === 'bottom' ? padBottomBar : pad,
        textAlign: align,
      }}
    >
      <div class="flex flex-col h-full justify-between">
        {/* Top block: city, coords, time, date, tz */}
        {showEyeTop.value ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: hFont, letterSpacing: '0.08em', lineHeight: 1 }}>
              {data.city.toUpperCase()}
            </div>
            <div style={{ fontSize: bodyFont, opacity: 0.6, marginTop: 2 }}>
              {data.region}
            </div>
            <div style={{ fontSize: bodyFont, opacity: 0.75, marginTop: 1 }}>
              {HEMI_LAT(data.lat)}  {HEMI_LON(data.lon)}
            </div>
            <div style={{ fontWeight: 700, fontSize: hFont, letterSpacing: '0.04em', marginTop: narrow ? 8 : 14 }}>
              {data.localTime}
            </div>
            <div style={{ fontSize: bodyFont, opacity: 0.75 }}>{data.localDate}</div>
            <div style={{ fontSize: bodyFont, opacity: 0.75 }}>{data.tzAbbrev}</div>
          </div>
        ) : <div />}

        {/* Bottom block: weather + UTC + phase */}
        {showEyeBottom.value ? (
          <div>
            <div style={{ fontSize: bodyFont, opacity: 0.85, whiteSpace: 'pre' }}>{kv('TEMP', data.weather.temp)}</div>
            <div style={{ fontSize: bodyFont, opacity: 0.85, whiteSpace: 'pre' }}>{kv('COND', data.weather.cond)}</div>
            <div style={{ fontSize: bodyFont, opacity: 0.85, whiteSpace: 'pre' }}>{kv('HUM ', data.weather.humidity)}</div>
            <div style={{ fontSize: bodyFont, opacity: 0.85, whiteSpace: 'pre' }}>{kv('WIND', data.weather.wind)}</div>
            <div style={{ height: 8 }} />
            <div style={{ fontSize: bodyFont, opacity: 0.85 }}>{data.utcTime}</div>
            <div style={{ fontSize: bodyFont, opacity: 0.85 }}>{data.videoTime}</div>
            {data.phase && (
              <>
                <div style={{ fontSize: bodyFont, opacity: 0.9, fontWeight: 700, letterSpacing: '0.08em', marginTop: 4 }}>
                  {data.phase}
                </div>
                <div style={{ fontSize: bodyFont, opacity: 0.8 }}>{data.eclipseBar}</div>
              </>
            )}
          </div>
        ) : <div />}
      </div>
    </div>
  );
}

// Determine which quarter each eye occupies based on current layout.
const eyeRegions = computed<{ left: 'left' | 'top'; right: 'right' | 'bottom' }>(() => {
  const l = layout.value;
  if (l === 'tb-half' || l === 'tb-full') {
    return { left: 'top', right: 'bottom' };
  }
  return { left: 'left', right: 'right' };
});

export function EyeOverlay({
  boston,
  santiago,
  formatEclipsePhase,
}: {
  boston: EyeData;
  santiago: EyeData;
  formatEclipsePhase?: (e: EclipseData) => string;
}) {
  const regions = eyeRegions.value;
  void formatPhase; // keep reference; actual phase text is already in data
  void formatEclipsePhase;
  // When flipHead is on, the stereo compositor swaps L/R textures, so
  // Boston video ends up on the user's right eye and vice versa. Swap
  // the data labels to match.
  const flipped = flipHead.value;
  const leftData  = flipped ? santiago : boston;
  const rightData = flipped ? boston   : santiago;
  return (
    <div class="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      <Eye data={leftData}  which={regions.left} />
      <Eye data={rightData} which={regions.right} />
    </div>
  );
}
