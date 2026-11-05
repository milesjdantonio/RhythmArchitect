// logo.riv: the Rythm Architect mark. A striped synthwave sun behind an architect's set square,
// with equalizer bars standing inside it like a skyline.
// State machine "Logo": bool `hover` makes the bars dance harder, trigger `beat` pulses the sun.

import { RivFile, EASE } from '../riv.mjs';
import { COLORS, neonStroke } from '../helpers.mjs';


export default function build() {
  const f = new RivFile();
  const ab = f.artboard({ name: 'Logo', width: 160, height: 160 });

  // Sun, in a pulse wrapper so `beat` and `hover` never key the same node.
  const pulse = ab.node(null, { name: 'pulse', x: 80, y: 74 });
  const sunNode = ab.node(pulse, { name: 'sun' });
  const glow = ab.shape(sunNode, { name: 'sunGlow' });
  ab.ellipse(glow, { w: 96, h: 96 });
  const glowFill = ab.fill(glow, COLORS.pink, { alpha: 0.55 });
  const glowFeather = ab.feather(glowFill, 18);
  const sun = ab.shape(sunNode, { name: 'sunDisc' });
  ab.ellipse(sun, { w: 88, h: 88 });
  ab.gradFill(sun, { start: [0, -44], end: [0, 44], stops: [[0, COLORS.sun], [0.55, COLORS.orange], [1, COLORS.pink]] });
  // Horizontal cuts across the lower half, thicker towards the bottom.
  [[6, 2], [16, 3], [26, 4.5], [36, 6]].forEach(([y, h], i) => {
    const cut = ab.shape(sunNode, { name: `cut${i}` });
    ab.rect(cut, { x: -50, y, w: 100, h });
    ab.fill(cut, COLORS.night);
  });

  // Set square.
  const tri = ab.shape(null, { name: 'square' });
  ab.path(tri, [[80, 16], [146, 136], [14, 136]], { closed: true });
  const neon = neonStroke(ab, tri, COLORS.cyan, 4, { glow: 10 });
  const trims = [neon.halo, neon.line, neon.hot].map((s) => ab.trim(s, { end: 0 }));

  // Equalizer bars, standing on the square's base.
  const heights = [16, 30, 46, 52, 38, 22];
  const bars = heights.map((h, i) => {
    const node = ab.node(null, { name: `bar${i}`, x: 47 + i * 13.2, y: 128 });
    const s = ab.shape(node);
    ab.rect(s, { x: -4.5, y: -h, w: 9, h, r: 2.5 });
    ab.gradFill(s, { start: [0, -h], end: [0, 0], stops: [[0, COLORS.ink], [0.25, COLORS.sun], [1, COLORS.magenta]] });
    return node;
  });

  const intro = ab.animation('intro', { duration: 72 });
  for (const t of trims) intro.key(t, 'end', [[0, 0, EASE.inOut], [42, 1]]);
  intro.key(sunNode, 'scaleX', [[0, 0.4, EASE.back], [34, 1]]);
  intro.key(sunNode, 'scaleY', [[0, 0.4, EASE.back], [34, 1]]);
  intro.key(sunNode, 'opacity', [[0, 0, EASE.out], [24, 1]]);
  bars.forEach((b, i) => b && intro.key(b, 'scaleY', [[0, 0, 'hold'], [18 + i * 5, 0, EASE.back], [40 + i * 5, 1]]));

  // Bars bounce out of phase; hover runs the same dance faster and taller.
  const dance = (name, frames, amp) => {
    const a = ab.animation(name, { duration: frames, loop: 1 });
    for (const t of trims) a.key(t, 'end', [[0, 1, 'hold']]);
    a.key(sunNode, 'opacity', [[0, 1, 'hold']]);
    a.key(sunNode, 'scaleX', [[0, 1, EASE.inOut], [frames / 2, 1 + amp * 0.08, EASE.inOut], [frames, 1]]);
    a.key(sunNode, 'scaleY', [[0, 1, EASE.inOut], [frames / 2, 1 + amp * 0.08, EASE.inOut], [frames, 1]]);
    bars.forEach((b, i) => {
      const seq = [1, 1 - 0.35 * amp, 1 + 0.12 * amp, 1 - 0.5 * amp, 1];
      const shift = i % 2 ? 1 : 0;
      const vals = shift ? [seq[0], seq[3], seq[2], seq[1], seq[4]] : seq;
      a.key(b, 'scaleY', vals.map((v, k) => [Math.round((k * frames) / 4), Math.max(0.2, v), EASE.inOut]));
    });
    return a;
  };
  const idle = dance('idle', 120, 0.6);
  const hover = dance('hover', 44, 1);

  const beat = ab.animation('beat', { duration: 18 });
  beat.key(pulse, 'scaleX', [[0, 1.14, EASE.out], [18, 1]]);
  beat.key(pulse, 'scaleY', [[0, 1.14, EASE.out], [18, 1]]);
  beat.key(glowFeather, 'strength', [[0, 30, EASE.out], [18, 18]]);
  beat.key(glowFill, 'colorValue', [[0, `${COLORS.sun}cc`, EASE.out], [18, `${COLORS.pink}8c`]]);
  const rest = ab.animation('rest', { duration: 1 });
  rest.key(pulse, 'scaleX', [[0, 1, 'hold']]);

  const sm = ab.stateMachine('Logo');
  const isHover = sm.bool('hover', false);
  const onBeat = sm.trigger('beat');
  const main = sm.layer('Main');
  const sIntro = main.state(intro), sIdle = main.state(idle), sHover = main.state(hover);
  main.transition(main.entry, sIntro);
  main.transition(sIntro, sIdle, { exitTime: 100, percent: true });
  main.transition(sIdle, sHover, { conditions: [{ input: isHover, value: true }], duration: 200 });
  main.transition(sHover, sIdle, { conditions: [{ input: isHover, value: false }], duration: 300 });

  const fx = sm.layer('Beat');
  const sRest = fx.state(rest), sBeatA = fx.state(beat), sBeatB = fx.state(beat);
  fx.transition(fx.entry, sRest);
  // Two copies of the beat state so back-to-back beats restart the pulse.
  fx.transition(sRest, sBeatA, { conditions: [{ input: onBeat }] });
  fx.transition(sBeatA, sBeatB, { conditions: [{ input: onBeat }] });
  fx.transition(sBeatB, sBeatA, { conditions: [{ input: onBeat }] });
  fx.transition(sBeatA, sRest, { exitTime: 100, percent: true });
  fx.transition(sBeatB, sRest, { exitTime: 100, percent: true });
  return f;
}
