// Hardcoded weather for each station at the time of filming. The user will
// fill these in with real observed values (e.g. temp, conditions, humidity,
// wind) once they have them. Until then these are placeholders that render
// as "--" in the overlay.

import type { Side } from './manifest';

export interface Weather {
  temp: string;    // e.g. "34°F" or "1°C"
  cond: string;    // e.g. "CLEAR", "THIN CIRRUS"
  humidity: string; // e.g. "68%"
  wind: string;    // e.g. "5 MPH NW"
}

const EMPTY: Weather = { temp: '--', cond: '--', humidity: '--', wind: '--' };

const WEATHER: Record<Side, Weather> = {
  boston: EMPTY,
  santiago: EMPTY,
};

export function weatherFor(side: Side): Weather {
  return WEATHER[side];
}
