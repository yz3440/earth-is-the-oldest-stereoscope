// Intl-based wall-clock formatters for Boston (America/New_York) and
// Santiago (America/Santiago). Produces HH:MM:SS and YYYY-MM-DD components
// in the station's local zone, correctly handling DST.

import type { Side } from './manifest';

const TZ: Record<Side, string> = {
  boston: 'America/New_York',
  santiago: 'America/Santiago',
};

const timeFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeTimeFmt('America/New_York'),
  santiago: makeTimeFmt('America/Santiago'),
};

const dateFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeDateFmt('America/New_York'),
  santiago: makeDateFmt('America/Santiago'),
};

const tzFmt: Record<Side, Intl.DateTimeFormat> = {
  boston: makeTzFmt('America/New_York'),
  santiago: makeTzFmt('America/Santiago'),
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

function makeTzFmt(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
    year: 'numeric',
  });
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
  const parts = tzFmt[side].formatToParts(utc);
  const tz = parts.find((p) => p.type === 'timeZoneName');
  const raw = tz?.value ?? '';
  // Some ICU builds return e.g. "GMT-3" instead of "CLST"; normalize to "UTC-3".
  return raw.replace(/^GMT/i, 'UTC');
}
