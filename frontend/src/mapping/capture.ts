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
 *
 * Unless the browser's audio clock fell behind the video (seen on a real listen: from 27 s in, the
 * video moved 1.3 s for every second of the audio clock, the computer too busy for its audio, and a
 * quarter of the sound never reached the capture). Then no one offset fits a stretch: it is
 * followed instead (stretchInto), each slice of sound laid where the video was when it was heard.
 */
export function placeChunks(chunks: Chunk[], marks: Mark[], sr: number, seconds: number): Float32Array {
  return place(chunks, marks, sr, seconds).pcm;
}

/** Offsets (context time - video position) of a stretch this far apart mean the audio clock drifted: follow it. */
const DRIFT = 0.03;
/** Where the offset is measured in a drifting stretch: every KNOT_STEP, over the reads within KNOT_WIN. */
const KNOT_STEP = 0.25;
const KNOT_WIN = 0.5;

/** placeChunks, and what it found: the stretches, the seconds of video that never reached the capture, the stretches followed. */
export function place(chunks: Chunk[], marks: Mark[], sr: number, seconds: number) {
  const stretches = stretchesOf(marks);
  const placer = new Placer(sr, seconds);
  let lost = 0, followed = 0;
  for (const s of stretches) {
    const lo = s.from - STRETCH_EDGE, hi = s.to + STRETCH_EDGE;
    // Only the sound inside the stretch (none of the pre-roll, none of what follows a pause).
    const mine = chunks.filter((ch) => ch.c + ch.d.length / sr > lo && ch.c < hi);
    const knots = knotsOf(marks.filter((m) => m.playing && m.c >= s.from && m.c <= s.to), s.from, s.to);
    if (knots && drifts(knots.d)) {
      lost += stretchInto(placer, mine, lo, hi, knots, sr);
      followed++;
      continue;
    }
    for (const ch of mine) {
      const a = Math.max(0, Math.round((lo - ch.c) * sr));
      const b = Math.min(ch.d.length, Math.round((hi - ch.c) * sr));
      if (b > a) placer.write(ch.c + a / sr - s.offset, ch.d.subarray(a, b));
    }
  }
  return { pcm: placer.result(), stretches: stretches.length, lost, followed };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

/**
 * The offset through a stretch, measured every KNOT_STEP (the median over the reads around it, in a
 * window kept even on both sides so a drifting offset isn't pulled), lightly smoothed. Null if too few reads.
 */
function knotsOf(reads: Mark[], from: number, to: number): { c: number[]; d: number[] } | null {
  const c: number[] = [], d: number[] = [];
  let j0 = 0;
  for (let t = from + KNOT_STEP / 2; t <= to - KNOT_STEP / 2 + 1e-9; t += KNOT_STEP) {
    const w = Math.min(KNOT_WIN, t - from, to - t);
    while (j0 < reads.length && reads[j0].c < t - w) j0++;
    const ds: number[] = [];
    let j = j0;
    for (; j < reads.length && reads[j].c <= t + w; j++) ds.push(reads[j].c - reads[j].v);
    // Reads on both sides, over at least half the window each (not just one side of a gap in the reads).
    if (ds.length >= 3 && t - reads[j0].c >= w / 2 && reads[j - 1].c - t >= w / 2) { c.push(t); d.push(median(ds)); }
  }
  if (c.length < 2) return null;
  const sm = d.map((x, i) => (i === 0 || i === d.length - 1 ? x : (d[i - 1] + 2 * x + d[i + 1]) / 4));
  return { c, d: sm };
}

/** Whether the offset moved through the stretch (5th to 95th percentile apart by more than DRIFT). */
function drifts(d: number[]) {
  const s = [...d].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * 0.95)] - s[Math.floor((s.length - 1) * 0.05)] > DRIFT;
}

/** The offset at context time t: straight between knots, carried on straight past the ends. */
function offsetAt(k: { c: number[]; d: number[] }, t: number) {
  const n = k.c.length;
  let i = 0;
  if (t >= k.c[n - 1]) i = n - 2;
  else while (i < n - 2 && k.c[i + 1] <= t) i++;
  return k.d[i] + ((k.d[i + 1] - k.d[i]) * (t - k.c[i])) / (k.c[i + 1] - k.c[i]);
}

/**
 * Lays the sound of a drifting stretch where the video was when each part of it was heard: in
 * slices of ~40 ms, half overlapping and faded into each other (Hann windows, which add up to one),
 * each at the video position of its middle. When sound went missing the slices spread apart to
 * cover the gap (no silent holes, no pitch change; the notes where they were heard, within a few
 * ms). Returns how much of the video's time never reached the capture (s).
 */
function stretchInto(placer: Placer, chunks: Chunk[], lo: number, hi: number, k: { c: number[]; d: number[] }, sr: number) {
  const L = Math.ceil((hi - lo) * sr);
  const src = new Float32Array(L);
  for (const ch of chunks) {
    const at = Math.round((ch.c - lo) * sr);
    const a = Math.max(0, -at), b = Math.min(ch.d.length, L - at);
    if (b > a) src.set(ch.d.subarray(a, b), at + a);
  }
  const H = Math.max(8, Math.round(sr * 0.02)), G = 2 * H;
  const win = Float32Array.from({ length: G }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / G));
  const startOf = (g: number) => { const t = lo + (g + H) / sr; return Math.round((t - offsetAt(k, t)) * sr) - H; };
  const lastG = Math.floor((L - 1) / H) * H;
  const first = startOf(0);
  const span = startOf(lastG) - first + G + 1;
  if (span <= 0 || span > L * 4) return 0;
  const acc = new Float32Array(span), wsum = new Float32Array(span);
  for (let g = 0; g < L; g += H) {
    const o = startOf(g) - first;
    for (let i = 0; i < G && g + i < L; i++) {
      const j = o + i;
      if (j < 0 || j >= span) continue;
      acc[j] += src[g + i] * win[i];
      wsum[j] += win[i];
    }
  }
  for (let j = 0; j < span; j++) acc[j] = wsum[j] > 1e-6 ? acc[j] / wsum[j] : 0;
  placer.write(first / sr, acc);
  return Math.max(0, offsetAt(k, lo) - offsetAt(k, hi));
}

