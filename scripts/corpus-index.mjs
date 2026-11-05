// Builds corpus/index.json: what each cited book is, and what chapters it has.
//
// Why this exists. Rules cite a book and a chapter, and until now nothing could
// check that the chapter was the right one - or that it existed. Five rules were
// found citing Saravali ch. 10 for same-house conjunctions, which in the copy the
// project references is a chapter on evils at birth. That was found by reading.
// This file is the machine-readable version of that reading.
//
// What is committed and what is not. The index is committed: it records chapter
// numbers, chapter titles and offsets, which are facts about the books rather
// than their contents. The books themselves are NOT committed and must not be -
// the collection is third-party copyrighted material, this repository is public,
// and the Pages deploy publishes everything in it. corpus/books/ is gitignored.
//
//   node scripts/corpus-index.mjs fetch    # pull the cited books locally (~147 MB)
//   node scripts/corpus-index.mjs build    # (re)build corpus/index.json
//   node scripts/corpus-index.mjs audit    # check every rule citation against it
//
// Extraction is best effort and says so. Several of these are scans with no text
// layer; for those the index records extractable: false, which is itself worth
// knowing - it marks a source whose citations cannot be verified without OCR.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOOKS = join(ROOT, 'corpus', 'books');
const INDEX = join(ROOT, 'corpus', 'index.json');
const REPO = 'ayushman1024/ASTROLOGY-BOOKS-DATABASE';

const sources = JSON.parse(readFileSync(join(ROOT, 'knowledge/base/sources.json'), 'utf8'));

/** The sources that name a file in the collection, as [key, repoPath] pairs. */
function cited() {
  return Object.entries(sources.sources)
    .filter(([, s]) => s.repoPath)
    .map(([key, s]) => [key, s.repoPath]);
}

/** A local filename that cannot collide and does not depend on the shape of the path. */
const localName = (key, repoPath) => `${key}${repoPath.slice(repoPath.lastIndexOf('.'))}`;

/* ------------------------------------------------------------------ fetch */

