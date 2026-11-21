import { describe, expect, it } from 'vitest';
import { SHAPE, cutHolds, songShape } from '../../src/mapping/shape';
import { FIGURE_MIN, figuresOf, flowLanes, soundFigure } from '../../src/mapping/lanes';

// Phrases of 4 s; `rates` sounds a second in each.
function song(rates: number[]) {
  const secs: number[] = [];
  rates.forEach((r, p) => { for (let i = 0; i < r * 4; i++) secs.push(p * 4 + i / r); });
  return songShape(secs, (s) => Math.floor(s / 4), (p) => p * 4);
}

describe('song shape', () => {
  it('scales busy phrases up and quiet ones down, within its limits', () => {
    const s = song([2, 2, 2, 2, 6, 6, 6, 6, 2, 2, 1, 1]);
    expect(s.scale(5)).toBeGreaterThan(1.1);
    expect(s.scale(5)).toBeLessThanOrEqual(SHAPE.hi);
    expect(s.scale(10)).toBeLessThan(1);
    expect(s.scale(10)).toBeGreaterThanOrEqual(SHAPE.lo);
  });

  it('finds the drop and builds into it', () => {
    const s = song([2, 2, 2, 2, 6, 6, 6, 6, 2, 2, 2, 2]);
    expect([...s.drops]).toEqual([4]);
    expect(s.scale(3)).toBeGreaterThanOrEqual(1.1);
  });

  it('leaves an even song alone', () => {
    const s = song([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(s.drops.size).toBe(0);
    for (let p = 0; p < 8; p++) expect(s.scale(p)).toBeCloseTo(1, 5);
  });
});

describe('figures', () => {
  it('finds a climbing run and a trill', () => {
    const run = [60, 62, 64, 65, 67].map((pitch, i) => ({ t: i * 0.15, pitch }));
    expect(figuresOf(run).filter((f) => f?.kind === 'run')).toHaveLength(run.length - 1);
    const trill = [60, 63, 60, 63, 60].map((pitch, i) => ({ t: i * 0.15, pitch }));
    expect(figuresOf(trill).filter((f) => f?.kind === 'trill')).toHaveLength(trill.length - 1);
    const slow = [60, 62, 64, 65].map((pitch, i) => ({ t: i * 0.8, pitch }));
    expect(figuresOf(slow).every((f) => f === null)).toBe(true);
    expect(FIGURE_MIN).toBe(4);
  });

  it('charts a run as a staircase the way the tune goes', () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
    const notes = pitches.map((p, i) => ({ sec: i * 0.15, lane: 0, p }));
    flowLanes(notes, 'hard', (n) => n.sec, (n) => n.sec, 1, { pitch: (n) => n.p });
    // Mostly up a lane at a time, turning only at the edge.
    let up = 0;
    for (let i = 1; i < notes.length; i++) if (notes[i].lane > notes[i - 1].lane) up++;
    expect(up).toBeGreaterThanOrEqual(3);
    expect(notes.slice(0, 4).map((n) => n.lane)).toEqual([0, 1, 2, 3]);
  });
});

describe('song shape by loudness', () => {
  it('a loud phrase with few new sounds still scales up and can be a drop', () => {
    // Even sounds a second throughout; the loudness jumps at phrase 4.
    const secs: number[] = [];
    for (let i = 0; i < 12 * 4 * 2; i++) secs.push(i / 2);
    const loud = [0.3, 0.3, 0.3, 0.3, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3];
    const s = songShape(secs, (x) => Math.floor(x / 4), (p) => p * 4, (from) => loud[Math.floor(from / 4)] ?? null);
    expect([...s.drops]).toContain(4);
    expect(s.scale(5)).toBeGreaterThan(1.1);
    expect(s.scale(10)).toBeLessThan(1);
  });

  it('a kick-snare back and forth is a trill by band', () => {
    const notes = [40, 64, 40, 64, 40, 64].map((b, i) => ({ sec: i * 0.15, lane: 0, b }));
    flowLanes(notes, 'hard', (n) => n.sec, (n) => n.sec, 1, { figure: (n) => n.b });
    const lanes = notes.map((n) => n.lane);
    for (let i = 2; i < lanes.length; i++) expect(lanes[i]).toBe(lanes[i - 2]);
    expect(lanes[0]).not.toBe(lanes[1]);
  });
});

describe('drops by the bar, holds cut at the breath', () => {
  it('a drop in the second bar of a phrase lands on that bar', () => {
    const secs: number[] = [];
    for (let i = 0; i < 12 * 4 * 2; i++) secs.push(i / 2);
    // Bars of 2 s: quiet until the bar at 18 s (phrase 4's second bar), loud after.
    const s = songShape(secs, (x) => Math.floor(x / 4), (p) => p * 4, (from) => (from >= 18 ? 1 : 0.3));
    expect(s.dropSecs).toEqual([18]);
  });

  it('a hold running into a breath ends where it starts', () => {
    const notes = [{ t: 0, len: 4, hold: true }, { t: 2.6, len: 2, hold: true }, { t: 8, len: 2, hold: true }];
    cutHolds(notes, [[3, 3.99]], (t) => t, (s) => s);
    expect(notes[0]).toMatchObject({ len: 3, hold: true });
    expect(notes[1].hold).toBeUndefined();
    expect(notes[2]).toMatchObject({ len: 2, hold: true });
  });
});

describe('looser figures', () => {
  it('a swung run is still a run', () => {
    const times = [0, 0.2, 0.3, 0.5, 0.6, 0.8];
    const rows = times.map((t, i) => ({ t, pitch: 60 + i * 2 }));
    expect(figuresOf(rows).filter((f) => f?.kind === 'run')).toHaveLength(times.length - 1);
  });

  it('a tom fill falling in brightness is a run', () => {
    const fill = [90, 80, 70, 60, 50].map((bright) => soundFigure({ band: 'mid', bright }));
    const rows = fill.map((pitch, i) => ({ t: i * 0.12, pitch }));
    expect(figuresOf(rows).filter((f) => f?.kind === 'run' && f.dir === -1)).toHaveLength(fill.length - 1);
  });
});

describe('repeats without the beat tracker', () => {
  it('are found on the straight grid', async () => {
    const { straightMap } = await import('../../src/mapping/ensomi');
    const { findRepeats } = await import('../../src/mapping/repeats');
    // 120 BPM; the same 2-bar rhythm (8 s... 4 s a phrase) four times.
    const rhythm = [0, 0.5, 0.75, 1.5, 2, 2.25, 3, 3.5];
    const events = [0, 1, 2, 3].flatMap((p) => rhythm.map((r) => ({ sec: p * 4 + r, band: 'low' as const, strength: 0.6, midi: null })));
    const map = straightMap({ bpm: 120, offset: 0 }, events.map((e) => e.sec));
    const r = findRepeats(map, events);
    expect(r.of.get(2)).toBe(0);
    expect(r.of.get(3)).toBe(0);
  });
});

describe('a floor for every stretch', () => {
  it('a quiet stretch on Easy keeps at least STRETCH_FLOOR tiles a second', async () => {
    const { thinChart, KEEP } = await import('../../src/mapping/thin');
    const { STRETCH_FLOOR } = await import('../../src/mapping/shape');
    // 1 s a beat; a tile every beat for 40 s, quiet all through, Easy asked for very few.
    const notes = Array.from({ length: 40 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.25 }));
    const events = notes.map((n, i) => ({ id: i, t: n.t, sec: n.t, band: 'mid' as const, pitched: false, midi: null, note: null, bright: 60, strength: 0.5, len: 0.25, onBeat: true, accent: false }));
    const o = { ...KEEP.easy, share: 0.05, rate: 0.2, floor: 0, spb: 1, offset: 0, events, onGrid: true, intensity: () => 0.75 };
    const bare = thinChart(notes, o), floored = thinChart(notes, { ...o, minRate: STRETCH_FLOOR.easy });
    expect(floored.length).toBeGreaterThan(bare.length);
    for (let w = 0; w < 10; w++) expect(floored.filter((n) => n.t >= w * 4 && n.t < w * 4 + 4).length).toBeGreaterThanOrEqual(2);
  });
});

