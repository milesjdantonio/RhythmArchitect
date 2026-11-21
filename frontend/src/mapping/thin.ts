// Easier charts from a harder one: a subset of its tiles, never a new one. Used on the trained
// mapper's chart (ensomi.ts), whose lowest star rating is still busier than this game's Hard.
//
// Each row (the tiles of one moment) gets a weight: how strongly its sound stood out (the onset
// mapper's measure of the sound it's on), bigger for chords, and for downbeats and beats when the
// beat grid is trusted (not for holds: they were kept first, and easier charts filled up with them),
// and for a strong sound pushing just ahead of a beat (an anticipation: ANTICIPATION) over that beat.
// The heaviest rows are kept first, as long as they leave room (`minGap` seconds to the next tile;
// on easier charts, nothing starting under a hold) and every few seconds of the song keep their
// share of the harder chart's tiles (so quiet parts stay quieter than choruses). Shares are counted
// in tiles, so a chord counts twice.

import type { ChartNote, Difficulty, SoundEvent } from '../api/types';

/**
 * How each difficulty keeps tiles of the full chart (Ultra). Each step keeps about 0.7 of the tiles
 * of the one above it, so every step is about the same jump (Easy about a third of Ultra, Medium
 * half, Hard 0.7: before, Medium to Hard doubled the tiles while Hard to Ultra added a tenth), and
 * chords, holds and spacing come in gradually: Easy one at a time, long holds only; Medium closer,
 * a chord of two on the biggest hits; Hard closer again, more chords, shorter holds and taps under
 * them; Ultra the whole chart. `rate` caps a very busy song (tiles a second; the caps are about 0.7
 * of each other too, so on a fast, busy song every step stays the same: with Hard's at 4.6 the
 * benchmark's 188 BPM band went ×1.9 from Hard to Ultra), `floor` keeps a sparse one from
 * emptying, and `maxHolds` keeps any chart from filling up with holds (the shortest go first:
 * 55% of Hard's tiles were holds on the benchmark's 92 BPM band, whose melody rings).
 */
/**
 * The ladder KEEP makes (saved in a song's report): 2 since Nov 19, 2026 (even steps, chords and
 * holds brought in gradually, holds capped). Songs the trained mapper made before it are made
 * again from their Ultra (upgrade.ts rethinSong).
 */
export const LADDER = 2;

export const KEEP: Record<Difficulty, Pick<ThinOptions, 'rate' | 'floor' | 'minGap' | 'share' | 'maxChord' | 'chords' | 'holdsAlone' | 'minHold' | 'maxHolds'>> = {
  easy: { share: 0.34, rate: 2.6, floor: 0.9, minGap: 0.26, maxChord: 1, chords: 0, holdsAlone: true, minHold: [0.5, 0.35], maxHolds: 0.15 },
  medium: { share: 0.5, rate: 3.8, floor: 1.3, minGap: 0.15, maxChord: 2, chords: 0.04, holdsAlone: true, minHold: [0.5, 0.25], maxHolds: 0.2 },
  hard: { share: 0.7, rate: 5.6, floor: 1.8, minGap: 0.11, maxChord: 2, chords: 0.15, holdsAlone: false, minHold: [0.5, 0.25], maxHolds: 0.25 },
  // The whole chart (chords of two at most, nothing closer than a 16th at 250 BPM).
  ultra: { share: 1, rate: 1000, floor: 0, minGap: 0.06, maxChord: 2, chords: 1, holdsAlone: false, minHold: [0, 0], maxHolds: 0.3 },
};

