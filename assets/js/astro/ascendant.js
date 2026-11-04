// The ascendant (Lagna): the ecliptic degree rising on the eastern horizon.
//
// This is the highest-risk calculation in the project. A quadrant mistake in the
// arctangent does not produce an obviously broken number - it produces a chart
// that is wrong by six signs and looks entirely plausible. Everything else in a
// kundali is read from the Lagna, so the error would propagate silently through
// every house, every lordship and every yoga.
//
// Hence the explicit quadrant handling below, and the sanity checks in
// scripts/test-astro.mjs that assert the ascendant across all 24 hours and a
// range of latitudes.

import { norm360 } from './ayanamsa.js';

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const DAYS_PER_CENTURY = 36525.0;

const sin = (deg) => Math.sin(deg * DEG);
const cos = (deg) => Math.cos(deg * DEG);
const tan = (deg) => Math.tan(deg * DEG);

/**
 * Mean obliquity of the ecliptic in degrees (IAU 2006).
 * Accurate to well under an arcsecond over the range of any birth chart.
 */
export function meanObliquity(jdTT) {
  const T = (jdTT - J2000) / DAYS_PER_CENTURY;
  const arcsec =
    84381.406 -
    46.836769 * T -
    0.0001831 * T * T +
    0.0020034 * T ** 3 -
    0.000000576 * T ** 4 -
    0.0000000434 * T ** 5;
  return arcsec / 3600;
}

/**
 * Nutation in obliquity, in degrees. The four leading terms of the IAU series,
 * good to about 0.1 arcsec - far beyond what a rashi boundary cares about, but
 * included because the longitudes we compare against are in the true ecliptic of
 * date. Mixing a mean obliquity with true longitudes would be inconsistent.
 */
export function nutationInObliquity(jdTT) {
  const T = (jdTT - J2000) / DAYS_PER_CENTURY;
  const omega = 125.04452 - 1934.136261 * T; // mean longitude of the lunar node
  const L = 280.4665 + 36000.7698 * T; // mean longitude of the Sun
  const Lp = 218.3165 + 481267.8813 * T; // mean longitude of the Moon
  const arcsec =
    9.2 * cos(omega) + 0.57 * cos(2 * L) + 0.1 * cos(2 * Lp) - 0.09 * cos(2 * omega);
  return arcsec / 3600;
}

/** True obliquity of date, in degrees. */
export function trueObliquity(jdTT) {
  return meanObliquity(jdTT) + nutationInObliquity(jdTT);
}

/**
 * Tropical ascendant in degrees.
 *
 * @param {number} lstDeg   local apparent sidereal time in degrees (the RAMC)
 * @param {number} latitude geographic latitude in degrees, north positive
 * @param {number} obliquity true obliquity of date in degrees
 */
export function ascendant(lstDeg, latitude, obliquity) {
  // Asc = atan2( cos(RAMC), -(sin(RAMC) cos(e) + tan(phi) sin(e)) )
  //
  // Worked checks, both at the equator:
  //   RAMC   0 deg -> atan2(1, 0)       =  90 deg   (0 Aries on the meridian, Cancer rising)
  //   RAMC  90 deg -> atan2(0, -cos(e)) = 180 deg   (Libra rising)
  // Both agree with the geometry, which is what fixes the quadrant convention.
  const y = cos(lstDeg);
  const x = -(sin(lstDeg) * cos(obliquity) + tan(latitude) * sin(obliquity));
  return norm360(Math.atan2(y, x) / DEG);
}

/**
 * The tenth house cusp (Midheaven) in degrees. Not used for whole-sign houses,
 * but reported so a chart can be checked against other software, which almost
 * always prints it.
 */
export function midheaven(lstDeg, obliquity) {
  return norm360(Math.atan2(sin(lstDeg), cos(lstDeg) * cos(obliquity)) / DEG);
}

/**
 * Local apparent sidereal time in degrees.
 *
 * @param {number} gastHours Greenwich apparent sidereal time, in sidereal hours
 * @param {number} longitude geographic longitude in degrees, east positive
 */
export function localSiderealDegrees(gastHours, longitude) {
  return norm360(gastHours * 15 + longitude);
}
