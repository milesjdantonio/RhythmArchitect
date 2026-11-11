// The beat grid from a trained beat tracker: Beat This! (Foscarin, Schlüter & Widmer, ISMIR 2024,
// CPJKU, MIT licence), its small model (2.1M parameters, public/models/beat-this-small0.onnx, an
// ONNX conversion; see NOTICE.md). It hears where the beats and the downbeats are far more reliably
// than picking a period out of the onsets (automap.ts's own estimate, which stays as the fallback):
// a dancehall groove or a song that leans on its off-beats no longer reads as a faster tempo.
//
// The model is fed exactly what it was trained on: 22050 Hz mono, an STFT of 1024 points every
// 441 samples (50 frames a second, centred, reflect-padded, periodic Hann), magnitudes over
// sqrt(1024), 128 mel bands (Slaney, 30 Hz to 11 kHz, the filterbank in public/models/
// beat-this-mel.bin), log(1 + 1000x). It answers beat and downbeat logits at 50 frames a second,
// in 30-second chunks that overlap by 6 frames each side (as upstream's split_piece and
// aggregate_prediction "keep first"). Then the upstream "minimal" post-processing: a frame is a
// beat if its logit is above 0 and the highest within ±3 frames.

export interface Beats {
  /** Seconds into the audio. */
  beats: number[];
  downbeats: number[];
}

/** A constant grid that fits the beats: what automap needs. */
export interface Grid {
  bpm: number;
  /** Seconds into the audio of a downbeat (beat 0 of some bar). */
  offset: number;
  meter: number;
  /** How steadily the tracked beats keep this tempo, beat to beat, 0..1 (see gridFromBeats). */
  confidence: number;
  /** How much of the song one straight grid explains, 0..1 (low: the beat drifts). */
  fit?: number;
}

const SR = 22050;
const N_FFT = 1024;
const HOP = 441;
const MELS = 128;
const FPS = 50;
const CHUNK = 1500;
const BORDER = 6;

/** Linear resampling to 22050 Hz (the listening pass hears at 22050 or 24000 Hz). */
export function resample(x: Float32Array, sr: number, to = SR): Float32Array {
  if (sr === to) return x;
  const n = Math.floor((x.length * to) / sr);
  const out = new Float32Array(n);
  const step = sr / to;
  for (let i = 0; i < n; i++) {
    const p = i * step, k = Math.floor(p), f = p - k;
    out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? x[k] ?? 0) * f;
  }
  return out;
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** The log-mel spectrogram the model was trained on: frames × 128, row-major. */
export function logMel(x22: Float32Array, filterbank: Float32Array): { data: Float32Array; frames: number } {
  const half = N_FFT / 2;
  const bins = half + 1;
  // centre=True with reflect padding
  const padded = new Float32Array(x22.length + N_FFT);
  for (let i = 0; i < padded.length; i++) {
    let k = i - half;
    if (k < 0) k = -k;
    if (k >= x22.length) k = 2 * (x22.length - 1) - k;
    padded[i] = x22[Math.max(0, Math.min(x22.length - 1, k))] ?? 0;
  }
  const frames = 1 + Math.floor(x22.length / HOP);
  const win = Float32Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)); // periodic Hann
  const re = new Float32Array(N_FFT), im = new Float32Array(N_FFT), mag = new Float32Array(bins);
  const data = new Float32Array(frames * MELS);
  const scale = 1 / Math.sqrt(N_FFT);
  // Each mel band covers a few bins only: their range, so the projection skips the zeros.
  const from = new Int32Array(MELS), to = new Int32Array(MELS);
  for (let m = 0; m < MELS; m++) {
    let a = -1, z = -1;
    for (let k = 0; k < bins; k++) if (filterbank[k * MELS + m] !== 0) { if (a < 0) a = k; z = k; }
    from[m] = Math.max(0, a); to[m] = z + 1;
  }
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = padded[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
    const row = f * MELS;
    for (let m = 0; m < MELS; m++) {
      let s = 0;
      for (let k = from[m]; k < to[m]; k++) s += mag[k] * filterbank[k * MELS + m];
      data[row + m] = Math.log1p(1000 * s);
    }
  }
  return { data, frames };
}

