// AstroBot UI. No framework: a handful of render functions over one piece of state.

import { ALL_BODY_KEYS, Chart, OUTER_KEYS, PLANET_KEYS, decodeChart, emptyChart, encodeChart } from './model.js';
import { loadKnowledge } from './kb.js';
import { compose, ordinal } from './engine.js';
import { antardashas, dashaFor } from './astro/dasha.js';
import { renderChart } from './chartview.js';
import { renderBirthView } from './birth.js';
import {
  chartSource, editedBodies, lagnaEdited, moveBody, revertToComputed,
  setDegree, shiftBirthMinutes, snapshot,
} from './edits.js';
import { computeKundali, toChartPlacements } from './astro/compute.js';
import { solveLagna, targetFromRashi } from './astro/rectify.js';
import {
  chartOf, deleteChart, deleteReading, exportAll, getReading, importAll, listCharts,
  listReadings, readingsForChart, renameChart, saveChart, saveReading, store, toView,
  usage, useEncoder,
} from './library.js';

useEncoder(encodeChart);

const STORE = {
  chart: 'astrobot.chart',
  gh: 'astrobot.github',
  queue: 'astrobot.queue',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  kb: null,
  raw: null,
  chart: null,
  selectedHouse: null,
  confirmed: false,
  reading: null,
  readingView: null,
  viewingReading: null,
  // Which horizon the period panel is showing - a HORIZONS key - or null when
  // the panel is closed. Held here rather than in the DOM so it survives a
  // re-render.
  yearsAhead: null,
  // Which rule family the knowledge screen is filtered to, or null for all.
  kbFamily: null,
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function banner(message, tone = 'info') {
  const node = $('#banner');
  if (!message) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.textContent = message;
  node.dataset.tone = tone;
}

/* ---------------------------------------------------------------- routing */

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'birth') renderBirth();
  if (view === 'confirm') renderConfirm();
  if (view === 'reading') renderReading();
  if (view === 'library') renderLibrary();
  if (view === 'saved') renderSaved();
  if (view === 'settings') renderSettings();
}

/* ------------------------------------------------------------ chart entry */

function rebuild() {
  state.raw.updatedAt = new Date().toISOString();
  state.chart = new Chart(state.raw, state.kb.base);
  state.confirmed = false;
  state.reading = null;
  state.readingView = null;
  store.set(STORE.chart, state.raw);
  renderChartView();
}

function renderChartView() {
  const chart = state.chart;
  renderChart($('#chart-host'), chart, {
    selected: state.selectedHouse,
    onHouseTap: openSheet,
    showRashiNames: true,
  });

  const placed = chart.placed.length;
  const outer = chart.placedOuter.length;
  $('#placed-count').textContent = `${placed} of 9 placed${outer ? ` + ${outer} outer` : ''}`;
  $('#btn-to-confirm').disabled = placed === 0;
  $('#lagna').value = String(chart.lagna);
  $('#chart-name').value = state.raw.name || '';
  $('#chart-label').textContent = state.raw.name || (placed ? `${placed}/9 placed` : 'New chart');
  renderComputedPanel();
}

/**
 * The provenance strip: whether this chart was calculated, whether it has since
 * been edited, and the controls for moving the birth time.
 */
function renderComputedPanel() {
  const host = $('#computed-panel');
  const birth = state.raw.birth;

  // A cached page can be older than the script running against it. Rather than
  // throw from inside boot and leave the app with no event listeners at all,
  // skip the part the markup cannot show. Everything else still works.
  if (!host) return;

  if (!state.raw.computed || !birth) {
    host.hidden = true;
    host.textContent = '';
    return;
  }

  host.hidden = false;
  host.textContent = '';

  const edits = editedBodies(state.raw);
  const movedLagna = lagnaEdited(state.raw);
  const source = chartSource(state.raw);

  const where = birth.place ? `${birth.place.name}` : 'entered coordinates';
  host.append(el('p', { class: 'computed-line' }, [
    el('span', { class: `tag ${source === 'computed' ? 'tag-ownSign' : 'tag-retro'}`, text: source === 'computed' ? 'calculated' : 'calculated, then edited' }),
    ` ${birth.date} ${birth.timeKnown === false ? 'time unknown' : birth.time}, ${where}`,
  ]));

  if (edits.length || movedLagna) {
    const parts = [];
    if (movedLagna) parts.push('the Lagna');
    for (const e of edits) parts.push(`${state.chart.planet(e.key).en} (${e.change})`);
    host.append(el('p', { class: 'hint small', text: `Changed by hand: ${parts.join(', ')}. The reading will use what is on the chart now, not the calculation.` }));
    host.append(el('button', {
      type: 'button', class: 'btn btn-quiet',
      onclick: () => { revertToComputed(state.raw); rebuild(); },
    }, 'Undo my changes'));
  }

  // Birth-time rectification. The Lagna moves roughly a degree every four
  // minutes, so a certificate rounded to the nearest five minutes is worth
  // nudging. This recomputes rather than editing, so the chart stays calculated.
  if (birth.timeKnown !== false) {
    const nudge = el('div', { class: 'nudge-row' }, [
      el('span', { class: 'hint small', text: 'Move the birth time' }),
    ]);
    for (const delta of [-5, -1, 1, 5]) {
      nudge.append(el('button', {
        type: 'button', class: 'btn btn-quiet nudge',
        onclick: () => recomputeWithBirth(shiftBirthMinutes(birth, delta)),
      }, `${delta > 0 ? '+' : ''}${delta}m`));
    }
    host.append(nudge);
  }

  renderRectifyRow(host, birth);
}

/**
 * Solving the birth time from a stated Lagna.
 *
 * This is the one direction that works. An inherited horoscope states the
 * rising degree exactly and the clock time vaguely, and the Lagna crosses the
 * whole zodiac in a sidereal day - about three minutes per degree - so the
 * stated degree pins the time, and every other degree then follows from the
 * ephemeris. Running it the other way is hopeless: Saturn moves a degree in
 * nineteen days, so its degree says nothing about the time of day.
 */
function renderRectifyRow(host, birth) {
  const current = state.lastComputation?.lagna;
  const row = el('div', { class: 'rectify-row' }, [
    el('p', { class: 'hint small', text: 'Know the rising degree? Work the birth time back from it.' }),
  ]);

  const rashiSelect = el('select', { class: 'rectify-rashi', 'aria-label': 'Lagna rashi' },
    Array.from({ length: 12 }, (_, i) => el('option', {
      value: i + 1,
      selected: (current?.rashi ?? state.chart.signOfHouse(1)) === i + 1,
      text: state.chart.rashi(i + 1).en,
    })));

  const degreeInput = el('input', {
    class: 'rectify-degree',
    type: 'number', min: '0', max: '29.9999', step: '0.01',
    inputmode: 'decimal',
    placeholder: 'deg',
    'aria-label': 'Lagna degree within the rashi',
    value: current ? current.degree.toFixed(2) : '',
  });

  row.append(rashiSelect, degreeInput, el('button', {
    type: 'button', class: 'btn btn-quiet',
    onclick: () => runRectify(birth, Number(rashiSelect.value), degreeInput.value),
  }, 'Find the time'));

  host.append(row);

  // What a previous solve concluded, kept on the strip rather than flashed in a
  // banner: how this chart got its birth time is provenance, and belongs next to
  // the rest of it. Shown only while the birth time is still the solved one, so
  // a nudge or a fresh calculation drops it without any bookkeeping.
  const r = state.lastRectify;
  if (r && r.date === birth.date && r.time === birth.time) {
    host.append(el('p', { class: 'hint small rectify-note', text: r.summary }));
    if (r.caution) host.append(el('p', { class: 'hint small rectify-caution', text: r.caution }));
  }
}

