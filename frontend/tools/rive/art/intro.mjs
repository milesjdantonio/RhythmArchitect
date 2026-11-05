// intro.riv: the title screen when the game starts. Sixty motes of light fly in from the dark and
// settle into an orbit, two rings draw themselves around a core that blooms open, and four
// pillars of light rise for the four lanes. Then it waits, alive: the orbit turns, arcs of light
// run round the rings, the core breathes, the pillars shimmer in turn.
// The title is not in this file: the intro screen lays wordmark.riv over the space below the orbit
// (src/intro/Intro.tsx), so that on the way in it can fly to its place on the menu.
// State machine "Intro":
//   trigger `lane0`..`lane3` — D F J K: that pillar flares and bursts at its foot
//   trigger `tap`            — the core flares and a shockwave rolls out
//   trigger `go`             — the way in: rings fly past, motes stream outward, the pillars shoot up and fade

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

const TAU = Math.PI * 2;
const W = 800, H = 640;
const CX = 400, CY = 236;
const LANE_COLORS = [COLORS.cyan, COLORS.violet, COLORS.pink, COLORS.sun];
const laneX = (l) => CX + (l - 1.5) * 96;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Intro', width: W, height: H });
  const rand = seeded(1031);

  // Pillars of light, one per lane, rising from the bottom edge.
  const pillars = LANE_COLORS.map((color, l) => {
    const node = ab.node(null, { name: `pillar${l}`, x: laneX(l), y: H });
    const s = ab.shape(node);
    ab.rect(s, { x: -26, y: -H, w: 52, h: H });
    ab.gradFill(s, { start: [0, -H], end: [0, 0], stops: [[0, `${color}00`], [0.6, `${color}1a`], [1, `${color}55`]] });
    const line = ab.shape(node);
    ab.rect(line, { x: -0.75, y: -H * 0.8, w: 1.5, h: H * 0.8 });
    ab.gradFill(line, { start: [0, -H * 0.8], end: [0, 0], stops: [[0, '#ffffff00'], [1, '#ffffffaa']] });
    // The flare for a key press: a bright column and a burst at the foot.
    const flash = ab.node(node, { name: `flash${l}` });
    const col = ab.shape(flash);
    ab.rect(col, { x: -30, y: -H, w: 60, h: H });
    ab.gradFill(col, { start: [0, -H], end: [0, 0], stops: [[0, `${color}00`], [0.5, `${color}55`], [1, '#ffffffdd']] });
    const burst = ab.node(node, { name: `burst${l}`, y: -24 });
    const b = ab.shape(burst);
    ab.ellipse(b, { w: 110, h: 34 });
    ab.feather(ab.fill(b, color, { alpha: 0.95 }), 14);
    const bc = ab.shape(burst);
    ab.ellipse(bc, { w: 54, h: 6 });
    ab.fill(bc, '#ffffff');
    return { node, flash, burst, color };
  });

  // Rings around the core, drawn on with trim paths; an arc of light runs round each.
  const ringDefs = [{ r: 172, color: COLORS.cyan, w: 1.4 }, { r: 120, color: COLORS.violet, w: 1.2 }];
  const rings = ringDefs.map((d, i) => {
    const node = ab.node(null, { name: `ring${i}`, x: CX, y: CY });
    const s = ab.shape(node);
    ab.ellipse(s, { w: d.r * 2, h: d.r * 2 });
    // Glows are layered plain strokes, not feathers: the way in scales the rings across the whole
    // screen, and a feather that size costs hundreds of ms a frame on the canvas renderer.
    const haloWide = ab.stroke(s, d.color, d.w * 7, { alpha: 0.1 });
    const halo = ab.stroke(s, d.color, d.w * 3.2, { alpha: 0.22 });
    const line = ab.stroke(s, d.color, d.w, { alpha: 0.85 });
    const trims = [haloWide, halo, line].map((p) => ab.trim(p, { end: 0 }));
    const arcS = ab.shape(node);
    ab.ellipse(arcS, { w: d.r * 2, h: d.r * 2 });
    const arc = ab.stroke(arcS, '#ffffff', d.w * 2.2);
    const arcWide = ab.stroke(arcS, d.color, d.w * 9, { alpha: 0.22 });
    const arcHalo = ab.stroke(arcS, d.color, d.w * 4.5, { alpha: 0.45 });
    const arcTrims = [arc, arcHalo, arcWide].map((p) => ab.trim(p, { start: 0, end: 0.09, offset: i * 0.5 }));
    return { node, trims, arcTrims };
  });

  // Motes: fly in from far away to an orbit round the core.
  const spin = ab.node(null, { name: 'spin', x: CX, y: CY });
  const MOTES = 60;
  const motes = Array.from({ length: MOTES }, (_, i) => {
    const a = (i / MOTES) * TAU;
    const r = 146 + (i % 3) * 6;
    const far = 420 + rand() * 260, fa = a + (rand() - 0.5) * 1.6;
    const node = ab.node(spin, { name: `mote${i}`, x: Math.cos(fa) * far, y: Math.sin(fa) * far });
    const s = ab.shape(node);
    const big = i % 6 === 0;
    const d = big ? 7 : 3 + rand() * 2.5;
    ab.ellipse(s, { w: d, h: d });
    const color = LANE_COLORS[i % 4];
    if (big) ab.feather(ab.fill(s, color, { alpha: 0.9 }), 6);
    ab.fill(s, big ? '#ffffff' : color);
    return { node, from: [Math.cos(fa) * far, Math.sin(fa) * far], to: [Math.cos(a) * r, Math.sin(a) * r], out: [Math.cos(a) * r * 3.4, Math.sin(a) * r * 3.4], delay: Math.round(rand() * 40) };
  });

  // The core: grows open (main), flares on a tap (tap layer).
  const flare = ab.node(null, { name: 'flare', x: CX, y: CY });
  const grow = ab.node(flare, { name: 'grow' });
  const halo = ab.shape(grow);
  ab.ellipse(halo, { w: 220, h: 220 });
  ab.gradFill(halo, { kind: 'radial', start: [0, 0], end: [110, 0], stops: [[0, `${COLORS.cyan}99`], [0.3, `${COLORS.cyan}55`], [0.62, `${COLORS.cyan}18`], [1, `${COLORS.cyan}00`]] });
  // The tap flare: a white-hot bloom over the core.
  const hot = ab.node(flare, { name: 'hot', opacity: 0 });
  const hotS = ab.shape(hot);
  ab.ellipse(hotS, { w: 200, h: 200 });
  ab.gradFill(hotS, { kind: 'radial', start: [0, 0], end: [100, 0], stops: [[0, '#ffffffee'], [0.3, '#ffffff88'], [1, '#ffffff00']] });
  const orb = ab.shape(grow);
  ab.ellipse(orb, { w: 58, h: 58 });
  ab.gradFill(orb, { kind: 'radial', start: [-8, -10], end: [30, 30], stops: [[0, '#ffffff'], [0.4, COLORS.cyan], [1, COLORS.violet]] });
  const shock = ab.node(null, { name: 'shock', x: CX, y: CY });
  const shockS = ab.shape(shock);
  ab.ellipse(shockS, { w: 120, h: 120 });
  ab.stroke(shockS, COLORS.cyan, 12, { alpha: 0.14 });
  ab.stroke(shockS, COLORS.cyan, 5, { alpha: 0.3 });
  ab.stroke(shockS, '#ffffff', 1.5);

  // ---------- Main: build, then wait, then the way in ----------
  const BUILD = 150;
  const buildA = ab.animation('build', { duration: BUILD });
  for (const m of motes) {
    const d = m.delay;
    buildA.key(m.node, 'x', [[0, m.from[0], 'hold'], [d, m.from[0], EASE.out], [d + 80, m.to[0]]]);
    buildA.key(m.node, 'y', [[0, m.from[1], 'hold'], [d, m.from[1], EASE.out], [d + 80, m.to[1]]]);
    buildA.key(m.node, 'opacity', [[0, 0, 'hold'], [d, 0, EASE.out], [d + 30, 1]]);
  }
  rings.forEach((r, i) => {
    for (const t of r.trims) buildA.key(t, 'end', [[0, 0, 'hold'], [16 + i * 14, 0, EASE.inOut], [76 + i * 14, 1]]);
    for (const t of r.arcTrims) buildA.key(t, 'offset', [[0, i * 0.5, EASE.linear], [BUILD, i * 0.5 + 0.12]]);
    buildA.key(r.node, 'scaleX', [[0, 1, 'hold']]);
    buildA.key(r.node, 'scaleY', [[0, 1, 'hold']]);
    buildA.key(r.node, 'opacity', [[0, 1, 'hold']]);
  });
  buildA.key(spin, 'rotation', [[0, -0.6, EASE.out], [BUILD, 0]]);
  buildA.key(grow, 'scaleX', [[0, 0, 'hold'], [34, 0, EASE.back], [84, 1]]);
  buildA.key(grow, 'scaleY', [[0, 0, 'hold'], [34, 0, EASE.back], [84, 1]]);
  pillars.forEach((p, l) => {
    buildA.key(p.node, 'opacity', [[0, 0, 'hold'], [80 + l * 12, 0, EASE.out], [116 + l * 12, 1]]);
    buildA.key(p.node, 'scaleY', [[0, 0.2, 'hold'], [80 + l * 12, 0.2, EASE.out], [126 + l * 12, 1]]);
  });

  const IDLE = 1200;
  const idle = ab.animation('idle', { duration: IDLE, loop: 1 });
  for (const m of motes) {
    idle.key(m.node, 'x', [[0, m.to[0], 'hold']]);
    idle.key(m.node, 'y', [[0, m.to[1], 'hold']]);
    idle.key(m.node, 'opacity', [[0, 1, 'hold']]);
  }
  idle.key(spin, 'rotation', [[0, 0, EASE.linear], [IDLE, TAU]]);
  rings.forEach((r, i) => {
    for (const t of r.trims) idle.key(t, 'end', [[0, 1, 'hold']]);
    for (const t of r.arcTrims) idle.key(t, 'offset', [[0, i * 0.5 + 0.12, EASE.linear], [IDLE, i * 0.5 + 0.12 + (i ? -2 : 3)]]);
    idle.key(r.node, 'scaleX', [[0, 1, 'hold']]);
    idle.key(r.node, 'scaleY', [[0, 1, 'hold']]);
    idle.key(r.node, 'opacity', [[0, 1, 'hold']]);
  });
  const breath = [0, 150, 300, 450, 600, 750, 900, 1050, 1200].map((t, k) => [t, k % 2 ? 1.08 : 1, EASE.inOut]);
  idle.key(grow, 'scaleX', breath);
  idle.key(grow, 'scaleY', breath);
  pillars.forEach((p, l) => {
    const pts = [[0, 0.7, EASE.inOut]];
    for (let t = 60; t <= IDLE; t += 60) pts.push([t, (Math.round(t / 60) + l) % 4 === 0 ? 1 : 0.62, EASE.inOut]);
    idle.key(p.node, 'opacity', pts);
    idle.key(p.node, 'scaleY', [[0, 1, 'hold']]);
  });

  // The way in (about one second, in step with the title's flight to the menu): the orbit spins
  // up as its motes stream outward past the camera, the rings fly past (the inner one first), the
  // core swells and then folds to a point, and the pillars shoot up into the sky and fade.
  const OUT = 60;
  const outro = ab.animation('outro', { duration: OUT });
  for (const m of motes) {
    const d = Math.round(m.delay / 8);
    outro.key(m.node, 'x', [[0, m.to[0], 'hold'], [d, m.to[0], EASE.in], [OUT - 8 + d / 2, m.out[0]]]);
    outro.key(m.node, 'y', [[0, m.to[1], 'hold'], [d, m.to[1], EASE.in], [OUT - 8 + d / 2, m.out[1]]]);
    outro.key(m.node, 'opacity', [[0, 1, 'hold'], [d + 10, 1, EASE.in], [OUT - 8 + d / 2, 0]]);
  }
  outro.key(spin, 'rotation', [[0, 0, EASE.in], [OUT, 0.9]]);
  rings.forEach((r, i) => {
    const s = [[0, 1, EASE.out], [8, 0.94, EASE.in], [OUT - 4 * i, 3.6 + i * 1.2]];
    outro.key(r.node, 'scaleX', s);
    outro.key(r.node, 'scaleY', s);
    outro.key(r.node, 'opacity', [[0, 1, 'hold'], [12, 1, EASE.in], [OUT - 4 * i, 0]]);
  });
  outro.key(grow, 'scaleX', [[0, 1, EASE.out], [12, 1.7, EASE.inOut], [OUT - 6, 0]]);
  outro.key(grow, 'scaleY', [[0, 1, EASE.out], [12, 1.7, EASE.inOut], [OUT - 6, 0]]);
  pillars.forEach((p, l) => {
    const d = [3, 0, 1, 4][l];
    outro.key(p.node, 'scaleY', [[0, 1, 'hold'], [d, 1, EASE.out], [d + 26, 1.6, EASE.in], [OUT, 1.9]]);
    outro.key(p.node, 'opacity', [[0, 1, 'hold'], [d + 14, 1, EASE.in], [OUT - 4, 0]]);
  });

  // ---------- Tap: the core flares and a shockwave rolls out ----------
  const tap = ab.animation('tap', { duration: 40 });
  tap.key(flare, 'scaleX', [[0, 1.35, EASE.out], [40, 1]]);
  tap.key(flare, 'scaleY', [[0, 1.35, EASE.out], [40, 1]]);
  tap.key(hot, 'opacity', [[0, 1, EASE.out], [40, 0]]);
  tap.key(shock, 'scaleX', [[0, 0.6, EASE.out], [40, 4.2]]);
  tap.key(shock, 'scaleY', [[0, 0.6, EASE.out], [40, 4.2]]);
  tap.key(shock, 'opacity', [[0, 1, EASE.out], [40, 0]]);
  const tapRest = ab.animation('tap-rest', { duration: 1 });
  tapRest.key(flare, 'scaleX', [[0, 1, 'hold']]);
  tapRest.key(flare, 'scaleY', [[0, 1, 'hold']]);
  tapRest.key(hot, 'opacity', [[0, 0, 'hold']]);
  tapRest.key(shock, 'opacity', [[0, 0, 'hold']]);

  // ---------- Lanes: D F J K ----------
  const laneAnims = pillars.map((p, l) => {
    const on = ab.animation(`lane${l}`, { duration: 34 });
    on.key(p.flash, 'opacity', [[0, 1, EASE.out], [34, 0]]);
    on.key(p.flash, 'scaleX', [[0, 1.3, EASE.out], [34, 0.8]]);
    on.key(p.burst, 'opacity', [[0, 1, EASE.out], [30, 0]]);
    on.key(p.burst, 'scaleX', [[0, 0.5, EASE.out], [30, 1.8]]);
    on.key(p.burst, 'scaleY', [[0, 0.5, EASE.out], [30, 1.8]]);
    const off = ab.animation(`lane${l}-rest`, { duration: 1 });
    off.key(p.flash, 'opacity', [[0, 0, 'hold']]);
    off.key(p.burst, 'opacity', [[0, 0, 'hold']]);
    return { on, off };
  });

  const sm = ab.stateMachine('Intro');
  const go = sm.trigger('go');
  const onTap = sm.trigger('tap');
  const laneInputs = [0, 1, 2, 3].map((l) => sm.trigger(`lane${l}`));

  const main = sm.layer('Main');
  const sBuild = main.state(buildA), sIdle = main.state(idle), sOut = main.state(outro);
  main.transition(main.entry, sBuild);
  main.transition(sBuild, sIdle, { exitTime: 100, percent: true });
  main.transition(sBuild, sOut, { conditions: [{ input: go }] });
  main.transition(sIdle, sOut, { conditions: [{ input: go }] });

  const tl = sm.layer('Tap');
  const tRest = tl.state(tapRest), tA = tl.state(tap), tB = tl.state(tap);
  tl.transition(tl.entry, tRest);
  tl.transition(tRest, tA, { conditions: [{ input: onTap }] });
  tl.transition(tA, tB, { conditions: [{ input: onTap }] });
  tl.transition(tB, tA, { conditions: [{ input: onTap }] });
  tl.transition(tA, tRest, { exitTime: 100, percent: true });
  tl.transition(tB, tRest, { exitTime: 100, percent: true });

  laneAnims.forEach(({ on, off }, l) => {
    const ly = sm.layer(`Lane${l}`);
    const r = ly.state(off), a = ly.state(on), b = ly.state(on);
    ly.transition(ly.entry, r);
    ly.transition(r, a, { conditions: [{ input: laneInputs[l] }] });
    ly.transition(a, b, { conditions: [{ input: laneInputs[l] }] });
    ly.transition(b, a, { conditions: [{ input: laneInputs[l] }] });
    ly.transition(a, r, { exitTime: 100, percent: true });
    ly.transition(b, r, { exitTime: 100, percent: true });
  });
  return f;
}
