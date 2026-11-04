// Loads the knowledge base from disk, for the validator, the CLI reader and the
// ingestion workflow. The browser uses assets/js/kb.js instead, which fetches
// over HTTP; both end up with the same shape.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseFile } from '../assets/js/kb.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const KB_DIR = join(ROOT, 'knowledge');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadKnowledgeFromDisk() {
  const index = await readJson(join(KB_DIR, 'index.json'));

  const [planets, rashis, houses, sources] = await Promise.all([
    readJson(join(KB_DIR, 'base/planets.json')),
    readJson(join(KB_DIR, 'base/rashis.json')),
    readJson(join(KB_DIR, 'base/houses.json')),
    readJson(join(KB_DIR, 'base/sources.json')),
  ]);

  const rules = [];
  const problems = [];
  const seen = new Set();

  for (const relPath of index.rules) {
    let file;
    try {
      file = await readJson(join(KB_DIR, relPath));
    } catch (err) {
      problems.push({ path: relPath, error: `cannot read: ${err.message}` });
      continue;
    }
    for (const rule of normaliseFile(file, relPath)) {
      if (!rule.id) {
        problems.push({ path: relPath, error: 'a rule has no id' });
        continue;
      }
      if (seen.has(rule.id)) {
        problems.push({ path: relPath, error: `duplicate rule id ${rule.id}` });
        continue;
      }
      seen.add(rule.id);
      rules.push(rule);
    }
  }

  return {
    base: { planets, rashis, houses, sources },
    rules,
    byId: new Map(rules.map((r) => [r.id, r])),
    problems,
    index,
  };
}