/** Solve for the birth time, recompute from it, and record what was concluded. */
function runRectify(birth, rashi, degreeRaw) {
  if (degreeRaw === '' || degreeRaw === null) {
    banner('Enter the degree of the Lagna within its rashi.', 'bad');
    return;
  }

  let target;
  try {
    target = targetFromRashi(rashi, Number(degreeRaw));
  } catch (err) {
    banner(err.message, 'bad');
    return;
  }

  let solved;
  try {
    solved = solveLagna(astroBirth(birth), target);
  } catch (err) {
    banner(`Could not solve for the Lagna: ${err.message}`, 'bad');
    return;
  }

  if (!solved.ok) {
    banner(`Could not find that Lagna: ${solved.reason}`, 'bad');
    return;
  }

  const { shiftMinutes, residual, rate, lagna } = solved.best;
  const moved = shiftBirthMinutes(birth, shiftMinutes);
  const asked = `${state.chart.rashi(rashi).en} ${Number(degreeRaw).toFixed(2)}°`;
  const minutesPerDegree = rate > 0 ? 1 / rate : Infinity;

  // The honest part. The chart records birth times to the minute, so the nearest
  // minute is as close as the Lagna can be put to what was asked for, and the
  // reader is told the gap rather than left to assume it is zero.
  const landed = `${state.chart.rashi(Math.floor(lagna / 30) + 1).en} ${(lagna % 30).toFixed(2)}°`;
  const parts = [
    `Solved from a Lagna of ${asked}: birth time ${moved.time} on ${moved.date}`,
    shiftMinutes === 0 ? ' (unchanged)' : `, ${Math.abs(shiftMinutes)} minute${Math.abs(shiftMinutes) === 1 ? '' : 's'} ${shiftMinutes > 0 ? 'later' : 'earlier'}`,
    `. That minute gives ${landed}`,
    Math.abs(residual) < 0.005 ? '.' : `, ${Math.abs(residual).toFixed(2)}° ${residual > 0 ? 'past' : 'short of'} what you entered.`,
    ` The Lagna is moving ${minutesPerDegree.toFixed(1)} minutes per degree here, so that is the limit of what the birth time can say.`,
  ];

  let caution = null;
  if (Math.abs(shiftMinutes) > 180) {
    caution = `This moved the birth time by ${(Math.abs(shiftMinutes) / 60).toFixed(1)} hours. A shift that large usually means the rising degree and the recorded time disagree about more than rounding - check the rashi before trusting it.`;
  } else if (solved.solutions.length > 1) {
    const other = solved.solutions[1];
    caution = `${state.chart.rashi(rashi).en} also rises ${Math.abs(other.shiftMinutes - shiftMinutes)} minutes away, on the next sidereal day. The nearer time was taken.`;
  }

  state.lastRectify = { date: moved.date, time: moved.time, summary: parts.join(''), caution };
  if (recomputeWithBirth(moved)) {
    banner(`Birth time solved: ${moved.time}. The whole chart has been recalculated from it.`, 'good');
  } else {
    // The recompute reported why. Do not leave a conclusion on the strip for a
    // chart that was never rebuilt from it.
    state.lastRectify = null;
  }
}

/**
 * A stored birth record as computeKundali wants it.
 *
 * One function for every caller on purpose. The Lagna solver and the recompute
 * path both have to resolve the same wall clock to the same instant, and if they
 * ever differed the solver would be answering a question the chart screen never
 * asked. The discrepancy would be a few minutes - small enough to pass for
 * rounding and hard to find.
 *
 * An unknown birth time resolves to noon, which is what shiftBirthMinutes
 * already assumes, so a solved shift lands where the solver expected.
 */
function astroBirth(birth) {
  const timeKnown = birth.timeKnown !== false;
  return {
    year: Number(birth.date.slice(0, 4)),
    month: Number(birth.date.slice(5, 7)),
    day: Number(birth.date.slice(8, 10)),
    hour: timeKnown ? Number(birth.time.slice(0, 2)) : 12,
    minute: timeKnown ? Number(birth.time.slice(3, 5)) : 0,
    latitude: birth.place.latitude,
    longitude: birth.place.longitude,
    zone: 'Asia/Kolkata',
    ayanamsa: birth.ayanamsa,
    ...(Number.isFinite(birth.offsetMinutes) ? { offsetMinutes: birth.offsetMinutes } : {}),
  };
}

/** Recompute from a birth record and replace the chart, keeping it calculated. */
function recomputeWithBirth(birth) {
  try {
    const result = computeKundali(astroBirth(birth));
    const { lagna, placements } = toChartPlacements(result);
    state.raw.lagna = lagna;
    state.raw.placements = placements;
    state.raw.birth = birth;
    state.raw.computed = snapshot(lagna, placements);
    state.lastComputation = result;
    rebuild();
    return true;
  } catch (err) {
    banner(`Could not recalculate: ${err.message}`, 'bad');
    return false;
  }
}

/* --------------------------------------------------- calculate from birth */

function renderBirth() {
  const host = $('#birth-host');
  if (!host) return;
  renderBirthView(host, {
    initial: state.raw.birth || {},
    onComputed: ({ lagna, placements, birth, result }) => {
      // The computed chart replaces whatever was on the board. Degrees come with
      // it, which is what lets dignity be judged exactly rather than by sign.
      state.raw.lagna = lagna;
      state.raw.placements = placements;
      state.raw.birth = birth;
      state.raw.computedAt = new Date().toISOString();
      // Keep the calculation as a snapshot. Everything the app later says about
      // what has been edited is derived by comparing against this, so a flag can
      // never drift out of step with the data it describes.
      state.raw.computed = snapshot(lagna, placements);
      if (birth.name?.trim()) state.raw.name = birth.name.trim();

      // Before rebuild, not after. The chart itself records the Lagna only as a
      // rashi, so the one place its exact degree survives is this result, and
      // the provenance strip reads it while rendering. Setting it afterwards
      // left the rectify degree blank on every first calculation - present,
      // and quietly not doing its job.
      state.lastComputation = result;

      rebuild();

      // Straight to confirmation: a calculated chart still has to be approved
      // before it is read, exactly as a hand-entered one does. The arithmetic
      // can be right while the birth time on the certificate is wrong.
      show('confirm');
    },
  });
}

