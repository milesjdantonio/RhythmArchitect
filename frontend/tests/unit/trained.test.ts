import { describe, expect, it } from 'vitest';
import type { ChartNote, SoundEvent } from '../../src/api/types';
import { capChord, thinChart, type ThinOptions } from '../../src/mapping/thin';
import { easierCharts, soundShift, toChart } from '../../src/mapping/ensomi';

const BPM = 120, SPB = 0.5;

/** A busy chart: a tile every 16th for `beats` beats, chords of three on every beat, a hold every 4 bars. */
function busy(beats: number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < beats * 4; i++) {
    const t = i / 4;
    if (i % 64 === 0) { notes.push({ t, lane: 0, pitch: 'C5', len: 2, hold: true }); continue; }
    if (i % 4 === 0) for (const lane of [0, 1, 3]) notes.push({ t, lane, pitch: 'C5', len: 0.25 });
    else notes.push({ t, lane: i % 4, pitch: 'C5', len: 0.25 });
  }
  return notes;
}

const opts = (o: Partial<ThinOptions>): ThinOptions => ({ spb: SPB, offset: 0, events: [], onGrid: true, rate: 1.2, minGap: 0.5, share: 0.4, maxChord: 1, holdsAlone: true, ...o });
const rows = (n: ChartNote[]) => [...new Set(n.map((x) => x.t))].sort((a, b) => a - b);

describe('thinning a chart', () => {
  const src = busy(240); // two minutes

  it('keeps only tiles of the source, spaced out, about as many as asked', () => {
    const out = thinChart(src, opts({}));
    const key = (n: ChartNote) => `${n.t}:${n.lane}`;
    const have = new Set(src.map(key));
    expect(out.every((n) => have.has(key(n)))).toBe(true);
    const r = rows(out);
    for (let i = 1; i < r.length; i++) expect((r[i] - r[i - 1]) * SPB).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(out.length / 120).toBeGreaterThan(0.8);
    expect(out.length / 120).toBeLessThan(1.4);
  });

  it('one tile at a time on easy charts, and nothing starts under a hold', () => {
    const out = thinChart(src, opts({}));
    expect(rows(out).length).toBe(out.length);
    for (const h of out.filter((n) => n.hold)) expect(out.some((n) => n.t > h.t && n.t < h.t + h.len)).toBe(false);
  });

  it('favours beats when the grid is trusted', () => {
    const on = thinChart(src, opts({})).filter((n) => Number.isInteger(n.t)).length;
    expect(on / thinChart(src, opts({})).length).toBeGreaterThan(0.9);
  });

  it('quiet stretches stay quieter than busy ones', () => {
    // The first minute every beat, the second every 16th.
    const mixed = [...Array.from({ length: 120 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.25 })),
      ...Array.from({ length: 480 }, (_, i) => ({ t: 120 + i / 4, lane: i % 4, pitch: 'C5', len: 0.25 }))];
    const out = thinChart(mixed, opts({ rate: 2, minGap: 0.24, share: 0.65 }));
    const first = out.filter((n) => n.t < 120).length, second = out.length - first;
    expect(second).toBeGreaterThan(first * 1.5);
  });

  it('keeps tiles under holds on hard, and chords of two', () => {
    const out = thinChart(src, opts({ rate: 3.8, minGap: 0.1, share: 0.9, maxChord: 2, holdsAlone: false }));
    const h = out.find((n) => n.hold)!;
    expect(out.some((n) => n.t > h.t && n.t < h.t + h.len)).toBe(true);
    const per = new Map<number, number>();
    for (const n of out) per.set(n.t, (per.get(n.t) ?? 0) + 1);
    expect(Math.max(...per.values())).toBe(2);
  });

  it('louder sounds win', () => {
    // Two rows a quarter-second apart; only one fits. The second is on a strong sound.
    const two = [{ t: 0, lane: 0, pitch: 'C5', len: 0.25 }, { t: 0.5, lane: 1, pitch: 'C5', len: 0.25 }];
    const ev = (sec: number, strength: number) => ({ id: 0, t: sec / SPB, sec, band: 'low', pitched: false, midi: null, note: null, bright: 60, strength, len: 0.25, onBeat: true, accent: false } as SoundEvent);
    const out = thinChart(two, opts({ onGrid: false, rate: 10, share: 1, events: [ev(0, 0.1), ev(0.25, 0.9)] }));
    expect(out).toEqual([two[1]]);
  });

  it('a chord down to one keeps the hold, else moves off the last lane', () => {
    const c = [{ t: 0, lane: 1, pitch: 'C5', len: 0.25 }, { t: 0, lane: 2, pitch: 'C5', len: 1, hold: true }];
    expect(capChord(c, 1, -1)[0].lane).toBe(2);
    expect(capChord([c[0], { ...c[1], hold: undefined }], 1, 1)[0].lane).toBe(2);
    expect(capChord([0, 1, 2, 3].map((lane) => ({ t: 0, lane, pitch: 'C5', len: 0.25 })), 2, -1).map((n) => n.lane)).toEqual([0, 3]);
  });
});

