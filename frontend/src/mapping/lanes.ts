// Lane flow: the lanes of a chart thinned from a busier one, made playable without moving a tile in
// time. Thinning keeps the trained mapper's lanes, which were written for its whole chart; with
// tiles taken out between them, an easier chart is left with the same lane twice in a row
// ("jacks"), edge-to-edge jumps and long runs on one hand that its own speed doesn't call for.
//
// Each single tile, in time order, takes the lane with the lowest cost: moving off the model's
// lane costs a little (the chart stays the model's where it plays well), the lane just played
// costs more the sooner it comes again and the easier the difficulty, an edge-to-edge jump soon
// after costs, a long run on one hand costs, and a lane used a lot lately costs a little. A lane
// still held is never taken. Chords keep their lanes. Measured against human charts with
// tools/map-human.mjs (src/mapping/patterns.ts).

import type { ChartNote, Difficulty } from '../api/types';

interface Flow {
  /** A tile the same lane as the one before, this soon (seconds), costs JACK_COST (less as it's later). */
  jack: number;
  /** How much a quick repeat costs, against MOVE_COST for leaving the model's lane. */
  jackCost: number;
  /** Edge to edge this soon costs JUMP_COST. */
  jump: number;
  /** A run on one hand this long (tiles under `jack` apart) starts to cost. */
  run: number;
  /** Each lane moved past the first, from the tile before (human charts mostly step a lane at a time). */
  far: number;
  /** Each time the lane was played in the last RECENT tiles (keeps the lanes even). */
  spread: number;
}

export const FLOW: Record<Difficulty, Flow> = {
  easy: { jack: 0.6, jackCost: 4, jump: 0.45, run: 3, far: 1.2, spread: 0.4 },
  medium: { jack: 0.45, jackCost: 3, jump: 0.3, run: 4, far: 1, spread: 0.22 },
  hard: { jack: 0.3, jackCost: 2, jump: 0.25, run: 6, far: 0.7, spread: 0.15 },
  ultra: { jack: 0.18, jackCost: 1.5, jump: 0.25, run: 8, far: 0.4, spread: 0.15 },
};
const MOVE_COST = 1;
const JUMP_COST = 1.5;
/** Completing four lanes that repeat the four before them (a staircase going round). */
const REPEAT_COST = 0.8;
const RECENT = 8;
/** A tile in a repeated phrase off its twin's lane (the tile at its place in the phrase it repeats: repeats.ts). */
export const TWIN_COST = 1.6;
/** A step against the tune: the pitch goes up (by CONTOUR_STEP semitones or more) and the lane left, or down and right. */
export const CONTOUR_COST = 0.35;
const CONTOUR_STEP = 2;
const CONTOUR_GAP = 0.6;

/**
 * Figures: a run of evenly spaced single tiles whose pitch climbs (or falls) every step, or a trill
 * (two pitches back and forth), at least FIGURE_MIN tiles, each under FIGURE_GAP s after the last.
 * "Evenly" allows swing: each gap is within FIGURE_EVEN of the first gap or of the gap two before
 * it (long-short, long-short). Pitches within FIGURE_SAME semitones are the same note (unpitched
 * sounds come in whole notches: soundFigure). A human charts these as a shape: a run as a staircase the
 * way the tune goes, a trill as two lanes back and forth. Tile by tile, flow went the cheapest way
 * at each step and REPEAT_COST broke up the very staircases and trills a run is charted as. In a
 * figure a tile pays FIGURE_AGAINST for a step against the run (FIGURE_STAY for standing still), a
 * trill's tile FIGURE_TRILL off the lane two back, and neither pays REPEAT_COST.
 */
export const FIGURE_MIN = 4;
const FIGURE_GAP = 0.3;
const FIGURE_EVEN = 0.25;
const FIGURE_SAME = 0.5;
/** The second gap against the first, for a swung figure. */
const SWING: [number, number] = [0.45, 2.2];
export const FIGURE_AGAINST = 1.0;
const FIGURE_STAY = 0.6;
export const FIGURE_TRILL = 0.8;

type Figure = { kind: 'run'; dir: number } | { kind: 'trill' };

/**
 * What an unpitched sound counts as in a figure: its band (low 30, mid 60, high 90, 30 apart so the
 * bands never meet) moved two a notch of brightness (bright 60 the middle, a notch every 6, at most
 * 6 either way): a kick-snare back and forth is a trill, a tom fill falling in brightness a run.
 */
export function soundFigure(e: { band: 'low' | 'mid' | 'high'; bright: number }): number {
  const base = e.band === 'low' ? 30 : e.band === 'high' ? 90 : 60;
  return base + 2 * Math.max(-6, Math.min(6, Math.round((e.bright - 60) / 6)));
}

