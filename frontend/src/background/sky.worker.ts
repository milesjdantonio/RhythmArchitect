// The menu's backdrop on the graphics chip, on its own thread.
//
// The game's stage already draws the backdrop itself (stage/sky.ts: the same scene, its shapes drawn
// by shaders) during play. On the menus there is no 3D stage behind everything, so this worker draws
// the same sky on one full-screen canvas, undimmed, with WebGPU where the browser has it (WebGL
// otherwise). The page sends events and the music's levels (host.ts attachSky); during play it
// stops drawing, since the game's stage draws the sky then.

import * as THREE from 'three';
import { frameGate, perf, setPerf, type ProfileId } from '../lib/perf';
import { SkyGL } from '../stage/sky';
import type { GpuKit } from '../stage/Stage3D';
import { watchLost } from '../stage/lost';
import type { FromSky, ToSky } from './host';

const SILENT = { bass: 0, mid: 0, high: 0, level: 0 };
/** The sky is soft light: past this pixel ratio a sharper canvas costs more and looks the same. */
const MAX_DPR = 1.5;

interface WorkerScope {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent<ToSky>) => void) | null;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
}
const scope = self as unknown as WorkerScope;
const raf = (cb: FrameRequestCallback) => (scope.requestAnimationFrame ? scope.requestAnimationFrame(cb) : setTimeout(() => cb(performance.now()), 16));

let renderer: THREE.WebGLRenderer | null = null;
let sky: SkyGL | null = null;
let size = { w: 1, h: 1, dpr: 1 };
let playing = false;
let levels = SILENT;
let calm = false;
/** Calm: one frame is drawn, then the sky holds still. */
let calmDrawn = false;
let last = 0;
// Pacing: one frame per page frame (the page sends 'state' on each of its frames), and on its own
// only when the page has gone quiet for STALL_MS (a long script), so the sky never freezes with it.
// A worker's own animation frames can run ahead of the screen; drawing that fast floods the
// graphics chip's queue and the page's own frames stall behind it (seen: 1 a second).
const STALL_MS = 100;
let fresh = false;
let stateAt = 0;

function resize() {
  if (!renderer || !sky) return;
  renderer.setPixelRatio(Math.min(size.dpr, MAX_DPR));
  renderer.setSize(size.w, size.h, false);
  sky.resize(renderer);
}

/** The GPU was taken away: nothing more to draw (the page replaces this worker). */
let lost = false;

function loop(now: number) {
  if (lost) return;
  raf(loop);
  if (!renderer || !sky) return;
  const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 0;
  // In play the game's stage draws the sky; a calm sky holds after its one frame.
  if (playing || (calm && calmDrawn)) { last = now; return; }
  if (fresh) fresh = false;
  // On its own (the page quiet): about 30 a second, enough to keep it moving.
  else if (performance.now() - stateAt < STALL_MS || now - last < 33) return;
  if (!frameGate(now)) return;
  last = now;
  sky.update(dt);
  try {
    sky.render(renderer);
  } catch (e) {
    if (lost) return; // the loss handler takes it from here
    throw e;
  }
  calmDrawn = calm;
}

// Messages that arrive while WebGPU starts (it starts asynchronously) wait here.
let pending: ToSky[] | null = null;

async function init(m: Extract<ToSky, { type: 'init' }>) {
  pending = [];
  setPerf(m.profile as ProfileId, m.overrides);
  size = m.size;
  calm = m.calm;
  const gpu: GpuKit | null = perf().renderer === 'webgpu' ? await import('../stage/gpu') : null;
  renderer = gpu
    ? (gpu.makeRenderer(m.canvas, { antialias: false, alpha: false }) as unknown as THREE.WebGLRenderer)
    : new THREE.WebGLRenderer({ canvas: m.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (gpu) await (renderer as unknown as { init(): Promise<unknown> }).init();
  // The GPU taken away (another monitor's graphics adapter, a driver reset): stop and tell the
  // page, which starts a fresh canvas and worker (host.ts attachSky).
  watchLost(renderer, m.canvas, (why) => { lost = true; scope.postMessage({ type: 'lost', why } satisfies FromSky); });
  sky = new SkyGL({ size: () => size, levels: () => levels, playing: () => playing, half: false, dim: false, gpu });
  resize();
  // WebGPU: build every pass before the first frame (rings and crystals first appear later).
  if (gpu) await sky.warmAsync(renderer).catch(() => {});
  const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
  scope.postMessage({ type: 'info', backend: gpu ? (backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (WebGPU fallback)') : 'WebGL' } satisfies FromSky);
  const queued = pending;
  pending = null;
  for (const q of queued) handle(q);
  raf(loop);
}

function handle(m: ToSky) {
  switch (m.type) {
    case 'init': void init(m); break;
    case 'event': sky?.handle(m.event); break;
    case 'size': size = m.size; resize(); break;
    case 'state': playing = m.playing; levels = m.levels; fresh = true; stateAt = performance.now(); break;
    case 'calm': calm = m.calm; calmDrawn = false; break;
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (pending && m.type !== 'init') { pending.push(m); return; }
  handle(m);
};
