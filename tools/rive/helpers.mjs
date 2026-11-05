// Shared helpers for the Rive art scripts (ported from TerraSim). The palette is light in deep
// space: soft ice, rose, lavender and gold on near-black, like the rest of the app.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));

// Mirrors the CSS tokens in src/styles/tokens.css.
// Key names are kept from the first palette so every art script keeps working.
export const COLORS = {
  night: '#02030a',
  deep: '#060916',
  ink: '#f3f6ff',
  pink: '#ff9ccf', // rose
  magenta: '#e49cff', // orchid
  cyan: '#8fe3ff', // ice
  violet: '#b9a4ff', // lavender
  sun: '#ffdc9a', // gold
  orange: '#ffb98f', // peach
  ash: '#39415e',
  dim: '#161c30',
  miss: '#ff6f85',
};

// A neon line: a feathered wide stroke under a sharp bright core, in the same shape.
export function neonStroke(ab, shape, c, thickness = 3, { glow = 10, core = '#ffffff', coreAlpha = 0.9, cap = 1, join = 1 } = {}) {
  const halo = ab.stroke(shape, c, thickness * 2.6, { cap, join, alpha: 0.85 });
  ab.feather(halo, glow);
  const line = ab.stroke(shape, c, thickness, { cap, join });
  const hot = ab.stroke(shape, core, Math.max(1, thickness * 0.35), { cap, join, alpha: coreAlpha });
  return { halo, line, hot };
}

// Blends two hex colours: t = 0 gives a, t = 1 gives b.
export function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const fontCache = new Map();
/** Unbounded at a weight (200 thin … 800 extra bold). */
export function font(weight = 800) {
  if (!fontCache.has(weight)) {
    const buf = readFileSync(join(here, '..', '..', 'node_modules', '@fontsource', 'unbounded', 'files', `unbounded-latin-${weight}-normal.woff`));
    fontCache.set(weight, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return fontCache.get(weight);
}

// Turns text into flattened contours (arrays of [x, y]) laid out glyph by glyph, centred on
// (cx, baseline). Curves are subdivided into short straight segments.
export function textContours(text, { size = 32, cx = 0, baseline = 0, tracking = 0.06, steps = 6, weight = 800 } = {}) {
  const f = font(weight);
  const glyphs = [...text].map((ch) => f.charToGlyph(ch));
  const scale = size / f.unitsPerEm;
  let width = 0;
  glyphs.forEach((g, i) => {
    width += g.advanceWidth * scale + (i < glyphs.length - 1 ? size * tracking : 0);
    if (i < glyphs.length - 1) width += f.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  let x = cx - width / 2;
  const contours = [];
  glyphs.forEach((g, i) => {
    const path = g.getPath(x, baseline, size);
    let cur = [];
    let last = [0, 0];
    for (const c of path.commands) {
      if (c.type === 'M') { if (cur.length > 2) contours.push(cur); cur = [[c.x, c.y]]; last = [c.x, c.y]; }
      else if (c.type === 'L') { cur.push([c.x, c.y]); last = [c.x, c.y]; }
      else if (c.type === 'Q') {
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.push([u * u * last[0] + 2 * u * t * c.x1 + t * t * c.x, u * u * last[1] + 2 * u * t * c.y1 + t * t * c.y]);
        }
        last = [c.x, c.y];
      } else if (c.type === 'C') {
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.push([
            u ** 3 * last[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x,
            u ** 3 * last[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y,
          ]);
        }
        last = [c.x, c.y];
      } else if (c.type === 'Z') { if (cur.length > 2) contours.push(cur); cur = []; }
    }
    if (cur.length > 2) contours.push(cur);
    x += g.advanceWidth * scale + size * tracking;
    if (i < glyphs.length - 1) x += f.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  // Drop the closing duplicate point of each contour.
  return contours.map((c) => {
    const a = c[0], b = c[c.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01 ? c.slice(0, -1) : c;
  });
}

// Isometric projection: x runs down-right, y down-left, z up. k = pixels per unit.
export function iso(cx, cy, k) {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  return ([x, y, z = 0]) => [cx + (x - y) * c * k, cy + (x + y) * s * k - z * k];
}

// Stage-based animation. Each track belongs to one stage and animates within it; the animation for
// stage k holds every earlier track at its end value and every later one at its start value, so
// jumping straight to any stage shows the right pose.
export class Stager {
  constructor(artboard, durations) {
    this.ab = artboard;
    this.durations = durations; // frames per stage
    this.tracks = [];
  }
  track(target, prop, stage, frames, initial = frames[0][1]) {
    this.tracks.push({ target, prop, stage, frames, initial, final: frames[frames.length - 1][1] });
    return this;
  }
  build(namePrefix = 'stage') {
    const anims = this.durations.map((dur, k) => {
      const anim = this.ab.animation(`${namePrefix}-${k}`, { duration: dur, loop: 0 });
      for (const t of this.tracks) {
        if (t.stage < k) anim.key(t.target, t.prop, [[0, t.final, 'hold']]);
        else if (t.stage > k) anim.key(t.target, t.prop, [[0, t.initial, 'hold']]);
        else anim.key(t.target, t.prop, t.frames);
      }
      return anim;
    });
    return anims;
  }
}
