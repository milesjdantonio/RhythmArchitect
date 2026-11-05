import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/api/types';
import { automap } from '../../src/music/automap';

type Event = { at: number; kind: 'kick' | 'hat' | 'tone'; seconds?: number };

// Renders a synthetic track from a list of sounds at known times (seconds).
function render(events: Event[], seconds: number, sr = 22050) {
  const x = new Float32Array(Math.floor(seconds * sr));
  for (const e of events) {
    const t0 = Math.floor(e.at * sr);
    if (e.kind === 'kick') {
      for (let i = 0; i < sr * 0.12 && t0 + i < x.length; i++) x[t0 + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / (sr * 0.03)) * 0.9;
    } else if (e.kind === 'hat') {
      for (let i = 0; i < sr * 0.04 && t0 + i < x.length; i++) x[t0 + i] += (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.008)) * 0.3;
    } else {
      const len = (e.seconds ?? 1) * sr;
      for (let i = 0; i < len && t0 + i < x.length; i++) {
        const env = Math.min(1, i / (sr * 0.004), (len - i) / (sr * 0.01));
        x[t0 + i] += Math.sin((2 * Math.PI * 440 * i) / sr) * env * 0.35;
      }
    }
  }
  return x;
}

// A kick on every beat and a hat on every off-beat, at a known tempo.
function clickTrack(bpm: number, seconds: number, lead = 0.3) {
  const spb = 60 / bpm;
  const events: Event[] = [];
  for (let b = 0; lead + b * spb < seconds; b++) {
    events.push({ at: lead + b * spb, kind: 'kick' }, { at: lead + (b + 0.5) * spb, kind: 'hat' });
  }
  return { x: render(events, seconds), sr: 22050, lead, events };
}

const sec = (r: { offset: number; bpm: number }, t: number) => r.offset + (t * 60) / r.bpm;

describe('automap', () => {
  it('finds the tempo and the beat grid of a click track', () => {
    for (const bpm of [96, 120, 140]) {
      const { x, sr, lead } = clickTrack(bpm, 30);
      const r = automap(x, sr);
      expect(Math.abs(r.bpm - bpm)).toBeLessThan(1.5);
      // Beat 0 lands on a kick.
      const spb = 60 / bpm;
      const off = ((r.offset - lead) / spb) % 1;
      expect(Math.min(Math.abs(off), Math.abs(1 - Math.abs(off)))).toBeLessThan(0.08);
    }
  });

  it('writes denser charts for harder difficulties, on the grid for quantised music', () => {
    const { x, sr } = clickTrack(120, 40);
    const r = automap(x, sr);
    const [e, m, h] = DIFFICULTIES.map((d) => r.charts[d].notes.length);
    expect(e).toBeGreaterThan(10);
    expect(e).toBeLessThanOrEqual(m);
    expect(m).toBeLessThanOrEqual(h);
    for (const n of r.charts.hard.notes) expect((n.t * 4) % 1).toBe(0);
    expect(r.report.energy).toHaveLength(48);
  });

  it('puts every tile on a sound in the track, at the moment it is heard', () => {
    const bpm = 120, spb = 0.5, lead = 0.3;
    const events: Event[] = [];
    // 16 beats of kicks and hats, 8 beats of silence, then 16 more with a held tone and an
    // off-grid hat.
    for (let b = 0; b < 40; b++) {
      if (b >= 16 && b < 24) continue;
      events.push({ at: lead + b * spb, kind: 'kick' });
      if (b !== 28) events.push({ at: lead + (b + 0.5) * spb, kind: 'hat' });
    }
    events.push({ at: lead + 28.5 * spb, kind: 'tone', seconds: 3 * spb });
    events.push({ at: lead + 34.37 * spb, kind: 'hat' });
    const x = render(events.sort((a, b) => a.at - b.at), lead + 42 * spb);
    const r = automap(x, 22050);
    expect(Math.abs(r.bpm - bpm)).toBeLessThan(1);

    for (const d of DIFFICULTIES) {
      for (const n of r.charts[d].notes) {
        const at = sec(r, n.t);
        const nearest = Math.min(...events.map((e) => Math.abs(e.at - at)));
        expect(nearest, `${d} tile at beat ${n.t}`).toBeLessThan(0.015);
      }
      // Nothing in the silence: no filler tiles.
      const quiet = r.charts[d].notes.filter((n) => sec(r, n.t) > lead + 16.6 * spb && sec(r, n.t) < lead + 23.6 * spb);
      expect(quiet, d).toHaveLength(0);
    }
    // The held tone is a hold, and the off-grid hat keeps its exact time.
    const hold = r.charts.hard.notes.find((n) => n.hold && Math.abs(sec(r, n.t) - (lead + 28.5 * spb)) < 0.015);
    expect(hold?.len ?? 0).toBeGreaterThanOrEqual(2);
    expect(r.charts.hard.notes.some((n) => Math.abs(sec(r, n.t) - (lead + 34.37 * spb)) < 0.015)).toBe(true);
  });

  it('is deterministic', () => {
    const { x, sr } = clickTrack(110, 20);
    expect(automap(x, sr).charts).toEqual(automap(x, sr).charts);
  });
});
