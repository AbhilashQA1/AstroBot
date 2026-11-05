// Antardasha rules: the sub-period inside the running mahadasha.
//
// The `antardashaLord` condition shipped with the dasha engine but no rule used
// it and nothing tested it, so it was a capability nobody had exercised. These
// checks cover the condition itself and the rules now written against it.
//
// The structural checks matter more than they look. Exactly one pair can be true
// at a time, so a duplicated pair would be a rule that can never fire, and a
// missing pair is a sub-period the reading says nothing about - neither shows up
// as an error anywhere else.
//
//   npm run test:antardasha

import { computeKundali, toChartPlacements } from '../assets/js/astro/compute.js';
import { Chart, emptyChart } from '../assets/js/model.js';
import { compose, evaluate } from '../assets/js/engine.js';
import { dashaFor, mahadashas, antardashas } from '../assets/js/astro/dasha.js';
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

const LORDS = ['su', 'mo', 'ma', 'me', 'ju', 've', 'sa', 'ra', 'ke'];
const COVERED = ['sa', 've', 'ma']; // the mahadashas this file claims to cover

/** A calculated chart, and the app-level birth record the dasha needs. */
function chartFor(year, month, day, hour, minute) {
  const astro = {
    year, month, day, hour, minute,
    latitude: 18.5204, longitude: 73.8567, zone: 'Asia/Kolkata',
  };
  const { lagna, placements } = toChartPlacements(computeKundali(astro));
  const raw = emptyChart();
  raw.lagna = lagna;
  raw.placements = placements;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    chart: new Chart(raw, kb.base),
    birth: { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}`, zone: 'Asia/Kolkata' },
  };
}

const antardashaRules = kb.rules.filter((r) => r.file.includes('antardasha'));

console.log('the rules are structurally sound');
check('the file loaded', antardashaRules.length > 0, `${antardashaRules.length} rules`);

const pairs = antardashaRules.map((r) => {
  const parts = r.when?.all || [];
  return {
    id: r.id,
    maha: parts.find((p) => p.dashaLord)?.dashaLord,
    antar: parts.find((p) => p.antardashaLord)?.antardashaLord,
  };
});

check('every rule names both lords', pairs.every((p) => p.maha && p.antar),
  pairs.filter((p) => !p.maha || !p.antar).map((p) => p.id).join(', '));
check('every lord named is a real graha',
  pairs.every((p) => LORDS.includes(p.maha) && LORDS.includes(p.antar)));

const keys = pairs.map((p) => `${p.maha}/${p.antar}`);
check('no pair is written twice', new Set(keys).size === keys.length,
  keys.filter((k, i) => keys.indexOf(k) !== i).join(', '));

// Each mahadasha claimed must be complete across all nine sub-lords. A gap here
// is a sub-period the reading would pass over in silence.
for (const maha of COVERED) {
  const subs = pairs.filter((p) => p.maha === maha).map((p) => p.antar);
  const missing = LORDS.filter((l) => !subs.includes(l));
  check(`the ${maha} mahadasha covers all nine sub-lords`, missing.length === 0,
    `missing ${missing.join(', ')}`);
}
check('and no other mahadasha is half-covered',
  pairs.every((p) => COVERED.includes(p.maha)),
  [...new Set(pairs.filter((p) => !COVERED.includes(p.maha)).map((p) => p.maha))].join(', '));

console.log('the citation is honest about being unverified');
// These were reasoned from the tradition, not read out of a named text. If the
// key ever claims otherwise without someone doing the reading, that is a quiet
// promotion of unchecked material.
const keyed = new Set(antardashaRules.flatMap((r) => r.sources.map((s) => s.key)));
check('every rule cites antardasha-tradition', keyed.size === 1 && keyed.has('antardasha-tradition'),
  [...keyed].join(', '));
check('and that key is registered as unverified',
  kb.base.sources.sources['antardasha-tradition']?.authority === 'unverified',
  kb.base.sources.sources['antardasha-tradition']?.authority);
check('so it weighs least of all the authorities',
  kb.base.sources.authorityWeight.unverified
    === Math.min(...Object.values(kb.base.sources.authorityWeight)));

console.log('exactly one pair can be true at a time');
// Walk a whole life and assert it at every sub-period boundary rather than at one
// convenient date: this is the property the whole file depends on.
const { chart, birth } = chartFor(1990, 4, 2, 6, 15);
const moon = chart.siderealLongitude('mo');
const birthMs = Date.parse(computeKundali({
  year: 1990, month: 4, day: 2, hour: 6, minute: 15,
  latitude: 18.5204, longitude: 73.8567, zone: 'Asia/Kolkata',
}).birth.utc);

// Not 81. The opening mahadasha is truncated - the Moon had already travelled
// part of its nakshatra by birth, so the sub-periods already spent are dropped -
// and only the later periods carry all nine. Asserting a flat 81 would be
// asserting my own assumption rather than what the engine does.
const sequence = mahadashas(moon, birthMs);
const expectedSamples = sequence.reduce((n, m) => n + antardashas(m).length, 0);
const expectedFires = sequence
  .filter((m) => COVERED.includes(m.lord))
  .reduce((n, m) => n + antardashas(m).length, 0);

let sampled = 0;
let everFired = 0;
let multiple = 0;
for (const maha of sequence) {
  for (const antar of antardashas(maha)) {
    // The middle of each sub-period, so a boundary rounding cannot decide it.
    const at = antar.from + (antar.to - antar.from) / 2;
    const ctx = { dasha: dashaFor(chart, birth, at) };
    const fired = evaluate(chart, { ...kb, rules: antardashaRules }, ctx).findings;
    sampled += 1;
    if (fired.length > 1) multiple += 1;
    if (fired.length === 1) {
      everFired += 1;
      const p = pairs.find((x) => x.id === fired[0].rule.id);
      if (p.maha !== ctx.dasha.maha.lord || p.antar !== ctx.dasha.antar.lord) {
        check(`the rule that fired matches the running pair at ${new Date(at).toISOString().slice(0, 10)}`, false,
          `${p.maha}/${p.antar} vs ${ctx.dasha.maha.lord}/${ctx.dasha.antar.lord}`);
      }
    }
  }
}
check('every sub-period of the whole cycle was sampled',
  sampled === expectedSamples, `${sampled} of ${expectedSamples}`);
check('the opening period is the only short one',
  sequence.slice(1).every((m) => antardashas(m).length === 9)
    && antardashas(sequence[0]).length <= 9,
  `opening has ${antardashas(sequence[0]).length}`);
check('fewer than nine per period only at the start',
  expectedSamples === 81 - (9 - antardashas(sequence[0]).length),
  `${expectedSamples}`);
check('never two rules at once', multiple === 0, `${multiple} sub-period(s) matched more than one`);
check('and exactly one fired for every covered sub-period',
  everFired === expectedFires, `${everFired} of ${expectedFires}`);

console.log('the reading carries it, and dates it');
// A date inside the Saturn mahadasha, Moon antardasha for this chart.
const at = Date.parse('2026-11-05');
const ctx = { dasha: dashaFor(chart, birth, at) };
check('the running pair is Saturn/Moon', ctx.dasha.maha.lord === 'sa' && ctx.dasha.antar.lord === 'mo',
  `${ctx.dasha.maha.lord}/${ctx.dasha.antar.lord}`);

const reading = compose(chart, kb, ctx);
const ids = new Set(reading.findings.map((f) => f.rule.id));
check('the Saturn/Moon rule fires', ids.has('adsa.sa.mo'));
check('a rule for another sub-lord does not', !ids.has('adsa.sa.ve'));

const section = reading.sections.find((s) => s.key === 'period');
check('it lands in the dated section rather than a permanent one',
  !!section?.findings.some((f) => f.rule.id === 'adsa.sa.mo'),
  section ? section.findings.map((f) => f.rule.id).join(', ') : 'no period section');

const finding = reading.findings.find((f) => f.rule.id === 'adsa.sa.mo');
check('and it is weighted down for being unverified',
  finding && finding.weight < 0.35,
  `weight ${finding?.weight}`);

console.log('a chart that cannot support a dasha gets none of this');
const bare = emptyChart();
bare.lagna = 1;
for (const [i, p] of LORDS.entries()) bare.placements[p] = { house: (i % 12) + 1, retro: false };
const bareChart = new Chart(bare, kb.base);
const bareCtx = { dasha: dashaFor(bareChart, { date: '1990-04-02', time: '06:15' }) };
check('a hand-entered chart has no dasha', bareCtx.dasha.available === false);
check('and no antardasha rule fires',
  evaluate(bareChart, { ...kb, rules: antardashaRules }, bareCtx).findings.length === 0);

console.log(failures ? `\n${failures} failure(s)` : '\nall antardasha checks passed');
process.exit(failures ? 1 : 0);
