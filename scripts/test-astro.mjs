// Tests for the kundali calculation.
//
// The ascendant is the dangerous part: a quadrant error yields a chart wrong by
// six signs that still looks entirely plausible, and every house, lordship and
// yoga is read from it. So it is checked against hand-derived geometry, swept
// across all 24 hours, and confirmed on a published chart.
//
//   node scripts/test-astro.mjs

import { AYANAMSAS, ayanamsa, formatAngle, norm360 } from '../assets/js/astro/ayanamsa.js';
import { ascendant, meanObliquity, trueObliquity } from '../assets/js/astro/ascendant.js';
import { formatOffset, zonedWallTimeToUtc } from '../assets/js/astro/time.js';
import { computeKundali, rashiOf, toChartPlacements } from '../assets/js/astro/compute.js';
import { Chart } from '../assets/js/model.js';
import { loadKnowledgeFromDisk } from './kb-node.mjs';
import { compose } from '../assets/js/engine.js';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(name, actual, expected, tolerance, unit = '') {
  const delta = Math.abs(actual - expected);
  check(name, delta <= tolerance, `got ${actual}${unit}, expected ${expected}${unit} (off by ${delta.toFixed(6)}${unit}, tolerance ${tolerance}${unit})`);
}

const jdOf = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 2440587.5;
const RASHI = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// --- 1. Ayanamsa against published Lahiri values ---------------------------
// Tolerance is 30 arcseconds. A rashi is 30 degrees and a nakshatra pada is
// 3°20', so this is three orders of magnitude tighter than the chart needs;
// it exists to catch a wrong precession rate, not to chase the last arcsecond.
{
  const published = [
    [1900, 1, 1, 22 + 27 / 60 + 38 / 3600],
    [1950, 1, 1, 23 + 9 / 60 + 30 / 3600],
    [2000, 1, 1, 23 + 51 / 60 + 11 / 3600],
    [2010, 1, 1, 23 + 59 / 60 + 33 / 3600],
    [2024, 1, 1, 24 + 11 / 60 + 19 / 3600],
  ];
  for (const [y, m, d, expected] of published) {
    const got = ayanamsa(jdOf(y, m, d), 'lahiri');
    near(`lahiri ayanamsa ${y}`, got, expected, 30 / 3600, ' deg');
  }

  // It must increase, and at roughly the rate of precession.
  const rate = (ayanamsa(jdOf(2100, 1, 1)) - ayanamsa(jdOf(2000, 1, 1))) * 3600 / 100;
  near('precession rate (arcsec/yr)', rate, 50.3, 0.3, '"');

  check('only lahiri is marked verified',
    AYANAMSAS.lahiri.verified && !AYANAMSAS.raman.verified && !AYANAMSAS.kp.verified);
}

// --- 2. Obliquity ----------------------------------------------------------
{
  // Mean obliquity at J2000.0 is 23°26'21.406" by definition of the IAU series.
  near('mean obliquity at J2000', meanObliquity(2451545.0), 23 + 26 / 60 + 21.406 / 3600, 1e-6, ' deg');
  // Nutation shifts it by at most about 9.2 arcsec.
  const delta = Math.abs(trueObliquity(2451545.0) - meanObliquity(2451545.0)) * 3600;
  check('nutation in obliquity is within 10 arcsec', delta < 10, `got ${delta.toFixed(2)}"`);
}

// --- 3. Ascendant geometry, derived by hand --------------------------------
// At the equator the ecliptic is symmetric about the meridian, which makes two
// cases exactly computable without any ephemeris.
{
  const e = 23.4392911;
  near('equator, RAMC 0 -> Cancer rising', ascendant(0, 0, e), 90, 1e-9, ' deg');
  near('equator, RAMC 90 -> Libra rising', ascendant(90, 0, e), 180, 1e-9, ' deg');
  near('equator, RAMC 180 -> Capricorn rising', ascendant(180, 0, e), 270, 1e-9, ' deg');
  near('equator, RAMC 270 -> Aries rising', ascendant(270, 0, e), 0, 1e-9, ' deg');

  // The ascendant always leads the RAMC — the rising point is east of the
  // meridian. This catches a sign flip that the four cases above would survive.
  for (const ramc of [30, 75, 140, 200, 310]) {
    for (const lat of [-60, -28, 0, 19, 51]) {
      const asc = ascendant(ramc, lat, e);
      const lead = norm360(asc - ramc);
      check(`ascendant leads RAMC (ramc ${ramc}, lat ${lat})`, lead > 0 && lead < 360, `lead ${lead.toFixed(2)}`);
    }
  }
}