export interface ThinOptions {
  /** Seconds per beat and where beat 0 is, to turn beats into seconds. */
  spb: number;
  /** At least this long between the starts of two kept rows. */
  minGap: number;
  /** Keep this share of the source's tiles... */
  share: number;
  /** ...but at most this many tiles a second on average (each window keeps its share)... */
  rate: number;
  /** ...and at least this many (a sparse source), up to all of them. */
  floor: number;
  /** Most tiles in one row. */
  maxChord: number;
  /** The share of kept rows that may be chords (the heaviest; the rest keep one tile). */
  chords: number;
  /** A hold shorter than this many beats or seconds (either) is a tap here. */
  minHold: [number, number];
  /** At most this share of the kept tiles are holds (the shortest past it are taps). Default: no limit. */
  maxHolds?: number;
  /** Nothing starts while a kept hold is held (else other lanes go on under it). */
  holdsAlone: boolean;
  /** Weigh beats over offbeats (only when the grid is right). */
  onGrid: boolean;
  /** The sounds the onset mapper found (sorted by time). */
  events: SoundEvent[];
  /** Beat 0 in seconds (events are in seconds into the audio). */
  offset: number;
  /**
   * Where a moment (beats) sits in the music's own beat (the beat map: beatmap.ts), when it's
   * known: on a beat, an 8th after one, a bar's downbeat. Without it, the song's straight grid
   * says (and only when `onGrid`).
   */
  place?: (t: number) => { beat: boolean; half: boolean; downbeat: boolean };
  /** The moment (beats) a row repeats, in an earlier phrase (repeats.ts): kept or left out as that one was. */
  twin?: (t: number) => number | null;
  /** The kind of sound a row is on (its band), and its phrase: rows of the kind a phrase follows weigh `follow` more. */
  kind?: (t: number) => string | null;
  phrase?: (t: number) => number;
  follow?: number;
  /** How clearly a row's moment is sung (0: not; voice.ts): sung rows weigh SUNG more, scaled by it. */
  sung?: (t: number) => number;
  /**
   * The song's shape at a moment (beats; shape.ts): each window keeps its share times the mean of
   * its rows' scales, so a busy part keeps more than its share and a quiet one less.
   */
  intensity?: (t: number) => number;
  /** A moment (beats) in the breath before a drop: left out. */
  breath?: (t: number) => boolean;
  /** How much closer than `minGap` tiles may come at a moment (beats): 1 the difficulty's own (shape.ts spacing). */
  spacing?: (t: number) => number;
  /** Each window keeps at least this many tiles a second (where it has them: shape.ts STRETCH_FLOOR). */
  minRate?: number;
  /** Where `holdsAlone` is waived (beats): a busy phrase (shape.ts HOLDS_FREE). */
  holdsFree?: (t: number) => boolean;
}

/** A repeated phrase in a part this busy (intensity) isn't held to what its twin left out: it can build on it. */
const GROW_FROM = 1.05;

/**
 * Anticipations (syncopation): a sound off the beat at least ANTICIPATION_CUT strong, leading
 * within half a beat into a beat whose sound is no stronger (by ANTICIPATION_MARGIN), weighs
 * ANTICIPATION more, and that beat half as much less: an easier chart keeps the push, not the beat
 * after it, as people chart it. Without it the beat's extra weight (the grid's) won every time: on
 * One Dance (whose stabs come a 16th before the beat) Easy kept 9% of its tiles on off 16ths and
 * Medium 8%, the fan chart 34%; with it 19% and 15%. On the Creative Commons benchmark (Nov 20)
 * the match with the human charts held (F1 63%) and Easy came off the beat toward theirs (66% →
 * 58% on the beat; humans' easiest 44%). Chords were left as the model makes them: ours already
 * match the human charts' share and clustering there (27% / 29%; 61% / 60% within a beat of the
 * last), and nothing in the sound tells which songs people chart without them.
 */
const ANTICIPATION = 0.4;
const ANTICIPATION_CUT = 0.3;
const ANTICIPATION_MARGIN = 0.05;
/**
 * What a sung row weighs extra (times how clearly it's sung: voice.ts): the charts go with the
 * lyrics. On two real listens (Nov 20, One Dance and Open Your Eyes) Easy went from 28% of its
 * tiles on a sung syllable to 47% at weight 1 and 59% / 53% at 2, Medium 30% → 53% / 28% → 43%,
 * with the same stars and ladder steps; rows nobody sings over weigh as before.
 */
export const SUNG = { weight: 2 };

/** What a row weighs extra (or less) for being kept (left out) where the phrase it repeats kept (left out) its twin. */
const TWIN_KEEP = 0.6;

const WINDOW = 4; // seconds

type Row = { t: number; notes: ChartNote[]; w: number; end: number; s: number; onBeat: boolean };

function rowsOf(notes: ChartNote[]): { t: number; notes: ChartNote[] }[] {
  const rows: { t: number; notes: ChartNote[] }[] = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t || a.lane - b.lane)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.t - n.t) < 0.002) last.notes.push(n);
    else rows.push({ t: n.t, notes: [n] });
  }
  return rows;
}

/** How strongly the sound at `sec` stood out (0..1.3), 0.05 when none was found within 50 ms (easier charts keep the tiles you can hear). */
function strengthAt(events: SoundEvent[], sec: number, from: { i: number }): number {
  while (from.i < events.length - 1 && events[from.i + 1].sec <= sec) from.i++;
  let best: SoundEvent | undefined;
  for (const e of [events[from.i], events[from.i + 1]]) {
    if (e && Math.abs(e.sec - sec) < 0.05 && (!best || Math.abs(e.sec - sec) < Math.abs(best.sec - sec))) best = e;
  }
  return best ? best.strength + (best.accent ? 0.3 : 0) : 0.05;
}

