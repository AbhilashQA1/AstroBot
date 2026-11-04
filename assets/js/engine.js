// The interpretation engine.
//
// Matches knowledge-base rules against a chart, weights what matched, groups it
// into a readable order, and reports where sources disagree. Nothing is invented:
// every sentence in the output either comes from a rule's `says` or is derived
// geometry labelled as such.

import { PLANET_KEYS, wrap12 } from './model.js';
import { authorityWeight, citations } from './kb.js';

const DIGNITY_FACTOR = {
  exalted: 1.25,
  moolatrikona: 1.2,
  ownSign: 1.15,
  friendly: 1.05,
  neutral: 1.0,
  enemy: 0.9,
  debilitated: 0.75,
  unplaced: 0,
};

// A burnt graha keeps its place in the chart but loses much of its power to
// deliver its own significations, so its rules are weighted down rather than
// removed. Not a veto: several authorities hold that a combust planet in its
// own sign resists, and the malefic side of a burnt malefic is often said to
// survive intact, so suppressing the rule outright would overstate a doctrine
// that is not settled.
const COMBUSTION_FACTOR = 0.6;

export const SECTIONS = [
  { key: 'self', title: 'Self and temperament', themes: ['self', 'mind', 'health', 'courage'] },
  { key: 'learning', title: 'Mind, learning and children', themes: ['intellect', 'children', 'art'] },
  { key: 'wealth', title: 'Money and gain', themes: ['wealth', 'gain', 'speech', 'friends'] },
  { key: 'work', title: 'Work and standing', themes: ['work', 'status', 'ambition'] },
  { key: 'partnership', title: 'Partnership', themes: ['partnership', 'romance'] },
  { key: 'home', title: 'Home, family and effort', themes: ['home', 'mother', 'property', 'comfort', 'siblings', 'effort'] },
  { key: 'adversity', title: 'Difficulty and the body', themes: ['adversity', 'longevity', 'rupture'] },
  { key: 'fortune', title: 'Fortune, faith and the father', themes: ['fortune', 'faith', 'father', 'occult'] },
  { key: 'release', title: 'Loss, distance and release', themes: ['loss', 'foreign'] },
];

class UnsupportedCondition extends Error {}

/**
 * Evaluate a condition tree against a chart.
 * Throws UnsupportedCondition for anything it does not recognise, so a malformed
 * rule is reported rather than silently skipped.
 */
function test(cond, chart) {
  if (!cond || typeof cond !== 'object') throw new UnsupportedCondition('empty condition');

  if (Array.isArray(cond.all)) return cond.all.every((c) => test(c, chart));
  if (Array.isArray(cond.any)) return cond.any.some((c) => test(c, chart));
  if (cond.not) return !test(cond.not, chart);

  if (cond.planetInHouse) {
    const { planet, house } = cond.planetInHouse;
    return chart.houseOf(planet) === house;
  }

  if (cond.planetInSign) {
    const { planet, sign } = cond.planetInSign;
    return chart.signOf(planet) === sign;
  }

  if (cond.lordInHouse) {
    const { lordOf, house } = cond.lordInHouse;
    const lord = chart.lordOfHouse(lordOf);
    return chart.houseOf(lord) === house;
  }

  if (cond.conjunct) {
    const houses = cond.conjunct.map((p) => chart.houseOf(p));
    if (houses.some((h) => h === null)) return false;
    return houses.every((h) => h === houses[0]);
  }

  if (cond.aspect) {
    const { from, to } = cond.aspect;
    return chart.aspectsPlanet(from, to);
  }

  if (cond.aspectsHouse) {
    const { from, house } = cond.aspectsHouse;
    return chart.houseOf(from) !== null && chart.aspectsHouse(from, house);
  }

  if (cond.dignity) {
    const { planet, is } = cond.dignity;
    return chart.dignity(planet).state === is;
  }

  if (cond.dignityAny) {
    const { planet, in: states } = cond.dignityAny;
    return states.includes(chart.dignity(planet).state);
  }

  if (cond.inHouseClass) {
    const { planet, class: cls } = cond.inHouseClass;
    const h = chart.houseOf(planet);
    if (h === null) return false;
    return chart.classesOfHouse(h).includes(cls);
  }

  if (cond.retrograde) return chart.isRetrograde(cond.retrograde);

  // Only true when the chart actually carries degrees. A chart entered by hand
  // reports `unknown`, which is not a match - absence of evidence is not
  // evidence that a planet is clear of the Sun.
  if (cond.combust) return chart.combustion(cond.combust).state === 'combust';
  if (cond.notCombust) return chart.combustion(cond.notCombust).state === 'clear';

  if (Number.isInteger(cond.emptyHouse)) return chart.occupants(cond.emptyHouse).length === 0;

  if (cond.relativeHouse) {
    const { from, to, houses } = cond.relativeHouse;
    const fh = chart.referenceHouse(from);
    const th = chart.referenceHouse(to);
    if (fh === null || th === null) return false;
    return houses.includes(chart.relative(fh, th));
  }

  if (cond.planetsInRelativeHouse) {
    const spec = cond.planetsInRelativeHouse;
    const fh = chart.referenceHouse(spec.from);
    if (fh === null) return false;
    const target = new Set(spec.houses.map((n) => wrap12(fh + n - 1)));
    const pool = spec.only ? spec.only : PLANET_KEYS.filter((p) => !(spec.exclude || []).includes(p));
    const hits = pool.filter((p) => {
      if (p === spec.from) return false;
      const h = chart.houseOf(p);
      return h !== null && target.has(h);
    });
    if (Number.isInteger(spec.max) && hits.length > spec.max) return false;
    if (Number.isInteger(spec.min) && hits.length < spec.min) return false;
    return true;
  }

  if (cond.exchange) return chart.hasExchange(cond.exchange.a, cond.exchange.b);
  if (cond.lordsConjunct) return chart.lordsConjunct(cond.lordsConjunct.a, cond.lordsConjunct.b);
  if (cond.allBetweenNodes === true) return chart.allBetweenNodes();

  throw new UnsupportedCondition(Object.keys(cond).join(', '));
}

