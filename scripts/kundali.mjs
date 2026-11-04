// Compute a kundali from birth details, on the command line.
//
//   node scripts/kundali.mjs --date 1991-08-23 --time 05:45 --lat 26.8467 --lon 80.9462
//   node scripts/kundali.mjs --date 1879-03-14 --time 11:30 --lat 48.4 --lon 10.0 \
//       --zone Europe/Berlin --offset 60 --name "Albert Einstein"
//
// Add --read to run the knowledge engine over the result, which is the quickest
// way to see a computed chart interpreted end to end.

import { AYANAMSAS, formatAngle } from '../assets/js/astro/ayanamsa.js';
import { computeKundali, toChartPlacements } from '../assets/js/astro/compute.js';
import { Chart } from '../assets/js/model.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

if (has('help') || !flag('date')) {
  console.log(`
Compute a kundali from birth details.

  --date   YYYY-MM-DD           required
  --time   HH:MM                default 12:00
  --lat    decimal degrees      default 28.6139 (Delhi), north positive
  --lon    decimal degrees      default 77.2090, east positive
  --zone   IANA zone            default Asia/Kolkata
  --offset minutes              explicit UTC offset, overrides --zone
  --name   label
  --ayanamsa  ${Object.keys(AYANAMSAS).join(' | ')}   default lahiri
  --true-node                   use the true node instead of the mean node
  --read                        also print the reading
`);
  process.exit(flag('date') ? 0 : 1);
}

const [year, month, day] = flag('date').split('-').map(Number);
const [hour, minute] = (flag('time', '12:00')).split(':').map(Number);
const offset = flag('offset');

const birth = {
  year,
  month,
  day,
  hour,
  minute,
  latitude: Number(flag('lat', 28.6139)),
  longitude: Number(flag('lon', 77.209)),
  zone: flag('zone', 'Asia/Kolkata'),
  ayanamsa: flag('ayanamsa', 'lahiri'),
  trueNode: has('true-node'),
  ...(offset === null ? {} : { offsetMinutes: Number(offset) }),
};

const RASHI = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const NAMES = {
  su: 'Sun', mo: 'Moon', ma: 'Mars', me: 'Mercury', ju: 'Jupiter', ve: 'Venus',
  sa: 'Saturn', ra: 'Rahu', ke: 'Ketu', ur: 'Uranus', ne: 'Neptune', pl: 'Pluto',
};
const ORDER = ['su', 'mo', 'ma', 'me', 'ju', 've', 'sa', 'ra', 'ke', 'ur', 'ne', 'pl'];

const r = computeKundali(birth);
const rule = () => console.log('-'.repeat(72));

console.log();
if (flag('name')) console.log(flag('name'));
console.log(`${flag('date')} ${flag('time', '12:00')}  ${birth.zone}  (UTC${r.birth.offset})`);
console.log(`${birth.latitude.toFixed(4)}  ${birth.longitude.toFixed(4)}   UTC ${r.birth.utc}`);
console.log(`${AYANAMSAS[birth.ayanamsa].name}  ${formatAngle(r.ayanamsa)}   ${birth.trueNode ? 'true node' : 'mean node'}`);
rule();
console.log(`LAGNA  ${RASHI[r.lagna.rashi - 1]}  ${formatAngle(r.lagna.degree)}`);
rule();

for (const key of ORDER) {
  const b = r.bodies[key];
  const outer = ['ur', 'ne', 'pl'].includes(key) ? '  (outside the classical nine)' : '';
  console.log(
    `  ${NAMES[key].padEnd(8)} ${RASHI[b.rashi - 1].padEnd(12)} ${formatAngle(b.degree).padStart(16)}` +
    `   house ${String(b.house).padStart(2)}${b.retro ? '  R' : '   '}${outer}`,
  );
}
rule();
console.log(`sidereal time ${r.siderealTime.toFixed(4)} deg   obliquity ${formatAngle(r.obliquity)}`);
console.log(`midheaven ${RASHI[Math.floor(r.midheaven.sidereal / 30)]} ${formatAngle(r.midheaven.sidereal % 30)}`);

for (const w of r.warnings) console.log(`\n!  ${w}`);

if (has('read')) {
  const { loadKnowledgeFromDisk } = await import('./kb-node.mjs');
  const { compose } = await import('../assets/js/engine.js');
  const kb = await loadKnowledgeFromDisk();
  const { lagna, placements } = toChartPlacements(r);
  const reading = compose(new Chart({ lagna, placements }, kb.base), kb);

  console.log();
  rule();
  console.log(`THE READING   (${reading.stats.matched} of ${reading.stats.ofTotal} rules matched)`);
  rule();
  for (const d of reading.derived) console.log(`  ${d.text}`);
  for (const f of reading.combinations) console.log(`\n  * ${f.rule.name || f.rule.id}\n      ${f.rule.says}`);
  for (const section of reading.sections) {
    console.log(`\n${section.title.toUpperCase()}`);
    for (const f of section.findings) console.log(`  - ${f.rule.says}`);
  }
}

console.log();
