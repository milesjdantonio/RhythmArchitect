// The 2D playfield, for devices without WebGL: lanes, beat lines, falling tiles, holds, the hit
// line, drawn on a canvas each frame in the same style as the 3D stage: a dark glass well with
// walls of light, glassy tiles with bright rims, columns of light for holds.

import type { LiveNote } from './engine';

export interface Layout {
  w: number;
  h: number;
  left: number;
  laneW: number;
  lanes: number;
  hitY: number;
}

/**
 * The lanes stay centred on the screen (where you hit is always the middle). `inset`: screen space
 * on the left that the HUD covers; the lanes narrow (to no less than 72 px) to stay clear of it.
 */
export function layoutFor(w: number, h: number, lanes: number, inset = 0): Layout {
  const clear = inset > 0 ? Math.max(72 * lanes, w - 2 * (inset + 12)) : w - 24;
  const laneW = Math.floor(Math.min(124, clear / lanes));
  const left = Math.round((w - laneW * lanes) / 2);
  const hitY = Math.round(h * (h < 640 ? 0.8 : 0.83));
  return { w, h, left, laneW, lanes, hitY };
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsl(${h.toFixed(1)} ${s}% ${l}% / ${a})`;
export const laneHue = (lane: number, lanes: number, [hA, hB]: [number, number]) => {
  const d = ((((hB - hA) % 360) + 540) % 360) - 180;
  return (hA + (d * lane) / Math.max(1, lanes - 1) + 360) % 360;
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

interface Frame {
  now: number;
  /** Pixels per second of fall. */
  speed: number;
  spb: number;
  notes: LiveNote[];
  pressed: boolean[];
  /** 0..1 flash per lane after a hit. */
  flash: number[];
  hues: [number, number];
  keys: string[];
  beatPulse: number;
  /** When bands of light started climbing the walls (seconds of song time), newest last. */
  climbs?: number[];
}

export function drawField(g: CanvasRenderingContext2D, L: Layout, f: Frame) {
  const { left, laneW, lanes, hitY, h } = L;
  const width = laneW * lanes;
  g.clearRect(0, 0, L.w, L.h);

  // Field glass.
  const glass = g.createLinearGradient(0, 0, 0, h);
  glass.addColorStop(0, 'rgb(2 4 12 / 0.5)');
  glass.addColorStop(0.3, 'rgb(2 4 12 / 0.82)');
  glass.addColorStop(1, 'rgb(2 4 12 / 0.92)');
  g.fillStyle = glass;
  g.fillRect(left, 0, width, h);

  // Beat lines scroll with the tiles; bar lines are brighter.
  const first = Math.floor(f.now / f.spb) - 1;
  const last = Math.ceil((f.now + hitY / f.speed) / f.spb) + 1;
  for (let b = first; b <= last; b++) {
    const y = hitY - (b * f.spb - f.now) * f.speed;
    if (y < 0 || y > h) continue;
    const bar = b % 4 === 0;
    g.fillStyle = bar ? 'rgb(255 255 255 / 0.13)' : 'rgb(255 255 255 / 0.05)';
    g.fillRect(left, Math.round(y), width, bar ? 2 : 1);
  }

  // Lane separators and edges.
  g.fillStyle = 'rgb(200 220 255 / 0.08)';
  for (let i = 1; i < lanes; i++) g.fillRect(left + i * laneW, 0, 1, h);
  // Walls of light on both edges.
  for (const [x, hue] of [[left - 1, f.hues[0]], [left + width, f.hues[1]]] as const) {
    const wall = g.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, hsl(hue, 100, 75, 0));
    wall.addColorStop(1, hsl(hue, 100, 75, 0.7 + f.beatPulse * 0.3));
    g.fillStyle = wall;
    g.fillRect(x - 1, 0, 2, h);
  }
  // The climb: comets of light run up both walls when the song calls for it (f.climbs: start
  // times in seconds, from the song's accents, drops and sections), as in the 3D stage.
  const climbFor = 0.75;
  for (const t0 of f.climbs ?? []) {
    const p = (f.now - t0) / climbFor;
    if (p < 0 || p > 1) continue;
    const y = hitY * (1 - (1 - (1 - p) * (1 - p)));
    const tail = 70 + 160 * p;
    const k = 1 - p * 0.7;
    for (const [x, hue] of [[left - 1, f.hues[0]], [left + width, f.hues[1]]] as const) {
      const c = g.createLinearGradient(0, y, 0, y + tail);
      c.addColorStop(0, hsl(hue, 100, 90, k));
      c.addColorStop(1, hsl(hue, 100, 70, 0));
      g.fillStyle = c;
      g.fillRect(x - 2, y, 4, tail);
      g.fillStyle = `rgb(255 255 255 / ${k.toFixed(3)})`;
      g.fillRect(x - 5, y - 1, 10, 2);
    }
  }

  // Pressed lanes glow upward from the hit line.
  for (let i = 0; i < lanes; i++) {
    const glow = Math.max(f.pressed[i] ? 0.6 : 0, f.flash[i]);
    if (glow <= 0.01) continue;
    const hue = laneHue(i, lanes, f.hues);
    const beam = g.createLinearGradient(0, hitY, 0, hitY - h * 0.55);
    beam.addColorStop(0, hsl(hue, 100, 62, 0.42 * glow));
    beam.addColorStop(1, hsl(hue, 100, 62, 0));
    g.fillStyle = beam;
    g.fillRect(left + i * laneW + 1, hitY - h * 0.55, laneW - 1, h * 0.55);
  }

  // Tiles.
  const th = Math.max(18, Math.min(30, laneW * 0.3));
  const pad = Math.max(5, laneW * 0.08);
  for (const n of f.notes) {
    const yHead = hitY - (n.time - f.now) * f.speed;
    const yTail = hitY - (n.end - f.now) * f.speed;
    if (yTail - th > h || yHead + th < -th * 2) continue;
    if (yHead < -th) continue;
    const hitTap = n.judged && n.judged !== 'miss' && !n.hold;
    if (hitTap) continue;
    if (n.hold && n.holdResult === 'done') continue;
    const hue = laneHue(n.lane, lanes, f.hues);
    const x = left + n.lane * laneW + pad;
    const w = laneW - pad * 2;
    const missed = n.judged === 'miss' || n.holdResult === 'broken';
    const sat = missed ? 15 : 100;
    const alpha = missed ? 0.4 : 1;

    if (n.hold) {
      // Column from the tail down to the head (or to the hit line while held).
      const bottom = n.holding ? hitY : yHead;
      const top = Math.min(yTail, bottom - th);
      const cw = w * 0.56;
      const cx = x + (w - cw) / 2;
      const col = g.createLinearGradient(0, top, 0, bottom);
      col.addColorStop(0, hsl(hue, sat, 60, 0.12 * alpha));
      col.addColorStop(1, hsl(hue, sat, 60, (n.holding ? 0.55 : 0.32) * alpha));
      g.fillStyle = col;
      roundRect(g, cx, top, cw, bottom - top, 6);
      g.fill();
      g.strokeStyle = hsl(hue, sat, 72, 0.7 * alpha);
      g.lineWidth = 1.5;
      g.stroke();
      g.setLineDash([6, 6]);
      g.lineDashOffset = -f.now * 60;
      g.beginPath();
      g.moveTo(cx + cw / 2, top + 6);
      g.lineTo(cx + cw / 2, bottom - 6);
      g.strokeStyle = hsl(hue, sat, 85, 0.6 * alpha);
      g.stroke();
      g.setLineDash([]);
      // End cap.
      g.fillStyle = hsl(hue, sat, 80, 0.9 * alpha);
      g.fillRect(cx - 4, top, cw + 8, 3);
      if (n.holding) {
        g.fillStyle = hsl(hue, 100, 70, 0.9);
        roundRect(g, x, hitY - th / 2, w, th, 7);
        g.fill();
        continue;
      }
    }

    // Head tile.
    const y = yHead - th / 2;
    g.save();
    g.shadowColor = missed ? 'transparent' : hsl(hue, 100, 60, 0.85);
    g.shadowBlur = missed ? 0 : 16;
    const fill = g.createLinearGradient(0, y, 0, y + th);
    fill.addColorStop(0, hsl(hue, sat, 78, alpha));
    fill.addColorStop(0.45, hsl(hue, sat, 58, alpha));
    fill.addColorStop(1, hsl(hue, sat, 38, alpha));
    g.fillStyle = fill;
    roundRect(g, x, y, w, th, 7);
    g.fill();
    g.restore();
    // A lit top edge and a bright rim.
    g.save();
    roundRect(g, x, y, w, th, 7);
    g.clip();
    g.fillStyle = `rgb(255 255 255 / ${0.75 * alpha})`;
    g.fillRect(x, y, w, 2);
    g.restore();
    g.strokeStyle = `rgb(255 255 255 / ${0.8 * alpha})`;
    g.lineWidth = 1;
    roundRect(g, x + 0.5, y + 0.5, w - 1, th - 1, 7);
    g.stroke();
  }

  // Hit line.
  const pulse = 0.55 + f.beatPulse * 0.45;
  const line = g.createLinearGradient(left, 0, left + width, 0);
  for (let i = 0; i <= lanes; i++) line.addColorStop(i / lanes, hsl(laneHue(Math.min(i, lanes - 1), lanes, f.hues), 100, 72, pulse));
  g.fillStyle = line;
  g.save();
  g.shadowColor = hsl(f.hues[0], 100, 60, 0.9);
  g.shadowBlur = 14;
  g.fillRect(left, hitY - 1.5, width, 3);
  g.restore();

  // Key caps below the line.
  g.font = '700 13px "JetBrains Mono", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < lanes; i++) {
    const cx = left + i * laneW + laneW / 2;
    const cy = hitY + Math.min(46, (h - hitY) * 0.45);
    const hue = laneHue(i, lanes, f.hues);
    const down = f.pressed[i];
    g.fillStyle = down ? hsl(hue, 100, 72, 0.9) : 'rgb(4 6 16 / 0.85)';
    g.strokeStyle = hsl(hue, 100, 70, down ? 1 : 0.5);
    g.lineWidth = 1.5;
    const capW = Math.max(36, g.measureText(f.keys[i] ?? '').width + 18);
    roundRect(g, cx - capW / 2, cy - 15 + (down ? 2 : 0), capW, 30, 8);
    g.fill();
    g.stroke();
    g.fillStyle = down ? '#050816' : hsl(hue, 100, 86);
    g.fillText(f.keys[i] ?? '', cx, cy + (down ? 2 : 0));
  }
}
