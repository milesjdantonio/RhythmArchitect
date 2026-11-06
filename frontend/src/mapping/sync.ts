// The Map Syncer's math: does the map line up with the music, and if not, by how much?
//
//   alignOffset: the tiles against the song's own audio. The audio's attacks (onsetEnvelope) are
//                compared with every tile at a range of offsets; the offset where the tiles sit
//                on the most attacks is where beat 0 really is.
//   hitDrift:    the tiles against the player's ears, for songs the page can't hear (YouTube).
//                Hits that land late or early by the same amount, run after run of them, mean the
//                tiles are off from the sound.
//
// Pure functions, so tests can run them.

/** Frames a second in the attack envelope (5 ms each). */
export const ONSET_RATE = 200;

/**
 * How sharply the sound rises at each moment, 0..1, ONSET_RATE frames a second from the start of
 * the audio (mono, or the first two channels mixed). Two bands (all of it, and the highs) so both
 * drums and plucked notes show.
 */
export function onsetEnvelope(audio: Float32Array | Float32Array[], sr: number, rate = ONSET_RATE): Float32Array {
  const chans = Array.isArray(audio) ? audio : [audio];
  const a = chans[0], b = chans[1];
  // Frame f is the audio from f / rate to (f + 1) / rate seconds, exactly (a whole-sample hop
  // would drift against the tiles over a song).
  const n = Math.floor((a.length / sr) * rate);
  const edge = (f: number) => Math.min(a.length, Math.round((f * sr) / rate));
  const out = new Float32Array(n);
  let prevAll = 0, prevHigh = 0, last = 0;
  for (let f = 0; f < n; f++) {
    let eAll = 0, eHigh = 0;
    const start = edge(f), end = edge(f + 1), hop = Math.max(1, end - start);
    for (let i = start; i < end; i++) {
      const s = b ? (a[i] + b[i]) * 0.5 : a[i];
      const h = s - last;
      last = s;
      eAll += s * s;
      eHigh += h * h;
    }
    const all = Math.log(1e-7 + eAll / hop), high = Math.log(1e-7 + eHigh / hop);
    out[f] = f === 0 ? 0 : Math.max(0, all - prevAll) + Math.max(0, high - prevHigh);
    prevAll = all;
    prevHigh = high;
  }
  // Scale so the strong attacks sit near 1.
  const sorted = Float32Array.from(out).sort();
  const top = sorted[Math.floor(sorted.length * 0.99)] || 1;
  for (let f = 0; f < n; f++) out[f] = Math.min(1, out[f] / top);
  return out;
}

export interface Alignment {
  /** Seconds into the audio where beat 0 lands, as measured. */
  offset: number;
  /** How far that is from the saved offset (seconds; positive = tiles move later). */
  shift: number;
  /** How much better the tiles sit at the measured offset than at the saved one (1 = no better). */
  gain: number;
  /** How far the best offset stands above the others (1 = no clear best). */
  sharp: number;
  /** Whether the measurement is clear enough to move the map. */
  trusted: boolean;
}

/** Shifts smaller than this aren't worth moving the map for (seconds). */
export const MIN_SHIFT = 0.008;

/**
 * Where beat 0 lands in the audio. `times` are the tiles (seconds from beat 0), `env` the audio's
 * attack envelope, `guess` the saved offset; offsets up to `range` either side are tried.
 */
export function alignOffset(times: number[], env: Float32Array, guess: number, range = 0.3, rate = ONSET_RATE): Alignment {
  const none: Alignment = { offset: guess, shift: 0, gain: 1, sharp: 1, trusted: false };
  if (times.length < 8 || env.length < rate) return none;
  const at = (k: number) => (k >= 0 && k < env.length ? env[k] : 0);
  const score = (o: number) => {
    let s = 0;
    for (const t of times) {
      const k = Math.floor((t + o) * rate);
      s += Math.max(at(k - 1), at(k), at(k + 1));
    }
    return s / times.length;
  };
  const steps = Math.round(range * rate);
  const scores: number[] = [];
  let best = 0;
  for (let i = -steps; i <= steps; i++) {
    scores.push(score(guess + i / rate));
    if (scores[scores.length - 1] > scores[best]) best = scores.length - 1;
  }
  const here = scores[steps];
  const peak = scores[best];
  // Between frames: the top of a parabola through the best one and its neighbours.
  let frac = 0;
  if (best > 0 && best < scores.length - 1) {
    const a = scores[best - 1], c = scores[best + 1];
    const d = a - 2 * peak + c;
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
  }
  const offset = guess + (best - steps + frac) / rate;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const gain = here > 0 ? peak / here : peak > 0 ? Infinity : 1;
  const sharp = mean > 0 ? peak / mean : 1;
  const shift = offset - guess;
  // A beat grid lines up a little at every 16th, so the saved offset must lose clearly.
  const trusted = Math.abs(shift) >= MIN_SHIFT && gain >= 1.15 && sharp >= 1.4 && peak >= 0.15;
  return { offset, shift, gain, sharp, trusted };
}

/** Fewest hits before they say anything about the map. */
export const MIN_HITS = 20;
/** Hits off by less than this (median, seconds) are the player, not the map. */
export const MIN_DRIFT = 0.02;
/** The most one run may move a map (seconds). */
export const MAX_DRIFT = 0.12;

/**
 * How far the tiles sit from the sound, from where the player's hits landed (seconds early,
 * negative, or late). Null when the hits don't agree: too few, too spread, or near zero. A
 * positive answer means the tiles come before the sound and should move later by that much.
 */
export function hitDrift(deltas: number[]): number | null {
  if (deltas.length < MIN_HITS) return null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (Math.abs(median) < MIN_DRIFT) return null;
  const spread = [...deltas].map((d) => Math.abs(d - median)).sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
  if (spread > 0.04) return null;
  const sameSide = deltas.filter((d) => Math.sign(d) === Math.sign(median)).length / deltas.length;
  if (sameSide < 0.7) return null;
  return Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, median));
}

/** Every tile's start, from all charts, once each (seconds from beat 0). */
export function tileTimes(charts: Record<string, { notes: { t: number }[] }>, bpm: number): number[] {
  const spb = 60 / bpm;
  const seen = new Set<number>();
  for (const c of Object.values(charts)) for (const n of c.notes) seen.add(Math.round(n.t * 1000));
  return [...seen].sort((a, b) => a - b).map((ms) => (ms / 1000) * spb);
}
