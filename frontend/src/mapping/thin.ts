// Easier charts from a harder one: a subset of its tiles, never a new one. Used on the trained
// mapper's chart (ensomi.ts), whose lowest star rating is still busier than this game's Hard.
//
// Each row (the tiles of one moment) gets a weight: how strongly its sound stood out (the onset
// mapper's measure of the sound it's on), bigger for chords, and for downbeats and beats when the
// beat grid is trusted (not for holds: they were kept first, and easier charts filled up with them).
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
 * them; Ultra the whole chart. `rate` caps a very busy song (tiles a second), `floor` keeps a sparse
 * one from emptying.
 */
export const KEEP: Record<Difficulty, Pick<ThinOptions, 'rate' | 'floor' | 'minGap' | 'share' | 'maxChord' | 'chords' | 'holdsAlone' | 'minHold'>> = {
  easy: { share: 0.34, rate: 2.2, floor: 0.9, minGap: 0.26, maxChord: 1, chords: 0, holdsAlone: true, minHold: [1, 0.45] },
  medium: { share: 0.5, rate: 3.2, floor: 1.3, minGap: 0.17, maxChord: 2, chords: 0.04, holdsAlone: true, minHold: [0.75, 0.35] },
  hard: { share: 0.7, rate: 4.6, floor: 1.8, minGap: 0.11, maxChord: 2, chords: 0.15, holdsAlone: false, minHold: [0.5, 0.25] },
  // The whole chart (chords of two at most, nothing closer than a 16th at 250 BPM).
  ultra: { share: 1, rate: 1000, floor: 0, minGap: 0.06, maxChord: 2, chords: 1, holdsAlone: false, minHold: [0, 0] },
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
  /** Nothing starts while a kept hold is held (else other lanes go on under it). */
  holdsAlone: boolean;
  /** Weigh beats over offbeats (only when the grid is right). */
  onGrid: boolean;
  /** The sounds the onset mapper found (sorted by time). */
  events: SoundEvent[];
  /** Beat 0 in seconds (events are in seconds into the audio). */
  offset: number;
}

const WINDOW = 4; // seconds

type Row = { t: number; notes: ChartNote[]; w: number; end: number };

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
    // On a beat or half-beat: within 20 ms of one (tiles are put on the grid only where it holds).
    const tol = Math.max(0.01, 0.02 / o.spb);
    const pos = r.t - Math.floor(r.t + tol);
    const grid = !o.onGrid ? 0 : Math.abs(pos) < tol || pos > 1 - tol ? 0.2 : Math.abs(pos - 0.5) < tol ? 0.1 : 0;
    const bar = o.onGrid && grid === 0.2 && Math.round(r.t) % 4 === 0 ? 0.1 : 0;
    // Holds too short for this difficulty are taps here.
    const minHold = Math.max(o.minHold[0], o.minHold[1] / o.spb);
    const notes = r.notes.map((n) => (n.hold && n.len < minHold ? tap(n) : n));
    const len = Math.max(0, ...notes.map((n) => (n.hold ? n.len : 0)));
    return { t: r.t, notes, w: strengthAt(o.events, sec, cursor) + 0.25 * (r.notes.length - 1) + grid + bar, end: r.t + len };
  });

  // Each window's share of the source's tiles: `share` of them, within `floor` and `rate` a second.
  const first = rows[0].t * o.spb, lastT = rows[rows.length - 1].t * o.spb;
  const span = Math.max(1, lastT - first);
  const total = rows.reduce((a, r) => a + r.notes.length, 0);
  const keep = Math.min(1, Math.max(Math.min(o.share, (o.rate * span) / total), (o.floor * span) / total));
  const win = (r: Row) => Math.floor((r.t * o.spb) / WINDOW);
  const inWin = new Map<number, number>();
  for (const r of rows) inWin.set(win(r), (inWin.get(win(r)) ?? 0) + r.notes.length);
  const budget = new Map<number, number>();
  for (const [k, n] of inWin) budget.set(k, Math.max(1, Math.round(n * keep)));
  // Chords: the heaviest rows with more than one tile, up to `chords` of the rows kept.
  let chordsLeft = o.maxChord < 2 ? 0 : o.chords >= 1 ? Infinity : Math.round(o.chords * keep * rows.length);

  const gapBeats = o.minGap / o.spb;
  const kept: { r: Row; notes: ChartNote[] }[] = [];
  let prevLane = -1;
  for (const r of [...rows].sort((a, b) => b.w - a.w || a.t - b.t)) {
    const k = win(r);
    if ((budget.get(k) ?? 0) <= 0) continue;
    const clash = kept.some(({ r: q }) => Math.abs(q.t - r.t) < gapBeats || (o.holdsAlone && (
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
  kept.sort((a, b) => a.r.t - b.r.t);
  // A single tile taken from a chord: not the lane of the row before when it can help it.
  const out: ChartNote[] = [];
  for (const { r, notes } of kept) {
    const pick = notes.length === 1 && r.notes.length > 1 ? capChord(r.notes, 1, prevLane) : notes;
    out.push(...pick);
    prevLane = pick[pick.length - 1].lane;
  }
  return out;
}

/** A hold as a tap (the same note). */
function tap(n: ChartNote): ChartNote {
  const { hold: _hold, ...rest } = n;
  return { ...rest, len: 0.25 };
}
