// The 3D stage on its own thread (where the browser can draw in a worker).
//
// StageProxy stands in for Stage3D on the page: the game calls the same methods, and the proxy
// queues them and sends them to the worker (stage.worker.ts) once per frame together with the song
// time and each note's state (judged, held). The worker draws on its own frames, carrying the
// song time on by itself for up to a quarter of a second, so a busy main thread (React, a long
// script, garbage collection) no longer stops the tiles. The worker sends back the pads' screen
// positions (for the judgement words and the touch lanes) and the sky's bursts.
//
// If the browser takes the graphics chip away from the stage (moving the window to a monitor on
// another graphics adapter, a driver reset), the worker says so and the proxy starts a fresh
// canvas and worker in its place, replaying what the stage keeps (colours, tempo, the notes, the
// ghost chart, fever, sleeping): the game carries on. After MAX_RESTARTS in a minute it stops trying.

import { perf } from '../lib/perf';
import type { SceneEvent } from '../background/scene';
import type { BurstKind } from './bursts';
import type { HitKind, StageMode, StageNote } from './Stage3D';

/** Page → worker. */
export type ToStage =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; dpr: number; mode: StageMode; hues?: [number, number]; profile: string }
  | { type: 'size'; width: number; height: number; dpr: number }
  | { type: 'notes'; time: Float32Array; end: Float32Array; lane: Uint8Array; hold: Uint8Array }
  /** `frame.state`: the state of the notes from index `frame.from` on (the ones that can still change). */
  | { type: 'batch'; calls: [string, unknown[]][]; frame?: { t: number; at: number; state: Uint8Array; from: number } }
  | { type: 'hold' }
  | { type: 'sleep'; on: boolean }
  /** Dev and tests only: take the GPU away (see Stage3D.loseGpu). */
  | { type: 'loseGpu' };
/** Worker → page. */
export type FromStage =
  | { type: 'tick'; pads: Float32Array; particles: number; at: number; t: number }
  | { type: 'sky'; x: number; y: number; strength: number }
  | { type: 'ghost'; lane: number; kind: HitKind }
  | { type: 'lost'; why: string };

const JUDGED = { perfect: 1, great: 2, good: 3, miss: 4 } as const;
/** Packs a note's state in a byte: judged (3 bits), holding (bit 3), hold result (bits 4-5). */
export function packNote(n: StageNote) {
  return (n.judged ? JUDGED[n.judged] : 0) | (n.holding ? 8 : 0) | (n.holdResult === 'done' ? 16 : n.holdResult === 'broken' ? 32 : 0);
}
const KINDS = [undefined, 'perfect', 'great', 'good', 'miss'] as const;
export function unpackNote(n: StageNote, b: number) {
  n.judged = KINDS[b & 7];
  n.holding = (b & 8) !== 0;
  n.holdResult = b & 16 ? 'done' : b & 32 ? 'broken' : undefined;
}

/** Wall-clock milliseconds both threads agree on. */
export const wallMs = () => performance.timeOrigin + performance.now();

/** The calls whose effect lasts (replayed on a fresh stage after the GPU was lost). */
const STICKY = new Set(['setTiming', 'setHues', 'setGhostChart', 'setFever']);
/** Fresh stages at most this many times a minute (then it stops: something is badly wrong). */
const MAX_RESTARTS = 3;
/**
 * Each frame only the notes that can still change are sent (their state, one byte each): from the
 * first that ended under BEHIND seconds ago (a miss is judged a moment late, a missed tile falls
 * past the line) to those AHEAD seconds from now (nothing further away is judged). Not the whole
 * song every frame.
 */
const BEHIND = 2;
const AHEAD = 1;

