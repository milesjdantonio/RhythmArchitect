// The pure parts of the listening pass (src/mapping/listen.ts), kept apart so tests can run them.

/** Where the tick shows up in captured audio: seconds after it was played, or null if it doesn't. */
export function findTick(chunks: { t: number; d: Float32Array }[], sr: number, t0: number): number | null {
  let floor = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.d.length; i++) {
      const at = c.t + i / sr;
      if (at >= t0 - 0.25 && at < t0 - 0.01) floor = Math.max(floor, Math.abs(c.d[i]));
    }
  }
  const cut = Math.max(0.02, floor * 4);
  for (const c of chunks) {
    for (let i = 0; i < c.d.length; i++) {
      const at = c.t + i / sr;
      if (at >= t0 - 0.01 && at <= t0 + 0.5 && Math.abs(c.d[i]) > cut) return at - t0;
    }
  }
  return null;
}

/**
 * Files captured audio under the video position it was heard at. Steady playback writes one
 * continuous run; a stall or seek moves the write head to the new position.
 */
export class Placer {
  pcm: Float32Array;
  private next = -1;
  end = 0;
  readonly sr: number;
  // (No parameter properties: tools/replay-listen.mjs runs this file in Node, which strips types only.)
  constructor(sr: number, seconds: number) { this.sr = sr; this.pcm = new Float32Array(Math.ceil((seconds + 2) * sr)); }
  write(pos: number, samples: Float32Array) {
    let at = Math.round(pos * this.sr);
    if (this.next >= 0 && Math.abs(at - this.next) <= this.sr * 0.03) at = this.next;
    if (at < 0) { samples = samples.subarray(-at); at = 0; }
    if (at + samples.length > this.pcm.length) {
      const grown = new Float32Array(Math.ceil((at + samples.length) * 1.25));
      grown.set(this.pcm);
      this.pcm = grown;
    }
    this.pcm.set(samples, at);
    this.next = at + samples.length;
    this.end = Math.max(this.end, this.next);
  }
  result() { return this.pcm.subarray(0, this.end); }
}

/** A read of the video's position while listening: audio-context time `c`, video position `v`. */
export interface Mark { c: number; v: number; playing: boolean }
/** Captured sound: audio-context time `c` of its first sample (less the capture delay), at `sr`. */
export interface Chunk { c: number; d: Float32Array }

/** A change in (context time - video position) bigger than this starts a new stretch: a seek, a stall, an ad. */
const STRETCH_JUMP = 0.15;
/** Captured sound this close outside a stretch's first and last position read still belongs to it. */
const STRETCH_EDGE = 0.1;

/**
 * Files the captured sound under the video position it was heard at, once the listen is over.
 *
 * The capture itself is seamless (the audio thread hands over every sample, in order), but the
 * video's position is known only coarsely: the player reports it every so often and the page
 * reads it once a frame, so (context time - position) wobbles by tens of milliseconds. Placing
 * each chunk by the latest reads made the sound jump (a gap or an overlap of a few hundredths of
 * a second, again and again) and, when the page stalled for a moment, dropped what was heard.
 * At 200 BPM that is enough to scramble the beat.
 *
 * So the reads are split into stretches of steady playback (broken by a pause or buffering, or a
 * jump of more than STRETCH_JUMP: a seek, a stall, an ad), each stretch gets one offset (the median
 * over all of its reads), and all of the sound in a stretch is laid down at that offset: seamless,
 * and nothing lost when the page stalls (the stretch spans the gap in the reads).
 */
export function placeChunks(chunks: Chunk[], marks: Mark[], sr: number, seconds: number): Float32Array {
  const stretches = stretchesOf(marks);
  const placer = new Placer(sr, seconds);
  let k = 0;
  for (const ch of chunks) {
    const end = ch.c + ch.d.length / sr;
    while (k < stretches.length && stretches[k].to + STRETCH_EDGE < ch.c) k++;
    const s = stretches[k];
    if (!s || end < s.from - STRETCH_EDGE) continue; // before the video played, or between stretches
    // Only the part inside the stretch (none of the pre-roll, none of what follows a pause).
    const a = Math.max(0, Math.round((s.from - STRETCH_EDGE - ch.c) * sr));
    const b = Math.min(ch.d.length, Math.round((s.to + STRETCH_EDGE - ch.c) * sr));
    if (b <= a) continue;
    placer.write(ch.c + a / sr - s.offset, ch.d.subarray(a, b));
  }
  return placer.result();
}

