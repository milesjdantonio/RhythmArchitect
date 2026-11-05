// wordmark.riv: "RYTHM / ARCHITECT" in thin Unbounded with wide tracking, drawn as paths (no font
// at runtime). The letters gather in from the middle and spread to their places as they fade in,
// then a slow wave of light travels along them. The intro screen shows this same file as its
// title and flies it to its place on the menu, where the menu's copy takes over.
// State machine "Wordmark":
//   trigger `beat`    — kicks both rows
//   bool    `settled` — skip the gather (the title has already arrived: it flew in from the intro)
//   trigger `flash`   — a wave of white light runs across the letters, left to right (the landing)

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, font, textContours } from '../helpers.mjs';

// Lays out a word letter by letter so each can move on its own. Returns [{ ch, cx, contours }],
// with contours relative to the letter's centre on the baseline.
function letters(text, size, tracking, cx, weight) {
  const f = font(weight);
  const scale = size / f.unitsPerEm;
  const glyphs = [...text].map((ch) => ({ ch, g: f.charToGlyph(ch) }));
  const widths = glyphs.map(({ g }) => g.advanceWidth * scale);
  const total = widths.reduce((a, b) => a + b, 0) + size * tracking * (glyphs.length - 1);
  let x = cx - total / 2;
  return glyphs.map(({ ch }, i) => {
    const w = widths[i];
    const centre = x + w / 2;
    x += w + size * tracking;
    const contours = textContours(ch, { size, cx: 0, baseline: 0, tracking: 0, weight });
    return { ch, cx: centre, contours };
  });
}

