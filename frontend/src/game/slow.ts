// Slow moments (the dev tools): when the frames fall during a run, what was happening in the
// second before (the user, Nov 20: "fps drops from 100 to 24, maybe when a certain animation
// plays"). The game screen notes what it sets off (Overdrive, callouts, banners, hit bursts...)
// and samples the frame rates; a stretch under SLOW_SHARE of the run's usual rate is a moment.
// Ask for the log (Download slow moments) rather than guessing which effect costs the frames.

/** A stretch this far under the run's usual frame rate (and under SLOW_FPS) is slow. */
export const SLOW_SHARE = 0.6;
export const SLOW_FPS = 50;
/** What happened this long (ms) before the frames fell counts as "during". */
const LOOKBACK = 1200;
/** One moment per this long (ms): a slow stretch is one moment, not one a sample. */
const COOLDOWN = 2500;
/** The moments kept. */
const KEEP = 40;

export interface SlowMoment {
  /** Song seconds. */
  song: number;
  /** The page's frames a second and the stage's (its worker's), and the run's usual. */
  page: number;
  stage: number;
  usual: number;
  /** The share of its resolution the stage drew (dynamic resolution). */
  res: number;
  /** What was set off in the LOOKBACK before, oldest first, with how many of each ("judge ×14"). */
  during: string[];
}

export class SlowWatch {
  readonly moments: SlowMoment[] = [];
  private recent: { at: number; what: string }[] = [];
  private usual = 0;
  private last = -Infinity;

  /** Something the game set off (`at`: performance.now ms). */
  note(what: string, at = performance.now()) {
    this.recent.push({ at, what });
    while (this.recent.length && this.recent[0].at < at - LOOKBACK * 2) this.recent.shift();
  }

  /**
   * The frame rates now (a sample every half second or so). The usual rate follows the faster
   * samples (the run's own pace), so a slow stretch stands out against it. A moment when slow.
   */
  sample(o: { page: number; stage: number; res: number; song: number }, at = performance.now()): SlowMoment | null {
    const rate = Math.min(o.page || Infinity, o.stage || Infinity);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    // The usual rate: quick to rise, slow to fall, and a slow sample doesn't move it.
    const slow = !!this.usual && rate < this.usual * SLOW_SHARE && rate < SLOW_FPS;
    if (!slow) this.usual = this.usual ? (rate > this.usual ? this.usual * 0.7 + rate * 0.3 : this.usual * 0.98 + rate * 0.02) : rate;
    if (!slow || at - this.last < COOLDOWN) return null;
    this.last = at;
    const counts = new Map<string, number>();
    for (const r of this.recent) if (r.at >= at - LOOKBACK) counts.set(r.what, (counts.get(r.what) ?? 0) + 1);
    const m: SlowMoment = {
      song: Math.round(o.song * 10) / 10, page: Math.round(o.page), stage: Math.round(o.stage), usual: Math.round(this.usual), res: Math.round(o.res * 100) / 100,
      during: [...counts.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)),
    };
    this.moments.push(m);
    if (this.moments.length > KEEP) this.moments.shift();
    return m;
  }

  /** What was set off most often across the moments (the likeliest cost first). */
  suspects(): { what: string; moments: number }[] {
    const n = new Map<string, number>();
    for (const m of this.moments) for (const d of m.during) { const k = d.replace(/ ×\d+$/, ''); n.set(k, (n.get(k) ?? 0) + 1); }
    return [...n.entries()].map(([what, moments]) => ({ what, moments })).sort((a, b) => b.moments - a.moments);
  }
}