function openSheet(house) {
  state.selectedHouse = house;
  const chart = state.chart;
  const sign = chart.signOfHouse(house);
  const rashi = chart.rashi(sign);

  $('#sheet-title').textContent = `Square ${house} — ${rashi.en}`;
  $('#sheet-sub').textContent =
    `${ordinal(house)} house (${chart.house(house).sa}, ${chart.house(house).label.toLowerCase()}), ` +
    `rashi ${sign} ${rashi.sa}, ruled by ${chart.planet(rashi.lord).en}.` +
    // Other chart software prints "La" in this square, so people come looking
    // for it among the planets. It is the Lagna itself and is never placed.
    (house === 1 ? ' La on the chart marks the Lagna itself; it is not a planet and is never placed.' : '');

  const grid = $('#sheet-planets');
  grid.textContent = '';

  const chipFor = (p) => {
    const data = chart.planet(p);
    const at = chart.houseOf(p);
    const here = at === house;
    const elsewhere = at !== null && !here;
    const retro = chart.retroState(p);

    const chip = el('button', {
      type: 'button',
      class: `planet-chip${here ? ' is-here' : ''}${elsewhere ? ' is-elsewhere' : ''}`
        + (OUTER_KEYS.includes(p) ? ' is-outer' : ''),
      'aria-pressed': here ? 'true' : 'false',
      onclick: () => togglePlanet(p, house),
    }, [
      el('span', { class: 'glyph', text: data.glyph }),
      el('span', { text: data.en }),
    ]);

    if (elsewhere) {
      chip.append(el('span', { class: 'where', text: `sq ${at}` }));
    } else if (here && retro === 'optional') {
      const on = chart.isRetrograde(p);
      chip.append(el('button', {
        type: 'button',
        class: `retro-btn${on ? ' is-on' : ''}`,
        'aria-label': `Mark ${data.en} retrograde`,
        'aria-pressed': on ? 'true' : 'false',
        onclick: (ev) => {
          ev.stopPropagation();
          toggleRetro(p);
        },
      }, 'R'));
    } else if (here && retro === 'always') {
      // Not a choice: the nodes are retrograde by nature, so the state is shown
      // rather than offered. Leaving the control out entirely reads as a bug.
      chip.append(el('span', {
        class: 'retro-fixed',
        title: `${data.en} is always retrograde`,
        text: 'R',
      }));
    } else if (here && retro === 'never') {
      chip.append(el('span', {
        class: 'retro-fixed is-off',
        title: `${data.en} is never retrograde`,
        text: '—',
      }));
    }

    return chip;
  };

  for (const p of PLANET_KEYS) grid.append(chipFor(p));

  grid.append(el('p', { class: 'planet-grid-note', text: 'Outside the classical nine. Recorded on the chart, but no classical rule refers to them, so they do not change the reading.' }));
  for (const p of OUTER_KEYS) grid.append(chipFor(p));

  renderDegreeEditors(house);

  $('#sheet').hidden = false;
  $('#sheet-backdrop').hidden = false;
  renderChartView();
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-backdrop').hidden = true;
  state.selectedHouse = null;
  renderChartView();
}

function togglePlanet(p, house) {
  const at = state.chart.houseOf(p);
  if (at === house) delete state.raw.placements[p];
  else moveBody(state.raw, p, house);
  rebuild();
  openSheet(house);
}

function onDegreeInput(p, raw) {
  try {
    setDegree(state.raw, p, raw);
    rebuild();
    setSheetStatus('');
  } catch (err) {
    setSheetStatus(err.message, 'bad');
  }
}

/**
 * Degree editors for whatever occupies the tapped square.
 *
 * A degree is only meaningful once a body is in a sign, so these appear per
 * occupant rather than as a field on the form. Leaving one blank is allowed and
 * means "sign only" — the engine already handles a missing degree by falling
 * back to a sign-level judgement and saying so.
 */
function renderDegreeEditors(house) {
  const host = $('#sheet-degrees');
  if (!host) return;
  host.textContent = '';
  const occupants = state.chart.occupants(house);
  if (!occupants.length) return;

  host.append(el('p', { class: 'sheet-sub', text: 'Degree within the rashi, if you know it. Leave blank to judge by sign alone.' }));

  for (const p of occupants) {
    const value = state.chart.degreeOf(p);
    host.append(el('label', { class: 'degree-row' }, [
      el('span', { class: 'glyph', text: state.chart.planet(p).glyph }),
      el('span', { text: state.chart.planet(p).en }),
      el('input', {
        type: 'number', min: '0', max: '29.9999', step: 'any',
        inputmode: 'decimal',
        placeholder: '—',
        'aria-label': `Degree of ${state.chart.planet(p).en}`,
        value: value === null ? '' : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
        onchange: (ev) => onDegreeInput(p, ev.target.value),
      }),
    ]));
  }
  host.append(el('p', { id: 'sheet-status', class: 'status', role: 'status' }));
}

function setSheetStatus(message, tone = '') {
  const node = $('#sheet-status');
  if (!node) return;
  node.textContent = message;
  node.className = `status${tone ? ` is-${tone}` : ''}`;
}

function toggleRetro(p) {
  const at = state.raw.placements[p];
  if (!at) return;
  at.retro = !at.retro;
  rebuild();
  openSheet(at.house);
}

/* ----------------------------------------------------------- confirmation */

const DIGNITY_LABEL = {
  exalted: 'exalted',
  debilitated: 'debilitated',
  ownSign: 'own sign',
  moolatrikona: 'moolatrikona',
  friendly: 'friendly sign',
  enemy: 'enemy sign',
  neutral: 'neutral sign',
};

/**
 * Says where this chart came from, immediately above the roster the person is
 * being asked to approve. A hand-entered chart gets nothing: there is no claim
 * to qualify.
 */
function renderProvenanceCallout(edits) {
  const host = $('#confirm-provenance');
  if (!host) return;
  host.textContent = '';
  const birth = state.raw.birth;
  if (!state.raw.computed || !birth) return;

  const movedLagna = lagnaEdited(state.raw);
  const clean = edits.size === 0 && !movedLagna;
  const where = birth.place ? birth.place.name : 'entered coordinates';
  const when = birth.timeKnown === false ? 'time unknown' : birth.time;

  const lines = [
    el('p', { text: `Calculated for ${birth.date}, ${when}, ${where}.` }),
  ];

  if (birth.timeKnown === false) {
    lines.push(el('p', { class: 'hint small', text: 'With no birth time this was worked out for noon. The Lagna and every house position below are guesses; read the rashis the planets sit in, not the houses.' }));
  }

  if (!clean) {
    const parts = [];
    if (movedLagna) parts.push(`the Lagna (calculated ${state.raw.computed.lagna}, now ${state.raw.lagna})`);
    for (const e of edits.values()) parts.push(`${state.chart.planet(e.key).en} ${e.change}`);
    lines.push(el('p', { class: 'hint small', text: `Since then, changed by hand: ${parts.join('; ')}. What follows describes the chart as it stands now.` }));
  }

  host.append(el('div', { class: `callout ${clean ? '' : 'is-edited'}`.trim() }, lines));
}

