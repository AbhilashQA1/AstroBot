// Saved kundalis and saved readings.
//
// A chart is cheap to store: the code alone rebuilds it exactly. A reading is
// not, because it is produced against the knowledge base as it stood that day,
// and the whole point of this project is that the knowledge base changes. So a
// saved reading keeps the text it actually showed, together with the size of the
// base it came from, and re-reading the same chart later is a separate act that
// can be compared against it.

// Row format. v1 rows held only a chart code, which is house and retrogression
// and nothing else. That is enough for a chart entered by hand, but a chart
// computed from birth details also carries the birth block, each body's
// longitude and its degree - none of which a code can hold. Restoring such a
// chart from its code would reopen it looking perfectly normal while having
// quietly thrown that away, which is the worst shape a data loss can take.
//
// So a v2 row stores the chart object itself and keeps the code beside it as a
// stable key for grouping and sharing. v1 rows still load, through the code.
const ROW_VERSION = 2;

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

/** Stored charts must not alias live state, or later edits would rewrite history. */
const clone = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));

/**
 * What makes two saved kundalis the same kundali.
 *
 * The code alone is not enough once charts carry more than houses: two people
 * born hours apart can share a house layout while differing in every degree, and
 * de-duplicating on the code would silently overwrite one with the other. Birth
 * details and degrees therefore join the key when they are present, and a chart
 * with neither behaves exactly as it did before.
 */
export function identityOf({ code, chart }) {
  const parts = [`code:${code}`];

  const birth = chart?.birth;
  if (birth) {
    parts.push(`birth:${[birth.date, birth.time, birth.lat, birth.lon, birth.tz].join('|')}`);
  }

  const places = chart?.placements || {};
  const degrees = Object.keys(places).sort()
    .map((k) => (typeof places[k]?.degree === 'number' ? `${k}:${places[k].degree}` : null))
    .filter(Boolean);
  if (degrees.length) parts.push(`deg:${degrees.join(',')}`);

  return parts.join('~');
}

/**
 * The chart to reopen from a saved row: the stored object when the row has one,
 * and otherwise the code, which is all a v1 row ever had. Callers pass their own
 * decoder so this module stays independent of the model.
 */
export function chartOf(row, decode) {
  if (row?.chart) return clone(row.chart);
  return row?.code ? decode(row.code) : null;
}

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
export function saveChart({ name, code, chart = null, note = '' }) {
  const rows = listCharts();
  const identity = identityOf({ code, chart });
  const existing = rows.find((r) => identityOf(r) === identity);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name || existing.name;
    existing.note = note || existing.note;
    // A v1 row that is saved again gains the full chart and becomes a v2 row.
    if (chart) {
      existing.chart = clone(chart);
      existing.v = ROW_VERSION;
    }
    existing.updatedAt = now;
    return { ok: store.set(KEYS.charts, rows), row: existing, updated: true };
  }

  const row = {
    id: newId('k'),
    v: ROW_VERSION,
    name: name || 'Untitled',
    code,
    chart: clone(chart),
    note,
    savedAt: now,
    updatedAt: now,
  };
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
export function saveReading({ title, chartCode, chart = null, view, kbUpdated, kbRules }) {
  const rows = listReadings();
  const row = {
    id: newId('r'),
    v: ROW_VERSION,
    title: title || 'Untitled chart',
    chartCode,
    // Kept so "read this chart again" rebuilds the chart that produced the
    // reading, degrees and birth details included, rather than a flattened copy.
    chart: clone(chart),
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
    format: 'astrobot/library@2',
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
  const haveIdentity = new Set(charts.map((r) => identityOf(r)));
  let addedCharts = 0;
  for (const row of incomingCharts) {
    if (haveChart.has(row.id) || haveIdentity.has(identityOf(row))) continue;
    charts.push({ ...row, id: row.id || newId('k') });
    haveIdentity.add(identityOf(row));
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
