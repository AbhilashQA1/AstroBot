// Print a reading for a chart from the command line. Useful for checking the
// engine without a browser, and for sanity-checking a rule you just added.
//
//   npm run read -- --lagna 5 --su 10 --mo 4 --ma 6 --me 10 --ju 9 --ve 11 --sa 3 --ra 1 --ke 7
//   npm run read -- --code 5.10.4.6.10.9.11.3.1.7

import { loadKnowledgeFromDisk } from './kb-node.mjs';
import { Chart, PLANET_KEYS, decodeChart, emptyChart } from '../assets/js/model.js';
import { compose, ordinal } from '../assets/js/engine.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const kb = await loadKnowledgeFromDisk();

let raw;
const code = flag('code');
if (code) {
  raw = decodeChart(code);
  if (!raw) {
    console.error(`could not read chart code "${code}"`);
    process.exit(1);
  }
} else {
  raw = emptyChart();
  raw.lagna = Number(flag('lagna') || 1);
  for (const p of PLANET_KEYS) {
    const v = flag(p);
    if (v === null) continue;
    const retro = v.endsWith('r');
    raw.placements[p] = { house: Number(retro ? v.slice(0, -1) : v), retro };
  }
}

const chart = new Chart(raw, kb.base);
const reading = compose(chart, kb);

const line = (s = '') => console.log(s);
const rule = () => line('-'.repeat(72));

line();
line(`LAGNA: ${chart.rashi(chart.signOfHouse(1)).en}  (${chart.rashi(chart.signOfHouse(1)).sa})`);
rule();
for (const r of chart.roster()) {
  if (!r.placed) {
    line(`  ${r.planet.en.padEnd(8)} not placed`);
    continue;
  }
  const dign = r.dignity.state === 'neutral' ? '' : ` [${r.dignity.state}]`;
  line(
    `  ${r.planet.en.padEnd(8)} ${r.rashi.en.padEnd(12)} house ${String(r.house).padStart(2)}` +
      `${r.retro ? ' R' : '  '}${dign}`,
  );
}
rule();
line(`matched ${reading.stats.matched} of ${reading.stats.ofTotal} rules`);
line();

line('THE SHAPE OF THE CHART');
for (const d of reading.derived) line(`  ${d.text}`);
line();

if (reading.combinations.length) {
  line('COMBINATIONS');
  for (const f of reading.combinations) {
    const name = f.rule.name || f.rule.id;
    line(`  * ${name}  (${f.weight})`);
    line(`      ${f.rule.says}`);
    line(`      -- ${f.citations.map((c) => `${c.label}${c.locus ? ` ${c.locus}` : ''}`).join('; ')}`);
    if (f.rule.note) line(`      note: ${f.rule.note}`);
  }
  line();
}

for (const section of reading.sections) {
  line(section.title.toUpperCase());
  for (const f of section.findings) {
    line(`  - ${f.rule.says}  (${f.weight})`);
    line(`      -- ${f.citations.map((c) => `${c.label}${c.locus ? ` ${c.locus}` : ''}`).join('; ')}`);
  }
  line();
}

if (reading.conflicts.pairs.length || reading.conflicts.disputed.length) {
  line('WHERE THE SOURCES DIFFER');
  for (const { a, b, reason } of reading.conflicts.pairs) {
    line(`  ? ${reason}:`);
    line(`      ${a.rule.says}`);
    line(`        (${a.citations.map((c) => c.label).join('; ')}, ${a.rule.polarity})`);
    line(`      versus`);
    line(`      ${b.rule.says}`);
    line(`        (${b.citations.map((c) => c.label).join('; ')}, ${b.rule.polarity})`);
  }
  for (const f of reading.conflicts.disputed) {
    line(`  ? disputed: ${f.rule.says}`);
  }
  line();
}

if (reading.broken.length) {
  line('BROKEN RULES');
  for (const b of reading.broken) line(`  x ${b.id}: ${b.reason}`);
}

line(`houses 1-12 hold: ${Array.from({ length: 12 }, (_, i) => `${ordinal(i + 1)} ${chart.rashi(chart.signOfHouse(i + 1)).en}`).join(', ')}`);
line();