function renderConfirm() {
  const chart = state.chart;

  const lagnaSign = chart.signOfHouse(1);
  const lagnaRashi = chart.rashi(lagnaSign);
  $('#confirm-lagna').textContent =
    `${lagnaRashi.en} (${lagnaRashi.sa}) rises, so square 1 is ${lagnaRashi.en} and the squares run ` +
    `anticlockwise from there. The Lagna lord is ${chart.planet(lagnaRashi.lord).en}.`;

  const confirmEdits = new Map(editedBodies(state.raw).map((e) => [e.key, e]));
  renderProvenanceCallout(confirmEdits);

  const host = $('#confirm-roster');
  host.textContent = '';

  for (const r of chart.roster()) {
    if (!r.placed) {
      // The outer planets are optional, so leaving them off is not an omission.
      if (!r.classical) continue;
      host.append(el('div', { class: 'roster-row is-missing' }, [
        el('span', { class: 'roster-name', text: r.planet.en }),
        el('span', { class: 'roster-where', text: 'not placed' }),
        el('span', { class: 'tag tag-plain', text: 'missing' }),
      ]));
      continue;
    }

    const tags = [];
    if (!r.classical) tags.push(el('span', { class: 'tag tag-plain', text: 'outside the nine' }));
    if (r.classical && !['neutral', 'friendly', 'enemy'].includes(r.dignity.state)) {
      tags.push(el('span', { class: `tag tag-${r.dignity.state}`, text: DIGNITY_LABEL[r.dignity.state] }));
    }
    if (r.retro) {
      tags.push(el('span', {
        class: 'tag tag-retro',
        text: r.retroState === 'always' ? 'always retrograde' : 'retrograde',
      }));
    }

    // Combustion is a fact about degrees, so it only appears where the chart
    // has them. Saying nothing is correct for a hand-entered chart: the reading
    // explains separately that it cannot be judged.
    if (r.combustion?.state === 'combust') {
      tags.push(el('span', {
        class: 'tag tag-combust',
        title: `${r.combustion.separation}\u00b0 from the Sun, inside its ${r.combustion.orb}\u00b0 orb`,
        text: 'combust',
      }));
    }

    // A body that no longer matches the calculation says so here, where the
    // person is being asked to approve the chart. Silently reading an edited
    // chart as though it were computed is the failure this whole screen exists
    // to prevent.
    const edit = confirmEdits.get(r.key);
    if (edit) {
      tags.push(el('span', {
        class: 'tag tag-edited',
        title: edit.was ? `calculated: square ${edit.was.house}${edit.was.degree === null ? '' : `, ${edit.was.degree.toFixed(2)} deg`}` : 'not in the calculation',
        text: `${edit.change} by hand`,
      }));
    }

    const extras = [];
    if (!r.classical) {
      extras.push('no classical rule refers to this body, so it does not change the reading');
    } else {
      if (r.rules.length) {
        extras.push(`rules the ${r.rules.map((h) => ordinal(h)).join(' and ')}`);
      }
      if (['friendly', 'enemy', 'neutral'].includes(r.dignity.state)) {
        extras.push(DIGNITY_LABEL[r.dignity.state]);
      }
      if (r.combustion?.state === 'combust') {
        extras.push(`burnt: ${r.combustion.separation}\u00b0 from the Sun, orb ${r.combustion.orb}\u00b0`);
      }
      if (r.dignity.couldBe === 'moolatrikona') {
        extras.push('own sign; a degree would say whether it is moolatrikona');
      }
      extras.push(r.aspecting.length === 1
        ? `aspects square ${r.aspecting[0]}`
        : `aspects squares ${r.aspecting.join(', ')}`);
    }

    host.append(el('div', { class: 'roster-row' }, [
      el('span', { class: 'roster-name', text: r.planet.en }),
      el('span', { class: 'roster-where' }, [
        el('strong', { text: r.rashi.en }),
        ` — square ${r.house}, ${ordinal(r.house)} house`,
      ]),
      el('span', {}, tags),
      el('span', { class: 'roster-extra', text: extras.join(' · ') }),
    ]));
  }

  const table = el('table', { class: 'house-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: 'Square' }), el('th', { text: 'Rashi' }),
      el('th', { text: 'Lord' }), el('th', { text: 'Holds' }),
    ])),
    el('tbody', {}, Array.from({ length: 12 }, (_, i) => {
      const h = i + 1;
      const sign = chart.signOfHouse(h);
      const occupants = chart.occupants(h);
      return el('tr', {}, [
        el('td', { text: `${h} (${ordinal(h)})` }),
        el('td', { text: `${sign} ${chart.rashi(sign).en}` }),
        el('td', { text: chart.planet(chart.lordOfHouse(h)).en }),
        el('td', { text: occupants.length ? occupants.map((p) => chart.planet(p).en).join(', ') : '—' }),
      ]);
    })),
  ]);

  const host2 = $('#confirm-houses');
  host2.textContent = '';
  host2.append(el('details', {}, [
    el('summary', { text: 'All twelve squares, their rashis and lords' }),
    el('div', {}, table),
  ]));

  const missing = chart.missing;
  $('#btn-to-reading').textContent = missing.length
    ? `Read it anyway (${missing.length} missing)`
    : 'Yes, read it';
}

/* --------------------------------------------------------------- reading */

function citeChip(c) {
  const label = c.locus ? `${c.label}, ${c.locus}` : c.label;
  return el('span', {
    class: `cite is-${c.authority}`,
    title: c.repoPath ? `${c.label} — ${c.repoPath}` : c.label,
    text: label,
  });
}

function findingNode(f, { showName = false } = {}) {
  const parts = [];
  if (showName && f.name) parts.push(el('p', { class: 'finding-name', text: f.name }));
  parts.push(el('p', { text: f.says }));
  parts.push(el('div', { class: 'finding-meta' }, [
    ...f.citations.map(citeChip),
    f.tradition !== 'parashari' ? el('span', { class: 'cite', text: f.tradition }) : null,
    f.status === 'disputed' ? el('span', { class: 'cite is-unverified', text: 'disputed' }) : null,
  ]));
  if (f.note) parts.push(el('p', { class: 'finding-note', text: f.note }));
  return el('div', { class: `finding is-${f.polarity}` }, parts);
}

/**
 * Build the reading from the plain view model. A live reading and one restored
 * from the library both come through here, so a saved reading renders exactly
 * as it did on the day it was taken.
 */
function readingNodes(view) {
  const out = [];

  out.push(el('div', { class: 'derived-list' }, view.derived.map((d) => el('p', { text: d.text }))));

  if (view.missing.length) {
    out.push(el('div', { class: 'callout', text:
      `${view.missing.join(', ')} ${view.missing.length === 1 ? 'is' : 'are'} not placed, so anything ` +
      'depending on them is absent from this reading rather than ruled out.' }));
  }

  if (view.combinations.length) {
    out.push(el('section', { class: 'reading-section' }, [
      el('h3', { text: `Combinations (${view.combinations.length})` }),
      ...view.combinations.map((f) => findingNode(f, { showName: true })),
    ]));
  }

  for (const section of view.sections) {
    out.push(el('section', { class: 'reading-section' }, [
      el('h3', { text: section.title }),
      ...section.findings.map((f) => findingNode(f)),
    ]));
  }

  if (view.unsectioned.length) {
    out.push(el('section', { class: 'reading-section' }, [
      el('h3', { text: 'Also' }),
      ...view.unsectioned.map((f) => findingNode(f)),
    ]));
  }

  const { pairs, disputed } = view.conflicts;
  if (pairs.length || disputed.length) {
    const nodes = [];
    for (const { a, b, reason } of pairs) {
      nodes.push(el('div', { class: 'conflict' }, [
        el('div', { class: 'conflict-side' }, [
          el('p', { text: a.says }),
          el('div', { class: 'finding-meta' }, a.citations.map(citeChip)),
        ]),
        el('p', { class: 'conflict-versus', text: reason === 'stated' ? 'against' : 'pulls against' }),
        el('div', { class: 'conflict-side' }, [
          el('p', { text: b.says }),
          el('div', { class: 'finding-meta' }, b.citations.map(citeChip)),
        ]),
      ]));
    }
    for (const f of disputed) {
      nodes.push(el('div', { class: 'conflict' }, [
        el('div', { class: 'conflict-side' }, [
          el('p', { text: f.says }),
          el('div', { class: 'finding-meta' }, [...f.citations.map(citeChip), el('span', { class: 'cite is-unverified', text: 'disputed' })]),
        ]),
      ]));
    }
    out.push(el('section', { class: 'reading-section' }, [
      el('h3', { text: 'Where the sources differ' }),
      el('p', { class: 'hint small', text: 'AstroBot does not pick a winner. Both readings are shown with their sources.' }),
      ...nodes,
    ]));
  }

  out.push(el('details', {}, [
    el('summary', { text: `Matched ${view.stats.matched} of ${view.stats.ofTotal} rules` }),
    el('div', {}, [
      el('p', { class: 'hint small', text:
        'A rule matches only when its exact condition is present in the chart, so most of the ' +
        `knowledge base stays silent for any one chart. Chart code: ${view.chartCode || 'unknown'}` }),
      ...(view.broken.length
        ? [el('p', { class: 'hint small', text: `${view.broken.length} rule(s) could not be evaluated: ${view.broken.join(', ')}` })]
        : []),
    ]),
  ]));

  return out;
}

