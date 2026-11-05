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
