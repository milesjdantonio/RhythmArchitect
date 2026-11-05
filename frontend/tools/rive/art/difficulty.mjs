// difficulty.riv: the Easy / Medium / Hard picker badges. Each artboard is a rounded tile with
// three signal bars, 1, 2 or 3 of them lit in the level's colour.
// State machine "Difficulty" on each: bool `selected` (frame lights up, lit bars pump),
// bool `hover` (lifts the badge).

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, neonStroke } from '../helpers.mjs';

const LEVELS = [
  { name: 'Easy', lit: 1, color: COLORS.cyan },
  { name: 'Medium', lit: 2, color: COLORS.sun },
  { name: 'Hard', lit: 3, color: COLORS.pink },
];

function badge(f, { name, lit, color }) {
  const S = 120;
  const ab = f.artboard({ name, width: S, height: S });
  const lift = ab.node(null, { name: 'lift', x: S / 2, y: S / 2 });
  const frame = ab.shape(lift, { name: 'frame' });
  ab.rect(frame, { x: -44, y: -44, w: 88, h: 88, r: 18 });
  ab.fill(frame, '#160c2c');
  const neon = neonStroke(ab, frame, color, 2.5, { glow: 10, coreAlpha: 0.5 });
  const dimEdge = ab.stroke(frame, '#3a2466', 2);

  const bars = [0, 1, 2].map((i) => {
    const h = 16 + i * 14;
    const node = ab.node(lift, { name: `bar${i}`, x: -20 + i * 20, y: 26 });
    const s = ab.shape(node);
    ab.rect(s, { x: -6, y: -h, w: 12, h, r: 3 });
    const on = i < lit;
    const fill = ab.fill(s, on ? color : COLORS.dim);
    if (on) {
      const g = ab.shape(node);
      ab.rect(g, { x: -6, y: -h, w: 12, h, r: 3 });
      const gf = ab.fill(g, color, { alpha: 0 });
      ab.feather(gf, 10);
      return { node, fill, glow: gf, on };
    }
    return { node, fill, on };
  });

  const off = ab.animation('off', { duration: 12 });
  const on = ab.animation('on', { duration: 60, loop: 1 });
  for (const s of [neon.halo, neon.line, neon.hot]) {
    off.key(s, 'colorValue', [[0, `${color}00`, 'hold']]);
    on.key(s, 'colorValue', [[0, s === neon.hot ? '#ffffffaa' : color, 'hold']]);
  }
  off.key(dimEdge, 'colorValue', [[0, '#3a2466', 'hold']]);
  on.key(dimEdge, 'colorValue', [[0, '#3a246600', 'hold']]);
  bars.forEach((b, i) => {
    if (!b.on) {
      off.key(b.node, 'scaleY', [[0, 1, 'hold']]);
      on.key(b.node, 'scaleY', [[0, 1, 'hold']]);
      return;
    }
    off.key(b.node, 'scaleY', [[0, 1, 'hold']]);
    off.key(b.glow, 'colorValue', [[0, `${color}00`, 'hold']]);
    off.key(b.fill, 'colorValue', [[0, `${color}99`, 'hold']]);
    on.key(b.fill, 'colorValue', [[0, color, 'hold']]);
    on.key(b.glow, 'colorValue', [[0, `${color}cc`, 'hold']]);
    const ph = i * 10;
    on.key(b.node, 'scaleY', [[0, 1, EASE.inOut], [15 + ph / 2, 0.72, EASE.inOut], [30 + ph / 3, 1.08, EASE.inOut], [60, 1]]);
  });

  const rest = ab.animation('rest', { duration: 12 });
  rest.key(lift, 'y', [[0, S / 2, 'hold']]);
  rest.key(lift, 'scaleX', [[0, 1, 'hold']]);
  rest.key(lift, 'scaleY', [[0, 1, 'hold']]);
  const up = ab.animation('hover', { duration: 14 });
  up.key(lift, 'y', [[0, S / 2, EASE.back], [14, S / 2 - 4]]);
  up.key(lift, 'scaleX', [[0, 1, EASE.back], [14, 1.05]]);
  up.key(lift, 'scaleY', [[0, 1, EASE.back], [14, 1.05]]);

  const sm = ab.stateMachine('Difficulty');
  const selected = sm.bool('selected', false);
  const hover = sm.bool('hover', false);
  const sel = sm.layer('Select');
  const sOff = sel.state(off), sOn = sel.state(on);
  sel.transition(sel.entry, sOff);
  sel.transition(sOff, sOn, { conditions: [{ input: selected, value: true }], duration: 160 });
  sel.transition(sOn, sOff, { conditions: [{ input: selected, value: false }], duration: 200 });
  const hv = sm.layer('Hover');
  const sRest = hv.state(rest), sUp = hv.state(up);
  hv.transition(hv.entry, sRest);
  hv.transition(sRest, sUp, { conditions: [{ input: hover, value: true }] });
  hv.transition(sUp, sRest, { conditions: [{ input: hover, value: false }], duration: 160 });
}

export default function build() {
  const f = new RivFile();
  for (const l of LEVELS) badge(f, l);
  return f;
}
