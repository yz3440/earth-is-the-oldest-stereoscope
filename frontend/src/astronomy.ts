import {
  Body,
  GeoVector,
  MakeTime,
  Observer,
  Equator,
  Horizon,
  SiderealTime,
} from 'astronomy-engine';
import type { FlexibleDateTime } from 'astronomy-engine';

// --- Sites ---

export interface Site {
  name: string;
  lat: number;
  lon: number;
  observer: Observer;
}

export const BOSTON: Site = {
  name: 'Boston',
  lat: 42.36,
  lon: -71.06,
  observer: new Observer(42.36, -71.06, 0),
};

export const SANTIAGO: Site = {
  name: 'Santiago',
  lat: -33.45,
  lon: -70.66,
  observer: new Observer(-33.45, -70.66, 0),
};

// --- Time windows (UTC) ---

export const BOSTON_VIDEO_START = new Date('2026-03-02T22:41:00Z');   // 5:41 PM EST
export const SANTIAGO_VIDEO_START = new Date('2026-03-03T00:40:00Z'); // 9:40 PM CLT (UTC-3)
export const OVERLAP_START = new Date(Math.max(BOSTON_VIDEO_START.getTime(), SANTIAGO_VIDEO_START.getTime()));
// Eclipse times (computed from astronomy-engine, not hardcoded guesses)
export const ECLIPSE_PENUMBRAL_START = new Date('2026-03-03T09:00:00Z');
export const ECLIPSE_TOTALITY_START = new Date('2026-03-03T11:15:00Z');
export const ECLIPSE_TOTALITY_END = new Date('2026-03-03T12:00:00Z');
export const ECLIPSE_PENUMBRAL_END = new Date('2026-03-03T14:30:00Z');
export const SIM_START = new Date('2026-03-02T22:40:00Z');
export const SIM_END = new Date('2026-03-03T10:25:00Z');

