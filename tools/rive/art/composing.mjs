// composing.riv: shown while the AI writes a song. A glowing core with a live waveform across
// it, three counter-rotating orbit rings, and four stage lights around the edge:
// listening (cyan), melody (pink), charting (sun), mixing (violet).
// State machine "Composing": number `stage` 0..4 (4 = done: everything lights and the core flares).

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, neonStroke } from '../helpers.mjs';

const TAU = Math.PI * 2;
const C = 160;

function arc(r, from, to, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Composing', width: 320, height: 320 });

  // Orbit rings, each a few broken arcs.
  const rings = [
    { r: 128, color: COLORS.violet, w: 2, arcs: [[0, 1.6], [2.1, 3.3], [3.8, 5.6]] },
    { r: 104, color: COLORS.cyan, w: 2.5, arcs: [[0.4, 1.2], [1.9, 3.9], [4.6, 5.9]] },
    { r: 80, color: COLORS.pink, w: 3, arcs: [[0, 2.4], [3.1, 5.4]] },
  ].map((spec, i) => {
    const node = ab.node(null, { name: `ring${i}`, x: C, y: C });
    for (const [a, b] of spec.arcs) {
      const s = ab.shape(node);
      ab.path(s, arc(spec.r, a, b), { closed: false });
      neonStroke(ab, s, spec.color, spec.w, { glow: 8, coreAlpha: 0.6 });
    }
    return node;
  });

  // Core orb.
  const core = ab.node(null, { name: 'core', x: C, y: C });
  const halo = ab.shape(core);
  ab.ellipse(halo, { w: 92, h: 92 });
  const haloFill = ab.fill(halo, COLORS.magenta, { alpha: 0.8 });
  const haloFeather = ab.feather(haloFill, 26);
  const orb = ab.shape(core);
  ab.ellipse(orb, { w: 76, h: 76 });
  ab.gradFill(orb, { kind: 'radial', start: [-10, -14], end: [34, 34], stops: [[0, '#ffffff'], [0.35, COLORS.pink], [1, COLORS.violet]] });

  // Waveform through the core: vertices move up and down out of phase.
  const wave = ab.shape(null, { name: 'wave', x: C, y: C });
  const N = 22;
  const span = 200;
  const pts = Array.from({ length: N }, (_, i) => [-span / 2 + (i * span) / (N - 1), 0]);
  const path = ab.path(wave, pts, { closed: false });
  neonStroke(ab, wave, COLORS.cyan, 2.5, { glow: 8 });
  const verts = ab.objects.filter((o) => o.cls === 'StraightVertex' && o.props.parentId === path);

  // Stage lights at the four diagonals.
  const LIGHT = [COLORS.cyan, COLORS.pink, COLORS.sun, COLORS.violet];
  const lights = LIGHT.map((color, i) => {
    const a = -TAU * 0.375 + (i * TAU) / 4;
    const node = ab.node(null, { name: `light${i}`, x: C + Math.cos(a) * 146, y: C + Math.sin(a) * 146 });
    const g = ab.shape(node);
    ab.ellipse(g, { w: 22, h: 22 });
    const glow = ab.fill(g, color, { alpha: 0 });
    ab.feather(glow, 10);
    const dot = ab.shape(node);
    ab.ellipse(dot, { w: 11, h: 11 });
    const fill = ab.fill(dot, COLORS.ash);
    return { node, glow, fill, color };
  });

  // Always-on motion.
  const spin = ab.animation('spin', { duration: 480, loop: 1 });
  spin.key(rings[0], 'rotation', [[0, 0, EASE.linear], [480, TAU]]);
  spin.key(rings[1], 'rotation', [[0, 0, EASE.linear], [480, -TAU * 2]]);
  spin.key(rings[2], 'rotation', [[0, 0, EASE.linear], [480, TAU * 3]]);
  spin.key(core, 'scaleX', [0, 60, 120, 180, 240, 300, 360, 420, 480].map((t, k) => [t, k % 2 ? 1.08 : 1, EASE.inOut]));
  spin.key(core, 'scaleY', [0, 60, 120, 180, 240, 300, 360, 420, 480].map((t, k) => [t, k % 2 ? 1.08 : 1, EASE.inOut]));
  verts.forEach((v, i) => {
    const edge = Math.sin((i / (N - 1)) * Math.PI); // quiet at the ends
    const amp = 6 + 22 * edge;
    const frames = [0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480];
    spin.key(v, 'y', frames.map((t, k) => {
      const ph = Math.sin(k * 1.7 + i * 0.9) * Math.cos(k * 0.6 - i * 0.35);
      return [t, k === frames.length - 1 ? Math.sin(i * 0.9) * Math.cos(-i * 0.35) * amp : ph * amp, EASE.inOut];
    }));
  });

  // Stage poses: lights up to the current stage are on; the newest one pops.
  const poses = [0, 1, 2, 3, 4].map((k) => {
    const a = ab.animation(`stage-${k}`, { duration: 30 });
    lights.forEach((l, i) => {
      const on = i <= k;
      const fresh = i === k || (k === 4);
      a.key(l.fill, 'colorValue', [[0, on ? l.color : COLORS.ash, 'hold']]);
      a.key(l.glow, 'colorValue', [[0, on ? `${l.color}e6` : `${l.color}00`, 'hold']]);
      const s = fresh && on ? [[0, 0.6, EASE.back], [20, 1.35]] : [[0, 1, 'hold']];
      a.key(l.node, 'scaleX', s);
      a.key(l.node, 'scaleY', s);
    });
    a.key(haloFeather, 'strength', k === 4 ? [[0, 60, EASE.out], [30, 34]] : [[0, 26, 'hold']]);
    a.key(haloFill, 'colorValue', [[0, k === 4 ? COLORS.sun : COLORS.magenta, 'hold']]);
    return a;
  });

  const sm = ab.stateMachine('Composing');
  const stage = sm.number('stage', 0);
  const motion = sm.layer('Motion');
  const sSpin = motion.state(spin);
  motion.transition(motion.entry, sSpin);
  const st = sm.layer('Stage');
  const states = poses.map((p) => st.state(p));
  st.transition(st.entry, states[0]);
  for (let k = 0; k < 4; k++) {
    st.transition(states[k], states[k + 1], { conditions: [{ input: stage, op: '>=', value: k + 1 }] });
    st.transition(states[k + 1], states[k], { conditions: [{ input: stage, op: '<', value: k + 1 }] });
  }
  return f;
}
