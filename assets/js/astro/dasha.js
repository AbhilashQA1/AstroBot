// Vimshottari dasha: the 120-year cycle of planetary periods.
//
// Everything here comes from one number the chart already carries - the Moon's
// sidereal longitude - plus the birth instant. The Moon's position inside its
// nakshatra fixes which lord is running at birth and how much of that period is
// already spent; the rest is arithmetic.
//
// Nothing in this file is astronomy. It is a calendar, and the only genuinely
// contested input is how long a "year" is. See YEAR_LENGTHS.

import { makeUtc, zonedWallTimeToUtc } from './time.js';

/** The nine lords in cycle order, with their periods in years. They total 120. */
export const VIMSHOTTARI = [
  { lord: 'ke', years: 7 },
  { lord: 've', years: 20 },
  { lord: 'su', years: 6 },
  { lord: 'mo', years: 10 },
  { lord: 'ma', years: 7 },
  { lord: 'ra', years: 18 },
  { lord: 'ju', years: 16 },
  { lord: 'sa', years: 19 },
  { lord: 'me', years: 17 },
];

export const TOTAL_YEARS = VIMSHOTTARI.reduce((n, p) => n + p.years, 0); // 120

export const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu',
  'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta',
  'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha',
  'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada',
  'Uttara Bhadrapada', 'Revati',
];

/**
 * How many days a dasha year is reckoned at.
 *
 * This is a real disagreement, not a rounding choice. The savana year of 360
 * days runs about 1.4% short of the others, which moves a long mahadasha
 * boundary by roughly six months - enough to change which period a date falls
 * in. AstroBot states which convention produced a date rather than presenting
 * one as the answer.
 */
export const YEAR_LENGTHS = {
  gregorian: 365.2425,
  julian: 365.25,
  sidereal: 365.256363,
  savana: 360,
};

export const DEFAULT_YEAR_LENGTH = 'gregorian';

const NAK_SPAN = 360 / 27;
const DAY_MS = 24 * 60 * 60 * 1000;

function yearMs(yearLength) {
  const days = YEAR_LENGTHS[yearLength];
  if (!days) throw new Error(`unknown year length "${yearLength}"`);
  return days * DAY_MS;
}

/** Which nakshatra a sidereal longitude falls in, and how far through it. */
export function nakshatraOf(siderealLon) {
  const lon = ((siderealLon % 360) + 360) % 360;
  const index = Math.floor(lon / NAK_SPAN);
  const traversed = (lon - index * NAK_SPAN) / NAK_SPAN;
  return {
    index,
    number: index + 1,
    name: NAKSHATRAS[index],
    lord: VIMSHOTTARI[index % 9].lord,
    traversed,
    degreesIn: lon - index * NAK_SPAN,
  };
}

/**
 * The birth instant in milliseconds UTC, resolved the same way the chart was.
 *
 * An explicit offset wins over the zone, because a birth record's stated offset
 * beats anything derivable from a modern timezone database - the same rule the
 * chart calculation follows, and it has to match or the dasha would be anchored
 * to a different moment than the chart.
 */
export function birthInstant(birth) {
  if (!birth?.date) return null;
  const [year, month, day] = birth.date.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  // An unknown birth time is conventionally read at noon. The dasha that comes
  // out is then as uncertain as the time was, which the caller is told.
  const known = birth.timeKnown !== false && typeof birth.time === 'string';
  const [hour, minute] = (known ? birth.time : '12:00').split(':').map(Number);

  if (Number.isFinite(birth.offsetMinutes)) {
    return makeUtc(year, month, day, hour, minute, 0) - birth.offsetMinutes * 60000;
  }
  const zone = birth.zone || birth.place?.zone || 'Asia/Kolkata';
  return zonedWallTimeToUtc(year, month, day, hour, minute, 0, zone).utcMs;
}

/**
 * The full mahadasha sequence from birth.
 *
 * The first period is truncated: the Moon has already travelled part of its
 * nakshatra by the time of birth, and that part of its lord's period is spent.
 */
