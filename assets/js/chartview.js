// The North Indian chart, drawn as inline SVG.
//
// Geometry: a square, both diagonals, and the diamond joining the midpoints of
// the sides. That produces twelve regions - four kites at the centre of each
// edge and eight corner triangles. House 1 is the top kite and the houses run
// anticlockwise from there, which is the standard North Indian arrangement.
// Houses are fixed to position; the rashi they hold depends on the Lagna.

const HOUSES = {
  1:  { points: '50,0 25,25 50,50 75,25',   rashi: [50, 11],  planets: [50, 32],  align: 'middle' },
  2:  { points: '0,0 50,0 25,25',           rashi: [25, 7],   planets: [25, 18],  align: 'middle' },
  3:  { points: '0,0 25,25 0,50',           rashi: [7, 25],   planets: [15, 32],  align: 'middle' },
  4:  { points: '0,50 25,25 50,50 25,75',   rashi: [11, 50],  planets: [26, 50],  align: 'middle' },
  5:  { points: '0,50 0,100 25,75',         rashi: [7, 75],   planets: [15, 68],  align: 'middle' },
  6:  { points: '0,100 50,100 25,75',       rashi: [25, 94],  planets: [25, 84],  align: 'middle' },
  7:  { points: '50,100 25,75 50,50 75,75', rashi: [50, 91],  planets: [50, 70],  align: 'middle' },
  8:  { points: '50,100 100,100 75,75',     rashi: [75, 94],  planets: [75, 84],  align: 'middle' },
  9:  { points: '100,100 100,50 75,75',     rashi: [93, 75],  planets: [85, 68],  align: 'middle' },
  10: { points: '100,50 75,25 50,50 75,75', rashi: [89, 50],  planets: [74, 50],  align: 'middle' },
  11: { points: '100,0 100,50 75,25',       rashi: [93, 25],  planets: [85, 32],  align: 'middle' },
  12: { points: '50,0 100,0 75,25',         rashi: [75, 7],   planets: [75, 18],  align: 'middle' },
};

export const HOUSE_ORDER = Object.keys(HOUSES).map(Number);

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Lay planet glyphs out in rows that fit the region. Corner triangles are tight,
 * so they take two per row; the kites take three.
 */
function layout(keys, house) {
  const perRow = [1, 4, 7, 10].includes(house) ? 3 : 2;
  const rows = [];
  for (let i = 0; i < keys.length; i += perRow) rows.push(keys.slice(i, i + perRow));
  return rows;
}

/**
 * Draw the chart.
 *
 * @param {Element} host        element to render into (cleared first)
 * @param {Chart}   chart       a model.Chart
 * @param {object}  opts
 * @param {number}  opts.selected        house to highlight
 * @param {Function} opts.onHouseTap     called with the house number
 * @param {boolean} opts.showRashiNames  print the rashi abbreviation as well as its number
 */
export function renderChart(host, chart, opts = {}) {
  const { selected = null, onHouseTap = null, showRashiNames = false } = opts;

  host.textContent = '';
  const svg = el('svg', {
    viewBox: '-2 -2 104 104',
    class: 'kundli',
    role: 'img',
    'aria-label': 'North Indian chart. Twelve houses; house one is the top centre diamond.',
  });

  // Frame and dividing lines.
  svg.appendChild(el('rect', { x: 0, y: 0, width: 100, height: 100, class: 'kundli-frame' }));
  for (const d of ['M0,0 L100,100', 'M100,0 L0,100', 'M50,0 L100,50 L50,100 L0,50 Z']) {
    svg.appendChild(el('path', { d, class: 'kundli-line' }));
  }

  for (const house of HOUSE_ORDER) {
    const geo = HOUSES[house];
    const sign = chart.signOfHouse(house);
    const rashi = chart.rashi(sign);
    const occupants = chart.occupants(house);

    const group = el('g', {
      class: `kundli-house${selected === house ? ' is-selected' : ''}${occupants.length ? ' is-occupied' : ''}`,
      'data-house': house,
    });

    const hit = el('polygon', {
      points: geo.points,
      class: 'kundli-hit',
      tabindex: onHouseTap ? 0 : null,
      role: onHouseTap ? 'button' : null,
      'aria-label': onHouseTap
        ? `House ${house}, ${rashi.en}${occupants.length ? `, holding ${occupants.map((p) => chart.planet(p).en).join(', ')}` : ', empty'}`
        : null,
    });
    group.appendChild(hit);

    // Rashi number, always shown: this is the "square number to rashi" mapping
    // the confirmation step is about, so it belongs on the chart itself.
    const [rx, ry] = geo.rashi;
    group.appendChild(
      el('text', { x: rx, y: ry, class: 'kundli-rashi', 'text-anchor': geo.align }, String(sign)),
    );
    if (showRashiNames) {
      group.appendChild(
        el('text', { x: rx, y: ry + 5, class: 'kundli-rashi-name', 'text-anchor': geo.align }, rashi.en.slice(0, 3)),
      );
    }

    // Planets.
    const [px, py] = geo.planets;
    const rows = layout(occupants, house);
    const lineHeight = 7;
    const startY = py - ((rows.length - 1) * lineHeight) / 2 + 2;
    rows.forEach((row, i) => {
      const text = el('text', {
        x: px,
        y: startY + i * lineHeight,
        class: 'kundli-planets',
        'text-anchor': 'middle',
      });
      row.forEach((p, j) => {
        const retro = chart.isRetrograde(p) && !['ra', 'ke'].includes(p);
        const span = el(
          'tspan',
          { class: `gl gl-${p}${retro ? ' is-retro' : ''}` },
          chart.planet(p).glyph + (retro ? '˙' : ''),
        );
        if (j > 0) span.setAttribute('dx', '2.2');
        text.appendChild(span);
      });
      group.appendChild(text);
    });

    // House 1 carries the Lagna. Other chart software writes "La" here, so the
    // label is drawn to match, high in the kite where it cannot be mistaken for a
    // planet sitting in the square. The outline reinforces it without a label at
    // the kite's lower vertex, which is the centre of the whole figure.
    if (house === 1) {
      group.appendChild(el('polygon', { points: geo.points, class: 'kundli-lagna-mark' }));
      group.appendChild(el('text', { x: 50, y: 22, class: 'kundli-lagna-label', 'text-anchor': 'middle' }, 'La'));
    }

    if (onHouseTap) {
      const fire = () => onHouseTap(house);
      hit.addEventListener('click', fire);
      hit.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fire();
        }
      });
    }

    svg.appendChild(group);
  }

  host.appendChild(svg);
  return svg;
}
