// result.riv: the end-of-song moments.
//   Clear  — rays turn slowly behind three stars; number `stars` 0..3 pops them in one by one.
//   Failed — equalizer bars collapse, then a red flatline draws across and flickers.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, Stager, neonStroke } from '../helpers.mjs';

const TAU = Math.PI * 2;

function starPoints(R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad, 2]);
  }
  return pts;
}

function clear(f) {
  const W = 360, H = 220;
  const ab = f.artboard({ name: 'Clear', width: W, height: H });

  const rays = ab.node(null, { name: 'rays', x: W / 2, y: 118 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const s = ab.shape(rays);
    const p = (ang, rad) => [Math.cos(ang) * rad, Math.sin(ang) * rad];
    ab.path(s, [p(a - 0.06, 30), p(a - 0.13, 170), p(a + 0.13, 170), p(a + 0.06, 30)]);
    ab.gradFill(s, { kind: 'radial', start: [0, 0], end: [170, 0], stops: [[0, i % 2 ? `${COLORS.pink}66` : `${COLORS.cyan}55`], [1, `${COLORS.violet}00`]] });
  }

  const spots = [[W / 2 - 92, 128, 0.82], [W / 2, 106, 1.05], [W / 2 + 92, 128, 0.82]];
  const stars = spots.map(([x, y, sc], i) => {
    const holder = ab.node(null, { name: `slot${i}`, x, y, scaleX: sc, scaleY: sc });
    const empty = ab.shape(holder);
    ab.path(empty, starPoints(38, 16));
    ab.fill(empty, '#1d1238');
    ab.stroke(empty, COLORS.ash, 2);
    const star = ab.node(holder, { name: `star${i}` });
    const glow = ab.shape(star);
    ab.path(glow, starPoints(40, 17));
    ab.feather(ab.fill(glow, COLORS.sun, { alpha: 0.85 }), 18);
    const body = ab.shape(star);
    ab.path(body, starPoints(38, 16));
    ab.gradFill(body, { start: [0, -38], end: [0, 30], stops: [[0, '#fffbe0'], [0.4, COLORS.sun], [1, COLORS.orange]] });
    ab.stroke(body, '#ffffff', 1.5, { alpha: 0.8 });
    return star;
  });

  const spin = ab.animation('rays', { duration: 900, loop: 1 });
  spin.key(rays, 'rotation', [[0, 0, EASE.linear], [900, TAU]]);
  spin.key(rays, 'opacity', [[0, 0.6, EASE.inOut], [450, 1, EASE.inOut], [900, 0.6]]);

  // Stage k pops star k-1; the Stager holds earlier stars shown and later ones hidden.
  const stager = new Stager(ab, [10, 34, 34, 40]);
  stars.forEach((s, i) => {
    stager.track(s, 'scaleX', i + 1, [[0, 0, EASE.back], [26, 1]], 0);
    stager.track(s, 'scaleY', i + 1, [[0, 0, EASE.back], [26, 1]], 0);
    stager.track(s, 'rotation', i + 1, [[0, -0.9, EASE.out], [26, 0]], -0.9);
  });
  const poses = stager.build('stars');

  const sm = ab.stateMachine('Clear');
  const count = sm.number('stars', 0);
  const bg = sm.layer('Rays');
  bg.transition(bg.entry, bg.state(spin));
  const main = sm.layer('Stars');
  const st = poses.map((p) => main.state(p));
  main.transition(main.entry, st[0]);
  for (let k = 0; k < 3; k++) {
    // Wait for the previous star to land before popping the next.
    main.transition(st[k], st[k + 1], { conditions: [{ input: count, op: '>=', value: k + 1 }], exitTime: 100, percent: true });
  }
}

function failed(f) {
  const W = 360, H = 220;
  const ab = f.artboard({ name: 'Failed', width: W, height: H });
  const base = 150;
  const heights = [60, 92, 120, 84, 104, 70, 46];
  const bars = heights.map((h, i) => {
    const node = ab.node(null, { name: `bar${i}`, x: W / 2 - 90 + i * 30, y: base });
    const s = ab.shape(node);
    ab.rect(s, { x: -10, y: -h, w: 20, h, r: 4 });
    ab.gradFill(s, { start: [0, -h], end: [0, 0], stops: [[0, COLORS.pink], [1, COLORS.violet]] });
    return node;
  });
  const line = ab.shape(null, { name: 'flatline' });
  const pts = [[30, base - 4], [120, base - 4], [138, base - 40], [152, base + 26], [166, base - 4], [330, base - 4]];
  ab.path(line, pts, { closed: false });
  const neon = neonStroke(ab, line, COLORS.miss, 3.5, { glow: 12, core: '#ffd6de' });
  const trims = [neon.halo, neon.line, neon.hot].map((s) => ab.trim(s, { end: 0 }));

  const intro = ab.animation('collapse', { duration: 110 });
  bars.forEach((b, i) => {
    const d = 6 + ((i * 5) % 17);
    intro.key(b, 'scaleY', [[0, 1, 'hold'], [d, 1, EASE.slam], [d + 22, 0.06, EASE.out], [d + 30, 0.14, EASE.in], [d + 38, 0.06]]);
    intro.key(b, 'rotation', [[0, 0, 'hold'], [d, 0, EASE.out], [d + 30, (i % 2 ? 1 : -1) * 0.12]]);
    intro.key(b, 'opacity', [[0, 1, 'hold'], [60, 1, EASE.in], [100, 0.35]]);
  });
  for (const t of trims) t && intro.key(t, 'end', [[0, 0, 'hold'], [52, 0, EASE.inOut], [100, 1]]);
  const flicker = ab.animation('flicker', { duration: 120, loop: 1 });
  bars.forEach((b) => { flicker.key(b, 'scaleY', [[0, 0.06, 'hold']]); flicker.key(b, 'opacity', [[0, 0.35, 'hold']]); });
  for (const t of trims) flicker.key(t, 'end', [[0, 1, 'hold']]);
  flicker.key(line, 'opacity', [[0, 1, 'hold'], [70, 1, 'hold'], [73, 0.3, 'hold'], [76, 1, 'hold'], [80, 0.5, 'hold'], [84, 1, 'hold'], [120, 1]]);

  const sm = ab.stateMachine('Failed');
  const layer = sm.layer('Main');
  const a = layer.state(intro), b = layer.state(flicker);
  layer.transition(layer.entry, a);
  layer.transition(a, b, { exitTime: 100, percent: true });
}

export default function build() {
  const f = new RivFile();
  clear(f);
  failed(f);
  return f;
}
