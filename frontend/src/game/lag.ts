// A YouTube song's video lagging in play (the user, Nov 20): when it stalls the game pauses, and
// carries on with a 3, 2, 1 once enough of the song has loaded ahead; a stall that goes on, or one
// that comes back soon, brings up the "your connection is slow" card (LagCard.tsx), and after
// CARDS_BEFORE_WAIT of those, its Continue waits until the connection is strong.
//
// What it goes by is what the player reports: its position, and the share of the video it has
// loaded (getVideoLoadedFraction). From those: how far ahead it has loaded, and how fast it loads
// (seconds of song per second: below 1 it can't keep up with playing). No DOM: `now` comes in.

/** Enough loaded ahead (s) to count down and carry on after a stall. */
export const READY_AHEAD = 5;
/** A stall longer than this (ms) brings up the card... */
export const HEAVY_MS = 3000;
/** ...as does a stall within this long (ms) of the last one ending. */
export const AGAIN_MS = 60_000;
/** The card this many times: its Continue waits for a strong connection. */
export const CARDS_BEFORE_WAIT = 3;
/** Strong: this far ahead (s), loading at least STRONG_RATE times as fast as the song plays (or all of it loaded). */
export const STRONG_AHEAD = 15;
export const STRONG_RATE = 1.3;
/** Loading speed is measured over this long (ms). */
const RATE_WINDOW = 4000;

interface Sample { at: number; loaded: number }

export class LagWatch {
  private samples: Sample[] = [];
  private stallAt: number | null = null;
  private lastEnd = -Infinity;
  /** Stalls so far, and how many brought up the card. */
  stalls = 0;
  cards = 0;
  position = 0;
  /** Seconds of the video loaded (its share times its length). */
  loaded = 0;
  duration = 0;

  /** The player's report: its position (s), the share of the video loaded (0..1), its length (s). */
  sample(now: number, position: number, fraction: number, duration: number) {
    this.position = position;
    this.duration = duration;
    this.loaded = Math.max(0, Math.min(1, fraction)) * duration;
    this.samples.push({ at: now, loaded: this.loaded });
    while (this.samples.length > 2 && now - this.samples[0].at > RATE_WINDOW) this.samples.shift();
  }

  /** Seconds of song loaded ahead of where it is. */
  get ahead() { return Math.max(0, this.loaded - this.position); }
  /** The whole song is loaded. */
  get complete() { return this.duration > 0 && this.loaded >= this.duration - 0.5; }
  /** Seconds of song loaded per second, lately (null until there's enough to tell). */
  get rate(): number | null {
    if (this.complete) return null;
    const a = this.samples[0], b = this.samples[this.samples.length - 1];
    if (!a || !b || b.at - a.at < 1000) return null;
    return (b.loaded - a.loaded) / ((b.at - a.at) / 1000);
  }

  get stalled() { return this.stallAt !== null; }
  startStall(now: number) {
    if (this.stallAt !== null) return;
    this.stallAt = now;
    this.stalls++;
  }
  endStall(now: number) {
    if (this.stallAt === null) return;
    this.stallAt = null;
    this.lastEnd = now;
  }
  /** The stall has gone on long, or came soon after the last one: time for the card. */
  heavy(now: number): boolean {
    if (this.stallAt === null) return false;
    return now - this.stallAt >= HEAVY_MS || this.stallAt - this.lastEnd < AGAIN_MS;
  }
  /** Enough loaded ahead to carry on. */
  get ready() { return this.complete || this.ahead >= READY_AHEAD; }
  /** The connection keeps well ahead of the song. */
  get strong() {
    if (this.complete) return true;
    const r = this.rate;
    return this.ahead >= STRONG_AHEAD && r !== null && r >= STRONG_RATE;
  }
  /** The card came up (counted), and whether its Continue must wait for a strong connection. */
  showCard() { this.cards++; }
  get mustWait() { return this.cards >= CARDS_BEFORE_WAIT && !this.strong; }
}

/** The browser's own estimate of the connection (Chrome and Edge; Safari and Firefox don't say). */
export function connectionInfo(): { mbps: number; kind: string } | null {
  const c = (typeof navigator !== 'undefined' ? (navigator as unknown as { connection?: { downlink?: number; effectiveType?: string } }).connection : undefined);
  if (!c || typeof c.downlink !== 'number') return null;
  return { mbps: c.downlink, kind: c.effectiveType ?? '' };
}
