// Combustion (asta): a graha inside its orb of the Sun is burnt.
//
// The cases worth pinning down are the ones that make combustion impossible to
// fake from house positions, and the ones where the honest answer is "cannot
// tell" rather than "clear".
//
//   npm run test:combustion

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

/** A chart computed at Pune, 06:15 local, on the given date. */
function computed(year, month, day) {
  const p = toChartPlacements(computeKundali({
    year, month, day, hour: 6, minute: 15,
    latitude: 18.5204, longitude: 73.8567, zone: 'Asia/Kolkata',
  }));
  const raw = emptyChart();
  raw.lagna = p.lagna;
  raw.placements = p.placements;
  return new Chart(raw, kb.base);
}

/** The same chart with every degree stripped, as if it had been typed in. */
function degreeless(chart) {
  const raw = emptyChart();
  raw.lagna = chart.lagna;
  for (const [k, v] of Object.entries(chart.placements)) {
    raw.placements[k] = { house: v.house, retro: v.retro };
  }
  return new Chart(raw, kb.base);
}

console.log('longitude is reconstructed, not stored');
const c1 = computed(1990, 4, 2);
const direct = computeKundali({
  year: 1990, month: 4, day: 2, hour: 6, minute: 15,
  latitude: 18.5204, longitude: 73.8567, zone: 'Asia/Kolkata',
}).bodies.su.sidereal;
check('rebuilt from Lagna, house and degree, exactly',
  Math.abs(c1.siderealLongitude('su') - direct) < 1e-9,
  `${c1.siderealLongitude('su')} vs ${direct}`);

console.log('what combustion applies to');
check('the Sun cannot be combust', c1.combustion('su').state === 'na');
check('Rahu has no body to burn', c1.combustion('ra').state === 'na');
check('Ketu likewise', c1.combustion('ke').state === 'na');
check('the outer planets are outside the doctrine', c1.combustion('ur').state === 'na');
check('Mercury does take an orb', ['combust', 'clear'].includes(c1.combustion('me').state));

console.log('the case a house-based shortcut would miss');
// 2 April 1990: Mercury is 13.87 deg from the Sun and therefore burnt, while
// sitting in the next house along. Roughly a quarter of combust cases look
// like this, so inferring combustion from a shared house would miss them.
check('Mercury is combust', c1.combustion('me').state === 'combust');
check('and is NOT in the Sun\'s house',
  c1.houseOf('me') !== c1.houseOf('su'),
  `su ${c1.houseOf('su')}, me ${c1.houseOf('me')}`);

console.log('the converse: sharing the house without being burnt');
let sharedButClear = null;
for (let m = 1; m <= 12 && !sharedButClear; m += 1) {
  for (let d = 1; d <= 28; d += 1) {
    const c = computed(1991, m, d);
    if (c.houseOf('ve') === c.houseOf('su') && c.combustion('ve').state === 'clear') {
      sharedButClear = c;
      break;
    }
  }
}
check('found a chart where Venus shares the Sun\'s house and is clear', !!sharedButClear);
if (sharedButClear) {
  check('and it is reported clear, not burnt',
    sharedButClear.combustion('ve').state === 'clear',
    `${sharedButClear.combustion('ve').separation} deg`);
}

console.log('a chart without degrees cannot tell, and says so');
const bare = degreeless(c1);
check('Mercury is unknown, not clear', bare.combustion('me').state === 'unknown');
check('the combust list is empty', bare.combust.length === 0);
check('the Sun is still na rather than unknown', bare.combustion('su').state === 'na');

console.log('retrograde takes the tighter orb');
let retroCase = null;
for (let m = 1; m <= 12 && !retroCase; m += 1) {
  for (let d = 1; d <= 28; d += 1) {
    const c = computed(1990, m, d);
    if (c.isRetrograde('me') && c.combustion('me').state !== 'unknown') {
      retroCase = c;
      break;
    }
  }
}
check('found a chart with Mercury retrograde', !!retroCase);
if (retroCase) {
  check('Mercury retrograde uses the 12 degree orb, not 14',
    retroCase.combustion('me').orb === 12,
    `orb ${retroCase.combustion('me').orb}`);
}

console.log('the engine acts on it');
// 5 January 1990: Sun and Mercury share house 1 and Mercury is burnt, which is
// the configuration where the sources actually disagree.
const c2 = computed(1990, 1, 5);
check('Sun and Mercury share a house', c2.houseOf('su') === c2.houseOf('me'));
check('Mercury is burnt', c2.combustion('me').state === 'combust');

const reading = compose(c2, kb);
const ids = new Set(reading.findings.map((f) => f.rule.id));
check('the combustion rule fires', ids.has('cmb.me'));
check('Budha-Aditya still fires', ids.has('yog.budha-aditya'));
check('and so does the reading that contests it', ids.has('yog.budha-aditya.burnt'));

const pair = reading.conflicts.pairs.find(
  (p) => [p.a.rule.id, p.b.rule.id].sort().join('|') === 'yog.budha-aditya|yog.budha-aditya.burnt',
);
check('the two are shown as a conflict rather than one winning', !!pair);
check('and it is a stated conflict', pair?.reason === 'stated');

const burntRule = reading.findings.find((f) => f.rule.id === `pih.me.${c2.houseOf('me')}`);
check('a rule about the burnt graha is weighted down', burntRule?.combustion?.state === 'combust');

const bareReading = compose(degreeless(c2), kb);
const bareFinding = bareReading.findings.find((f) => f.rule.id === `pih.me.${c2.houseOf('me')}`);
check('the same rule weighs more when combustion is unknown',
  bareFinding && burntRule && bareFinding.weight > burntRule.weight,
  `${bareFinding?.weight} vs ${burntRule?.weight}`);

const bareIds = new Set(bareReading.findings.map((f) => f.rule.id));
check('no combustion rule fires without degrees', !bareIds.has('cmb.me'));
check('the contested yoga does not fire either', !bareIds.has('yog.budha-aditya.burnt'));

console.log('the reading explains itself');
check('a computed chart names what is burnt',
  reading.derived.some((d) => d.kind === 'combustion' && /Combust:/.test(d.text)));
check('a hand-entered chart says it cannot judge',
  bareReading.derived.some((d) => d.kind === 'combustion' && /cannot be judged/.test(d.text)));

console.log(failures ? `\n${failures} failure(s)` : '\nall combustion checks passed');
process.exit(failures ? 1 : 0);
