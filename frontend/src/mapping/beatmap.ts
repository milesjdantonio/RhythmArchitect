// The beat map: where each beat of the song really is, from the beat tracker's own beats (not one
// straight grid). A straight grid holds only where the song keeps one exact tempo; a played or
// drifting song runs off it, and its sounds then kept their measured times, which read as loose
// rhythm next to a human chart (everything there sits on an exact 16th or triplet). The beat map
// follows the song's beats one by one, so each stretch has its own exact grid to put tiles on.
//
// Built from the tracker's beats at the song grid's beat level (a tracker at double or half time
// is brought to it), with missed beats filled in. Each beat is smoothed over its neighbours (the
// tracker's beats come in 20 ms frames) and lined up with the attacks heard on the beats. Each
// stretch of the song then takes the subdivision its sounds follow: 16ths, or triplets (8th or
// 16th triplets), or none when its sounds follow neither.

/** The tracker's beats (seconds into the audio). */
export interface TrackedBeats { beats: number[]; downbeats?: number[] }

export interface BeatMap {
  /** Seconds of each beat, consecutive (beat i+1 follows beat i). */
  secs: number[];
  /** Beats per bar, and the index of a downbeat (bars are every `meter` beats from it). */
  meter: number;
  downbeat: number;
  /** The subdivision each beat's stretch follows: 4 (16ths), 3 or 6 (triplets), 0 (none holds). */
  division: Uint8Array;
}

/**
 * Sounds this close (seconds) to a subdivision count as on it; up to BESIDE, beside it (twice the
 * width: sounds that don't follow the grid give on = beside / 2). Wider than the straight grid's
 * check (6 and 18 ms): played music's attacks spread ±10 ms around the beat map's points even where
 * it follows them.
 */
export const ON = 0.01;
export const BESIDE = 0.03;
/** The signed median of the sounds near its points must be within this: not to one side. */
const SIDE = 0.006;
/** A subdivision holds only where at least this share of the stretch's sounds are on its points, and CHANCE times what scattered sounds would give. */
const EXPLAINS = 0.3;
const CHANCE = 1.8;
/** The subdivisions tried, and the share of the sounds a finer one must explain over 16ths. */
const DIVISIONS = [4, 3, 6] as const;
const FINER = 1.25;
/** Beats each side a beat is smoothed over, and checked for its subdivision with. */
const SMOOTH = 4;
const ALIGN = 6;
const CHECK = 3;

/**
 * The beat map of a song whose grid is `spb` seconds a beat from `offset` (`meter` beats a bar),
 * from the tracker's `beats` and the measured sounds (`sounds`, seconds). Null when the tracker's
 * beat isn't the grid's (or half or double it), or it found too few.
 */