/** The figures among rows (time s, a single tile's pitch or null): for each row in one (after its first), what it is. */
export function figuresOf(rows: { t: number; pitch: number | null }[]): (Figure | null)[] {
  const out: (Figure | null)[] = rows.map(() => null);
  const gap = (i: number) => rows[i].t - rows[i - 1].t;
  const close = (g: number, h: number) => Math.abs(g - h) <= FIGURE_EVEN * h;
  /** Row `j` (after `i + 1`) keeps the figure's rhythm: like its first gap, or like the gap two before (swing). */
  const even = (j: number, i: number) => {
    const g = gap(j);
    if (!(g > 0 && g < FIGURE_GAP)) return false;
    // The second gap may set a swing against the first (up to about 2:1 either way); after that each
    // gap is like the first or like the one two before.
    if (j === i + 2) return g >= gap(i + 1) * SWING[0] && g <= gap(i + 1) * SWING[1];
    return close(g, gap(i + 1)) || close(g, gap(j - 2));
  };
  const same = (a: number, b: number) => Math.abs(a - b) < FIGURE_SAME;
  const step = (a: number, b: number) => (same(a, b) ? 0 : Math.sign(b - a));
  // Runs.
  for (let i = 0; i + 1 < rows.length;) {
    const a = rows[i].pitch, b = rows[i + 1].pitch, g0 = gap(i + 1);
    if (a == null || b == null || same(a, b) || !(g0 > 0 && g0 < FIGURE_GAP)) { i++; continue; }
    const dir = step(a, b);
    let j = i + 1;
    while (j + 1 < rows.length && rows[j + 1].pitch != null && step(rows[j].pitch!, rows[j + 1].pitch!) === dir && even(j + 1, i)) j++;
    if (j - i + 1 >= FIGURE_MIN) for (let k = i + 1; k <= j; k++) out[k] = { kind: 'run', dir };
    i = j > i + 1 ? j : i + 1;
  }
  // Trills.
  for (let i = 0; i + 2 < rows.length;) {
    const a = rows[i].pitch, b = rows[i + 1].pitch, g0 = gap(i + 1);
    if (a == null || b == null || same(a, b) || !(g0 > 0 && g0 < FIGURE_GAP)) { i++; continue; }
    let j = i + 1;
    while (j + 1 < rows.length && rows[j + 1].pitch != null && same(rows[j + 1].pitch!, rows[j - 1].pitch!) && !same(rows[j + 1].pitch!, rows[j].pitch!) && even(j + 1, i)) j++;
    if (j - i + 1 >= FIGURE_MIN) for (let k = i + 1; k <= j; k++) out[k] = out[k] ?? { kind: 'trill' };
    i = j > i + 1 ? j : i + 1;
  }
  return out;
}

/** What lane flow can go by beyond the tiles' times: a tile's twin (already flowed: it comes earlier), a tile's pitch (MIDI). */
export interface FlowHints<T> {
  twin?: (n: T) => T | undefined;
  pitch?: (n: T) => number | null;
  /** What figures are found by (figuresOf), when not the pitch: e.g. drums by their brightness. */
  figure?: (n: T) => number | null;
}

/** A chart's tiles (beats; `spb` seconds a beat) with their lanes flowed: copies, the rest as they were. */
export function flowChart(notes: ChartNote[], difficulty: Difficulty, spb: number, hints?: FlowHints<ChartNote>): ChartNote[] {
  const copies = notes.map((n) => ({ ...n }));
  // The hints are about the notes given; flowing works on the copies.
  const of = new Map(copies.map((c, i) => [c, notes[i]]));
  const back = new Map(notes.map((n, i) => [n, copies[i]]));
  const h: FlowHints<ChartNote> | undefined = hints && {
    twin: hints.twin && ((c) => { const tw = hints.twin!(of.get(c)!); return tw && back.get(tw); }),
    pitch: hints.pitch && ((c) => hints.pitch!(of.get(c)!)),
    figure: hints.figure && ((c) => hints.figure!(of.get(c)!)),
  };
  return flowLanes(copies, difficulty, (n) => n.t, (n) => n.t + (n.hold ? n.len : 0), spb, h);
}

/**
 * The chart's tiles with their lanes flowed (the same objects' lanes changed, nothing else).
 * `at` is a tile's time and `end` when its hold ends (in the same unit as `scale` seconds: beats
 * with scale = seconds per beat).
 */