// --- Vec3 math ---

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vecLength(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vecNormalize(v: Vec3): Vec3 {
  const len = vecLength(v);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// --- Constants ---

export const AU_TO_KM = 149597870.7;
export const EARTH_RADIUS_KM = 6371.0;
const MOON_RADIUS_KM = 1737.4;
const SUN_RADIUS_KM = 696000.0;
export const AU_TO_ER = AU_TO_KM / EARTH_RADIUS_KM; // ~23481
const R_EARTH_AU = EARTH_RADIUS_KM / AU_TO_KM;
const R_MOON_AU = MOON_RADIUS_KM / AU_TO_KM;
const R_SUN_AU = SUN_RADIUS_KM / AU_TO_KM;
const DEG = Math.PI / 180;

// --- Observer position in J2000 equatorial coordinates ---

/**
 * Compute observer's position in J2000 equatorial coordinates (AU).
 * Uses spherical Earth approximation + sidereal time for rotation.
 */
function observerJ2000(site: Site, time: FlexibleDateTime): Vec3 {
  const astroTime = MakeTime(time);
  const latRad = site.lat * DEG;
  const lonRad = site.lon * DEG;

  // ECEF position (spherical Earth, in AU)
  const R = EARTH_RADIUS_KM / AU_TO_KM;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const ecefX = R * cosLat * Math.cos(lonRad);
  const ecefY = R * cosLat * Math.sin(lonRad);
  const ecefZ = R * sinLat;

  // Rotate ECEF to equatorial by Greenwich Apparent Sidereal Time
  const gastHours = SiderealTime(astroTime);
  const gastRad = gastHours * 15 * DEG; // hours -> degrees -> radians

  return {
    x: ecefX * Math.cos(gastRad) - ecefY * Math.sin(gastRad),
    y: ecefX * Math.sin(gastRad) + ecefY * Math.cos(gastRad),
    z: ecefZ,
  };
}

// --- Moon alt/az ---

function moonAltAz(time: FlexibleDateTime, observer: Observer): { alt: number; az: number } {
  const eq = Equator(Body.Moon, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth };
}

// --- Gaze correction ---

/**
 * Compute rotation (degrees) to align stereo baseline horizontally in camera image.
 *
 * Camera model: tracking telescope leveled to local horizon.
 * - Gaze: toward moon
 * - Up in image: zenith component perpendicular to gaze
 * - Right in image: cross(gaze, up)
 *
 * We project the baseline (thisCamera -> otherCamera) onto the image plane
 * and return the angle from horizontal (the "right" direction).
 * This is the roll correction to apply to the video frame.
 */
function gazeCorrection(thisPos: Vec3, otherPos: Vec3, moonPos: Vec3): number {
  const gaze = vecNormalize(vecSub(moonPos, thisPos));
  const zenith = vecNormalize(thisPos); // from Earth center

  // Project zenith onto plane perpendicular to gaze
  const zenithPerp = vecSub(zenith, vecScale(gaze, vecDot(zenith, gaze)));
  const up = vecNormalize(zenithPerp);
  const right = vecCross(gaze, up);

  // Baseline: this camera -> other camera
  const baseline = vecSub(otherPos, thisPos);

  // Project baseline onto image plane
  const bProj = vecSub(baseline, vecScale(gaze, vecDot(baseline, gaze)));

  // Angle from "right" direction (positive = CCW from right toward up)
  return Math.atan2(vecDot(bProj, up), vecDot(bProj, right)) / DEG;
}

/**
 * Compute stereo roll angle using a shared baseline direction.
 * Same math as gazeCorrection but takes an explicit baseline vector so both
 * cameras use Boston→Santiago, producing a consistent stereo frame.
 */
function stereoCorrection(observerPos: Vec3, moonPos: Vec3, sharedBaseline: Vec3): number {
  const gaze = vecNormalize(vecSub(moonPos, observerPos));
  const zenith = vecNormalize(observerPos);

  const zenithPerp = vecSub(zenith, vecScale(gaze, vecDot(zenith, gaze)));
  const upRaw = vecNormalize(zenithPerp);
  const right = vecCross(gaze, upRaw);

  const bProj = vecSub(sharedBaseline, vecScale(gaze, vecDot(sharedBaseline, gaze)));

  return Math.atan2(vecDot(bProj, upRaw), vecDot(bProj, right)) / DEG;
}

function parallaxAngle(pos1: Vec3, pos2: Vec3, moonPos: Vec3): number {
  const g1 = vecNormalize(vecSub(moonPos, pos1));
  const g2 = vecNormalize(vecSub(moonPos, pos2));
  const cosA = Math.min(1, Math.max(-1, vecDot(g1, g2)));
  return Math.acos(cosA) / DEG;
}

// --- Eclipse geometry ---

export interface EclipseData {
  phase: 'none' | 'penumbral' | 'partial' | 'total';
  umbralImmersion: number;     // 0-1, fraction of Moon diameter inside umbra
  penumbralImmersion: number;  // 0-1, fraction of Moon diameter inside penumbra
  shadowSepER: number;         // Moon center distance from shadow axis, in Earth radii
  umbraRadiusER: number;       // umbra radius at Moon's distance, in Earth radii
  penumbraRadiusER: number;    // penumbra radius at Moon's distance, in Earth radii
  moonDistAlongAxis: number;   // Moon's distance along shadow axis from Earth center, in AU
}

/**
 * Compute lunar eclipse geometry analytically.
 *
 * Earth's shadow forms two concentric cones extending away from the Sun:
 * - Umbra: converges. Formed by internal tangent lines Sun-Earth. Apex at ~217 ER.
 *   At distance d from Earth: radius = R_earth - d * (R_sun - R_earth) / D_sun
 * - Penumbra: diverges. Formed by external tangent lines.
 *   At distance d from Earth: radius = R_earth + d * (R_sun + R_earth) / D_sun
 *
 * The Moon's eclipse state depends on how far its center is from the shadow axis
 * compared to the umbra/penumbra radii at the Moon's distance.
 */
function computeEclipse(moonPos: Vec3, sunPos: Vec3): EclipseData {
  const dSun = vecLength(sunPos); // Earth-Sun distance in AU

  // Shadow axis: from Earth center, away from Sun
  const antiSun = vecNormalize(vecScale(sunPos, -1));

  // Project Moon onto shadow axis
  const moonDistAlongAxis = vecDot(moonPos, antiSun); // positive = in shadow direction

  // Moon's perpendicular distance from shadow axis
  const moonOnAxis = vecScale(antiSun, moonDistAlongAxis);
  const moonPerp = vecSub(moonPos, moonOnAxis);
  const sepAU = vecLength(moonPerp); // separation in AU

  // If Moon is on the Sun-side of Earth, no eclipse possible
  if (moonDistAlongAxis <= 0) {
    return {
      phase: 'none', umbralImmersion: 0, penumbralImmersion: 0,
      shadowSepER: sepAU * AU_TO_ER, umbraRadiusER: 0, penumbraRadiusER: 0,
      moonDistAlongAxis,
    };
  }

  const d = moonDistAlongAxis; // distance along shadow axis

  // Cone radii at Moon's distance (in AU)
  const umbraR = R_EARTH_AU - d * (R_SUN_AU - R_EARTH_AU) / dSun;
  const penumbraR = R_EARTH_AU + d * (R_SUN_AU + R_EARTH_AU) / dSun;

  // Convert to Earth radii for display
  const sepER = sepAU / R_EARTH_AU;
  const umbraRadiusER = umbraR / R_EARTH_AU;
  const penumbraRadiusER = penumbraR / R_EARTH_AU;
  const moonR = R_MOON_AU;

  // Eclipse immersion (linear approximation based on overlap of Moon disk with shadow circle)
  let umbralImmersion = 0;
  let penumbralImmersion = 0;

  if (umbraR > 0) { // umbra still exists at this distance
    if (sepAU <= umbraR - moonR) {
      umbralImmersion = 1; // Moon fully inside umbra
    } else if (sepAU < umbraR + moonR) {
      umbralImmersion = (umbraR + moonR - sepAU) / (2 * moonR);
    }
  }

  if (sepAU <= penumbraR - moonR) {
    penumbralImmersion = 1;
  } else if (sepAU < penumbraR + moonR) {
    penumbralImmersion = (penumbraR + moonR - sepAU) / (2 * moonR);
  }

  let phase: EclipseData['phase'] = 'none';
  if (umbralImmersion >= 1) phase = 'total';
  else if (umbralImmersion > 0) phase = 'partial';
  else if (penumbralImmersion > 0) phase = 'penumbral';

  return {
    phase,
    umbralImmersion: Math.max(0, Math.min(1, umbralImmersion)),
    penumbralImmersion: Math.max(0, Math.min(1, penumbralImmersion)),
    shadowSepER: sepER,
    umbraRadiusER,
    penumbraRadiusER,
    moonDistAlongAxis,
  };
}

// --- Frame data ---

export interface FrameData {
  time: Date;
  utcString: string;
  moonPos: Vec3;      // J2000, AU
  sunPos: Vec3;       // J2000, AU
  bostonPos: Vec3;    // J2000, AU
  santiagoPos: Vec3;  // J2000, AU
  bostonAltAz: { alt: number; az: number };
  santiagoAltAz: { alt: number; az: number };
  bostonCorrection: number;   // degrees
  santiagoCorrection: number; // degrees
  parallax: number;           // degrees
  bostonVideoSec: number;     // seconds since Boston video start
  santiagoVideoSec: number;   // seconds since Santiago video start
  inOverlap: boolean;
  eclipse: EclipseData;
  gastRad: number;            // Greenwich Apparent Sidereal Time in radians
  bostonStereo: number;       // stereo roll using shared baseline (degrees)
  santiagoStereo: number;     // stereo roll using shared baseline (degrees)
}

export function computeFrame(date: Date): FrameData {
  const time = MakeTime(date);

  const moonVec = GeoVector(Body.Moon, time, true);
  const sunVec = GeoVector(Body.Sun, time, true);
  const moonPos: Vec3 = { x: moonVec.x, y: moonVec.y, z: moonVec.z };
  const sunPos: Vec3 = { x: sunVec.x, y: sunVec.y, z: sunVec.z };

  const bostonPos = observerJ2000(BOSTON, date);
  const santiagoPos = observerJ2000(SANTIAGO, date);

  const bostonAltAz = moonAltAz(date, BOSTON.observer);
  const santiagoAltAz = moonAltAz(date, SANTIAGO.observer);

  const bostonCorrection = gazeCorrection(bostonPos, santiagoPos, moonPos);
  const santiagoCorrection = gazeCorrection(santiagoPos, bostonPos, moonPos);
  const par = parallaxAngle(bostonPos, santiagoPos, moonPos);
  const eclipse = computeEclipse(moonPos, sunPos);

  // Stereo corrections using shared baseline (Boston→Santiago for both cameras)
  const sharedBaseline = vecSub(santiagoPos, bostonPos);
  const bostonStereo = stereoCorrection(bostonPos, moonPos, sharedBaseline);
  const santiagoStereo = stereoCorrection(santiagoPos, moonPos, sharedBaseline);

  const ms = date.getTime();
  const gastRad = SiderealTime(time) * 15 * DEG; // hours -> degrees -> radians

  return {
    time: date,
    utcString: date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    moonPos,
    sunPos,
    bostonPos,
    santiagoPos,
    bostonAltAz,
    santiagoAltAz,
    bostonCorrection,
    santiagoCorrection,
    parallax: par,
    bostonVideoSec: (ms - BOSTON_VIDEO_START.getTime()) / 1000,
    santiagoVideoSec: (ms - SANTIAGO_VIDEO_START.getTime()) / 1000,
    inOverlap: ms >= OVERLAP_START.getTime(),
    eclipse,
    gastRad,
    bostonStereo,
    santiagoStereo,
  };
}
