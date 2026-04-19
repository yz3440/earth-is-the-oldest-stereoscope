// Intl-based wall-clock formatters for Boston (America/New_York) and
// Santiago (America/Santiago). Produces HH:MM:SS and YYYY-MM-DD components
// in the station's local zone, correctly handling DST.

import type { Side } from './manifest';

const TZ: Record<Side, string> = {
  boston: 'America/New_York',
  santiago: 'America/Santiago',
};

// Per-station zone names. Intl's short timeZoneName is unreliable across
// engines (some return "GMT-3" for Santiago instead of "CLST"), so we pick
// the conventional long + short names ourselves based on the station's
// current DST state — detected by comparing the station's offset at `utc`
// to its standard (non-DST) offset.
const ZONE_NAMES: Record<Side, {
  longStd: string;
  longDst: string;
  shortStd: string;
  shortDst: string;
  standardOffsetMin: number;
}> = {
  boston: {
    longStd: 'Eastern Standard Time',
    longDst: 'Eastern Daylight Time',
    shortStd: 'EST',
    shortDst: 'EDT',
    standardOffsetMin: -300, // UTC-5
  },
  santiago: {
    longStd: 'Chile Standard Time',
    longDst: 'Chile Summer Time',
    shortStd: 'CLT',
    shortDst: 'CLST',
    standardOffsetMin: -240, // UTC-4
  },
};

const timeFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeTimeFmt('America/New_York'),
  santiago: makeTimeFmt('America/Santiago'),
};

const dateFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeDateFmt('America/New_York'),
  santiago: makeDateFmt('America/Santiago'),
};

const offsetFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeOffsetFmt('America/New_York'),
  santiago: makeOffsetFmt('America/Santiago'),
};

function makeTimeFmt(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function makeDateFmt(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function makeOffsetFmt(timeZone: string): Intl.DateTimeFormat {
  // `shortOffset` emits a stable "GMT±H[:MM]" across engines (ES2022).
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
  });
}

function zoneOffsetMin(side: Side, utc: Date): number {
  const parts = offsetFmt[side].formatToParts(utc);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = name.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const h = parseInt(m[2], 10);
  const min = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h * 60 + min);
}

export function localTime(side: Side, utc: Date): string {
  // Intl emits "24:…" at midnight on some engines; normalize to "00:…".
  return timeFmt[side].format(utc).replace(/^24/, '00');
}

export function localDate(side: Side, utc: Date): string {
  return dateFmt[side].format(utc);
}

export function tzName(side: Side): string {
  return TZ[side];
}

export function tzAbbrev(side: Side, utc: Date): string {
  const z = ZONE_NAMES[side];
  const dst = zoneOffsetMin(side, utc) !== z.standardOffsetMin;
  const long = dst ? z.longDst : z.longStd;
  const short = dst ? z.shortDst : z.shortStd;
  return `${long} (${short})`;
}
