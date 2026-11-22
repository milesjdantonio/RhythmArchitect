// drop.riv: the drop badge, on the right of the lanes while the song's drop plays through
// (components/play/DropFx.tsx). "DROP" in thin Unbounded with wide tracking over an equalizer
// of slanted bars, all in the house's light. It stays alive the whole drop: the bars ripple, the
// letters' glow breathes, and every beat of the song kicks the bars up and the word out a touch.
// State machine "Drop":
//   bool    `on`   — the drop is playing: the letters slam in one after another, then it lives;
//                    off, it lifts away and fades
//   trigger `beat` — a beat of the song (the bars jump and fall, the word kicks)

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, font, mix, textContours } from '../helpers.mjs';

/** A word laid out letter by letter: [{ ch, cx, contours }], contours about each letter's centre on the baseline. */
function letters(text, size, tracking, weight) {
  const f = font(weight);
  const scale = size / f.unitsPerEm;
  const glyphs = [...text].map((ch) => f.charToGlyph(ch));
  const widths = glyphs.map((g) => g.advanceWidth * scale);
  const total = widths.reduce((a, b) => a + b, 0) + size * tracking * (glyphs.length - 1);
  let x = -total / 2;
  return [...text].map((ch, i) => {
    const centre = x + widths[i] / 2;
    x += widths[i] + size * tracking;
    return { ch, cx: centre, contours: textContours(ch, { size, cx: 0, baseline: 0, tracking: 0, weight }) };
  });
}