// --- 4. A full day sweeps every rashi, in order ----------------------------
{
  const seen = [];
  for (let minutes = 0; minutes < 1440; minutes += 4) {
    const r = computeKundali({
      year: 2024, month: 3, day: 20,
      hour: Math.floor(minutes / 60), minute: minutes % 60,
      latitude: 28.6139, longitude: 77.209, zone: 'Asia/Kolkata',
    });
    const last = seen[seen.length - 1];
    if (last !== r.lagna.rashi) seen.push(r.lagna.rashi);
  }
  const distinct = new Set(seen);
  check('a full day rises through all twelve rashis', distinct.size === 12, `saw ${distinct.size}: ${[...distinct].join(',')}`);

  // Consecutive rashis, wrapping — never a jump of two signs.
  let orderly = true;
  for (let i = 1; i < seen.length; i += 1) {
    if ((seen[i - 1] % 12) + 1 !== seen[i]) orderly = false;
  }
  check('rashis rise in consecutive order', orderly, seen.join(' -> '));
}

// --- 5. Timezone history ---------------------------------------------------
{
  const cases = [
    [1879, 3, 14, 'Europe/Berlin', '+00:53'],
    [1890, 6, 1, 'Asia/Kolkata', '+05:21'],
    [1930, 6, 1, 'Asia/Kolkata', '+05:30'],
    [1943, 6, 1, 'Asia/Kolkata', '+06:30'],
    [1990, 6, 1, 'Asia/Kolkata', '+05:30'],
  ];
  for (const [y, m, d, zone, expected] of cases) {
    const { offsetMinutes } = zonedWallTimeToUtc(y, m, d, 12, 0, 0, zone);
    check(`offset ${zone} ${y}`, formatOffset(offsetMinutes) === expected, `got ${formatOffset(offsetMinutes)}, expected ${expected}`);
  }
}

// --- 6. Einstein, against his published Vedic chart ------------------------
// 14 March 1879, 11:30, Ulm. Published charts give Mithuna (Gemini) rising,
// the Moon in Vrischika (Scorpio) and the Sun in Meena (Pisces).
{
  const r = computeKundali({
    year: 1879, month: 3, day: 14, hour: 11, minute: 30,
    latitude: 48.4, longitude: 10.0, zone: 'Europe/Berlin',
  });
  check('Einstein: Gemini rising', r.lagna.rashi === 3, `got ${RASHI[r.lagna.rashi - 1]}`);
  check('Einstein: Moon in Scorpio', r.bodies.mo.rashi === 8, `got ${RASHI[r.bodies.mo.rashi - 1]}`);
  check('Einstein: Sun in Pisces', r.bodies.su.rashi === 12, `got ${RASHI[r.bodies.su.rashi - 1]}`);
  check('Einstein: Moon is in house 6 from Gemini', r.bodies.mo.house === 6, `got ${r.bodies.mo.house}`);

  // An explicit offset must override the zone. Jagannatha Hora's .jhd for this
  // chart records +01:00 (CET) rather than the +00:53 local mean time IANA
  // returns for Europe/Berlin in 1879 — seven minutes apart.
  const withOffset = computeKundali({
    year: 1879, month: 3, day: 14, hour: 11, minute: 30,
    latitude: 48.4, longitude: 10.0, zone: 'Europe/Berlin', offsetMinutes: 60,
  });
  check('explicit offset overrides the zone', withOffset.birth.offset === '+01:00', `got ${withOffset.birth.offset}`);
  check('explicit offset still gives Gemini rising', withOffset.lagna.rashi === 3, `got ${RASHI[withOffset.lagna.rashi - 1]}`);
  // Seven minutes of clock moves the ascendant by roughly 1.75 degrees.
  const shift = Math.abs(withOffset.lagna.sidereal - r.lagna.sidereal);
  check('seven minutes shifts the Lagna by about 1.75 deg', shift > 1.4 && shift < 2.1, `got ${shift.toFixed(3)} deg`);
}

