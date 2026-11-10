// Where the backdrop runs. The scene (scene.ts) draws and simulates; a host gives it a place to
// run and forwards what happens on the page:
//   attachSky  — on the graphics chip in a worker (sky.worker.ts), with the stage's sky shaders.
//   attachMain — on 2D canvases on the main thread, where workers can't draw.
// Both forward the same events, so the backdrop reacts the same either way.

import { audioLevels } from '../audio/playback';
import { bus } from '../lib/bus';
import { MENU_FPS, perf } from '../lib/perf';
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
  };
  const scene = new SynthScene({ base: els.base.getContext('2d')!, sand: els.sand.getContext('2d')!, ink: els.ink.getContext('2d')! }, env);
  const unforward = forward((e) => scene.handle(e));
  const onVis = () => (document.hidden ? scene.stop() : scene.start());
  document.addEventListener('visibilitychange', onVis);
  scene.start();
  return {
    scene,
    setCalm(c) { if (c) scene.still(); else scene.start(); },
    destroy() { unforward(); document.removeEventListener('visibilitychange', onVis); scene.destroy(); },
  };
}

export const workerSupported = () =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

/** Messages the page sends the sky worker (sky.worker.ts). */
export type ToSky =
  | { type: 'init'; canvas: OffscreenCanvas; size: { w: number; h: number; dpr: number }; profile: string; overrides: object; calm: boolean }
  | { type: 'event'; event: SceneEvent }
  | { type: 'size'; size: { w: number; h: number; dpr: number } }
  | { type: 'state'; playing: boolean; levels: { bass: number; mid: number; high: number; level: number } }
  | { type: 'calm'; calm: boolean };
/** What the sky worker sends back: its renderer, or that the GPU was taken away. */
export type FromSky = { type: 'info'; backend: string } | { type: 'lost'; why: string };

/**
 * The backdrop on the graphics chip in a worker: the same
 * scene drawn by the game stage's sky shaders (stage/sky.ts) on one full-screen canvas, its bloom
 * and vignette included. During play it pauses: the game's stage draws the sky then.
 */
export function attachSky(canvas: HTMLCanvasElement, calm: boolean): Backdrop {
  let worker!: Worker;
  const post = (m: ToSky, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
  // What a fresh worker needs to look the same: the song's colours, and calm.
  let hues: SceneEvent | null = null;
  const restarts: number[] = [];
  const start = () => {
    worker = new Worker(new URL('./sky.worker.ts', import.meta.url), { type: 'module' });
    const off = canvas.transferControlToOffscreen();
    // At most MENU_FPS: during play it doesn't draw at all (the game's stage draws the sky).
    post({ type: 'init', canvas: off, size: size(), profile: perf().id, overrides: { fpsCap: MENU_FPS }, calm }, [off]);
    if (hues) post({ type: 'event', event: hues });
    worker.onmessage = (e: MessageEvent<FromSky>) => {
      const m = e.data;
      if (m.type === 'lost') {
        // The GPU was taken away (another monitor's graphics adapter, a driver reset): a fresh
        // canvas in the same place and a fresh worker, at most three times a minute.
        const now = performance.now();
        while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
        console.warn(`[sky] ${m.why}${restarts.length < 3 ? ': starting a fresh sky' : ': giving up after several tries'}`);
        if (restarts.length >= 3) return;
        restarts.push(now);
        worker.terminate();
        const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
        canvas.replaceWith(fresh);
        canvas = fresh;
        start();
        return;
      }
      // Dev: the renderer, for checks.
      if (import.meta.env.DEV) (window as unknown as { __sky?: string }).__sky = m.backend;
    };
  };
  start();
  const unforward = forward((event) => {
    if (event.type === 'hues') hues = event;
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
    setCalm(c) { calm = c; post({ type: 'calm', calm: c }); },
    destroy() { cancelFrame(raf); unforward(); worker.terminate(); },
  };
}
