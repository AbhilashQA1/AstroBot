// Tests for editing a calculated chart.
//
// The rule being defended: a chart must never present itself as calculated once
// somebody has changed it by hand. Everything else here follows from that.
//
//   node scripts/test-edits.mjs

import {
  chartSource, editedBodies, lagnaEdited, moveBody, revertToComputed,
  setDegree, shiftBirthMinutes, snapshot,
} from '../assets/js/edits.js';
import { computeKundali, toChartPlacements } from '../assets/js/astro/compute.js';
import { Chart } from '../assets/js/model.js';
import { loadKnowledgeFromDisk } from './kb-node.mjs';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const BIRTH = {
  year: 1991, month: 8, day: 23, hour: 5, minute: 45,
  latitude: 26.8393, longitude: 80.9231, zone: 'Asia/Kolkata',
};

function freshComputed() {
  const result = computeKundali(BIRTH);
  const { lagna, placements } = toChartPlacements(result);
  return {
    lagna,
    placements,
    computed: snapshot(lagna, placements),
    birth: { date: '1991-08-23', time: '05:45', timeKnown: true, ayanamsa: 'lahiri', place: { name: 'Lucknow', latitude: 26.8393, longitude: 80.9231 } },
  };
}

// --- a freshly computed chart is clean -------------------------------------
{
  const raw = freshComputed();
  check('a fresh calculation reports no edits', editedBodies(raw).length === 0, `${editedBodies(raw).length} found`);
  check('a fresh calculation is "computed"', chartSource(raw) === 'computed', chartSource(raw));
  check('the Lagna is unedited', lagnaEdited(raw) === false);
  check('a chart with no calculation is "manual"', chartSource({ lagna: 1, placements: {} }) === 'manual');
}

// --- moving a body ----------------------------------------------------------
{
  const raw = freshComputed();
  const was = raw.placements.ma.house;
  const target = (was % 12) + 1;
  const hadDegree = raw.placements.ma.degree;
  check('Mars started with a degree', typeof hadDegree === 'number');

  moveBody(raw, 'ma', target);

  const edits = editedBodies(raw);
  check('the move is detected', edits.length === 1 && edits[0].key === 'ma', JSON.stringify(edits.map((e) => e.key)));
  check('it is reported as a move', edits[0]?.change === 'moved', edits[0]?.change);
  check('the chart is now "computed-edited"', chartSource(raw) === 'computed-edited', chartSource(raw));

  // The important one. A sidereal longitude places a body in exactly one sign,
  // so once it is somewhere else the degree describes nothing. Keeping it would
  // let the reading judge moolatrikona from a figure the person overruled.
  check('the degree is dropped when a body moves', raw.placements.ma.degree === undefined, String(raw.placements.ma.degree));
  check('the snapshot still holds the original degree', typeof raw.computed.placements.ma.degree === 'number');
  check('retrogression survives the move', raw.placements.ma.retro === raw.computed.placements.ma.retro);
}

// --- removing and adding ----------------------------------------------------
{
  const raw = freshComputed();
  delete raw.placements.ve;
  const edits = editedBodies(raw);
  check('a removal is detected', edits.length === 1 && edits[0].change === 'removed', JSON.stringify(edits));

  const raw2 = freshComputed();
  delete raw2.computed.placements.pl;
  check('a body absent from the calculation reads as added',
    editedBodies(raw2).some((e) => e.key === 'pl' && e.change === 'added'));
}

// --- degrees ----------------------------------------------------------------
{
  const raw = freshComputed();
  setDegree(raw, 'su', 12.5);
  const edits = editedBodies(raw);
  check('a changed degree is detected', edits.length === 1 && edits[0].change === 'degree', JSON.stringify(edits));

  const raw2 = freshComputed();
  const current = raw2.placements.su.degree;
  setDegree(raw2, 'su', current);
  check('rewriting the same degree is not an edit', editedBodies(raw2).length === 0);

  const raw3 = freshComputed();
  setDegree(raw3, 'su', current + 0.0001);
  check('a change below a thousandth of a degree is ignored', editedBodies(raw3).length === 0);

  const raw4 = freshComputed();
  setDegree(raw4, 'su', '');
  check('clearing a degree is an edit', editedBodies(raw4).length === 1);
  check('and the degree is gone', raw4.placements.su.degree === undefined);

  for (const bad of [-1, 30, 30.0001, 'abc', NaN]) {
    let threw = false;
    try { setDegree(freshComputed(), 'su', bad); } catch { threw = true; }
    check(`a degree of ${String(bad)} is refused`, threw);
  }
  // 29.9999 is inside a sign; 30 is the next one.
  let ok = true;
  try { setDegree(freshComputed(), 'su', 29.9999); } catch { ok = false; }
  check('29.9999 is accepted', ok);
}

