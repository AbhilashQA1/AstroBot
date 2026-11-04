// Birth details in, kundali out.
//
// The whole calculation, in order: resolve the wall-clock birth time to a UTC
// instant, ask astronomy-engine for apparent geocentric longitudes in the true
// ecliptic of date, subtract the ayanamsa to get sidereal longitudes, derive the
// Lagna from sidereal time and latitude, and lay the bodies into whole-sign
// houses counted from the Lagna rashi.
//
// Two deliberate choices worth stating:
//
// Whole-sign houses. A North Indian chart is a rashi chart: the first square is
// the rising sign, and each later square is the next sign. There is no cusp
// calculation to get wrong and no house system to choose, which is why this app
// has never had a house-system setting.
//
// Mean lunar node. Rahu and Ketu are the Moon's nodes, and the classical texts
// work with the mean node. The true node oscillates about it by up to roughly
// 1.6 degrees, which can put Rahu in a different sign from the one every Indian
// ephemeris prints. Mean is the default; `trueNode` is offered for those who
// want to match software configured the other way.

import * as Astronomy from '../../vendor/astronomy.js';
import { DEFAULT_AYANAMSA, ayanamsa, norm360 } from './ayanamsa.js';
import { ascendant, localSiderealDegrees, midheaven, trueObliquity } from './ascendant.js';
import { formatOffset, julianDayUT, makeUtc, zonedWallTimeToUtc } from './time.js';

const J2000 = 2451545.0;

/** AstroBot body keys to astronomy-engine bodies. The nodes are computed here. */
const BODIES = {
  su: Astronomy.Body.Sun,
  mo: Astronomy.Body.Moon,
  ma: Astronomy.Body.Mars,
  me: Astronomy.Body.Mercury,
  ju: Astronomy.Body.Jupiter,
  ve: Astronomy.Body.Venus,
  sa: Astronomy.Body.Saturn,
  ur: Astronomy.Body.Uranus,
  ne: Astronomy.Body.Neptune,
  pl: Astronomy.Body.Pluto,
};

/** Bodies whose retrogression is a fact of geometry rather than a computation. */
const NEVER_RETROGRADE = new Set(['su', 'mo']);
const ALWAYS_RETROGRADE = new Set(['ra', 'ke']);

/**
 * Apparent geocentric ecliptic longitude of date, in degrees.
 * The Moon has its own routine; everything else goes through a geocentric vector.
 */
function tropicalLongitude(key, time) {
  if (key === 'mo') return norm360(Astronomy.EclipticGeoMoon(time).lon);
  const vector = Astronomy.GeoVector(BODIES[key], time, true);
  return norm360(Astronomy.Ecliptic(vector).elon);
}

/**
 * Mean longitude of the Moon's ascending node, in degrees (Meeus 47.7).
 * This is Rahu; Ketu sits opposite.
 */
export function meanNode(jdTT) {
  const T = (jdTT - J2000) / 36525;
  return norm360(
    125.0445479 -
      1934.1362891 * T +
      0.0020754 * T * T +
      T ** 3 / 467441 -
      T ** 4 / 60616000,
  );
}

/** True node, from the engine's own lunar node search. */
function trueNodeLongitude(time) {
  // The engine finds node crossing times; the node's longitude at an arbitrary
  // instant is the Moon's longitude at the nearest ascending crossing.
  const node = Astronomy.SearchMoonNode(time.AddDays(-20));
  let current = node;
  while (current.time.tt < time.tt) {
    const next = Astronomy.NextMoonNode(current);
    if (next.time.tt > time.tt) break;
    current = next;
  }
  const at = current.kind === Astronomy.NodeEventKind.Ascending ? current : Astronomy.NextMoonNode(current);
  return norm360(Astronomy.EclipticGeoMoon(at.time).lon);
}

/** Is the body's longitude decreasing? Measured across six hours either side. */
function isRetrograde(key, time) {
  if (NEVER_RETROGRADE.has(key)) return false;
  if (ALWAYS_RETROGRADE.has(key)) return true;
  const before = tropicalLongitude(key, time.AddDays(-0.25));
  const after = tropicalLongitude(key, time.AddDays(0.25));
  let delta = after - before;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta < 0;
}

export function rashiOf(siderealLon) {
  return Math.floor(norm360(siderealLon) / 30) + 1;
}

function houseFromLagna(rashi, lagnaRashi) {
  return ((rashi - lagnaRashi + 12) % 12) + 1;
}