export default function build() {
  const f = new RivFile();
  const W = 300, H = 150;
  const ab = f.artboard({ name: 'Drop', width: W, height: H });
  const root = ab.node(null, { name: 'root', x: W / 2, y: 0, opacity: 0 });

  // The word: a kick node (the beat layer scales it) over a row whose letters the main layer moves.
  const SIZE = 50, BASE = 70;
  const kick = ab.node(root, { name: 'kick', y: BASE - SIZE * 0.36 });
  const tints = [COLORS.cyan, COLORS.violet, COLORS.pink, COLORS.orange];
  const word = letters('DROP', SIZE, 0.34, 200).map((L, i) => {
    const node = ab.node(kick, { name: `L${L.ch}`, x: L.cx, y: SIZE * 0.36 });
    const halo = ab.shape(node, { name: 'halo' });
    for (const c of L.contours) ab.path(halo, c);
    const haloFill = ab.fill(halo, tints[i], { alpha: 0.6 });
    ab.feather(haloFill, 12);
    const face = ab.shape(node, { name: 'face' });
    for (const c of L.contours) ab.path(face, c);
    ab.gradFill(face, { start: [0, -SIZE * 0.75], end: [0, 0], stops: [[0, '#ffffff'], [0.55, COLORS.ink], [1, tints[i]]] });
    return { node, halo, haloFill, tint: tints[i] };
  });

  // A hairline under the word, lit from the middle out.
  const lineNode = ab.node(root, { name: 'line', y: BASE + 12, scaleX: 0 });
  const line = ab.shape(lineNode);
  ab.rect(line, { x: -118, y: -0.75, w: 236, h: 1.5 });
  ab.gradFill(line, { start: [-118, 0], end: [118, 0], stops: [[0, `${COLORS.cyan}00`], [0.5, '#ffffff'], [1, `${COLORS.pink}00`]] });

  // The equalizer: slanted bars standing on a baseline, ice to rose across. Each bar is a jump node
  // (the beat layer) holding a ripple node (the live loop), so the two multiply.
  const BARS = 16, EQ_Y = 142, BAR_W = 9, GAP = 5.5, TALL = 46;
  const x0 = -((BARS * BAR_W + (BARS - 1) * GAP) / 2) + BAR_W / 2;
  const bars = Array.from({ length: BARS }, (_, i) => {
    const t = i / (BARS - 1);
    const c = mix(mix(COLORS.cyan, COLORS.violet, Math.min(1, t * 2)), COLORS.pink, Math.max(0, t * 2 - 1));
    const jump = ab.node(root, { name: `jump${i}`, x: x0 + i * (BAR_W + GAP), y: EQ_Y, scaleY: 0.55 });
    const ripple = ab.node(jump, { name: `ripple${i}` });
    const glowS = ab.shape(ripple);
    ab.path(glowS, [[-BAR_W / 2 + 2, 0], [-BAR_W / 2 + 4, -TALL], [BAR_W / 2 + 2, -TALL], [BAR_W / 2, 0]], { radius: 1 });
    const glow = ab.fill(glowS, c, { alpha: 0.55 });
    ab.feather(glow, 8);
    const s = ab.shape(ripple);
    ab.path(s, [[-BAR_W / 2 + 2, 0], [-BAR_W / 2 + 4, -TALL], [BAR_W / 2 + 2, -TALL], [BAR_W / 2, 0]], { radius: 1 });
    ab.gradFill(s, { start: [0, -TALL], end: [0, 0], stops: [[0, '#ffffff'], [0.35, c], [1, mix(c, COLORS.deep, 0.55)]] });
    return { jump, ripple };
  });
  // Where each bar jumps to on a beat: a shape like a spectrum, the low end tallest, a little uneven.
  const peaks = bars.map((_, i) => {
    const t = i / (BARS - 1);
    return 0.8 + 0.45 * Math.pow(1 - t, 0.7) * (0.75 + 0.25 * Math.cos(i * 2.3));
  });

  // ---- main layer ----
  const off = ab.animation('off', { duration: 1 });
  off.key(root, 'opacity', [[0, 0, 'hold']]);
  off.key(root, 'y', [[0, 0, 'hold']]);
  off.key(lineNode, 'scaleX', [[0, 0, 'hold']]);
  word.forEach((w) => { off.key(w.node, 'opacity', [[0, 0, 'hold']]); off.key(w.node, 'scaleY', [[0, 1, 'hold']]); });

  // In: the letters slam down one after another (tall and bright, settling), the line draws out.
  const IN = 40;
  const on = ab.animation('in', { duration: IN });
  on.key(root, 'opacity', [[0, 0, EASE.out], [6, 1]]);
  on.key(root, 'y', [[0, 0, 'hold']]);
  on.key(lineNode, 'scaleX', [[0, 0, 'hold'], [10, 0, EASE.out], [32, 1]]);
  word.forEach((w, i) => {
    const t0 = i * 5;
    on.key(w.node, 'opacity', [[0, 0, 'hold'], [t0, 0, EASE.out], [t0 + 4, 1]]);
    on.key(w.node, 'scaleY', [[0, 1.9, 'hold'], [t0, 1.9, EASE.back], [t0 + 14, 1]]);
    on.key(w.haloFill, 'colorValue', [[0, `${w.tint}00`, 'hold'], [t0, `${w.tint}ff`, EASE.out], [t0 + 22, `${w.tint}99`]]);
  });
  bars.forEach((b, i) => on.key(b.ripple, 'scaleY', [[0, 0, 'hold'], [8 + i, 0, EASE.back], [20 + i, 1]]));

  // Live: the bars ripple across, the letters' glow breathes (two seconds round, looped).
  const LIVE = 120;
  const live = ab.animation('live', { duration: LIVE, loop: 1 });
  live.key(root, 'opacity', [[0, 1, 'hold']]);
  live.key(root, 'y', [[0, 0, 'hold']]);
  live.key(lineNode, 'scaleX', [[0, 1, 'hold']]);
  word.forEach((w, i) => {
    live.key(w.node, 'opacity', [[0, 1, 'hold']]);
    live.key(w.node, 'scaleY', [[0, 1, 'hold']]);
    const ph = (i * 15) % LIVE;
    live.key(w.haloFill, 'colorValue', [[0, `${w.tint}88`, EASE.inOut], [ph + 30, `${w.tint}ee`, EASE.inOut], [ph + 70, `${w.tint}77`, EASE.inOut], [LIVE, `${w.tint}88`]]);
  });
  bars.forEach((b, i) => {
    const a = 0.6 + 0.25 * Math.sin(i * 0.9), z = 0.85 + 0.15 * Math.cos(i * 1.7);
    const p = Math.round((i / BARS) * 30);
    live.key(b.ripple, 'scaleY', [[0, z, EASE.inOut], [p + 15, a, EASE.inOut], [p + 45, 1, EASE.inOut], [p + 75, a * 0.8, EASE.inOut], [LIVE, z]]);
  });

  // Out: it lifts and fades, the bars sink.
  const OUT = 26;
  const out = ab.animation('out', { duration: OUT });
  out.key(root, 'opacity', [[0, 1, EASE.in], [OUT, 0]]);
  out.key(root, 'y', [[0, 0, EASE.in], [OUT, -14]]);
  out.key(lineNode, 'scaleX', [[0, 1, EASE.in], [18, 0]]);
  bars.forEach((b) => out.key(b.ripple, 'scaleY', [[0, 1, EASE.in], [16, 0]]));

  // ---- beat layer ----
  const rest = ab.animation('rest', { duration: 1 });
  rest.key(kick, 'scaleX', [[0, 1, 'hold']]);
  rest.key(kick, 'scaleY', [[0, 1, 'hold']]);
  bars.forEach((b) => rest.key(b.jump, 'scaleY', [[0, 0.55, 'hold']]));
  const BEAT = 22;
  const beat = ab.animation('beat', { duration: BEAT });
  beat.key(kick, 'scaleX', [[0, 1.07, EASE.out], [14, 1]]);
  beat.key(kick, 'scaleY', [[0, 1.12, EASE.out], [14, 1]]);
  bars.forEach((b, i) => beat.key(b.jump, 'scaleY', [[0, 0.55, EASE.out], [2, peaks[i], EASE.out], [BEAT, 0.55]]));

  const sm = ab.stateMachine('Drop');
  const isOn = sm.bool('on', false);
  const onBeat = sm.trigger('beat');
  const main = sm.layer('Main');
  const sOff = main.state(off), sIn = main.state(on), sLive = main.state(live), sOut = main.state(out);
  main.transition(main.entry, sOff);
  main.transition(sOff, sIn, { conditions: [{ input: isOn, value: true }] });
  main.transition(sIn, sLive, { exitTime: 100, percent: true });
  main.transition(sIn, sOut, { conditions: [{ input: isOn, value: false }] });
  main.transition(sLive, sOut, { conditions: [{ input: isOn, value: false }] });
  main.transition(sOut, sIn, { conditions: [{ input: isOn, value: true }] });
  main.transition(sOut, sOff, { exitTime: 100, percent: true });
  const fx = sm.layer('Beat');
  const sRest = fx.state(rest), b1 = fx.state(beat), b2 = fx.state(beat);
  fx.transition(fx.entry, sRest);
  fx.transition(sRest, b1, { conditions: [{ input: onBeat }] });
  fx.transition(b1, b2, { conditions: [{ input: onBeat }] });
  fx.transition(b2, b1, { conditions: [{ input: onBeat }] });
  fx.transition(b1, sRest, { exitTime: 100, percent: true });
  fx.transition(b2, sRest, { exitTime: 100, percent: true });
  return f;
}