/**
 * The planet or house a rule is really about, used to group findings and to spot
 * two rules making opposing claims about the same thing.
 */
function subjectOf(rule) {
  const c = rule.when || {};
  if (c.planetInHouse) return `planet:${c.planetInHouse.planet}`;
  if (c.planetInSign) return `planet:${c.planetInSign.planet}`;
  if (c.dignity) return `planet:${c.dignity.planet}`;
  if (c.dignityAny) return `planet:${c.dignityAny.planet}`;
  if (c.inHouseClass) return `planet:${c.inHouseClass.planet}`;
  if (c.retrograde) return `planet:${c.retrograde}`;
  if (c.conjunct) return `pair:${[...c.conjunct].sort().join('+')}`;
  if (c.aspect) return `aspect:${c.aspect.from}->${c.aspect.to}`;
  if (c.aspectsHouse) return `aspect:${c.aspectsHouse.from}->h${c.aspectsHouse.house}`;
  if (c.lordInHouse) return `lord:${c.lordInHouse.lordOf}`;
  if (c.lordsConjunct) return `lords:${c.lordsConjunct.a}+${c.lordsConjunct.b}`;
  if (c.exchange) return `exchange:${c.exchange.a}+${c.exchange.b}`;
  if (c.relativeHouse) return `relative:${c.relativeHouse.from}->${c.relativeHouse.to}`;
  if (c.planetsInRelativeHouse) return `relative:${c.planetsInRelativeHouse.from}`;
  if (c.allBetweenNodes) return 'axis:nodes';
  if (c.any || c.all) return `group:${rule.id}`;
  return `rule:${rule.id}`;
}

/** The planet whose dignity should modulate this rule's weight, if any. */
function weightingPlanet(rule) {
  const subject = subjectOf(rule);
  return subject.startsWith('planet:') ? subject.slice(7) : null;
}

function contextFactor(rule, chart) {
  const p = weightingPlanet(rule);
  if (!p) return 1;
  const h = chart.houseOf(p);
  if (h === null) return 1;
  const classes = chart.classesOfHouse(h);
  const nature = chart.planet(p).nature;

  // A benefic in a house of difficulty loses much of its own good; a malefic in a
  // house that grows with effort does better than its nature suggests.
  if (nature === 'benefic' && classes.includes('dusthana') && rule.polarity === 'favourable') return 0.8;
  if (nature === 'malefic' && classes.includes('upachaya') && rule.polarity === 'difficult') return 0.85;
  if (nature === 'malefic' && classes.includes('upachaya') && rule.polarity === 'favourable') return 1.1;
  return 1;
}

