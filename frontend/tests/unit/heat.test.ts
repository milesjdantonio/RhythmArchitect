import { describe, expect, it } from 'vitest';
import type { Chart, Difficulty, Song } from '../../src/api/types';
import { addHeat, mostMissed } from '../../src/game/heat';

const song = (tiles: number): Pick<Song, 'charts' | 'heat'> => ({
  charts: { hard: { difficulty: 'hard', lanes: 4, notes: Array.from({ length: tiles }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.25 })) } } as Record<Difficulty, Chart>,
});

// The same cases as the backend's HeatTests (TileHeat): the two keep where players miss alike.
describe('where players miss (heat)', () => {
  it("counts where each run reached and missed, run after run", () => {
    const s = song(4);
    expect(addHeat(s, 'hard', 'PMG-', 'PMG')).toBe(true);
    expect(addHeat(s, 'hard', 'MMPP', 'PPMH500;M')).toBe(true);
    expect(s.heat?.hard).toEqual({ runs: 2, seen: [2, 2, 2, 1], miss: [1, 2, 0, 0] });
  });

  it("ignores tiles that don't fit the chart or the run", () => {
    const s = song(4);
    expect(addHeat(s, 'hard', 'PMG', 'PMG')).toBe(false); // one letter per tile
    expect(addHeat(s, 'hard', 'PPPP', 'PPPM')).toBe(false); // the run's judgements
    expect(addHeat(s, 'hard', 'PZPP', 'PPP')).toBe(false); // letters it knows
    expect(addHeat(s, 'easy', 'P', 'P')).toBe(false); // a chart it has
    expect(addHeat(s, 'hard', 'PPPP', undefined)).toBe(false); // only with a checked run
    expect(s.heat).toBeUndefined();
  });

  it('lists the tiles missed most, of those enough runs reached', () => {
    const s = song(4);
    for (const t of ['PMMP', 'PMPP', 'MMPP', 'PMP-']) addHeat(s, 'hard', t, t.replace(/-/g, ''));
    expect(mostMissed(s, 'hard')).toEqual([
      { index: 1, seen: 4, miss: 4 },
      // (a tie keeps the chart's order)
      { index: 0, seen: 4, miss: 1 },
      { index: 2, seen: 4, miss: 1 },
    ]);
  });
});
