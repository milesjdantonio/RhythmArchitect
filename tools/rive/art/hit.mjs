// hit.riv: the burst on a pad when a tile is hit. Five styles, each with a Perfect, Great and
// Good version (fifteen animations), plus Miss. The app picks a style at random for every hit.
//   0 ring burst  — flash, expanding ring, eight sparks
//   1 starburst   — long rays shooting out from the centre
//   2 star glint  — a four-point star pops up, turns and floats away
//   3 shatter     — a square outline blooms while shards spin outward
//   4 double wave — two rings at different speeds, dots spiralling out
// State machine "Hit": number `variant` (0..4), triggers `perfect`, `great`, `good`, `miss`.
// Set `variant`, then fire the trigger. Every state has an A and B copy, so the same burst twice in
// a row restarts.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

const TAU = Math.PI * 2;
const C = 80;
const KINDS = {
  perfect: { color: COLORS.cyan, core: '#ffffff', alt: '#ffffff', f: 1, dur: 32 },
  great: { color: COLORS.pink, core: '#ffd0ea', alt: COLORS.sun, f: 0.82, dur: 28 },
  good: { color: COLORS.violet, core: '#d9c8ff', alt: '#b9a6ff', f: 0.64, dur: 24 },
};

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Hit', width: 160, height: 160 });
  const groups = []; // every node an animation may show; each animation hides the ones it doesn't use

  const flash = ab.node(null, { name: 'flash', x: C, y: C });
  const fs = ab.shape(flash); ab.ellipse(fs, { w: 60, h: 60 });
  const flashFill = ab.fill(fs, '#ffffff'); ab.feather(flashFill, 16);
  groups.push(flash);

  const ring = ab.node(null, { name: 'ring', x: C, y: C });
  const rs = ab.shape(ring); ab.ellipse(rs, { w: 80, h: 80 });
  const ringHalo = ab.stroke(rs, COLORS.cyan, 9); ab.feather(ringHalo, 8);
  const ringLine = ab.stroke(rs, '#ffffff', 2.5);
  groups.push(ring);

  const ring2 = ab.node(null, { name: 'ring2', x: C, y: C });
  const r2s = ab.shape(ring2); ab.ellipse(r2s, { w: 80, h: 80 });
  const ring2Line = ab.stroke(r2s, COLORS.pink, 2);
  groups.push(ring2);

  const radial = (name, count, offset, make) => Array.from({ length: count }, (_, i) => {
    const pivot = ab.node(null, { name: `${name}${i}`, x: C, y: C, rotation: (i / count) * TAU + offset });
    const arm = ab.node(pivot, { x: 12 });
    const paint = make(arm, i);
    groups.push(arm);
    return { pivot, arm, paint };
  });
  const sparks = radial('spark', 8, 0.2, (arm) => { const s = ab.shape(arm); ab.rect(s, { x: -9, y: -1.75, w: 18, h: 3.5, r: 1.75 }); return ab.fill(s, COLORS.cyan); });
  const rays = radial('ray', 8, 0, (arm) => { const s = ab.shape(arm); ab.path(s, [[0, -2.2], [48, 0], [0, 2.2]]); const p = ab.fill(s, COLORS.cyan); ab.feather(ab.fill(s, COLORS.cyan, { alpha: 0.6 }), 4); return p; });
  const shards = radial('shard', 6, 0.5, (arm) => { const s = ab.shape(arm, { name: 'piece' }); ab.rect(s, { x: -5, y: -5, w: 10, h: 10, r: 1.5 }); ab.stroke(s, '#ffffff', 1, { alpha: 0.7 }); return ab.fill(s, COLORS.cyan); });
  const dots = radial('dot', 8, 0, (arm) => { const s = ab.shape(arm); ab.ellipse(s, { w: 6, h: 6 }); const p = ab.fill(s, COLORS.cyan); return p; });

  // Star glint: four long thin points.
  const note = ab.node(null, { name: 'note', x: C, y: C });
  const ns = ab.shape(note);
  ab.path(ns, [[0, -22], [3, -3], [22, 0], [3, 3], [0, 22], [-3, 3], [-22, 0], [-3, -3]]);
  const noteFill = ab.fill(ns, COLORS.cyan);
  const noteGlow = ab.fill(ns, COLORS.cyan, { alpha: 0.6 }); ab.feather(noteGlow, 6);
  groups.push(note);

  // Square outline, turned 45°.
  const sq = ab.node(null, { name: 'square', x: C, y: C, rotation: Math.PI / 4 });
  const sqs = ab.shape(sq); ab.rect(sqs, { x: -22, y: -22, w: 44, h: 44, r: 3 });
  const sqLine = ab.stroke(sqs, COLORS.cyan, 2.5); ab.feather(ab.stroke(sqs, COLORS.cyan, 7, { alpha: 0.5 }), 6);
  groups.push(sq);

  // Miss: a red X.
  const x = ab.node(null, { name: 'miss', x: C, y: C });
  for (const [a, b] of [[[-16, -16], [16, 16]], [[16, -16], [-16, 16]]]) {
    const s = ab.shape(x);
    ab.path(s, [a, b], { closed: false });
    ab.feather(ab.stroke(s, COLORS.miss, 10, { alpha: 0.7 }), 8);
    ab.stroke(s, '#ffd6de', 3.5);
  }
  groups.push(x);

  const hideAll = (a, keep) => { for (const g of groups) if (!keep.includes(g)) a.key(g, 'opacity', [[0, 0, 'hold']]); };
  const idle = ab.animation('idle', { duration: 1 });
  hideAll(idle, []);

  const flashIn = (a, k, scale, until) => {
    a.key(flash, 'opacity', [[0, 0.95, EASE.out], [until, 0]]);
    a.key(flash, 'scaleX', [[0, 0.5, EASE.out], [until, scale]]);
    a.key(flash, 'scaleY', [[0, 0.5, EASE.out], [until, scale]]);
    a.key(flashFill, 'colorValue', [[0, k.core, 'hold']]);
  };

  const styles = [
    // 0 ring burst
    (a, k, d) => {
      const used = [flash, ring, ...sparks.map((s) => s.arm)];
      hideAll(a, used);
      flashIn(a, k, 1.3 * k.f, d * 0.5);
      a.key(ring, 'opacity', [[0, 1, EASE.in], [d, 0]]);
      a.key(ring, 'scaleX', [[0, 0.35, EASE.out], [d, 1.6 * k.f]]);
      a.key(ring, 'scaleY', [[0, 0.35, EASE.out], [d, 1.6 * k.f]]);
      a.key(ringHalo, 'colorValue', [[0, k.color, 'hold']]);
      a.key(ringLine.stroke, 'thickness', [[0, 4, EASE.out], [d, 0.5]]);
      sparks.forEach((s, i) => {
        a.key(s.arm, 'opacity', [[0, 1, EASE.in], [d, 0]]);
        a.key(s.arm, 'x', [[0, 10, EASE.out], [d, (40 + (i % 2) * 10) * k.f + 10]]);
        a.key(s.arm, 'scaleX', [[0, 1.4, EASE.out], [d, 0.3]]);
        a.key(s.paint, 'colorValue', [[0, i % 2 ? k.alt : k.color, 'hold']]);
      });
    },
    // 1 starburst
    (a, k, d) => {
      const used = [flash, ...rays.map((r) => r.arm)];
      hideAll(a, used);
      flashIn(a, k, 0.9 * k.f, d * 0.4);
      rays.forEach((r, i) => {
        const long = i % 2 ? 0.75 : 1.15;
        a.key(r.arm, 'opacity', [[0, 1, 'hold'], [d * 0.45, 1, EASE.in], [d, 0]]);
        a.key(r.arm, 'x', [[0, 4, EASE.out], [d, 22 * k.f]]);
        a.key(r.arm, 'scaleX', [[0, 0.1, EASE.out], [d * 0.4, long * k.f], [d, 0.2]]);
        a.key(r.paint, 'colorValue', [[0, i % 2 ? k.alt : k.color, 'hold']]);
      });
    },
    // 2 note pop
    (a, k, d) => {
      const used = [note, ring2, ...dots.slice(0, 4).map((s) => s.arm)];
      hideAll(a, used);
      a.key(note, 'opacity', [[0, 0, EASE.out], [4, 1, 'hold'], [d * 0.6, 1, EASE.in], [d, 0]]);
      a.key(note, 'scaleX', [[0, 0.2, EASE.back], [d * 0.35, 1.15 * k.f], [d, 1 * k.f]]);
      a.key(note, 'scaleY', [[0, 0.2, EASE.back], [d * 0.35, 1.15 * k.f], [d, 1 * k.f]]);
      a.key(note, 'y', [[0, C + 6, EASE.out], [d, C - 26 * k.f]]);
      a.key(note, 'rotation', [[0, -0.5, EASE.out], [d, 0.15]]);
      a.key(noteFill, 'colorValue', [[0, k.core, 'hold']]);
      a.key(noteGlow, 'colorValue', [[0, `${k.color}aa`, 'hold']]);
      a.key(ring2, 'opacity', [[0, 0.9, EASE.in], [d * 0.7, 0]]);
      a.key(ring2, 'scaleX', [[0, 0.3, EASE.out], [d * 0.7, 1.1 * k.f]]);
      a.key(ring2, 'scaleY', [[0, 0.3, EASE.out], [d * 0.7, 1.1 * k.f]]);
      a.key(ring2Line, 'colorValue', [[0, k.color, 'hold']]);
      dots.slice(0, 4).forEach((s, i) => {
        a.key(s.arm, 'opacity', [[0, 1, EASE.in], [d, 0]]);
        a.key(s.arm, 'x', [[0, 8, EASE.out], [d, 34 * k.f + i * 3]]);
        a.key(s.paint, 'colorValue', [[0, k.alt, 'hold']]);
      });
    },
    // 3 shatter
    (a, k, d) => {
      const used = [flash, sq, ...shards.map((s) => s.arm)];
      hideAll(a, used);
      flashIn(a, k, 0.8 * k.f, d * 0.35);
      a.key(sq, 'opacity', [[0, 1, EASE.in], [d, 0]]);
      a.key(sq, 'scaleX', [[0, 0.3, EASE.out], [d, 1.5 * k.f]]);
      a.key(sq, 'scaleY', [[0, 0.3, EASE.out], [d, 1.5 * k.f]]);
      a.key(sq, 'rotation', [[0, Math.PI / 4, EASE.out], [d, Math.PI / 4 + 0.6]]);
      a.key(sqLine, 'colorValue', [[0, k.color, 'hold']]);
      shards.forEach((s, i) => {
        a.key(s.arm, 'opacity', [[0, 1, 'hold'], [d * 0.5, 1, EASE.in], [d, 0]]);
        a.key(s.arm, 'x', [[0, 6, EASE.out], [d, (44 + (i % 3) * 8) * k.f]]);
        a.key(s.arm, 'rotation', [[0, 0, EASE.out], [d, (i % 2 ? 1 : -1) * 3]]);
        a.key(s.paint, 'colorValue', [[0, i % 2 ? k.alt : k.color, 'hold']]);
      });
    },
    // 4 double wave
    (a, k, d) => {
      const used = [ring, ring2, ...dots.map((s) => s.arm)];
      hideAll(a, used);
      a.key(ring, 'opacity', [[0, 1, EASE.in], [d * 0.6, 0]]);
      a.key(ring, 'scaleX', [[0, 0.3, EASE.out], [d * 0.6, 1.3 * k.f]]);
      a.key(ring, 'scaleY', [[0, 0.3, EASE.out], [d * 0.6, 1.3 * k.f]]);
      a.key(ringHalo, 'colorValue', [[0, k.color, 'hold']]);
      a.key(ringLine.stroke, 'thickness', [[0, 3, 'hold']]);
      a.key(ring2, 'opacity', [[0, 0, 'hold'], [5, 0.9, EASE.in], [d, 0]]);
      a.key(ring2, 'scaleX', [[0, 0.2, 'hold'], [5, 0.2, EASE.out], [d, 1.9 * k.f]]);
      a.key(ring2, 'scaleY', [[0, 0.2, 'hold'], [5, 0.2, EASE.out], [d, 1.9 * k.f]]);
      a.key(ring2Line, 'colorValue', [[0, k.alt, 'hold']]);
      dots.forEach((s, i) => {
        a.key(s.arm, 'opacity', [[0, 1, EASE.in], [d, 0]]);
        a.key(s.arm, 'x', [[0, 6, EASE.out], [d, 50 * k.f]]);
        a.key(s.pivot, 'rotation', [[0, (i / 8) * TAU, EASE.out], [d, (i / 8) * TAU + 1.2]]);
        a.key(s.paint, 'colorValue', [[0, i % 2 ? k.color : k.core, 'hold']]);
      });
    },
  ];

  const sm = ab.stateMachine('Hit');
  const variant = sm.number('variant', 0);
  const layer = sm.layer('Main');
  const sIdle = layer.state(idle);
  layer.transition(layer.entry, sIdle);
  const targets = []; // { input, variant?, A, B }
  for (const [kind, k] of Object.entries(KINDS)) {
    const input = sm.trigger(kind);
    styles.forEach((style, v) => {
      const anim = ab.animation(`${kind}-${v}`, { duration: k.dur });
      style(anim, k, k.dur);
      targets.push({ input, v, A: layer.state(anim), B: layer.state(anim) });
    });
  }
  const miss = ab.animation('miss', { duration: 34 });
  hideAll(miss, [x]);
  miss.key(x, 'opacity', [[0, 1, 'hold'], [16, 1, EASE.in], [34, 0]]);
  miss.key(x, 'scaleX', [[0, 1.5, EASE.back], [12, 1]]);
  miss.key(x, 'scaleY', [[0, 1.5, EASE.back], [12, 1]]);
  miss.key(x, 'x', [[0, C, EASE.linear], [3, C - 7, EASE.linear], [6, C + 6, EASE.linear], [9, C - 4, EASE.linear], [12, C + 2, EASE.linear], [15, C]]);
  miss.key(x, 'y', [[0, C, EASE.in], [34, C + 14]]);
  targets.push({ input: sm.trigger('miss'), v: null, A: layer.state(miss), B: layer.state(miss) });

  const all = [sIdle, ...targets.flatMap((t) => [t.A, t.B])];
  for (const from of all) {
    for (const t of targets) {
      const conditions = [{ input: t.input }];
      if (t.v !== null) conditions.push({ input: variant, op: '==', value: t.v });
      layer.transition(from, from === t.A ? t.B : t.A, { conditions });
    }
  }
  for (const t of targets) {
    layer.transition(t.A, sIdle, { exitTime: 100, percent: true });
    layer.transition(t.B, sIdle, { exitTime: 100, percent: true });
  }
  return f;
}