/** Run every rule against the chart. */
export function evaluate(chart, kb) {
  const sourcesFile = kb.base.sources;
  const findings = [];
  const broken = [];

  for (const rule of kb.rules) {
    if (rule.status === 'retired') continue;
    let matched = false;
    try {
      matched = test(rule.when, chart);
    } catch (err) {
      broken.push({ id: rule.id, file: rule.file, reason: err.message });
      continue;
    }
    if (!matched) continue;

    const p = weightingPlanet(rule);
    const dignity = p ? chart.dignity(p) : null;
    const dignityFactor = dignity ? (DIGNITY_FACTOR[dignity.state] ?? 1) : 1;
    const burnt = p ? chart.combustion(p) : null;
    const combustionFactor = burnt?.state === 'combust' ? COMBUSTION_FACTOR : 1;
    const weight =
      authorityWeight(rule, sourcesFile) *
      rule.confidence *
      dignityFactor *
      combustionFactor *
      contextFactor(rule, chart);

    findings.push({
      rule,
      subject: subjectOf(rule),
      weight: Number(weight.toFixed(4)),
      dignity,
      combustion: burnt,
      citations: citations(rule, sourcesFile),
    });
  }

  findings.sort((a, b) => b.weight - a.weight);
  return { findings, broken };
}

/** Statements the engine derives from reference data rather than from a rule. */
export function derived(chart) {
  const out = [];
  const lagnaSign = chart.signOfHouse(1);
  const lagnaRashi = chart.rashi(lagnaSign);
  const lagnaLord = chart.lordOfHouse(1);
  const lordHouse = chart.houseOf(lagnaLord);

  out.push({
    kind: 'lagna',
    text: `${lagnaRashi.en} rises, so the chart is read from ${lagnaRashi.en} as the first house. Its lord is ${chart.planet(lagnaLord).en}.`,
  });

  if (lordHouse !== null) {
    out.push({
      kind: 'lagna-lord',
      text: `${chart.planet(lagnaLord).en} rules the Lagna and sits in the ${ordinal(lordHouse)} house, which is where the direction of the life is mostly decided.`,
    });
  } else {
    out.push({
      kind: 'lagna-lord',
      text: `${chart.planet(lagnaLord).en} rules the Lagna but has not been placed yet, so the strongest single indication in the chart is still missing.`,
    });
  }

  const notable = [];
  for (const p of chart.placed) {
    const d = chart.dignity(p);
    if (['exalted', 'debilitated', 'moolatrikona', 'ownSign'].includes(d.state)) {
      notable.push({ p, d });
    }
  }
  if (notable.length) {
    const phrases = notable.map(({ p, d }) => {
      const name = chart.planet(p).en;
      const sign = chart.rashi(chart.signOf(p)).en;
      const label = {
        exalted: 'exalted in',
        debilitated: 'debilitated in',
        moolatrikona: 'in its moolatrikona portion of',
        ownSign: 'in its own sign',
      }[d.state];
      return d.state === 'ownSign' ? `${name} ${label} ${sign}` : `${name} ${label} ${sign}`;
    });
    out.push({ kind: 'dignity', text: `Dignity worth noting: ${phrases.join('; ')}.` });
  }

  // Digbala: each planet has one house where it acts at full force.
  const digbala = chart.placed.filter((p) => chart.planet(p).directionalStrength === chart.houseOf(p));
  if (digbala.length) {
    out.push({
      kind: 'digbala',
      text:
        `Directional strength: ${digbala.map((p) => `${chart.planet(p).en} in the ${ordinal(chart.houseOf(p))}`).join(', ')}. ` +
        'A planet standing in its own quarter of the chart gives its results at full force, whatever else is said about it below.',
    });
  }

  const burnt = chart.combust;
  if (burnt.length) {
    const phrases = burnt.map((p) => {
      const c = chart.combustion(p);
      return `${chart.planet(p).en} at ${c.separation}\u00b0 from the Sun, inside its ${c.orb}\u00b0 orb`;
    });
    out.push({
      kind: 'combustion',
      text:
        `Combust: ${phrases.join('; ')}. A burnt graha holds its place but gives its own results weakly, ` +
        'so everything said about it below is weighted down.',
    });
  } else if (chart.placed.some((p) => chart.combustion(p).state === 'unknown')
      && nearTheSun(chart).length) {
    out.push({
      kind: 'combustion',
      text:
        `${nearTheSun(chart).map((p) => chart.planet(p).en).join(', ')} ${nearTheSun(chart).length === 1 ? 'sits' : 'sit'} ` +
        'close enough to the Sun that combustion is possible, but this chart carries no degrees, so it cannot be judged. ' +
        'Calculating the chart from birth details would settle it.',
    });
  }

  const retro = chart.placed.filter((p) => chart.isRetrograde(p) && !['ra', 'ke'].includes(p));
  if (retro.length) {
    out.push({
      kind: 'retrograde',
      text: `Retrograde: ${retro.map((p) => chart.planet(p).en).join(', ')}. A retrograde planet gives its results late, and inwardly before outwardly.`,
    });
  }

  return out;
}