export function beatMap(tracked: TrackedBeats, sounds: number[], grid: { spb: number; offset: number; meter: number }): BeatMap | null {
  const { spb } = grid;
  let raw = [...tracked.beats].sort((a, b) => a - b);
  if (raw.length < 8 || !(spb > 0)) return null;
  const gaps = raw.slice(1).map((b, i) => b - raw[i]).sort((a, b) => a - b);
  const ratio = gaps[gaps.length >> 1] / spb;
  if (Math.abs(ratio - 0.5) < 0.06) {
    // At double time: every other beat, the ones nearer the grid's beats.
    const off = (k: number) => raw.filter((_, i) => i % 2 === k).reduce((a, b) => a + Math.abs(wrap((b - grid.offset) / spb)), 0);
    const k = off(0) <= off(1) ? 0 : 1;
    raw = raw.filter((_, i) => i % 2 === k);
  } else if (Math.abs(ratio - 2) < 0.15) {
    // At half time: the beats between them too.
    raw = raw.flatMap((b, i) => (i + 1 < raw.length ? [b, (b + raw[i + 1]) / 2] : [b]));
  } else if (Math.abs(ratio - 1) > 0.08) return null;

  // Consecutive beats: one that comes too soon is left out; a gap of two or more beats is filled.
  const secs: number[] = [raw[0]];
  let period = spb;
  for (let i = 1; i < raw.length; i++) {
    const gap = raw[i] - secs[secs.length - 1];
    const r = gap / period;
    if (r < 0.7) continue;
    const k = Math.max(1, Math.round(r));
    for (let j = 1; j < k; j++) secs.push(secs[secs.length - 1] + gap / k);
    secs.push(raw[i]);
    // The local period follows the song (a tempo that drifts), never far from the grid's.
    period = Math.min(spb * 1.15, Math.max(spb * 0.87, 0.8 * period + 0.2 * (gap / k)));
  }
  if (secs.length < 8) return null;

  // Smoothed: each beat where a straight line through its neighbours puts it (beats far off the
  // line left out of it).
  const smooth = secs.map((_, i) => {
    const lo = Math.max(0, i - SMOOTH), hi = Math.min(secs.length - 1, i + SMOOTH);
    let fit = line(secs, lo, hi, () => true);
    const p = fit.slope;
    fit = line(secs, lo, hi, (j) => Math.abs(secs[j] - (fit.at + fit.slope * j)) < p * 0.12);
    return fit.at + fit.slope * i;
  });

  // Lined up with the attacks: each beat moves by how far the sounds within 35 ms of the beats
  // around it (ALIGN each side, nearer ones counting more) are from those beats, on average with the
  // farthest quarter left out (a kick or a snare marks the beat to a few ms; a median here flipped
  // between two clusters from one beat to the next and the beats jittered 20 ms).
  const sorted = [...sounds].sort((a, b) => a - b);
  const offs = smooth.map((b) => { const s = nearest(sorted, b); return s !== undefined && Math.abs(s - b) < 0.035 ? s - b : null; });
  const moved = smooth.map((b, i) => {
    const d: { v: number; w: number }[] = [];
    for (let j = Math.max(0, i - ALIGN); j <= Math.min(smooth.length - 1, i + ALIGN); j++) {
      const v = offs[j];
      if (v != null) d.push({ v, w: ALIGN + 1 - Math.abs(i - j) });
    }
    if (d.length < 3) return b;
    d.sort((x, y) => x.v - y.v);
    const trim = Math.floor(d.length / 8);
    let sw = 0, sv = 0;
    for (const x of d.slice(trim, d.length - trim)) { sw += x.w; sv += x.w * x.v; }
    return b + sv / sw;
  });

  // Bars: the beat the grid's downbeats fall on (counted near the start, where the grid sits on the beat).
  const meter = grid.meter === 3 ? 3 : 4;
  const votes = new Array<number>(meter).fill(0);
  for (let i = 0; i < Math.min(moved.length, 16); i++) {
    const k = Math.round((moved[i] - grid.offset) / spb);
    votes[(((k - i) % meter) + meter) % meter]++;
  }
  // Beat i is a downbeat when (i + shift) % meter == 0, shift being the vote's winner.
  const shift = votes.indexOf(Math.max(...votes));
  const downbeat = (((-shift) % meter) + meter) % meter;

  const map: BeatMap = { secs: moved, meter, downbeat, division: new Uint8Array(moved.length) };
  map.division = divisions(map, sorted);
  return map;
}

function wrap(x: number) { return x - Math.round(x); }

/** The least-squares line through points (j, secs[j]) for j in lo..hi that `use` keeps. */
function line(secs: number[], lo: number, hi: number, use: (j: number) => boolean) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let j = lo; j <= hi; j++) {
    if (!use(j)) continue;
    n++; sx += j; sy += secs[j]; sxx += j * j; sxy += j * secs[j];
  }
  const den = n * sxx - sx * sx;
  if (n < 2 || den <= 0) {
    const slope = hi > lo ? (secs[hi] - secs[lo]) / (hi - lo) : 0.5;
    return { at: secs[lo] - slope * lo, slope };
  }
  const slope = (n * sxy - sx * sy) / den;
  return { at: (sy - slope * sx) / n, slope };
}

function nearest(sorted: number[], x: number): number | undefined {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  const a = sorted[lo - 1], b = sorted[lo];
  if (a === undefined) return b;
  if (b === undefined) return a;
  return x - a <= b - x ? a : b;
}

/** The beat (fractional: 2.5 is halfway from beat 2 to beat 3) heard at `sec`; before the first or after the last, at the edge's tempo. */
export function beatAt(map: BeatMap, sec: number): number {
  const s = map.secs;
  if (sec <= s[0]) return (sec - s[0]) / (s[1] - s[0]);
  const last = s.length - 1;
  if (sec >= s[last]) return last + (sec - s[last]) / (s[last] - s[last - 1]);
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= sec) lo = m; else hi = m; }
  return lo + (sec - s[lo]) / (s[lo + 1] - s[lo]);
}