export default function build() {
  const f = new RivFile();
  const W = 720, H = 210;
  const ab = f.artboard({ name: 'Wordmark', width: W, height: H });

  const rows = [
    { text: 'RYTHM', size: 92, tracking: 0.2, baseline: 112, weight: 200, glow: COLORS.cyan },
    { text: 'ARCHITECT', size: 26, tracking: 0.66, baseline: 172, weight: 300, glow: COLORS.violet },
  ];
  const all = [];
  const rowNodes = rows.map((row, r) => {
    const rowNode = ab.node(null, { name: `row${r}`, x: W / 2, y: row.baseline - row.size * 0.36 });
    for (const L of letters(row.text, row.size, row.tracking, 0, row.weight)) {
      const node = ab.node(rowNode, { name: `L${r}${L.ch}`, x: L.cx, y: row.size * 0.36 });
      const halo = ab.shape(node, { name: 'halo' });
      for (const c of L.contours) ab.path(halo, c);
      const haloFill = ab.fill(halo, row.glow, { alpha: 0.75 });
      const feather = ab.feather(haloFill, r ? 8 : 14);
      const face = ab.shape(node, { name: 'face' });
      for (const c of L.contours) ab.path(face, c);
      ab.gradFill(face, { start: [0, -row.size * 0.75], end: [0, 0], stops: [[0, '#ffffff'], [0.6, COLORS.ink], [1, r ? COLORS.violet : COLORS.cyan]] });
      // The landing flash: the letter turns white-hot and swells, then cools back (no extra
      // feather: the halo below already glows, and feathers are costly on the canvas renderer).
      const flash = ab.node(node, { name: 'flash', opacity: 0 });
      const hot = ab.shape(flash);
      for (const c of L.contours) ab.path(hot, c);
      ab.fill(hot, '#ffffff');
      all.push({ node, flash, row: r, feather, x: L.cx, base: row.size * 0.36, g: r ? 8 : 14 });
    }
    return rowNode;
  });

  // Letters start bunched toward the middle and spread out as they appear.
  const intro = ab.animation('intro', { duration: 110 });
  all.forEach(({ node, base, x, row }, i) => {
    const d = row ? 30 + (i % 9) * 2 : Math.abs(i - 2) * 5;
    intro.key(node, 'x', [[0, x * 0.55, 'hold'], [d, x * 0.55, EASE.out], [d + 60, x]]);
    intro.key(node, 'y', [[0, base, 'hold']]);
    intro.key(node, 'opacity', [[0, 0, 'hold'], [d, 0, EASE.out], [d + 36, 1]]);
    intro.key(node, 'scaleX', [[0, 1, 'hold']]);
    intro.key(node, 'scaleY', [[0, 1, 'hold']]);
  });

  // A slow wave of light along the letters: each glow swells a little after the one before.
  const idle = ab.animation('idle', { duration: 300, loop: 1 });
  all.forEach(({ node, feather, base, x, g }, i) => {
    idle.key(node, 'x', [[0, x, 'hold']]);
    idle.key(node, 'opacity', [[0, 1, 'hold']]);
    idle.key(node, 'scaleX', [[0, 1, 'hold']]);
    idle.key(node, 'scaleY', [[0, 1, 'hold']]);
    const phase = (i * 22) % 300;
    const pts = [0, 75, 150, 225, 300].map((t) => {
      const v = Math.max(0, Math.sin(((t + phase) / 300) * Math.PI * 2));
      return [t, g * (1 + v * 1.6), EASE.inOut];
    });
    idle.key(feather, 'strength', pts);
    idle.key(node, 'y', [0, 150, 300].map((t, k) => [t, base + (k === 1 ? -2 : 0) * Math.sin(i), EASE.inOut]));
  });

  const beat = ab.animation('beat', { duration: 24 });
  rowNodes.forEach((n, r) => {
    beat.key(n, 'scaleX', [[0, r ? 1.02 : 1.035, EASE.out], [24, 1]]);
    beat.key(n, 'scaleY', [[0, r ? 1.02 : 1.035, EASE.out], [24, 1]]);
  });
  const rest = ab.animation('rest', { duration: 1 });
  rowNodes.forEach((n) => rest.key(n, 'scaleX', [[0, 1, 'hold']]));

  // The landing: a wave of light sweeps the letters from left to right, both rows at once.
  const FLASH = 84;
  const flash = ab.animation('flash', { duration: FLASH });
  all.forEach(({ flash: fl, x }) => {
    const d = Math.round(((x + 290) / 580) * 30);
    flash.key(fl, 'opacity', [[0, 0, 'hold'], [d, 0, EASE.out], [d + 6, 1, EASE.inOut], [d + 48, 0]]);
    flash.key(fl, 'scaleX', [[0, 1, 'hold'], [d, 1, EASE.out], [d + 6, 1.07, EASE.inOut], [d + 40, 1]]);
    flash.key(fl, 'scaleY', [[0, 1, 'hold'], [d, 1, EASE.out], [d + 6, 1.07, EASE.inOut], [d + 40, 1]]);
  });
  const flashRest = ab.animation('flash-rest', { duration: 1 });
  all.forEach(({ flash: fl }) => flashRest.key(fl, 'opacity', [[0, 0, 'hold']]));

  const sm = ab.stateMachine('Wordmark');
  const onBeat = sm.trigger('beat');
  const settled = sm.bool('settled', false);
  const onFlash = sm.trigger('flash');
  const main = sm.layer('Main');
  const sIntro = main.state(intro), sIdle = main.state(idle);
  main.transition(main.entry, sIntro);
  main.transition(sIntro, sIdle, { conditions: [{ input: settled, value: true }] });
  main.transition(sIntro, sIdle, { exitTime: 100, percent: true });
  const fl = sm.layer('Flash');
  const fRest = fl.state(flashRest), fA = fl.state(flash), fB = fl.state(flash);
  fl.transition(fl.entry, fRest);
  fl.transition(fRest, fA, { conditions: [{ input: onFlash }] });
  fl.transition(fA, fB, { conditions: [{ input: onFlash }] });
  fl.transition(fB, fA, { conditions: [{ input: onFlash }] });
  fl.transition(fA, fRest, { exitTime: 100, percent: true });
  fl.transition(fB, fRest, { exitTime: 100, percent: true });
  const fx = sm.layer('Beat');
  const sRest = fx.state(rest), a = fx.state(beat), b = fx.state(beat);
  fx.transition(fx.entry, sRest);
  fx.transition(sRest, a, { conditions: [{ input: onBeat }] });
  fx.transition(a, b, { conditions: [{ input: onBeat }] });
  fx.transition(b, a, { conditions: [{ input: onBeat }] });
  fx.transition(a, sRest, { exitTime: 100, percent: true });
  fx.transition(b, sRest, { exitTime: 100, percent: true });
  return f;
}
