// Chart model and every derivation the engine needs.
// A chart is house positions plus a Lagna rashi. Nothing here needs a birth time.

// The nine grahas. This list is what every classical calculation counts: yoga
// pools, Kala Sarpa, whether a house is empty. It must never gain a member, or
// doctrine written for nine bodies would quietly start being applied to twelve.
export const PLANET_KEYS = ['su', 'mo', 'ma', 'me', 'ju', 've', 'sa', 'ra', 'ke'];
export const NODES = ['ra', 'ke'];
export const GRAHAS_NO_NODES = ['su', 'mo', 'ma', 'me', 'ju', 've', 'sa'];

// Outside the classical system, and optional. Recorded so a chart drawn by
// modern software can be entered as it stands; they are displayed and confirmed
// but take no part in any classical judgement.
export const OUTER_KEYS = ['ur', 'ne', 'pl'];
export const ALL_BODY_KEYS = [...PLANET_KEYS, ...OUTER_KEYS];

/** An empty chart. House 1 holds the Lagna rashi; every planet starts unplaced. */
export function emptyChart() {
  return {
    id: `chart-${Date.now().toString(36)}`,
    name: '',
    note: '',
    lagna: 1,
    placements: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function wrap12(n) {
  return ((n - 1) % 12 + 12) % 12 + 1;
}

/**
 * A chart wrapped with the reference data, exposing every derivation as a method.
 * Built once per reading; cheap enough to rebuild on every edit.
 */
export class Chart {
  constructor(raw, base) {
    this.raw = raw;
    this.base = base;
    this.lagna = raw.lagna;
    this.placements = raw.placements || {};
  }

  /** Grahas actually placed, in canonical order. Classical calculations use this. */
  get placed() {
    return PLANET_KEYS.filter((p) => Number.isInteger(this.placements[p]?.house));
  }

  /** Outer planets actually placed. Display and confirmation only. */
  get placedOuter() {
    return OUTER_KEYS.filter((p) => Number.isInteger(this.placements[p]?.house));
  }

  /** Everything on the chart, grahas and outer planets alike. */
  get placedBodies() {
    return [...this.placed, ...this.placedOuter];
  }

  get isComplete() {
    return this.placed.length === PLANET_KEYS.length;
  }

  /** Planets missing from the chart, in canonical order. */
  get missing() {
    return PLANET_KEYS.filter((p) => !Number.isInteger(this.placements[p]?.house));
  }

  planet(p) {
    return this.base.planets.planets[p];
  }

  rashi(s) {
    return this.base.rashis.rashis[s - 1];
  }

  house(h) {
    return this.base.houses.houses[h - 1];
  }

  /** The rashi occupying a given house. */
  signOfHouse(h) {
    return wrap12(this.lagna + h - 1);
  }

  /** The house a given rashi falls in. */
  houseOfSign(s) {
    return wrap12(s - this.lagna + 1);
  }

  houseOf(p) {
    const at = this.placements[p];
    return Number.isInteger(at?.house) ? at.house : null;
  }

  signOf(p) {
    const h = this.houseOf(p);
    return h === null ? null : this.signOfHouse(h);
  }

  /**
   * The nodes are always retrograde, so that is a property of the body rather
   * than something to be entered. The Sun and Moon never are, whatever a stray
   * saved flag says.
   */
  isRetrograde(p) {
    const data = this.base.planets.planets[p];
    if (data?.alwaysRetrograde) return true;
    if (data && data.retrogrades === false) return false;
    return Boolean(this.placements[p]?.retro);
  }

  /** Can this body's retrogression be chosen, or is it fixed by what it is? */
  retroState(p) {
    const data = this.base.planets.planets[p];
    if (data?.alwaysRetrograde) return 'always';
    if (data && data.retrogrades === false) return 'never';
    return 'optional';
  }

  degreeOf(p) {
    const d = this.placements[p]?.degree;
    return typeof d === 'number' && Number.isFinite(d) ? d : null;
  }

  /**
   * Grahas sharing a house. The engine uses this, so a house holding only an
   * outer planet still counts as empty for every classical rule.
   */
  occupants(h) {
    return this.placed.filter((p) => this.houseOf(p) === h);
  }

  /** Everything sharing a house, for drawing the chart. */
  allOccupants(h) {
    return this.placedBodies.filter((p) => this.houseOf(p) === h);
  }

  /** The dispositor of a house: lord of the rashi occupying it. */
  lordOfHouse(h) {
    return this.rashi(this.signOfHouse(h)).lord;
  }

  /** Houses a planet rules in this chart. A planet can rule two. */
  housesRuledBy(p) {
    const out = [];
    for (let h = 1; h <= 12; h += 1) if (this.lordOfHouse(h) === p) out.push(h);
    return out;
  }

  /**
   * Sidereal longitude in the zodiac, 0-360, or null when no degree was given.
   *
   * Reconstructed from the Lagna, the house and the degree within the sign,
   * which is everything a saved chart already holds - so nothing new has to be
   * stored for this, and charts saved before it existed still work.
   */
  siderealLongitude(p) {
    const h = this.houseOf(p);
    const deg = this.degreeOf(p);
    if (h === null || deg === null) return null;
    return (this.signOfHouse(h) - 1) * 30 + deg;
  }

  /**
   * Combustion (asta): a graha too near the Sun is burnt and loses much of its
   * power to give its own results.
   *
   * Measured in degrees of longitude and never in houses. Roughly a quarter of
   * combust cases fall in the sign next to the Sun's, and a third or more of
   * same-sign cases are not combust at all, so a house-based shortcut would be
   * wrong in both directions.
   *
   * Returns `na` for bodies combustion does not apply to, and `unknown` when a
   * degree is missing - which is honest, and different from saying a planet is
   * clear.
   *
   * `unknown` carries `missing`: the bodies whose degrees are wanted. Two
   * degrees are needed for every verdict, the graha's and the Sun's, so a chart
   * can carry a degree for the graha and still decide nothing. Naming them lets
   * the reading ask for the one entry that is actually missing instead of
   * telling the reader the chart has no degrees at all.
   */
  combustion(p) {
    const orbs = this.planet(p)?.combustion;
    if (!orbs) return { state: 'na' };

    const sun = this.siderealLongitude('su');
    const own = this.siderealLongitude(p);
    if (sun === null || own === null) {
      const missing = [];
      if (sun === null) missing.push('su');
      if (own === null) missing.push(p);
      return { state: 'unknown', missing };
    }

    const orb = this.isRetrograde(p) && typeof orbs.retroOrb === 'number' ? orbs.retroOrb : orbs.orb;
    const separation = Math.abs(((own - sun + 180) % 360 + 360) % 360 - 180);
    return {
      state: separation <= orb ? 'combust' : 'clear',
      separation: Math.round(separation * 100) / 100,
      orb,
    };
  }

  /** Grahas currently burnt, in canonical order. */
  get combust() {
    return this.placed.filter((p) => this.combustion(p).state === 'combust');
  }

  /**
   * Dignity of a planet by sign. Without a degree, moolatrikona cannot be
   * distinguished from own sign, so own sign is reported and the caller is told
   * the distinction was unavailable.
   */
  dignity(p) {
    const sign = this.signOf(p);
    if (sign === null) return { state: 'unplaced', exact: false };
    const d = this.planet(p);
    const deg = this.degreeOf(p);

    if (d.exalted?.sign === sign) {
      return { state: 'exalted', exact: true, disputed: Boolean(d.exalted.disputed) };
    }
    if (d.debilitated?.sign === sign) {
      return { state: 'debilitated', exact: true, disputed: Boolean(d.debilitated.disputed) };
    }
    if (d.moolatrikona && d.moolatrikona.sign === sign) {
      if (deg !== null) {
        const { from, to } = d.moolatrikona;
        if (deg >= from && deg <= to) return { state: 'moolatrikona', exact: true };
        return { state: 'ownSign', exact: true };
      }
      return { state: 'ownSign', exact: false, couldBe: 'moolatrikona' };
    }
    if (d.owns.includes(sign)) return { state: 'ownSign', exact: true };

    const lord = this.rashi(sign).lord;
    if (lord === p) return { state: 'ownSign', exact: true };
    if (d.friends.includes(lord)) return { state: 'friendly', exact: true };
    if (d.enemies.includes(lord)) return { state: 'enemy', exact: true };
    return { state: 'neutral', exact: true };
  }

  /** Houses a planet casts a full aspect on, from its own position. */
  aspectedHouses(p) {
    const h = this.houseOf(p);
    if (h === null) return [];
    return (this.planet(p).aspects || [7]).map((a) => wrap12(h + a - 1));
  }

  /** Does `from` cast a full aspect on the house `to` sits in? */
  aspectsPlanet(from, to) {
    const th = this.houseOf(to);
    if (th === null || from === to) return false;
    return this.aspectedHouses(from).includes(th);
  }

  aspectsHouse(from, h) {
    return this.aspectedHouses(from).includes(h);
  }

  /** Counting inclusively, as the tradition does: the house itself is the 1st. */
  relative(fromHouse, toHouse) {
    return wrap12(toHouse - fromHouse + 1);
  }

  /**
   * Resolve a reference point used by relative-position rules: a planet key,
   * or the literal 'lagna'.
   */
  referenceHouse(ref) {
    if (ref === 'lagna') return 1;
    return this.houseOf(ref);
  }

  /** Does a planet sit in its own house of rulership? */
  inOwnHouse(p) {
    const h = this.houseOf(p);
    return h !== null && this.lordOfHouse(h) === p;
  }

  /** Mutual exchange of houses between the lords of a and b. */
  hasExchange(a, b) {
    const la = this.lordOfHouse(a);
    const lb = this.lordOfHouse(b);
    if (!la || !lb || la === lb) return false;
    return this.houseOf(la) === b && this.houseOf(lb) === a;
  }

  /** Lords of two houses sharing one house. */
  lordsConjunct(a, b) {
    const la = this.lordOfHouse(a);
    const lb = this.lordOfHouse(b);
    if (!la || !lb || la === lb) return false;
    const ha = this.houseOf(la);
    const hb = this.houseOf(lb);
    return ha !== null && ha === hb;
  }

  /** Classes a house belongs to, e.g. ['kendra', 'trikona', 'dharma']. */
  classesOfHouse(h) {
    const out = [];
    for (const [key, def] of Object.entries(this.base.houses.classes)) {
      if (def.houses.includes(h)) out.push(key);
    }
    return out;
  }

  /**
   * True when all seven grahas fall strictly on one side of the node axis.
   * The classical Kala Sarpa test, done on houses rather than degrees.
   */
  allBetweenNodes() {
    const rh = this.houseOf('ra');
    const kh = this.houseOf('ke');
    if (rh === null || kh === null) return false;
    const bodies = GRAHAS_NO_NODES.map((p) => this.houseOf(p));
    if (bodies.some((h) => h === null)) return false;

    // Walk forward from Rahu to Ketu and check every graha is inside that arc.
    const arc = new Set();
    for (let step = 1; ; step += 1) {
      const h = wrap12(rh + step);
      if (h === kh) break;
      arc.add(h);
      if (step > 12) return false;
    }
    const forward = bodies.every((h) => arc.has(h));

    const arcBack = new Set();
    for (let step = 1; ; step += 1) {
      const h = wrap12(kh + step);
      if (h === rh) break;
      arcBack.add(h);
      if (step > 12) return false;
    }
    const backward = bodies.every((h) => arcBack.has(h));

    return forward || backward;
  }

  /**
   * A plain-language summary of every planet: rashi, house, dignity, retrogression.
   * This is what the confirmation screen shows.
   */
  roster() {
    return ALL_BODY_KEYS.map((p) => {
      const h = this.houseOf(p);
      const s = this.signOf(p);
      const classical = PLANET_KEYS.includes(p);
      return {
        key: p,
        planet: this.planet(p),
        classical,
        house: h,
        rashi: s === null ? null : this.rashi(s),
        dignity: this.dignity(p),
        combustion: this.combustion(p),
        longitude: this.siderealLongitude(p),
        retro: this.isRetrograde(p),
        retroState: this.retroState(p),
        degree: this.degreeOf(p),
        rules: h === null ? [] : this.housesRuledBy(p),
        aspecting: classical ? this.aspectedHouses(p) : [],
        placed: h !== null,
      };
    });
  }
}

/** Serialise a chart to a short string for sharing or storing in a URL. */
const token = (at) => (Number.isInteger(at?.house) ? `${at.house}${at.retro ? 'r' : ''}` : '-');

/**
 * Nine fields for the grahas, and three more only when an outer planet is on
 * the chart. A code written before the outer planets existed stays readable.
 */
export function encodeChart(raw) {
  const parts = [String(raw.lagna), ...PLANET_KEYS.map((p) => token(raw.placements[p]))];
  if (OUTER_KEYS.some((p) => Number.isInteger(raw.placements[p]?.house))) {
    parts.push(...OUTER_KEYS.map((p) => token(raw.placements[p])));
  }
  return parts.join('.');
}

export function decodeChart(str) {
  const parts = String(str || '').split('.');
  const short = PLANET_KEYS.length + 1;
  const long = ALL_BODY_KEYS.length + 1;
  if (parts.length !== short && parts.length !== long) return null;

  const lagna = Number(parts[0]);
  if (!Number.isInteger(lagna) || lagna < 1 || lagna > 12) return null;

  const chart = emptyChart();
  chart.lagna = lagna;
  const keys = parts.length === long ? ALL_BODY_KEYS : PLANET_KEYS;
  keys.forEach((p, i) => {
    const raw = parts[i + 1];
    if (raw === '-' || !raw) return;
    const retro = raw.endsWith('r');
    const house = Number(retro ? raw.slice(0, -1) : raw);
    if (!Number.isInteger(house) || house < 1 || house > 12) return;
    chart.placements[p] = { house, retro };
  });
  return chart;
}