describe('the trained mapper\'s tiles on the song\'s grid', () => {
  it('turns milliseconds into beats from beat 0, holds into lengths, and drops what comes before beat 0', () => {
    const c = toChart([
      { lane: 2, start_ms: 1000 }, // before beat 0 (1.2 s)
      { lane: 0, start_ms: 1200 },
      { lane: 3, start_ms: 1700, end_ms: 2700 },
      { lane: 1, start_ms: 1950, end_ms: 2000 }, // too short to hold
    ], 'hard', { bpm: BPM, offset: 1.2, events: [] });
    expect(c.notes.map((n) => [n.t, n.lane, !!n.hold, n.len])).toEqual([[0, 0, false, 0.25], [1, 3, true, 2], [1.5, 1, false, 0.25]]);
  });

  it('moves the tiles onto the measured sounds: by their median distance, else by the usual 29 ms', () => {
    // Sounds every 8th at 120 BPM from 1 s; the model's tiles on most of them, 33 ms early, a little jittered.
    const sounds = Array.from({ length: 200 }, (_, i) => ({ sec: 1 + i * 0.25 }));
    const tiles = sounds.filter((_, i) => i % 5 !== 2).map((s, i) => ({ start_ms: s.sec * 1000 - 33 + ((i * 7) % 5) - 2 }));
    expect(soundShift(tiles, sounds)).toBeCloseTo(0.033, 3);
    expect(soundShift(tiles.slice(0, 10), sounds)).toBe(0.029);
    expect(soundShift(tiles, [])).toBe(0.029);
  });

  it('a tile next to a measured sound takes its place', () => {
    const e = { id: 0, t: 4.25, sec: 2.121, band: 'low', pitched: false, midi: null, note: null, bright: 40, strength: 0.8, len: 0.25, onBeat: false, accent: false } as SoundEvent;
    // 2.092 s + 29 ms = 2.121 s: on the sound.
    expect(toChart([{ lane: 1, start_ms: 2092 }], 'hard', { bpm: BPM, offset: 0, events: [e] }, 0.029).notes[0].t).toBe(4.25);
    // 40 ms off it: its own time.
    expect(toChart([{ lane: 1, start_ms: 2052 }], 'hard', { bpm: BPM, offset: 0, events: [e] }, 0.029).notes[0].t).toBe(4.162);
  });

  it('takes the note name of a pitched sound it lands on', () => {
    const e = { id: 0, t: 2, sec: 1.01, band: 'mid', pitched: true, midi: 69, note: 'A4', bright: 69, strength: 0.5, len: 1, onBeat: true, accent: false } as SoundEvent;
    expect(toChart([{ lane: 0, start_ms: 1000 }], 'hard', { bpm: BPM, offset: 0, events: [e] }).notes[0].pitch).toBe('A4');
  });

  it('every difficulty is a subset of the model\'s chart, easier ones fewer', () => {
    const model = busy(240);
    const c = easierCharts(model, { bpm: BPM, offset: 0, events: [], onGrid: true });
    expect(c.easy.notes.length).toBeLessThan(c.medium.notes.length);
    expect(c.medium.notes.length).toBeLessThan(c.hard.notes.length);
    expect(c.hard.notes.length).toBeLessThanOrEqual(model.length);
    for (const d of ['easy', 'medium', 'hard'] as const) expect(c[d].lanes).toBe(4);
  });
});