function fetchAll() {
  mkdirSync(BOOKS, { recursive: true });
  for (const [key, repoPath] of cited()) {
    const out = join(BOOKS, localName(key, repoPath));
    // A tiny file is a failed download, not a book. Re-fetch it rather than
    // treating it as present, which is how an earlier bug left a directory of
    // empty files that the indexer then reported as unextractable scans.
    if (existsSync(out) && statSync(out).size > 1024) {
      console.log(`  have   ${key}  ${(statSync(out).size / 1048576).toFixed(1)} MB`);
      continue;
    }
    // Through gh so the request is authenticated and rate limits are the user's.
    //
    // Raw bytes, not the JSON contents payload. That endpoint inlines base64
    // only for files under 1 MB and returns an empty content field above it, so
    // asking for JSON silently writes an empty file for every large book - which
    // is most of them.
    const encoded = repoPath.split('/').map(encodeURIComponent).join('/');
    try {
      const bytes = execFileSync('gh', [
        'api', '-H', 'Accept: application/vnd.github.raw', `repos/${REPO}/contents/${encoded}`,
      ], { maxBuffer: 1024 * 1024 * 256, encoding: 'buffer' });
      if (bytes.length < 1024) throw new Error(`only ${bytes.length} bytes came back`);
      writeFileSync(out, bytes);
      console.log(`  got    ${key}  ${(statSync(out).size / 1048576).toFixed(1)} MB`);
    } catch (err) {
      console.log(`  FAILED ${key}: ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\nIn ${BOOKS}. Not committed, and must not be.`);
}

/* ---------------------------------------------------------------- extract */

/** Plain text of a local book, or null when it has no text layer we can reach. */
function textOf(file) {
  if (/\.pdf$/i.test(file)) {
    try {
      const out = execFileSync('pdftotext', ['-layout', file, '-'], {
        maxBuffer: 1024 * 1024 * 256, encoding: 'utf8',
      });
      return out.trim().length > 2000 ? out : null;
    } catch {
      return null;
    }
  }
  if (/\.(html?|htm)$/i.test(file)) {
    const raw = readFileSync(file, 'utf8')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const txt = raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
    return txt.trim().length > 2000 ? txt : null;
  }
  if (/\.doc$/i.test(file)) {
    // Word 97 keeps run text as cp1252 in the stream; pull the printable runs.
    const buf = readFileSync(file, 'latin1');
    const runs = buf.match(/[\x20-\x7e\n\r\t]{40,}/g) || [];
    const txt = runs.join('\n');
    return txt.trim().length > 2000 ? txt : null;
  }
  return null;
}

/* --------------------------------------------------------------- detectors */

// Each detector returns chapters as { n, title }. They are tried in order and
// the first to find a plausible run wins, with the winner recorded in the index
// so a surprising result can be traced to how it was found rather than guessed at.
const DETECTORS = [
  {
    // Saravali: every chapter ends with a colophon naming its number and title.
    // The most trustworthy of these, because the book states it about itself.
    name: 'colophon',
    find(text) {
      const out = [];
      const re = /Thus ends the\s+(\d+)(?:st|nd|rd|th)?\s*Ch\.?,?\s*(?:entitled\s*)?([^\n]{0,70}?)(?:\s+in|\s+of|\.|$)/gi;
      for (const m of text.matchAll(re)) {
        out.push({ n: Number(m[1]), title: m[2].trim().replace(/\s+/g, ' ') });
      }
      return out;
    },
  },
  {
    // BPHS: "Ch. 57. Effects of the Antar Dashas in the Dasha of Sani".
    name: 'ch-heading',
    find(text) {
      const seen = new Map();
      const re = /(?:^|\n)\s*Ch\.\s*(\d+)\.\s*([^\n]{3,80})/g;
      for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        const title = m[2].trim().replace(/\s+/g, ' ');
        // Keep the longest title seen for a number: the table of contents entry
        // is often truncated where the body heading is not.
        if (!seen.has(n) || seen.get(n).length < title.length) seen.set(n, title);
      }
      return [...seen].map(([n, title]) => ({ n, title }));
    },
  },
  {
    name: 'chapter-word',
    find(text) {
      const seen = new Map();
      const re = /(?:^|\n)\s*Chapter\s+(\d+)\s*[.:\-]?\s*([^\n]{0,80})/gi;
      for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        const title = (m[2] || '').trim().replace(/\s+/g, ' ');
        if (!seen.has(n) || seen.get(n).length < title.length) seen.set(n, title);
      }
      return [...seen].map(([n, title]) => ({ n, title }));
    },
  },
];

/** Is this run of chapters plausible, or did the detector match noise? */
function plausible(chapters) {
  if (chapters.length < 5) return false;
  const ns = [...new Set(chapters.map((c) => c.n))].sort((a, b) => a - b);
  // Mostly contiguous from a low number: a real chapter list, not scattered hits.
  return ns[0] <= 3 && ns.length >= 5 && ns.length / (ns[ns.length - 1] - ns[0] + 1) > 0.6;
}

function chaptersOf(text) {
  for (const d of DETECTORS) {
    const found = d.find(text);
    const byNumber = new Map();
    for (const c of found) {
      if (!byNumber.has(c.n) || byNumber.get(c.n).title.length < c.title.length) byNumber.set(c.n, c);
    }
    const list = [...byNumber.values()].sort((a, b) => a.n - b.n);
    if (plausible(list)) return { detector: d.name, chapters: list };
  }
  return { detector: null, chapters: [] };
}

/* ------------------------------------------------------------------ build */

