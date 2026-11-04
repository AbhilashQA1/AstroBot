// The birth-details screen: name, date, time, place in; a computed kundali out.
//
// Kept apart from app.js because it owns a dataset, a search box and a form with
// its own validation, none of which the rest of the app needs to know about.
//
// The place list is fetched the first time this screen is opened rather than at
// start-up. It is 122 KB gzipped, and someone who only ever enters charts by
// hand should never pay for it.

import { AYANAMSAS, DEFAULT_AYANAMSA } from './astro/ayanamsa.js';
import { computeKundali, toChartPlacements } from './astro/compute.js';

const PLACES_URL = 'assets/data/places-in.json';
let placesCache = null;

export async function loadPlaces() {
  if (placesCache) return placesCache;
  const res = await fetch(PLACES_URL, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`place list unavailable (HTTP ${res.status})`);
  placesCache = await res.json();
  return placesCache;
}

/**
 * Rank places for a typed query.
 *
 * Ordering is deliberate: an exact name first, then names starting with the
 * query, then names containing it, and population breaks every tie. Without the
 * population tiebreak, typing "del" surfaces whichever Delhi-ish village the
 * file happens to list first instead of Delhi.
 */
export function searchPlaces(data, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const scored = [];
  for (const row of data.places) {
    const name = row[0].toLowerCase();
    let rank;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else continue;
    scored.push({ rank, row });
    // The list is already sorted by population, so once enough strong matches
    // are in hand there is nothing better further down.
    if (scored.length > 400) break;
  }

  scored.sort((a, b) => a.rank - b.rank || b.row[4] - a.row[4]);
  return scored.slice(0, limit).map(({ row }) => ({
    name: row[0],
    state: data.states[row[1]] || '',
    latitude: row[2],
    longitude: row[3],
    population: row[4],
  }));
}

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

/**
 * Build the screen.
 *
 * @param {Element} host
 * @param {object} opts
 * @param {Function} opts.onComputed  given ({ lagna, placements, birth, result })
 * @param {object}  [opts.initial]    a previously entered birth record
 */
