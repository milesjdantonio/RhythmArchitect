// attract.riv: the gameplay side before a song is picked. A core of light with four tilted
// orbits of dots turning around it at different speeds, over four lanes in perspective where
// tiles fall and burst on the hit line, so the screen hints at what is coming.
// State machine "Attract": bool `active` (the player is typing: the orbits turn faster),
// trigger `pulse` (a key press: the core flares and the orbits swell).

import { RivFile, EASE } from '../riv.mjs';
import { COLORS } from '../helpers.mjs';

const TAU = Math.PI * 2;
const W = 640, H = 560;
const CX = 320, CY = 210;
const LOOP = 240;

// Lanes in perspective: they meet near the core and open toward the bottom.
const TOP = 300, BOTTOM = 548, HIT = 500;
const persp = (y) => 0.12 + 0.88 * ((y - TOP) / (BOTTOM - TOP));
const laneEdge = (i, y) => CX + (140 + i * 90 - CX) * persp(y); // i = 0..4
const laneMid = (l, y) => CX + (185 + l * 90 - CX) * persp(y);
const LANE_COLORS = [COLORS.cyan, COLORS.violet, COLORS.pink, COLORS.sun];

export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Attract', width: W, height: H });

  // Lanes: a soft column of light each, hairline separators, and the hit line.
  const laneGlows = LANE_COLORS.map((color, l) => {
    const s = ab.shape(null, { name: `lane${l}` });
    ab.path(s, [[laneEdge(l, TOP), TOP], [laneEdge(l + 1, TOP), TOP], [laneEdge(l + 1, BOTTOM), BOTTOM], [laneEdge(l, BOTTOM), BOTTOM]]);
    ab.gradFill(s, { start: [0, TOP], end: [0, BOTTOM], stops: [[0, `${color}00`], [0.7, `${color}30`], [1, `${color}66`]] });
    return s;
  });
  for (let i = 0; i <= 4; i++) {
    const s = ab.shape(null, { name: `sep${i}` });
    ab.path(s, [[laneEdge(i, TOP), TOP], [laneEdge(i, BOTTOM), BOTTOM]], { closed: false });
    ab.stroke(s, i === 0 || i === 4 ? COLORS.cyan : '#ffffff', i === 0 || i === 4 ? 1.4 : 0.8, { alpha: i === 0 || i === 4 ? 0.55 : 0.14 });
  }
  const hit = ab.shape(null, { name: 'hitline' });
  ab.path(hit, [[laneEdge(0, HIT) - 6, HIT], [laneEdge(4, HIT) + 6, HIT]], { closed: false });
  ab.feather(ab.stroke(hit, COLORS.cyan, 8, { alpha: 0.6 }), 8);
  ab.stroke(hit, '#ffffff', 1.4, { alpha: 0.9 });

  // Lane flashes and tiles.
  const flashes = LANE_COLORS.map((color, l) => {
    const node = ab.node(null, { name: `flash${l}`, x: laneMid(l, HIT), y: HIT });
    const s = ab.shape(node);
    ab.ellipse(s, { w: 90, h: 34 });
    ab.feather(ab.fill(s, color, { alpha: 0.9 }), 16);
    const core = ab.shape(node);
    ab.ellipse(core, { w: 40, h: 8 });
    ab.fill(core, '#ffffff', { alpha: 0.9 });
    return node;
  });
  const pattern = [0, 2, 1, 3, 1, 0, 3, 2];
  const FALL = 56;
  const tiles = pattern.map((l, i) => {
    const node = ab.node(null, { name: `tile${i}`, x: laneMid(l, TOP + 6), y: TOP + 6 });
    const glow = ab.shape(node);
    ab.rect(glow, { x: -34, y: -8, w: 68, h: 16, r: 4 });
    ab.feather(ab.fill(glow, LANE_COLORS[l], { alpha: 0.8 }), 10);
    const s = ab.shape(node);
    ab.rect(s, { x: -30, y: -6, w: 60, h: 12, r: 3 });
    ab.gradFill(s, { start: [0, -6], end: [0, 6], stops: [[0, '#ffffff'], [0.45, LANE_COLORS[l]], [1, LANE_COLORS[l]]] });
    return { node, lane: l, hitAt: FALL + i * 22 };
  });

  // Orbits: an outer node squashes each ring into a tilted ellipse, an inner one turns it.
  const ORBITS = [
    { r: 70, n: 18, color: COLORS.cyan, tilt: 0.36, size: 6 },
    { r: 112, n: 28, color: COLORS.violet, tilt: 0.42, size: 5.4 },
    { r: 158, n: 40, color: COLORS.pink, tilt: 0.47, size: 4.8 },
    { r: 208, n: 54, color: COLORS.cyan, tilt: 0.52, size: 4 },
  ];
  const orbits = ORBITS.map((o, k) => {
    const outer = ab.node(null, { name: `orbit${k}`, x: CX, y: CY, rotation: (k % 2 ? -1 : 1) * 0.18 });
    const squash = ab.node(outer, { name: `squash${k}`, scaleY: o.tilt });
    const spin = ab.node(squash, { name: `spin${k}` });
    for (let i = 0; i < o.n; i++) {
      const a = (i / o.n) * TAU;
      const big = i % 7 === 0;
      const s = ab.shape(spin);
      const d = big ? o.size * 2.2 : o.size * (0.6 + ((i * 37) % 10) / 14);
      ab.ellipse(s, { x: Math.cos(a) * o.r, y: Math.sin(a) * o.r, w: d, h: d });
      if (big) ab.feather(ab.fill(s, o.color, { alpha: 0.9 }), 6);
      ab.fill(s, big ? '#ffffff' : o.color, { alpha: big ? 1 : 0.75 });
    }
    return { outer, spin, dir: k % 2 ? -1 : 1, turns: k + 1 };
  });

  // The core: a breathing node (kicked by each tile) inside a flare node (kicked by `pulse`).
  const flare = ab.node(null, { name: 'flare', x: CX, y: CY });
  const breath = ab.node(flare, { name: 'breath' });
  const halo = ab.shape(breath);
  ab.ellipse(halo, { w: 120, h: 120 });
  const haloFill = ab.fill(halo, COLORS.cyan, { alpha: 0.55 });
  const haloFeather = ab.feather(haloFill, 34);
  const orb = ab.shape(breath);
  ab.ellipse(orb, { w: 46, h: 46 });
  ab.gradFill(orb, { kind: 'radial', start: [-6, -8], end: [24, 24], stops: [[0, '#ffffff'], [0.4, COLORS.cyan], [1, COLORS.violet]] });

  // ---- Play layer: tiles fall and burst; each hit lights its lane and kicks the core. ----
  const play = ab.animation('play', { duration: LOOP, loop: 1 });
  for (const t of tiles) {
    const s = t.hitAt - FALL;
    const fx = (y) => laneMid(t.lane, y);
    const sc = (y) => persp(y) / persp(HIT);
    const y0 = TOP + 6;
    play.key(t.node, 'y', [[0, y0, 'hold'], [s, y0, EASE.in], [t.hitAt, HIT]]);
    play.key(t.node, 'x', [[0, fx(y0), 'hold'], [s, fx(y0), EASE.in], [t.hitAt, fx(HIT)]]);
    play.key(t.node, 'scaleX', [[0, sc(y0), 'hold'], [s, sc(y0), EASE.in], [t.hitAt, 1]]);
    play.key(t.node, 'scaleY', [[0, sc(y0), 'hold'], [s, sc(y0), EASE.in], [t.hitAt, 1]]);
    play.key(t.node, 'opacity', [[0, 0, 'hold'], [s, 0, EASE.out], [s + 10, 1, 'hold'], [t.hitAt, 1, 'hold'], [t.hitAt + 1, 0, 'hold']]);
  }
  flashes.forEach((node, l) => {
    const hits = tiles.filter((t) => t.lane === l).map((t) => t.hitAt).sort((a, b) => a - b);
    const op = [[0, 0, 'hold']], sx = [[0, 0.6, 'hold']];
    for (const h of hits) {
      op.push([h, 0, 'hold'], [h + 1, 1, EASE.out], [h + 24, 0, 'hold']);
      sx.push([h, 0.6, 'hold'], [h + 1, 0.6, EASE.out], [h + 24, 1.6, 'hold']);
    }
    play.key(node, 'opacity', op);
    play.key(node, 'scaleX', sx);
    play.key(node, 'scaleY', sx);
    const glowOp = [[0, 0.55, 'hold']];
    for (const h of hits) glowOp.push([h, 0.55, 'hold'], [h + 1, 1, EASE.out], [h + 30, 0.55, 'hold']);
    play.key(laneGlows[l], 'opacity', glowOp);
  });
  const beats = [[0, 1, 'hold']];
  for (const t of tiles) beats.push([t.hitAt, 1, 'hold'], [t.hitAt + 1, 1.12, EASE.out], [t.hitAt + 20, 1, 'hold']);
  play.key(breath, 'scaleX', beats);
  play.key(breath, 'scaleY', beats);

  // ---- Orbit layer: the rings turn; faster while the player types. ----
  const orbit = ab.animation('orbit', { duration: 1200, loop: 1 });
  for (const o of orbits) orbit.key(o.spin, 'rotation', [[0, 0, EASE.linear], [1200, o.dir * TAU * (o.turns % 2 ? 1 : 2)]]);

  // ---- Pulse layer: a key press flares the core and swells the orbits. ----
  const pulse = ab.animation('pulse', { duration: 36 });
  pulse.key(flare, 'scaleX', [[0, 1.3, EASE.out], [36, 1]]);
  pulse.key(flare, 'scaleY', [[0, 1.3, EASE.out], [36, 1]]);
  pulse.key(haloFeather, 'strength', [[0, 60, EASE.out], [36, 34]]);
  pulse.key(haloFill, 'colorValue', [[0, '#ffffffe6', EASE.out], [36, `${COLORS.cyan}8c`]]);
  orbits.forEach((o, k) => {
    pulse.key(o.outer, 'scaleX', [[0, 1, 'hold'], [2 + k * 3, 1.08, EASE.out], [36, 1]]);
    pulse.key(o.outer, 'scaleY', [[0, 1, 'hold'], [2 + k * 3, 1.08, EASE.out], [36, 1]]);
  });
  const rest = ab.animation('rest', { duration: 1 });
  rest.key(flare, 'scaleX', [[0, 1, 'hold']]);
  rest.key(flare, 'scaleY', [[0, 1, 'hold']]);
  rest.key(haloFeather, 'strength', [[0, 34, 'hold']]);
  rest.key(haloFill, 'colorValue', [[0, `${COLORS.cyan}8c`, 'hold']]);

  // Entrance: everything fades up from the core.
  const sm = ab.stateMachine('Attract');
  const active = sm.bool('active', false);
  const onPulse = sm.trigger('pulse');

  const pl = sm.layer('Play');
  const sPlay = pl.state(play);
  pl.transition(pl.entry, sPlay);

  const ol = sm.layer('Orbit');
  const sCalm = ol.state(orbit, { speed: 1 }), sFast = ol.state(orbit, { speed: 2.6 });
  ol.transition(ol.entry, sCalm);
  ol.transition(sCalm, sFast, { conditions: [{ input: active, value: true }], duration: 300 });
  ol.transition(sFast, sCalm, { conditions: [{ input: active, value: false }], duration: 600 });

  const fx = sm.layer('Pulse');
  const sRest = fx.state(rest), a = fx.state(pulse), b = fx.state(pulse);
  fx.transition(fx.entry, sRest);
  fx.transition(sRest, a, { conditions: [{ input: onPulse }] });
  fx.transition(a, b, { conditions: [{ input: onPulse }] });
  fx.transition(b, a, { conditions: [{ input: onPulse }] });
  fx.transition(a, sRest, { exitTime: 100, percent: true });
  fx.transition(b, sRest, { exitTime: 100, percent: true });
  return f;
}
