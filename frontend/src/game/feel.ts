// How a chart felt (the backend's RunFeel, the same rules): after a run the results screen asks
// once, "felt right" or "felt off", and when off why. Counted into the song's feel per difficulty
// (counts only), from a run whose score the controller kept, once a run; cleared when the chart
// changes. The dev tools show a song's; tools/heat-report.mjs sums them over the bank.

import type { Difficulty, FeelCounts, FeelWhy, Song } from '../api/types';

export const FEEL_WHY: readonly FeelWhy[] = ['notes', 'timing', 'hard', 'easy'];

/** What each reason says on the results screen. */
export const FEEL_LABEL: Record<FeelWhy, string> = {
  notes: "Notes didn't match the song",
  timing: 'Timing felt off',
  hard: 'Too hard',
  easy: 'Too easy',
};

/** Counts one answer; false (nothing counted) when it isn't one the game sends or the chart is missing. */
export function addFeel(song: Pick<Song, 'charts' | 'feel'>, d: Difficulty, feel: unknown, why: unknown): boolean {
  if (!song.charts[d]?.notes.length) return false;
  if (feel !== 'right' && feel !== 'off') return false;
  if (why !== undefined && why !== null && !Array.isArray(why)) return false;
  const list = Array.isArray(why) ? why : [];
  if (feel === 'right' && list.length) return false;
  if (list.length > FEEL_WHY.length || !list.every((w) => typeof w === 'string' && (FEEL_WHY as readonly string[]).includes(w))) return false;
  const all = (song.feel ??= {});
  const c: FeelCounts = (all[d] ??= {});
  c[feel] = (c[feel] ?? 0) + 1;
  for (const w of new Set(list as FeelWhy[])) c[w] = (c[w] ?? 0) + 1;
  return true;
}

/** A difficulty's answers as one line for the dev tools ("4 right, 2 off: notes 2, too hard 1"), or ''. */
export function feelLine(c: FeelCounts | undefined): string {
  if (!c || !(c.right || c.off)) return '';
  const why = FEEL_WHY.filter((w) => c[w]).map((w) => `${w === 'hard' || w === 'easy' ? `too ${w}` : w} ${c[w]}`);
  return `${c.right ?? 0} right, ${c.off ?? 0} off${why.length ? `: ${why.join(', ')}` : ''}`;
}
