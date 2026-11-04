// Generates the PWA icons: the North Indian chart outline in gold on the app
// background. Written as raw PNGs so the repository needs no image tooling.
//
//   node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [15, 16, 33];
const GOLD = [240, 180, 60];
const DIM = [60, 62, 110];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = y * stride + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Distance from a point to a line segment, used to draw strokes of real width
 * rather than aliased single pixels.
 */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * @param {number} size   icon edge in pixels
 * @param {number} inset  fraction of the icon left as padding (maskable needs more)
 */
function drawIcon(size, inset) {
  const pad = size * inset;
  const span = size - pad * 2;
  const p = (fx, fy) => [pad + fx * span, pad + fy * span];

  // The chart: outer square, both diagonals, and the midpoint diamond.
  const segments = [
    [p(0, 0), p(1, 0)], [p(1, 0), p(1, 1)], [p(1, 1), p(0, 1)], [p(0, 1), p(0, 0)],
    [p(0, 0), p(1, 1)], [p(1, 0), p(0, 1)],
    [p(0.5, 0), p(1, 0.5)], [p(1, 0.5), p(0.5, 1)], [p(0.5, 1), p(0, 0.5)], [p(0, 0.5), p(0.5, 0)],
  ];
  const diamond = segments.slice(6);
  const stroke = Math.max(1.4, size * 0.016);

  return (x, y) => {
    const cx = x + 0.5;
    const cy = y + 0.5;

    let best = Infinity;
    let bestIsDiamond = false;
    for (const [[ax, ay], [bx, by]] of segments) {
      const d = distToSegment(cx, cy, ax, ay, bx, by);
      if (d < best) {
        best = d;
        bestIsDiamond = diamond.some(([[dax, day], [dbx, dby]]) => dax === ax && day === ay && dbx === bx && dby === by);
      }
    }

    const colour = bestIsDiamond ? GOLD : DIM;
    if (best <= stroke * 0.5) return colour;
    if (best <= stroke) return mix(colour, BG, (best - stroke * 0.5) / (stroke * 0.5));
    return BG;
  };
}

const targets = [
  { name: 'icon-192.png', size: 192, inset: 0.1 },
  { name: 'icon-512.png', size: 512, inset: 0.1 },
  { name: 'icon-maskable-512.png', size: 512, inset: 0.2 },
];

for (const { name, size, inset } of targets) {
  const buf = png(size, drawIcon(size, inset));
  writeFileSync(join(OUT, name), buf);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
