// Ayanamsa: the angle between the tropical zero point (the vernal equinox, which
// drifts) and the sidereal zero point (fixed against the stars).
//
// Every sidereal longitude in AstroBot is a tropical longitude minus this angle,
// so an error here moves the whole chart at once. That makes it the single most
// consequential constant in the project, and the one most worth stating plainly.
//
// The sidereal frame is fixed by definition, so the ayanamsa grows at exactly the
// rate of general precession in longitude. That gives an exact formulation:
//
//     ayanamsa(t) = ayanamsa(J2000) + (accumulated precession from J2000 to t)
//
// rather than the linear "50.29 arcsec per year" approximation, which drifts by
// about an arcminute per century. Precession comes from the IAU 2006 p_A series.
//
// What differs between the schools below is only ayanamsa(J2000) - where each
// places the sidereal zero point. The rate is shared.

const J2000 = 2451545.0;
const DAYS_PER_CENTURY = 36525.0;

/**
 * IAU 2006 general precession in longitude, in arcseconds, accumulated from
 * J2000 to the given time. T is Julian centuries from J2000 (TT).
 */
function precessionArcsec(T) {
  return (
    5028.796195 * T +
    1.1054348 * T * T +
    0.00007964 * T ** 3 -
    0.000023857 * T ** 4 -
    0.0000000383 * T ** 5
  );
}

/**
 * The schools AstroBot supports.
 *
 * `j2000` is the ayanamsa at J2000.0 in degrees. `verified` records whether a
 * test in scripts/test-astro.mjs checks this school against published values.
 * Only Lahiri is: the other two are provided for comparison and are documented
 * as approximate rather than quietly presented as equals.
 */
export const AYANAMSAS = {
  lahiri: {
    key: 'lahiri',
    name: 'Lahiri (Chitrapaksha)',
    j2000: 23.853055555555557, // 23 deg 51' 11.0"
    verified: true,
    note:
      'The Indian government standard, adopted by the Calendar Reform Committee, ' +
      'and what nearly every Indian ephemeris and astrologer uses. Defined so that ' +
      'the star Chitra (Spica) sits near sidereal 180 degrees.',
  },
  raman: {
    key: 'raman',
    name: 'Raman',
    j2000: 22.411666666666665, // 22 deg 24' 42"
    verified: false,
    note:
      'B. V. Raman placed the zero point about 1 deg 26 arcmin before Lahiri. ' +
      'Offered for comparison; the constant has not been checked against a ' +
      'published Raman table, so treat it as approximate.',
  },
  kp: {
    key: 'kp',
    name: 'Krishnamurti (KP)',
    j2000: 23.756944444444443, // 23 deg 45' 25"
    verified: false,
    note:
      'The Krishnamurti Paddhati zero point, a few arcminutes before Lahiri. ' +
      'Offered for comparison; the constant has not been checked against a ' +
      'published KP table, so treat it as approximate.',
  },
};

export const DEFAULT_AYANAMSA = 'lahiri';

/**
 * Ayanamsa in degrees for a Julian Day (TT).
 *
 * @param {number} jdTT   Julian Day in Terrestrial Time
 * @param {string} school a key of AYANAMSAS
 */
export function ayanamsa(jdTT, school = DEFAULT_AYANAMSA) {
  const def = AYANAMSAS[school];
  if (!def) throw new Error(`unknown ayanamsa "${school}"`);
  const T = (jdTT - J2000) / DAYS_PER_CENTURY;
  return def.j2000 + precessionArcsec(T) / 3600;
}

/** Tropical longitude to sidereal, normalised to [0, 360). */
export function toSidereal(tropicalLon, jdTT, school = DEFAULT_AYANAMSA) {
  return norm360(tropicalLon - ayanamsa(jdTT, school));
}

/**
 * Normalise to [0, 360).
 *
 * The second modulo is not redundant. Writing this as `d < 0 ? d + 360 : d`
 * returns exactly 360 for a tiny negative input, because -1e-16 + 360 rounds to
 * 360 in floating point. A longitude of 360 would then give rashi 13, which does
 * not exist. Reducing a second time closes that.
 */
export function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Degrees as `12 deg 34' 56"`, for reports and tests. */
export function formatAngle(deg) {
  const d = Math.floor(deg);
  const mFloat = (deg - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${d}° ${String(m).padStart(2, '0')}' ${s.toFixed(1).padStart(4, '0')}"`;
}
