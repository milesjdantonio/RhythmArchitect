// combo.riv: the score multiplier meter. Four thin slanted bars light up ice, rose, gold, lavender
// as the multiplier climbs; at x4 they shimmer. The number itself is drawn by the app.
// State machine "Combo": number `level` 0..4, trigger `bump` (a tile was hit),
// trigger `break` (combo lost: the meter shakes and flashes red).

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

export default function build() {
  const f = new RivFile();
  const W = 240, H = 64;
  const ab = f.artboard({ name: 'Combo', width: W, height: H });
  const meter = ab.node(null, { name: 'meter', x: W / 2, y: H / 2 });
  const COLORS4 = [COLORS.cyan, COLORS.pink, COLORS.sun, COLORS.violet];
  const DIM = COLORS.dim;

  const segs = COLORS4.map((color, i) => {
    const node = ab.node(meter, { name: `seg${i}`, x: -84 + i * 56 });
    const glowS = ab.shape(node);
    ab.path(glowS, [[-22, 4], [-19, -4], [27, -4], [24, 4]], { radius: 1.5 });
    const glow = ab.fill(glowS, color, { alpha: 0 });
    ab.feather(glow, 12);
    const s = ab.shape(node);
    ab.path(s, [[-22, 4], [-19, -4], [27, -4], [24, 4]], { radius: 1.5 });
    const fill = ab.fill(s, DIM);
    ab.stroke(s, '#ffffff', 1.2, { alpha: 0.18 });
    return { node, glow, fill, color };
  });

  // Red flash laid over the meter for `break`.
  const red = ab.shape(meter, { name: 'red' });
  ab.rect(red, { x: -112, y: -18, w: 224, h: 36, r: 8 });
  const redFill = ab.fill(red, COLORS.miss, { alpha: 0 });
  ab.feather(redFill, 14);

  const pose = (k) => {
    const loop = k === 4;
    const a = ab.animation(`level-${k}`, { duration: loop ? 90 : 16, loop: loop ? 1 : 0 });
    segs.forEach((s, i) => {
      const on = i < k;
      if (loop) {
        a.key(s.fill, 'colorValue', [[0, s.color, 'hold']]);
        a.key(s.glow, 'colorValue', [0, 45, 90].map((t, n) => [t, n === 1 ? `${s.color}ff` : `${s.color}66`, EASE.inOut]));
        a.key(s.node, 'y', [0, 45, 90].map((t, n) => [t, n === 1 ? -3 : 0, EASE.inOut]));
      } else {
        a.key(s.fill, 'colorValue', [[0, on ? s.color : DIM, 'hold']]);
        a.key(s.glow, 'colorValue', [[0, on ? `${s.color}b3` : `${s.color}00`, 'hold']]);
        a.key(s.node, 'y', [[0, 0, 'hold']]);
        const fresh = i === k - 1;
        a.key(s.node, 'scaleY', fresh ? [[0, 1.6, EASE.back], [16, 1]] : [[0, 1, 'hold']]);
      }
    });
    return a;
  };
  const levels = [0, 1, 2, 3, 4].map(pose);

  const rest = ab.animation('rest', { duration: 1 });
  rest.key(meter, 'scaleX', [[0, 1, 'hold']]);
  rest.key(meter, 'x', [[0, W / 2, 'hold']]);
  rest.key(red, 'opacity', [[0, 0, 'hold']]);
  const bump = ab.animation('bump', { duration: 12 });
  bump.key(meter, 'scaleX', [[0, 1.06, EASE.out], [12, 1]]);
  bump.key(meter, 'scaleY', [[0, 1.12, EASE.out], [12, 1]]);
  const brk = ab.animation('break', { duration: 36 });
  brk.key(meter, 'x', [[0, W / 2, EASE.linear], [4, W / 2 - 9, EASE.linear], [8, W / 2 + 8, EASE.linear], [12, W / 2 - 5, EASE.linear], [16, W / 2 + 3, EASE.linear], [20, W / 2]]);
  brk.key(red, 'opacity', [[0, 1, EASE.in], [36, 0]]);
  brk.key(redFill, 'colorValue', [[0, `${COLORS.miss}cc`, 'hold']]);

  const sm = ab.stateMachine('Combo');
  const level = sm.number('level', 0);
  const onBump = sm.trigger('bump');
  const onBreak = sm.trigger('break');
  const lv = sm.layer('Level');
  const ls = levels.map((a) => lv.state(a));
  lv.transition(lv.entry, ls[0]);
  ls.forEach((from, i) => ls.forEach((to, j) => {
    if (i === j) return;
    // Exactly one transition matches each level value.
    lv.transition(from, to, { conditions: j === 4 ? [{ input: level, op: '>=', value: 4 }] : [{ input: level, op: '==', value: j }] });
  }));
  const fx = sm.layer('FX');
  const sRest = fx.state(rest), b1 = fx.state(bump), b2 = fx.state(bump), k1 = fx.state(brk);
  fx.transition(fx.entry, sRest);
  for (const from of [sRest, b1, b2]) fx.transition(from, k1, { conditions: [{ input: onBreak }] });
  fx.transition(sRest, b1, { conditions: [{ input: onBump }] });
  fx.transition(b1, b2, { conditions: [{ input: onBump }] });
  fx.transition(b2, b1, { conditions: [{ input: onBump }] });
  fx.transition(b1, sRest, { exitTime: 100, percent: true });
  fx.transition(b2, sRest, { exitTime: 100, percent: true });
  fx.transition(k1, sRest, { exitTime: 100, percent: true });
  return f;
}
