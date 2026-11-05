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
// Every mahadasha is covered now, so this is all nine rather than a subset.
// It was three for a while, and the gap was found by a reader looking for a
// Rahu sub-period and getting nothing - which is why the whole-grid check
// below exists rather than a count.
const COVERED = LORDS;

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
// The whole 9x9 grid, named cell by cell. A count of 81 would also pass with a
// duplicate and a hole in it, and a hole is exactly what a reader hits: they
// look up one sub-period, find nothing, and have no way to tell a gap from a
// condition that did not match.
const gaps = [];
for (const m of LORDS) for (const s of LORDS) if (!keys.includes(`${m}/${s}`)) gaps.push(`${m}/${s}`);
check('every one of the 81 pairs is written', gaps.length === 0, `missing ${gaps.join(', ')}`);

console.log('every pair cites the chapter for its own mahadasha');
// BPHS gives one chapter per mahadasha lord. Each pair must cite the chapter
// belonging to its own mahadasha and name a verse in it - a rule citing the
// right book but the wrong lord's chapter would read plausibly and be wrong,
// which is the failure this file exists to prevent.
const byMaha = (m) => antardashaRules.filter((r) => r.when.all.some((c) => c.dashaLord === m));
const keysOf = (rules) => new Set(rules.flatMap((r) => r.sources.map((s) => s.key)));
// BPHS ch. 52 to ch. 60, one per mahadasha lord in Vimshottari order of the
// grahas rather than of the dasha sequence. Citing the right book but a
// neighbouring lord's chapter would read perfectly and be wrong, so the mapping
// is pinned here rather than trusted.
const CHAPTER = { su: 52, mo: 53, ma: 54, ra: 55, ju: 56, sa: 57, me: 58, ke: 59, ve: 60 };

check('every pair cites BPHS', [...keysOf(antardashaRules)].join(',') === 'bphs',
  [...keysOf(antardashaRules)].join(','));

for (const [maha, ch] of Object.entries(CHAPTER)) {
  const rules = byMaha(maha);
  check(`the ${maha} pairs all cite ch. ${ch} with a verse`,
    rules.length === 9 && rules.every((r) => new RegExp(`^ch\\. ${ch}, \\d`).test(r.sources[0].locus)),
    rules.map((r) => r.sources[0].locus).join(' | '));
}

check('no two pairs claim the same verse',
  new Set(antardashaRules.map((r) => r.sources[0].locus)).size === antardashaRules.length);

// The key those rules used to sit on is now cited by nothing. Keeping it
// registered is fine; letting a rule drift back onto it unnoticed is not.
check('the old unverified key backs no rule any more',
  !antardashaRules.some((r) => r.sources.some((s) => s.key === 'antardasha-tradition')));

console.log('the rules say what they claim to say');

/** Every planet a condition actually tests, ignoring the two lord selectors. */
function planetsTested(cond, out = new Set()) {
  if (!cond || typeof cond !== 'object') return out;
  for (const [k, v] of Object.entries(cond)) {
    if (k === 'all' || k === 'any') v.forEach((c) => planetsTested(c, out));
    else if (k === 'not') planetsTested(v, out);
    else if (k === 'dashaLord' || k === 'antardashaLord') continue;
    else if (k === 'conjunct') v.forEach((pl) => out.add(pl));
    else if (k === 'relativeHouse') {
      if (v.from !== 'lagna') out.add(v.from);
      out.add(v.to);
    } else if (v && typeof v === 'object' && v.planet) out.add(v.planet);
  }
  return out;
}

// A condition about the wrong graha is the defect this file is most exposed to.
// These rules were generated in bulk from a table, and a condition copied from
// the row above would still validate, still fire, and still read plausibly.
for (const r of antardashaRules) {
  const [, maha, sub] = r.id.split('.');
  const stray = [...planetsTested(r.when)].filter((pl) => pl !== maha && pl !== sub);
  if (stray.length) check(`${r.id} tests only its own pair`, false, `also tests ${stray.join(', ')}`);
}
check('no condition tests a graha outside its own pair',
  antardashaRules.every((r) => {
    const [, maha, sub] = r.id.split('.');
    return [...planetsTested(r.when)].every((pl) => pl === maha || pl === sub);
  }));

// Bulk generation also invites duplicated prose - one pair's text pasted under
// another's id, which no other check would notice.
const openings = antardashaRules.map((r) => r.says.slice(0, 60));
check('no two pairs open with the same sentence',
  new Set(openings).size === openings.length,
  openings.filter((s, i) => openings.indexOf(s) !== i).join(' | '));

// The strongest structural check available. BPHS works through the sub-lords in
// the order their sub-periods run, so within a chapter the verse numbers must
// ascend in that order. A sub-lord assigned to the wrong verse - the likeliest
// transcription error - lands out of sequence and is caught here.
const VIM = ['ke', 've', 'su', 'mo', 'ma', 'ra', 'ju', 'sa', 'me'];
const firstVerse = (locus) => Number(/ch\. \d+, (\d+)/.exec(locus)?.[1]);
for (const maha of LORDS) {
  const start = VIM.indexOf(maha);
  const seq = Array.from({ length: 9 }, (_, i) => VIM[(start + i) % 9]);
  const verses = seq.map((sub) => {
    const r = kb.byId.get(`adsa.${maha}.${sub}`);
    return { sub, v: r ? firstVerse(r.sources[0].locus) : NaN };
  });
  const ascends = verses.every((x, i) => i === 0 || (x.v > verses[i - 1].v));
  check(`${maha}: verses ascend in the order the sub-periods run`, ascends,
    verses.map((x) => `${x.sub}:${x.v}`).join(' '));
}

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

// Not "exactly one for every covered sub-period". BPHS states nearly every pair
// conditionally on where the sub-lord sits, so a badly placed sub-lord has no
// rule for this chart - the adverse verses are not yet written.
check('no more than one per sub-period', everFired <= expectedFires,
  `${everFired} of at most ${expectedFires}`);
check('the conditions genuinely gate on placement',
  everFired < expectedFires,
  `all ${everFired} fired, so no condition excluded anything - the gate may not be working`);
check('but a fair share still fire', everFired > expectedFires / 3,
  `only ${everFired} of ${expectedFires}, which suggests the conditions are too tight`);

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
check('and it carries a primary weight now that BPHS is cited',
  finding && finding.weight > 0.35,
  `weight ${finding?.weight}`);

// Every pair now rests on a primary text, so none should sit at the weight an
// unverified key would give it.
const weights = [];
for (const maha of sequence) {
  for (const a of antardashas(maha)) {
    const c = { dasha: dashaFor(chart, birth, a.from + (a.to - a.from) / 2) };
    const f = compose(chart, kb, c).findings.find((x) => x.rule.id.startsWith('adsa.'));
    if (f) weights.push(f.weight);
  }
}
check('no pair is left at an unverified weight',
  weights.length > 0 && weights.every((w) => w > kb.base.sources.authorityWeight.unverified),
  weights.filter((w) => w <= kb.base.sources.authorityWeight.unverified).join(', '));

// Sun in Venus rests on a verse its own translator calls into question, so it
// is deliberately the least confident rule in the file.
const suInVe = kb.byId.get('adsa.ve.su');
check('the doubtful verse is the least confident pair',
  antardashaRules.every((r) => r.confidence >= suInVe.confidence),
  `${suInVe.confidence} vs min ${Math.min(...antardashaRules.map((r) => r.confidence))}`);

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
