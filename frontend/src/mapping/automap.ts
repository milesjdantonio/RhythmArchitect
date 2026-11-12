// Maps real audio into charts, the way the backend's AI mapper is meant to (this one is plain
// signal processing, used to map the bundled test tracks; see tools/map-audio.mjs).
// The rule: every tile is a sound in the track, at the moment it is heard.
//
//   1. Onset strength from a log-frequency spectrogram (24 bands per octave): the rise in each
//      band over the frame before, with that frame widened by a band either side (SuperFlux),
//      so a melody changing pitch without getting louder counts as a new note while vibrato
//      doesn't. Three energy bands (lows, mids, highs) still say what kind of sound it is.
//   2. Tempo from the autocorrelation of the onset curve, preferring 80–170 BPM.
//   3. Beat grid: the phase whose beats line up with the most onset energy; beat 0 is the
//      downbeat with the most low-end (the kick). Then the grid is lined up with the attacks.
//   4. Onsets: local maxima of that curve above its local average (a short window before and
//      after), each timed to its exact attack (to a few ms).
//      Attacks within 20 ms of a 16th sit on it; the rest keep their exact time.
//   5. Each onset becomes a note: its pitch (or, for a drum, its brightness) picks the lane, how long it
//      rings decides holds, the biggest downbeats become chords on Hard. charts.ts then picks
//      which of these notes Easy, Medium and Hard play. Nothing is added or moved.
//   6. Every sound is also exported as a SoundEvent: the trained mapper (ensomi.ts) lines its
//      tiles up with them and weighs them by how strongly they stand out. These charts are the
//      fallback when it can't chart the song.
//
// Pure functions over a mono Float32Array, so it runs in a browser, a worker or a test.

import type { MapReport, SoundEvent } from '../api/types';
import { buildCharts, type MelodyNote } from './charts';
import { SCALES, midiToName, rootIndex } from './theory';

/** A sound counts as pitched (a note) above this harmonic clarity; below it, it's noise (a drum). */
export const PITCHED_CLARITY = 2.2;

export interface AutomapOptions {
  meter?: number;
  /** Key of the track, e.g. "C" and "minor" (names the pitches of chord notes). */
  key?: string;
  scale?: keyof typeof SCALES;
  /** Clamp the detected tempo into this range by doubling or halving. */
  bpmRange?: [number, number];
  /**
   * A beat grid from the trained beat tracker (beats.ts): used instead of the mapper's own tempo
   * and phase estimate (its meter too) when its beat is steady (see useGrid).
   */
  grid?: { bpm: number; offset: number; meter: number; confidence: number; fit?: number } | null;
  /**
   * The song split into parts (stems.ts), each mono at the same rate and length as the mix:
   * sounds are then found in each part on its own.
   */
  stems?: Partial<Record<PartName, Float32Array>> | null;
  /** Why there's no grid when the beat tracker failed (for the report). */
  gridError?: string;
}

/** The parts a song is split into (Demucs's four stems). */
export type PartName = 'drums' | 'bass' | 'vocals' | 'other';
export const PART_NAMES: PartName[] = ['drums', 'bass', 'vocals', 'other'];

/**
 * The beat tracker's grid is used when its beats keep a steady tempo for at least this share of
 * the song (`confidence`). Every right tempo on the 14 test songs scored 75% or more; songs sped
 * up to 200 BPM, through a simulated listen, as low as 46% (and the fallback, the onset estimate,
 * reads fast songs at 2/3 of their tempo).
 */
export const GRID_TRUST = 0.4;
/** Its straight-grid `fit` at least this much means one grid stays on the beat all song long. */
export const GRID_STRAIGHT = 0.5;

/** The stretches the grid is checked in, in seconds (each judged by its sounds and its neighbours'). */
const HOLD_BIN = 4;

/**
 * Where a straight beat grid (`offset` s, `spb` s a beat) lines up with the song's sounds (`secs`):
 * true for a time in a stretch (and its neighbours) whose sounds peak on the 16ths: half again as
 * many within 6 ms of one as, for the same width, 6-18 ms off (sounds that don't follow the grid
 * spread evenly; on a composed track about 2.5 times), and those near one sit on it, not to one
 * side (median within 6 ms). Where the song's beat drifts off the grid, or there are too few
 * sounds to tell, false: sounds there keep their own times.
 */
