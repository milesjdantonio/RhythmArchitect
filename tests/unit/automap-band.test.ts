import { describe, expect, it } from 'vitest';
import { automap } from '../../src/music/automap';

// A benchmark for the mapper: a small band rendered at a known tempo, so every note's true time is
// known. It has what real songs have and click tracks don't: a legato melody whose notes change
// pitch without getting louder, a vibrato that mustn't count as new notes, soft pad chord changes,
// a bass line, drums and a noise floor under everything.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const SR = 22050;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface Truth { at: number; kind: string }

/** `rough`: a room (reverb), a louder noise floor and loose, human timing. */
function band(bpm: number, bars: number, seed = 7, rough = false, drums = true) {
  const rand = rng(seed);
  const spb = 60 / bpm, lead = 0.4;
  const seconds = lead + bars * 4 * spb + 1;
  const x = new Float32Array(Math.floor(seconds * SR));
  const truth: Truth[] = [];
  const add = (t: number, f: (i: number) => number, len: number) => {
    const t0 = Math.floor(t * SR);
    for (let i = 0; i < len * SR && t0 + i < x.length; i++) x[t0 + i] += f(i);
  };
  const human = (t: number) => (rough ? t + (rand() - 0.5) * 0.02 : t);
  // A tone with harmonics; `glideFrom` makes a legato note (no new attack, just a pitch change).
  const tone = (t: number, midi: number, len: number, gain: number, attack: number, opts: { vib?: number; harmonics?: number; legato?: boolean } = {}) => {
    const f0 = hz(midi), H = opts.harmonics ?? 4;
    let ph = 0;
    add(t, (i) => {
      const s = i / SR;
      const vib = opts.vib ? 1 + opts.vib * Math.sin(2 * Math.PI * 5.5 * s) * Math.min(1, s / 0.3) : 1;
      ph += (2 * Math.PI * f0 * vib) / SR;
      let v = 0;
      for (let h = 1; h <= H; h++) v += Math.sin(ph * h) / h;
      const env = opts.legato ? Math.min(1, (len - s) / 0.02) : Math.min(1, s / attack, (len - s) / 0.03);
      return v * gain * Math.max(0, env);
    }, len);
  };
  for (let bar = 0; bar < bars; bar++) {
    const b0 = lead + bar * 4 * spb;
    // Drums: kick on 1 and 3, snare on 2 and 4, quiet hats on the 8ths.
    if (drums) {
    for (const beat of [0, 2]) { const t = human(b0 + beat * spb); truth.push({ at: t, kind: 'kick' }); add(t, (i) => Math.sin((2 * Math.PI * (55 + 60 * Math.exp(-i / (SR * 0.02))) * i) / SR) * Math.exp(-i / (SR * 0.06)) * 0.7, 0.25); }
    for (const beat of [1, 3]) { const t = human(b0 + beat * spb); truth.push({ at: t, kind: 'snare' }); add(t, (i) => ((rand() * 2 - 1) * 0.5 + Math.sin((2 * Math.PI * 190 * i) / SR) * 0.3) * Math.exp(-i / (SR * 0.05)) * 0.5, 0.2); }
    for (let e = 0; e < 8; e++) { const t = human(b0 + e * spb * 0.5); if (e % 2) truth.push({ at: t, kind: 'hat' }); if (e % 2) add(t, () => (rand() * 2 - 1) * 0.12, 0.03); }
    }
    // Bass: a note every half bar.
    for (const h of [0, 2]) { const t = human(b0 + h * spb); truth.push({ at: t, kind: 'bass' }); tone(t, [40, 43, 45, 38][(bar + h / 2) % 4], 2 * spb * 0.95, 0.25, 0.01, { harmonics: 3 }); }
    // The melody: legato 8ths that only change pitch (the hard case), a long note with vibrato at the end.
    const line = [72, 74, 76, 79, 77, 76, 74, 72];
    for (let e = 0; e < 6; e++) {
      const t = human(b0 + e * spb * 0.5);
      truth.push({ at: t, kind: e === 0 ? 'melody' : 'legato' });
      tone(t, line[(e + bar) % 8], spb * 0.5, 0.16, 0.01, { legato: e > 0, harmonics: 5 });
    }
    { const t = human(b0 + 3 * spb); truth.push({ at: t, kind: 'melody' }); tone(t, 79, spb * 0.98, 0.16, 0.01, { vib: 0.012, harmonics: 5 }); }
    // A soft pad chord every two bars.
    if (bar % 2 === 0) { truth.push({ at: b0, kind: 'pad' }); for (const m of [[60, 64, 67], [57, 60, 64]][(bar / 2) % 2]) tone(b0, m, 8 * spb * 0.98, 0.05, 0.08, { harmonics: 2 }); }
  }
  // A room: a few feedback echoes smear every sound (rough only).
  if (rough) {
    for (const [ms, g] of [[29, 0.35], [43, 0.3], [61, 0.25]] as const) {
      const d = Math.round((ms / 1000) * SR);
      for (let i = d; i < x.length; i++) x[i] += x[i - d] * g * 0.5;
    }
  }
  // A noise floor under everything.
  for (let i = 0; i < x.length; i++) x[i] += (rand() * 2 - 1) * (rough ? 0.02 : 0.004);
  // Sounds within 35 ms of each other are one onset (played together, heard together).
  const times: number[] = [];
  for (const t of truth.map((u) => u.at).sort((a, b) => a - b)) if (!times.length || t - times[times.length - 1] > 0.035) times.push(t);
  return { x, times, truth, spb, lead };
}