/**
 * Compute a kundali.
 *
 * @param {object} birth
 * @param {number} birth.year
 * @param {number} birth.month        1-12
 * @param {number} birth.day
 * @param {number} birth.hour         0-23, local wall clock
 * @param {number} birth.minute
 * @param {number} [birth.second]
 * @param {number} birth.latitude     degrees, north positive
 * @param {number} birth.longitude    degrees, east positive
 * @param {string} birth.zone         IANA zone, e.g. "Asia/Kolkata"
 * @param {number} [birth.offsetMinutes] explicit UTC offset, overriding the zone
 * @param {string} [birth.ayanamsa]
 * @param {boolean} [birth.trueNode]
 */
export function computeKundali(birth) {
  const {
    year, month, day, hour, minute, second = 0,
    latitude, longitude, zone,
    ayanamsa: school = DEFAULT_AYANAMSA,
    trueNode = false,
  } = birth;

  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) throw new Error('latitude must be between -90 and 90');
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('longitude must be between -180 and 180');
  if (Math.abs(latitude) > 66.5) {
    // Not refused: the ascendant is still defined, but whole signs can rise and
    // set so fast that a minute of birth time moves the Lagna by a whole sign.
    // The caller is told so it can warn rather than present false precision.
  }

  // An explicit offset wins over the zone lookup. This matters for births before
  // a country adopted standard time: the IANA database carries one local mean
  // time per zone, taken from its reference city, so a birth in Ulm resolves to
  // Berlin's LMT and a birth in Delhi before 1906 resolves to Madras's. Where the
  // true local offset is known — a birth record, or a .jhd file — it is better
  // than anything derivable from the zone.
  const resolved = Number.isFinite(birth.offsetMinutes)
    ? {
      utcMs: makeUtc(year, month, day, hour, minute, second) - birth.offsetMinutes * 60000,
      offsetMinutes: birth.offsetMinutes,
      ambiguity: null,
    }
    : zonedWallTimeToUtc(year, month, day, hour, minute, second, zone);
  const { utcMs, offsetMinutes, ambiguity } = resolved;
  const date = new Date(utcMs);
  const time = Astronomy.MakeTime(date);
  const jdTT = J2000 + time.tt;
  const jdUT = julianDayUT(utcMs);

  const ayan = ayanamsa(jdTT, school);
  const obliquity = trueObliquity(jdTT);
  const gast = Astronomy.SiderealTime(time);
  const lst = localSiderealDegrees(gast, longitude);

  const ascTropical = ascendant(lst, latitude, obliquity);
  const ascSidereal = norm360(ascTropical - ayan);
  const lagnaRashi = rashiOf(ascSidereal);

  const mcTropical = midheaven(lst, obliquity);

  const bodies = {};
  for (const key of Object.keys(BODIES)) {
    const tropical = tropicalLongitude(key, time);
    const sidereal = norm360(tropical - ayan);
    const rashi = rashiOf(sidereal);
    bodies[key] = {
      key,
      tropical,
      sidereal,
      rashi,
      house: houseFromLagna(rashi, lagnaRashi),
      degree: sidereal % 30,
      retro: isRetrograde(key, time),
    };
  }

  const rahuTropical = trueNode ? trueNodeLongitude(time) : meanNode(jdTT);
  for (const [key, lon] of [['ra', rahuTropical], ['ke', norm360(rahuTropical + 180)]]) {
    const sidereal = norm360(lon - ayan);
    const rashi = rashiOf(sidereal);
    bodies[key] = {
      key,
      tropical: norm360(lon),
      sidereal,
      rashi,
      house: houseFromLagna(rashi, lagnaRashi),
      degree: sidereal % 30,
      retro: true,
    };
  }

  return {
    birth: { ...birth, utc: date.toISOString(), offset: formatOffset(offsetMinutes), ambiguity },
    jdUT,
    jdTT,
    ayanamsa: ayan,
    ayanamsaSchool: school,
    obliquity,
    siderealTime: lst,
    lagna: {
      tropical: ascTropical,
      sidereal: ascSidereal,
      rashi: lagnaRashi,
      degree: ascSidereal % 30,
    },
    midheaven: { tropical: mcTropical, sidereal: norm360(mcTropical - ayan) },
    bodies,
    warnings: [
      ambiguity,
      Math.abs(latitude) > 66.5
        ? 'above the polar circle the ascendant moves so fast that a minute of birth time can change the Lagna by a whole sign'
        : null,
    ].filter(Boolean),
  };
}

/**
 * Shape the result for the existing chart model: `{ lagna, placements }` with
 * `placements[key] = { house, retro, degree }`, which is exactly what
 * assets/js/model.js already reads.
 */
export function toChartPlacements(result) {
  const placements = {};
  for (const [key, body] of Object.entries(result.bodies)) {
    placements[key] = { house: body.house, retro: body.retro, degree: body.degree };
  }
  return { lagna: result.lagna.rashi, placements };
}
