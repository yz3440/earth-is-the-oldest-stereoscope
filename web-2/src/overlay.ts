// Per-eye DOM overlay — Option A "Instrumentation" four-corner layout.
// Left half of the viewport shows Boston-only info; right half shows
// Santiago-only. No shared/fused text — binocular rivalry is intentional.

import type { Weather } from './weather';

export interface EyeData {
  city: string;
  lat: number;
  lon: number;
  tzAbbrev: string;
  localTime: string;
  localDate: string;
  utcTime: string;
  videoTime: string;
  weather: Weather;
  phase: string;
  moonGlyph: string;
  eclipseBar: string;
}

export interface OverlayData {
  boston: EyeData;
  santiago: EyeData;
}

const HEMI_LAT = (lat: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
const HEMI_LON = (lon: number) => `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;

interface EyeEls {
  site: HTMLElement;
  coords: HTMLElement;
  time: HTMLElement;
  date: HTMLElement;
  tz: HTMLElement;
  wTemp: HTMLElement;
  wCond: HTMLElement;
  wHum: HTMLElement;
  wWind: HTMLElement;
  utc: HTMLElement;
  video: HTMLElement;
  phase: HTMLElement;
  moonGlyph: HTMLElement;
  eclipseBar: HTMLElement;
}

export class Overlay {
  private left: EyeEls;
  private right: EyeEls;

  constructor(parent: HTMLElement) {
    this.left = this.buildEye(parent, 'left');
    this.right = this.buildEye(parent, 'right');
  }

  private buildEye(parent: HTMLElement, side: 'left' | 'right'): EyeEls {
    const root = document.createElement('div');
    root.className = `eye eye-${side}`;
    parent.appendChild(root);

    const mk = (cls: string, parent: HTMLElement): HTMLElement => {
      const e = document.createElement('div');
      e.className = cls;
      parent.appendChild(e);
      return e;
    };

    const tl = mk('corner tl', root);
    const site = mk('site', tl);
    mk('rule', tl);
    const coords = mk('coords', tl);

    const tr = mk('corner tr', root);
    const time = mk('time', tr);
    const date = mk('date', tr);
    const tz = mk('tz', tr);

    const bl = mk('corner bl', root);
    const wTemp = mk('row', bl);
    const wCond = mk('row', bl);
    const wHum = mk('row', bl);
    const wWind = mk('row', bl);

    const br = mk('corner br', root);
    const utc = mk('row', br);
    const video = mk('row', br);
    const phase = mk('row phase', br);
    const eclipseBar = mk('row bar', br);

    // Moon-phase glyph floats near the UTC row as a one-character ornament.
    const moonGlyph = mk('glyph', br);

    return {
      site, coords, time, date, tz,
      wTemp, wCond, wHum, wWind,
      utc, video, phase, moonGlyph, eclipseBar,
    };
  }

  update(data: OverlayData) {
    this.writeEye(this.left, data.boston);
    this.writeEye(this.right, data.santiago);
  }

  private writeEye(els: EyeEls, d: EyeData) {
    els.site.textContent = d.city.toUpperCase();
    els.coords.textContent = `${HEMI_LAT(d.lat)}  ${HEMI_LON(d.lon)}`;
    els.time.textContent = d.localTime;
    els.tz.textContent = d.tzAbbrev;
    els.wTemp.textContent = kv('TEMP', d.weather.temp);
    els.wCond.textContent = kv('COND', d.weather.cond);
    els.wHum.textContent = kv('HUM', d.weather.humidity);
    els.wWind.textContent = kv('WIND', d.weather.wind);
    els.date.textContent = d.localDate;
    els.utc.textContent = d.utcTime;
    els.video.textContent = d.videoTime;
    els.phase.textContent = d.phase;
    els.moonGlyph.textContent = d.moonGlyph;
    els.eclipseBar.textContent = d.eclipseBar;
  }
}

function kv(k: string, v: string): string {
  return `${k.padEnd(5)} ${v}`;
}
