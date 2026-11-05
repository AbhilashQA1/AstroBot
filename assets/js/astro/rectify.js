// Birth-time rectification from a known Lagna.
//
// The usual problem with an inherited horoscope is that it states the rising
// degree precisely and the birth time only roughly. The Lagna is the one thing
// in a chart that moves fast enough to run that backwards: it crosses the whole
// zodiac in a sidereal day, so a stated rising degree fixes the birth time to a
// few minutes, and every other degree then follows from the ephemeris.
//
// No other body is any use as an anchor. Measured at Pune on 2 April 1990, one
// degree of movement costs:
//
//   Lagna       3.2 minutes      Mars         1.3 days
//   Moon        1.7 hours        Jupiter      9 days
//   Mercury     13 hours         Saturn       19 days
//   Sun         1 day
//
// So "Saturn was at 12 degrees" constrains the birth time to within about three
// weeks and is worth nothing here, while the Lagna is worth a great deal. That
// asymmetry is the whole reason this module only solves for the Lagna.
//
// Deliberately cheap: the ascendant depends on sidereal time, latitude and the
// obliquity, and none of those touch the planetary ephemeris. Evaluating it is a
// fraction of the cost of a whole kundali, which is what makes a few hundred
// evaluations per search acceptable in a phone browser.

import * as Astronomy from '../../vendor/astronomy.js';
import { DEFAULT_AYANAMSA, ayanamsa, norm360 } from './ayanamsa.js';
import { ascendant, localSiderealDegrees, trueObliquity } from './ascendant.js';
import { makeUtc, zonedWallTimeToUtc } from './time.js';

const J2000 = 2451545.0;
const MINUTE = 60000;

/**
 * Signed difference a - b, wrapped into [-180, 180).
 * Used so that "before the target" and "after it" are a matter of sign, which
 * is what lets the search bracket a crossing.
 */
export function signedDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/**
 * Sidereal longitude of the Lagna at a UTC instant.
 *
 * @param {number} utcMs
 * @param {object} place  { latitude, longitude, ayanamsa? }
 */
export function lagnaAt(utcMs, { latitude, longitude, ayanamsa: school = DEFAULT_AYANAMSA }) {
  const time = Astronomy.MakeTime(new Date(utcMs));
  const jdTT = J2000 + time.tt;
  const obliquity = trueObliquity(jdTT);
  const lst = localSiderealDegrees(Astronomy.SiderealTime(time), longitude);
  return norm360(ascendant(lst, latitude, obliquity) - ayanamsa(jdTT, school));
}

/** Sidereal longitude from a rashi (1-12) and a degree within it (0 to under 30). */
export function targetFromRashi(rashi, degree) {
  if (!Number.isInteger(rashi) || rashi < 1 || rashi > 12) {
    throw new Error('rashi must be a whole number from 1 to 12');
  }
  if (!Number.isFinite(degree) || degree < 0 || degree >= 30) {
    throw new Error('degree must be at least 0 and less than 30');
  }
  return norm360((rashi - 1) * 30 + degree);
}

/** How fast the Lagna is moving, in degrees per minute, around an instant. */
export function lagnaRate(utcMs, place) {
  const before = lagnaAt(utcMs - 30000, place);
  const after = lagnaAt(utcMs + 30000, place);
  return Math.abs(signedDelta(after, before));
}

/** The stated birth moment as a UTC instant, by the same rules computeKundali uses. */
function statedUtcMs(birth) {
  const { year, month, day, hour, minute, second = 0, zone } = birth;
  if (Number.isFinite(birth.offsetMinutes)) {
    return makeUtc(year, month, day, hour, minute, second) - birth.offsetMinutes * MINUTE;
  }
  return zonedWallTimeToUtc(year, month, day, hour, minute, second, zone).utcMs;
}

/**
 * Find the birth time whose Lagna sits on `targetSidereal`.
 *
 * The ascendant advances monotonically through the zodiac, once per sidereal
 * day, so a given degree rises exactly once in any 23h56m. A 24-hour window can
 * therefore hold two crossings; both are returned, nearest to the stated time
 * first, because choosing silently between them would hide a real ambiguity.
 *
 * @param {object} birth    the computeKundali birth shape
 * @param {number} targetSidereal  0 to under 360
 * @param {object} [options]
 * @param {number} [options.windowMinutes=720]  how far either side of the stated time to look
 * @param {number} [options.stepMinutes=4]      coarse scan step
 * @returns {object} { ok, solutions, reason? }
 */
export function solveLagna(birth, targetSidereal, options = {}) {
  const { windowMinutes = 720, stepMinutes = 4 } = options;

  if (!Number.isFinite(targetSidereal)) {
    return { ok: false, reason: 'the target Lagna is not a number' };
  }
  if (!Number.isFinite(birth.latitude) || Math.abs(birth.latitude) > 90) {
    return { ok: false, reason: 'latitude must be between -90 and 90' };
  }

  const place = { latitude: birth.latitude, longitude: birth.longitude, ayanamsa: birth.ayanamsa };
  const target = norm360(targetSidereal);
  const stated = statedUtcMs(birth);
  const from = stated - windowMinutes * MINUTE;
  const to = stated + windowMinutes * MINUTE;
  const step = stepMinutes * MINUTE;

  // Coarse scan for brackets. The ascendant is monotonic in time, so a crossing
  // shows up as the signed difference going from negative to positive. The jump
  // from +180 back to -180 is the wrap-around, not a crossing, and is excluded
  // by requiring the step to be small - which it is for any real latitude,
  // since the Lagna would have to cover half the zodiac in four minutes.
  const brackets = [];
  let prevT = from;
  let prevF = signedDelta(lagnaAt(prevT, place), target);
  for (let t = from + step; t <= to; t += step) {
    const f = signedDelta(lagnaAt(t, place), target);
    if (prevF <= 0 && f > 0 && f - prevF < 180) brackets.push([prevT, t]);
    prevT = t;
    prevF = f;
  }

  if (!brackets.length) {
    return {
      ok: false,
      reason: `the Lagna does not reach ${target.toFixed(2)}° within `
        + `${Math.round(windowMinutes / 60)} hours either side of the stated time`,
    };
  }

  const solutions = brackets.map(([lo, hi]) => {
    // Bisection rather than a Newton step: the derivative is well behaved in the
    // middle of a sign and badly behaved near the horizon's extremes at high
    // latitude, and bisection does not care. Twenty halvings of four minutes
    // reach a quarter of a millisecond, so stopping at one second is generous.
    let a = lo;
    let b = hi;
    while (b - a > 1000) {
      const mid = a + (b - a) / 2;
      if (signedDelta(lagnaAt(mid, place), target) > 0) b = mid;
      else a = mid;
    }
    const exact = a + (b - a) / 2;

    // The app records birth times to the minute, so the usable answer is the
    // nearest minute to the exact instant. Reporting what that minute actually
    // gives, rather than the target that was asked for, is the difference
    // between rectification and false precision.
    const shiftMinutes = Math.round((exact - stated) / MINUTE);
    const atMinute = stated + shiftMinutes * MINUTE;
    const lagna = lagnaAt(atMinute, place);

    return {
      shiftMinutes,
      exactUtcMs: exact,
      exactShiftSeconds: Math.round((exact - stated) / 1000),
      lagna,
      residual: signedDelta(lagna, target),
      rate: lagnaRate(atMinute, place),
    };
  });

  solutions.sort((x, y) => Math.abs(x.shiftMinutes) - Math.abs(y.shiftMinutes));
  return { ok: true, target, solutions, best: solutions[0] };
}
