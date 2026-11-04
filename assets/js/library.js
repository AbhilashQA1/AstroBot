// Saved kundalis and saved readings.
//
// A chart is cheap to store: the code alone rebuilds it exactly. A reading is
// not, because it is produced against the knowledge base as it stood that day,
// and the whole point of this project is that the knowledge base changes. So a
// saved reading keeps the text it actually showed, together with the size of the
// base it came from, and re-reading the same chart later is a separate act that
// can be compared against it.

const KEYS = {
  charts: 'astrobot.charts',
  readings: 'astrobot.readings',
};

export const LIMITS = { charts: 100, readings: 60 };

/** Storage can be unavailable or full, and must never take the app down. */
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch { /* nothing to do */ }
  },
};

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/* ------------------------------------------------------------------ view */

function flatten(finding) {
  return {
    id: finding.rule.id,
    name: finding.rule.name || null,
    says: finding.rule.says,
    polarity: finding.rule.polarity,
    tradition: finding.rule.tradition,
    status: finding.rule.status,
    note: finding.rule.note || null,
    citations: finding.citations.map((c) => ({
      label: c.label,
      locus: c.locus || null,
      authority: c.authority,
      repoPath: c.repoPath || null,
    })),
  };
}

/**
 * Turn a composed reading into the plain object the UI renders from.
 *
 * The live view and the saved snapshot go through this same function, so what
 * gets stored is exactly what was on screen - there is no second rendering path
 * that could drift from the first.
 */
export function toView(reading, chart, raw) {
  const lagnaSign = chart.signOfHouse(1);
  return {
    version: 1,
    chartCode: raw ? encodeOf(raw) : null,
    lagnaRashi: chart.rashi(lagnaSign).en,
    missing: chart.missing.map((p) => chart.planet(p).en),
    derived: reading.derived.map((d) => ({ kind: d.kind, text: d.text })),
    combinations: reading.combinations.map(flatten),
    sections: reading.sections.map((s) => ({
      key: s.key,
      title: s.title,
      findings: s.findings.map(flatten),
    })),
    unsectioned: reading.unsectioned.map(flatten),
    conflicts: {
      pairs: reading.conflicts.pairs.map((p) => ({
        reason: p.reason,
        a: flatten(p.a),
        b: flatten(p.b),
      })),
      disputed: reading.conflicts.disputed.map(flatten),
    },
    stats: { matched: reading.stats.matched, ofTotal: reading.stats.ofTotal },
    broken: reading.broken.map((b) => b.id),
  };
}

// Set by the app at boot so this module does not have to import the model.
let encodeOf = () => null;
export function useEncoder(fn) {
  encodeOf = fn;
}

/* ---------------------------------------------------------------- charts */

export function listCharts() {
  const rows = store.get(KEYS.charts, []);
  return Array.isArray(rows) ? rows.filter((r) => r && r.code) : [];
}

/**
 * Save a kundali. Saving the same code twice updates the existing entry rather
 * than piling up duplicates, which is what repeated taps on Save would do.
 */
export function saveChart({ name, code, note = '' }) {
  const rows = listCharts();
  const existing = rows.find((r) => r.code === code);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name || existing.name;
    existing.note = note || existing.note;
    existing.updatedAt = now;
    return { ok: store.set(KEYS.charts, rows), row: existing, updated: true };
  }

  const row = { id: newId('k'), name: name || 'Untitled', code, note, savedAt: now, updatedAt: now };
  rows.unshift(row);
  return { ok: store.set(KEYS.charts, rows.slice(0, LIMITS.charts)), row, updated: false };
}

export function renameChart(id, name) {
  const rows = listCharts();
  const row = rows.find((r) => r.id === id);
  if (!row) return false;
  row.name = name;
  row.updatedAt = new Date().toISOString();
  return store.set(KEYS.charts, rows);
}

export function deleteChart(id) {
  return store.set(KEYS.charts, listCharts().filter((r) => r.id !== id));
}

/* -------------------------------------------------------------- readings */

export function listReadings() {
  const rows = store.get(KEYS.readings, []);
  return Array.isArray(rows) ? rows.filter((r) => r && r.view) : [];
}

/**
 * Snapshot a reading. Unlike a chart, the same chart saved twice is kept twice:
 * two readings of one kundali taken months apart are the interesting case, not
 * an accident to be de-duplicated.
 */
export function saveReading({ title, chartCode, view, kbUpdated, kbRules }) {
  const rows = listReadings();
  const row = {
    id: newId('r'),
    title: title || 'Untitled chart',
    chartCode,
    kbUpdated: kbUpdated || null,
    kbRules: kbRules || null,
    savedAt: new Date().toISOString(),
    view,
  };
  rows.unshift(row);
  return { ok: store.set(KEYS.readings, rows.slice(0, LIMITS.readings)), row };
}

export function deleteReading(id) {
  return store.set(KEYS.readings, listReadings().filter((r) => r.id !== id));
}

export function getReading(id) {
  return listReadings().find((r) => r.id === id) || null;
}

/** Earlier readings of the same kundali, oldest last. */
export function readingsForChart(code) {
  return listReadings().filter((r) => r.chartCode === code);
}

/* ------------------------------------------------------- export / import */

export function exportAll() {
  return {
    format: 'astrobot/library@1',
    exportedAt: new Date().toISOString(),
    charts: listCharts(),
    readings: listReadings(),
  };
}

/**
 * Merge an exported file back in. Existing entries win on id, so importing the
 * same file twice is harmless and importing an older backup never destroys
 * anything saved since.
 */
export function importAll(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'not a JSON object' };
  if (typeof data.format === 'string' && !data.format.startsWith('astrobot/library')) {
    return { ok: false, reason: `unrecognised format "${data.format}"` };
  }

  const incomingCharts = Array.isArray(data.charts) ? data.charts.filter((r) => r && r.code) : [];
  const incomingReadings = Array.isArray(data.readings) ? data.readings.filter((r) => r && r.view) : [];
  if (!incomingCharts.length && !incomingReadings.length) {
    return { ok: false, reason: 'the file holds no charts or readings' };
  }

  const charts = listCharts();
  const haveChart = new Set(charts.map((r) => r.id));
  const haveCode = new Set(charts.map((r) => r.code));
  let addedCharts = 0;
  for (const row of incomingCharts) {
    if (haveChart.has(row.id) || haveCode.has(row.code)) continue;
    charts.push({ ...row, id: row.id || newId('k') });
    addedCharts += 1;
  }

  const readings = listReadings();
  const haveReading = new Set(readings.map((r) => r.id));
  let addedReadings = 0;
  for (const row of incomingReadings) {
    if (haveReading.has(row.id)) continue;
    readings.push({ ...row, id: row.id || newId('r') });
    addedReadings += 1;
  }

  charts.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  readings.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));

  const okCharts = store.set(KEYS.charts, charts.slice(0, LIMITS.charts));
  const okReadings = store.set(KEYS.readings, readings.slice(0, LIMITS.readings));

  return {
    ok: okCharts && okReadings,
    addedCharts,
    addedReadings,
    reason: okCharts && okReadings ? null : 'this browser would not store that much',
  };
}

/** Roughly how much space the library is using, for the Saved screen. */
export function usage() {
  let bytes = 0;
  try {
    for (const key of Object.values(KEYS)) bytes += (localStorage.getItem(key) || '').length;
  } catch { /* storage unavailable */ }
  return bytes;
}
