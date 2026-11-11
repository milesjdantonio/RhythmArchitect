// Easier charts from a harder one: a subset of its tiles, never a new one. Used on the trained
// mapper's chart (ensomi.ts), whose lowest star rating is still busier than this game's Hard.
//
// Each row (the tiles of one moment) gets a weight: how strongly its sound stood out (the onset
// mapper's measure of the sound it's on), bigger for chords and holds, and for downbeats and beats
// when the beat grid is trusted. The heaviest rows are kept first, as long as they leave room
// (`minGap` seconds to the next tile; on easier charts, nothing starting under a hold) and every few
// seconds of the song keep their share of the harder chart's tiles (so quiet parts stay quieter
// than choruses).

import type { ChartNote, SoundEvent } from '../api/types';

export interface ThinOptions {
  /** Seconds per beat and where beat 0 is, to turn beats into seconds. */
  spb: number;
  /** At least this long between the starts of two kept rows. */
  minGap: number;
  /** Rows a second to aim for on average (each window keeps its share of the source at this rate). */
  rate: number;
  /** Keep at most this share of the source's rows (for a source that is sparse already). */
  share: number;
  /** Most tiles in one row. */
  maxChord: number;
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

/** How strongly the sound at `sec` stood out (0..1.3), 0.3 when none was found within 50 ms. */
function strengthAt(events: SoundEvent[], sec: number, from: { i: number }): number {
  while (from.i < events.length - 1 && events[from.i + 1].sec <= sec) from.i++;
  let best: SoundEvent | undefined;
  for (const e of [events[from.i], events[from.i + 1]]) {
    if (e && Math.abs(e.sec - sec) < 0.05 && (!best || Math.abs(e.sec - sec) < Math.abs(best.sec - sec))) best = e;
  }
  return best ? best.strength + (best.accent ? 0.3 : 0) : 0.3;
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
    const hold = r.notes.some((n) => n.hold);
    const pos = r.t - Math.floor(r.t + 0.001);
    const grid = !o.onGrid ? 0 : Math.abs(pos) < 0.01 || pos > 0.99 ? 0.2 : Math.abs(pos - 0.5) < 0.01 ? 0.1 : 0;
    const bar = o.onGrid && grid === 0.2 && Math.round(r.t) % 4 === 0 ? 0.1 : 0;
    const len = Math.max(0, ...r.notes.map((n) => (n.hold ? n.len : 0)));
    return { t: r.t, notes: r.notes, w: strengthAt(o.events, sec, cursor) + 0.25 * (r.notes.length - 1) + (hold ? 0.2 : 0) + grid + bar, end: r.t + len };
  });

  // Each window's share of the source's rows at the target rate.
  const first = rows[0].t * o.spb, lastT = rows[rows.length - 1].t * o.spb;
  const span = Math.max(1, lastT - first);
  const keep = Math.min(o.share, (o.rate * span) / rows.length);
  const win = (r: Row) => Math.floor((r.t * o.spb) / WINDOW);
  const inWin = new Map<number, number>();
  for (const r of rows) inWin.set(win(r), (inWin.get(win(r)) ?? 0) + 1);
  const budget = new Map<number, number>();
  for (const [k, n] of inWin) budget.set(k, Math.max(1, Math.round(n * keep)));

  const gapBeats = o.minGap / o.spb;
  const kept: Row[] = [];
  for (const r of [...rows].sort((a, b) => b.w - a.w || a.t - b.t)) {
    const k = win(r);
    if ((budget.get(k) ?? 0) <= 0) continue;
    const clash = kept.some((q) => Math.abs(q.t - r.t) < gapBeats || (o.holdsAlone && (
      // nothing starts while a kept hold is held, and a hold doesn't run over a kept tile
      (q.end > q.t && r.t > q.t && r.t < q.end + gapBeats)
      || (r.end > r.t && q.t > r.t && q.t < r.end + gapBeats))));
    if (clash) continue;
    kept.push(r);
    budget.set(k, (budget.get(k) ?? 0) - 1);
  }
  kept.sort((a, b) => a.t - b.t);
  const out: ChartNote[] = [];
  let prev = -1;
  for (const r of kept) {
    const notes = capChord(r.notes, o.maxChord, prev);
    out.push(...notes);
    prev = notes[notes.length - 1].lane;
  }
  return out;
}