/** Seconds of sound before the first 50 ms that is clearly audible (a twentieth of the whole's level), and how much of it is audible. */
function audible(pcm: Float32Array, sr: number) {
  const win = Math.max(1, Math.round(sr * 0.05));
  let total = 0;
  for (let i = 0; i < pcm.length; i++) total += pcm[i] * pcm[i];
  const cut = (total / Math.max(1, pcm.length)) * 0.05 * 0.05; // energy: (5% of the RMS)²
  // Counts the samples there are in the audible windows (not whole windows: a recording in pieces
  // with holes between them would count as more sound than it holds).
  let first = -1, on = 0;
  for (let i = 0; i + win <= pcm.length; i += win) {
    let e = 0, n = 0;
    for (let j = i; j < i + win; j++) { e += pcm[j] * pcm[j]; if (pcm[j] !== 0) n++; }
    if (e / win > cut) { on += n; if (first < 0) first = i / sr; }
  }
  return { first: first < 0 ? Infinity : first, seconds: on / sr };
}

/**
 * The recording to map: the seamless placement (placeChunks), unless it came out clearly worse
 * than placing each chunk as it was heard (`asHeard`, the earlier way): its first sound more than
 * 2 s later, or under 90% as much sound. That has happened once, on a listen whose cause wasn't
 * seen (an ad before the song is the likeliest); the note says which was used, for the dev tools.
 */
export function chooseRecording(chunks: Chunk[], marks: Mark[], sr: number, seconds: number, asHeard: Float32Array): { pcm: Float32Array; note: string } {
  const placed = place(chunks, marks, sr, seconds);
  const seamless = placed.pcm;
  const n = placed.stretches;
  const a = audible(seamless, sr), b = audible(asHeard, sr);
  const at = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} s` : 'never');
  // The audio clock fell behind the video: the computer was too busy for its audio.
  const behind = placed.lost >= 0.5 ? `; the browser's audio fell behind the video (too busy): ${Math.round(placed.lost)} s of the song never reached the capture, the rest followed and spread over it (${placed.followed} stretch${placed.followed === 1 ? '' : 'es'})` : '';
  if (a.first - b.first > 2 || a.seconds < b.seconds * 0.9) {
    return { pcm: asHeard, note: `as heard (the seamless placement, ${n} stretch${n === 1 ? '' : 'es'}, started at ${at(a.first)} with ${Math.round(a.seconds)} s of sound, against ${at(b.first)} and ${Math.round(b.seconds)} s); first sound at ${at(b.first)}${behind}` };
  }
  return { pcm: seamless, note: `seamless, ${n} stretch${n === 1 ? '' : 'es'} of playback; first sound at ${at(a.first)}, ${Math.round(a.seconds)} s of sound (as heard: ${at(b.first)}, ${Math.round(b.seconds)} s)${behind}` };
}

/** The stretches of steady playback in the position reads, each with its offset (see placeChunks). */
export function stretchesOf(marks: Mark[]): { from: number; to: number; offset: number }[] {
  const stretches: Raw[] = [];
  let run: number[] = [];
  let from = 0, to = 0;
  // Whether the video stopped (a pause, buffering) since the last stretch: then the next one is apart.
  let paused = true, runPaused = true;
  const close = () => {
    if (run.length >= 3) {
      stretches.push({ from, to, offset: median(run), start: median(run.slice(0, 9)), end: median(run.slice(-9)), paused: runPaused });
    }
    run = [];
  };
  for (const m of marks) {
    if (!m.playing) { close(); paused = true; continue; }
    const d = m.c - m.v;
    // Against the read before (a drifting offset moves on a little each read and isn't split; a
    // jump is. A single odd read splits twice: heal() drops it and joins the two sides again).
    if (run.length && Math.abs(d - run[run.length - 1]) > STRETCH_JUMP) close();
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

/** A stretch as read: its median offset, the offset where it starts and ends, and whether a pause came before it. */
interface Raw { from: number; to: number; offset: number; start: number; end: number; paused: boolean }

/**
 * Mends the stretches a real listen gives: brief ones (a glitch in the reads) go, and neighbours
 * that carry on where the other left off (the offset where one ends, where the next starts) join
 * into one, so the sound between them (heard while the reads broke off, the tab hidden or the page
 * stalled) is kept. A pause or a seek changes the offset: those stay apart.
 */
function heal(stretches: Raw[]) {
  const long = stretches.filter((s) => s.to - s.from >= STRETCH_MIN);
  const kept = long.length ? long : stretches;
  const out: Raw[] = [];
  let pausedSince = false; // a pause before a glitch that was dropped still counts
  for (const s of stretches) {
    if (!kept.includes(s)) { pausedSince ||= s.paused; continue; }
    const paused = s.paused || pausedSince;
    pausedSince = false;
    const prev = out[out.length - 1];
    if (prev && !paused && Math.abs(s.start - prev.end) < STRETCH_SAME) {
      // One stretch: the longer one's offset counts more.
      const a = prev.to - prev.from, b = s.to - s.from;
      prev.offset = (prev.offset * a + s.offset * b) / Math.max(1e-9, a + b);
      prev.to = s.to;
      prev.end = s.end;
    } else out.push({ ...s, paused });
  }
  return out.map(({ from, to, offset }) => ({ from, to, offset }));
}
