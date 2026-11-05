import { describe, expect, it } from 'vitest';
import type { ChartPlan, ChartRequest, SoundEvent } from '../../src/api/types';
import { buildCharts, type MelodyNote } from '../../src/mapping/charts';
import { CHART_RULES, PlanError, chartsFromPlan, rulesPlan } from '../../src/mapping/charter';
import { SCALES } from '../../src/mapping/theory';

// A made-up song's measurements: 64 sounds over 16 bars, a kick on every beat, a melody between,
// some ringing long enough to hold.
function request(): ChartRequest {
  const events: SoundEvent[] = [];
  for (let i = 0; i < 64; i++) {
    const onBeat = i % 2 === 0;
    const t = i * 0.5 + (i % 7 === 3 ? 0.013 : 0);
    const pitched = !onBeat;
    const midi = 60 + ((i * 5) % 12);
    events.push({
      id: i, t, sec: 0.5 + t * 0.5, band: onBeat ? 'low' : 'mid', pitched, midi: pitched ? midi : null, note: pitched ? `N${midi}` : null,
      bright: onBeat ? 40 : 80, strength: onBeat ? 0.6 : 0.3 + (i % 5) * 0.1, len: i % 8 === 1 ? 2.5 : 0.25, onBeat, accent: i % 16 === 0,
    });
  }
  return {
    version: 1, song: { title: 'Test', artist: 'Band', seconds: 40 },
    timing: { bpm: 120, offset: 0.5, meter: 4, lengthBeats: 32, confidence: 0.9 },
    barEnergy: Array(8).fill(0.5), sections: [{ label: 'Intro', beat: 0 }], cues: [], events, rules: CHART_RULES,
  };
}

describe('the AI charter plan', () => {
  it('a plan by the fixed rules gives back exactly the charts the rules make', () => {
    const req = request();
    const melody: MelodyNote[] = req.events.map((e) => ({ t: e.t, len: e.len, degree: e.pitched ? e.midi! : e.bright, midi: e.midi ?? 60, strong: e.onBeat, strength: e.strength, accent: e.accent }));
    const expected = buildCharts(melody, SCALES.minor, 48, 120);
    const { charts, fixes } = chartsFromPlan(req, rulesPlan(req));
    expect(fixes).toBe(0);
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const shape = (n: { t: number; lane: number; len: number; hold?: boolean }) => `${n.t}|${n.lane}|${n.len}|${!!n.hold}`;
      expect(charts[d].notes.map(shape)).toEqual(expected[d].notes.map(shape));
    }
    expect(charts.hard.notes.length).toBeGreaterThan(charts.easy.notes.length);
  });

  it('keeps every tile on a measured sound and fixes what breaks the rules', () => {
    const req = request();
    const ok = (id: number, lane: number) => ({ id, lane });
    const base = Array.from({ length: 20 }, (_, k) => ok(k * 3, k % 4));
    const plan: ChartPlan = {
      mapper: 'test',
      charts: {
        easy: [...base, { id: 999, lane: 0 }, { id: 2, lane: 7 }],
        medium: [...base, { id: 1, lane: 0 }, { id: 1, lane: 2 }, { id: 1, lane: 3 }],
        // id 9 rings 2.5 beats; a hold on id 4 (short) becomes a tap; the hold on 9 (lane 1, beat 4.5)
        // runs into the tile on id 12 (lane 1, beat 6) and is cut to end before it.
        hard: [...base.filter((n) => n.id !== 12 && n.id !== 9), { id: 4, lane: 2, hold: true }, { id: 9, lane: 1, hold: true }, { id: 12, lane: 1 }],
      },
    };
    const { charts, fixes } = chartsFromPlan(req, plan);
    const times = new Set(req.events.map((e) => e.t));
    for (const d of ['easy', 'medium', 'hard'] as const) for (const n of charts[d].notes) expect(times.has(n.t)).toBe(true);
    expect(charts.easy.notes).toHaveLength(20); // the unknown sound and the bad lane are dropped
    expect(charts.medium.notes.filter((n) => n.t === 0.5)).toHaveLength(2); // at most two tiles per sound
    const tap = charts.hard.notes.find((n) => n.t === 2 && n.lane === 2)!;
    expect(tap.hold).toBeUndefined();
    const hold = charts.hard.notes.find((n) => n.t === 4.5 && n.lane === 1)!;
    expect(hold.hold).toBe(true);
    expect(hold.t + hold.len).toBeLessThanOrEqual(6 - 0.25 + 1e-9);
    expect(fixes).toBe(2 + 1 + 1 + 1);
  });

  it('throws out a plan that leaves a difficulty empty or missing, so the on-device charts are used', () => {
    const req = request();
    const full = rulesPlan(req);
    expect(() => chartsFromPlan(req, { ...full, charts: { ...full.charts, hard: [] } })).toThrow(PlanError);
    expect(() => chartsFromPlan(req, { mapper: 'x', charts: { easy: full.charts.easy } } as unknown as ChartPlan)).toThrow(PlanError);
  });
});