export function flowLanes<T extends { lane: number; hold?: boolean }>(notes: T[], difficulty: Difficulty,
  at: (n: T) => number = (n) => (n as unknown as { sec: number }).sec,
  end: (n: T) => number = (n) => at(n) + ((n as unknown as { len?: number }).len ?? 0),
  scale = 1, hints?: FlowHints<T>): T[] {
  const f = FLOW[difficulty];
  let prevPitch: number | null = null;
  const sorted = [...notes].sort((a, b) => at(a) - at(b) || a.lane - b.lane);
  const heldUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
  const recent: number[] = [];
  const history: string[] = [];
  let prev: { t: number; lanes: number[] } | null = null;
  let run = 0, runHand = -1;
  // The figures (runs, trills) among the rows, by the single tiles' pitches.
  const figRows: { t: number; pitch: number | null }[] = [];
  const rowStart = new Map<number, number>();
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && (at(sorted[j]) - at(sorted[i])) * scale < 0.002) j++;
    rowStart.set(i, figRows.length);
    const by = hints?.figure ?? hints?.pitch;
    // A chord in a figure goes by its top note, so a run isn't broken by one chord in it.
    const tops = by ? sorted.slice(i, j).map((n) => by(n)).filter((x): x is number => x != null) : [];
    figRows.push({ t: at(sorted[i]) * scale, pitch: tops.length ? Math.max(...tops) : null });
    i = j;
  }
  const figures = hints?.figure || hints?.pitch ? figuresOf(figRows) : figRows.map(() => null);
  let prev2: number[] | null = null;
  for (let i = 0; i < sorted.length;) {
    // The row: tiles within 2 ms.
    let j = i + 1;
    while (j < sorted.length && (at(sorted[j]) - at(sorted[i])) * scale < 0.002) j++;
    const row = sorted.slice(i, j);
    const t = at(row[0]) * scale;
    const pitch = row.length === 1 && hints?.pitch ? hints.pitch(row[0]) : null;
    const fig = figures[rowStart.get(i)!] ?? null;
    if (row.length === 1) {
      const n = row[0];
      const twin = hints?.twin?.(n);
      let best = n.lane, bestCost = Infinity;
      for (let lane = 0; lane < 4; lane++) {
        if (heldUntil[lane] > t + 1e-6) continue;
        let cost = lane === n.lane ? 0 : MOVE_COST;
        if (twin && lane !== twin.lane) cost += TWIN_COST;
        if (prev && prev.lanes.length === 1 && pitch != null && prevPitch != null && t - prev.t < CONTOUR_GAP && Math.abs(pitch - prevPitch) >= CONTOUR_STEP) {
          const dl = lane - prev.lanes[0];
          if (dl !== 0 && Math.sign(dl) !== Math.sign(pitch - prevPitch)) cost += CONTOUR_COST;
        }
        if (prev) {
          const gap = t - prev.t;
          if (prev.lanes.includes(lane) && gap < f.jack) cost += f.jackCost * (1 - gap / f.jack) + 0.5;
          if (gap < f.jump && ((lane === 0 && prev.lanes.includes(3)) || (lane === 3 && prev.lanes.includes(0)))) cost += JUMP_COST;
          const centre = prev.lanes.reduce((a, l) => a + l, 0) / prev.lanes.length;
          cost += f.far * Math.max(0, Math.abs(lane - centre) - 1);
          const hand = lane < 2 ? 0 : 1;
          if (gap < f.jack && hand === runHand && run + 1 >= f.run) cost += 0.6 * (run + 2 - f.run);
        }
        cost += f.spread * recent.filter((l) => l === lane).length;
        if (fig && prev && prev.lanes.length === 1) {
          const dl = lane - prev.lanes[0];
          if (fig.kind === 'run') cost += dl === 0 ? FIGURE_STAY : Math.sign(dl) !== fig.dir ? FIGURE_AGAINST : 0;
          else if (prev2 && prev2.length === 1 && lane !== prev2[0]) cost += FIGURE_TRILL;
        }
        const h = history.length;
        if (!fig && h >= 7 && history[h - 4] === String(lane) && history[h - 3] === history[h - 7] && history[h - 2] === history[h - 6] && history[h - 1] === history[h - 5]) cost += REPEAT_COST;
        if (cost < bestCost - 1e-9) { bestCost = cost; best = lane; }
      }
      n.lane = best;
    }
    // Holds, the run on one hand, what was played lately.
    const lanes = row.map((n) => n.lane);
    for (const n of row) if (n.hold) heldUntil[n.lane] = Math.max(heldUntil[n.lane], end(n) * scale);
    const hand = lanes.every((l) => l < 2) ? 0 : lanes.every((l) => l >= 2) ? 1 : -1;
    if (prev && t - prev.t < f.jack && hand >= 0 && hand === runHand) run++; else run = hand >= 0 ? 1 : 0;
    runHand = hand;
    recent.push(...lanes);
    history.push(lanes.join('+'));
    if (history.length > 8) history.shift();
    while (recent.length > RECENT) recent.shift();
    prev2 = prev ? prev.lanes : null;
    prev = { t, lanes };
    prevPitch = pitch;
    i = j;
  }
  return notes;
}
