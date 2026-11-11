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
  constructor(readonly sr: number, seconds: number) { this.pcm = new Float32Array(Math.ceil((seconds + 2) * sr)); }
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
  const stretches: { from: number; to: number; offset: number }[] = [];
  let run: number[] = [];
  let from = 0, to = 0;
  const close = () => {
    if (run.length >= 3) {
      const s = [...run].sort((a, b) => a - b);
      stretches.push({ from, to, offset: s[s.length >> 1] });
    }
    run = [];
  };
  for (const m of marks) {
    if (!m.playing) { close(); continue; }
    const d = m.c - m.v;
    if (run.length) {
      // Against the recent reads (a single odd read doesn't split a stretch; a lasting jump does).
      const recent = run.slice(-31).sort((a, b) => a - b);
      if (Math.abs(d - recent[recent.length >> 1]) > STRETCH_JUMP) close();
    }
    if (!run.length) from = m.c;
    run.push(d);
    to = m.c;
  }
  close();
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
