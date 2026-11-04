// Builds assets/data/places-in.json from the GeoNames India dump.
//
//   curl -o IN.zip https://download.geonames.org/export/dump/IN.zip
//   curl -o admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
//   unzip IN.zip
//   node scripts/build-places.mjs <path-to-IN.txt> <path-to-admin1CodesASCII.txt>
//
// GeoNames is CC BY 4.0, so the attribution in the output file and the README is
// a licence condition, not a courtesy.
//
// Of 660,000 Indian entries, only about 7,400 carry a population figure at all;
// the rest are villages GeoNames has never sized. Those 7,400 are kept whole
// rather than cut at some threshold - the saving from a higher cutoff is a few
// tens of kilobytes, and the cost is a town somebody was born in going missing.
// Births in unlisted villages are served by entering coordinates directly.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [placesPath, adminPath] = process.argv.slice(2);

if (!placesPath || !adminPath) {
  console.error('usage: node scripts/build-places.mjs <IN.txt> <admin1CodesASCII.txt>');
  process.exit(1);
}

// --- state names -----------------------------------------------------------
const states = {};
for (const line of readFileSync(adminPath, 'utf8').split('\n')) {
  const [code, name] = line.split('\t');
  if (!code?.startsWith('IN.')) continue;
  states[code.slice(3)] = name;
}

// --- places ----------------------------------------------------------------
// GeoNames columns: 1 name, 4 lat, 5 lon, 6 feature class, 10 admin1, 14 population
const best = new Map();
let scanned = 0;

for (const line of readFileSync(placesPath, 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  if (f[6] !== 'P') continue;
  scanned += 1;

  const population = Number(f[14]) || 0;
  if (population <= 0) continue;

  const name = f[1];
  const admin1 = f[10] || '';
  // The same name recurs across and within states. Key on both, and when a name
  // repeats inside one state keep the largest - that is the one a person means.
  const key = `${name}|${admin1}`;
  const existing = best.get(key);
  if (existing && existing.population >= population) continue;

  best.set(key, {
    name,
    admin1,
    lat: Math.round(Number(f[4]) * 1e4) / 1e4,
    lon: Math.round(Number(f[5]) * 1e4) / 1e4,
    population,
  });
}

const places = [...best.values()]
  .sort((a, b) => b.population - a.population)
  .map((p) => [p.name, p.admin1, p.lat, p.lon, p.population]);

const usedStates = {};
for (const p of places) if (states[p[1]]) usedStates[p[1]] = states[p[1]];

const out = {
  schema: 'astrobot/places@1',
  country: 'IN',
  zone: 'Asia/Kolkata',
  note:
    'Indian populated places with a known population, largest first. Columns are ' +
    '[name, admin1 code, latitude, longitude, population]. Coordinates are rounded ' +
    'to four decimals, about 11 metres, which is far finer than a birth record.',
  source: {
    name: 'GeoNames',
    url: 'https://www.geonames.org/',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  states: usedStates,
  places,
};

mkdirSync(join(ROOT, 'assets/data'), { recursive: true });
const target = join(ROOT, 'assets/data/places-in.json');
writeFileSync(target, `${JSON.stringify(out)}\n`, 'utf8');

const bytes = Buffer.byteLength(JSON.stringify(out));
console.log(`scanned ${scanned.toLocaleString()} populated places`);
console.log(`kept ${places.length.toLocaleString()} with a population figure`);
console.log(`${Object.keys(usedStates).length} states`);
console.log(`wrote ${target} (${(bytes / 1024).toFixed(0)} KB)`);