/**
 * The running period, where the chart can support one. Worked out fresh each
 * time a reading is composed, so it follows the clock rather than whatever was
 * true when the chart was entered.
 */
function dashaContext() {
  return { dasha: dashaFor(state.chart, state.raw.birth || {}, Date.now()) };
}

/**
 * The sub-periods that overlap a window of time, each with the dates it runs.
 *
 * Mahadashas are too coarse to answer a question about a year - a Saturn period
 * runs nineteen of them - so the timeline is built from antardashas, which run
 * months to about three years. A period is included when it overlaps the window
 * at all, so the one running now appears first even though it began earlier.
 */
/** The horizons offered, in the order they are shown. */
const HORIZONS = [
  { key: 'current', label: 'Current', title: 'Only the sub-period running now' },
  { key: 'next', label: 'Next', title: 'Only the sub-period after this one' },
  { key: '3y', label: '3y', years: 3, title: 'Every sub-period in the next three years' },
  { key: '5y', label: '5y', years: 5, title: 'Every sub-period in the next five years' },
];

const DEFAULT_HORIZON = 'current';

function periodsAhead(horizon) {
  const dasha = dashaFor(state.chart, state.raw.birth || {}, Date.now());
  if (!dasha.available) return { available: false, reason: dasha.reason };

  const now = Date.now();
  const spec = HORIZONS.find((h) => h.key === horizon) || HORIZONS[0];

  // Every sub-period of the cycle in order, so "current" and "next" are picked
  // by position rather than by a date window. A window cannot express "the one
  // after this one": sub-periods run anywhere from months to three years, so no
  // fixed span lands on exactly two of them.
  const all = [];
  for (const maha of dasha.sequence) {
    for (const antar of antardashas(maha)) all.push({ maha, antar });
  }

  let periods;
  if (spec.years) {
    const to = now + spec.years * 365.2425 * 86400000;
    periods = all.filter((p) => p.antar.to >= now && p.antar.from <= to);
  } else {
    const i = all.findIndex((p) => now >= p.antar.from && now < p.antar.to);
    if (i === -1) periods = [];
    else periods = spec.key === 'current' ? all.slice(i, i + 1) : all.slice(i + 1, i + 2);
  }

  return { available: true, periods, nakshatra: dasha.nakshatra, horizon: spec };
}

/**
 * Run the engine once per sub-period and keep what it says about each.
 *
 * Deliberately a fresh evaluation per period rather than a filter over one
 * reading: almost every rule in the base describes the chart permanently and
 * would say the same thing for every year, so the only honest way to show what
 * changes is to ask the engine again with the clock moved.
 */
function readingsAhead(horizon) {
  const found = periodsAhead(horizon);
  if (!found.available) return found;

  const dated = found.periods.map(({ maha, antar }) => {
    const at = antar.from + (antar.to - antar.from) / 2;
    const ctx = { dasha: dashaFor(state.chart, state.raw.birth || {}, at) };
    const reading = compose(state.chart, state.kb, ctx);
    return {
      maha: maha.lord,
      antar: antar.lord,
      from: antar.from,
      to: antar.to,
      running: Date.now() >= antar.from && Date.now() < antar.to,
      findings: (reading.sections.find((s) => s.key === 'period')?.findings || [])
        // The mahadasha statements repeat on every row of a long period, which
        // reads as padding. Keep what is specific to this sub-period, and let
        // the mahadasha be stated once in the reading above.
        .filter((f) => f.rule.when?.all?.some((c) => c.antardashaLord)),
    };
  });

  return { available: true, periods: dated, nakshatra: found.nakshatra, horizon: found.horizon };
}

/** The reading's period panel: a button, and what it found when pressed. */
function yearsAheadNodes() {
  const out = [];
  const horizon = state.yearsAhead;

  const bar = el('div', { class: 'ahead-bar' }, [
    el('button', {
      type: 'button',
      class: horizon ? 'btn btn-quiet' : 'btn btn-primary',
      onclick: () => { state.yearsAhead = horizon ? null : DEFAULT_HORIZON; renderReading(); },
    }, horizon ? 'Hide the periods' : 'Predictions for this year and ahead'),
  ]);

  if (horizon) {
    for (const h of HORIZONS) {
      bar.append(el('button', {
        type: 'button',
        class: `btn btn-quiet nudge${h.key === horizon ? ' is-active' : ''}`,
        title: h.title,
        onclick: () => { state.yearsAhead = h.key; renderReading(); },
      }, h.label));
    }
  }
  out.push(bar);

  if (!horizon) return out;

  const result = readingsAhead(horizon);
  if (!result.available) {
    out.push(el('div', { class: 'callout', text:
      result.reason === 'no-degrees'
        ? 'This chart was entered by hand, so there is no birth moment to date periods from. Calculating it from birth details would give dated predictions.'
        : 'No birth details are stored for this chart, so its periods cannot be dated. Calculating it from birth details would fix that.' }));
    return out;
  }

  if (!result.periods.length) {
    out.push(el('div', { class: 'callout', text: result.horizon?.years
      ? `No sub-period falls in the next ${result.horizon.years} years, so the reading above covers the whole stretch.`
      : 'The birth moment falls outside the cycle this chart can date, so there is no period to show.' }));
    return out;
  }

  const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const yearSpan = (a, b) => {
    const ya = new Date(a).getFullYear();
    const yb = new Date(b).getFullYear();
    return ya === yb ? `${ya}` : `${ya}–${yb}`;
  };

  const list = el('div', { class: 'ahead-list' });
  for (const p of result.periods) {
    const planet = (k) => state.chart.planet(k).en;
    list.append(el('div', { class: `ahead-period${p.running ? ' is-running' : ''}` }, [
      el('div', { class: 'ahead-head' }, [
        el('span', { class: 'ahead-years', text: yearSpan(p.from, p.to) }),
        el('span', { class: 'ahead-pair', text: `${planet(p.maha)} / ${planet(p.antar)}` }),
        p.running ? el('span', { class: 'tag tag-ownSign', text: 'running now' }) : null,
      ]),
      el('p', { class: 'hint small', text: `${fmt(p.from)} to ${fmt(p.to)}` }),
      ...(p.findings.length
        ? p.findings.map((f) => el('p', { class: 'ahead-says', text: f.rule.says }))
        // Silence here has two quite different causes and it is worth not
        // pretending otherwise: either no rule exists for the pair, or one
        // exists and its condition is unmet, because BPHS states most
        // sub-period results only for a well-placed sub-lord and the adverse
        // verses are not yet encoded.
        : [el('p', { class: 'hint small', text: 'Nothing specific for this pair: either no rule is written for it, or the one that is applies only where the sub-period lord is strongly placed, and in this chart it is not.' })]),
      ...p.findings.flatMap((f) => [el('div', { class: 'finding-meta' }, f.citations.map(citeChip))]),
    ]));
  }
  out.push(list);

  out.push(el('p', { class: 'hint small', text:
    `Dated from the Moon in ${result.nakshatra.name}. Only what the sub-period changes is shown; everything the chart says permanently is in the reading below.` }));

  return out;
}

