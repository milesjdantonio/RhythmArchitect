// cassette.riv: a neon cassette for the song bank. Used for the preview player and the empty bank.
// State machine "Cassette": bool `playing` spins the reels and wobbles the tape;
// trigger `insert` slides the tape in from below.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, neonStroke } from '../helpers.mjs';

const TAU = Math.PI * 2;

export default function build() {
  const f = new RivFile();
  const W = 240, H = 160;
  const ab = f.artboard({ name: 'Cassette', width: W, height: H });
  const tape = ab.node(null, { name: 'tape', x: W / 2, y: H / 2 });

  const body = ab.shape(tape, { name: 'body' });
  ab.rect(body, { x: -104, y: -64, w: 208, h: 128, r: 12 });
  ab.gradFill(body, { start: [-104, -64], end: [104, 64], stops: [[0, '#2a1458'], [0.55, '#3b1670'], [1, '#5a1460']] });
  neonStroke(ab, body, COLORS.violet, 2, { glow: 10, coreAlpha: 0.35 });

  // Label with sunset stripes.
  const label = ab.shape(tape, { name: 'label' });
  ab.rect(label, { x: -88, y: -52, w: 176, h: 70, r: 6 });
  ab.fill(label, '#f6e9ff');
  [[COLORS.sun, -46], [COLORS.orange, -40], [COLORS.pink, -34], [COLORS.violet, -28]].forEach(([c, y]) => {
    const s = ab.shape(tape);
    ab.rect(s, { x: -88, y, w: 176, h: 4 });
    ab.fill(s, c);
  });

  // Window.
  const win = ab.shape(tape, { name: 'window' });
  ab.rect(win, { x: -58, y: -18, w: 116, h: 32, r: 16 });
  ab.fill(win, COLORS.night);
  ab.stroke(win, '#ffffff', 1, { alpha: 0.25 });

  // Tape spools (dark discs that change size as it plays) and reels.
  const spoolL = ab.node(tape, { x: -34, y: -2 });
  const sl = ab.shape(spoolL); ab.ellipse(sl, { w: 30, h: 30 }); ab.fill(sl, '#3a1a2a');
  const spoolR = ab.node(tape, { x: 34, y: -2 });
  const sr = ab.shape(spoolR); ab.ellipse(sr, { w: 22, h: 22 }); ab.fill(sr, '#3a1a2a');
  const reels = [-34, 34].map((x, i) => {
    const node = ab.node(tape, { name: `reel${i}`, x, y: -2 });
    const hub = ab.shape(node);
    ab.ellipse(hub, { w: 16, h: 16 });
    ab.fill(hub, '#ffffff');
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const tooth = ab.shape(node);
      ab.rect(tooth, { x: Math.cos(a) * 5 - 1.5, y: Math.sin(a) * 5 - 1.5, w: 3, h: 3, r: 1 });
      ab.fill(tooth, COLORS.night);
    }
    return node;
  });

  // Bottom trapezoid with screw holes.
  const foot = ab.shape(tape);
  ab.path(foot, [[-70, 64], [-60, 34], [60, 34], [70, 64]], { radius: 4 });
  ab.fill(foot, '#22104a');
  for (const x of [-40, 40]) {
    const h = ab.shape(tape); ab.ellipse(h, { x, y: 50, w: 8, h: 8 }); ab.fill(h, COLORS.night);
  }

  const stopped = ab.animation('stopped', { duration: 1 });
  for (const r of reels) stopped.key(r, 'rotation', [[0, 0, 'hold']]);
  const play = ab.animation('playing', { duration: 120, loop: 1 });
  play.key(reels[0], 'rotation', [[0, 0, EASE.linear], [120, TAU * 2]]);
  play.key(reels[1], 'rotation', [[0, 0, EASE.linear], [120, TAU * 2]]);
  play.key(spoolL, 'scaleX', [[0, 1, EASE.inOut], [60, 0.94, EASE.inOut], [120, 1]]);
  play.key(spoolL, 'scaleY', [[0, 1, EASE.inOut], [60, 0.94, EASE.inOut], [120, 1]]);
  play.key(spoolR, 'scaleX', [[0, 1, EASE.inOut], [60, 1.08, EASE.inOut], [120, 1]]);
  play.key(spoolR, 'scaleY', [[0, 1, EASE.inOut], [60, 1.08, EASE.inOut], [120, 1]]);
  play.key(tape, 'rotation', [[0, -0.012, EASE.inOut], [30, 0.012, EASE.inOut], [60, -0.012, EASE.inOut], [90, 0.012, EASE.inOut], [120, -0.012]]);

  const rest = ab.animation('rest', { duration: 1 });
  rest.key(tape, 'y', [[0, H / 2, 'hold']]);
  const insert = ab.animation('insert', { duration: 40 });
  insert.key(tape, 'y', [[0, H + 80, EASE.back], [36, H / 2]]);
  insert.key(tape, 'opacity', [[0, 0, EASE.out], [16, 1]]);

  const sm = ab.stateMachine('Cassette');
  const playing = sm.bool('playing', false);
  const onInsert = sm.trigger('insert');
  const main = sm.layer('Reels');
  const sStop = main.state(stopped), sPlay = main.state(play);
  main.transition(main.entry, sStop);
  main.transition(sStop, sPlay, { conditions: [{ input: playing, value: true }] });
  main.transition(sPlay, sStop, { conditions: [{ input: playing, value: false }] });
  const fx = sm.layer('Insert');
  const sRest = fx.state(rest), sIn = fx.state(insert);
  fx.transition(fx.entry, sRest);
  fx.transition(sRest, sIn, { conditions: [{ input: onInsert }] });
  fx.transition(sIn, sRest, { exitTime: 100, percent: true });
  return f;
}