/** Frame indices of beats: logit above 0 and the highest within ±3 frames, neighbours merged. */
export function peaks(logits: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (!(v > 0)) continue;
    let top = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(logits.length - 1, i + 3); j++) if (logits[j] > v) { top = false; break; }
    if (top) out.push(i);
  }
  // Peaks on neighbouring frames (a plateau) are one beat: their mean.
  const merged: number[] = [];
  for (let k = 0; k < out.length; k++) {
    let a = out[k], sum = a, n = 1;
    while (k + 1 < out.length && out[k + 1] - a <= 1) { a = out[++k]; sum += a; n++; }
    merged.push(sum / n);
  }
  return merged;
}

/** ONNX Runtime (ort.ts), passed in so this file stays free of it until it's used. */
type Ort = typeof import('onnxruntime-web/webgpu');

export interface TrackOptions {
  /** The site's models folder. */
  base?: string;
  /** The model file in it. */
  model?: string;
  /** ONNX Runtime execution providers, best first (WebGPU is much faster where there is one). */
  providers?: string[];
}

/**
 * Beats and downbeats of the audio (mono at `sr`), in seconds. `ort` is ONNX Runtime; the model
 * and the filterbank are fetched from the models folder.
 */
export async function trackBeats(ort: Ort, pcm: Float32Array, sr: number, opts: TrackOptions = {}): Promise<Beats> {
  const { base = '/models/', model: file = 'beat-this-small0.onnx', providers = ['wasm'] } = opts;
  const [model, fbBuf] = await Promise.all([
    fetch(`${base}${file}`).then((r) => { if (!r.ok) throw new Error(`beat model: ${r.status}`); return r.arrayBuffer(); }),
    fetch(`${base}beat-this-mel.bin`).then((r) => { if (!r.ok) throw new Error(`mel filterbank: ${r.status}`); return r.arrayBuffer(); }),
  ]);
  const session = await ort.InferenceSession.create(model, { executionProviders: providers });
  const { data, frames } = logMel(resample(pcm, sr), new Float32Array(fbBuf));
  const beat = new Float32Array(frames).fill(-1e9), down = new Float32Array(frames).fill(-1e9);
  // Chunks of 1500 frames overlapping by 2 × 6; each frame keeps the first chunk's answer.
  const step = CHUNK - 2 * BORDER;
  const starts: number[] = [];
  for (let s = -BORDER; s < frames - BORDER; s += step) starts.push(s);
  if (starts.length > 1 && starts[starts.length - 1] + CHUNK > frames + BORDER) starts[starts.length - 1] = Math.max(-BORDER, frames - CHUNK + BORDER);
  const filled = new Uint8Array(frames);
  const name = session.inputNames[0] ?? 'input_spectrogram';
  for (const s of starts) {
    const chunk = new Float32Array(CHUNK * MELS);
    for (let t = 0; t < CHUNK; t++) {
      const f = s + t;
      if (f >= 0 && f < frames) chunk.set(data.subarray(f * MELS, (f + 1) * MELS), t * MELS);
    }
    const out = await session.run({ [name]: new ort.Tensor('float32', chunk, [1, CHUNK, MELS]) });
    const b = out.beat.data as Float32Array, d = out.downbeat.data as Float32Array;
    for (let t = BORDER; t < CHUNK - BORDER; t++) {
      const f = s + t;
      if (f < 0 || f >= frames || filled[f]) continue;
      beat[f] = b[t]; down[f] = d[t]; filled[f] = 1;
    }
  }
  const beats = peaks(beat).map((f) => f / FPS);
  // Downbeats sit on beats: each moves to the nearest beat.
  const downbeats = [...new Set(peaks(down).map((f) => f / FPS).map((t) => beats.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), beats[0] ?? t)))];
  return { beats, downbeats };
}

/**
 * The constant grid that best fits the beats: the period by a least-squares fit of each beat to
 * its index (beats far off the fit are left out, twice), the meter from the downbeats' spacing,
 * and the grid shifted so its beat 0 is a downbeat. Null when there are too few beats.
 */
