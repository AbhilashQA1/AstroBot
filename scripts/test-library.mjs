// Exercises the saved-library rules against a minimal localStorage, so the
// de-duplication and import behaviour are checked without a browser.
//
//   npm run test:library

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const lib = await import('../assets/js/library.js');

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    failures += 1;
  }
};

const view = {
  version: 1,
  chartCode: '5.10.4.6.10.9.11.3.1.7',
  lagnaRashi: 'Leo',
  missing: [],
  derived: [{ kind: 'lagna', text: 'Leo rises.' }],
  combinations: [],
  sections: [],
  unsectioned: [],
  conflicts: { pairs: [], disputed: [] },
  stats: { matched: 20, ofTotal: 199 },
  broken: [],
};

console.log('kundalis');
lib.saveChart({ name: 'Ravi', code: '5.10.4.6.10.9.11.3.1.7' });
check('one save, one row', lib.listCharts().length === 1);

lib.saveChart({ name: 'Ravi renamed', code: '5.10.4.6.10.9.11.3.1.7' });
check('the same chart updates rather than duplicating', lib.listCharts().length === 1);
check('the name is taken from the later save', lib.listCharts()[0].name === 'Ravi renamed');

lib.saveChart({ name: 'Other', code: '1.1.2.3.4.5.6.7.8.9' });
check('a different chart is a new row', lib.listCharts().length === 2);

console.log('readings');
lib.saveReading({ title: 'Ravi', chartCode: '5.10.4.6.10.9.11.3.1.7', view, kbUpdated: '2026-11-04', kbRules: 199 });
lib.saveReading({ title: 'Ravi', chartCode: '5.10.4.6.10.9.11.3.1.7', view, kbUpdated: '2026-12-01', kbRules: 240 });
check('one chart can hold several readings', lib.listReadings().length === 2);
check('readings are found by chart', lib.readingsForChart('5.10.4.6.10.9.11.3.1.7').length === 2);
check('newest first', lib.listReadings()[0].kbRules === 240);

console.log('export and import');
const dump = JSON.parse(JSON.stringify(lib.exportAll()));
check('the export carries both kinds', dump.charts.length === 2 && dump.readings.length === 2);

const again = lib.importAll(dump);
check('re-importing the same file adds nothing', again.addedCharts === 0 && again.addedReadings === 0, JSON.stringify(again));
check('and loses nothing', lib.listCharts().length === 2 && lib.listReadings().length === 2);

mem.clear();
const fresh = lib.importAll(dump);
check('importing into an empty library restores everything', fresh.addedCharts === 2 && fresh.addedReadings === 2, JSON.stringify(fresh));
check('a restored reading keeps its text', lib.listReadings()[0].view.derived[0].text === 'Leo rises.');

console.log('charts that carry more than a code');
mem.clear();

const computed = {
  lagna: 5,
  source: 'computed',
  birth: { name: 'A', date: '1990-04-02', time: '06:15', place: 'Pune', lat: 18.52, lon: 73.86, tz: '+05:30' },
  placements: { su: { house: 10, retro: false, degree: 18.4 }, mo: { house: 4, retro: false, degree: 3.1 } },
};
const twin = {
  lagna: 5,
  source: 'computed',
  birth: { name: 'B', date: '1990-04-02', time: '09:40', place: 'Pune', lat: 18.52, lon: 73.86, tz: '+05:30' },
  placements: { su: { house: 10, retro: false, degree: 20.9 }, mo: { house: 4, retro: false, degree: 5.7 } },
};

lib.saveChart({ name: 'Computed A', code: '5.10.4.-.-.-.-.-.-.-', chart: computed });
lib.saveChart({ name: 'Computed B', code: '5.10.4.-.-.-.-.-.-.-', chart: twin });
check('two births sharing a house layout stay two kundalis', lib.listCharts().length === 2,
  `got ${lib.listCharts().length}`);

const restored = lib.chartOf(lib.listCharts().find((r) => r.name === 'Computed A'), () => null);
check('the birth block survives a save', restored?.birth?.time === '06:15');
check('degrees survive a save', restored?.placements?.su?.degree === 18.4);
check('the source flag survives a save', restored?.source === 'computed');

restored.placements.su.degree = 99;
const again2 = lib.chartOf(lib.listCharts().find((r) => r.name === 'Computed A'), () => null);
check('a restored chart is a copy, not a live alias', again2.placements.su.degree === 18.4);

lib.saveChart({ name: 'Computed A again', code: '5.10.4.-.-.-.-.-.-.-', chart: computed });
check('the identical chart still updates in place', lib.listCharts().length === 2);

console.log('v1 rows still load');
mem.clear();
// A row as the previous version wrote it: a code and no chart object.
localStorage.setItem('astrobot.charts', JSON.stringify([
  { id: 'k-old', name: 'Legacy', code: '5.10.4.6.10.9.11.3.1.7', savedAt: '2026-01-01T00:00:00.000Z' },
]));
const legacy = lib.chartOf(lib.listCharts()[0], (code) => ({ decodedFrom: code }));
check('a v1 row falls back to its code', legacy?.decodedFrom === '5.10.4.6.10.9.11.3.1.7');

// Re-saving the same hand-entered chart: same identity, so the row is upgraded
// rather than duplicated.
const manual = { lagna: 5, placements: { su: { house: 10, retro: false } } };
lib.saveChart({ name: 'Legacy', code: '5.10.4.6.10.9.11.3.1.7', chart: manual });
check('re-saving a v1 row upgrades it in place', lib.listCharts().length === 1,
  `got ${lib.listCharts().length}`);
check('and it becomes a v2 row', lib.listCharts()[0].v === 2 && !!lib.listCharts()[0].chart);

// Computing the same house layout from birth details is not the same kundali:
// it carries data the old row never had, so it earns its own row rather than
// overwriting what was there.
lib.saveChart({ name: 'Legacy computed', code: '5.10.4.6.10.9.11.3.1.7', chart: computed });
check('a computed chart does not overwrite the hand-entered one', lib.listCharts().length === 2,
  `got ${lib.listCharts().length}`);
check('the hand-entered row is untouched',
  lib.listCharts().some((r) => r.name === 'Legacy' && !r.chart.birth));

console.log('readings keep their chart');
mem.clear();
lib.saveReading({ title: 'C', chartCode: '5.10.4.-.-.-.-.-.-.-', chart: computed, view, kbRules: 199 });
const savedChart = lib.listReadings()[0].chart;
check('a saved reading carries the chart it was taken from', savedChart?.birth?.date === '1990-04-02');
check('including its degrees', savedChart?.placements?.mo?.degree === 3.1);

console.log('bad input');
check('junk is refused', lib.importAll({ hello: 'world' }).ok === false);
check('a foreign format is refused', lib.importAll({ format: 'something/else@1', charts: [] }).ok === false);
check('null is refused', lib.importAll(null).ok === false);

console.log(failures ? `\n${failures} failure(s)` : '\nall library checks passed');
process.exit(failures ? 1 : 0);
