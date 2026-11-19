// Songs saved before Ultra had three charts: Easy, Medium and Hard. Today's four are a step
// harder each: the old Medium is Easy, the old Hard is Ultra, and Medium and Hard are kept from it
// (thin.ts KEEP), as a newly mapped song's are. Best scores move with their charts (the old Easy's
// has no chart any more). Free of browser and Node APIs: the client and the mock server use it.

import type { BestScore, Chart, ChartsUpdate, Difficulty, MapReport, SongSummary } from './types';
import { DIFFICULTIES } from './types';
import { KEEP, LADDER, thinChart } from '../mapping/thin';
import { flowChart } from '../mapping/lanes';

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
  // Medium and Hard an even step apart between the Easy it keeps (the old Medium) and Ultra (the
  // old Hard), as upgradeSummary estimates them: KEEP's shares of Ultra alone could put Medium
  // under that Easy (a fan chart's Medium is denser than a third of its Hard).
  const easyN = charts.medium?.notes.length ?? 0;
  const share = (k: number) => (easyN ? Math.min(1, (easyN * Math.pow(full.length / easyN, k)) / Math.max(1, full.length)) : KEEP[k < 0.5 ? 'medium' : 'hard'].share);
  const kept = (d: Difficulty): Chart => ({
    difficulty: d, lanes: 4,
    notes: thinChart(full, { ...KEEP[d], ...(d === 'medium' || d === 'hard' ? { share: share(d === 'medium' ? 1 / 3 : 2 / 3), rate: 1000, floor: 0 } : {}), spb, offset: 0, events: [], onGrid: true }),
  });
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
 * A song the trained mapper charted before today's ladder (LADDER), made again from its Ultra:
 * Ultra keeps its tiles (its holds capped as a new song's are), and Easy, Medium and Hard are
 * thinned from it as a newly mapped song's are. Null when it's on today's ladder already, or
 * wasn't made by the trained mapper (other mappers' charts are kept as they are). The server
 * keeps the result only if every tile is one of its Ultra's (PUT /api/songs/:id/charts).
 */
export function rethinSong(song: { bpm: number; charts: Charts; report?: Pick<MapReport, 'mapper' | 'ladder'> }): ChartsUpdate | null {
  const ultra = song.charts.ultra;
  if (!ultra || !song.report?.mapper.startsWith('Ensomi') || (song.report.ladder ?? 1) >= LADDER) return null;
  const spb = 60 / song.bpm;
  const keep = (src: Chart['notes'], d: Difficulty) => thinChart(src, { ...KEEP[d], spb, offset: 0, events: [], onGrid: true });
  const top = keep(ultra.notes, 'ultra');
  const charts = Object.fromEntries(DIFFICULTIES.map((d) => [d, { difficulty: d, lanes: 4, notes: flowChart(d === 'ultra' ? top : keep(top, d), d, spb) }])) as Record<Difficulty, Chart>;
  return { charts, ladder: LADDER };
}

/**
 * Why charts made again (PUT /api/songs/:id/charts) can't replace a song's, or null when they can:
 * a newer ladder, all four difficulties on four lanes, and every tile at one of the song's Ultra's
 * moments (its beat), no more tiles there than Ultra had, a hold no longer than Ultra's longest
 * there. The lanes may change (lanes.ts flows them); charts made again can only leave tiles out,
 * never add one. The backend checks the same (SongController.rechart).
 */
export function rechartProblem(song: { charts: Charts; report?: Partial<Pick<MapReport, 'mapper' | 'ladder'>> }, update: unknown): string | null {
  const u = update as Partial<ChartsUpdate> | null;
  if (!u || typeof u.ladder !== 'number' || !u.charts) return 'Send the charts and their ladder';
  if (u.ladder <= (song.report?.ladder ?? 1)) return 'The song is on that ladder already';
  // Ultra's moments (beats): how many tiles each had, and its longest hold there.
  const had = new Map<number, { tiles: number; hold: number }>();
  for (const n of song.charts.ultra?.notes ?? []) {
    const k = Math.round(n.t * 1000), m = had.get(k) ?? { tiles: 0, hold: 0 };
    had.set(k, { tiles: m.tiles + 1, hold: Math.max(m.hold, n.hold ? n.len : 0) });
  }
  for (const d of DIFFICULTIES) {
    const c = u.charts[d];
    if (!c || c.lanes !== 4 || !Array.isArray(c.notes) || !c.notes.length) return `No ${d} chart`;
    const used = new Map<number, number>();
    for (const n of c.notes) {
      const k = Math.round(Number(n.t) * 1000), was = had.get(k);
      if (!was || !Number.isInteger(n.lane) || n.lane < 0 || n.lane > 3) return `A ${d} tile that isn't in Ultra`;
      used.set(k, (used.get(k) ?? 0) + 1);
      if ((used.get(k) ?? 0) > was.tiles) return `A ${d} tile that isn't in Ultra`;
      if (n.hold && !(Number(n.len) <= was.hold + 1e-6)) return `A ${d} hold longer than Ultra's`;
    }
  }
  return null;
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
