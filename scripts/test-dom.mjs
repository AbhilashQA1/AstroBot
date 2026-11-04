// Checks that the ids the scripts look up actually exist in index.html.
//
// Honest about what this does and does not catch. It would NOT have caught the
// stale-shell bug that prompted it: there the markup in the repository was
// correct and a cached copy of an older page was served against newer code, so
// no static check could have seen it. What it does catch is the neighbouring
// mistake, which is far more common — renaming or removing an element and
// leaving a selector behind, where the symptom is identical: a null dereference
// that throws out of boot and leaves the app with no event listeners at all.
//
//   node scripts/test-dom.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// Elements the scripts build at runtime rather than find in the markup. Each
// one is listed deliberately: the point of this file is that an id which is in
// neither place is a bug, so the exceptions have to be stated rather than
// inferred. Both of these are appended by the code that later looks them up,
// and both lookups are already guarded.
const CREATED_AT_RUNTIME = new Set([
  'sheet-status',
  'reading-status',
]);

const SCRIPTS = [
  'assets/js/app.js',
  'assets/js/birth.js',
  'assets/js/library.js',
  'assets/js/chartview.js',
];

let passed = 0;
const failures = [];

for (const rel of SCRIPTS) {
  let source;
  try {
    source = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    failures.push(`${rel}: cannot be read`);
    continue;
  }

  const selectors = new Set([
    ...[...source.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]),
    ...[...source.matchAll(/querySelector\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]),
  ]);

  for (const id of selectors) {
    if (ids.has(id) || CREATED_AT_RUNTIME.has(id)) {
      passed += 1;
    } else {
      failures.push(`${rel}: looks up #${id}, which is not in index.html`);
    }
  }
}

// The views the router can switch to must all exist, or a tab leads nowhere.
const appSource = readFileSync(join(ROOT, 'assets/js/app.js'), 'utf8');
const routed = new Set([...appSource.matchAll(/show\('([a-z-]+)'\)/g)].map((m) => m[1]));
for (const view of routed) {
  if (ids.has(`view-${view}`)) passed += 1;
  else failures.push(`app.js routes to "${view}", but there is no #view-${view} section`);
}

// Every tab in the markup must name a view that exists.
const tabs = [...html.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
for (const view of tabs) {
  if (ids.has(`view-${view}`)) passed += 1;
  else failures.push(`a tab points at "${view}", but there is no #view-${view} section`);
}

// The service worker must not serve the page itself from the cache. That is the
// drift that broke the first kundali deploy: a cached index.html handed to a
// page whose scripts were current.
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
if (/request\.mode === 'navigate'/.test(sw)) passed += 1;
else failures.push('sw.js no longer special-cases navigation requests; the page must be network-first');

console.log(`dom: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log('test-dom: OK');