export function gridFromBeats(all: Beats): Grid | null {
  const { downbeats } = all;
  if (all.beats.length < 8) return null;
  const gaps = all.beats.slice(1).map((b, i) => b - all.beats[i]);
  // The period that explains the most gaps, 60-200 BPM: a gap of one or two periods counts, half a
  // period (a passage the tracker followed at double time) counts half. The plain median would
  // take the double-time passages for the beat.
  let period = 0, bestFit = -1;
  for (let p = 0.3; p <= 1.0; p += 0.001) {
    let s = 0;
    for (const g of gaps) {
      const r = g / p;
      if (Math.abs(r - 1) < 0.07) s += 1;
      else if (Math.abs(r - 2) < 0.1) s += 0.5;
      else if (Math.abs(r - 0.5) < 0.04) s += 0.5;
    }
    // A gentle lean toward 75-160 BPM (where tracked songs mostly are), as a tie-breaker.
    const bpm = 60 / p;
    s *= bpm >= 75 && bpm <= 160 ? 1 : 0.9;
    if (s > bestFit) { bestFit = s; period = p; }
  }
  if (!period) return null;
  // The beats on that grid, each with its index (a skipped beat counts as two); beats between
  // grid beats (the double-time ones) are left out.
  const beats: number[] = [all.beats[0]], idx = [0];
  for (let i = 1; i < all.beats.length; i++) {
    const r = (all.beats[i] - beats[beats.length - 1]) / period;
    if (r < 0.75) continue;
    beats.push(all.beats[i]);
    idx.push(idx[idx.length - 1] + Math.round(r));
  }
  if (beats.length < 8) return null;
  let a = beats[0];
  let use = beats.map(() => true);
  for (let pass = 0; pass < 3; pass++) {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < beats.length; i++) {
      if (!use[i]) continue;
      n++; sx += idx[i]; sy += beats[i]; sxx += idx[i] * idx[i]; sxy += idx[i] * beats[i];
    }
    const den = n * sxx - sx * sx;
    if (n < 8 || den <= 0) break;
    period = (n * sxy - sx * sy) / den;
    a = (sy - period * sx) / n;
    use = beats.map((b, i) => Math.abs(b - (a + period * idx[i])) < period * 0.15);
  }
  // Confidence: how steadily the tracked beats keep this tempo, beat to beat: the share of the
  // song's beats (the grid's own count, first tracked beat to last) whose gap to the one before
  // is a whole number of periods, within 10%. Measured locally on purpose: one straight grid over
  // a whole song (`fit` below) loses phase with the slightest drift (a tempo not quite constant,
  // the listening capture slipping a few ms when the video buffers) though the tempo is right.
  const span = (all.beats[all.beats.length - 1] - all.beats[0]) / period + 1;
  let steady = 0;
  for (let i = 1; i < beats.length; i++) {
    const k = idx[i] - idx[i - 1];
    if (k >= 1 && k <= 2 && Math.abs(beats[i] - beats[i - 1] - k * period) < period * 0.1) steady += k;
  }
  const on = Math.min(1, steady / Math.max(1, span));
  // How much of the song one straight grid explains (shown in the dev tools: low means it drifts).
  const fit = Math.min(1, use.filter(Boolean).length / Math.max(1, span));
  // Meter: 3 or 4, for the game. Bars of 3 (or 6, a compound time) when the downbeats clearly say
  // so; 4 otherwise (the tracker's 2s and 4s are the same feel, and its downbeats are its weaker guess).
  let threes = 0, fours = 0;
  for (let i = 1; i < downbeats.length; i++) {
    const k = Math.round((downbeats[i] - downbeats[i - 1]) / period);
    if (k === 3 || k === 6) threes++;
    else if (k === 2 || k === 4 || k === 8) fours++;
  }
  const meter = threes > fours * 1.5 && threes >= 4 ? 3 : 4;
  // Which beat of the bar the downbeats fall on (the most common), then the earliest such beat at or after 0 s.
  const phase = new Map<number, number>();
  for (const d of downbeats) {
    const k = ((Math.round((d - a) / period) % meter) + meter) % meter;
    phase.set(k, (phase.get(k) ?? 0) + 1);
  }
  let ph = 0, pc = -1;
  for (const [k, c] of phase) if (c > pc) { ph = k; pc = c; }
  const bar = period * meter;
  let offset = a + ph * period;
  offset -= Math.floor(offset / bar) * bar;
  return { bpm: Math.round((60 / period) * 100) / 100, offset: Math.round(offset * 1000) / 1000, meter, confidence: Math.round(on * 100) / 100, fit: Math.round(fit * 100) / 100 };
}
