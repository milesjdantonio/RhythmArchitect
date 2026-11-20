// Where players miss (the backend's TileHeat, the same rules): each checked run's tiles (one
// letter per tile of the chart, in its stored order: P G E L M as judged, "-" where the run never
// got to it: engine.ts tiles()) counted into the song's heat for the difficulty: how many runs, and
// per tile how often one reached it and how often it was missed. The mock backend keeps it; the dev
// tools show a song's most missed tiles (tools/heat-report.mjs sums them over the bank by pattern).

import type { Difficulty, Song, TileHeat } from '../api/types';

const TILES = /^[PGELM-]*$/;
const TOKEN = /[PGELMBOXU]|H\d+;/g;

/** The P G E L M of the tiles are the run's, as many of each. */
export function sameJudgements(tiles: string, run: string): boolean {
  const count = (letters: string[]) => [...'PGELM'].map((c) => letters.filter((x) => x === c).length).join(',');
  return count([...tiles]) === count((run.match(TOKEN) ?? []).filter((t) => t.length === 1));
}

/** Adds one run's tiles to the song's heat; false (nothing added) when they don't fit the chart or the run. */
export function addHeat(song: Pick<Song, 'charts' | 'heat'>, d: Difficulty, tiles: string | undefined, run: string | undefined): boolean {
  const n = song.charts[d]?.notes.length ?? 0;
  if (typeof tiles !== 'string' || typeof run !== 'string' || !n || tiles.length !== n || !TILES.test(tiles) || !sameJudgements(tiles, run)) return false;
  const heat = (song.heat ??= {});
  const was = heat[d];
  const h: TileHeat = was && was.seen.length === n ? was : { runs: 0, seen: new Array(n).fill(0), miss: new Array(n).fill(0) };
  for (let i = 0; i < n; i++) {
    if (tiles[i] === '-') continue;
    h.seen[i]++;
    if (tiles[i] === 'M') h.miss[i]++;
  }
  h.runs++;
  heat[d] = h;
  return true;
}

/**
 * The tiles of a difficulty players miss most (at least `minSeen` runs reached them), most missed
 * first: each its index in the chart, how often it was reached and missed.
 */
export function mostMissed(song: Pick<Song, 'heat'>, d: Difficulty, count = 5, minSeen = 3): { index: number; seen: number; miss: number }[] {
  const h = song.heat?.[d];
  if (!h) return [];
  return h.seen.map((seen, index) => ({ index, seen, miss: h.miss[index] }))
    .filter((x) => x.seen >= minSeen && x.miss > 0)
    .sort((a, b) => b.miss / b.seen - a.miss / a.seen || b.seen - a.seen)
    .slice(0, count);
}