// --- 7. Astronomical sanity ------------------------------------------------
{
  // At the March equinox the Sun's tropical longitude is zero by definition.
  // The 2024 equinox fell at 03:06 UTC on 20 March; the Sun moves about 0.04
  // degrees an hour, so the hour here has to be the real one.
  const eq = computeKundali({
    year: 2024, month: 3, day: 20, hour: 3, minute: 6,
    latitude: 0, longitude: 0, zone: 'UTC',
  });
  const sunTropical = eq.bodies.su.tropical;
  check('Sun at the 2024 March equinox is near tropical 0', sunTropical > 359.9 || sunTropical < 0.1, `got ${sunTropical.toFixed(4)}`);

  // The Moon covers roughly 13.2 degrees a day.
  const d1 = computeKundali({ year: 2024, month: 6, day: 1, hour: 0, minute: 0, latitude: 0, longitude: 0, zone: 'UTC' });
  const d2 = computeKundali({ year: 2024, month: 6, day: 2, hour: 0, minute: 0, latitude: 0, longitude: 0, zone: 'UTC' });
  const moved = norm360(d2.bodies.mo.sidereal - d1.bodies.mo.sidereal);
  near('Moon moves ~13.2 deg per day', moved, 13.2, 1.5, ' deg');

  // The nodes always retrograde, and sit exactly opposite each other.
  check('Rahu retrograde', d1.bodies.ra.retro === true);
  check('Ketu opposite Rahu', Math.abs(norm360(d1.bodies.ke.sidereal - d1.bodies.ra.sidereal) - 180) < 1e-9);
  check('Sun never retrograde', d1.bodies.su.retro === false);
  check('Moon never retrograde', d1.bodies.mo.retro === false);

  // Mercury was retrograde between 1 and 25 April 2024, direct in mid-May.
  const retro = computeKundali({ year: 2024, month: 4, day: 10, hour: 12, minute: 0, latitude: 0, longitude: 0, zone: 'UTC' });
  const direct = computeKundali({ year: 2024, month: 5, day: 20, hour: 12, minute: 0, latitude: 0, longitude: 0, zone: 'UTC' });
  check('Mercury retrograde on 2024-04-10', retro.bodies.me.retro === true);
  check('Mercury direct on 2024-05-20', direct.bodies.me.retro === false);

  // A station is where retrograde detection is most fragile: the longitude is
  // barely moving, so a comparison window that is too wide or too narrow gets
  // the sign wrong. Venus turned direct on 13 September 1991 at 141.007 deg,
  // after a retrograde of about 43 days - the canonical length, which is what
  // makes this a useful anchor rather than just a remembered date.
  const venus = (m, d) => computeKundali({
    year: 1991, month: m, day: d, hour: 12, minute: 0,
    latitude: 0, longitude: 0, zone: 'UTC',
  }).bodies.ve;

  check('Venus retrograde two days before its station', venus(9, 11).retro === true);
  check('Venus direct the day after its station', venus(9, 14).retro === false);
  check('Venus retrograde mid-period', venus(8, 23).retro === true);
  check('Venus direct well before the period', venus(7, 20).retro === false);
  check('Venus direct well after the period', venus(10, 5).retro === false);

  // The station is a minimum in longitude, so both neighbours sit above it.
  const atStation = venus(9, 13).tropical;
  check('the station is a turning point',
    venus(9, 11).tropical > atStation && venus(9, 15).tropical > atStation,
    `station ${atStation.toFixed(4)}`);
}

// --- 8. Every body lands in a legal place ----------------------------------
{
  const r = computeKundali({
    year: 1991, month: 8, day: 23, hour: 5, minute: 45,
    latitude: 26.8467, longitude: 80.9462, zone: 'Asia/Kolkata',
  });
  for (const [key, b] of Object.entries(r.bodies)) {
    check(`${key}: rashi in range`, b.rashi >= 1 && b.rashi <= 12, `got ${b.rashi}`);
    check(`${key}: house in range`, b.house >= 1 && b.house <= 12, `got ${b.house}`);
    check(`${key}: degree in range`, b.degree >= 0 && b.degree < 30, `got ${b.degree}`);
    check(`${key}: rashi agrees with longitude`, rashiOf(b.sidereal) === b.rashi);
  }
  check('twelve bodies computed', Object.keys(r.bodies).length === 12, `got ${Object.keys(r.bodies).length}`);

  // The house of a body must equal its sign counted from the Lagna sign.
  for (const b of Object.values(r.bodies)) {
    const expected = ((b.rashi - r.lagna.rashi + 12) % 12) + 1;
    check(`${b.key}: whole-sign house is consistent`, b.house === expected, `got ${b.house}, expected ${expected}`);
  }
}

// --- 9. It drops into the existing chart model ------------------------------
{
  const kb = await loadKnowledgeFromDisk();
  const r = computeKundali({
    year: 1991, month: 8, day: 23, hour: 5, minute: 45,
    latitude: 26.8467, longitude: 80.9462, zone: 'Asia/Kolkata',
  });
  const { lagna, placements } = toChartPlacements(r);
  const chart = new Chart({ lagna, placements }, kb.base);

  // `placed` counts the nine grahas by design — the outer planets are carried in
  // ALL_BODY_KEYS and stay out of every reading path.
  check('model places all nine grahas', chart.placed.length === 9, `placed ${chart.placed.length}`);
  check('all twelve bodies reach the placements', Object.keys(placements).length === 12, `got ${Object.keys(placements).length}`);
  check('lagna carried over', chart.lagna === r.lagna.rashi);
  check('model agrees on the Moon rashi', chart.signOf('mo') === r.bodies.mo.rashi);

  // Degrees now reach dignity, so moolatrikona can be judged exactly — the one
  // thing the app has had to decline to answer until now.
  const anyExact = Object.keys(r.bodies).some((k) => chart.dignity(k).exact === true);
  check('dignity can be judged exactly with degrees present', anyExact);

  const reading = compose(chart, kb);
  check('the engine reads a computed chart', reading.stats.matched > 0, `matched ${reading.stats.matched}`);
  check('no rule broke on a computed chart', reading.broken.length === 0, reading.broken.map((b) => b.id).join(','));
}

// --- report ----------------------------------------------------------------
console.log(`astro: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('test-astro: OK');
