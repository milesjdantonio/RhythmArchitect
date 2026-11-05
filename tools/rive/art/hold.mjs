// hold.riv: plays on a pad while a long tile is held. Five looping styles, one picked at random
// for each hold, then a finish: a bright "held" bloom, or a red fizzle if it was let go early.
//   0 charging ring — a ring drawing itself round and round, with a glowing core
//   1 spinning arcs — three arcs counter-rotating
//   2 chevrons      — chevrons streaming upward
//   3 orbit         — six dots orbiting and breathing
//   4 beam          — a pulsing column of light
// State machine "Hold": number `variant` (0..4), bool `holding`, triggers `done`, `broken`.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

const TAU = Math.PI * 2;
const C = 80;

function arc(r, from, to, steps = 18) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Hold', width: 160, height: 160 });
  const loops = [];

  // 0 charging ring
  const charge = ab.node(null, { name: 'charge', x: C, y: C });
  const cs = ab.shape(charge); ab.ellipse(cs, { w: 70, h: 70 });
  const cHalo = ab.stroke(cs, COLORS.cyan, 8); ab.feather(cHalo, 8);
  const cLine = ab.stroke(cs, '#ffffff', 2.5);
  const trims = [cHalo, cLine].map((s) => ab.trim(s, { end: 0 }));
  const core = ab.shape(charge); ab.ellipse(core, { w: 26, h: 26 });
  ab.feather(ab.fill(core, COLORS.cyan, { alpha: 0.8 }), 10);
  loops.push(charge);

  // 1 spinning arcs
  const arcs = ab.node(null, { name: 'arcs', x: C, y: C });
  const arcNodes = [26, 36, 46].map((r, i) => {
    const n = ab.node(arcs);
    const s = ab.shape(n);
    ab.path(s, arc(r, 0, TAU * 0.6), { closed: false });
    ab.feather(ab.stroke(s, [COLORS.pink, COLORS.cyan, COLORS.violet][i], 7, { alpha: 0.6 }), 6);
    ab.stroke(s, [COLORS.pink, COLORS.cyan, COLORS.violet][i], 2.5);
    return n;
  });
  loops.push(arcs);

  // 2 chevrons streaming up
  const chevrons = ab.node(null, { name: 'chevrons', x: C, y: C });
  const chevs = [0, 1, 2].map(() => {
    const n = ab.node(chevrons);
    const s = ab.shape(n);
    ab.path(s, [[-16, 8], [0, -6], [16, 8]], { closed: false });
    ab.feather(ab.stroke(s, COLORS.sun, 8, { alpha: 0.6 }), 6);
    ab.stroke(s, '#fff6c2', 3);
    return n;
  });
  loops.push(chevrons);

  // 3 orbit
  const orbit = ab.node(null, { name: 'orbit', x: C, y: C });
  for (let i = 0; i < 6; i++) {
    const arm = ab.node(orbit, { x: Math.cos((i / 6) * TAU) * 30, y: Math.sin((i / 6) * TAU) * 30 });
    const s = ab.shape(arm); ab.ellipse(s, { w: 8, h: 8 });
    ab.fill(s, i % 2 ? COLORS.pink : COLORS.cyan);
    ab.feather(ab.fill(s, i % 2 ? COLORS.pink : COLORS.cyan, { alpha: 0.6 }), 6);
  }
  loops.push(orbit);

  // 4 beam
  const beam = ab.node(null, { name: 'beam', x: C, y: C + 30 });
  const bs = ab.shape(beam);
  ab.rect(bs, { x: -14, y: -110, w: 28, h: 110, r: 14 });
  ab.gradFill(bs, { start: [0, -110], end: [0, 0], stops: [[0, `${COLORS.violet}00`], [0.6, `${COLORS.pink}aa`], [1, '#ffffffee']] });
  const bglow = ab.shape(beam); ab.rect(bglow, { x: -20, y: -110, w: 40, h: 110, r: 20 });
  ab.feather(ab.fill(bglow, COLORS.pink, { alpha: 0.45 }), 12);
  loops.push(beam);

  // Finishes.
  const bloom = ab.node(null, { name: 'bloom', x: C, y: C });
  const bls = ab.shape(bloom); ab.ellipse(bls, { w: 70, h: 70 });
  ab.feather(ab.stroke(bls, COLORS.sun, 10, { alpha: 0.8 }), 8);
  ab.stroke(bls, '#ffffff', 3);
  const fizz = ab.node(null, { name: 'fizzle', x: C, y: C });
  const fzs = ab.shape(fizz); ab.ellipse(fzs, { w: 60, h: 60 });
  ab.feather(ab.stroke(fzs, COLORS.miss, 8, { alpha: 0.7 }), 6);
  ab.stroke(fzs, '#ffd6de', 2);

  const only = (a, keep) => { for (const n of loops) a.key(n, 'opacity', [[0, n === keep ? 1 : 0, 'hold']]); };
  const idle = ab.animation('idle', { duration: 1 });
  only(idle, null);

  const L = 60;
  const a0 = ab.animation('charge', { duration: L, loop: 1 });
  only(a0, charge);
  for (const t of trims) {
    a0.key(t, 'end', [[0, 0, EASE.inOut], [L, 1]]);
    a0.key(t, 'offset', [[0, 0, EASE.linear], [L, 0.5]]);
  }
  a0.key(charge, 'scaleX', [[0, 1, EASE.inOut], [L / 2, 1.08, EASE.inOut], [L, 1]]);
  a0.key(charge, 'scaleY', [[0, 1, EASE.inOut], [L / 2, 1.08, EASE.inOut], [L, 1]]);

  const a1 = ab.animation('arcs', { duration: 90, loop: 1 });
  only(a1, arcs);
  arcNodes.forEach((n, i) => a1.key(n, 'rotation', [[0, i * 1.3, EASE.linear], [90, i * 1.3 + (i % 2 ? -1 : 1) * TAU * (1 + i * 0.5)]]));

  const a2 = ab.animation('chevrons', { duration: 36, loop: 1 });
  only(a2, chevrons);
  chevs.forEach((n, i) => {
    const d = i * 12;
    a2.key(n, 'y', [[0, 24 - (12 * i), EASE.linear], [36 - d, -30, 'hold'], [36 - d + 0.01, 24, EASE.linear], [36, 24 - (12 * i)]]);
    a2.key(n, 'opacity', [[0, 1 - i * 0.25, EASE.linear], [36 - d, 0, 'hold'], [36 - d + 0.01, 1, EASE.linear], [36, 1 - i * 0.25]]);
  });

  const a3 = ab.animation('orbit', { duration: 72, loop: 1 });
  only(a3, orbit);
  a3.key(orbit, 'rotation', [[0, 0, EASE.linear], [72, TAU]]);
  a3.key(orbit, 'scaleX', [[0, 1, EASE.inOut], [36, 1.25, EASE.inOut], [72, 1]]);
  a3.key(orbit, 'scaleY', [[0, 1, EASE.inOut], [36, 1.25, EASE.inOut], [72, 1]]);

  const a4 = ab.animation('beam', { duration: 30, loop: 1 });
  only(a4, beam);
  a4.key(beam, 'scaleX', [[0, 0.8, EASE.inOut], [15, 1.25, EASE.inOut], [30, 0.8]]);
  a4.key(beam, 'opacity', [[0, 0.8, EASE.inOut], [15, 1, EASE.inOut], [30, 0.8]]);

  const rest = ab.animation('rest', { duration: 1 });
  rest.key(bloom, 'opacity', [[0, 0, 'hold']]);
  rest.key(fizz, 'opacity', [[0, 0, 'hold']]);
  const done = ab.animation('done', { duration: 30 });
  done.key(bloom, 'opacity', [[0, 1, EASE.in], [30, 0]]);
  done.key(bloom, 'scaleX', [[0, 0.5, EASE.out], [30, 1.9]]);
  done.key(bloom, 'scaleY', [[0, 0.5, EASE.out], [30, 1.9]]);
  done.key(fizz, 'opacity', [[0, 0, 'hold']]);
  const broken = ab.animation('broken', { duration: 26 });
  broken.key(fizz, 'opacity', [[0, 1, EASE.in], [26, 0]]);
  broken.key(fizz, 'scaleX', [[0, 1.2, EASE.out], [26, 0.4]]);
  broken.key(fizz, 'scaleY', [[0, 1.2, EASE.out], [26, 0.4]]);
  broken.key(bloom, 'opacity', [[0, 0, 'hold']]);

  const sm = ab.stateMachine('Hold');
  const variant = sm.number('variant', 0);
  const holding = sm.bool('holding', false);
  const onDone = sm.trigger('done');
  const onBroken = sm.trigger('broken');
  const loopLayer = sm.layer('Loop');
  const sIdle = loopLayer.state(idle);
  loopLayer.transition(loopLayer.entry, sIdle);
  [a0, a1, a2, a3, a4].forEach((anim, v) => {
    const s = loopLayer.state(anim);
    loopLayer.transition(sIdle, s, { conditions: [{ input: holding, value: true }, { input: variant, op: '==', value: v }] });
    loopLayer.transition(s, sIdle, { conditions: [{ input: holding, value: false }] });
  });
  const end = sm.layer('Finish');
  const sRest = end.state(rest);
  end.transition(end.entry, sRest);
  const dA = end.state(done), dB = end.state(done), kA = end.state(broken), kB = end.state(broken);
  for (const from of [sRest, dA, dB, kA, kB]) {
    end.transition(from, from === dA ? dB : dA, { conditions: [{ input: onDone }] });
    end.transition(from, from === kA ? kB : kA, { conditions: [{ input: onBroken }] });
  }
  for (const s of [dA, dB, kA, kB]) end.transition(s, sRest, { exitTime: 100, percent: true });
  return f;
}