// --- the Lagna --------------------------------------------------------------
{
  const raw = freshComputed();
  raw.lagna = (raw.lagna % 12) + 1;
  check('a moved Lagna is detected', lagnaEdited(raw) === true);
  check('and makes the chart edited', chartSource(raw) === 'computed-edited');
}

// --- reverting --------------------------------------------------------------
{
  const raw = freshComputed();
  const originalLagna = raw.lagna;
  const originalMars = raw.placements.ma.house;
  const originalDegree = raw.placements.ma.degree;

  moveBody(raw, 'ma', (originalMars % 12) + 1);
  raw.lagna = (originalLagna % 12) + 1;
  delete raw.placements.ve;
  check('the chart is dirty before reverting', chartSource(raw) === 'computed-edited');

  revertToComputed(raw);
  check('reverting restores the Lagna', raw.lagna === originalLagna);
  check('reverting restores the house', raw.placements.ma.house === originalMars);
  check('reverting restores the degree', Math.abs(raw.placements.ma.degree - originalDegree) < 1e-9);
  check('reverting restores a removed body', Boolean(raw.placements.ve));
  check('the chart is clean again', chartSource(raw) === 'computed', chartSource(raw));
  check('and reports no edits', editedBodies(raw).length === 0);
}

// --- birth-time rectification ----------------------------------------------
{
  const birth = { date: '1991-08-23', time: '05:45', timeKnown: true };

  check('plus five minutes', shiftBirthMinutes(birth, 5).time === '05:50');
  check('minus five minutes', shiftBirthMinutes(birth, -5).time === '05:40');

  // Crossing midnight has to move the date, not wrap the clock.
  const nearMidnight = { date: '1991-08-23', time: '23:58', timeKnown: true };
  const after = shiftBirthMinutes(nearMidnight, 5);
  check('crossing midnight forward moves the date', after.date === '1991-08-24' && after.time === '00:03', `${after.date} ${after.time}`);

  const earlyMorning = { date: '1991-08-23', time: '00:02', timeKnown: true };
  const before = shiftBirthMinutes(earlyMorning, -5);
  check('crossing midnight backward moves the date', before.date === '1991-08-22' && before.time === '23:57', `${before.date} ${before.time}`);

  // An unknown time becomes a known one at noon rather than staying unknown.
  const unknown = { date: '1991-08-23', time: '', timeKnown: false };
  const nudged = shiftBirthMinutes(unknown, 1);
  check('nudging an unknown time starts from noon', nudged.time === '12:01' && nudged.timeKnown === true, `${nudged.time}`);

  // The reason the feature exists: four minutes is about one degree of Lagna.
  const a = computeKundali(BIRTH);
  const b = computeKundali({ ...BIRTH, minute: BIRTH.minute + 4 });
  const moved = Math.abs(b.lagna.sidereal - a.lagna.sidereal);
  check('four minutes moves the Lagna about a degree', moved > 0.5 && moved < 1.6, `${moved.toFixed(3)} deg`);
}

// --- an edited chart still reads --------------------------------------------
{
  const kb = await loadKnowledgeFromDisk();
  const raw = freshComputed();
  moveBody(raw, 'ma', (raw.placements.ma.house % 12) + 1);

  const chart = new Chart(raw, kb.base);
  check('an edited chart still builds', chart.placed.length === 9, `${chart.placed.length}`);

  // Mars lost its degree, so its dignity falls back to a sign-level judgement
  // and the engine says a degree would be needed — which is the honest answer.
  const marsDignity = chart.dignity('ma');
  check('a moved body is judged by sign alone', marsDignity.exact === false || marsDignity.state !== 'moolatrikona', JSON.stringify(marsDignity));

  // Untouched bodies keep their precision.
  const sun = chart.dignity('su');
  check('an untouched body keeps its exact dignity', sun.exact === true, JSON.stringify(sun));
}

console.log(`edits: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('test-edits: OK');
