// The listening pass: the browser listens to a YouTube video once and the mapper places every
// tile on what it heard. YouTube's player never hands the page its audio, so Chrome is asked to
// share this tab's sound (getDisplayMedia); the player plays the song once, start to finish, and
// each captured sample is filed under the video position it was heard at. Then the mapper
// (automap.ts, in a worker) finds the beat and every note, and the audio is dropped: only the
// tiles and a loudness curve are kept.
//
// Lining up: a captured sample arrives a little after it was played (Chrome's capture delay). A
// short tick played into the tab before the song measures that delay, so tiles land on the sound.

import * as Tone from 'tone';
import { YT_STATE, ytCue, ytOnError, ytPause, ytPlayFrom, ytRawTime, ytState, ytTime } from '../audio/youtube';
import { unlockAudio } from '../audio/playback';
import type { AutomapResult } from './automap';
import type { FromMapper, ToMapper } from './listen.worker';
import type { ChartProgress, SongLevels } from '../api/types';
import type { Trained, TrainedStage } from './ensomi';
import { Placer, chooseRecording, findTick, type Chunk, type Mark } from './capture';
import { logChunk, logMark, newListenLog, saveListenLog } from './listenLog';

export type ListenFailure = 'unsupported' | 'declined' | 'no-audio' | 'silent' | 'stopped' | 'video';

export class ListenError extends Error {
  constructor(message: string, readonly reason: ListenFailure) { super(message); }
}

/** Whether this browser can share a tab's sound (desktop Chrome and Edge can; phones and Safari can't). */
export function canListen(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return false;
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
  // Firefox and Safari share screens but not a tab's audio.
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent);
}

/** Capture delay to assume when the tick can't be heard (typical for Chrome tab capture). */
const DEFAULT_DELAY = 0.03;

// The calibration tick goes out through this node (dev builds let tests capture it too).
let tickBus: GainNode | null = null;
function tickOut(ctx: AudioContext) {
  if (!tickBus || tickBus.context !== ctx) {
    tickBus = ctx.createGain();
    tickBus.connect(ctx.destination);
  }
  return tickBus;
}
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __listen: unknown }).__listen = {
    ctx: () => Tone.getContext().rawContext as AudioContext,
    connectTick: (node: AudioNode) => tickOut(Tone.getContext().rawContext as AudioContext).connect(node),
  };
}

/**
 * Asks Chrome to share this tab's sound. Call it straight from a click (browsers require it).
 * Resolves to a stream with the audio only.
 */
export async function requestTabAudio(): Promise<MediaStream> {
  if (!canListen()) throw new ListenError("This browser can't share a tab's sound.", 'unsupported');
  // getDisplayMedia first: it needs the click that called this, before anything else is awaited.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      systemAudio: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new ListenError('Sharing the tab was turned down.', 'declined');
    throw new ListenError("Chrome couldn't share the tab's sound.", 'unsupported');
  }
  await unlockAudio();
  tickOut(Tone.getContext().rawContext as AudioContext);
  const audio = stream.getAudioTracks();
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!audio.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new ListenError('Chrome shared no sound. Pick this tab and leave “Also share tab audio” on.', 'no-audio');
  }
  return new MediaStream(audio);
}

const TAP = `
class RythmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.t = 0; }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      if (this.n === 0) this.t = currentTime;
      const a = ch[0], b = ch[1] || ch[0];
      for (let i = 0; i < a.length; i++) this.buf[this.n++] = (a[i] + b[i]) * 0.5;
      if (this.n >= 4096 - 128) { this.port.postMessage({ t: this.t, d: this.buf.slice(0, this.n) }); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('rythm-tap', RythmTap);`;
const tapLoaded = new WeakSet<BaseAudioContext>();

export interface Heard {
  pcm: Float32Array;
  sr: number;
  /** Measured capture delay (seconds), and whether the tick was heard. */
  delay: number;
  calibrated: boolean;
  /** How the recording was lined up with the video (dev tools; see chooseRecording). */
  placement?: string;
}

export interface ListenOptions {
  videoId: string;
  /** Length of the video, if known (else read from the player). */
  seconds?: number;
  onProgress?: (fraction: number) => void;
  /**
   * What's heard, as it is placed, every ~12 ms: the video position (s), its loudness (RMS) and
   * the loudness of the lows (< ~200 Hz), mids and highs (> ~2.5 kHz), for the listening animation.
   */
  onHear?: (position: number, rms: number, low: number, mid: number, high: number) => void;
  signal?: AbortSignal;
}

