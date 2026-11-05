// The backdrop on its own thread (perf profiles 'worker' and 'stage'; host.ts attachWorker).
// The same scene as on the page, drawing on OffscreenCanvases with the worker's own animation
// frames. The page sends events and the music's levels; this sends back the DOM layers' styles.

import { setPerf, type ProfileId } from '../lib/perf';
import type { FromWorker, ToWorker } from './host';
import { SynthScene, type SceneEnv } from './scene';

const SILENT = { bass: 0, mid: 0, high: 0, level: 0 };
let scene: SynthScene | null = null;
let size = { w: 1, h: 1, dpr: 1 };
let playing = false;
let levels = SILENT;
let calm = false;

// The worker's global scope (the app compiles with the DOM library, not the worker one).
interface WorkerScope {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}
const scope = self as unknown as WorkerScope;
// Workers have animation frames in Chrome, Edge and Firefox; elsewhere, a 60 Hz timer.
const raf: (cb: FrameRequestCallback) => number = typeof scope.requestAnimationFrame === 'function'
  ? (cb) => scope.requestAnimationFrame!(cb)
  : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const cancelRaf = (id: number) => (typeof scope.cancelAnimationFrame === 'function' ? scope.cancelAnimationFrame!(id) : clearTimeout(id));

let lastLayers = '';
// Pacing: the page sends a 'state' message on each of its frames. The backdrop draws one frame per
// game frame (drawing more would only take GPU time from the game on a busy graphics chip), and
// draws on its own when the page has gone quiet for STALL_MS (a long script, a heavy layout), so
// the sky never freezes with it.
const STALL_MS = 100;
let fresh = false;
let stateAt = 0;
let timeSum = 0;
let timeN = 0;
const env: SceneEnv = {
  size: () => size,
  playing: () => playing,
  levels: () => levels,
  calm: () => calm,
  raf,
  cancelRaf,
  shouldDraw: () => {
    if (fresh) { fresh = false; return true; }
    return performance.now() - stateAt > STALL_MS;
  },
  layers: (l) => {
    const key = `${l.pulseOpacity}|${l.pulseScale}|${l.baseScale}|${l.vignette}`;
    if (key === lastLayers) return;
    lastLayers = key;
    scope.postMessage({ type: 'layers', layers: l } satisfies FromWorker);
  },
  // The page's meter shows the backdrop's own time; sent a few times a second.
  frameTime: (ms) => {
    timeSum += ms; timeN++;
    if (timeN >= 15) { scope.postMessage({ type: 'time', ms: timeSum / timeN } satisfies FromWorker); timeSum = 0; timeN = 0; }
  },
};

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      size = m.size;
      calm = m.calm;
      setPerf(m.profile as ProfileId, m.overrides);
      scene = new SynthScene({ base: m.base.getContext('2d')!, sand: m.sand.getContext('2d')!, ink: m.ink.getContext('2d')! }, env);
      scene.start();
      break;
    case 'event': scene?.handle(m.event); break;
    case 'size': size = m.size; scene?.resize(); break;
    case 'state': playing = m.playing; levels = m.levels; fresh = true; stateAt = performance.now(); break;
    case 'profile': setPerf(m.profile as ProfileId, m.overrides); scene?.resize(); break;
    case 'calm': calm = m.calm; if (calm) scene?.still(); else scene?.start(); break;
  }
};
