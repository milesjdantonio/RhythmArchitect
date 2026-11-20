// signal.riv: the connection, for the "your connection is slow" card in play (LagCard.tsx).
// Four signal bars, neon. State machine "Signal": bool `strong`. Weak: the first bar pulses, the
// others sit dim while a faint scan runs up them (looking for signal). Strong: the bars light up in
// turn and hold.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, neonStroke } from '../helpers.mjs';

export default function build() {
  const f = new RivFile();
  const W = 200, H = 140;
  const ab = f.artboard({ name: 'Signal', width: W, height: H });
  const root = ab.node(null, { name: 'root', x: W / 2, y: H / 2 + 10 });

  // The bars, left to right, each taller than the last; a dim track and a lit bar over it.
  const BAR_W = 22, GAP = 14, base = 40;
  const heights = [24, 44, 64, 84];
  const x0 = -((BAR_W * 4 + GAP * 3) / 2);
  const lit = heights.map((h, i) => {
    const x = x0 + i * (BAR_W + GAP);
    const track = ab.shape(root, { name: `track${i}` });
    ab.rect(track, { x, y: base - h, w: BAR_W, h, r: 6 });
    ab.fill(track, COLORS.dim);
    ab.stroke(track, COLORS.ash, 1.5, { alpha: 0.9 });
    const node = ab.node(root, { name: `bar${i}`, opacity: 0 });
    const bar = ab.shape(node);
    ab.rect(bar, { x, y: base - h, w: BAR_W, h, r: 6 });
    ab.gradFill(bar, { start: [0, base - h], end: [0, base], stops: [[0, COLORS.cyan], [1, COLORS.violet]] });
    neonStroke(ab, bar, i === 0 ? COLORS.miss : COLORS.cyan, 2, { glow: 9, coreAlpha: 0.5 });
    return node;
  });

  // The scan: a soft band of light that runs up across the bars while it's weak.
  const scanNode = ab.node(root, { name: 'scan', opacity: 0 });
  const scan = ab.shape(scanNode);
  ab.rect(scan, { x: x0 - 6, y: -6, w: BAR_W * 4 + GAP * 3 + 12, h: 12, r: 6 });
  ab.fill(scan, COLORS.cyan, { alpha: 0.35 });

  const weak = ab.animation('weak', { duration: 120, loop: 1 });
  weak.key(lit[0], 'opacity', [[0, 0.35, EASE.inOut], [30, 1, EASE.inOut], [60, 0.35, EASE.inOut], [90, 1, EASE.inOut], [120, 0.35]]);
  for (const b of lit.slice(1)) weak.key(b, 'opacity', [[0, 0, 'hold']]);
  weak.key(scanNode, 'y', [[0, base, EASE.inOut], [120, base - 90]]);
  weak.key(scanNode, 'opacity', [[0, 0, EASE.out], [20, 0.8, EASE.inOut], [100, 0.5, EASE.in], [120, 0]]);

  const strong = ab.animation('strong', { duration: 60 });
  lit.forEach((b, i) => strong.key(b, 'opacity', [[0, 0, 'hold'], [i * 10, 0, EASE.out], [i * 10 + 14, 1]]));
  strong.key(scanNode, 'opacity', [[0, 0, 'hold']]);

  const sm = ab.stateMachine('Signal');
  const isStrong = sm.bool('strong', false);
  const layer = sm.layer('Bars');
  const sWeak = layer.state(weak), sStrong = layer.state(strong);
  layer.transition(layer.entry, sWeak);
  layer.transition(sWeak, sStrong, { conditions: [{ input: isStrong, value: true }] });
  layer.transition(sStrong, sWeak, { conditions: [{ input: isStrong, value: false }] });
  return f;
}