function currentView() {
  if (!state.readingView) {
    state.reading = state.reading || compose(state.chart, state.kb, dashaContext());
    state.readingView = toView(state.reading, state.chart, state.raw);
  }
  return state.readingView;
}

function renderReading() {
  const host = $('#reading-host');
  host.textContent = '';

  if (state.viewingReading) {
    renderSavedReading(host, state.viewingReading);
    return;
  }

  if (!state.chart || state.chart.placed.length === 0) {
    host.append(el('div', { class: 'empty', text: 'Enter a chart first, then confirm it.' }));
    return;
  }

  if (!state.confirmed) {
    host.append(el('div', { class: 'empty' }, [
      'Confirm the chart before reading it. ',
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => show('confirm') }, 'Go to confirmation'),
    ]));
    return;
  }

  const view = currentView();
  const code = view.chartCode;
  const earlier = readingsForChart(code);

  host.append(el('div', { class: 'save-bar' }, [
    el('button', { class: 'btn btn-primary', type: 'button', onclick: onSaveReading }, 'Save this reading'),
    el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => show('saved') }, 'Saved'),
    earlier.length
      ? el('span', { class: 'pill', text: `${earlier.length} earlier of this chart` })
      : null,
  ]));
  host.append(el('p', { id: 'reading-status', class: 'status' }));

  // Before the reading proper: the reading describes the chart, and this says
  // which part of it is live now and next.
  for (const node of yearsAheadNodes()) host.append(node);

  for (const node of readingNodes(view)) host.append(node);
}

function onSaveReading() {
  const view = currentView();
  const title = state.raw.name?.trim() || `${view.lagnaRashi} lagna`;
  const { ok } = saveReading({
    title,
    chartCode: view.chartCode,
    chart: state.raw,
    view,
    kbUpdated: state.kb.updated,
    kbRules: state.kb.rules.length,
  });

  const node = $('#reading-status');
  if (!node) return;
  if (ok) {
    node.textContent = `Saved as "${title}". It keeps the text exactly as it reads now, so a later reading can be compared with it.`;
    node.className = 'status is-good';
    renderReading();
    // Re-rendering clears the message, so put it back on the fresh node.
    const again = $('#reading-status');
    if (again) {
      again.textContent = `Saved as "${title}".`;
      again.className = 'status is-good';
    }
  } else {
    node.textContent = 'This browser would not store the reading. Export your library or delete a few saved items.';
    node.className = 'status is-bad';
  }
}

/* ------------------------------------------------------------- knowledge */

function renderLibrary() {
  const stats = $('#kb-stats');
  stats.textContent = '';
  const counts = {};
  for (const r of state.kb.rules) counts[r.family] = (counts[r.family] || 0) + 1;
  // The counts double as the filter: a click narrows the list to that family,
  // and clicking the same one again clears it, so a double click clears too.
  //
  // Done as a toggle rather than with a dblclick handler, which looks like the
  // obvious way and does not work. Selecting a family re-renders these pills, so
  // the node the gesture started on is gone before the second click lands; the
  // browser then dispatches dblclick on the nearest common ancestor rather than
  // on the button, and a handler on the button never runs. A toggle needs no
  // dblclick at all - two clicks are set-then-clear - so it cannot be broken by
  // a re-render.
  stats.append(el('button', {
    type: 'button',
    class: `pill pill-btn${state.kbFamily ? '' : ' is-active'}`,
    title: 'Show every rule',
    onclick: () => { state.kbFamily = null; renderLibrary(); },
  }, `${state.kb.rules.length} rules`));

  for (const [family, n] of Object.entries(counts).sort()) {
    const active = state.kbFamily === family;
    stats.append(el('button', {
      type: 'button',
      class: `pill pill-btn${active ? ' is-active' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      title: active ? 'Click again to show every rule' : `Show only ${family.replace(/-/g, ' ')} rules`,
      onclick: () => { state.kbFamily = active ? null : family; renderLibrary(); },
    }, `${family.replace(/-/g, ' ')}: ${n}`));
  }

  renderKbResults($('#kb-search').value);

  const host = $('#kb-sources');
  if (!host.childElementCount) {
    const sources = state.kb.base.sources;
    host.append(el('details', {}, [
      el('summary', { text: 'Sources AstroBot cites' }),
      el('div', {}, [
        ...Object.entries(sources.sources).map(([key, s]) => el('div', { class: 'source-item' }, [
          el('strong', { text: s.title }),
          el('span', { text: [s.author, s.era, `authority: ${s.authority || 'secondary'}`].filter(Boolean).join(' · ') }),
          s.note ? el('span', { text: ` ${s.note}` }) : null,
        ])),
        el('p', { class: 'hint small', text: sources.note }),
      ]),
    ]));
  }
}

function renderKbResults(query) {
  const host = $('#kb-results');
  host.textContent = '';
  const q = (query || '').trim().toLowerCase();

  let rules = state.kb.rules;
  if (state.kbFamily) rules = rules.filter((r) => r.family === state.kbFamily);
  if (q) {
    rules = rules.filter((r) =>
      r.says.toLowerCase().includes(q) ||
      (r.name || '').toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.themes.some((t) => t.includes(q)) ||
      r.family.includes(q) ||
      r.tradition.includes(q));
  }

  if (!rules.length) {
    host.append(el('div', { class: 'empty', text: state.kbFamily
      ? `Nothing matches that within ${state.kbFamily.replace(/-/g, ' ')}. Click the family again to search everything.`
      : 'Nothing matches that. Try a planet, a theme, or a yoga name.' }));
    return;
  }

  // A chosen family is as deliberate as a typed query, so it gets the same
  // allowance. Otherwise picking "planet in house: 109" would show thirty.
  const shown = rules.slice(0, q || state.kbFamily ? 120 : 30);
  for (const r of shown) {
    host.append(el('div', { class: 'kb-rule' }, [
      el('div', { class: 'kb-rule-head' }, [
        r.name ? el('span', { class: 'finding-name', text: r.name }) : null,
        el('span', { class: 'kb-id', text: r.id }),
        el('span', { class: 'tag tag-plain', text: r.family.replace(/-/g, ' ') }),
        r.status === 'disputed' ? el('span', { class: 'cite is-unverified', text: 'disputed' }) : null,
      ]),
      el('p', { text: r.says }),
      el('div', { class: 'finding-meta' }, (r.sources || []).map((ref) => {
        const s = state.kb.base.sources.sources[ref.key];
        return el('span', { class: `cite is-${s?.authority || 'unverified'}`, text: s ? `${s.title}${ref.locus ? `, ${ref.locus}` : ''}` : ref.key });
      })),
    ]));
  }

  if (rules.length > shown.length) {
    host.append(el('p', { class: 'hint small', text: `${rules.length - shown.length} more. ${state.kbFamily ? 'Search within this family to see them.' : 'Narrow the search to see them.'}` }));
  }
}

/* -------------------------------------------------------- add knowledge */

function submissionFromForm() {
  const text = $('#add-text').value.trim();
  if (!text) return null;
  return {
    text,
    source: $('#add-source').value.trim(),
    tradition: $('#add-tradition').value,
    comment: $('#add-comment').value.trim(),
    chart: state.chart && state.chart.placed.length ? encodeChart(state.raw) : null,
    at: new Date().toISOString(),
  };
}

function clearForm() {
  $('#add-text').value = '';
  $('#add-source').value = '';
  $('#add-comment').value = '';
}

function issueBody(sub) {
  return [
    '### Claim',
    '',
    sub.text,
    '',
    '### Where it came from',
    '',
    sub.source || '_not given_',
    '',
    '### Tradition',
    '',
    sub.tradition,
    '',
    ...(sub.comment ? ['### Submitter note', '', sub.comment, ''] : []),
    ...(sub.chart ? ['### Chart it was noticed on', '', `\`${sub.chart}\``, ''] : []),
    '---',
    '',
    `Filed from the AstroBot app on ${new Date(sub.at).toUTCString()}.`,
    'Reconcile against `knowledge/rules/` before merging. Flag contradictions rather than overwriting.',
  ].join('\n');
}

function renderQueue() {
  const queue = store.get(STORE.queue, []);
  const host = $('#add-queue');
  host.textContent = '';
  if (!queue.length) return;

  host.append(el('p', { class: 'hint small', text: `${queue.length} saved on this device and not yet sent.` }));
  queue.forEach((sub, i) => {
    host.append(el('div', { class: 'queue-item' }, [
      el('span', { text: sub.text.slice(0, 90) + (sub.text.length > 90 ? '...' : '') }),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => sendOne(i) }, 'Send'),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
        const next = store.get(STORE.queue, []);
        next.splice(i, 1);
        store.set(STORE.queue, next);
        renderQueue();
      } }, 'Delete'),
    ]));
  });
}