/** Precision, recall and F-measure of found onsets against the true ones, within ±50 ms. */
function score(found: number[], truth: number[], tol = 0.05) {
  const used = new Set<number>();
  let hits = 0;
  for (const f of found) {
    let best = -1, bd = tol;
    truth.forEach((t, i) => { const d = Math.abs(t - f); if (!used.has(i) && d <= bd) { bd = d; best = i; } });
    if (best >= 0) { used.add(best); hits++; }
  }
  const p = hits / Math.max(1, found.length), r = hits / Math.max(1, truth.length);
  return { p, r, f: (2 * p * r) / Math.max(1e-9, p + r) };
}

describe('automap on a band (melody, chords, bass, drums)', () => {
  it('finds the tempo, and the notes where they are heard (legato pitch changes too)', () => {
    for (const [bpm, rough, minF] of [[92, false, 0.95], [124, false, 0.95], [148, true, 0.85]] as const) {
      const { x, times } = band(bpm, 12, 7, rough);
      const r = automap(x, SR);
      expect(Math.abs(r.bpm - bpm), `tempo ${bpm}`).toBeLessThan(1.5);
      const s = score(r.onsetTimes, times);
      // Legato notes on their own: the same band without its drums, the notes with no bass or pad
      // starting with them. Only a change of pitch marks them.
      const solo = band(bpm, 12, 7, rough, false);
      const legato = solo.truth.filter((t) => t.kind === 'legato').map((t) => t.at).filter((t) => !solo.truth.some((u) => u.kind !== 'legato' && Math.abs(u.at - t) < 0.06));
      const lg = score(automap(solo.x, SR).onsetTimes, legato);
      console.log(`band ${bpm} BPM${rough ? ' (room, noise, human timing)' : ''}: ${r.onsetTimes.length} found / ${times.length} true · precision ${(s.p * 100).toFixed(0)}% · recall ${(s.r * 100).toFixed(0)}% · F ${(s.f * 100).toFixed(0)}% · legato notes found ${(lg.r * 100).toFixed(0)}%`);
      // The previous mapper (three loudness bands) scored F 85% at 92 BPM and 62% at 124 BPM here,
      // finding half the legato notes at best.
      expect(s.f, `F-measure at ${bpm} BPM`).toBeGreaterThan(minF);
      expect(lg.r, `legato notes at ${bpm} BPM`).toBeGreaterThan(rough ? 0.7 : 0.9);
    }
  });
});
