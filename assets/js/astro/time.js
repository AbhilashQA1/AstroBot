// Turning a birth certificate into an instant.
//
// "14 March 1879, 11:30, in Ulm" is a wall-clock reading, not a moment. Getting
// from one to the other needs the UTC offset in force at that place on that day,
// which is a question about law and history rather than astronomy: India ran on
// Madras time (+05:21:10) until 1906, moved to +05:30, and spent 1942 to 1945 on
// +06:30 wartime daylight saving.
//
// Every browser and Node build already carries the IANA timezone database for
// Intl, so all of that is available without shipping a timezone library. This
// module is the small amount of glue needed to run it backwards: from local wall
// time to the UTC instant, rather than the usual direction.

/**
 * The UTC offset of a zone at a given instant, in minutes.
 * Positive east of Greenwich, so Asia/Kolkata returns 330.
 */
export function offsetMinutesAt(utcMs, zone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    era: 'short',
  });

  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;

  // Intl renders midnight as hour 24 in some locales.
  const hour = Number(parts.hour) % 24;
  const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);

  const asIfUtc = makeUtc(year, Number(parts.month), Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * Date.UTC maps years 0-99 onto 1900-1999, which would quietly mangle any early
 * date. This builds the timestamp without that behaviour.
 */
export function makeUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const d = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  d.setUTCFullYear(year);
  return d.getTime();
}

/**
 * Local wall-clock time in a zone to the UTC instant.
 *
 * Solved by iteration because the offset depends on the very instant being
 * sought. Two passes settle every case except a wall time that a DST jump
 * skipped or repeated, which is reported rather than silently resolved.
 *
 * @returns {{ utcMs: number, offsetMinutes: number, ambiguity: string|null }}
 */
export function zonedWallTimeToUtc(year, month, day, hour, minute, second, zone) {
  const wallAsUtc = makeUtc(year, month, day, hour, minute, second);

  let utcMs = wallAsUtc;
  let offsetMinutes = 0;
  for (let i = 0; i < 3; i += 1) {
    offsetMinutes = offsetMinutesAt(utcMs, zone);
    const next = wallAsUtc - offsetMinutes * 60000;
    if (next === utcMs) break;
    utcMs = next;
  }

  // Confirm the instant really does render back as the wall time asked for.
  const check = offsetMinutesAt(utcMs, zone);
  let ambiguity = null;
  if (check !== offsetMinutes) {
    ambiguity = 'this wall-clock time falls in a daylight-saving transition and is ambiguous';
  }

  return { utcMs, offsetMinutes: check, ambiguity };
}

/** Julian Day from a UTC timestamp, without any ΔT correction. */
export function julianDayUT(utcMs) {
  return utcMs / 86400000 + 2440587.5;
}

/** Format a UTC offset in minutes as `+05:30`. */
export function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
