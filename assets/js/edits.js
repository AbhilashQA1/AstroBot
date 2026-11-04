// Tracking what a person changed after a chart was calculated.
//
// A computed chart and a hand-edited one must never be confused. The arithmetic
// carries an implicit claim - these are the positions for that moment - and the
// moment somebody drags Mars into the seventh house, that claim is void for Mars
// and the chart should say so rather than keep wearing the authority of a
// calculation.
//
// Nothing here is a stored flag. The computed chart is kept as a snapshot and
// "edited" is derived by comparing against it, so the two can never drift out of
// agreement the way a flag and the data it describes eventually do.

/** Take the snapshot a computed chart is later compared against. */
export function snapshot(lagna, placements) {
  const copy = {};
  for (const [key, at] of Object.entries(placements)) {
    copy[key] = { house: at.house, retro: Boolean(at.retro), degree: at.degree ?? null };
  }
  return { lagna, placements: copy };
}

function sameDegree(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // A thousandth of a degree is 3.6 arcseconds - far below anything a person can
  // mean to enter, and well above floating-point noise from a round trip.
  return Math.abs(a - b) < 0.001;
}

/**
 * Which bodies no longer match the calculation.
 * Returns an array of { key, was, now, change } where change says what differs.
 */
export function editedBodies(raw) {
  const computed = raw?.computed;
  if (!computed) return [];

  const out = [];
  const keys = new Set([...Object.keys(computed.placements), ...Object.keys(raw.placements || {})]);

  for (const key of keys) {
    const was = computed.placements[key] || null;
    const now = raw.placements?.[key] || null;

    if (was && !now) {
      out.push({ key, was, now: null, change: 'removed' });
      continue;
    }
    if (!was && now) {
      out.push({ key, was: null, now, change: 'added' });
      continue;
    }
    if (!was || !now) continue;

    if (was.house !== now.house) out.push({ key, was, now, change: 'moved' });
    else if (Boolean(was.retro) !== Boolean(now.retro)) out.push({ key, was, now, change: 'retrograde' });
    else if (!sameDegree(was.degree, now.degree)) out.push({ key, was, now, change: 'degree' });
  }

  return out;
}

export function lagnaEdited(raw) {
  return Boolean(raw?.computed) && raw.computed.lagna !== raw.lagna;
}

/** 'manual' | 'computed' | 'computed-edited' — derived, never stored stale. */
export function chartSource(raw) {
  if (!raw?.computed) return 'manual';
  return editedBodies(raw).length || lagnaEdited(raw) ? 'computed-edited' : 'computed';
}

/**
 * Apply a move. The degree goes with the old house: a sidereal longitude places a
 * body in exactly one sign, so once it sits somewhere else that number describes
 * nothing. Keeping it would let the reading claim a precision it has lost - the
 * app would go on judging moolatrikona from a degree the person has overruled.
 */
export function moveBody(raw, key, house) {
  const existing = raw.placements[key];
  raw.placements[key] = { house, retro: Boolean(existing?.retro) };
  return raw;
}

/** Set an exact degree within the body's current sign. */
export function setDegree(raw, key, degree) {
  const at = raw.placements[key];
  if (!at) return raw;
  if (degree === null || degree === '') {
    delete at.degree;
    return raw;
  }
  const value = Number(degree);
  if (!Number.isFinite(value) || value < 0 || value >= 30) {
    throw new Error('a degree must be between 0 and just under 30');
  }
  at.degree = value;
  return raw;
}

/** Put every body and the Lagna back to what was calculated. */
export function revertToComputed(raw) {
  if (!raw.computed) return raw;
  raw.lagna = raw.computed.lagna;
  raw.placements = {};
  for (const [key, at] of Object.entries(raw.computed.placements)) {
    raw.placements[key] = { house: at.house, retro: at.retro, ...(at.degree === null ? {} : { degree: at.degree }) };
  }
  return raw;
}

/**
 * Shift the birth time and recompute.
 *
 * Rectification is the real reason anyone edits a calculated chart: the birth
 * time on a certificate is often rounded to five minutes, or remembered wrongly,
 * and the Lagna moves about a degree every four minutes. Nudging the time and
 * watching the ascendant move is the honest version of that, and it keeps the
 * chart computed rather than hand-edited.
 */
export function shiftBirthMinutes(birth, deltaMinutes) {
  const [hour, minute] = (birth.timeKnown === false ? '12:00' : birth.time).split(':').map(Number);
  const [year, month, day] = birth.date.split('-').map(Number);

  const base = new Date(Date.UTC(2000, month - 1, day, hour, minute));
  base.setUTCFullYear(year);
  const shifted = new Date(base.getTime() + deltaMinutes * 60000);

  const pad = (n) => String(n).padStart(2, '0');
  return {
    ...birth,
    timeKnown: true,
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}
