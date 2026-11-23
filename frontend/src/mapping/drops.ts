// Where a song's drops play, for the drop animations only (Play's drop mode, the dev tools): from
// the song's own loudness, not the map's section labels. The user, Nov 22: "make more accurate drop
// recognition for just this system".
//
// The labels were off on the bank's songs: MEANT TO BE's biggest entrance (the bass ×2.8 at 2:10)
// had no drop at all and its first was marked at 61 s where the bass came in at 52-56 s; Open Your
// Eyes' drops started 3 s early, lit while its build was still quiet; mild lifts got the full show.
// A drop is heard as the bass and the loudness jumping and staying up, so that's what this finds.
// On those 8 songs: MEANT TO BE 0:54 and 2:12, Open Your Eyes 1:22 (and a lift at 2:22), One Dance
// the beat at 0:07 and a lift after its break, Hotline Bling the beat at 0:12 and a lift after its
// quiet bridge, change a lift at 3:01, Ice Ice Baby one at 0:41; California Gurls and Coffin none.

import type { Song } from '../api/types';
import { dropZones, type DropZone } from './cues';
import { decodeLevels, type DecodedLevels } from './levels';

/**
 * The bars before a drop it's measured against (the build or break), and the bars after it. Four
 * before: with two, Hotline Bling's verses (loud and soft every other bar) were five "lifts".
 */
const BEFORE = 4;
const AFTER = 4;
/** A drop: over the bars before, the bass at least this many times (or the loudness RISE times). */
const RISE_BASS = 1.6;
const RISE = 1.4;
/** And the bars after it at least the song's typical bar, of 4 at least SUSTAIN of their mean. */
const SUSTAIN = 0.8;
/** A real drop (the full show, strength 1) at this many times the thresholds; less is a lift. */
const BIG = 1.4;
/** It runs until a bar falls under END of its loudness (one dip allowed), MIN to MAX bars. */
const END = 0.65;
const MIN_BARS = 4;
const MAX_BARS = 16;
/** Drops at least this many bars apart (the stronger kept). */
const APART = 8;

/**
 * The drops in a song's loudness (levels.ts: three bands, 30 a second), in the chart's beats:
 * where the bass and the loudness jump over the bars before and stay up, the start on the beat
 * where the bass rises most (within a bar of the bar it was found in).
 */
export function dropsFromLevels(L: DecodedLevels, bpm: number, offset: number, lengthBeats: number, meter = 4): DropZone[] {
  const spb = 60 / bpm, barSec = spb * meter;
  const bars = Math.floor(lengthBeats / meter);
  if (bars < BEFORE + AFTER + 1) return [];
  const n = L.bass.length;
  const frame = (sec: number) => Math.max(0, Math.min(n, Math.round(sec * L.rate)));
  const mean = (a: number, b: number, band: 'all' | 'bass') => {
    const i0 = frame(a), i1 = frame(b);
    let s = 0;
    for (let i = i0; i < i1; i++) s += band === 'bass' ? L.bass[i] : L.bass[i] + L.mid[i] + L.high[i];
    return i1 > i0 ? s / (i1 - i0) : 0;
  };
  const E: number[] = [], B: number[] = [];
  for (let k = 0; k < bars; k++) {
    const a = offset + k * barSec;
    E.push(mean(a, a + barSec, 'all'));
    B.push(mean(a, a + barSec, 'bass'));
  }
  const median = (xs: number[]) => { const s = xs.filter((x) => x > 0).sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
  const Em = median(E), Bm = median(B);
  if (!Em) return [];
  const avg = (xs: number[], a: number, b: number) => { let s = 0; for (let k = a; k < b; k++) s += xs[k]; return s / (b - a); };

  // Each bar that opens a drop, scored by how far its rise passes the thresholds.
  const found: { bar: number; score: number; level: number }[] = [];
  for (let k = BEFORE; k + AFTER <= bars; k++) {
    const eb = avg(E, k - BEFORE, k), bb = avg(B, k - BEFORE, k);
    const ea = avg(E, k, k + AFTER), ba = avg(B, k, k + AFTER);
    if (ea < Em || ba < Bm * 0.9) continue;
    let held = 0;
    for (let j = k; j < k + AFTER; j++) if (E[j] >= SUSTAIN * ea) held++;
    if (held < AFTER - 1) continue;
    const score = Math.max(ba / Math.max(1, bb) / RISE_BASS, ea / Math.max(1, eb) / RISE);
    if (score >= 1) found.push({ bar: k, score, level: ea });
  }
  // The strongest of each run of candidates, APART bars between drops.
  found.sort((a, b) => b.score - a.score);
  const kept: typeof found = [];
  for (const f of found) if (!kept.some((x) => Math.abs(x.bar - f.bar) < APART)) kept.push(f);
  kept.sort((a, b) => a.bar - b.bar);

  const zones: DropZone[] = [];
  for (let i = 0; i < kept.length; i++) {
    const { bar, score, level } = kept[i];
    // The start: the beat where the bass rises most, within a bar of the bar it was found in.
    const a = offset + (bar - 1) * barSec, b = offset + (bar + 1) * barSec;
    let best = offset + bar * barSec, bestRise = -Infinity;
    for (let t = a; t <= b; t += 1 / L.rate) {
      const rise = mean(t, t + 0.5, 'bass') - mean(t - 0.5, t, 'bass');
      if (rise > bestRise) { bestRise = rise; best = t; }
    }
    const from = Math.max(0, Math.round((best - offset) / spb));
    // The end: while the bars hold (one dip allowed), MIN_BARS to MAX_BARS, never into the next drop.
    // (`end`: the bar after the last one that held.)
    let end = bar + 1, dips = 0;
    for (let j = bar + 1; j < bars && j - bar < MAX_BARS; j++) {
      if (E[j] < END * level) { if (++dips > 1) break; continue; }
      dips = 0;
      end = j + 1;
    }
    end = Math.max(end, bar + MIN_BARS);
    let to = Math.min(lengthBeats, end * meter);
    if (i + 1 < kept.length) to = Math.min(to, kept[i + 1].bar * meter);
    if (to - from < meter) continue;
    const big = score >= BIG;
    zones.push({ from, to, strength: big ? 1 : Math.min(0.8, 0.5 + 0.3 * (score - 1) / (BIG - 1)), big, label: big ? 'Drop' : 'Lift' });
  }
  return zones;
}

/** A song's drops: from its loudness where it has one, else from its map's cues (cues.ts dropZones). */
export function songDrops(song: Pick<Song, 'report' | 'lengthBeats' | 'bpm' | 'levels' | 'meter' | 'source'>): DropZone[] {
  if (song.levels) {
    try {
      return dropsFromLevels(decodeLevels(song.levels), song.bpm, song.source?.offset ?? 0, song.lengthBeats, song.meter ?? 4);
    } catch { /* an older song's levels: the cues instead */ }
  }
  return dropZones(song.report, song.lengthBeats);
}
