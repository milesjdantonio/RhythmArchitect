// The notes heard in the song: Basic Pitch (Spotify's note transcription; Apache-2.0, model in
// public/models/basic-pitch.onnx, 230 KB, licence beside it; see NOTICE.md). On every listen with
// WebGPU it hears the vocal split off the song: its notes' starts are the sung syllables the charts
// follow (voice.ts). The mapping studies (ensomiModel.ts STUDY_KEY) also run it on the whole mix:
// there it hears notes under 16% of the human tiles the onset mapper doesn't, but as sounds, holds
// or added tiles on the mix its notes moved no measure of the charts (Nov 20; CLAUDE.md). It hears pitched notes
// (a voice, a melody, a bass line) note by note, with their pitch and length, where the onset
// mapper (automap.ts) hears jumps in loudness: a sung line moving from note to note without a new
// attack is a run of notes here, and nothing there. In a full mix nearly every sound reads as
// pitched to the onset mapper; here a note is a pitch that holds.
//
// The model reads 2-second windows of audio at 22050 Hz (overlapping by 30 of its frames, half
// trimmed each side) and gives, for each of its frames (86 a second) and each of 88 piano keys, how
// likely a note is sounding there and how likely one starts. Notes are decoded as Basic Pitch does
// (its outputToNotesPoly): a start is a peak of the onsets (or of a sudden rise in a sounding note)
// above ONSET; the note lasts while it keeps sounding above FRAME (gaps up to TOLERANCE frames).
// Its second search, for notes without a clear start (the "melodia trick"), is left out: the tiles
// only need starts, and that search scans the whole song once per note.

import type { Ort } from './ort';
import { resample } from './beats';

const SR = 22050;
const HOP = 256;
/** The model's frames a second (Basic Pitch rounds it down, and so must we to line up). */
const FPS = Math.floor(SR / HOP);
const WINDOW = SR * 2 - HOP; // 43844 samples
const OVERLAP = 30; // frames
const OVERLAP_SAMPLES = OVERLAP * HOP;
const STEP = WINDOW - OVERLAP_SAMPLES;
const FRAMES_PER_WINDOW = FPS * 2; // 172
const KEYS = 88;
const LOWEST = 21; // MIDI of the lowest key
/** Each window's frames once its overlap is trimmed (half each side). */
const KEEP = FRAMES_PER_WINDOW - OVERLAP;

/** A note starts where its onset peaks above this... */
export const ONSET = 0.5;
/** ...and lasts while it sounds above this... */
export const FRAME = 0.3;
/** ...allowing this many frames below it; shorter notes than MIN_LEN frames (~70 ms) are dropped. */
const TOLERANCE = 11;
const MIN_LEN = 6;

export interface HeardNote {
  /** Seconds into the audio it starts, and how long it sounds. */
  sec: number;
  len: number;
  /** MIDI pitch (60 = C4). */
  midi: number;
  /** How strongly it sounds (0..1, the mean of its frames), and how clearly it starts (0..1). */
  amp: number;
  onset: number;
}