function build() {
  if (!existsSync(BOOKS)) {
    console.error(`No corpus at ${BOOKS}. Run: node scripts/corpus-index.mjs fetch`);
    process.exit(1);
  }

  const books = {};
  for (const [key, repoPath] of cited()) {
    const file = join(BOOKS, localName(key, repoPath));
    if (!existsSync(file)) {
      console.log(`  absent    ${key}`);
      continue;
    }
    const bytes = statSync(file).size;
    const text = textOf(file);
    if (!text) {
      books[key] = { repoPath, bytes, extractable: false, chapters: [] };
      console.log(`  no text   ${key}  (${(bytes / 1048576).toFixed(1)} MB, probably a scan)`);
      continue;
    }
    const { detector, chapters } = chaptersOf(text);
    books[key] = {
      repoPath,
      bytes,
      extractable: true,
      textChars: text.length,
      detector,
      chapterCount: chapters.length,
      lastChapter: chapters.length ? chapters[chapters.length - 1].n : null,
      chapters,
    };
    console.log(`  indexed   ${key}  ${chapters.length} chapters via ${detector || 'nothing'}`);
  }

  const index = {
    schema: 'astrobot/corpus@1',
    note: 'Chapter structure of the books the rules cite. Facts about the books, not their text; '
      + 'the books themselves are third-party copyrighted material and are never committed. '
      + 'Rebuild with: node scripts/corpus-index.mjs build',
    collection: sources.collections?.[0]?.url || REPO,
    builtAt: new Date().toISOString().slice(0, 10),
    books,
  };
  mkdirSync(dirname(INDEX), { recursive: true });
  writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`\nWrote ${INDEX}`);
}

/* ------------------------------------------------------------------ audit */

function audit() {
  if (!existsSync(INDEX)) {
    console.error('No corpus/index.json. Run: node scripts/corpus-index.mjs build');
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(INDEX, 'utf8'));

  const files = JSON.parse(readFileSync(join(ROOT, 'knowledge/index.json'), 'utf8')).rules;
  const problems = [];
  const clusters = new Map();
  let checked = 0;
  let uncheckable = 0;

  for (const rel of files) {
    const file = JSON.parse(readFileSync(join(ROOT, 'knowledge', rel), 'utf8'));
    for (const rule of file.rules) {
      for (const ref of rule.sources || file.defaults?.sources || []) {
        const book = index.books[ref.key];
        if (!book) continue;
        if (!book.extractable) { uncheckable += 1; continue; }

        const n = Number(/\bch\.?\s*(\d+)/i.exec(ref.locus || '')?.[1]);
        if (!Number.isFinite(n)) continue;
        checked += 1;

        const chapter = book.chapters.find((c) => c.n === n);
        if (!chapter) {
          problems.push(`${rule.id}: ${ref.key} ch. ${n} is not in the index (last is ${book.lastChapter})`);
        } else {
          const at = `${ref.key} ch. ${n}`;
          if (!clusters.has(at)) clusters.set(at, { title: chapter.title, rules: [] });
          clusters.get(at).rules.push(rule.id);
        }
      }
    }
  }

  // Grouped by the chapter cited, not by rule. A chapter whose subject cannot
  // support what twenty rules claim is one decision to make, not twenty, and the
  // clusters are where that shows.
  console.log('cited chapter                      rules  subject of that chapter');
  console.log('-'.repeat(96));
  for (const [at, { title, rules }] of [...clusters].sort((a, b) => b[1].rules.length - a[1].rules.length)) {
    console.log(`${at.padEnd(34)} ${String(rules.length).padStart(5)}  ${title.slice(0, 54)}`);
  }

  console.log(`\n${checked} citation(s) across ${clusters.size} distinct chapters.`);
  if (uncheckable) console.log(`${uncheckable} could not be checked: the cited copy has no text layer.`);
  if (problems.length) {
    console.log(`\n${problems.length} unresolvable:`);
    for (const p of problems) console.log(`  x ${p}`);
  }
  console.log('\nResolving is not the same as being right. The index can say that a chapter '
    + 'exists and what it is called; whether it could state what the rule claims is a '
    + 'judgement, and the clusters above are sorted so the worst bargains come first.');
}

const [mode] = process.argv.slice(2);
if (mode === 'fetch') fetchAll();
else if (mode === 'build') build();
else if (mode === 'audit') audit();
else {
  console.log('usage: node scripts/corpus-index.mjs <fetch|build|audit>');
  process.exit(1);
}
