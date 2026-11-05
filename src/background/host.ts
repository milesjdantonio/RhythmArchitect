// Where the backdrop runs. The scene (scene.ts) draws and simulates; a host gives it a place to
// run and forwards what happens on the page:
//   attachMain   — on the main thread, as the game has always done it.
//   attachWorker — in a worker on OffscreenCanvases (perf profiles 'worker' and 'stage'): the
//                  page posts events and the music's levels, the worker draws on its own frames,
//                  and nothing on the main thread (React, layout, a long script) can stall it.
// Both forward the same events, so the backdrop reacts the same either way.

import { audioLevels } from '../audio/engine';
import { bus } from '../lib/bus';
import { MENU_FPS, noteBackdropTime, onPerf, perf, perfOverrides } from '../lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../lib/ticker';
import { SynthScene, type SceneEnv, type SceneEvent } from './scene';

export interface BackdropEls {
  base: HTMLCanvasElement;
  sand: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  pulse: HTMLElement;
  vignette: HTMLElement;
}
export interface Backdrop { setCalm(calm: boolean): void; destroy(): void }

const playing = () => document.body.dataset.scene === 'play';
const size = () => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 });

/** Forwards the bus, the pointer and resizes to `send`. Returns the unsubscribe. */
export function forward(send: (e: SceneEvent) => void) {
  const onMove = (e: PointerEvent) => send({ type: 'pointermove', x: e.clientX, y: e.clientY });
  const onDown = (e: PointerEvent) => send({ type: 'pointerdown', x: e.clientX, y: e.clientY });
  const onLeave = () => send({ type: 'pointerleave' });
  const onResize = () => send({ type: 'resize' });
  addEventListener('resize', onResize);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  const offs = [
    () => removeEventListener('resize', onResize),
    () => removeEventListener('pointermove', onMove),
    () => removeEventListener('pointerdown', onDown),
    () => document.removeEventListener('pointerleave', onLeave),
    bus.on('beat', ({ downbeat }) => send({ type: 'beat', downbeat })),
    bus.on('hit', ({ judgement, x }) => send({ type: 'hit', judgement, x })),
    bus.on('typing', () => send({ type: 'typing' })),
    bus.on('fever', ({ on }) => send({ type: 'fever', on })),
    bus.on('milestone', () => send({ type: 'milestone' })),
    bus.on('miss', ({ x }) => send({ type: 'miss', x })),
    bus.on('hues', (hues) => send({ type: 'hues', hues })),
    bus.on('section', ({ index }) => send({ type: 'section', index })),
    bus.on('cue', ({ kind, strength }) => send({ type: 'cue', kind, strength })),
    bus.on('sky', ({ x, y, strength }) => send({ type: 'sky', x, y, strength })),
  ];
  return () => offs.forEach((f) => f());
}

function applyLayers(els: BackdropEls, l: Parameters<SceneEnv['layers']>[0]) {
  els.pulse.style.opacity = l.pulseOpacity;
  els.pulse.style.transform = l.pulseScale;
  els.base.style.transform = l.baseScale;
  els.vignette.style.opacity = l.vignette;
}

/** The backdrop on the main thread. */
export function attachMain(els: BackdropEls, calm: () => boolean): Backdrop & { scene: SynthScene } {
  const env: SceneEnv = {
    size, playing, calm, levels: audioLevels,
    raf: (cb) => nextFrame(cb, ORDER.scene),
    cancelRaf: cancelFrame,
    layers: (l) => applyLayers(els, l),
    frameTime: (ms) => noteBackdropTime(ms, 'main'),
  };
  const scene = new SynthScene({ base: els.base.getContext('2d')!, sand: els.sand.getContext('2d')!, ink: els.ink.getContext('2d')! }, env);
  const unforward = forward((e) => scene.handle(e));
  const onPerfOff = onPerf(() => scene.resize());
  const onVis = () => (document.hidden ? scene.stop() : scene.start());
  document.addEventListener('visibilitychange', onVis);
  scene.start();
  return {
    scene,
    setCalm(c) { if (c) scene.still(); else scene.start(); },
    destroy() { unforward(); onPerfOff(); document.removeEventListener('visibilitychange', onVis); scene.destroy(); },
  };
}

/** Messages the page sends the backdrop worker. */
export type ToWorker =
  | { type: 'init'; base: OffscreenCanvas; sand: OffscreenCanvas; ink: OffscreenCanvas; size: { w: number; h: number; dpr: number }; profile: string; overrides: object; calm: boolean }
  | { type: 'event'; event: SceneEvent }
  | { type: 'size'; size: { w: number; h: number; dpr: number } }
  | { type: 'state'; playing: boolean; levels: { bass: number; mid: number; high: number; level: number } }
  | { type: 'profile'; profile: string; overrides: object }
  | { type: 'calm'; calm: boolean };
