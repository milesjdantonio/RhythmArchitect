// One clock for every animation on the main thread (perf profiles with `ticker`, option 6 in /demo).
//
// Normally the game loop, the video clock, the video's dock, the backdrop and the callouts each
// ask the browser for their own animation frame. With the ticker they all queue on one frame
// instead: they run in a fixed order (the clock and the game first), they all draw on the same
// frames under the frame cap, and optional work (the dock's measuring) waits for the next frame
// when this one has already used its budget, so a heavy frame thins the extras, not the game.
//
// `nextFrame` / `cancelFrame` are drop-in replacements for requestAnimationFrame: without the
// ticker profile they are exactly that.

import { frameGate, perf } from './perf';

/** Run order inside a frame. Lower runs first. */
export const ORDER = { clock: 0, game: 10, scene: 20, ui: 30, optional: 100 } as const;
/** Main-thread milliseconds a frame may use before optional work waits for the next frame. */
const BUDGET_MS = 8;

/** `waited`: an optional job already put off once; it runs on this frame whatever the budget. */
interface Job { id: number; fn: FrameRequestCallback; order: number; waited?: boolean }
let queue: Job[] = [];
let nextId = 1;
let raf = 0;
const cancelled = new Set<number>();
/** The last frame's main-thread time (ms), for the meter. */
export const tickerInfo = { lastMs: 0, deferred: 0, starved: 0 };

/**
 * Browsers sometimes hold a visible page's animation frames back (seen in Chrome: one a second,
 * with a second window open, or before the first click while a worker draws with WebGPU), though
 * its timers run as usual. The game's clock and loop then run from a timer instead: the drawing
 * (in a worker) carries on, and the clock keeps following the video.
 */
const STARVED_MS = 50;
let lastRun = 0;
let watchdog = 0;
function watch() {
  if (!watchdog) watchdog = setTimeout(check, STARVED_MS) as unknown as number;
}
function check() {
  watchdog = 0;
  if (!queue.length) return;
  if (performance.now() - lastRun >= STARVED_MS && typeof document !== 'undefined' && document.visibilityState === 'visible') {
    tickerInfo.starved++;
    cancelAnimationFrame(raf);
    run(performance.now());
  } else watch();
}

function run(ts: number) {
  raf = 0;
  lastRun = performance.now();
  const jobs = queue;
  queue = [];
  if (!frameGate(ts)) { requeue(jobs); return; }
  jobs.sort((a, b) => a.order - b.order);
  const start = performance.now();
  const later: Job[] = [];
  for (const j of jobs) {
    if (cancelled.delete(j.id)) continue;
    // Optional work waits for a lighter frame, but only one frame: on a run of busy frames it would
    // otherwise never run at all.
    if (j.order >= ORDER.optional && !j.waited && performance.now() - start > BUDGET_MS) { later.push({ ...j, waited: true }); tickerInfo.deferred++; continue; }
    try { j.fn(ts); } catch (e) { console.error(e); }
  }
  tickerInfo.lastMs = performance.now() - start;
  if (later.length) requeue(later);
}

function requeue(jobs: Job[]) {
  queue.push(...jobs);
  if (!raf && queue.length) { raf = requestAnimationFrame(run); watch(); }
}

/** Like requestAnimationFrame, on the shared frame when the profile uses the ticker. */
export function nextFrame(fn: FrameRequestCallback, order: number = ORDER.ui): number {
  if (!perf().ticker) return requestAnimationFrame(fn);
  const id = nextId++;
  queue.push({ id, fn, order });
  if (!raf) { raf = requestAnimationFrame(run); watch(); }
  // Negative ids mark ticker jobs, so cancelFrame knows which kind it holds.
  return -id;
}

export function cancelFrame(id: number) {
  if (!id) return;
  if (id > 0) { cancelAnimationFrame(id); return; }
  const before = queue.length;
  queue = queue.filter((j) => j.id !== -id);
  // Not queued any more: it's in the frame running now, which skips it.
  if (queue.length === before) cancelled.add(-id);
}