/** Seconds of sound before the first 50 ms that is clearly audible (a twentieth of the whole's level), and how much of it is audible. */
function audible(pcm: Float32Array, sr: number) {
  const win = Math.max(1, Math.round(sr * 0.05));
  let total = 0;
  for (let i = 0; i < pcm.length; i++) total += pcm[i] * pcm[i];
  const cut = (total / Math.max(1, pcm.length)) * 0.05 * 0.05; // energy: (5% of the RMS)²
  let first = -1, on = 0, windows = 0;
  for (let i = 0; i + win <= pcm.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += pcm[j] * pcm[j];
    windows++;
    if (e / win > cut) { on++; if (first < 0) first = i / sr; }
  }
  return { first: first < 0 ? Infinity : first, seconds: (on * win) / sr };
}

/**
 * The recording to map: the seamless placement (placeChunks), unless it came out clearly worse
 * than placing each chunk as it was heard (`asHeard`, the earlier way): its first sound more than
 * 2 s later, or under 90% as much sound. That has happened once, on a listen whose cause wasn't
 * seen (an ad before the song is the likeliest); the note says which was used, for the dev tools.
 */
export function chooseRecording(chunks: Chunk[], marks: Mark[], sr: number, seconds: number, asHeard: Float32Array): { pcm: Float32Array; note: string } {
  const seamless = placeChunks(chunks, marks, sr, seconds);
  const n = stretchesOf(marks).length;
  const a = audible(seamless, sr), b = audible(asHeard, sr);
  const at = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} s` : 'never');
  if (a.first - b.first > 2 || a.seconds < b.seconds * 0.9) {
    return { pcm: asHeard, note: `as heard (the seamless placement, ${n} stretch${n === 1 ? '' : 'es'}, started at ${at(a.first)} with ${Math.round(a.seconds)} s of sound, against ${at(b.first)} and ${Math.round(b.seconds)} s); first sound at ${at(b.first)}` };
  }
  return { pcm: seamless, note: `seamless, ${n} stretch${n === 1 ? '' : 'es'} of playback; first sound at ${at(a.first)}, ${Math.round(a.seconds)} s of sound (as heard: ${at(b.first)}, ${Math.round(b.seconds)} s)` };
}

/** The stretches of steady playback in the position reads, each with its offset (see placeChunks). */
export function stretchesOf(marks: Mark[]): { from: number; to: number; offset: number }[] {
  const stretches: { from: number; to: number; offset: number; paused: boolean }[] = [];
  let run: number[] = [];
  let from = 0, to = 0;
  // Whether the video stopped (a pause, buffering) since the last stretch: then the next one is apart.
  let paused = true, runPaused = true;
  const close = () => {
    if (run.length >= 3) {
      const s = [...run].sort((a, b) => a - b);
      stretches.push({ from, to, offset: s[s.length >> 1], paused: runPaused });
    }
    run = [];
  };
  for (const m of marks) {
    if (!m.playing) { close(); paused = true; continue; }
    const d = m.c - m.v;
    if (run.length) {
      // Against the recent reads (a single odd read doesn't split a stretch; a lasting jump does).
      const recent = run.slice(-31).sort((a, b) => a - b);
      if (Math.abs(d - recent[recent.length >> 1]) > STRETCH_JUMP) close();
    }
    if (!run.length) { from = m.c; runPaused = paused; paused = false; }
    run.push(d);
    to = m.c;
  }
  close();
  return heal(stretches);
}

/** Stretches shorter than this are a glitch in the position reads (a clock catching up), not playback of their own. */
const STRETCH_MIN = 0.75;
/** Neighbouring stretches whose offsets differ by less than this are one: the reads only broke off between them. */
const STRETCH_SAME = 0.1;

/**
 * Mends the stretches a real listen gives: brief ones (a glitch in the reads) go, and neighbours
 * with the same offset join into one, so the sound between them (heard while the reads broke off,
 * the tab hidden or the page stalled) is kept. A pause or a seek changes the offset: those stay apart.
 */
function heal(stretches: { from: number; to: number; offset: number; paused: boolean }[]) {
  const long = stretches.filter((s) => s.to - s.from >= STRETCH_MIN);
  const kept = long.length ? long : stretches;
  const out: { from: number; to: number; offset: number }[] = [];
  for (const s of kept) {
    const prev = out[out.length - 1];
    if (prev && !s.paused && Math.abs(s.offset - prev.offset) < STRETCH_SAME) {
      // One stretch: the longer one's offset counts more.
      const a = prev.to - prev.from, b = s.to - s.from;
      prev.offset = (prev.offset * a + s.offset * b) / Math.max(1e-9, a + b);
      prev.to = s.to;
    } else out.push({ from: s.from, to: s.to, offset: s.offset });
  }
  return out;
}
