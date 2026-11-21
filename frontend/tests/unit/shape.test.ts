import { describe, expect, it } from 'vitest';
import { SHAPE, songShape } from '../../src/mapping/shape';
import { FIGURE_MIN, figuresOf, flowLanes } from '../../src/mapping/lanes';

// Phrases of 4 s; `rates` sounds a second in each.
function song(rates: number[]) {
  const secs: number[] = [];
  rates.forEach((r, p) => { for (let i = 0; i < r * 4; i++) secs.push(p * 4 + i / r); });
  return songShape(secs, (s) => Math.floor(s / 4), () => 4);
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
