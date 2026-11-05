// A smooth clock from a player that reports its position coarsely and late (YouTube's embedded
// player answers getCurrentTime() from messages it posts every so often). Between reports the
// clock runs on by itself; each new report nudges it, and a big difference (a seek, a stall, a
// skipped ad) makes it jump. The listening pass and the game read the same clock, so whatever
// small lag it has is the same for both and cancels out.
//
// No DOM: `now` is injected (milliseconds), so tests can drive it.

/** Slew mode: speed change per second of error (closes an error in about 1/SLEW_GAIN s). */
const SLEW_GAIN = 2;
/** Slew mode: the most it runs off real time while catching up. */
const SLEW_MAX = 0.25;

export class FollowClock {
  private anchorPos = 0;
  private anchorAt = 0;
  private lastRaw = Number.NaN;
  private running = false;
  private last = 0;
  /** Slew mode: how fast the clock runs (1 = real time; up to ±25% while it catches up). */
  private rate = 1;
  /** Hard resyncs (a seek, a stall), for the perf meter. */
  snaps = 0;

  /**
   * `mode`: 'nudge' moves the clock a fifth of the error at each report (a small step the tiles
   * show); 'slew' never steps: it runs a little fast or slow until the error is gone (see SLEW_GAIN).
   */
  constructor(private readonly now: () => number = () => performance.now(), public mode: () => 'nudge' | 'slew' = () => 'nudge') {}

  /** Forget everything (a new video). */
  reset() { this.running = false; this.lastRaw = Number.NaN; this.last = 0; this.rate = 1; }

  /**
   * The position (seconds), given the player's latest report and whether it is playing right now.
   * While it isn't, the report is exact and the clock stands still.
   */
  read(raw: number, playing: boolean): number {
    const at = this.now();
    if (!playing) {
      this.running = false;
      this.lastRaw = raw;
      this.last = raw;
      return raw;
    }
    if (!this.running) {
      this.running = true;
      this.anchorPos = raw;
      this.anchorAt = at;
      this.lastRaw = raw;
      this.last = raw;
      return raw;
    }
    const slew = this.mode() === 'slew';
    let pos = this.anchorPos + ((at - this.anchorAt) / 1000) * (slew ? this.rate : 1);
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      const err = raw - pos;
      if (Math.abs(err) > 0.3) {
        // A seek, a stall or an ad: start again from the report.
        this.snaps++;
        this.anchorPos = raw;
        this.anchorAt = at;
        this.last = raw;
        this.rate = 1;
        return raw;
      }
      if (slew) {
        // Re-anchor where the clock is now (no step) and run fast or slow in proportion to the error:
        // it closes in about half a second (1/SLEW_GAIN). Small errors (the usual few ms) mean a
        // speed change of a percent or two, which nobody sees; a big one (a stale first report, up
        // to SNAP) is caught up quickly, at most SLEW_MAX off real time, rather than over seconds.
        // Read rarely (the page's frames held back to a few a second), the same gain would carry
        // the clock past the video and back each time: then it closes at most half the error
        // before the next read.
        const since = (at - this.anchorAt) / 1000;
        const gain = since > 0 ? Math.min(SLEW_GAIN, 0.5 / since) : SLEW_GAIN;
        this.anchorPos = pos;
        this.anchorAt = at;
        this.rate = 1 + Math.max(-SLEW_MAX, Math.min(SLEW_MAX, err * gain));
      } else {
        this.anchorPos += err * 0.2;
        pos = this.anchorPos + (at - this.anchorAt) / 1000;
      }
    }
    // Never backwards by a hair while playing (tiles would shiver).
    if (pos < this.last && this.last - pos < 0.05) pos = this.last;
    this.last = pos;
    return pos;
  }
}
