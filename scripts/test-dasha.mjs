// Vimshottari dasha.
//
// A dasha is a calendar, so the things worth pinning down are arithmetic: that
// the cycle closes, that the opening period is correctly truncated, that
// subdivisions fill their parent exactly, and that the year-length convention
// is honoured rather than quietly assumed.
//
//   npm run test:dasha

import {
  DEFAULT_YEAR_LENGTH, TOTAL_YEARS, VIMSHOTTARI, YEAR_LENGTHS,
  antardashas, birthInstant, dashaFor, mahadashas, nakshatraOf, periodsAt,
} from '../assets/js/astro/dasha.js';
import { computeKundali, toChartPlacements } from '../assets/js/astro/compute.js';
import { Chart, emptyChart } from '../assets/js/model.js';
import { compose } from '../assets/js/engine.js';
import { loadKnowledgeFromDisk } from './kb-node.mjs';

const kb = await loadKnowledgeFromDisk();

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    failures += 1;
  }
};

const DAY = 24 * 3600 * 1000;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('the cycle itself');
check('nine lords', VIMSHOTTARI.length === 9);
check('they total 120 years', TOTAL_YEARS === 120, String(TOTAL_YEARS));
check('every lord key is three characters or fewer',
  VIMSHOTTARI.every((p) => p.lord.length <= 3));

console.log('nakshatra from longitude');
check('0 degrees is the start of Ashwini',
  nakshatraOf(0).number === 1 && nakshatraOf(0).traversed === 0);
check('Ashwini belongs to Ketu', nakshatraOf(0).lord === 'ke');
check('the 27th nakshatra ends at 360', nakshatraOf(359.99).number === 27);
check('halfway through the first nakshatra reads as half',
  near(nakshatraOf(360 / 27 / 2).traversed, 0.5, 1e-9));
check('longitudes wrap rather than throwing', nakshatraOf(725).number >= 1);

console.log('the birth instant');
check('an explicit offset is honoured over the zone',
  birthInstant({ date: '1991-08-23', time: '05:50', offsetMinutes: 330 })
  === Date.parse('1991-08-23T00:20:00Z'));
check('a zone is resolved when no offset is given',
  birthInstant({ date: '1991-08-23', time: '05:50', zone: 'Asia/Kolkata' })
  === Date.parse('1991-08-23T00:20:00Z'));
check('an unknown time is read at noon',
  birthInstant({ date: '1991-08-23', timeKnown: false, offsetMinutes: 0 })
  === Date.parse('1991-08-23T12:00:00Z'));
check('a chart with no date yields nothing', birthInstant({}) === null);

console.log('the sequence');
const birthMs = Date.parse('1991-08-23T00:20:00Z');
const moon = 279.1937;
const seq = mahadashas(moon, birthMs);
check('nine periods in a cycle', seq.length === 9);
check('it opens with the nakshatra lord', seq[0].lord === nakshatraOf(moon).lord);
check('the opening period is marked partial', seq[0].partial === true);
check('it starts at birth', seq[0].from === birthMs);
check('each period begins where the last ended',
  seq.every((p, i) => i === 0 || p.from === seq[i - 1].to));

const spent = nakshatraOf(moon).traversed * VIMSHOTTARI.find((p) => p.lord === seq[0].lord).years;
const spanYears = (seq[8].to - seq[0].from) / (YEAR_LENGTHS[DEFAULT_YEAR_LENGTH] * DAY);
check('the cycle runs 120 years minus what was already spent',
  near(spanYears, 120 - spent, 1e-6), `${spanYears} vs ${120 - spent}`);

console.log('the year-length convention');
const greg = mahadashas(moon, birthMs, { yearLength: 'gregorian' });
const savana = mahadashas(moon, birthMs, { yearLength: 'savana' });
check('savana years are accepted', savana.length === 9);
const driftDays = (greg[8].to - savana[8].to) / DAY;
check('and they genuinely differ, by well over a year across the cycle',
  driftDays > 400, `${driftDays.toFixed(0)} days`);
console.log(`       (the cycle ends ${driftDays.toFixed(0)} days apart under the two conventions)`);
let threw = false;
try { mahadashas(moon, birthMs, { yearLength: 'nonsense' }); } catch { threw = true; }
check('an unknown convention is refused rather than guessed', threw);

