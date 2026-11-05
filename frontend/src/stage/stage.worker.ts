// The 3D stage on its own thread (perf profiles A and B; proxy.ts is the page's side). It draws on
// the worker's own animation frames with its own song clock: it runs on with real time and is
// steered gently toward the time the page reports (the page's time when it read its clock, carried
// on to now, for up to MAX_CARRY seconds). So tiles move evenly frame to frame, a busy page (a long
// script, React, garbage collection) doesn't stop or jerk them, and a real change (a seek, the
// slow-down of a failed run) is followed within a few frames.

import { MENU_FPS, frameGate, perf, setPerf, type ProfileId } from '../lib/perf';
import { Stage3D, type StageNote, type StageSurface } from './Stage3D';
import { unpackNote, type FromStage, type ToStage } from './proxy';

const MAX_CARRY = 1;
/** Share of the difference to the page's time closed each frame. */
const STEER = 0.2;
/** Further off than this (s): jump to the page's time (a seek, a restart). */
const SNAP = 0.5;

interface WorkerScope {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToStage>) => void) | null;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
}
const scope = self as unknown as WorkerScope;
const raf = (cb: FrameRequestCallback) => (scope.requestAnimationFrame ? scope.requestAnimationFrame(cb) : setTimeout(() => cb(performance.now()), 16));

let stage: Stage3D | null = null;
let surface: StageSurface | null = null;
let notes: StageNote[] = [];
let songT = -4;
let sentAt = 0;
let carry = true;
let started = false;
/** Showcase (the menu's preview): the stage plays its own ghost chart, not the page's notes. */
let ghost = false;
/** Not drawing (out of sight, or held still). */
let sleeping = false;
/** The worker's own song clock (NaN until the first report). */
let clock = Number.NaN;
let lastWall = 0;

function loop(now: number) {
  raf(loop);
  if (!stage || !started || sleeping || !frameGate(now)) return;
  // The frame's own time (when the display shows it), not when this callback happens to run:
  // callbacks run a few ms early or late, frames are shown on the beat of the screen.
  const wall = performance.timeOrigin + now;
  const target = songT + (carry ? Math.min(MAX_CARRY, Math.max(0, (wall - sentAt) / 1000)) : 0);
  if (!carry || Number.isNaN(clock) || Math.abs(target - clock) > SNAP) clock = target;
  else {
    clock += Math.max(0, Math.min(0.1, (wall - lastWall) / 1000));
    clock += (target - clock) * STEER;
  }
  lastWall = wall;
  const t = clock;
  stage.frame(t, ghost ? undefined : notes);
  const pads = new Float32Array(8);
  for (let l = 0; l < 4; l++) { const p = stage.receptor(l); pads[l * 2] = p.x; pads[l * 2 + 1] = p.y; }
  scope.postMessage({ type: 'tick', pads, particles: stage.particleCount, at: wall, t: started && carry ? t : -1 } satisfies FromStage, [pads.buffer]);
}

// Messages that arrive while the stage is starting (WebGPU starts asynchronously) wait here.
let pending: ToStage[] | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (pending && m.type !== 'init') { pending.push(m); return; }
  handle(m);
};

async function init(m: Extract<ToStage, { type: 'init' }>) {
  pending = [];
  // The menu's preview draws at most MENU_FPS; the game's stage at the screen's rate.
  setPerf(m.profile as ProfileId, m.mode === 'showcase' ? { fpsCap: MENU_FPS } : {});
  surface = { canvas: m.canvas, width: m.width, height: m.height, dpr: m.dpr };
  // Profile B: the WebGPU materials, loaded only when asked for (A's worker never carries them).
  const gpu = perf().renderer === 'webgpu' ? await import('./gpu') : undefined;
  stage = new Stage3D(surface, { mode: m.mode, hues: m.hues, gpu });
  await stage.ready;
  // Screen pixels, as Stage3D reports them (the page turns them into fractions of the view).
  stage.onSky = (x, y, strength) => scope.postMessage({ type: 'sky', x, y, strength } satisfies FromStage);
  ghost = m.mode === 'showcase';
  if (ghost) stage.onGhostHit = (lane, kind) => scope.postMessage({ type: 'ghost', lane, kind } satisfies FromStage);
  const queued = pending;
  pending = null;
  for (const q of queued) handle(q);
  raf(loop);
}

function handle(m: ToStage) {
  switch (m.type) {
    case 'init':
      void init(m);
      break;
    case 'size': stage?.setSurface(m.width, m.height, m.dpr); break;
    case 'notes':
      notes = Array.from(m.time, (time, i) => ({ time, end: m.end[i], lane: m.lane[i], hold: m.hold[i] === 1 }));
      break;
    case 'batch':
      if (stage) for (const [name, args] of m.calls) (stage as unknown as Record<string, (...a: unknown[]) => void>)[name]?.(...args);
      if (m.frame) {
        const { state } = m.frame;
        for (let i = 0; i < notes.length && i < state.length; i++) unpackNote(notes[i], state[i]);
        songT = m.frame.t;
        sentAt = m.frame.at;
        carry = true;
        started = true;
      }
      break;
    case 'hold': carry = false; break;
    case 'sleep': sleeping = m.on; break;
  }
}
