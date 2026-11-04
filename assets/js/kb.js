// Loads the knowledge base and normalises it.
// Every rule comes back with its file-level defaults already folded in, so the
// engine never has to know where a field came from.

const KB_ROOT = 'knowledge/';

async function getJson(path) {
  const res = await fetch(`${KB_ROOT}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fold `defaults` into each rule and stamp it with its family and source file.
 * A rule that sets a field wins over the default; nothing is merged deeply.
 */
export function normaliseFile(file, path) {
  const defaults = file.defaults || {};
  return (file.rules || []).map((rule) => ({
    family: rule.family || file.family,
    tradition: rule.tradition || defaults.tradition || 'parashari',
    status: rule.status || defaults.status || 'active',
    added: rule.added || defaults.added || null,
    sources: rule.sources || defaults.sources || [],
    confidence: typeof rule.confidence === 'number' ? rule.confidence : 0.6,
    polarity: rule.polarity || 'neutral',
    themes: rule.themes || [],
    ...rule,
    file: path,
  }));
}

export async function loadKnowledge() {
  const index = await getJson('index.json');

  const [planets, rashis, houses, sources] = await Promise.all([
    getJson('base/planets.json'),
    getJson('base/rashis.json'),
    getJson('base/houses.json'),
    getJson('base/sources.json'),
  ]);

  const rules = [];
  const problems = [];

  const files = await Promise.all(
    index.rules.map(async (path) => {
      try {
        return { path, file: await getJson(path) };
      } catch (err) {
        problems.push({ path, error: err.message });
        return null;
      }
    }),
  );

  const seen = new Set();
  for (const entry of files) {
    if (!entry) continue;
    for (const rule of normaliseFile(entry.file, entry.path)) {
      if (!rule.id) {
        problems.push({ path: entry.path, error: 'a rule has no id' });
        continue;
      }
      if (seen.has(rule.id)) {
        problems.push({ path: entry.path, error: `duplicate rule id ${rule.id}` });
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
    updated: index.updated,
    counts: countBy(rules),
  };
}

function countBy(rules) {
  const byFamily = {};
  const byTradition = {};
  for (const r of rules) {
    byFamily[r.family] = (byFamily[r.family] || 0) + 1;
    byTradition[r.tradition] = (byTradition[r.tradition] || 0) + 1;
  }
  return { total: rules.length, byFamily, byTradition };
}

/** Resolve a rule's citations into display-ready strings. */
export function citations(rule, sourcesFile) {
  return (rule.sources || []).map((ref) => {
    const src = sourcesFile.sources[ref.key];
    if (!src) return { key: ref.key, label: ref.key, authority: 'unverified', locus: ref.locus };
    return {
      key: ref.key,
      label: src.title,
      author: src.author,
      authority: src.authority || 'secondary',
      locus: ref.locus || null,
      repoPath: src.repoPath || null,
    };
  });
}

/** The strongest authority weight among a rule's sources. */
export function authorityWeight(rule, sourcesFile) {
  const weights = (rule.sources || []).map((ref) => {
    const src = sourcesFile.sources[ref.key];
    const authority = src?.authority || 'unverified';
    return sourcesFile.authorityWeight[authority] ?? 0.35;
  });
  return weights.length ? Math.max(...weights) : 0.35;
}
