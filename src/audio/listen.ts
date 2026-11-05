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
import { YT_STATE, ytCue, ytOnError, ytPause, ytPlayFrom, ytState, ytTime } from './youtube';
import { unlockAudio } from './engine';
import type { AutomapResult } from '../music/automap';
import type { SongLevels } from '../api/types';
import { Placer, findTick } from './capture';

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

    // 2. The song, once through. The player's position is sampled every frame (context time ->
    // video position) so each captured chunk can be placed where it was heard.
    const placer = new Placer(sr, duration || 600);
    // Band split for the animation: two one-pole low-passes (~200 Hz and ~2.5 kHz).
    const aL = Math.exp((-2 * Math.PI * 200) / sr), aH = Math.exp((-2 * Math.PI * 2500) / sr);
    let fl = 0, fh = 0;
    const marks: { c: number; v: number; playing: boolean }[] = [];
    let loud = 0, heard = 0;
    tap.port.onmessage = (e: MessageEvent<{ t: number; d: Float32Array }>) => {
      if (done) return;
      const { t, d } = e.data;
      const c = t - delay;
      // The latest mark at or before c (marks are in time order): was the video playing then?
      let last = -1;
      for (let i = marks.length - 1; i >= 0; i--) if (marks[i].c <= c) { last = i; break; }
      const m = marks[last];
      if (!m || !m.playing || c - m.c > 0.25) return;
      // Where it was: the video runs at 1x, so context time minus position is a constant while it
      // plays. The median over the last second of marks irons out frame-to-frame jitter.
      const gaps: number[] = [];
      for (let i = last; i >= 0 && marks[i].c > c - 1 && marks[i].playing; i--) gaps.push(marks[i].c - marks[i].v);
      gaps.sort((x, y) => x - y);
      const pos = c - gaps[gaps.length >> 1];
      const out = new Float32Array(Math.floor(d.length / k));
      let chunk = 0;
      for (let i = 0; i < out.length; i++) {
        let sum = 0;
        for (let j = 0; j < k; j++) sum += d[i * k + j];
        out[i] = sum / k;
        chunk += out[i] * out[i];
      }
      loud += chunk;
      heard += out.length;
      placer.write(pos, out);
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
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (aborted() || failure) { resolve(); return; }
        const st = ytState();
        const v = ytTime();
        marks.push({ c: ctx.currentTime, v, playing: st === YT_STATE.PLAYING });
        if (marks.length > 600) marks.splice(0, 300);
        const len = duration || placer.pcm.length / sr;
        opts.onProgress?.(Math.min(1, v / Math.max(1, len)));
        // Nothing but silence 8 s in: the wrong tab, or its sound wasn't shared.
        if (v > 8 && heard > sr * 6 && loud / heard < 1e-7) {
          fail(new ListenError("No sound came through. Share this tab (not another one) with “Also share tab audio” on.", 'silent'));
        }
        if (st === YT_STATE.ENDED || (duration && v >= duration - 0.05)) {
          // Let the last captured chunks arrive.
          setTimeout(resolve, 400 + delay * 1000);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    done = true;
    ytPause();
    if (aborted()) throw new DOMException('Cancelled', 'AbortError');
    if (failure) throw failure;
    return { pcm: placer.result(), sr, delay, calibrated };
  } finally {
    cleanup.forEach((f) => f());
  }
}

export interface Mapped { result: AutomapResult; levels: SongLevels }

/** Runs the mapper on what was heard, in a worker so the page stays smooth. */
export function mapHeard(pcm: Float32Array, sr: number): Promise<Mapped> {
  return new Promise<Mapped>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../music/listen.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // No workers: map on the page (it pauses for a second or two).
      Promise.all([import('../music/automap'), import('../music/levels')])
        .then(([a, l]) => resolve({ result: a.automap(pcm, sr), levels: l.computeLevels(pcm, sr) }))
        .catch(reject);
      return;
    }
    worker.onmessage = (e: MessageEvent<Mapped | { error: string }>) => {
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error)); else resolve(e.data);
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'The mapper failed.')); };
    worker.postMessage({ pcm, sr }, [pcm.buffer]);
  });
}
