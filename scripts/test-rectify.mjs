// Rectification: recover a birth time from a stated Lagna.
//
// The test that matters is the round trip. Compute a chart at a time we chose,
// take the Lagna it produced, throw the time away, and see whether the solver
// gets the time back. That cannot pass by accident, and it checks the solver
// against the same ephemeris the app reads rather than against my arithmetic.
//
//   npm run test:rectify

import { computeKundali } from '../assets/js/astro/compute.js';
import {
  lagnaAt, lagnaRate, signedDelta, solveLagna, targetFromRashi,
} from '../assets/js/astro/rectify.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} ${extra}`);
    failures += 1;
  }
};

const PUNE = { latitude: 18.5204, longitude: 73.8567, zone: 'Asia/Kolkata' };
const birthAt = (y, mo, d, h, mi, place = PUNE) => ({
  year: y, month: mo, day: d, hour: h, minute: mi, ...place,
});

console.log('signed difference wraps the short way round');
check('zero for the same degree', signedDelta(100, 100) === 0);
check('positive just past the target', Math.abs(signedDelta(101, 100) - 1) < 1e-9);
check('negative just before it', Math.abs(signedDelta(99, 100) + 1) < 1e-9);
check('across 0 Aries, forwards', Math.abs(signedDelta(1, 359) - 2) < 1e-9);
check('across 0 Aries, backwards', Math.abs(signedDelta(359, 1) + 2) < 1e-9);

console.log('a rashi and a degree make a longitude');
check('Aries 0 is 0', targetFromRashi(1, 0) === 0);
check('Gemini 15.28 is 75.28', Math.abs(targetFromRashi(3, 15.28) - 75.28) < 1e-9);
check('Pisces 29.99 is 359.99', Math.abs(targetFromRashi(12, 29.99) - 359.99) < 1e-9);
for (const [r, d, why] of [[0, 5, 'rashi 0'], [13, 5, 'rashi 13'], [1, 30, 'degree 30'], [1, -1, 'degree -1']]) {
  let threw = false;
  try { targetFromRashi(r, d); } catch { threw = true; }
  check(`${why} is refused rather than wrapped`, threw);
}

console.log('the cheap Lagna agrees with the whole kundali');
// If these drifted apart the solver would be answering a different question
// from the one the chart screen asks, and nothing else here would notice.
for (const [y, mo, d, h, mi] of [[1990, 4, 2, 6, 15], [1955, 11, 20, 23, 50], [2001, 7, 4, 12, 0]]) {
  const b = birthAt(y, mo, d, h, mi);
  const full = computeKundali(b);
  const cheap = lagnaAt(Date.parse(full.birth.utc), { ...PUNE, ayanamsa: b.ayanamsa });
  check(`${y}-${mo}-${d} ${h}:${mi} matches to a thousandth of a degree`,
    Math.abs(signedDelta(cheap, full.lagna.sidereal)) < 0.001,
    `${cheap} vs ${full.lagna.sidereal}`);
}

console.log('the round trip recovers a time that was thrown away');
// A spread of dates, hours and places, each knocked off by a different amount so
// a solver that simply returned the stated time could not pass.
const cases = [
  { b: birthAt(1990, 4, 2, 6, 15), off: 37 },
  { b: birthAt(1955, 11, 20, 23, 50), off: -84 },
  { b: birthAt(2001, 7, 4, 14, 30), off: 211 },
  { b: birthAt(1976, 2, 29, 0, 10), off: -45 },
  { b: birthAt(1947, 8, 15, 23, 55), off: 120 },
  { b: birthAt(1990, 4, 2, 6, 15, { latitude: 34.0837, longitude: 74.7973, zone: 'Asia/Kolkata' }), off: -17 },
  { b: birthAt(1990, 4, 2, 6, 15, { latitude: 8.0883, longitude: 77.5385, zone: 'Asia/Kolkata' }), off: 63 },
];

for (const { b, off } of cases) {
  const truth = computeKundali(b);
  const target = truth.lagna.sidereal;

  // The chart as someone would actually hold it: the right rising degree, the
  // wrong clock time.
  const stated = { ...b, minute: b.minute + off };
  const solved = solveLagna(stated, target);

  const label = `${b.year}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')} ${b.hour}:${String(b.minute).padStart(2, '0')} lat ${b.latitude}, off by ${off}m`;
  if (!solved.ok) {
    check(`${label} solves`, false, solved.reason);
    continue;
  }
  check(`${label}: recovers the time to the minute`,
    Math.abs(solved.best.shiftMinutes + off) <= 1,
    `shift ${solved.best.shiftMinutes}, wanted ${-off}`);

  // Rounding to the minute cannot cost more than half a minute of travel.
  check(`${label}: residual within half a minute of movement`,
    Math.abs(solved.best.residual) <= solved.best.rate / 2 + 1e-6,
    `residual ${solved.best.residual.toFixed(4)}, rate ${solved.best.rate.toFixed(4)}/min`);
}

console.log('and the recovered time rebuilds the whole chart');
// The point of the exercise: the Lagna is the anchor, but what the user wants
// back is every other degree.
const truth = computeKundali(birthAt(1990, 4, 2, 6, 15));
const solved = solveLagna(birthAt(1990, 4, 2, 9, 0), truth.lagna.sidereal);
check('a three-hour error is solved', solved.ok && Math.abs(solved.best.shiftMinutes + 165) <= 1,
  solved.ok ? `shift ${solved.best.shiftMinutes}` : solved.reason);