export class StageProxy {
  static supported() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  }

  /** Called when a burst appears in the sky (the page's backdrop answers it). */
  onSky?: (x: number, y: number, strength: number) => void;
  /** Showcase: called when the ghost hits a tile. */
  onGhostHit?: (lane: number, kind: HitKind) => void;
  private worker!: Worker;
  private canvas!: HTMLCanvasElement;
  private calls: [string, unknown[]][] = [];
  private flushing = false;
  private notes: StageNote[] | null = null;
  /** The first note that can still change (the notes are in time order). */
  private from = 0;
  private lastT = Number.NEGATIVE_INFINITY;
  private pads: Float32Array<ArrayBufferLike> = new Float32Array(8);
  private particles = 0;
  /** Frames the worker drew per second (over half-second windows), for the dev tools. */
  fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private ro: ResizeObserver;
  private sticky = new Map<string, unknown[]>();
  private sleeping = false;
  private restarts: number[] = [];
  private dprQuery: MediaQueryList | null = null;
  private onDpr = () => { this.sendSize(); this.watchDpr(); };

  constructor(private host: HTMLElement, private opts: { mode: StageMode; hues?: [number, number] }) {
    this.start();
    this.ro = new ResizeObserver(() => this.sendSize());
    this.ro.observe(host);
    this.watchDpr();
    // Dev and tests: take the GPU away, to check the stage comes back.
    if (import.meta.env.DEV && opts.mode === 'play') (window as unknown as { __stageLoseGpu?: () => void }).__stageLoseGpu = () => this.post({ type: 'loseGpu' });
  }

  /** A canvas and a worker drawing on it. */
  private start() {
    const host = this.host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    host.appendChild(this.canvas);
    const r = host.getBoundingClientRect();
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    // Until the worker reports, the pads sit where the stage puts them: across the bottom middle.
    for (let l = 0; l < 4; l++) { this.pads[l * 2] = r.width * (0.38 + l * 0.08); this.pads[l * 2 + 1] = r.height * 0.86; }
    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker = new Worker(new URL('./stage.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromStage>) => {
      const m = e.data;
      if (m.type === 'tick') {
        this.pads = m.pads; this.particles = m.particles;
        this.fpsFrames++;
        if (!this.fpsSince) this.fpsSince = m.at;
        else if (m.at - this.fpsSince >= 500) { this.fps = (this.fpsFrames * 1000) / (m.at - this.fpsSince); this.fpsFrames = 0; this.fpsSince = m.at; }
        // Dev: the song time the stage last drew, and when (wall ms), for sync checks.
        if (import.meta.env.DEV) (window as unknown as { __stageClock?: unknown }).__stageClock = { t: m.t, at: m.at, fps: this.fps };
      }
      else if (m.type === 'ghost') this.onGhostHit?.(m.lane, m.kind);
      else if (m.type === 'lost') this.restart(m.why);
      else this.onSky?.(m.x, m.y, m.strength);
    };
    const hues = (this.sticky.get('setHues')?.[0] as [number, number] | undefined) ?? this.opts.hues;
    this.post({ type: 'init', canvas: offscreen, width: r.width, height: r.height, dpr: devicePixelRatio || 1, mode: this.opts.mode, hues, profile: perf().id }, [offscreen]);
  }

  /** The GPU was taken away: a fresh canvas and worker, with what the stage keeps replayed. */
  private restart(why: string) {
    const now = performance.now();
    this.restarts = this.restarts.filter((t) => now - t < 60_000);
    console.warn(`[stage] ${why}${this.restarts.length < MAX_RESTARTS ? ': starting a fresh stage' : ': giving up after several tries'}`);
    if (this.restarts.length >= MAX_RESTARTS) return;
    this.restarts.push(now);
    this.worker.terminate();
    this.canvas.remove();
    this.calls = [];
    this.start();
    for (const [name, args] of this.sticky) this.call(name, ...args);
    // The notes go again with the next frame (the new worker has none).
    this.notes = null;
    if (this.sleeping) this.post({ type: 'sleep', on: true });
  }

  private sendSize() {
    const b = this.host.getBoundingClientRect();
    this.canvas.style.width = `${b.width}px`;
    this.canvas.style.height = `${b.height}px`;
    this.post({ type: 'size', width: b.width, height: b.height, dpr: devicePixelRatio || 1 });
  }

  /** The pixel ratio can change without the size changing (another monitor's scaling, zoom). */
  private watchDpr() {
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.dprQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`) : null;
    this.dprQuery?.addEventListener('change', this.onDpr);
  }

  private post(m: ToStage, transfer: Transferable[] = []) { this.worker.postMessage(m, transfer); }

  /** Queues a call; it goes with the next frame, or on its own at the end of this task. */
  private call(name: string, ...args: unknown[]) {
    if (STICKY.has(name)) this.sticky.set(name, args);
    this.calls.push([name, args]);
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => { if (this.calls.length) this.flush(); this.flushing = false; });
    }
  }
  private flush(frame?: { t: number; at: number; state: Uint8Array; from: number }) {
    const calls = this.calls;
    this.calls = [];
    this.post({ type: 'batch', calls, frame }, frame ? [frame.state.buffer] : []);
  }

  /**
   * The song time to draw, and the notes (sent whole once, then one byte of state per frame for
   * each note that can still change). `at`: when the time was read (performance.now()), so the
   * worker carries it on from then.
   */
  frame(t: number, notes?: StageNote[], at = performance.now()) {
    // Showcase: no notes (the worker's stage plays its ghost chart).
    const list = notes ?? [];
    let all = false;
    if (notes && list !== this.notes) {
      this.notes = list;
      const n = list.length;
      const time = new Float32Array(n), end = new Float32Array(n), lane = new Uint8Array(n), hold = new Uint8Array(n);
      list.forEach((x, i) => { time[i] = x.time; end[i] = x.end; lane[i] = x.lane; hold[i] = x.hold ? 1 : 0; });
      this.post({ type: 'notes', time, end, lane, hold }, [time.buffer, end.buffer, lane.buffer, hold.buffer]);
      all = true;
    }
    // Time went back (a restart): every note's state goes again, then the window moves on from 0.
    if (t < this.lastT - 0.25) all = true;
    this.lastT = t;
    if (all) this.from = 0;
    while (this.from < list.length && list[this.from].end < t - BEHIND) this.from++;
    const from = all ? 0 : this.from;
    let to = from;
    if (all) to = list.length;
    else while (to < list.length && list[to].time < t + AHEAD) to++;
    const state = new Uint8Array(to - from);
    for (let i = from; i < to; i++) state[i - from] = packNote(list[i]);
    this.flush({ t, at: performance.timeOrigin + at, state, from: all ? 0 : this.from });
  }

  /** Stop carrying the time on (the game paused). */
  hold() { this.post({ type: 'hold' }); }
  /** Stop drawing altogether (out of sight, or a calm still), and start again. */
  sleep(on: boolean) { this.sleeping = on; this.post({ type: 'sleep', on }); }

  receptor(lane: number) { return { x: this.pads[lane * 2], y: this.pads[lane * 2 + 1] }; }
  /** The lane under a screen x: the nearest pad, within half the spacing past the outer ones. */
  laneAt(x: number) {
    const p = (l: number) => this.pads[l * 2];
    const gap = (p(3) - p(0)) / 3;
    if (x < p(0) - gap / 2 || x > p(3) + gap / 2) return -1;
    let best = 0;
    for (let l = 1; l < 4; l++) if (Math.abs(x - p(l)) < Math.abs(x - p(best))) best = l;
    return best;
  }
  get particleCount() { return this.particles; }

  setTiming(spb: number, travel: number) { this.call('setTiming', spb, travel); }
  setHues(hues: [number, number]) { this.call('setHues', [...hues]); }
  setGhostChart(notes: StageNote[]) { this.call('setGhostChart', notes.map((n) => ({ lane: n.lane, time: n.time, end: n.end, hold: n.hold }))); }
  setLevels(l: { bass: number; mid: number; high: number; level: number }) { this.call('setLevels', { ...l }); }
  holding(lane: number, dt: number) { this.call('holding', lane, dt); }
  hit(lane: number, kind: HitKind) { this.call('hit', lane, kind); }
  miss(lane: number) { this.call('miss', lane); }
  milestone(combo: number) { this.call('milestone', combo); }
  section(force = false) { this.call('section', force); }
  cue(kind: 'build' | 'drop' | 'break' | 'flash', strength = 1) { this.call('cue', kind, strength); }
  setFever(on: boolean) { this.call('setFever', on); }
  setPressed(lane: number, down: boolean) { this.call('setPressed', lane, down); }
  onBeat(downbeat: boolean) { this.call('onBeat', downbeat); }
  clear(full: boolean) { this.call('clear', full); }
  fail() { this.call('fail'); }
  revive() { this.call('revive'); }
  climb(side: -1 | 0 | 1, strength: number, o: { width?: number; gold?: number; delay?: number; speed?: number } = {}) { this.call('climb', side, strength, o); }
  burst(lane: number, kind: BurstKind) { this.call('burst', lane, kind); }
  holdFx(lane: number, on: boolean, ok = true) { this.call('holdFx', lane, on, ok); }
  skyEvent(e: SceneEvent) { this.call('skyEvent', e); }

  destroy() {
    this.ro.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.worker.terminate();
    this.canvas.remove();
  }
}
