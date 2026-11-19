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

/** A chart's tiles (beats; `spb` seconds a beat) with their lanes flowed: copies, the rest as they were. */
export function flowChart(notes: ChartNote[], difficulty: Difficulty, spb: number): ChartNote[] {
  const copies = notes.map((n) => ({ ...n }));
  return flowLanes(copies, difficulty, (n) => n.t, (n) => n.t + (n.hold ? n.len : 0), spb);
}

/**
 * The chart's tiles with their lanes flowed (the same objects' lanes changed, nothing else).
 * `at` is a tile's time and `end` when its hold ends (in the same unit as `scale` seconds: beats
 * with scale = seconds per beat).
 */
export function flowLanes<T extends { lane: number; hold?: boolean }>(notes: T[], difficulty: Difficulty,
  at: (n: T) => number = (n) => (n as unknown as { sec: number }).sec,
  end: (n: T) => number = (n) => at(n) + ((n as unknown as { len?: number }).len ?? 0),
  scale = 1): T[] {
  const f = FLOW[difficulty];
  const sorted = [...notes].sort((a, b) => at(a) - at(b) || a.lane - b.lane);
  const heldUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
  const recent: number[] = [];
  const history: string[] = [];
  let prev: { t: number; lanes: number[] } | null = null;
  let run = 0, runHand = -1;
  for (let i = 0; i < sorted.length;) {
    // The row: tiles within 2 ms.
    let j = i + 1;
    while (j < sorted.length && (at(sorted[j]) - at(sorted[i])) * scale < 0.002) j++;
    const row = sorted.slice(i, j);
    const t = at(row[0]) * scale;
    if (row.length === 1) {
      const n = row[0];
      let best = n.lane, bestCost = Infinity;
      for (let lane = 0; lane < 4; lane++) {
        if (heldUntil[lane] > t + 1e-6) continue;
        let cost = lane === n.lane ? 0 : MOVE_COST;
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
        const h = history.length;
        if (h >= 7 && history[h - 4] === String(lane) && history[h - 3] === history[h - 7] && history[h - 2] === history[h - 6] && history[h - 1] === history[h - 5]) cost += REPEAT_COST;
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
    prev = { t, lanes };
    i = j;
  }
  return notes;
}
