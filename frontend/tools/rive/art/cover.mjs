// cover.riv: a living cover for songs without album art. A dark tile with one of four motifs in
// light, picked per song: 0 a record of light that turns, 1 a core with two orbits, 2 an
// equalizer that bounces, 3 a prism of two diamonds turning against each other. The app tints it
// to the song's colours (CSS hue-rotate on the canvas), so every song looks its own.
// State machine "Cover": number `variant` (0..3), bool `playing` (the song is on stage: it moves faster).

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

const TAU = Math.PI * 2;
const S = 160, C = 80;

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Cover', width: S, height: S });

  // The tile.
  const tile = ab.shape(null, { name: 'tile' });
  ab.rect(tile, { x: 2, y: 2, w: S - 4, h: S - 4, r: 16 });
  ab.gradFill(tile, { start: [0, 0], end: [S, S], stops: [[0, '#0e1630'], [0.6, '#070b1c'], [1, '#120c2a']] });
  ab.stroke(tile, COLORS.cyan, 1.2, { alpha: 0.35 });
  const glowS = ab.shape(null, { name: 'glow', x: C, y: C });
  ab.ellipse(glowS, { w: 110, h: 110 });
  const glow = ab.fill(glowS, COLORS.cyan, { alpha: 0.28 });
  ab.feather(glow, 30);

  const groups = [];
  const motion = ab.animation('motion', { duration: 480, loop: 1 });

  // 0 — a record of light.
  {
    const g = ab.node(null, { name: 'disc', x: C, y: C });
    const spin = ab.node(g, { name: 'discSpin' });
    for (const r of [56, 50, 44, 38, 32]) {
      const s = ab.shape(spin); ab.ellipse(s, { w: r * 2, h: r * 2 });
      ab.stroke(s, COLORS.violet, 1, { alpha: r === 56 ? 0.8 : 0.32 });
    }
    const sheen = ab.shape(spin); ab.ellipse(sheen, { w: 104, h: 104 });
    const sh = ab.stroke(sheen, '#ffffff', 2.4, { alpha: 0.85 });
    ab.trim(sh, { start: 0, end: 0.12 });
    const sh2 = ab.stroke(sheen, COLORS.cyan, 8, { alpha: 0.5 }); ab.feather(sh2, 6);
    ab.trim(sh2, { start: 0, end: 0.12 });
    const label = ab.shape(g); ab.ellipse(label, { w: 34, h: 34 });
    ab.gradFill(label, { kind: 'radial', start: [-4, -5], end: [17, 17], stops: [[0, '#ffffff'], [0.45, COLORS.cyan], [1, COLORS.violet]] });
    const hole = ab.shape(g); ab.ellipse(hole, { w: 5, h: 5 }); ab.fill(hole, '#070b1c');
    motion.key(spin, 'rotation', [[0, 0, EASE.linear], [480, TAU * 2]]);
    groups.push(g);
  }

  // 1 — a core with two orbits.
  {
    const g = ab.node(null, { name: 'orbits', x: C, y: C });
    const core = ab.node(g, { name: 'core' });
    const h = ab.shape(core); ab.ellipse(h, { w: 40, h: 40 }); ab.feather(ab.fill(h, COLORS.cyan, { alpha: 0.7 }), 12);
    const o = ab.shape(core); ab.ellipse(o, { w: 18, h: 18 });
    ab.gradFill(o, { kind: 'radial', start: [-3, -3], end: [9, 9], stops: [[0, '#ffffff'], [1, COLORS.cyan]] });
    [{ r: 34, tilt: 0.38, rot: -0.4, n: 10, turns: 1 }, { r: 54, tilt: 0.46, rot: 0.5, n: 16, turns: -1 }].forEach((d, k) => {
      const outer = ab.node(g, { rotation: d.rot });
      const squash = ab.node(outer, { scaleY: d.tilt });
      const spin = ab.node(squash, { name: `orbit${k}` });
      const ring = ab.shape(squash); ab.ellipse(ring, { w: d.r * 2, h: d.r * 2 }); ab.stroke(ring, COLORS.violet, 1, { alpha: 0.35 });
      for (let i = 0; i < d.n; i++) {
        const a = (i / d.n) * TAU, big = i === 0;
        const s = ab.shape(spin); ab.ellipse(s, { x: Math.cos(a) * d.r, y: Math.sin(a) * d.r, w: big ? 7 : 3, h: big ? 7 : 3 });
        ab.fill(s, big ? '#ffffff' : COLORS.cyan, { alpha: big ? 1 : 0.8 });
      }
      motion.key(spin, 'rotation', [[0, 0, EASE.linear], [480, TAU * d.turns * 2]]);
    });
    const beat = [0, 60, 120, 180, 240, 300, 360, 420, 480].map((t, k) => [t, k % 2 ? 1.18 : 1, EASE.inOut]);
    motion.key(core, 'scaleX', beat);
    motion.key(core, 'scaleY', beat);
    groups.push(g);
  }

  // 2 — an equalizer, with its reflection.
  {
    const g = ab.node(null, { name: 'eq', x: C, y: C + 10 });
    const N = 7;
    for (let i = 0; i < N; i++) {
      const bar = ab.node(g, { x: (i - (N - 1) / 2) * 15 });
      const s = ab.shape(bar); ab.rect(s, { x: -4, y: -46, w: 8, h: 46, r: 3 });
      ab.gradFill(s, { start: [0, -46], end: [0, 0], stops: [[0, '#ffffff'], [0.35, COLORS.cyan], [1, COLORS.violet]] });
      const refl = ab.shape(bar); ab.rect(refl, { x: -4, y: 4, w: 8, h: 18, r: 3 });
      ab.gradFill(refl, { start: [0, 4], end: [0, 22], stops: [[0, `${COLORS.violet}66`], [1, `${COLORS.violet}00`]] });
      const seq = [0.35, 1, 0.55, 0.85, 0.3, 0.7, 0.95, 0.45];
      const pts = [];
      for (let k = 0; k <= 16; k++) pts.push([k * 30, k === 16 ? seq[(i * 3) % 8] : seq[(i * 3 + k) % 8], EASE.inOut]);
      motion.key(bar, 'scaleY', pts);
    }
    const line = ab.shape(g); ab.rect(line, { x: -56, y: 1, w: 112, h: 1.2 }); ab.fill(line, '#ffffff', { alpha: 0.6 });
    groups.push(g);
  }

  // 3 — a prism: two diamonds turning against each other, with a soft flare.
  {
    const g = ab.node(null, { name: 'prism', x: C, y: C });
    const a = ab.node(g, { name: 'diamondA' });
    const da = ab.shape(a); ab.path(da, [[0, -52], [38, 0], [0, 52], [-38, 0]]);
    ab.feather(ab.stroke(da, COLORS.cyan, 7, { alpha: 0.5 }), 6); ab.stroke(da, '#ffffff', 1.4, { alpha: 0.9 });
    const b = ab.node(g, { name: 'diamondB' });
    const db = ab.shape(b); ab.path(db, [[0, -30], [22, 0], [0, 30], [-22, 0]]);
    ab.stroke(db, COLORS.violet, 1.4, { alpha: 0.9 });
    ab.fill(db, COLORS.violet, { alpha: 0.12 });
    const star = ab.shape(g); ab.path(star, [[0, -14], [2.5, -2.5], [14, 0], [2.5, 2.5], [0, 14], [-2.5, 2.5], [-14, 0], [-2.5, -2.5]]);
    ab.fill(star, '#ffffff');
    motion.key(a, 'rotation', [[0, 0, EASE.linear], [480, TAU]]);
    motion.key(b, 'rotation', [[0, 0, EASE.linear], [480, -TAU * 2]]);
    const pulse = [0, 120, 240, 360, 480].map((t, k) => [t, k % 2 ? 1.12 : 0.94, EASE.inOut]);
    motion.key(g, 'scaleX', pulse);
    motion.key(g, 'scaleY', pulse);
    groups.push(g);
  }
  motion.key(glow, 'colorValue', [0, 240, 480].map((t, k) => [t, k === 1 ? `${COLORS.cyan}66` : `${COLORS.cyan}38`, EASE.inOut]));

  // One state per variant: shows its motif, hides the others.
  const shows = groups.map((_, v) => {
    const a = ab.animation(`variant-${v}`, { duration: 20 });
    groups.forEach((g, k) => a.key(g, 'opacity', k === v ? [[0, 0, EASE.out], [20, 1]] : [[0, 0, 'hold']]));
    return a;
  });

  const sm = ab.stateMachine('Cover');
  const variant = sm.number('variant', 0);
  const playing = sm.bool('playing', false);
  const vl = sm.layer('Variant');
  const states = shows.map((a) => vl.state(a));
  vl.transition(vl.entry, states[0]);
  states.forEach((from, i) => states.forEach((to, j) => {
    if (i !== j) vl.transition(from, to, { conditions: [{ input: variant, op: '==', value: j }] });
  }));
  const ml = sm.layer('Motion');
  const calm = ml.state(motion, { speed: 0.6 }), fast = ml.state(motion, { speed: 1.5 });
  ml.transition(ml.entry, calm);
  ml.transition(calm, fast, { conditions: [{ input: playing, value: true }], duration: 300 });
  ml.transition(fast, calm, { conditions: [{ input: playing, value: false }], duration: 500 });
  return f;
}