function ghSettings() {
  return store.get(STORE.gh, { repo: '', token: '' });
}

async function postIssue(sub) {
  const { repo, token } = ghSettings();
  if (!repo || !token) {
    throw new Error('Set the repository and token under Settings first.');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('Repository should look like owner/name.');
  }

  const title = `Knowledge: ${sub.text.slice(0, 70).replace(/\s+/g, ' ')}${sub.text.length > 70 ? '...' : ''}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title, body: issueBody(sub), labels: ['knowledge-submission'] }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('GitHub rejected the token. Check it under Settings.');
    if (res.status === 403) throw new Error('Token lacks permission to open issues on that repository.');
    if (res.status === 404) throw new Error('Repository not found, or the token cannot see it.');
    throw new Error(`GitHub returned ${res.status}. ${detail.slice(0, 120)}`);
  }
  return res.json();
}

function setAddStatus(message, tone = '') {
  const node = $('#add-status');
  node.textContent = message;
  node.className = `status${tone ? ` is-${tone}` : ''}`;
}

async function sendOne(index) {
  const queue = store.get(STORE.queue, []);
  const sub = queue[index];
  if (!sub) return;
  setAddStatus('Sending...');
  try {
    const issue = await postIssue(sub);
    queue.splice(index, 1);
    store.set(STORE.queue, queue);
    renderQueue();
    setAddStatus(`Filed as issue #${issue.number}.`, 'good');
  } catch (err) {
    setAddStatus(err.message, 'bad');
  }
}

/* ----------------------------------------------------------------- saved */

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function setSavedStatus(message, tone = '') {
  const node = $('#chart-save-status');
  if (!node) return;
  node.textContent = message;
  node.className = `status${tone ? ` is-${tone}` : ''}`;
}

function openSavedChart(row) {
  const loaded = chartOf(row, decodeChart);
  if (!loaded) return;
  loaded.name = row.name === 'Untitled' ? '' : row.name;
  state.raw = loaded;
  state.viewingReading = null;
  rebuild();
  show('chart');
}

function onSaveChart() {
  if (!state.chart.placed.length) return setSavedStatus('Place at least one planet first.', 'bad');
  const name = ($('#chart-name').value || '').trim();
  const { ok, updated } = saveChart({ name, code: encodeChart(state.raw), chart: state.raw });
  if (!ok) return setSavedStatus('This browser would not store the chart.', 'bad');
  return setSavedStatus(
    updated
      ? `Updated "${name || 'Untitled'}" in your saved kundalis.`
      : `Saved "${name || 'Untitled'}". Open it again from Saved.`,
    'good',
  );
}

function viewSavedReading(id) {
  const row = getReading(id);
  if (!row) return;
  state.viewingReading = row;
  show('reading');
}

function renderSavedReading(host, row) {
  const now = state.kb.rules.length;
  const then = row.kbRules || 0;
  const driftNote = !then
    ? 'The size of the knowledge base at the time was not recorded.'
    : then === now
      ? `The knowledge base is the same size now (${now} rules), so a fresh reading would most likely match.`
      : `The knowledge base held ${then} rules then and holds ${now} now, so a fresh reading may differ.`;

  host.append(el('div', { class: 'callout' }, [
    el('p', { class: 'saved-banner-title', text: `Saved reading — ${row.title}` }),
    el('p', { class: 'hint small', text: `Taken ${when(row.savedAt)}. This is the text as it read that day, not a fresh reading. ${driftNote}` }),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          const loaded = chartOf({ chart: row.chart, code: row.chartCode }, decodeChart);
          if (!loaded) return;
          loaded.name = row.title;
          state.raw = loaded;
          state.viewingReading = null;
          rebuild();
          state.confirmed = true;
          show('reading');
        },
      }, 'Read this chart again now'),
      el('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: () => { state.viewingReading = null; show('saved'); },
      }, 'Back to Saved'),
    ]),
  ]));

  for (const node of readingNodes(row.view)) host.append(node);
}

function setLibraryStatus(message, tone = '') {
  const node = $('#saved-status');
  if (!node) return;
  node.textContent = message;
  node.className = `status${tone ? ` is-${tone}` : ''}`;
}