describe('peaks, holds worth keeping, chords in runs, the onset mapper', () => {
  it('no window of an easier chart passes PEAK times its rate', async () => {
    const { thinChart, KEEP } = await import('../../src/mapping/thin');
    const notes = Array.from({ length: 160 }, (_, i) => ({ t: i / 4, lane: i % 4, pitch: 'C5', len: 0.25 }));
    const events = notes.map((n, i) => ({ id: i, t: n.t, sec: n.t, band: 'mid' as const, pitched: false, midi: null, note: null, bright: 60, strength: 0.5, len: 0.25, onBeat: false, accent: false }));
    const out = thinChart(notes, { ...KEEP.easy, share: 1, minGap: 0.01, spb: 1, offset: 0, events, onGrid: false, maxRate: 1.5 * KEEP.easy.rate });
    for (let w = 0; w < 10; w++) expect(out.filter((n) => n.t >= w * 4 && n.t < w * 4 + 4).length).toBeLessThanOrEqual(Math.round(1.5 * KEEP.easy.rate * 4));
  });

  it('a chord in a run does not break it', () => {
    const rows = [60, 62, 64, 65, 67].map((pitch, i) => ({ t: i * 0.15, pitch }));
    expect(figuresOf(rows).filter((f) => f?.kind === 'run')).toHaveLength(4);
    const notes = [60, 62, 64, 64, 65, 67].map((p, i) => ({ sec: [0, 0.15, 0.3, 0.3, 0.45, 0.6][i], lane: i === 3 ? 0 : 0, p }));
    // With the chord's two tiles at 0.3 s, the run still climbs around it.
    flowLanes(notes, 'hard', (n) => n.sec, (n) => n.sec, 1, { figure: (n) => n.p });
    expect(notes[5].lane).toBeGreaterThan(notes[1].lane);
  });

  it('the onset mapper charts a busy phrase busier on Easy', async () => {
    const { chartFor } = await import('../../src/mapping/charts');
    // A note every 8th for 32 beats; the second half busy.
    const melody = Array.from({ length: 64 }, (_, i) => ({ t: i / 2, len: 0.25, degree: 60 + (i % 5), strong: i % 2 === 0, midi: 60 + (i % 5), strength: 0.5 }));
    const shape = { scale: (t: number) => (t >= 16 ? 1.25 : 0.8), breath: () => () => false, drops: [] };
    const plain = chartFor(melody, 'easy', [0, 2, 3, 5, 7, 8, 10], 48, 120).notes;
    const shaped = chartFor(melody, 'easy', [0, 2, 3, 5, 7, 8, 10], 48, 120, shape).notes;
    const busyShaped = shaped.filter((n) => n.t >= 16).length, quietShaped = shaped.filter((n) => n.t < 16).length;
    expect(busyShaped).toBeGreaterThan(quietShaped);
    expect(busyShaped).toBeGreaterThanOrEqual(plain.filter((n) => n.t >= 16).length);
  });
});