export function gridHolds(secs: number[], offset: number, spb: number): (sec: number) => boolean {
  const six = spb / 4;
  const last = secs.length ? secs[secs.length - 1] : 0;
  const n = Math.floor(last / HOLD_BIN) + 1;
  const ok: boolean[] = [];
  const sorted = [...secs].sort((a, b) => a - b);
  let lo = 0;
  for (let b = 0; b < n; b++) {
    const from = b * HOLD_BIN - HOLD_BIN / 2, to = (b + 1) * HOLD_BIN + HOLD_BIN / 2;
    while (lo < sorted.length && sorted[lo] < from) lo++;
    const near: number[] = [];
    let on = 0, beside = 0;
    for (let i = lo; i < sorted.length && sorted[i] < to; i++) {
      const k = (sorted[i] - offset) / six;
      const r = Math.abs((k - Math.round(k)) * six);
      if (r < 0.006) on++;
      else if (r < 0.018) beside++;
      if (r < 0.02) near.push((k - Math.round(k)) * six);
    }
    near.sort((a, b) => a - b);
    // `beside` spans twice the width of `on`: an even spread gives on = beside / 2.
    ok.push(on + beside >= 8 && on >= beside * 0.75 && Math.abs(near[near.length >> 1] ?? 1) <= 0.006);
  }
  return (sec) => ok[Math.min(n - 1, Math.max(0, Math.floor(sec / HOLD_BIN)))] ?? false;
}

/**
 * Whether the mapper takes the beat tracker's grid over its own tempo estimate: whenever the
 * tracker found a steady beat. (A guard for a 3:2 clash between the two was tried and dropped:
 * on the test songs it was right once and wrong once, and the onset estimate reads fast songs at
 * 2/3 of their tempo.) Returns why not, or null to use it.
 */
export function gridRefusal(grid: { bpm: number; confidence: number; fit?: number }): string | null {
  if (!(grid.bpm > 40 && grid.bpm < 260)) return `${grid.bpm} BPM is out of range`;
  if (grid.confidence < GRID_TRUST) return `its beat is steady for only ${Math.round(grid.confidence * 100)}% of the song (needs ${Math.round(GRID_TRUST * 100)}%)`;
  return null;
}

export interface AutomapResult {
  bpm: number;
  /** Beats per bar (from the beat tracker when its grid is used, else the option, 4 by default). */
  meter: number;
  /** Seconds into the audio where beat 0 lands. */
  offset: number;
  /**
   * The grid sits on the music's beats all song long: the beat tracker's grid was used and its
   * beats hold one straight grid (with drift, beat 0 and the tempo are right on average only).
   */
  onBeatGrid: boolean;
  /** The grid given (opts.grid) set the tempo and beat 0; false: the mapper's own estimate did. */
  gridUsed: boolean;
  lengthBeats: number;
  charts: ReturnType<typeof buildCharts>;
  report: MapReport;
  onsets: number;
  /** Every sound found, in seconds into the audio (before difficulties pick from them). */
  onsetTimes: number[];
  /** Dev: what the mapper heard in each sound (pitch, how clearly pitched, brightness, band). */
  onsetInfo: { sec: number; midi: number; clarity: number; bright: number; band: number }[];
  /** Every sound found, described (one per onset, ids in time order): the trained mapper lines its tiles up with them. */
  events: SoundEvent[];
  /** Loudness of every bar from beat 0, 0..1. */
  barEnergy: number[];
}

const HOP = 512;

/** Band energies per hop: lows (< ~180 Hz), highs (> ~2.5 kHz) and everything between. */
function bandEnvelopes(x: Float32Array, sr: number) {
  const n = Math.floor(x.length / HOP);
  const low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n), all = new Float32Array(n);
  const aL = Math.exp((-2 * Math.PI * 180) / sr);
  const aH = Math.exp((-2 * Math.PI * 2500) / sr);
  let lp = 0, lp2 = 0;
  for (let f = 0; f < n; f++) {
    let eL = 0, eM = 0, eH = 0, eA = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) {
      const s = x[i];
      lp = (1 - aL) * s + aL * lp; // one-pole low-pass at 180 Hz
      lp2 = (1 - aH) * s + aH * lp2; // one-pole low-pass at 2.5 kHz
      const h = s - lp2;
      const m = lp2 - lp;
      eL += lp * lp; eM += m * m; eH += h * h; eA += s * s;
    }
    low[f] = eL / HOP; mid[f] = eM / HOP; high[f] = eH / HOP; all[f] = eA / HOP;
  }
  return { low, mid, high, all, n };
}

