#!/usr/bin/env node
// Generates build/icon.png — the source image electron-builder turns into the
// .icns, .ico and Linux icons.
//
// favicon.svg is the icon, but packagers want raster input and the repo has no
// image dependency worth adding for four rounded rectangles and a circle. So
// the shapes are redeclared here and drawn directly. Keep them in step with
// favicon.svg; they are the same cairn, at 32x the size.

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = Number(process.argv[2] || 1024);
const SAMPLES = 4; // per axis, so 16 subsamples a pixel
const VIEWBOX = 32;

const SHAPES = [
  { kind: 'rect', x: 0, y: 0, w: 32, h: 32, r: 6, fill: '#141920' },
  { kind: 'rect', x: 8, y: 22, w: 16, h: 4, r: 1.5, fill: '#8d97a3' },
  { kind: 'rect', x: 10, y: 16, w: 12, h: 4, r: 1.5, fill: '#8d97a3' },
  { kind: 'rect', x: 12, y: 10, w: 8, h: 4, r: 1.5, fill: '#3aa79a' },
  { kind: 'circle', cx: 16, cy: 6, r: 2.5, fill: '#d98b3e' },
];

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function inRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function hit(px, py, shape) {
  if (shape.kind === 'circle') {
    const dx = px - shape.cx;
    const dy = py - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  return inRoundedRect(px, py, shape);
}

/** Supersampled coverage: every subsample takes the topmost shape it lands in. */
function render(size) {
  const palette = SHAPES.map((shape) => rgb(shape.fill));
  const pixels = Buffer.alloc(size * size * 4);
  const step = VIEWBOX / size / SAMPLES;
  const offset = step / 2;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (col * SAMPLES + sx) * step + offset;
          const py = (row * SAMPLES + sy) * step + offset;
          for (let i = SHAPES.length - 1; i >= 0; i -= 1) {
            if (!hit(px, py, SHAPES[i])) continue;
            r += palette[i][0];
            g += palette[i][1];
            b += palette[i][2];
            covered += 1;
            break;
          }
        }
      }

      const at = (row * size + col) * 4;
      const total = SAMPLES * SAMPLES;
      if (covered === 0) continue; // outside the rounded square: transparent
      // Premultiplied average, un-premultiplied for straight-alpha PNG.
      pixels[at] = Math.round(r / covered);
      pixels[at + 1] = Math.round(g / covered);
      pixels[at + 2] = Math.round(b / covered);
      pixels[at + 3] = Math.round((covered / total) * 255);
    }
  }
  return pixels;
}

// --- PNG container ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0; // filter type: none
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, png(render(SIZE), SIZE));
process.stdout.write(`wrote ${out} (${SIZE}x${SIZE})\n`);
