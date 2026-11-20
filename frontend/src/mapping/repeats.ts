// Repeated phrases: a chorus, a verse, a riff that comes back. A human charts a repeat the same
// way (or builds on it), so players learn it; a mapper that charts every moment fresh plays the
// second chorus differently from the first. This finds, for each phrase (PHRASE bars on the beat
// map), an earlier phrase it repeats: the same rhythm in the same bands and the same harmony
// (PHRASE_SIMILAR), at least one phrase back. A tile in the repeat then has a twin: the moment at
// the same place in the earlier phrase (lanes.ts plays it in the same lane; thin.ts keeps or leaves
// it as the earlier one was).

import type { SoundEvent } from '../api/types';
import { barOf, beatAt, secAt, type BeatMap } from './beatmap';

/** Bars per phrase. */
const PHRASE = 2;
/** How alike a phrase's sounds must be to an earlier one's (cosine of their fingerprints). */
export const PHRASE_SIMILAR = 0.9;

export interface Repeats {
  map: BeatMap;
  /** For each phrase index that repeats an earlier one, that earlier phrase's index. */
  of: Map<number, number>;
}

const phraseOf = (map: BeatMap, beat: number) => Math.floor(barOf(map, beat) / PHRASE);

/** The repeated phrases of a song: each phrase's fingerprint against every earlier phrase's. */
export function findRepeats(map: BeatMap, events: Pick<SoundEvent, 'sec' | 'band' | 'strength' | 'midi'>[]): Repeats {
  const slots = map.meter * 4 * PHRASE;
  const size = slots * 3 + 12;
  const prints = new Map<number, Float64Array>();
  for (const e of events) {
    const p = beatAt(map, e.sec);
    const ph = phraseOf(map, p);
    if (ph < 0) continue;
    let f = prints.get(ph);
    if (!f) { f = new Float64Array(size); prints.set(ph, f); }
    // Where in the phrase (to a 16th), in which band; and its pitch class (the harmony).
    const at = p - map.downbeat - ph * PHRASE * map.meter;
    const slot = Math.min(slots - 1, Math.max(0, Math.round(at * 4)));
    const band = e.band === 'low' ? 0 : e.band === 'mid' ? 1 : 2;
    f[slot * 3 + band] += e.strength;
    if (e.midi != null) f[slots * 3 + (((e.midi % 12) + 12) % 12)] += e.strength * 0.5;
  }
  const norm = new Map<number, number>();
  for (const [k, f] of prints) { let s = 0; for (const v of f) s += v * v; norm.set(k, Math.sqrt(s)); }
  const of = new Map<number, number>();
  const keys = [...prints.keys()].sort((a, b) => a - b);
  for (const j of keys) {
    const fj = prints.get(j)!, nj = norm.get(j)!;
    if (!nj) continue;
    let best = -1, bestCos = PHRASE_SIMILAR;
    for (const i of keys) {
      if (i >= j - 1) break; // at least one phrase back: not a groove that simply goes on
      const fi = prints.get(i)!, ni = norm.get(i)!;
      if (!ni) continue;
      let dot = 0;
      for (let k = 0; k < size; k++) dot += fi[k] * fj[k];
      const c = dot / (ni * nj);
      if (c > bestCos) { bestCos = c; best = i; }
    }
    // The earliest form of it: a repeat of a repeat goes back to the first.
    if (best >= 0) of.set(j, of.get(best) ?? best);
  }
  return { map, of };
}

/** The moment (seconds) at the same place in the earlier phrase that `sec`'s phrase repeats, or null. */
export function twinSec(r: Repeats, sec: number): number | null {
  const p = beatAt(r.map, sec);
  const ph = phraseOf(r.map, p);
  const src = r.of.get(ph);
  if (src === undefined) return null;
  return secAt(r.map, p - (ph - src) * PHRASE * r.map.meter);
}