/**
 * SuperFlux novelty (Böck & Widmer 2013) over a log-frequency spectrogram: for every frame, the
 * summed rise of each band over the frame before, where the frame before is first widened by a
 * band either side. A note that moves to a new pitch lights a new band (a new note); vibrato
 * wobbles within the widened band (no new note). One value per HOP, aligned with bandEnvelopes.
 */
function superflux(x: Float32Array, sr: number, n: number): Float32Array {
  const N = sr > 30000 ? 2048 : 1024;
  const half = N / 2;
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  // 24 bands per octave from 50 Hz up to 11 kHz (or the top of the audio); low bands that share
  // an FFT bin are merged.
  const edges: number[] = [];
  const top = Math.min(11000, sr * 0.45);
  for (let f = 50; f <= top; f *= Math.pow(2, 1 / 24)) {
    const bin = Math.round((f * N) / sr);
    if (bin !== edges[edges.length - 1]) edges.push(bin);
  }
  const B = edges.length - 1;
  const prev = new Float32Array(B), cur = new Float32Array(B);
  const re = new Float32Array(N), im = new Float32Array(N);
  const out = new Float32Array(n);
  const norm = 4 / N;
  for (let f = 0; f < n; f++) {
    const start = f * HOP + HOP / 2 - half;
    for (let i = 0; i < N; i++) { re[i] = (x[start + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < B; b++) {
      let v = 0;
      const a = edges[b], z = Math.max(a + 1, edges[b + 1]);
      for (let k = a; k < z && k < half; k++) v += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      cur[b] = Math.log1p((v * norm * 100) / (z - a));
    }
    if (f > 0) {
      let d = 0;
      for (let b = 0; b < B; b++) {
        const m = Math.max(prev[b], b > 0 ? prev[b - 1] : 0, b + 1 < B ? prev[b + 1] : 0);
        if (cur[b] > m) d += cur[b] - m;
      }
      out[f] = d;
    }
    prev.set(cur);
  }
  return out;
}

function flux(e: Float32Array) {
  const out = new Float32Array(e.length);
  for (let i = 1; i < e.length; i++) out[i] = Math.max(0, Math.log(e[i] + 1e-9) - Math.log(e[i - 1] + 1e-9));
  return out;
}

function movingMean(x: Float32Array, half: number) {
  const out = new Float32Array(x.length);
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < x.length + half; i++) {
    if (i < x.length) { sum += x[i]; q.push(x[i]); }
    if (q.length > half * 2 + 1) sum -= q.shift()!;
    const c = i - half;
    if (c >= 0 && c < x.length) out[c] = sum / q.length;
  }
  return out;
}

/**
 * The exact attack near an onset frame: the sharpest rise of a 128-sample energy envelope of
 * the band that triggered it (the low band for kicks, the high band for hats…).
 */
function attackTime(x: Float32Array, sr: number, frame: number, band: 0 | 1 | 2) {
  const B = 128, STEP = 64, WARM = 1024;
  const a = Math.max(0, (frame - 1) * HOP), z = Math.min(x.length, (frame + 2) * HOP);
  const aL = Math.exp((-2 * Math.PI * 180) / sr), aH = Math.exp((-2 * Math.PI * 2500) / sr);
  let lp = 0, lp2 = 0;
  for (let i = Math.max(0, a - WARM); i < a; i++) { lp = (1 - aL) * x[i] + aL * lp; lp2 = (1 - aH) * x[i] + aH * lp2; }
  const y = new Float32Array(Math.max(0, z - a));
  for (let i = a; i < z; i++) {
    lp = (1 - aL) * x[i] + aL * lp;
    lp2 = (1 - aH) * x[i] + aH * lp2;
    y[i - a] = band === 0 ? lp : band === 1 ? lp2 - lp : x[i] - lp2;
  }
  let best = -Infinity, at = frame * HOP, prev = NaN;
  for (let s = 0; s + B <= y.length; s += STEP) {
    let e = 0;
    for (let k = s; k < s + B; k++) e += y[k] * y[k];
    const le = Math.log(e / B + 1e-12);
    // A jump between this block and the one half a block earlier: the attack is in the new half.
    if (!Number.isNaN(prev) && le - prev > best) { best = le - prev; at = a + s + 96; }
    prev = le;
  }
  return at / sr;
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
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

const FFT_N = 2048;
const HANN = Float32Array.from({ length: FFT_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1)));

/**
 * Just after an attack: the main pitch (MIDI, the harmonic series that carries the most energy),
 * how clearly pitched the sound is (that series against the average one: drums score low), and
 * its brightness (the spectral centroid, as a MIDI-like number).
 */
function pitchAt(x: Float32Array, sr: number, sec: number): { midi: number; clarity: number; bright: number } {
  const start = Math.floor((sec + 0.012) * sr);
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) re[i] = (x[start + i] ?? 0) * HANN[i];
  fft(re, im);
  const half = FFT_N / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const at = (bin: number) => {
    const i = Math.floor(bin);
    if (i + 1 >= half) return 0;
    return mag[i] + (mag[i + 1] - mag[i]) * (bin - i);
  };
  let best = 60, bestScore = -1, sum = 0, count = 0;
  for (let m = 36; m <= 96; m++) {
    const f0 = 440 * Math.pow(2, (m - 69) / 12);
    let s = 0;
    for (let h = 1; h <= 6; h++) {
      const bin = (h * f0 * FFT_N) / sr;
      if (bin >= half - 1) break;
      s += Math.max(at(bin - 0.5), at(bin), at(bin + 0.5)) / Math.sqrt(h);
    }
    sum += s; count++;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  let num = 0, den = 0;
  for (let i = 1; i < half; i++) { num += ((i * sr) / FFT_N) * mag[i]; den += mag[i]; }
  const centroid = den > 0 ? num / den : 440;
  const bright = 69 + 12 * Math.log2(Math.max(30, centroid) / 440);
  return { midi: best, clarity: bestScore / Math.max(1e-9, sum / count), bright };
}

export function automap(samples: Float32Array, sr: number, opts: AutomapOptions = {}): AutomapResult {
  let meter = opts.meter ?? 4;
  const fps = sr / HOP;
  const { low, mid, high, all, n } = bandEnvelopes(samples, sr);
  const fL = flux(low), fM = flux(mid), fH = flux(high);
  // Gate out flux from near-silence (log flux explodes on tiny energies).
  const loud = movingMean(all, Math.round(fps * 2));
  const novelty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gate = all[i] > loud[i] * 0.05 ? 1 : 0;
    novelty[i] = gate * (fL[i] * 1.2 + fM[i] + fH[i] * 0.8);
  }
  const base = movingMean(novelty, Math.round(fps * 0.25));
  const nov = novelty.map((v, i) => Math.max(0, v - base[i]));
  // For tempo and the beat grid, lean on the low end: kicks carry the beat; hats and strings
  // on the off-beats would otherwise make dotted or doubled tempos look just as good.
  const beatEnv = new Float32Array(n);
  for (let i = 0; i < n; i++) beatEnv[i] = (all[i] > loud[i] * 0.05 ? 1 : 0) * (fL[i] * 2 + fM[i] * 0.6 + fH[i] * 0.3);
  const bBase = movingMean(beatEnv, Math.round(fps * 0.25));
  for (let i = 0; i < n; i++) beatEnv[i] = Math.max(0, beatEnv[i] - bBase[i]);
  // Blur by a couple of frames so beats that fall between frames still correlate.
  const smooth = new Float32Array(n);
  const K = [0.2, 0.5, 1, 0.5, 0.2];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += (beatEnv[i + j] ?? 0) * K[j + 2];
    smooth[i] = s;
  }

  // Tempo by autocorrelation, with a gentle preference for ~120 BPM.
  const [lo, hi] = opts.bpmRange ?? [80, 170];
  // Autocorrelation, then a comb: a lag scores with its multiples too, so only the real beat period
  // (whose 2x, 3x, 4x all land on beats) beats look-alikes such as a dotted beat.
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
  const acf = new Float32Array(maxLag * 4 + 2);
  for (let lag = 1; lag < acf.length; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += smooth[i] * smooth[i - lag];
    acf[lag] = s / Math.max(1, n - lag);
  }
  const peakNear = (l: number) => Math.max(acf[Math.floor(l)] ?? 0, acf[Math.ceil(l)] ?? 0, acf[Math.floor(l) - 1] ?? 0, acf[Math.ceil(l) + 1] ?? 0);
  let bestLag = minLag, bestScore = -1, total = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = acf[lag] + 0.5 * peakNear(lag * 2) + 0.33 * peakNear(lag * 3) + 0.25 * peakNear(lag * 4);
    const bpm = (60 * fps) / lag;
    const pref = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    s *= pref;
    scores.push(s);
    total += s;
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  // Parabolic refinement around the peak.
  const k = bestLag - minLag;
  let lag = bestLag;
  if (k > 0 && k < scores.length - 1) {
    const a = scores[k - 1], b = scores[k], c = scores[k + 1];
    const d = (a - c) / (2 * (a - 2 * b + c) || 1);
    if (Math.abs(d) < 1) lag = bestLag + d;
  }
  let roughBpm = (60 * fps) / lag;
  while (roughBpm < lo) roughBpm *= 2;
  while (roughBpm > hi) roughBpm /= 2;
  let confidence = Math.min(1, (bestScore / (total / scores.length)) / 6);

  // Fine-tune tempo and phase together: the grid that puts the most onset energy on its beats.
  // (A tempo off by half a BPM drifts a whole 16th over a minute.)
  const sumAt = (env: Float32Array, phase: number, step: number) => {
    let s = 0;
    for (let t = phase; t < n; t += step) {
      const i = Math.round(t);
      s += Math.max(env[i] ?? 0, (env[i - 1] ?? 0) * 0.5, (env[i + 1] ?? 0) * 0.5);
    }
    return s;
  };
  let bpm = roughBpm, phase = 0, best = -1;
  for (let b = roughBpm * 0.985; b <= roughBpm * 1.015; b += 0.02) {
    const per = (60 * fps) / b;
    for (let p = 0; p < per; p += 0.5) {
      const s = sumAt(beatEnv, p, per);
      if (s > best) { best = s; phase = p; bpm = b; }
    }
  }
  bpm = Math.round(bpm * 100) / 100;
  // The trained beat tracker's grid when its beat is steady: its tempo, its downbeat and its meter.
  const ownBpm = bpm;
  const g = opts.grid;
  const refusal = g ? gridRefusal(g) : null;
  const grid = g && !refusal ? g : null;
  // What the beat tracker found, and whether it set the grid (the dev tools show it).
  const straight = g?.fit != null ? `, one straight grid ${Math.round(g.fit * 100)}%` : '';
  const beatNote = opts.gridError ? `Beat This! failed (${opts.gridError}); own estimate used`
    : g === null ? 'Beat This! found no steady beat; own estimate used'
    : g ? `Beat This!: ${g.bpm} BPM, ${g.meter}/4, steady ${Math.round(g.confidence * 100)}%${straight} (${grid ? `used; own estimate was ${ownBpm} BPM` : `not used: ${refusal}; own estimate ${ownBpm} BPM`})`
    : undefined;
  if (grid) {
    bpm = Math.round(grid.bpm * 100) / 100;
    meter = grid.meter;
    confidence = grid.confidence;
  }
  const period = (60 * fps) / bpm; // frames per beat
  let firstFrame: number;
  if (grid) firstFrame = grid.offset * fps;
  else {
    // Downbeat: of the `meter` beat positions in a bar, the one with the most low-end onsets.
    let bar = 0, barBest = -1;
    for (let j = 0; j < meter; j++) {
      const s = sumAt(fL, phase + j * period, period * meter);
      if (s > barBest) { barBest = s; bar = j; }
    }
    firstFrame = phase + bar * period;
  }
  // Beat 0 is the first downbeat with sound around it.
  const firstSound = nov.findIndex((v) => v > 0.05);
  while (firstFrame + period * meter < firstSound) firstFrame += period * meter;
  let offset = firstFrame / fps;
  const spb = 60 / bpm;

  // Onsets: peaks of the SuperFlux curve (normalised to its loud moments, gated in near-silence)
  // that are the highest within ±30 ms and stand clear of the average around them (100 ms before,
  // 70 ms after); each is then timed to its exact attack (frames are 23 ms; the attack is found
  // to within a few ms).
  // The parts sounds are found in: the whole mix, or (when the song was split, stems.ts) each
  // part on its own, so a vocal note under a loud drum is still heard, and each sound's band,
  // pitch and ring come from its own part, not the mix.
  type Part = { name?: PartName; x: Float32Array; env: ReturnType<typeof bandEnvelopes>; loud: Float32Array; weight: number };
  const parts: Part[] = [];
  if (opts.stems) {
    const stems = opts.stems;
    const energy = (x: Float32Array) => { let e = 0; for (let i = 0; i < x.length; i += 4) e += x[i] * x[i]; return e; };
    const given = PART_NAMES.flatMap((p) => { const x = stems[p]; return x && x.length === samples.length ? [{ p, x }] : []; });
    const es = given.map(({ x }) => energy(x));
    const top = Math.max(1e-12, ...es);
    given.forEach(({ p, x }, k) => {
      const env = bandEnvelopes(x, sr);
      // A quiet part (a bass under the mix) counts for less: its share of the loudest part's energy.
      parts.push({ name: p, x, env, loud: movingMean(env.all, Math.round(fps * 2)), weight: Math.max(0.35, Math.sqrt(es[k] / top)) });
    });
  }
  if (!parts.length) parts.push({ x: samples, env: { low, mid, high, all, n }, loud, weight: 1 });

  const preMax = Math.max(1, Math.round(0.03 * fps)), postMax = Math.max(1, Math.round(0.03 * fps));
  const preAvg = Math.round(0.1 * fps), postAvg = Math.round(0.07 * fps);
  const peaks: { frame: number; strength: number; sec: number; band: 0 | 1 | 2; part: number }[] = [];
  parts.forEach((part, pi) => {
    const { x, env } = part;
    const sf = superflux(x, sr, n);
    {
      const sorted = Float32Array.from(sf).sort();
      const ref = sorted[Math.floor(sorted.length * 0.98)] || 1;
      // Near-silence in this part (or, for a split part, the part barely there in the mix) is gated out.
      for (let i = 0; i < n; i++) sf[i] = env.all[i] > part.loud[i] * 0.05 && (!part.name || env.all[i] > all[i] * 0.01) ? sf[i] / ref : 0;
    }
    for (let i = 1; i < n - 1; i++) {
      const v = sf[i];
      if (v < 0.12) continue;
      let peak = true;
      for (let j = Math.max(0, i - preMax); j <= Math.min(n - 1, i + postMax); j++) if (sf[j] > v || (sf[j] === v && j < i)) { peak = false; break; }
      if (!peak) continue;
      let avg = 0, cnt = 0;
      for (let j = Math.max(0, i - preAvg); j <= Math.min(n - 1, i + postAvg); j++) { avg += sf[j]; cnt++; }
      if (v < avg / cnt + 0.07) continue;
      // The band the new sound lives in: the one whose energy rose the most (in absolute terms,
      // so a tone leaking a little into a silent band isn't mistaken for a kick). A split part
      // says what it is: bass is low, a voice mid; drums and the rest go by their own bands.
      const rise = (e: Float32Array) => Math.max(0, Math.max(e[i], e[i + 1] ?? 0) - Math.min(e[i - 1], e[i - 2] ?? e[i - 1]));
      const r = [rise(env.low), rise(env.mid), rise(env.high)];
      let band = (r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2) as 0 | 1 | 2;
      if (part.name === 'bass') band = 0;
      else if (part.name === 'vocals') band = 1;
      peaks.push({ frame: i, strength: (v + nov[i] * 0.1) * part.weight, sec: attackTime(x, sr, i, band), band, part: pi });
    }
  });
  peaks.sort((a, b) => a.sec - b.sec);

  // Line the beat grid up with the attacks themselves: shift it by the median distance from
  // each attack to its nearest 16th.
  const sixteenth = spb / 4;
  const resid: number[] = [];
  for (const p of peaks) {
    const k = (p.sec - offset) / sixteenth;
    const r = (k - Math.round(k)) * sixteenth;
    if (Math.abs(r) < 0.035) resid.push(r);
  }
  if (resid.length >= 8) {
    resid.sort((a, b) => a - b);
    offset += resid[resid.length >> 1];
  }

  // Each onset in beats. Quantised music sits on the grid, so an attack within 20 ms of a 16th
  // is placed on it, but only where the grid holds there (gridHolds): where the song's beat runs
  // off one straight grid (a drifting tempo, a speed-up), moving it would put the tile up to 20 ms
  // off the sound. Anything else keeps its exact time.
  const holds = gridHolds(peaks.map((p) => p.sec), offset, spb);
  let held = 0, bins = 0;
  for (let t = HOLD_BIN / 2; t < (peaks[peaks.length - 1]?.sec ?? 0); t += HOLD_BIN) { bins++; if (holds(t)) held++; }
  const holdNote = bins ? `; sounds on the grid's 16ths where it holds (${Math.round((held / bins) * 100)}% of the song), elsewhere at their own times` : '';
  type Onset = { beat: number; sec: number; frame: number; strength: number; band: 0 | 1 | 2; part: number; midi: number; clarity: number; bright: number; ringsTo: number };
  const onsets: Onset[] = [];
  for (const p of peaks) {
    let beat = (p.sec - offset) / spb;
    if (beat < -0.05) continue;
    const q = Math.round(beat * 4) / 4;
    beat = Math.max(0, Math.abs(beat - q) * spb < 0.02 && holds(p.sec) ? q : Math.round(beat * 1000) / 1000);
    const o: Onset = { beat, sec: p.sec, frame: p.frame, strength: p.strength, band: p.band, part: p.part, midi: 60, clarity: 0, bright: 60, ringsTo: p.sec };
    const prev = onsets[onsets.length - 1];
    if (prev && (beat - prev.beat) * spb < 0.04) {
      if (o.strength > prev.strength) onsets[onsets.length - 1] = o;
      continue;
    }
    onsets.push(o);
  }

  // How long each sound rings: until its band's energy falls most of the way back to where it
  // was before the attack, or a new sound starts in the same band (a drum under a held vocal
  // doesn't end it). Long rings become holds.
  for (let k = 0; k < onsets.length; k++) {
    const o = onsets[k];
    const part = parts[o.part];
    const pt = pitchAt(part.x, sr, o.sec);
    // Drums have no pitch, whatever the harmonics of a tom suggest.
    o.midi = pt.midi; o.clarity = part.name === 'drums' ? 0 : pt.clarity; o.bright = pt.bright;
    const e = [part.env.low, part.env.mid, part.env.high][o.band];
    // The ring ends at a real new attack in its band (its energy jumps), not at a drum that only
    // adds a little on top of it.
    let nextFrame = n;
    for (let j = k + 1; j < onsets.length; j++) {
      if (onsets[j].band !== o.band || onsets[j].part !== o.part) continue;
      const fj = onsets[j].frame;
      const before = Math.min(e[fj - 1] ?? 0, e[fj - 2] ?? e[fj - 1] ?? 0), after = Math.max(e[fj], e[fj + 1] ?? 0);
      if (after > before * 1.6) { nextFrame = fj; break; }
    }
    let pre = 0;
    for (let i = Math.max(0, o.frame - 3); i < o.frame; i++) pre += e[i] / 3;
    let peakE = 0;
    for (let i = o.frame; i <= Math.min(n - 1, o.frame + 2); i++) peakE = Math.max(peakE, e[i]);
    if (peakE <= pre * 1.1) { o.ringsTo = o.sec + 0.1; continue; }
    const floor = pre + (peakE - pre) * 0.3;
    let i = o.frame + 1;
    while (i < nextFrame && i < n && e[i] > floor) i++;
    o.ringsTo = i / fps;
  }

  const strengths = onsets.map((o) => o.strength).sort((a, b) => a - b);
  const top = strengths[Math.floor(strengths.length * 0.95)] ?? 1;
  const accentCut = strengths[Math.floor(strengths.length * 0.93)] ?? 1;

  // Onsets → the song's notes. Lanes follow the pitch; the biggest downbeats are accents
  // (two-lane chords on Hard). Every tile on every difficulty is one of these onsets.
  const scale = SCALES[opts.scale ?? 'minor'];
  const baseMidi = 48 + rootIndex(opts.key ?? 'C');
  const melody: MelodyNote[] = onsets.map((o) => {
    const rings = Math.max(0.25, (o.ringsTo - o.sec) / spb);
    // On a beat: within 20 ms of one (where the grid doesn't hold, sounds keep their own times).
    const onBeat = Math.abs(o.beat - Math.round(o.beat)) * spb < 0.02;
    return {
      t: o.beat,
      len: Math.round(Math.min(8, rings) * 100) / 100,
      // Lanes rise with the sound: a pitched note by its pitch, a noisy one (hats, cymbals,
      // claps) by its brightness, so the same kind of sound tends to land in the same place.
      degree: o.clarity < PITCHED_CLARITY ? o.bright : o.midi,
      midi: o.midi,
      strong: onBeat,
      strength: Math.min(1, o.strength / top),
      accent: o.strength >= accentCut && onBeat && Math.round(o.beat) % meter === 0,
    };
  });
  const charts = buildCharts(melody, scale, baseMidi, bpm);
  const BANDS = ['low', 'mid', 'high'] as const;
  const events: SoundEvent[] = onsets.map((o, i) => {
    const m = melody[i];
    const pitched = o.clarity >= PITCHED_CLARITY;
    return {
      id: i, t: m.t, sec: Math.round(o.sec * 1000) / 1000, band: BANDS[o.band], pitched,
      midi: pitched ? Math.round(o.midi) : null, note: pitched ? midiToName(Math.round(o.midi)) : null,
      bright: Math.round(o.bright), strength: Math.round((m.strength ?? 0) * 100) / 100, len: m.len,
      onBeat: m.strong, accent: !!m.accent, ...(parts[o.part].name ? { part: parts[o.part].name } : {}),
    };
  });

  const duration = samples.length / sr;
  const lengthBeats = Math.max(0, (duration - offset) / spb);

  // Report: energy curve and sections every 8 bars, labelled by how loud they are.
  const seg = 48;
  const energy = Array.from({ length: seg }, (_, s) => {
    const a = Math.floor((s / seg) * n), b = Math.floor(((s + 1) / seg) * n);
    let e = 0;
    for (let i = a; i < b; i++) e += all[i];
    return Math.sqrt(e / Math.max(1, b - a));
  });
  const eMax = Math.max(...energy, 1e-9);
  const curve = energy.map((e) => Math.round((e / eMax) * 100) / 100);
  const blockBeats = meter * 8;
  const blocks = Math.max(1, Math.ceil(lengthBeats / blockBeats));
  const sections: { label: string; beat: number }[] = [];
  for (let b = 0; b < blocks; b++) {
    const startS = offset + b * blockBeats * spb, endS = Math.min(duration, startS + blockBeats * spb);
    const i0 = Math.floor((startS / duration) * seg), i1 = Math.max(i0 + 1, Math.ceil((endS / duration) * seg));
    const lvl = curve.slice(i0, i1).reduce((x, y) => x + y, 0) / (i1 - i0);
    const label = b === 0 ? 'Intro' : b === blocks - 1 && blocks > 2 ? 'Outro' : lvl > 0.78 ? 'Chorus' : lvl > 0.5 ? 'Verse' : 'Break';
    if (sections[sections.length - 1]?.label !== label) sections.push({ label, beat: b * blockBeats });
  }

  // Cues from the audio itself: bar-by-bar loudness against the bars just before.
  const barSec = spb * meter;
  const bars = Math.max(1, Math.floor((duration - offset) / barSec));
  const barE = Array.from({ length: bars }, (_, b) => {
    const a = Math.floor((offset + b * barSec) * fps), z = Math.min(n, Math.floor((offset + (b + 1) * barSec) * fps));
    let e = 0;
    for (let i = a; i < z; i++) e += all[i];
    return Math.sqrt(e / Math.max(1, z - a));
  });
  const barMax = Math.max(...barE, 1e-9);
  const barEnergy = barE.map((e) => Math.round((e / barMax) * 100) / 100);
  const cues: { beat: number; kind: 'build' | 'drop' | 'break' | 'flash'; strength: number }[] = [];
  let lastDrop = -99, lastBreak = -99;
  for (let b = 4; b < bars; b++) {
    const prev = (barE[b - 1] + barE[b - 2] + barE[b - 3] + barE[b - 4]) / 4;
    const e = barE[b];
    if (e > prev * 1.3 && e > barMax * 0.6 && b - lastDrop >= 8) {
      if (b >= 1) cues.push({ beat: (b - 1) * meter, kind: 'build', strength: 0.8 });
      cues.push({ beat: b * meter, kind: 'drop', strength: Math.min(1, e / barMax) });
      lastDrop = b;
    } else if (e < prev * 0.65 && b - lastBreak >= 8) {
      cues.push({ beat: b * meter, kind: 'break', strength: 0.7 });
      lastBreak = b;
    }
  }
  // A flash on the very strongest downbeat accents (at most one per 4 bars).
  let lastFlash = -99;
  for (const o of onsets) {
    if (o.strength < accentCut || Math.round(o.beat) % meter !== 0 || o.beat - lastFlash < meter * 4) continue;
    cues.push({ beat: o.beat, kind: 'flash', strength: 0.8 });
    lastFlash = o.beat;
  }
  cues.sort((a, b) => a.beat - b.beat);

  return {
    bpm,
    meter,
    offset: Math.round(offset * 1000) / 1000,
    onBeatGrid: !!grid && (grid.fit ?? 1) >= GRID_STRAIGHT,
    gridUsed: !!grid,
    lengthBeats: Math.round(lengthBeats * 100) / 100,
    charts,
    onsets: onsets.length,
    onsetTimes: onsets.map((o) => Math.round(o.sec * 1000) / 1000),
    onsetInfo: onsets.map((o) => ({ sec: Math.round(o.sec * 1000) / 1000, midi: o.midi, clarity: Math.round(o.clarity * 100) / 100, bright: Math.round(o.bright), band: o.band })),
    events,
    barEnergy,
    report: { mapper: grid ? 'Onset mapper v3 (exact attacks, Beat This! grid)' : 'Onset mapper v2 (exact attacks)', confidence: Math.round(confidence * 100) / 100, sections, energy: curve, cues, ...(beatNote ? { beat: beatNote + holdNote } : {}) },
  };
}