/** Messages the worker sends back: the DOM layers' styles. */
export type FromWorker = { type: 'layers'; layers: Parameters<SceneEnv['layers']>[0] } | { type: 'time'; ms: number };

export const workerSupported = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

/** Messages the page sends the sky worker (sky.worker.ts). */
export type ToSky =
  | { type: 'init'; canvas: OffscreenCanvas; size: { w: number; h: number; dpr: number }; profile: string; overrides: object; calm: boolean }
  | { type: 'event'; event: SceneEvent }
  | { type: 'size'; size: { w: number; h: number; dpr: number } }
  | { type: 'state'; playing: boolean; levels: { bass: number; mid: number; high: number; level: number } }
  | { type: 'calm'; calm: boolean };
/** Messages the sky worker sends back: its time per frame (for the /demo meter) and its renderer. */
export type FromSky = { type: 'time'; ms: number } | { type: 'info'; backend: string };

/**
 * The backdrop on the graphics chip in a worker (the game profiles, backdrop: 'stage'): the same
 * scene drawn by the game stage's sky shaders (stage/sky.ts) on one full-screen canvas, its bloom
 * and vignette included. During play it pauses: the game's stage draws the sky then.
 */
export function attachSky(canvas: HTMLCanvasElement, calm: boolean): Backdrop {
  const worker = new Worker(new URL('./sky.worker.ts', import.meta.url), { type: 'module' });
  const off = canvas.transferControlToOffscreen();
  const post = (m: ToSky, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  // At most MENU_FPS: during play it doesn't draw at all (the game's stage draws the sky).
  post({ type: 'init', canvas: off, size: size(), profile: perf().id, overrides: { ...perfOverrides(), fpsCap: MENU_FPS }, calm }, [off]);
  worker.onmessage = (e: MessageEvent<FromSky>) => {
    // Dev: the renderer and frames drawn (sent every 15), for checks.
    const dev = window as unknown as { __sky?: string; __skyFrames?: number };
    if (e.data.type === 'time') { noteBackdropTime(e.data.ms, 'worker'); if (import.meta.env.DEV) dev.__skyFrames = (dev.__skyFrames ?? 0) + 15; }
    else if (import.meta.env.DEV) dev.__sky = e.data.backend;
  };
  const unforward = forward((event) => {
    if (event.type === 'resize') post({ type: 'size', size: size() });
    else post({ type: 'event', event });
  });
  // The music's levels and whether a song is playing, once a frame (on the shared loop).
  let raf = 0;
  const tick = () => {
    post({ type: 'state', playing: playing(), levels: audioLevels() });
    raf = nextFrame(tick, ORDER.scene);
  };
  raf = nextFrame(tick, ORDER.scene);
  return {
    setCalm(c) { post({ type: 'calm', calm: c }); },
    destroy() { cancelFrame(raf); unforward(); worker.terminate(); },
  };
}

/** The backdrop in a worker. The canvases must be fresh (a canvas can be handed over only once). */
export function attachWorker(els: BackdropEls, calm: boolean): Backdrop {
  const worker = new Worker(new URL('./backdrop.worker.ts', import.meta.url), { type: 'module' });
  const off = (c: HTMLCanvasElement) => c.transferControlToOffscreen();
  const base = off(els.base), sand = off(els.sand), ink = off(els.ink);
  const post = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  post({ type: 'init', base, sand, ink, size: size(), profile: perf().id, overrides: perfOverrides(), calm }, [base, sand, ink]);
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    if (e.data.type === 'layers') applyLayers(els, e.data.layers);
    else noteBackdropTime(e.data.ms, 'worker');
  };
  const unforward = forward((event) => {
    // Resizes carry the new size (the worker can't read the window).
    if (event.type === 'resize') post({ type: 'size', size: size() });
    else post({ type: 'event', event });
  });
  const onPerfOff = onPerf(() => post({ type: 'profile', profile: perf().id, overrides: perfOverrides() }));
  // The music's levels and whether a song is playing, once a frame (on the shared loop). If the
  // main thread stalls, the worker keeps drawing with the last ones.
  let raf = 0;
  const tick = () => {
    post({ type: 'state', playing: playing(), levels: audioLevels() });
    raf = nextFrame(tick, ORDER.scene);
  };
  raf = nextFrame(tick, ORDER.scene);
  return {
    setCalm(c) { post({ type: 'calm', calm: c }); },
    destroy() { cancelFrame(raf); unforward(); onPerfOff(); worker.terminate(); },
  };
}
