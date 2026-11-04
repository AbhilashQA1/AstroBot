// Checks the knowledge base for anything the app would have to skip at runtime.
// Run before committing a rule change: npm run validate

import { loadKnowledgeFromDisk } from './kb-node.mjs';
import { ALL_BODY_KEYS, Chart, PLANET_KEYS, emptyChart } from '../assets/js/model.js';
import { SECTIONS, evaluate } from '../assets/js/engine.js';

const POLARITIES = new Set(['favourable', 'difficult', 'mixed', 'neutral']);
const STATUSES = new Set(['active', 'disputed', 'retired']);
const FAMILIES = new Set(['planet-in-house', 'planet-in-sign', 'lord-in-house', 'yoga', 'conjunction', 'aspect', 'combustion', 'dasha']);
const KNOWN_THEMES = new Set(SECTIONS.flatMap((s) => s.themes));

const errors = [];
const warnings = [];

const kb = await loadKnowledgeFromDisk();
for (const p of kb.problems) errors.push(`${p.path}: ${p.error}`);

// --- structural checks on each rule -----------------------------------------
for (const rule of kb.rules) {
  const at = `${rule.file} [${rule.id}]`;

  if (!rule.says || rule.says.length < 20) errors.push(`${at}: says is missing or too short`);
  if (!rule.when) errors.push(`${at}: no when condition`);
  if (!POLARITIES.has(rule.polarity)) errors.push(`${at}: unknown polarity "${rule.polarity}"`);
  if (!STATUSES.has(rule.status)) errors.push(`${at}: unknown status "${rule.status}"`);
  if (!FAMILIES.has(rule.family)) errors.push(`${at}: unknown family "${rule.family}"`);
  if (typeof rule.confidence !== 'number' || rule.confidence <= 0 || rule.confidence > 1) {
    errors.push(`${at}: confidence must be between 0 and 1`);
  }
  if (!rule.sources?.length) errors.push(`${at}: no sources`);

  for (const ref of rule.sources || []) {
    if (!kb.base.sources.sources[ref.key]) errors.push(`${at}: unknown source key "${ref.key}"`);
  }

  if (!rule.themes.length) warnings.push(`${at}: no themes, so it will not appear in any section`);
  for (const theme of rule.themes) {
    if (!KNOWN_THEMES.has(theme)) warnings.push(`${at}: theme "${theme}" maps to no section`);
  }

  for (const id of rule.conflictsWith || []) {
    if (!kb.byId.has(id)) errors.push(`${at}: conflictsWith names "${id}", which does not exist`);
  }

  for (const p of planetsMentioned(rule.when)) {
    if (!ALL_BODY_KEYS.includes(p)) errors.push(`${at}: unknown body "${p}"`);
  }
  for (const h of housesMentioned(rule.when)) {
    if (!Number.isInteger(h) || h < 1 || h > 12) errors.push(`${at}: house out of range: ${h}`);
  }
}

function walk(cond, fn) {
  if (!cond || typeof cond !== 'object') return;
  fn(cond);
  for (const key of ['all', 'any']) {
    if (Array.isArray(cond[key])) cond[key].forEach((c) => walk(c, fn));
  }
  if (cond.not) walk(cond.not, fn);
}

function planetsMentioned(cond) {
  const found = new Set();
  walk(cond, (c) => {
    for (const v of [
      c.planetInHouse?.planet, c.planetInSign?.planet, c.dignity?.planet, c.dignityAny?.planet,
      c.inHouseClass?.planet, c.retrograde, c.aspect?.from, c.aspect?.to, c.aspectsHouse?.from,
      c.combust, c.notCombust, c.dashaLord, c.antardashaLord,
    ]) if (typeof v === 'string') found.add(v);
    for (const v of [c.relativeHouse?.from, c.relativeHouse?.to, c.planetsInRelativeHouse?.from]) {
      if (typeof v === 'string' && v !== 'lagna') found.add(v);
    }
    for (const list of [c.conjunct, c.planetsInRelativeHouse?.only, c.planetsInRelativeHouse?.exclude]) {
      if (Array.isArray(list)) list.forEach((p) => found.add(p));
    }
  });
  return [...found];
}

function housesMentioned(cond) {
  const found = new Set();
  walk(cond, (c) => {
    for (const v of [
      c.planetInHouse?.house, c.lordInHouse?.lordOf, c.lordInHouse?.house, c.aspectsHouse?.house,
      c.emptyHouse, c.exchange?.a, c.exchange?.b, c.lordsConjunct?.a, c.lordsConjunct?.b,
      c.dashaLordInHouse, c.dashaLordRules,
    ]) if (Number.isInteger(v)) found.add(v);
    for (const list of [c.relativeHouse?.houses, c.planetsInRelativeHouse?.houses]) {
      if (Array.isArray(list)) list.forEach((h) => found.add(h));
    }
  });
  return [...found];
}

// --- every condition must be one the engine supports ------------------------
// Driving a real chart through the engine is the only honest way to find out,
// because the engine reports unsupported conditions rather than skipping them.
const probe = emptyChart();
probe.lagna = 1;
PLANET_KEYS.forEach((p, i) => { probe.placements[p] = { house: (i % 12) + 1, retro: false }; });
const { broken } = evaluate(new Chart(probe, kb.base), kb);
for (const b of broken) errors.push(`${b.file} [${b.id}]: condition not supported by the engine: ${b.reason}`);

// --- coverage report --------------------------------------------------------
const coverage = {};
for (const rule of kb.rules) {
  coverage[rule.family] = (coverage[rule.family] || 0) + 1;
}

const pihCovered = new Set();
for (const rule of kb.rules) {
  if (rule.family !== 'planet-in-house') continue;
  const c = rule.when?.planetInHouse;
  if (c) pihCovered.add(`${c.planet}.${c.house}`);
}
const pihMissing = [];
for (const p of PLANET_KEYS) {
  for (let h = 1; h <= 12; h += 1) if (!pihCovered.has(`${p}.${h}`)) pihMissing.push(`${p} in ${h}`);
}

console.log(`knowledge base: ${kb.rules.length} rules across ${kb.index.rules.length} files`);
for (const [family, n] of Object.entries(coverage).sort()) console.log(`  ${family.padEnd(16)} ${n}`);
console.log(`planet-in-house coverage: ${pihCovered.size}/108`);
if (pihMissing.length) console.log(`  not yet written: ${pihMissing.join(', ')}`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log('\nvalidate: OK');
