// Observed ASOS/METAR weather at each capture site during the eclipse window.
// Boston  = KBOS Logan        (reports :54 past each hour)
// Santiago = SCEL Pudahuel    (reports on the hour)
// Source: Iowa Environmental Mesonet ASOS archive, 2026-03-02 / 03.
//
// Temperature, humidity, and wind speed are linearly interpolated between
// bracketing hourly observations so the HUD ticks smoothly as sim time
// advances. Sky condition and wind direction stay step-held — those are
// categorical measurements where blending would lie.

import type { Side } from './manifest';

export interface Weather {
  temp: string;
  cond: string;
  humidity: string;
  wind: string;
}

interface HourlyObs {
  utc: number;
  tempF: number;
  cond: string;
  humPct: number;
  windKt: number;
  windDeg: number | null;
}

const EMPTY: Weather = { temp: '--', cond: '--', humidity: '--', wind: '--' };

const CARDINAL_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function cardinal(deg: number): string {
  return CARDINAL_8[Math.round(((deg % 360) + 360) / 45) % 8];
}

function windStr(kt: number, deg: number | null): string {
  const mph = Math.round(kt * 1.15078);
  if (mph === 0) return 'CALM';
  if (deg == null) return `${mph} MPH`;
  return `${mph} MPH ${cardinal(deg)}`;
}

function obs(utc: number, tempF: number, cond: string, windKt: number, windDeg: number | null, humPct: number): HourlyObs {
  return { utc, tempF, cond, humPct, windKt, windDeg };
}

// Note: Date.UTC month is 0-based → March = 2.
const OBS: Record<Side, HourlyObs[]> = {
  boston: [
    obs(Date.UTC(2026, 2, 2, 21, 54), 25, 'FEW',   11, 110, 44),
    obs(Date.UTC(2026, 2, 2, 22, 54), 25, 'FEW',   10, 140, 46),
    obs(Date.UTC(2026, 2, 2, 23, 54), 24, 'CLEAR', 12, 150, 50),
    obs(Date.UTC(2026, 2, 3,  0, 54), 23, 'CLEAR',  9, 180, 50),
    obs(Date.UTC(2026, 2, 3,  1, 54), 23, 'CLEAR', 12, 200, 48),
    obs(Date.UTC(2026, 2, 3,  2, 54), 22, 'CLEAR', 11, 220, 52),
    obs(Date.UTC(2026, 2, 3,  3, 54), 22, 'CLEAR',  6, 210, 50),
    obs(Date.UTC(2026, 2, 3,  4, 54), 22, 'CLEAR',  9, 220, 50),
    obs(Date.UTC(2026, 2, 3,  5, 54), 22, 'CLEAR',  9, 230, 52),
    obs(Date.UTC(2026, 2, 3,  6, 54), 21, 'CLEAR',  8, 220, 57),
    obs(Date.UTC(2026, 2, 3,  7, 54), 20, 'CLEAR',  5, 210, 56),
    obs(Date.UTC(2026, 2, 3,  8, 54), 20, 'CLEAR',  7, 210, 59),
    obs(Date.UTC(2026, 2, 3,  9, 54), 20, 'CLEAR',  4, 220, 62),
    obs(Date.UTC(2026, 2, 3, 10, 54), 20, 'FEW',    4, 180, 68),
  ],
  santiago: [
    obs(Date.UTC(2026, 2, 3,  0, 0), 72, 'SCATTERED', 16, 200, 57),
    obs(Date.UTC(2026, 2, 3,  1, 0), 70, 'SCATTERED', 12, 180, 60),
    obs(Date.UTC(2026, 2, 3,  2, 0), 68, 'FEW',        9, 200, 60),
    obs(Date.UTC(2026, 2, 3,  3, 0), 68, 'FEW',        8, 190, 60),
    obs(Date.UTC(2026, 2, 3,  4, 0), 66, 'BROKEN',     7, 150, 68),
    obs(Date.UTC(2026, 2, 3,  5, 0), 66, 'SCATTERED',  7, 170, 64),
    obs(Date.UTC(2026, 2, 3,  6, 0), 63, 'SCATTERED',  5, 150, 72),
    obs(Date.UTC(2026, 2, 3,  7, 0), 63, 'FEW',        3, 170, 77),
    obs(Date.UTC(2026, 2, 3,  8, 0), 63, 'FEW',        4, 150, 72),
    obs(Date.UTC(2026, 2, 3,  9, 0), 61, 'FEW',        0, null, 77),
    obs(Date.UTC(2026, 2, 3, 10, 0), 61, 'CLEAR',      2, null, 77),
  ],
};

function format(step: HourlyObs, tempF: number, humPct: number, windKt: number): Weather {
  return {
    temp: `${Math.round(tempF)}°F`,
    cond: step.cond,
    humidity: `${Math.round(humPct)}%`,
    wind: windStr(windKt, step.windDeg),
  };
}

const lerp = (a: number, b: number, a01: number) => a + (b - a) * a01;

export function weatherFor(side: Side, whenUTC: Date): Weather {
  const table = OBS[side];
  if (table.length === 0) return EMPTY;
  const t = whenUTC.getTime();

  // Scan to bracket [lo, hi] of the current instant.
  let i = 0;
  while (i < table.length && table[i].utc <= t) i++;
  if (i === 0) {
    const o = table[0];
    return format(o, o.tempF, o.humPct, o.windKt);
  }
  if (i >= table.length) {
    const o = table[table.length - 1];
    return format(o, o.tempF, o.humPct, o.windKt);
  }
  const lo = table[i - 1];
  const hi = table[i];
  const alpha = (t - lo.utc) / (hi.utc - lo.utc);
  const tempF  = lerp(lo.tempF,  hi.tempF,  alpha);
  const humPct = lerp(lo.humPct, hi.humPct, alpha);
  const windKt = lerp(lo.windKt, hi.windKt, alpha);
  // Categorical fields (cond, windDeg) come from the current hour's bracket start.
  return format(lo, tempF, humPct, windKt);
}