export interface NotesOptions {
  /** The site's models folder. */
  base?: string;
  /** The model's bytes, when they're at hand (tests): else fetched from `base`. */
  model?: ArrayBuffer | Uint8Array;
  providers?: string[];
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * The frame (of the model's output, after unwrapping) to seconds: window w starts STEP samples
 * after the one before (with the half overlap of silence before the audio), and its kept frames
 * come HOP apart from its first kept one, OVERLAP / 2 frames in, which falls on w * STEP. (Basic
 * Pitch times them as if every window gave FRAMES_PER_WINDOW frames, with a correction that steps
 * up to 10 ms at each window's edge.)
 */
const frameToSec = (f: number) => { const w = Math.floor(f / KEEP); return (w * STEP + (f - w * KEEP) * HOP) / SR; };

/** Every note heard in the audio (mono at `sr`), in time order. */
export async function hearNotes(ort: Ort, pcm: Float32Array, sr: number, opts: NotesOptions = {}): Promise<HeardNote[]> {
  const { base = '/models/', providers = ['wasm'] } = opts;
  const model: ArrayBuffer | Uint8Array = opts.model ?? await fetch(`${base}basic-pitch.onnx`).then((r) => { if (!r.ok) throw new Error(`note model: ${r.status}`); return r.arrayBuffer(); });
  const session = await ort.InferenceSession.create(model instanceof Uint8Array ? model : new Uint8Array(model), { executionProviders: providers });
  const x = sr === SR ? pcm : resample(pcm, sr, SR);
  const { frames, onsets, n } = await run(ort, session, x, opts);
  return decode(frames, onsets, n);
}

/** The model over the whole song: its note and onset activations, `n` frames × KEYS. */
async function run(ort: Ort, session: Awaited<ReturnType<Ort['InferenceSession']['create']>>, x: Float32Array, opts: NotesOptions) {
  const n = Math.floor(x.length * (FPS / SR));
  const frames = new Float32Array(n * KEYS), onsets = new Float32Array(n * KEYS);
  const input = session.inputNames[0];
  // The outputs, by shape and Basic Pitch's naming: :0 the pitch contour (264 bins), :1 the
  // notes, :2 the onsets.
  const [noteName, onsetName] = ['StatefulPartitionedCall:1', 'StatefulPartitionedCall:2'].every((k) => session.outputNames.includes(k))
    ? ['StatefulPartitionedCall:1', 'StatefulPartitionedCall:2'] : [session.outputNames[1], session.outputNames[2]];
  // The audio with half an overlap of silence before it, in windows STEP apart (the last padded).
  const padded = OVERLAP_SAMPLES / 2;
  const total = padded + x.length;
  const windows = Math.max(1, Math.ceil(total / STEP));
  const keep = KEEP;
  let at = 0;
  const buf = new Float32Array(WINDOW);
  for (let w = 0; w < windows && at < n; w++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    buf.fill(0);
    const start = w * STEP - padded; // where the window starts in the audio
    for (let i = 0; i < WINDOW; i++) {
      const j = start + i;
      if (j >= 0 && j < x.length) buf[i] = x[j];
    }
    const out = await session.run({ [input]: new ort.Tensor('float32', buf, [1, WINDOW, 1]) });
    const note = out[noteName].data as Float32Array, onset = out[onsetName].data as Float32Array;
    const rows = Math.min(keep, n - at);
    frames.set(note.subarray((OVERLAP / 2) * KEYS, (OVERLAP / 2 + rows) * KEYS), at * KEYS);
    onsets.set(onset.subarray((OVERLAP / 2) * KEYS, (OVERLAP / 2 + rows) * KEYS), at * KEYS);
    at += rows;
    opts.onProgress?.(Math.min(1, at / n));
  }
  return { frames, onsets, n: at };
}

/** Notes from the activations, as Basic Pitch decodes them (its onset-led part). */
export function decode(frames: Float32Array, onsets: Float32Array, n: number): HeardNote[] {
  // Onsets, with the sudden rises of sounding notes added (rescaled to the onsets' peak): a note
  // whose start the onset head missed still starts where it grows.
  const inferred = new Float32Array(n * KEYS);
  let onsetMax = 0, diffMax = 0;
  const diff = new Float32Array(n * KEYS);
  for (let t = 2; t < n; t++) {
    for (let k = 0; k < KEYS; k++) {
      const v = frames[t * KEYS + k];
      const d = Math.max(0, Math.min(v - frames[(t - 1) * KEYS + k], v - frames[(t - 2) * KEYS + k]));
      diff[t * KEYS + k] = d;
      if (d > diffMax) diffMax = d;
    }
  }
  for (let i = 0; i < n * KEYS; i++) if (onsets[i] > onsetMax) onsetMax = onsets[i];
  const scale = diffMax > 0 ? onsetMax / diffMax : 0;
  for (let i = 0; i < n * KEYS; i++) inferred[i] = Math.max(onsets[i], diff[i] * scale);

  // Starts: peaks in time (higher than the frame before and after) above ONSET.
  const starts: { t: number; k: number; v: number }[] = [];
  for (let k = 0; k < KEYS; k++) {
    for (let t = 0; t < n; t++) {
      const v = inferred[t * KEYS + k];
      if (v <= ONSET) continue;
      if (t > 0 && !(v > inferred[(t - 1) * KEYS + k])) continue;
      if (t < n - 1 && !(v > inferred[(t + 1) * KEYS + k])) continue;
      starts.push({ t, k, v });
    }
  }
  // Latest first (as Basic Pitch goes), each note using up the energy it covers (and its
  // neighbouring keys'), so an earlier start at the same pitch ends where a later one begins.
  starts.sort((a, b) => b.t - a.t || b.k - a.k);
  const left = Float32Array.from(frames);
  const notes: HeardNote[] = [];
  for (const { t: s, k, v } of starts) {
    if (s >= n - 1) continue;
    let i = s + 1, below = 0;
    while (i < n - 1 && below < TOLERANCE) {
      below = left[i * KEYS + k] < FRAME ? below + 1 : 0;
      i++;
    }
    i -= below;
    if (i - s <= MIN_LEN) continue;
    let amp = 0;
    for (let j = s; j < i; j++) {
      amp += frames[j * KEYS + k];
      left[j * KEYS + k] = 0;
      if (k < KEYS - 1) left[j * KEYS + k + 1] = 0;
      if (k > 0) left[j * KEYS + k - 1] = 0;
    }
    const sec = frameToSec(s);
    notes.push({ sec, len: frameToSec(i) - sec, midi: k + LOWEST, amp: amp / (i - s), onset: Math.min(1, v) });
  }
  return notes.sort((a, b) => a.sec - b.sec || a.midi - b.midi);
}

