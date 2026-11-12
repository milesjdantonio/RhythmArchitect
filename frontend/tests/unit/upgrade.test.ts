import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Chart, type ChartNote, type SongSummary } from '../../src/api/types';
import { upgradeSong, upgradeSummary } from '../../src/api/upgrade';

/** A tile every 16th for `beats` beats at 120 BPM, a chord of two on every beat. */
function full(beats: number): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < beats * 4; i++) {
    notes.push({ t: i / 4, lane: i % 4, pitch: 'C5', len: 0.25 });
    if (i % 4 === 0) notes.push({ t: i / 4, lane: (i + 2) % 4, pitch: 'C5', len: 0.25 });
  }
  return notes;
}
const chart = (difficulty: Chart['difficulty'], notes: ChartNote[]): Chart => ({ difficulty, lanes: 4, notes });
/** A song as saved: any of the charts. */
type Old = Parameters<typeof upgradeSong>[0];

describe('songs saved before Ultra (three charts)', () => {
  // About 2 tiles a second, as the old Medium kept: one on every beat.
  const oldMedium = full(240).filter((n) => Number.isInteger(n.t) && n.lane === 0);
  const old = {
    bpm: 120,
    charts: { easy: chart('easy', full(240).slice(0, 50)), medium: chart('medium', oldMedium), hard: chart('hard', full(240)) },
    best: { easy: { score: 1, accuracy: 0.5, maxCombo: 1, grade: 'D' as const, at: '' }, medium: { score: 2, accuracy: 0.6, maxCombo: 2, grade: 'C' as const, at: '' }, hard: { score: 3, accuracy: 0.7, maxCombo: 3, grade: 'B' as const, at: '' } },
  };

  it('the old Medium is Easy, the old Hard is Ultra, and Medium and Hard are kept from it, a step apart', () => {
    const s = upgradeSong(old as Old);
    expect(s.charts.easy!.notes).toBe(old.charts.medium.notes);
    expect(s.charts.ultra!.notes).toBe(old.charts.hard.notes);
    for (const d of DIFFICULTIES) expect(s.charts[d]!.difficulty).toBe(d);
    const n = DIFFICULTIES.map((d) => s.charts[d]!.notes.length);
    for (let i = 1; i < n.length; i++) expect(n[i]).toBeGreaterThan(n[i - 1]);
    // Every kept tile is one of the old Hard's.
    const key = (x: ChartNote) => `${x.t}:${x.lane}`;
    const all = new Set(old.charts.hard.notes.map(key));
    for (const d of ['medium', 'hard'] as const) expect(s.charts[d]!.notes.every((x) => all.has(key(x)))).toBe(true);
  });

  it('best scores move with their charts; a song already on four is left alone', () => {
    const s = upgradeSong(old as Old);
    expect(s.best).toEqual({ easy: old.best.medium, ultra: old.best.hard });
    expect(upgradeSong(s)).toBe(s);
  });

  it("search results: the old counts are Easy's and Ultra's, Medium and Hard between", () => {
    const summary = { id: 'x', tiles: { easy: 50, medium: 200, hard: 800 }, best: {} } as unknown as SongSummary;
    const t = upgradeSummary(summary).tiles;
    expect(t.easy).toBe(200);
    expect(t.ultra).toBe(800);
    expect(t.medium).toBeGreaterThan(200);
    expect(t.hard).toBeGreaterThan(t.medium);
    expect(t.hard).toBeLessThan(800);
  });
});