/** Fewer tiles in a row: holds first, then a lane other than the last row's, then the outer lanes. */
export function capChord(notes: ChartNote[], max: number, prevLane: number): ChartNote[] {
  if (notes.length <= max) return notes;
  if (max >= 2) {
    // The outermost pair (two hands), a hold kept if there is one.
    const sorted = [...notes].sort((a, b) => a.lane - b.lane);
    const hold = sorted.find((n) => n.hold);
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    const pair = hold && hold !== lo && hold !== hi ? [hold, Math.abs(hold.lane - lo.lane) > Math.abs(hold.lane - hi.lane) ? lo : hi] : [lo, hi];
    return pair.sort((a, b) => a.lane - b.lane).slice(0, max);
  }
  const pick = [...notes].sort((a, b) => Number(!!b.hold) - Number(!!a.hold) || Number(a.lane === prevLane) - Number(b.lane === prevLane))[0];
  return [pick];
}

/** The rows of `notes` worth keeping at a lower difficulty, by the rules above. */
export function thinChart(notes: ChartNote[], o: ThinOptions): ChartNote[] {
  const src = rowsOf(notes);
  if (!src.length) return [];
  const cursor = { i: 0 };
  const rows: Row[] = src.map((r) => {
    const sec = o.offset + r.t * o.spb;
    // On a beat or half-beat: on the beat map when there is one, else within 20 ms of one on the
    // straight grid (only when it's right: tiles are put on it only where it holds).
    let at = o.place?.(r.t);
    if (!at && o.onGrid) {
      const tol = Math.max(0.01, 0.02 / o.spb);
      const pos = r.t - Math.floor(r.t + tol);
      const beat = Math.abs(pos) < tol || pos > 1 - tol;
      at = { beat, half: !beat && Math.abs(pos - 0.5) < tol, downbeat: beat && Math.round(r.t) % 4 === 0 };
    }
    const grid = !at ? 0 : at.beat ? 0.2 + (at.downbeat ? 0.1 : 0) : at.half ? 0.1 : 0;
    // Holds too short for this difficulty are taps here.
    const minHold = Math.max(o.minHold[0], o.minHold[1] / o.spb);
    const notes = r.notes.map((n) => (n.hold && n.len < minHold ? tap(n) : n));
    const len = Math.max(0, ...notes.map((n) => (n.hold ? n.len : 0)));
    const s = strengthAt(o.events, sec, cursor);
    const sung = o.sung ? o.sung(r.t) : 0;
    return { t: r.t, notes, w: s + 0.25 * (r.notes.length - 1) + grid + SUNG.weight * sung, end: r.t + len, s, onBeat: !!at?.beat };
  });
  // Anticipations: a strong sound off the beat, just before a beat whose sound is no stronger,
  // is the rhythm's push (syncopation): it weighs more, and the beat it leads into less. (Only
  // where the beat is known: `at` above.)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.onBeat || r.s < ANTICIPATION_CUT || !(o.place || o.onGrid)) continue;
    for (let j = i + 1; j < rows.length && rows[j].t - r.t <= 0.51; j++) {
      const q = rows[j];
      if (!q.onBeat) continue;
      if (r.s >= q.s - ANTICIPATION_MARGIN) { r.w += ANTICIPATION; q.w -= ANTICIPATION / 2; }
      break;
    }
  }

  // Each phrase follows one kind of sound (the one its rows weigh most in, as the whole chart has
  // them): its rows of that kind weigh more, so an easier chart doesn't hop between the kick and the tune.
  if (o.kind && o.phrase && o.follow) {
    const kinds = rows.map((r) => o.kind!(r.t));
    const lead = new Map<number, Map<string, number>>();
    rows.forEach((r, i) => {
      const k = kinds[i];
      if (!k) return;
      const ph = o.phrase!(r.t);
      const m = lead.get(ph) ?? new Map<string, number>();
      m.set(k, (m.get(k) ?? 0) + r.w);
      lead.set(ph, m);
    });
    const top = new Map<number, string>();
    for (const [ph, m] of lead) top.set(ph, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    rows.forEach((r, i) => { if (kinds[i] && top.get(o.phrase!(r.t)) === kinds[i]) r.w += o.follow!; });
  }

  // Each window's share of the source's tiles: `share` of them, within `floor` and `rate` a second.
  const first = rows[0].t * o.spb, lastT = rows[rows.length - 1].t * o.spb;
  const span = Math.max(1, lastT - first);
  const total = rows.reduce((a, r) => a + r.notes.length, 0);
  const keep = Math.min(1, Math.max(Math.min(o.share, (o.rate * span) / total), (o.floor * span) / total));
  const win = (r: Row) => Math.floor((r.t * o.spb) / WINDOW);
  const inWin = new Map<number, number>();
  for (const r of rows) inWin.set(win(r), (inWin.get(win(r)) ?? 0) + r.notes.length);
  // Each window's scale from the song's shape: the mean of its rows'.
  const winScale = new Map<number, number>();
  if (o.intensity && keep < 1) {
    const sum = new Map<number, [number, number]>();
    for (const r of rows) { const k = win(r), x = sum.get(k) ?? [0, 0]; x[0] += o.intensity(r.t); x[1]++; sum.set(k, x); }
    for (const [k, [a, n]] of sum) winScale.set(k, a / n);
  }
  const gapBeats = o.minGap / o.spb;
  let prevLane = -1;
  /** The heaviest rows that fit, by the rules above. */
  const select = (weight: (r: Row) => number) => {
    const budget = new Map<number, number>();
    const least = Math.round((o.minRate ?? 0) * WINDOW);
    for (const [k, n] of inWin) budget.set(k, Math.max(1, Math.min(n, Math.max(least, Math.round(n * keep * (winScale.get(k) ?? 1))))));
    // Chords: the heaviest rows with more than one tile, up to `chords` of the rows kept.
    let chordsLeft = o.maxChord < 2 ? 0 : o.chords >= 1 ? Infinity : Math.round(o.chords * keep * rows.length);
    const kept: { r: Row; notes: ChartNote[] }[] = [];
    for (const r of [...rows].sort((a, b) => weight(b) - weight(a) || a.t - b.t)) {
      const k = win(r);
      if ((budget.get(k) ?? 0) <= 0) continue;
      if (o.breath?.(r.t)) continue;
      const g = gapBeats * (o.spacing ? o.spacing(r.t) : 1);
      const alone = o.holdsAlone && !o.holdsFree?.(r.t);
      const clash = kept.some(({ r: q }) => Math.abs(q.t - r.t) < g || (alone && !o.holdsFree?.(q.t) && (
        // nothing starts while a kept hold is held, and a hold doesn't run over a kept tile
        (q.end > q.t && r.t > q.t && r.t < q.end + gapBeats)
        || (r.end > r.t && q.t > r.t && q.t < r.end + gapBeats))));
      if (clash) continue;
      const chord = r.notes.length > 1 && chordsLeft > 0;
      const notes = capChord(r.notes, chord ? o.maxChord : 1, prevLane);
      if (notes.length > 1) chordsLeft--;
      kept.push({ r, notes });
      budget.set(k, (budget.get(k) ?? 0) - notes.length);
    }
    return kept;
  };
  let kept = select((r) => r.w);
  // A repeated phrase keeps what the phrase it repeats kept: a row whose twin was kept weighs
  // more, one whose twin was left out weighs less (a twin within 30 ms of where it should be).
  if (o.twin && keep < 1) {
    const keptAt = kept.map(({ r }) => r.t).sort((a, b) => a - b);
    const allAt = rows.map((r) => r.t).sort((a, b) => a - b);
    const tol = 0.03 / o.spb;
    const nudge = new Map<Row, number>();
    for (const r of rows) {
      const tw = o.twin(r.t);
      if (tw == null || !near(allAt, tw, tol)) continue;
      const kept = near(keptAt, tw, tol);
      // In a busy part a repeat may add to what its twin kept (it builds), not only copy it.
      if (!kept && o.intensity && o.intensity(r.t) >= GROW_FROM) continue;
      nudge.set(r, kept ? TWIN_KEEP : -TWIN_KEEP);
    }
    if (nudge.size) kept = select((r) => r.w + (nudge.get(r) ?? 0));
  }
  kept.sort((a, b) => a.r.t - b.r.t);
  // A single tile taken from a chord: not the lane of the row before when it can help it.
  const out: ChartNote[] = [];
  for (const { r, notes } of kept) {
    const pick = notes.length === 1 && r.notes.length > 1 ? capChord(r.notes, 1, prevLane) : notes;
    out.push(...pick);
    prevLane = pick[pick.length - 1].lane;
  }
  // Too many holds: the shortest become taps until the rest fit.
  const holds = out.filter((n) => n.hold);
  const room = Math.floor((o.maxHolds ?? 1) * out.length);
  if (holds.length > room) {
    const drop = new Set([...holds].sort((a, b) => a.len - b.len).slice(0, holds.length - room));
    return out.map((n) => (drop.has(n) ? tap(n) : n));
  }
  return out;
}

/** Whether a sorted list has a value within `tol` of `x`. */
function near(sorted: number[], x: number, tol: number): boolean {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  return (lo < sorted.length && Math.abs(sorted[lo] - x) <= tol) || (lo > 0 && Math.abs(sorted[lo - 1] - x) <= tol);
}

/** A hold as a tap (the same note). */
function tap(n: ChartNote): ChartNote {
  const { hold: _hold, ...rest } = n;
  return { ...rest, len: 0.25 };
}