/** Plays the video once and records what the tab sounds like, filed by video position. */
export async function listenTo(stream: MediaStream, opts: ListenOptions): Promise<Heard> {
  const ctx = Tone.getContext().rawContext as AudioContext;
  const track = stream.getAudioTracks()[0];
  const cleanup: (() => void)[] = [() => stream.getTracks().forEach((t) => t.stop())];
  try {
    const duration = (await ytCue(opts.videoId)) || opts.seconds || 0;
    if (!tapLoaded.has(ctx)) {
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      tapLoaded.add(ctx);
    }
    const src = ctx.createMediaStreamSource(stream);
    // Tone's context wraps the browser's, so the node comes from Tone (a native one won't connect).
    const tap = Tone.getContext().createAudioWorkletNode('rythm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(tap);
    tap.connect(mute);
    mute.connect(ctx.destination);
    cleanup.push(() => { src.disconnect(); tap.disconnect(); mute.disconnect(); tap.port.onmessage = null; });

    // Decimate to ~22-24 kHz (plenty for finding notes; a quarter of the memory).
    const k = Math.max(1, Math.round(ctx.sampleRate / 22050));
    const sr = ctx.sampleRate / k;
    let failure: ListenError | null = null;
    let done = false;
    const fail = (e: ListenError) => { if (!failure) failure = e; };
    track.addEventListener('ended', () => fail(new ListenError('Tab sharing stopped before the song ended.', 'stopped')));
    cleanup.push(ytOnError((e) => fail(new ListenError(e.message, 'video'))));
    const aborted = () => opts.signal?.aborted;

    // 1. The tick: how late captured sound arrives.
    const pre: { t: number; d: Float32Array }[] = [];
    tap.port.onmessage = (e: MessageEvent<{ t: number; d: Float32Array }>) => { pre.push(e.data); };
    await new Promise((r) => setTimeout(r, 400));
    const t0 = ctx.currentTime + 0.08;
    const osc = ctx.createOscillator(), env = ctx.createGain();
    osc.frequency.value = 2200;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.35, t0 + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.012);
    osc.connect(env);
    env.connect(tickOut(ctx));
    osc.start(t0);
    osc.stop(t0 + 0.02);
    await new Promise((r) => setTimeout(r, 750));
    env.disconnect();
    const found = findTick(pre, ctx.sampleRate, t0);
    const calibrated = found !== null && found >= 0 && found < 0.4;
    const delay = calibrated ? found! : DEFAULT_DELAY;

    // 2. The song, once through. Every captured chunk is kept as it came (the capture is seamless),
    // and the player's position is read every frame (context time -> video position); when the
    // song is over, the sound is filed under the positions it was heard at (placeChunks).
    // Band split for the animation: two one-pole low-passes (~200 Hz and ~2.5 kHz).
    const aL = Math.exp((-2 * Math.PI * 200) / sr), aH = Math.exp((-2 * Math.PI * 2500) / sr);
    let fl = 0, fh = 0;
    const marks: Mark[] = [];
    const chunks: Chunk[] = [];
    // Also placed as heard (each chunk by the latest reads): kept in case the seamless placement
    // comes out clearly worse (chooseRecording).
    const asHeard = new Placer(sr, duration || 600);
    let loud = 0, heard = 0;
    // Where the video is, read as often as possible: on every frame while the tab is in view, and
    // on every chunk of sound the audio thread hands over (those keep coming when the tab is
    // hidden, when the page gets no frames at all), with a timer as a last resort.
    const log = newListenLog(opts.videoId, duration, sr, delay, calibrated);
    let finish: (() => void) | null = null;
    let ending = false;
    const sample = () => {
      if (done || ending) return;
      if (aborted() || failure) { ending = true; finish?.(); return; }
      const st = ytState();
      const v = ytTime();
      const c = ctx.currentTime;
      marks.push({ c, v, playing: st === YT_STATE.PLAYING });
      logMark(log, c, v, ytRawTime(), st, typeof document !== 'undefined' && document.hidden, performance.now() / 1000);
      const len = duration || 600;
      opts.onProgress?.(Math.min(1, v / Math.max(1, len)));
      // Nothing but silence 8 s in: the wrong tab, or its sound wasn't shared.
      if (v > 8 && heard > sr * 6 && loud / heard < 1e-7) {
        fail(new ListenError("No sound came through. Share this tab (not another one) with “Also share tab audio” on.", 'silent'));
      }
      if (st === YT_STATE.ENDED || (duration && v >= duration - 0.05)) {
        // Let the last captured chunks arrive.
        ending = true;
        setTimeout(() => finish?.(), 400 + delay * 1000);
      }
    };
    tap.port.onmessage = (e: MessageEvent<{ t: number; d: Float32Array }>) => {
      if (done) return;
      sample();
      const { t, d } = e.data;
      const c = t - delay;
      logChunk(log, c, Math.floor(d.length / k));
      const out = new Float32Array(Math.floor(d.length / k));
      let chunk = 0;
      for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (let j = 0; j < k; j++) sum += d[i * k + j];
        out[i] = sum / k;
        chunk += out[i] * out[i];
      }
      chunks.push({ c, d: out });
      // Live, for the animation and the silence check only: where it is now, from the latest marks.
      let last = -1;
      for (let i = marks.length - 1; i >= 0; i--) if (marks[i].c <= c) { last = i; break; }
      const m = marks[last];
      if (!m || !m.playing || c - m.c > 0.25) return;
      const gaps: number[] = [];
      for (let i = last; i >= 0 && marks[i].c > c - 1 && marks[i].playing; i--) gaps.push(marks[i].c - marks[i].v);
      gaps.sort((x, y) => x - y);
      const pos = c - gaps[gaps.length >> 1];
      asHeard.write(pos, out);
      loud += chunk;
      heard += out.length;
      if (opts.onHear && out.length) {
        const SUB = 256;
        for (let s0 = 0; s0 < out.length; s0 += SUB) {
          const s1 = Math.min(out.length, s0 + SUB);
          let eA = 0, eL = 0, eM = 0, eH = 0;
          for (let i = s0; i < s1; i++) {
            const x = out[i];
            fl = fl * aL + x * (1 - aL);
            fh = fh * aH + x * (1 - aH);
            eA += x * x; eL += fl * fl; eM += (fh - fl) * (fh - fl); eH += (x - fh) * (x - fh);
          }
          const m = s1 - s0;
          opts.onHear(pos + s0 / sr, Math.sqrt(eA / m), Math.sqrt(eL / m), Math.sqrt(eM / m), Math.sqrt(eH / m));
        }
      }
    };
    ytPlayFrom(0);
    const backstop = setInterval(sample, 500);
    try {
      await new Promise<void>((resolve) => {
        finish = resolve;
        const tick = () => { sample(); if (!ending && !done) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
    } finally {
      clearInterval(backstop);
    }
    done = true;
    ytPause();
    if (aborted()) throw new DOMException('Cancelled', 'AbortError');
    if (failure) throw failure;
    const recording = chooseRecording(chunks, marks, sr, duration || 600, asHeard.result());
    if (import.meta.env?.DEV) console.info('[listen] ' + recording.note);
    saveListenLog(log, recording.note);
    return { pcm: recording.pcm, sr, delay, calibrated, placement: recording.note };
  } finally {
    cleanup.forEach((f) => f());
  }
}

export interface Mapped {
  result: AutomapResult;
  levels: SongLevels;
  /**
   * The trained mapper's charts, when the page asked for them (they come after the rest): null,
   * with why, when it couldn't chart the song.
   */
  trained?: Promise<Trained | { failed: string }>;
}

export interface MapOptions {
  split?: boolean;
  /** Chart with the trained mapper (ensomi.ts), its files read from `base` (ensomiModel.ts). */
  trained?: { base: string; title?: string; artist?: string };
  onProgress?: (what: string, p?: number) => void;
  /** Where the trained mapper has got (charting: 0..1 of the song), and each difficulty once made. */
  onStage?: (stage: TrainedStage, p?: number) => void;
  onChart?: (p: ChartProgress) => void;
  /** Stops the worker (the trained charts then never come). */
  signal?: AbortSignal;
}

/**
 * Runs the mapper on what was heard, in a worker so the page stays smooth: the beat tracker, the
 * song split into parts (when `split` and the browser has WebGPU), then the onset mapper; and,
 * when asked, the trained mapper (whose charts `trained` resolves to, after this resolves).
 * `onProgress` hears what it's doing ("splitting the song", 0..1).
 */
export function mapHeard(pcm: Float32Array, sr: number, opts: MapOptions = {}): Promise<Mapped> {
  return new Promise<Mapped>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./listen.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // No workers: map on the page (it pauses for a second or two), without the models.
      Promise.all([import('./automap'), import('./levels')])
        .then(([a, l]) => resolve({ result: a.automap(pcm, sr), levels: l.computeLevels(pcm, sr) }))
        .catch(reject);
      return;
    }
    let charted: ((t: Trained | { failed: string }) => void) | null = null;
    const stop = (why: string) => { worker.terminate(); charted?.({ failed: why }); charted = null; };
    opts.signal?.addEventListener('abort', () => { stop('cancelled'); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    worker.onmessage = (e: MessageEvent<FromMapper>) => {
      const m = e.data;
      if ('progress' in m) { opts.onProgress?.(m.progress, m.p); return; }
      if ('chart' in m) { opts.onChart?.(m.chart); return; }
      if ('stage' in m) { opts.onStage?.(m.stage, m.p); return; }
      if ('result' in m) {
        const out: Mapped = { result: m.result, levels: m.levels };
        if (m.trained) out.trained = new Promise((r) => { charted = r; });
        else worker.terminate();
        resolve(out);
        return;
      }
      worker.terminate();
      if ('trained' in m) { charted?.(m.trained); charted = null; return; }
      if ('trainedFailed' in m) { charted?.({ failed: m.trainedFailed }); charted = null; return; }
      reject(new Error(m.error));
    };
    worker.onerror = (e) => { stop(e.message || 'the mapper failed'); reject(new Error(e.message || 'The mapper failed.')); };
    worker.postMessage({ pcm, sr, split: !!opts.split, trained: opts.trained } satisfies ToMapper, [pcm.buffer]);
  });
}
