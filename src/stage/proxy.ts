// The 3D stage on its own thread (perf profile C, stageThread: 'worker').
//
// StageProxy stands in for Stage3D on the page: the game calls the same methods, and the proxy
// queues them and sends them to the worker (stage.worker.ts) once per frame together with the song
// time and each note's state (judged, held). The worker draws on its own frames, carrying the
// song time on by itself for up to a quarter of a second, so a busy main thread (React, a long
// script, garbage collection) no longer stops the tiles. The worker sends back the pads' screen
// positions (for the judgement words and the touch lanes) and the sky's bursts.

import { perf, perfOverrides, recorder, stageInfo } from '../lib/perf';
import type { SceneEvent } from '../background/scene';
import type { BurstKind } from './bursts';
import type { HitKind, StageMode, StageNote } from './Stage3D';

/** Page → worker. */
export type ToStage =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; dpr: number; mode: StageMode; hues?: [number, number]; profile: string; overrides: object }
  | { type: 'size'; width: number; height: number; dpr: number }
  | { type: 'notes'; time: Float32Array; end: Float32Array; lane: Uint8Array; hold: Uint8Array }
  | { type: 'batch'; calls: [string, unknown[]][]; frame?: { t: number; at: number; state: Uint8Array } }
  | { type: 'hold' }
  | { type: 'sleep'; on: boolean };
/** Worker → page. */
export type FromStage =
  | { type: 'tick'; pads: Float32Array; particles: number; at: number; t: number; cpuMs: number; drawMs: number; gpuMs: number }
  | { type: 'sky'; x: number; y: number; strength: number }
  | { type: 'ghost'; lane: number; kind: HitKind }
  | { type: 'info'; backend: string; gpuTimer: boolean }
  | { type: 'slow'; gap: number; cpuMs: number; drawMs: number; late: number; t: number; gpuPeak: number };

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

export class StageProxy {
  static supported() {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  }

  /** Called when a burst appears in the sky (the page's backdrop answers it). */
  onSky?: (x: number, y: number, strength: number) => void;
  /** Showcase: called when the ghost hits a tile. */
  onGhostHit?: (lane: number, kind: HitKind) => void;
  private worker: Worker;
  private canvas: HTMLCanvasElement;
  private calls: [string, unknown[]][] = [];
  private flushing = false;
  private notes: StageNote[] | null = null;
  private state = new Uint8Array(0);
  private pads: Float32Array<ArrayBufferLike> = new Float32Array(8);
  private particles = 0;
  /** Frames the worker drew per second (over half-second windows), for the dev tools. */
  fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private ro: ResizeObserver;

  constructor(host: HTMLElement, opts: { mode: StageMode; hues?: [number, number] }) {
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
        // The meter times the frames the stage draws (here, not the page's loop), from the run's first beat.
        if (m.t >= 0) recorder?.frame(m.at, m.t);
        // Dev: the song time the stage last drew, and when (wall ms), for sync checks.
        if (import.meta.env.DEV) (window as unknown as { __stageClock?: unknown }).__stageClock = { t: m.t, at: m.at, fps: this.fps };
        stageInfo.cpuMs += (m.cpuMs - stageInfo.cpuMs) * 0.1;
        stageInfo.drawMs += (m.drawMs - stageInfo.drawMs) * 0.1;
        stageInfo.gpuMs = m.gpuMs;
      }
      else if (m.type === 'slow') { if (import.meta.env.DEV) ((window as unknown as { __stageSlow?: unknown[] }).__stageSlow ??= []).push(m); }
      else if (m.type === 'info') { stageInfo.backend = m.backend; stageInfo.gpuTimer = m.gpuTimer; }
      else if (m.type === 'ghost') this.onGhostHit?.(m.lane, m.kind);
      else this.onSky?.(m.x, m.y, m.strength);
    };
    this.post({ type: 'init', canvas: offscreen, width: r.width, height: r.height, dpr: devicePixelRatio || 1, mode: opts.mode, hues: opts.hues, profile: perf().id, overrides: perfOverrides() }, [offscreen]);
    this.ro = new ResizeObserver(() => {
      const b = host.getBoundingClientRect();
      this.canvas.style.width = `${b.width}px`;
      this.canvas.style.height = `${b.height}px`;
      this.post({ type: 'size', width: b.width, height: b.height, dpr: devicePixelRatio || 1 });
    });
    this.ro.observe(host);
  }

  private post(m: ToStage, transfer: Transferable[] = []) { this.worker.postMessage(m, transfer); }

  /** Queues a call; it goes with the next frame, or on its own at the end of this task. */
  private call(name: string, ...args: unknown[]) {
    this.calls.push([name, args]);
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => { if (this.calls.length) this.flush(); this.flushing = false; });
    }
  }
  private flush(frame?: { t: number; at: number; state: Uint8Array }) {
    const calls = this.calls;
    this.calls = [];
    this.post({ type: 'batch', calls, frame }, frame ? [frame.state.buffer] : []);
  }

  /**
   * The song time to draw, and the notes (sent whole once, then one byte of state each per frame).
   * `at`: when the time was read (performance.now()), so the worker carries it on from then.
   */
  frame(t: number, notes?: StageNote[], at = performance.now()) {
    // Showcase: no notes (the worker's stage plays its ghost chart).
    const list = notes ?? [];
    if (notes && list !== this.notes) {
      this.notes = list;
      const n = list.length;
      const time = new Float32Array(n), end = new Float32Array(n), lane = new Uint8Array(n), hold = new Uint8Array(n);
      list.forEach((x, i) => { time[i] = x.time; end[i] = x.end; lane[i] = x.lane; hold[i] = x.hold ? 1 : 0; });
      this.post({ type: 'notes', time, end, lane, hold }, [time.buffer, end.buffer, lane.buffer, hold.buffer]);
    }
    if (this.state.length !== list.length) this.state = new Uint8Array(list.length);
    const state = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) state[i] = packNote(list[i]);
    this.flush({ t, at: performance.timeOrigin + at, state });
  }

  /** Stop carrying the time on (the game paused). */
  hold() { this.post({ type: 'hold' }); }
  /** Stop drawing altogether (out of sight, or a calm still), and start again. */
  sleep(on: boolean) { this.post({ type: 'sleep', on }); }

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
    this.worker.terminate();
    this.canvas.remove();
  }
}
