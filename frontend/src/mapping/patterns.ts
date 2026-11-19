// How a chart plays under the hands, measured the same way for ours and for human charts
// (tools/map-human.mjs), lanes 0-1 the left hand and 2-3 the right:
//
//   jacks     the same lane twice in a row, quickly (under JACK s): the hardest thing to play for
//             its speed, and what a chart thinned from a busier one leaves behind
//   jumps     edge to edge (lane 0 to 3 or back) quickly (under JUMP s)
//   move      the mean lane distance between one moment and the next
//   oneHand   the longest run of quick moments (under RUN s apart) all on one hand
//   balance   the busiest lane's share of the tiles (0.25 is even)
//   repeats   how often four moments' lanes repeat the four before them (a staircase or trill
//             going round and round)
//
// Moments are the chart's rows (tiles within 2 ms of each other); a chord's lanes all count.

/** A tile: seconds and lane. */
export interface PatternTile { sec: number; lane: number }

export const JACK = 0.3;
export const JUMP = 0.25;
export const RUN = 0.3;

export interface Patterns {
  /** Share of steps from one moment to the next that repeat a lane quickly (under JACK s). */
  jacks: number;
  /** Share of steps that go edge to edge quickly (under JUMP s). */
  jumps: number;
  /** Mean lane distance between moments. */
  move: number;
  /** The longest run of quick moments all on one hand. */
  oneHand: number;
  /** The busiest lane's share of the tiles. */
  balance: number;
  /** Share of moments whose last four lanes repeat the four before them. */
  repeats: number;
}

/** A chart's moments: their time and lanes. */
export function rowsOf(tiles: PatternTile[]): { sec: number; lanes: number[] }[] {
  const rows: { sec: number; lanes: number[] }[] = [];
  for (const t of [...tiles].sort((a, b) => a.sec - b.sec || a.lane - b.lane)) {
    const last = rows[rows.length - 1];
    if (last && t.sec - last.sec < 0.002) { if (!last.lanes.includes(t.lane)) last.lanes.push(t.lane); } else rows.push({ sec: t.sec, lanes: [t.lane] });
  }
  return rows;
}

export function patterns(tiles: PatternTile[]): Patterns {
  const rows = rowsOf(tiles);
  const steps = Math.max(1, rows.length - 1);
  let jacks = 0, jumps = 0, move = 0, oneHand = 0, run = 0, runHand = -1;
  const hand = (lanes: number[]) => (lanes.every((l) => l < 2) ? 0 : lanes.every((l) => l >= 2) ? 1 : -1);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i], gap = b.sec - a.sec;
    if (gap < JACK && b.lanes.some((l) => a.lanes.includes(l))) jacks++;
    if (gap < JUMP && ((a.lanes.includes(0) && b.lanes.includes(3)) || (a.lanes.includes(3) && b.lanes.includes(0)))) jumps++;
    move += Math.abs(b.lanes.reduce((s, l) => s + l, 0) / b.lanes.length - a.lanes.reduce((s, l) => s + l, 0) / a.lanes.length);
    const h = hand(b.lanes);
    if (gap < RUN && h >= 0 && h === runHand) run++; else run = h >= 0 ? 1 : 0;
    runHand = h;
    oneHand = Math.max(oneHand, run);
  }
  const count = [0, 0, 0, 0];
  for (const t of tiles) if (t.lane >= 0 && t.lane < 4) count[t.lane]++;
  const key = rows.map((r) => r.lanes.join('+'));
  let repeats = 0;
  for (let i = 7; i < key.length; i++) if (key.slice(i - 3, i + 1).join(' ') === key.slice(i - 7, i - 3).join(' ')) repeats++;
  return { jacks: jacks / steps, jumps: jumps / steps, move: move / steps, oneHand, balance: Math.max(...count) / Math.max(1, tiles.length), repeats: repeats / Math.max(1, key.length - 7) };
}