export function mahadashas(moonLongitude, birthUtcMs, { yearLength = DEFAULT_YEAR_LENGTH, cycles = 1 } = {}) {
  const nak = nakshatraOf(moonLongitude);
  const ms = yearMs(yearLength);
  const start = VIMSHOTTARI.findIndex((p) => p.lord === nak.lord);

  const out = [];
  let cursor = birthUtcMs;
  const count = 9 * cycles;

  for (let i = 0; i < count; i += 1) {
    const period = VIMSHOTTARI[(start + i) % 9];
    // Only the first is partial; every later one runs its full length.
    const years = i === 0 ? period.years * (1 - nak.traversed) : period.years;
    const from = cursor;
    cursor += years * ms;
    out.push({
      lord: period.lord,
      fullYears: period.years,
      years,
      from,
      to: cursor,
      partial: i === 0 && nak.traversed > 0,
    });
  }
  return out;
}

/**
 * The nine antardashas inside a mahadasha.
 *
 * They run in the same cyclic order, beginning with the mahadasha's own lord,
 * each taking the share of the period that its own years take of the 120.
 */
export function antardashas(maha, { yearLength = DEFAULT_YEAR_LENGTH } = {}) {
  const ms = yearMs(yearLength);
  const start = VIMSHOTTARI.findIndex((p) => p.lord === maha.lord);
  const fullSpan = maha.fullYears * ms;

  // A truncated opening mahadasha starts partway through its own antardashas,
  // so they are laid out over the full period and then clipped to what is left.
  const nominalStart = maha.to - fullSpan;
  const out = [];
  let cursor = nominalStart;

  for (let i = 0; i < 9; i += 1) {
    const sub = VIMSHOTTARI[(start + i) % 9];
    const span = fullSpan * (sub.years / TOTAL_YEARS);
    const from = cursor;
    cursor += span;
    if (cursor <= maha.from) continue;        // entirely before birth
    out.push({
      lord: sub.lord,
      maha: maha.lord,
      from: Math.max(from, maha.from),
      to: cursor,
      clipped: from < maha.from,
    });
  }
  return out;
}

/** The mahadasha and antardasha running at a given instant. */
export function periodsAt(moonLongitude, birthUtcMs, atMs, opts = {}) {
  const list = mahadashas(moonLongitude, birthUtcMs, { ...opts, cycles: 2 });
  const maha = list.find((p) => atMs >= p.from && atMs < p.to) || null;
  if (!maha) return { maha: null, antar: null, beforeBirth: atMs < birthUtcMs };
  const antar = antardashas(maha, opts).find((p) => atMs >= p.from && atMs < p.to) || null;
  return { maha, antar, beforeBirth: false };
}

/**
 * Everything the reading needs, or a reason it cannot be worked out.
 *
 * `reason` is deliberately specific: a chart entered by hand has no birth
 * moment and no Moon degree, and saying so is more use than a blank panel.
 */
export function dashaFor(chart, birth, atMs = Date.now(), opts = {}) {
  const moon = chart.siderealLongitude?.('mo');
  if (moon === null || moon === undefined) {
    return { available: false, reason: 'no-degrees' };
  }
  const birthUtcMs = birthInstant(birth);
  if (birthUtcMs === null) {
    return { available: false, reason: 'no-birth-details' };
  }

  const yearLength = opts.yearLength || DEFAULT_YEAR_LENGTH;
  const nak = nakshatraOf(moon);
  const { maha, antar } = periodsAt(moon, birthUtcMs, atMs, { yearLength });

  return {
    available: true,
    yearLength,
    yearDays: YEAR_LENGTHS[yearLength],
    nakshatra: nak,
    birthUtcMs,
    timeKnown: birth.timeKnown !== false,
    at: atMs,
    maha,
    antar,
    sequence: mahadashas(moon, birthUtcMs, { yearLength }),
  };
}