if (solved.ok) {
  const rebuilt = computeKundali(birthAt(1990, 4, 2, 9, 0 + solved.best.shiftMinutes));
  check('the Lagna rashi comes back', rebuilt.lagna.rashi === truth.lagna.rashi);
  check('the Lagna degree comes back within a hundredth',
    Math.abs(signedDelta(rebuilt.lagna.sidereal, truth.lagna.sidereal)) < 0.01,
    `${rebuilt.lagna.sidereal} vs ${truth.lagna.sidereal}`);
  // The Moon is the fastest of the bodies and so the strictest of these checks.
  check('the Moon comes back to within an arcminute',
    Math.abs(signedDelta(rebuilt.bodies.mo.sidereal, truth.bodies.mo.sidereal)) < 1 / 60,
    `${rebuilt.bodies.mo.sidereal} vs ${truth.bodies.mo.sidereal}`);
  check('every house placement is identical',
    Object.keys(truth.bodies).every((k) => rebuilt.bodies[k].house === truth.bodies[k].house));
}

console.log('an unknown birth time is the strongest case for this');
// Nothing to centre on but the middle of the day, and the whole day to search.
const unknown = solveLagna(birthAt(1990, 4, 2, 12, 0), truth.lagna.sidereal);
check('the whole day is searched from noon', unknown.ok, unknown.reason);
if (unknown.ok) {
  const recovered = 12 * 60 + unknown.best.shiftMinutes;
  check('and 06:15 is found', Math.abs(recovered - (6 * 60 + 15)) <= 1, `found ${recovered} minutes past midnight`);
}

console.log('each degree of the zodiac rises at its own time');
// Twelve targets a sign apart must give twelve well-separated times, which is
// what shows the search is finding the real crossing and not a fixed point.
const spread = [];
for (let r = 1; r <= 12; r += 1) {
  const s = solveLagna(birthAt(1990, 4, 2, 12, 0), targetFromRashi(r, 15), { windowMinutes: 720 });
  if (s.ok) spread.push(s.best.shiftMinutes);
}
check('all twelve are found', spread.length === 12, `${spread.length} found`);
check('and no two land on the same minute', new Set(spread).size === spread.length);
check('they cover most of a day',
  Math.max(...spread) - Math.min(...spread) > 20 * 60,
  `${Math.max(...spread) - Math.min(...spread)} minutes apart`);

console.log('a window wider than a sidereal day holds two crossings');
// 48 hours must contain the same degree rising twice, about 23h56m apart. Taking
// the nearer one silently would hide a genuine ambiguity.
const twice = solveLagna(birthAt(1990, 4, 2, 12, 0), truth.lagna.sidereal, { windowMinutes: 1440 });
check('both are reported', twice.ok && twice.solutions.length === 2,
  twice.ok ? `${twice.solutions.length} solution(s)` : twice.reason);
if (twice.ok && twice.solutions.length === 2) {
  const gap = Math.abs(twice.solutions[0].shiftMinutes - twice.solutions[1].shiftMinutes);
  check('a sidereal day apart, not a solar one', Math.abs(gap - (23 * 60 + 56)) <= 2, `${gap} minutes`);
  check('the nearer one is offered first',
    Math.abs(twice.solutions[0].shiftMinutes) < Math.abs(twice.solutions[1].shiftMinutes));
}

console.log('an unreachable target is refused, not approximated');
const narrow = solveLagna(birthAt(1990, 4, 2, 6, 15), truth.lagna.sidereal + 90, { windowMinutes: 10 });
check('a ten-minute window cannot find a degree six hours away', !narrow.ok);
check('and says so in words', typeof narrow.reason === 'string' && /does not reach/.test(narrow.reason), narrow.reason);

console.log('how tight the pin is depends on where and when');
// The rate is what the screen uses to tell the reader how much to trust the
// answer, so it has to be real rather than the textbook four minutes a degree.
const rates = [
  ['Pune, Pisces rising', birthAt(1990, 4, 2, 6, 15)],
  ['Srinagar, 34 north', birthAt(1990, 4, 2, 6, 15, { latitude: 34.0837, longitude: 74.7973, zone: 'Asia/Kolkata' })],
];
for (const [label, b] of rates) {
  const utc = Date.parse(computeKundali(b).birth.utc);
  const rate = lagnaRate(utc, { latitude: b.latitude, longitude: b.longitude });
  check(`${label}: a plausible rate`, rate > 0.05 && rate < 2, `${rate.toFixed(4)} deg/min`);
  console.log(`       ${label}: ${rate.toFixed(3)} deg/min, ${(1 / rate).toFixed(1)} min per degree`);
}

console.log('far north, where signs rise unevenly');
// Not India, but the code should not quietly produce nonsense if someone enters
// a European birth. Oslo at 60 north.
const oslo = { latitude: 59.9139, longitude: 10.7522, zone: 'Europe/Oslo' };
let northOk = 0;
for (let h = 0; h < 24; h += 3) {
  const b = birthAt(1980, 6, 15, h, 0, oslo);
  const t = computeKundali(b);
  const s = solveLagna({ ...b, hour: (h + 5) % 24 }, t.lagna.sidereal, { windowMinutes: 720 });
  if (s.ok && Math.abs(signedDelta(s.best.lagna, t.lagna.sidereal)) < 1) northOk += 1;
}
check('every hour of the day solves at 60 north', northOk === 8, `${northOk} of 8`);

console.log(failures ? `\n${failures} failure(s)` : '\nall rectification checks passed');
process.exit(failures ? 1 : 0);
