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

console.log('bad input');
check('junk is refused', lib.importAll({ hello: 'world' }).ok === false);
check('a foreign format is refused', lib.importAll({ format: 'something/else@1', charts: [] }).ok === false);
check('null is refused', lib.importAll(null).ok === false);

console.log(failures ? `\n${failures} failure(s)` : '\nall library checks passed');
process.exit(failures ? 1 : 0);