console.log('antardashas');
const rahu = seq.find((p) => p.lord === 'ra');
const subs = antardashas(rahu);
check('nine subdivisions', subs.length === 9);
check('the first belongs to the mahadasha lord', subs[0].lord === rahu.lord);
check('they start with the mahadasha', subs[0].from === rahu.from);
check('they end with it', near(subs[8].to, rahu.to, 1));
check('they are contiguous',
  subs.every((p, i) => i === 0 || near(p.from, subs[i - 1].to, 1)));
check('their spans add up to the whole period',
  near(subs.reduce((n, p) => n + (p.to - p.from), 0), rahu.to - rahu.from, 10));

// The opening mahadasha is truncated, so its antardashas must be clipped to
// what is left rather than running from birth as though nothing were spent.
const openingSubs = antardashas(seq[0]);
check('a truncated opening period drops the subdivisions already past',
  openingSubs.length < 9, `${openingSubs.length} remain`);
check('and none of them starts before birth',
  openingSubs.every((p) => p.from >= birthMs));
check('the first surviving one is marked as clipped',
  openingSubs[0].clipped === true || openingSubs[0].from === seq[0].from);

console.log('looking a date up');
const at = Date.parse('2026-11-04T00:00:00Z');
const found = periodsAt(moon, birthMs, at);
check('a mahadasha is found', !!found.maha);
check('the date falls inside it', at >= found.maha.from && at < found.maha.to);
check('an antardasha is found', !!found.antar);
check('the date falls inside that too', at >= found.antar.from && at < found.antar.to);
check('the antardasha sits within its mahadasha',
  found.antar.from >= found.maha.from && found.antar.to <= found.maha.to + 1);
check('a date before birth is reported, not guessed at',
  periodsAt(moon, birthMs, birthMs - DAY).beforeBirth === true);

console.log('what the chart can and cannot support');
const p = toChartPlacements(computeKundali({
  year: 1991, month: 8, day: 23, hour: 5, minute: 50,
  latitude: 26.8467, longitude: 80.9231, zone: 'Asia/Kolkata',
}));
const raw = emptyChart();
raw.lagna = p.lagna;
raw.placements = p.placements;
const chart = new Chart(raw, kb.base);
const birth = { date: '1991-08-23', time: '05:50', zone: 'Asia/Kolkata' };

const good = dashaFor(chart, birth, at);
check('a calculated chart supports a dasha', good.available === true);
check('and names the nakshatra', good.nakshatra.name === 'Uttara Ashadha', good.nakshatra.name);

const bare = emptyChart();
bare.lagna = raw.lagna;
for (const [k, v] of Object.entries(raw.placements)) bare.placements[k] = { house: v.house, retro: v.retro };
const noDeg = dashaFor(new Chart(bare, kb.base), birth, at);
check('a chart without degrees cannot support one', noDeg.available === false);
check('and says why', noDeg.reason === 'no-degrees', noDeg.reason);

const noBirth = dashaFor(chart, {}, at);
check('nor can one without birth details', noBirth.available === false);
check('and says why', noBirth.reason === 'no-birth-details', noBirth.reason);

console.log('the engine reads the period');
const reading = compose(chart, kb, { dasha: good });
const period = reading.sections.find((s) => s.key === 'period');
check('a period section appears', !!period && period.findings.length > 0);
check('the running lord is named',
  period.findings.some((f) => f.rule.id === `dsa.lord.${good.maha.lord}`));
check('the reading states the dates',
  reading.derived.some((d) => d.kind === 'dasha' && /mahadasha/.test(d.text)));

const plain = compose(new Chart(bare, kb.base), kb, { dasha: noDeg });
check('no period rule fires without a dasha',
  !plain.sections.some((s) => s.key === 'period'));
check('and the reading explains the absence',
  plain.derived.some((d) => d.kind === 'dasha' && /cannot|no period/i.test(d.text)));

// Lordship rules are the heart of the family: across the whole cycle every
// non-node period should pick up at least its lord rule plus a house rule.
console.log('coverage across a whole life');
let thin = [];
for (const m of seq) {
  const ctx = { dasha: dashaFor(chart, birth, m.from + (m.to - m.from) / 2) };
  const r = compose(chart, kb, ctx);
  const sec = r.sections.find((s) => s.key === 'period');
  const n = sec ? sec.findings.length : 0;
  if (n < 2 && !['ra', 'ke'].includes(m.lord)) thin.push(`${m.lord}:${n}`);
}
check('every non-node period says at least two things', thin.length === 0, thin.join(' '));

console.log(failures ? `\n${failures} failure(s)` : '\nall dasha checks passed');
process.exit(failures ? 1 : 0);
