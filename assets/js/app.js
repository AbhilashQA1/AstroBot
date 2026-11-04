// AstroBot UI. No framework: a handful of render functions over one piece of state.

import { Chart, PLANET_KEYS, decodeChart, emptyChart, encodeChart } from './model.js';
import { loadKnowledge } from './kb.js';
import { compose, ordinal } from './engine.js';
import { renderChart } from './chartview.js';

const STORE = {
  chart: 'astrobot.chart',
  charts: 'astrobot.charts',
  gh: 'astrobot.github',
  queue: 'astrobot.queue',
};

// Storage can be unavailable (private windows, blocked site data) and must never
// take the app down with it.
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch { /* nothing to do */ }
  },
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

  if (view === 'confirm') renderConfirm();
  if (view === 'reading') renderReading();
  if (view === 'library') renderLibrary();
  if (view === 'settings') renderSettings();
}

/* ------------------------------------------------------------ chart entry */

function rebuild() {
  state.raw.updatedAt = new Date().toISOString();
  state.chart = new Chart(state.raw, state.kb.base);
  state.confirmed = false;
  state.reading = null;
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
  $('#placed-count').textContent = `${placed} of 9 placed`;
  $('#btn-to-confirm').disabled = placed === 0;
  $('#lagna').value = String(chart.lagna);
  $('#chart-name').value = state.raw.name || '';
  $('#chart-label').textContent = state.raw.name || (placed ? `${placed}/9 placed` : 'New chart');
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

  for (const p of PLANET_KEYS) {
    const data = chart.planet(p);
    const at = chart.houseOf(p);
    const here = at === house;
    const elsewhere = at !== null && !here;
    const isNode = ['ra', 'ke'].includes(p);

    const chip = el('button', {
      type: 'button',
      class: `planet-chip${here ? ' is-here' : ''}${elsewhere ? ' is-elsewhere' : ''}`,
      'aria-pressed': here ? 'true' : 'false',
      onclick: () => togglePlanet(p, house),
    }, [
      el('span', { class: 'glyph', text: data.glyph }),
      el('span', { text: data.en }),
    ]);

    if (elsewhere) {
      chip.append(el('span', { class: 'where', text: `sq ${at}` }));
    } else if (here && !isNode && data.retrogrades) {
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
    }

    grid.append(chip);
  }

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
  else state.raw.placements[p] = { house, retro: Boolean(state.raw.placements[p]?.retro) };
  rebuild();
  openSheet(house);
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

function renderConfirm() {
  const chart = state.chart;

  const lagnaSign = chart.signOfHouse(1);
  const lagnaRashi = chart.rashi(lagnaSign);
  $('#confirm-lagna').textContent =
    `${lagnaRashi.en} (${lagnaRashi.sa}) rises, so square 1 is ${lagnaRashi.en} and the squares run ` +
    `anticlockwise from there. The Lagna lord is ${chart.planet(lagnaRashi.lord).en}.`;

  const host = $('#confirm-roster');
  host.textContent = '';

  for (const r of chart.roster()) {
    if (!r.placed) {
      host.append(el('div', { class: 'roster-row is-missing' }, [
        el('span', { class: 'roster-name', text: r.planet.en }),
        el('span', { class: 'roster-where', text: 'not placed' }),
        el('span', { class: 'tag tag-plain', text: 'missing' }),
      ]));
      continue;
    }

    const tags = [];
    if (r.dignity.state !== 'neutral' && r.dignity.state !== 'friendly' && r.dignity.state !== 'enemy') {
      tags.push(el('span', { class: `tag tag-${r.dignity.state}`, text: DIGNITY_LABEL[r.dignity.state] }));
    }
    if (r.retro) tags.push(el('span', { class: 'tag tag-retro', text: 'retrograde' }));

    const extras = [];
    if (r.rules.length) {
      extras.push(`rules the ${r.rules.map((h) => ordinal(h)).join(' and ')}`);
    }
    if (['friendly', 'enemy', 'neutral'].includes(r.dignity.state)) {
      extras.push(DIGNITY_LABEL[r.dignity.state]);
    }
    if (r.dignity.couldBe === 'moolatrikona') {
      extras.push('own sign; a degree would say whether it is moolatrikona');
    }
    extras.push(r.aspecting.length === 1
      ? `aspects square ${r.aspecting[0]}`
      : `aspects squares ${r.aspecting.join(', ')}`);

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
  if (showName && f.rule.name) parts.push(el('p', { class: 'finding-name', text: f.rule.name }));
  parts.push(el('p', { text: f.rule.says }));
  parts.push(el('div', { class: 'finding-meta' }, [
    ...f.citations.map(citeChip),
    f.rule.tradition !== 'parashari' ? el('span', { class: 'cite', text: f.rule.tradition }) : null,
    f.rule.status === 'disputed' ? el('span', { class: 'cite is-unverified', text: 'disputed' }) : null,
  ]));
  if (f.rule.note) parts.push(el('p', { class: 'finding-note', text: f.rule.note }));
  return el('div', { class: `finding is-${f.rule.polarity}` }, parts);
}

function renderReading() {
  const host = $('#reading-host');
  host.textContent = '';

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

  const reading = state.reading || (state.reading = compose(state.chart, state.kb));

  host.append(el('div', { class: 'derived-list' },
    reading.derived.map((d) => el('p', { text: d.text }))));

  if (state.chart.missing.length) {
    host.append(el('div', { class: 'callout', text:
      `${state.chart.missing.map((p) => state.chart.planet(p).en).join(', ')} ` +
      `${state.chart.missing.length === 1 ? 'is' : 'are'} not placed, so anything depending on ` +
      'them is absent from this reading rather than ruled out.' }));
  }

  if (reading.combinations.length) {
    host.append(el('section', { class: 'reading-section' }, [
      el('h3', { text: `Combinations (${reading.combinations.length})` }),
      ...reading.combinations.map((f) => findingNode(f, { showName: true })),
    ]));
  }

  for (const section of reading.sections) {
    host.append(el('section', { class: 'reading-section' }, [
      el('h3', { text: section.title }),
      ...section.findings.map((f) => findingNode(f)),
    ]));
  }

  if (reading.unsectioned.length) {
    host.append(el('section', { class: 'reading-section' }, [
      el('h3', { text: 'Also' }),
      ...reading.unsectioned.map((f) => findingNode(f)),
    ]));
  }

  const { pairs, disputed } = reading.conflicts;
  if (pairs.length || disputed.length) {
    const nodes = [];
    for (const { a, b, reason } of pairs) {
      nodes.push(el('div', { class: 'conflict' }, [
        el('div', { class: 'conflict-side' }, [
          el('p', { text: a.rule.says }),
          el('div', { class: 'finding-meta' }, a.citations.map(citeChip)),
        ]),
        el('p', { class: 'conflict-versus', text: reason === 'stated' ? 'against' : 'pulls against' }),
        el('div', { class: 'conflict-side' }, [
          el('p', { text: b.rule.says }),
          el('div', { class: 'finding-meta' }, b.citations.map(citeChip)),
        ]),
      ]));
    }
    for (const f of disputed) {
      nodes.push(el('div', { class: 'conflict' }, [
        el('div', { class: 'conflict-side' }, [
          el('p', { text: f.rule.says }),
          el('div', { class: 'finding-meta' }, [...f.citations.map(citeChip), el('span', { class: 'cite is-unverified', text: 'disputed' })]),
        ]),
      ]));
    }
    host.append(el('section', { class: 'reading-section' }, [
      el('h3', { text: 'Where the sources differ' }),
      el('p', { class: 'hint small', text: 'AstroBot does not pick a winner. Both readings are shown with their sources.' }),
      ...nodes,
    ]));
  }

  host.append(el('details', {}, [
    el('summary', { text: `Matched ${reading.stats.matched} of ${reading.stats.ofTotal} rules` }),
    el('div', {}, [
      el('p', { class: 'hint small', text:
        'A rule matches only when its exact condition is present in the chart, so most of the ' +
        'knowledge base stays silent for any one chart. Chart code: ' + encodeChart(state.raw) }),
      ...(reading.broken.length
        ? [el('p', { class: 'hint small', text: `${reading.broken.length} rule(s) could not be evaluated: ${reading.broken.map((b) => b.id).join(', ')}` })]
        : []),
    ]),
  ]));
}

/* ------------------------------------------------------------- knowledge */

function renderLibrary() {
  const stats = $('#kb-stats');
  stats.textContent = '';
  const counts = {};
  for (const r of state.kb.rules) counts[r.family] = (counts[r.family] || 0) + 1;
  stats.append(el('span', { class: 'pill', text: `${state.kb.rules.length} rules` }));
  for (const [family, n] of Object.entries(counts).sort()) {
    stats.append(el('span', { class: 'pill', text: `${family.replace(/-/g, ' ')}: ${n}` }));
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
    host.append(el('div', { class: 'empty', text: 'Nothing matches that. Try a planet, a theme, or a yoga name.' }));
    return;
  }

  const shown = rules.slice(0, q ? 80 : 30);
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
    host.append(el('p', { class: 'hint small', text: `${rules.length - shown.length} more. Narrow the search to see them.` }));
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

/* -------------------------------------------------------------- settings */

function renderSettings() {
  const gh = ghSettings();
  $('#gh-repo').value = gh.repo || '';
  $('#gh-token').value = gh.token ? '•'.repeat(12) : '';
  $('#gh-status').textContent = gh.token ? 'A token is stored on this device.' : 'No token stored.';

  const host = $('#saved-charts');
  host.textContent = '';
  const charts = store.get(STORE.charts, []);
  if (!charts.length) {
    host.append(el('p', { class: 'hint small', text: 'No charts saved yet. Save one from the Chart tab.' }));
  }
  for (const [i, c] of charts.entries()) {
    host.append(el('div', { class: 'saved-item' }, [
      el('span', { text: `${c.name || 'Untitled'} — ${c.code}` }),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
        const loaded = decodeChart(c.code);
        if (!loaded) return;
        loaded.name = c.name;
        state.raw = loaded;
        rebuild();
        show('chart');
      } }, 'Open'),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
        const next = store.get(STORE.charts, []);
        next.splice(i, 1);
        store.set(STORE.charts, next);
        renderSettings();
      } }, 'Delete'),
    ]));
  }

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

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.view)));
  $('#btn-settings').addEventListener('click', () => show('settings'));

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

  $('#btn-to-confirm').addEventListener('click', () => {
    if (state.raw.name) {
      const charts = store.get(STORE.charts, []);
      const code = encodeChart(state.raw);
      if (!charts.some((c) => c.code === code)) {
        charts.unshift({ name: state.raw.name, code, at: new Date().toISOString() });
        store.set(STORE.charts, charts.slice(0, 40));
      }
    }
    show('confirm');
  });

  $('#btn-back-to-chart').addEventListener('click', () => show('chart'));

  $('#btn-to-reading').addEventListener('click', () => {
    state.confirmed = true;
    state.reading = null;
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