/**
 * Pairs of matched rules that make opposing claims. Three ways a conflict is
 * recognised: an explicit `conflictsWith`, a rule marked `disputed`, or two
 * rules about the same subject with overlapping themes and opposite polarity.
 */
export function conflicts(findings) {
  const byId = new Map(findings.map((f) => [f.rule.id, f]));
  const pairs = [];
  const seen = new Set();

  const addPair = (a, b, reason) => {
    const key = [a.rule.id, b.rule.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ a, b, reason });
  };

  for (const f of findings) {
    for (const otherId of f.rule.conflictsWith || []) {
      const other = byId.get(otherId);
      if (other) addPair(f, other, 'stated');
    }
  }

  for (let i = 0; i < findings.length; i += 1) {
    for (let j = i + 1; j < findings.length; j += 1) {
      const a = findings[i];
      const b = findings[j];
      if (a.subject !== b.subject) continue;
      const opposed =
        (a.rule.polarity === 'favourable' && b.rule.polarity === 'difficult') ||
        (a.rule.polarity === 'difficult' && b.rule.polarity === 'favourable');
      if (!opposed) continue;
      const shared = a.rule.themes.filter((t) => b.rule.themes.includes(t));
      if (!shared.length) continue;
      addPair(a, b, 'opposing');
    }
  }

  const disputed = findings.filter(
    (f) => f.rule.status === 'disputed' && !pairs.some((p) => p.a.rule.id === f.rule.id || p.b.rule.id === f.rule.id),
  );

  return { pairs, disputed };
}

/** Arrange findings into the section order used by the reading. */
export function compose(chart, kb) {
  const { findings, broken } = evaluate(chart, kb);
  const combos = findings.filter((f) => ['yoga', 'conjunction'].includes(f.rule.family));
  const rest = findings.filter((f) => !['yoga', 'conjunction'].includes(f.rule.family));

  // Each finding belongs to exactly one section: the first in SECTIONS order whose
  // themes it touches. Repeating the same sentence under three headings reads as
  // padding, however defensible the overlap is.
  const sections = SECTIONS.map((section) => ({ ...section, findings: [] }));
  const unsectioned = [];
  for (const f of rest) {
    const home = sections.find((s) => f.rule.themes.some((t) => s.themes.includes(t)));
    if (home) home.findings.push(f);
    else unsectioned.push(f);
  }

  return {
    derived: derived(chart),
    combinations: combos,
    sections: sections.filter((s) => s.findings.length),
    unsectioned,
    conflicts: conflicts(findings),
    findings,
    broken,
    stats: {
      matched: findings.length,
      ofTotal: kb.rules.length,
      combinations: combos.length,
    },
  };
}

/**
 * Grahas in the Sun's house or either neighbour, where combustion is at least
 * possible. Used only to decide whether a chart without degrees is worth
 * warning about, so that the warning does not appear on every chart.
 */
function nearTheSun(chart) {
  const sunHouse = chart.houseOf('su');
  if (sunHouse === null) return [];
  const adjacent = [wrap12(sunHouse - 1), sunHouse, wrap12(sunHouse + 1)];
  return chart.placed.filter((p) => {
    if (chart.combustion(p).state !== 'unknown') return false;
    const h = chart.houseOf(p);
    return h !== null && adjacent.includes(h);
  });
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
