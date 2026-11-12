// Songs saved before Ultra had three charts: Easy, Medium and Hard. Today's four are a step
// harder each: the old Medium is Easy, the old Hard is Ultra, and Medium and Hard are kept from it
// (thin.ts KEEP), as a newly mapped song's are. Best scores move with their charts (the old Easy's
// has no chart any more). Free of browser and Node APIs: the client and the mock server use it.

import type { BestScore, Chart, Difficulty, SongSummary } from './types';
import { KEEP, thinChart } from '../mapping/thin';

type Charts = Partial<Record<Difficulty, Chart>>;
type Best = Partial<Record<Difficulty, BestScore>>;

const moveBest = (best: Best | undefined): Best => ({
  ...(best?.medium ? { easy: best.medium } : {}),
  ...(best?.hard ? { ultra: best.hard } : {}),
});

/** A song on today's four charts (unchanged when it has them already). */
export function upgradeSong<S extends { bpm: number; charts: Charts; best?: Best }>(song: S): S {
  const { charts } = song;
  if (charts.ultra || !charts.hard) return song;
  const full = charts.hard.notes;
  const spb = 60 / song.bpm;
  const kept = (d: Difficulty): Chart => ({ difficulty: d, lanes: 4, notes: thinChart(full, { ...KEEP[d], spb, offset: 0, events: [], onGrid: true }) });
  return {
    ...song,
    charts: {
      easy: charts.medium ? { ...charts.medium, difficulty: 'easy' } : kept('easy'),
      medium: kept('medium'),
      hard: kept('hard'),
      ultra: { ...charts.hard, difficulty: 'ultra' },
    },
    ...(song.best ? { best: moveBest(song.best) } : {}),
  };
}

/**
 * A search result for a song saved before Ultra: its old Medium's and Hard's tile counts are
 * Easy's and Ultra's; Medium and Hard (which it gets when opened) are estimated between them.
 */
export function upgradeSummary(s: SongSummary): SongSummary {
  const t = s.tiles as Partial<Record<Difficulty, number>>;
  if (t.ultra != null || t.hard == null) return s;
  const easy = t.medium ?? 0, ultra = t.hard;
  const step = (k: number) => Math.round(easy * Math.pow(Math.max(1, ultra) / Math.max(1, easy), k));
  return { ...s, tiles: { easy, medium: step(1 / 3), hard: step(2 / 3), ultra }, best: moveBest(s.best) };
}