/** When beat `beat` (fractional) is heard, in seconds. */
export function secAt(map: BeatMap, beat: number): number {
  const s = map.secs, last = s.length - 1;
  if (beat <= 0) return s[0] + beat * (s[1] - s[0]);
  if (beat >= last) return s[last] + (beat - last) * (s[last] - s[last - 1]);
  const i = Math.floor(beat);
  return s[i] + (beat - i) * (s[i + 1] - s[i]);
}

/** The subdivision followed around beat `beat` (0: none holds there). */
export function divisionAt(map: BeatMap, beat: number): number {
  const i = Math.min(map.division.length - 1, Math.max(0, Math.floor(beat)));
  return map.division[i];
}

/**
 * Each beat's subdivision: of 16ths, 8th triplets and 16th triplets, the one that puts the most of
 * the sounds around it (CHECK beats each side) on its points, a finer one only when it explains
 * FINER times as many as 16ths do; and it holds as the straight grid's check has it (automap.ts
 * gridHolds): sounds peak on its points (on ≥ ¾ of beside, at least 6 near), not to one side.
 */
function divisions(map: BeatMap, sorted: number[]): Uint8Array {
  const n = map.secs.length;
  const out = new Uint8Array(n);
  // Each sound's beat position, once.
  const pos = sorted.map((s) => beatAt(map, s));
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const from = i - CHECK, to = i + 1 + CHECK;
    while (lo < pos.length && pos[lo] < from) lo++;
    const tally = DIVISIONS.map((d) => {
      let on = 0, beside = 0, all = 0;
      const near: number[] = [];
      for (let k = lo; k < pos.length && pos[k] < to; k++) {
        const p = pos[k];
        const q = Math.round(p * d) / d;
        const r = sorted[k] - secAt(map, q);
        const a = Math.abs(r);
        all++;
        if (a < ON) on++;
        else if (a < BESIDE) beside++;
        if (a < 0.02) near.push(r);
      }
      near.sort((x, y) => x - y);
      // Scattered sounds land on its points by chance this often (at 120 BPM: 16ths 16%, 16th
      // triplets 24%): it must explain clearly more than that.
      const beatLen = map.secs[Math.min(n - 1, i + 1)] - map.secs[Math.max(0, Math.min(n - 2, i))];
      const chance = Math.min(1, (2 * ON * d) / Math.max(0.2, beatLen));
      const holds = on + beside >= 6 && on >= beside && on >= all * Math.max(EXPLAINS, CHANCE * chance) && Math.abs(near[near.length >> 1] ?? 1) <= SIDE;
      return { d, on, holds };
    });
    // 16ths unless triplets explain clearly more (16th triplets clearly more than 8th triplets).
    const four = tally[0];
    let best = four.holds ? 4 : 0, bestOn = four.holds ? four.on : 0;
    for (const t of tally.slice(1)) {
      if (t.holds && t.on > four.on * FINER && t.on > bestOn * (best && best !== 4 ? FINER : 1)) { best = t.d; bestOn = t.on; }
    }
    out[i] = best;
  }
  return out;
}

/**
 * Where a sound heard at `sec` belongs on the beat map: on its stretch's subdivision when one is
 * within `tol` seconds and the stretch follows it; else at its own time. In seconds.
 */
export function snapSec(map: BeatMap, sec: number, tol = 0.02): number {
  const p = beatAt(map, sec);
  const d = divisionAt(map, p);
  if (!d) return sec;
  const q = Math.round(p * d) / d;
  const at = secAt(map, q);
  return Math.abs(at - sec) <= tol ? at : sec;
}

/** Where `sec` sits in its beat: 'beat' (on it), 'half' (an 8th after), or null; within `tol` seconds. */
export function beatPlace(map: BeatMap, sec: number, tol = 0.02): 'beat' | 'half' | null {
  const p = beatAt(map, sec);
  const i = Math.floor(p + 0.5);
  if (Math.abs(secAt(map, i) - sec) <= tol) return 'beat';
  const h = Math.floor(p) + 0.5;
  return Math.abs(secAt(map, h) - sec) <= tol ? 'half' : null;
}

/** The bar a beat is in (0 = the bar the map's first downbeat starts; negative before it). */
export function barOf(map: BeatMap, beat: number): number {
  return Math.floor((beat - map.downbeat) / map.meter);
}