function downloadLibrary() {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `astrobot-library-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setLibraryStatus('Exported. Keep the file somewhere safe: clearing site data wipes the copy in this browser.', 'good');
}

async function onImportFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const result = importAll(parsed);
    if (!result.ok) {
      setLibraryStatus(`Could not import: ${result.reason}.`, 'bad');
      return;
    }
    renderSaved();
    setLibraryStatus(
      `Imported ${result.addedCharts} kundali(s) and ${result.addedReadings} reading(s). Anything already here was kept.`,
      'good',
    );
  } catch (err) {
    setLibraryStatus(`That file could not be read as JSON: ${err.message}`, 'bad');
  }
}

function renderSaved() {
  const charts = listCharts();
  const readings = listReadings();

  const chartHost = $('#saved-charts');
  chartHost.textContent = '';
  if (!charts.length) {
    chartHost.append(el('p', { class: 'hint small', text: 'No kundalis saved yet. Enter a chart and tap Save chart.' }));
  }
  for (const row of charts) {
    const mine = readingsForChart(row.code).length;
    chartHost.append(el('div', { class: 'saved-item' }, [
      el('div', { class: 'saved-main' }, [
        el('span', { class: 'saved-title', text: row.name || 'Untitled' }),
        el('span', {
          class: 'saved-sub',
          text: `${when(row.savedAt)} \u00b7 ${row.code}${mine ? ` \u00b7 ${mine} saved reading${mine === 1 ? '' : 's'}` : ''}`,
        }),
      ]),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openSavedChart(row) }, 'Open'),
      el('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: () => {
          const name = prompt('Name for this kundali', row.name || '');
          if (name === null) return;
          renameChart(row.id, name.trim() || 'Untitled');
          renderSaved();
        },
      }, 'Rename'),
      el('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: () => {
          if (!confirm(`Delete the kundali "${row.name || 'Untitled'}"? Saved readings of it are kept.`)) return;
          deleteChart(row.id);
          renderSaved();
        },
      }, 'Delete'),
    ]));
  }

  const readingHost = $('#saved-readings');
  readingHost.textContent = '';
  if (!readings.length) {
    readingHost.append(el('p', { class: 'hint small', text: 'No readings saved yet. Open a reading and tap Save this reading.' }));
  }
  for (const row of readings) {
    readingHost.append(el('div', { class: 'saved-item' }, [
      el('div', { class: 'saved-main' }, [
        el('span', { class: 'saved-title', text: row.title }),
        el('span', {
          class: 'saved-sub',
          text: `${when(row.savedAt)} \u00b7 ${row.view?.stats?.matched ?? '?'} findings \u00b7 ${row.kbRules || '?'} rules at the time`,
        }),
      ]),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => viewSavedReading(row.id) }, 'View'),
      el('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: () => {
          if (!confirm(`Delete the saved reading "${row.title}"?`)) return;
          deleteReading(row.id);
          renderSaved();
        },
      }, 'Delete'),
    ]));
  }

  const bytes = usage();
  $('#saved-usage').textContent = charts.length || readings.length
    ? `${charts.length} kundali(s), ${readings.length} reading(s), about ${Math.max(1, Math.round(bytes / 1024))} KB on this device.`
    : '';
}

/* -------------------------------------------------------------- settings */

function renderSettings() {
  const gh = ghSettings();
  $('#gh-repo').value = gh.repo || '';
  $('#gh-token').value = gh.token ? '•'.repeat(12) : '';
  $('#gh-status').textContent = gh.token ? 'A token is stored on this device.' : 'No token stored.';

  $('#about-text').textContent =
    `${state.kb.rules.length} rules, knowledge base updated ${state.kb.updated}. ` +
    'The reading is produced by a rules engine running in this browser; nothing about ' +
    'your chart leaves the device unless you file a knowledge submission.';
}

/* ------------------------------------------------------------------ boot */

const SAMPLE = '5.10.4.6.10.9.11.3.1.7';

async function boot() {
  const lagnaSelect = $('#lagna');

  try {
    state.kb = await loadKnowledge();
  } catch (err) {
    banner(`The knowledge base could not be loaded: ${err.message}`, 'bad');
    return;
  }

  if (state.kb.problems.length) {
    banner(`${state.kb.problems.length} knowledge file(s) had problems and were skipped.`, 'warn');
  }

  for (const r of state.kb.base.rashis.rashis) {
    lagnaSelect.append(el('option', { value: String(r.n), text: `${r.n}. ${r.en} (${r.sa})` }));
  }

  const fromUrl = new URLSearchParams(location.search).get('c');
  state.raw = (fromUrl && decodeChart(fromUrl)) || store.get(STORE.chart, null) || emptyChart();
  if (!state.raw.placements) state.raw.placements = {};
  state.chart = new Chart(state.raw, state.kb.base);
  renderChartView();

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    // Moving around the app leaves a snapshot behind; only the Reading tab keeps
    // showing one, so coming back to it after a detour is not surprising.
    if (tab.dataset.view !== 'reading') state.viewingReading = null;
    show(tab.dataset.view);
  }));
  $('#btn-settings').addEventListener('click', () => show('settings'));
  $('#btn-saved').addEventListener('click', () => show('saved'));
  $('#btn-open-saved').addEventListener('click', () => show('saved'));
  // Optional chaining for the same reason as the guards above: an older
  // cached page may not carry these buttons yet.
  $('#btn-open-birth')?.addEventListener('click', () => show('birth'));
  $('#btn-birth-back')?.addEventListener('click', () => show('chart'));
  $('#btn-save-chart').addEventListener('click', onSaveChart);
  $('#btn-export').addEventListener('click', downloadLibrary);
  $('#import-file').addEventListener('change', (ev) => {
    onImportFile(ev.target.files?.[0]);
    ev.target.value = '';
  });

  lagnaSelect.addEventListener('change', () => {
    state.raw.lagna = Number(lagnaSelect.value);
    rebuild();
  });

  $('#chart-name').addEventListener('input', (ev) => {
    state.raw.name = ev.target.value;
    store.set(STORE.chart, state.raw);
    $('#chart-label').textContent = state.raw.name || `${state.chart.placed.length}/9 placed`;
  });

  $('#btn-clear').addEventListener('click', () => {
    state.raw = emptyChart();
    rebuild();
  });

  $('#btn-sample').addEventListener('click', () => {
    const loaded = decodeChart(SAMPLE);
    loaded.name = 'Sample chart';
    state.raw = loaded;
    rebuild();
  });

  $('#btn-to-confirm').addEventListener('click', () => show('confirm'));

  $('#btn-back-to-chart').addEventListener('click', () => show('chart'));

  $('#btn-to-reading').addEventListener('click', () => {
    state.confirmed = true;
    state.reading = null;
    state.readingView = null;
    show('reading');
  });

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  });

  let searchTimer = null;
  $('#kb-search').addEventListener('input', (ev) => {
    clearTimeout(searchTimer);
    const value = ev.target.value;
    searchTimer = setTimeout(() => renderKbResults(value), 120);
  });

  $('#btn-queue').addEventListener('click', () => {
    const sub = submissionFromForm();
    if (!sub) return setAddStatus('Write the claim first.', 'bad');
    const queue = store.get(STORE.queue, []);
    queue.push(sub);
    if (!store.set(STORE.queue, queue)) return setAddStatus('This browser will not let the app store anything.', 'bad');
    clearForm();
    renderQueue();
    setAddStatus('Saved on this device.', 'good');
  });

  $('#btn-submit').addEventListener('click', async () => {
    const sub = submissionFromForm();
    if (!sub) return setAddStatus('Write the claim first.', 'bad');
    setAddStatus('Sending...');
    try {
      const issue = await postIssue(sub);
      clearForm();
      setAddStatus(`Filed as issue #${issue.number}. It will be reconciled before anything changes.`, 'good');
    } catch (err) {
      setAddStatus(err.message, 'bad');
    }
  });

  $('#btn-save-gh').addEventListener('click', () => {
    const repo = $('#gh-repo').value.trim();
    const typed = $('#gh-token').value.trim();
    const existing = ghSettings();
    const token = /^•+$/.test(typed) ? existing.token : typed;
    store.set(STORE.gh, { repo, token });
    $('#gh-status').textContent = token ? 'Saved on this device.' : 'Repository saved; no token stored.';
  });

  $('#btn-clear-token').addEventListener('click', () => {
    const { repo } = ghSettings();
    store.set(STORE.gh, { repo, token: '' });
    $('#gh-token').value = '';
    $('#gh-status').textContent = 'Token forgotten.';
  });

  renderQueue();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch { /* offline support is a bonus, not a requirement */ }
  }
}

boot();