export function renderBirthView(host, { onComputed, initial = {} }) {
  host.textContent = '';

  const form = {
    name: initial.name || '',
    date: initial.date || '',
    time: initial.time || '',
    timeKnown: initial.timeKnown !== false,
    place: initial.place || null,
    ayanamsa: initial.ayanamsa || DEFAULT_AYANAMSA,
    offsetMinutes: initial.offsetMinutes ?? null,
  };

  const status = el('p', { class: 'status', role: 'status' });

  const setStatus = (message, tone = '') => {
    status.textContent = message;
    status.className = `status${tone ? ` is-${tone}` : ''}`;
  };

  // --- name, date, time ----------------------------------------------------
  const nameInput = el('input', {
    type: 'text', id: 'birth-name', autocomplete: 'off',
    placeholder: 'Name or label', value: form.name,
    oninput: (e) => { form.name = e.target.value; },
  });

  const dateInput = el('input', {
    type: 'date', id: 'birth-date', value: form.date,
    min: '1800-01-01', max: '2100-12-31',
    oninput: (e) => { form.date = e.target.value; },
  });

  const timeInput = el('input', {
    type: 'time', id: 'birth-time', value: form.time,
    oninput: (e) => { form.time = e.target.value; },
  });

  const timeUnknown = el('input', {
    type: 'checkbox', id: 'birth-time-unknown',
    ...(form.timeKnown ? {} : { checked: true }),
    onchange: (e) => {
      form.timeKnown = !e.target.checked;
      timeInput.disabled = e.target.checked;
      timeNote.hidden = !e.target.checked;
    },
  });

  const timeNote = el('p', {
    class: 'finding-note',
    hidden: form.timeKnown,
    text:
      'Without a birth time the chart is calculated for noon. The Moon will be ' +
      'close but can be out by about six degrees, and the Lagna is effectively ' +
      'unknown: it changes sign roughly every two hours, so every house position ' +
      'in the reading is a guess. Treat such a chart as the planets only.',
  });
  timeInput.disabled = !form.timeKnown;

  // --- place ---------------------------------------------------------------
  const chosen = el('p', { class: 'hint small' });
  const results = el('div', { class: 'place-results' });

  const showChosen = () => {
    chosen.textContent = form.place
      ? `${form.place.name}${form.place.state ? `, ${form.place.state}` : ''} — ${form.place.latitude.toFixed(4)}, ${form.place.longitude.toFixed(4)}`
      : 'No place chosen yet.';
  };
  showChosen();

  const pick = (place) => {
    form.place = place;
    results.textContent = '';
    placeInput.value = place.name;
    showChosen();
    setStatus('');
  };

  let searchTimer = null;
  const placeInput = el('input', {
    type: 'search', id: 'birth-place', autocomplete: 'off',
    placeholder: 'Town or city in India',
    value: form.place?.name || '',
    oninput: (e) => {
      const q = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        results.textContent = '';
        if (q.trim().length < 2) return;
        let data;
        try {
          data = await loadPlaces();
        } catch (err) {
          setStatus(err.message, 'bad');
          return;
        }
        const found = searchPlaces(data, q);
        if (!found.length) {
          results.append(el('p', { class: 'hint small', text: 'No match. Smaller villages are often missing — use coordinates below.' }));
          return;
        }
        for (const place of found) {
          results.append(el('button', {
            type: 'button', class: 'place-hit',
            onclick: () => pick(place),
          }, [
            el('strong', { text: place.name }),
            el('span', { text: place.state }),
          ]));
        }
      }, 140);
    },
  });

  // --- coordinates, for places the list does not have ----------------------
  const latInput = el('input', { type: 'number', step: 'any', id: 'birth-lat', placeholder: '26.8467' });
  const lonInput = el('input', { type: 'number', step: 'any', id: 'birth-lon', placeholder: '80.9462' });
  const offsetInput = el('input', { type: 'text', id: 'birth-offset', placeholder: '+05:30', autocomplete: 'off' });

  const useCoords = el('button', {
    type: 'button', class: 'btn btn-quiet',
    onclick: () => {
      const lat = Number(latInput.value);
      const lon = Number(lonInput.value);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90) return setStatus('Latitude must be between -90 and 90.', 'bad');
      if (!Number.isFinite(lon) || Math.abs(lon) > 180) return setStatus('Longitude must be between -180 and 180.', 'bad');
      pick({ name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, state: 'entered by hand', latitude: lat, longitude: lon });
    },
  }, 'Use these coordinates');

  // --- ayanamsa ------------------------------------------------------------
  const ayanamsaSelect = el('select', {
    id: 'birth-ayanamsa',
    onchange: (e) => { form.ayanamsa = e.target.value; ayanamsaNote.textContent = AYANAMSAS[e.target.value].note; },
  }, Object.values(AYANAMSAS).map((a) => el('option', {
    value: a.key,
    ...(a.key === form.ayanamsa ? { selected: true } : {}),
    text: a.verified ? a.name : `${a.name} — unverified`,
  })));

  const ayanamsaNote = el('p', { class: 'hint small', text: AYANAMSAS[form.ayanamsa].note });

  // --- calculate -----------------------------------------------------------
  const calculate = () => {
    if (!form.date) return setStatus('A date of birth is needed.', 'bad');
    if (form.timeKnown && !form.time) return setStatus('Enter a time, or tick that it is unknown.', 'bad');
    if (!form.place) return setStatus('Choose a place, or enter coordinates.', 'bad');

    const [year, month, day] = form.date.split('-').map(Number);
    const [hour, minute] = (form.timeKnown ? form.time : '12:00').split(':').map(Number);

    let offsetMinutes = null;
    const raw = offsetInput.value.trim();
    if (raw) {
      const m = raw.match(/^([+-]?)(\d{1,2}):?(\d{2})$/);
      if (!m) return setStatus('Offset should look like +05:30.', 'bad');
      const mins = Number(m[2]) * 60 + Number(m[3]);
      offsetMinutes = m[1] === '-' ? -mins : mins;
    }

    try {
      const result = computeKundali({
        year, month, day, hour, minute,
        latitude: form.place.latitude,
        longitude: form.place.longitude,
        zone: 'Asia/Kolkata',
        ayanamsa: form.ayanamsa,
        ...(offsetMinutes === null ? {} : { offsetMinutes }),
      });

      const { lagna, placements } = toChartPlacements(result);
      onComputed({
        lagna,
        placements,
        result,
        birth: { ...form, offsetMinutes },
      });
    } catch (err) {
      setStatus(`Could not calculate: ${err.message}`, 'bad');
    }
  };

  // --- assemble ------------------------------------------------------------
  host.append(
    el('p', { class: 'hint', text: 'Birth details go in, the kundali comes out. Everything is calculated on this device; nothing is sent anywhere.' }),

    el('div', { class: 'field' }, [el('label', { for: 'birth-name', text: 'Name (optional, stays on this device)' }), nameInput]),
    el('div', { class: 'field' }, [el('label', { for: 'birth-date', text: 'Date of birth' }), dateInput]),
    el('div', { class: 'field' }, [
      el('label', { for: 'birth-time', text: 'Time of birth' }),
      timeInput,
      el('label', { class: 'checkline', for: 'birth-time-unknown' }, [timeUnknown, el('span', { text: 'I do not know the time' })]),
      timeNote,
    ]),

    el('div', { class: 'field' }, [
      el('label', { for: 'birth-place', text: 'Place of birth' }),
      placeInput,
      results,
      chosen,
    ]),

    el('details', {}, [
      el('summary', { text: 'Enter coordinates instead, or override the UTC offset' }),
      el('div', {}, [
        el('p', { class: 'hint small', text: 'Villages are often missing from the place list. Any map app will give you a latitude and longitude.' }),
        el('div', { class: 'field' }, [el('label', { for: 'birth-lat', text: 'Latitude (north positive)' }), latInput]),
        el('div', { class: 'field' }, [el('label', { for: 'birth-lon', text: 'Longitude (east positive)' }), lonInput]),
        useCoords,
        el('p', { class: 'hint small', text: 'Before 1906 India ran on Madras time, and the timezone database applies that to the whole country. If you know the true local offset for a birth that early, set it here.' }),
        el('div', { class: 'field' }, [el('label', { for: 'birth-offset', text: 'UTC offset override' }), offsetInput]),
      ]),
    ]),

    el('div', { class: 'field' }, [
      el('label', { for: 'birth-ayanamsa', text: 'Ayanamsa' }),
      ayanamsaSelect,
      ayanamsaNote,
    ]),

    el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: calculate }, 'Calculate the kundali'),
    status,
  );
}
