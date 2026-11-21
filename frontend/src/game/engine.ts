// Game rules, free of DOM and audio so they can be unit tested.
// Times are seconds from beat 0 of the song.

import type { Chart, ChartNote, Difficulty, Grade } from '../api/types';
import { CHARGE_FULL, CODE, MAX_OVERDRIVE, OVERDRIVE_DRAIN, OVERDRIVE_GRACE, OVERDRIVE_LENGTH, RunScore, multiplierFor, type HitResult } from './score';

export { multiplierFor, CHARGE_FULL, MAX_OVERDRIVE, OVERDRIVE_DRAIN, OVERDRIVE_GRACE, OVERDRIVE_LENGTH };

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** Hit windows in seconds (either side of the note). Easier modes are more forgiving. */
const BASE_WINDOWS = { perfect: 0.045, great: 0.09, good: 0.14 };
/** Ultra's hit windows (Perfect, Good, then Early/Late; the easier difficulties are a little wider). */
export const HIT_WINDOWS: Readonly<typeof BASE_WINDOWS> = BASE_WINDOWS;
// Each difficulty a step up (Easy is what Medium was before Ultra, Ultra what Hard was).
const LENIENCY: Record<Difficulty, number> = { easy: 1.12, medium: 1.08, hard: 1.04, ultra: 1 };
// Points, combo and accuracy are main.Score's, the multiplier and holds the game's own (score.ts).
// A miss costs about 1.5 times what it did, and hits give back about half: the signal is something
// to keep, not a bar that refills by itself.
const DRAIN: Record<Difficulty, number> = { easy: 0.11, medium: 0.12, hard: 0.135, ultra: 0.15 };
/** Signal a hit gives back. */
const GAIN: Record<Judgement, number> = { perfect: 0.011, great: 0.007, good: 0.003, miss: 0 };
/**
 * A stray press (a key that hit no tile) costs this much signal and some Overdrive charge
 * (score.ts STRAY_CHARGE): mashing the keys can't clear a song. Not counted before the first tile
 * is close or after the last has passed.
 */
export const STRAY_DRAIN = 0.03;
/** Overdrive is "running out" with this many tiles left (a quarter of its length). */
export const OVERDRIVE_LOW = 12;
const STRAY_QUIET = 1;
/** A hold released this close to its end still counts as completed. */
const HOLD_GRACE = 0.14;

/**
 * Seconds a tile takes to fall from the top to the hit line on a 120 BPM song. Each difficulty
 * falls faster than the last (about 0.85 times the time), like a harder map's note speed in Beat
 * Saber: the reading gets quicker along with the density.
 */
export const TRAVEL: Record<Difficulty, number> = { easy: 1.75, medium: 1.5, hard: 1.28, ultra: 1.08 };
/** The tempo the fall times are set at. */
export const TRAVEL_BPM = 120;
/** How much the tempo moves the speed: a song twice as fast falls 2^0.4 = 1.32 times as fast. */
const TEMPO_PULL = 0.4;
/** The tempo's pull is kept within these (a very slow or very fast song). */
const TEMPO_MIN = 0.8, TEMPO_MAX = 1.2;
/**
 * Note speed is not a setting: it comes from the difficulty and the song's tempo. Faster songs fall
 * faster (so the tiles of a fast song don't crowd together) and slower ones slower, but only part
 * of the way (TEMPO_PULL), so a song's tempo still shows in how close its tiles are.
 */
export function fallTime(d: Difficulty, bpm = TRAVEL_BPM): number {
  const tempo = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, (TRAVEL_BPM / Math.max(1, bpm)) ** TEMPO_PULL));
  return TRAVEL[d] * tempo;
}
/** The note speed shown to the player: Easy at 120 BPM is 1.0x. */
export const noteSpeed = (d: Difficulty, bpm = TRAVEL_BPM) => TRAVEL.easy / fallTime(d, bpm);

export interface LiveNote {
  idx: number;
  lane: number;
  pitch: string;
  time: number;
  end: number;
  hold: boolean;
  judged?: Judgement;
  /** Seconds early (negative) or late (positive) the head was hit. */
  delta?: number;
  holding?: boolean;
  holdResult?: 'done' | 'broken';
}

export type GameEvent =
  | { type: 'judge'; note: LiveNote; judgement: Judgement; delta: number }
  | { type: 'holdStart'; note: LiveNote }
  | { type: 'holdEnd'; note: LiveNote; ok: boolean }
  | { type: 'comboBreak'; combo: number }
  /** A key went down with no tile to hit: signal and charge drain. */
  | { type: 'stray'; lane: number }
  /** The charge just became full: Overdrive can be set off. */
  | { type: 'charged' }
  /** Overdrive was set off (or went up a level): its level now, 1..MAX_OVERDRIVE. */
  | { type: 'overdrive'; level: number }
  /** Overdrive is about to run out (OVERDRIVE_LOW tiles left): once per level. */
  | { type: 'overdriveLow' }
  /** Overdrive ended: it ran its length, or a miss broke it (`broken`). */
  | { type: 'overdriveEnd'; broken: boolean }
  /** A miss in Overdrive's grace (just after a press): it didn't end it. */
  | { type: 'overdriveHeld' }
  | { type: 'fail' };

export interface Stats {
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  health: number;
  judged: number;
  total: number;
  holdsDone: number;
}

/** A judgement as main.HitResult has it: a Good either side of the note is Early or Late. */
export function hitResultFor(j: Judgement, delta: number): HitResult {
  return j === 'perfect' ? 'PERFECT' : j === 'great' ? 'GOOD' : j === 'good' ? (delta < 0 ? 'EARLY' : 'LATE') : 'MISS';
}

export class Game {
  readonly notes: LiveNote[];
  readonly lanes: number;
  readonly windows: typeof BASE_WINDOWS;
  readonly endTime: number;
  stats: Stats;
  failed = false;
  /** The run as main.Score counts it (score.ts), recorded for the server to replay. */
  readonly scoring: RunScore;
  private next: number[]; // per lane: index into byLane of the first unjudged note
  private byLane: LiveNote[][];
  private active: (LiveNote | null)[];

  constructor(chart: Chart, readonly bpm: number, readonly difficulty: Difficulty, public opts: { noFail?: boolean } = {}) {
    this.opts = { ...opts };
    const spb = 60 / bpm;
    this.lanes = chart.lanes;
    this.notes = chart.notes
      .map((n: ChartNote, idx) => ({ idx, lane: n.lane, pitch: n.pitch, time: n.t * spb, end: (n.t + (n.hold ? n.len : 0)) * spb, hold: !!n.hold }))
      .sort((a, b) => a.time - b.time);
    // Overdrive drains by the chart's clock (score.ts): the tiles' times, as the server has them.
    this.scoring = new RunScore(this.notes.map((n) => n.time));
    this.byLane = Array.from({ length: this.lanes }, (_, l) => this.notes.filter((n) => n.lane === l));
    this.next = new Array(this.lanes).fill(0);
    this.active = new Array(this.lanes).fill(null);
    const k = LENIENCY[difficulty];
    this.windows = { perfect: BASE_WINDOWS.perfect * k, great: BASE_WINDOWS.great * k, good: BASE_WINDOWS.good * k };
    this.endTime = Math.max(0, ...this.notes.map((n) => n.end));
    this.stats = {
      score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      health: 1, judged: 0, total: this.notes.length, holdsDone: 0,
    };
  }

  /** Score's accuracy (0..1); 1 before anything is judged. */
  get accuracy() {
    return this.stats.judged ? this.scoring.accuracy : 1;
  }

  /** The run so far, for the server to replay through Score (score.ts). */
  get run() { return this.scoring.run; }
  /**
   * Each tile's result in the chart's own order (the letter the run has for it: P G E L M; "-"
   * where the run never reached it): sent with the run, the server keeps where players miss (TileHeat).
   */
  tiles(): string {
    const out = new Array<string>(this.notes.length).fill('-');
    for (const n of this.notes) if (n.judged) out[n.idx] = CODE[hitResultFor(n.judged, n.delta ?? 0)];
    return out.join('');
  }

  /** The combo's multiplier plus the Overdrive level (×1 to ×8). */
  get multiplier() { return this.scoring.multiplier; }
  /** Overdrive's charge, 0..1. */
  get charge() { return this.scoring.charge / CHARGE_FULL; }
  get charged() { return this.scoring.charged; }
  /** Whether Overdrive can be set off now: a full charge, below the top level. */
  get canOverdrive() { return this.scoring.canOverdrive; }
  /** Seconds of Overdrive's grace left at song time `t` (0 when it's over or off). */
  graceLeft(t: number) { return this.scoring.grace ? Math.max(0, this.graceUntil - t) : 0; }
  /** The Overdrive level, 0 (off) to 5. */
  get overdriveLevel() { return this.scoring.overdrive; }
  /**
   * What is left of Overdrive, 0..1, now: the model's length less its drain since the last tile
   * judged (it's taken at the next one: score.ts), so the bar drops as the song plays.
   */
  get overdriveLeft() { return Math.max(0, this.liveLeft()) / OVERDRIVE_LENGTH; }
  private liveLeft() {
    const s = this.scoring, last = s.lastTileTime;
    return s.overdrive ? s.overdriveLeft - (Number.isFinite(last) ? Math.max(0, this.now - last) * OVERDRIVE_DRAIN : 0) : 0;
  }

  /** For the results: the highest Overdrive level, how often it was set off, the points it added. */
  get overdriveStats() {
    const s = this.scoring;
    return { peak: s.overdrivePeak, fired: s.overdriveFired, bonus: s.overdriveBonus };
  }

  /**
   * The player set off Overdrive (Space) at song time `at`: needs a full charge, below the top
   * level. Its grace starts: for OVERDRIVE_GRACE seconds a miss doesn't end it (getting from the key
   * back to the lanes).
   */
  overdrive(at = this.now): GameEvent[] {
    if (this.failed || this.finished || !this.scoring.startOverdrive()) return [];
    this.warnedLow = false;
    this.graceUntil = at + OVERDRIVE_GRACE;
    return [{ type: 'overdrive', level: this.scoring.overdrive }];
  }

  /** The latest song time the game has been told (presses, releases, frames). */
  private now = 0;
  /** When Overdrive's grace ends (song seconds). */
  private graceUntil = -Infinity;
  /** Time moved on to `t`: the grace ends once it's past (recorded in the run, U). */
  private passTime(t: number) {
    this.now = Math.max(this.now, t);
    if (this.scoring.grace && t >= this.graceUntil) this.scoring.endGrace();
  }

  /** Whether this level's "running out" was told. */
  private warnedLow = false;

  /** After the score changed: tell when the charge filled up, Overdrive is running out, or ended (`missed`: by a miss). */
  private scored(level: number, charged: boolean, out: GameEvent[], missed = false) {
    if (level > 0 && this.scoring.overdrive === 0) out.push({ type: 'overdriveEnd', broken: missed });
    else if (missed && level > 0) out.push({ type: 'overdriveHeld' });
    else if (this.scoring.overdrive > 0 && !this.warnedLow && this.liveLeft() <= OVERDRIVE_LOW) {
      this.warnedLow = true;
      out.push({ type: 'overdriveLow' });
    }
    if (!charged && this.scoring.charged) out.push({ type: 'charged' });
  }

  get finished() {
    return this.failed || (this.stats.judged === this.stats.total && this.active.every((a) => !a));
  }

  isHolding(lane: number) { return !!this.active[lane]; }

  private judge(note: LiveNote, j: Judgement, delta: number, out: GameEvent[]) {
    note.judged = j;
    note.delta = delta;
    const s = this.stats;
    s.counts[j]++;
    s.judged++;
    if (j === 'miss') {
      if (s.combo >= 5) out.push({ type: 'comboBreak', combo: s.combo });
      s.combo = 0;
      this.hurt(DRAIN[this.difficulty], out);
    } else {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.health = Math.min(1, s.health + GAIN[j]);
    }
    const level = this.scoring.overdrive, charged = this.scoring.charged;
    this.scoring.add(hitResultFor(j, delta));
    s.score = this.scoring.score;
    this.scored(level, charged, out, j === 'miss');
    out.push({ type: 'judge', note, judgement: j, delta });
  }

  private hurt(amount: number, out: GameEvent[]) {
    const s = this.stats;
    s.health = Math.max(0, s.health - amount);
    if (s.health <= 0 && !this.opts.noFail && !this.failed) {
      this.failed = true;
      out.push({ type: 'fail' });
    }
  }

  /** A lane key went down at time t. */
  press(lane: number, t: number): GameEvent[] {
    const out: GameEvent[] = [];
    if (this.failed || lane < 0 || lane >= this.lanes || this.active[lane]) return out;
    this.passTime(t);
    const list = this.byLane[lane];
    let hit = false;
    for (let i = this.next[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.judged) continue;
      const d = t - n.time;
      if (d < -this.windows.good) break; // too early for anything: a stray press
      if (d > this.windows.good) continue; // update() will mark it missed
      const ad = Math.abs(d);
      const j: Judgement = ad <= this.windows.perfect ? 'perfect' : ad <= this.windows.great ? 'great' : 'good';
      this.judge(n, j, d, out);
      hit = true;
      if (n.hold) {
        n.holding = true;
        this.active[lane] = n;
        out.push({ type: 'holdStart', note: n });
      }
      this.advance(lane);
      break;
    }
    if (!hit) this.stray(lane, t, out);
    return out;
  }

  /** Strays so far. */
  strays = 0;

  private stray(lane: number, t: number, out: GameEvent[]) {
    const first = this.notes.length ? this.notes[0].time : 0;
    if (t < first - STRAY_QUIET || t > this.endTime + STRAY_QUIET) return;
    this.strays++;
    const level = this.scoring.overdrive, charged = this.scoring.charged;
    this.scoring.stray();
    this.scored(level, charged, out);
    out.push({ type: 'stray', lane });
    this.hurt(STRAY_DRAIN, out);
  }

  /** A lane key came up at time t. */
  release(lane: number, t: number): GameEvent[] {
    const out: GameEvent[] = [];
    const n = this.active[lane];
    if (!n) return out;
    this.passTime(t);
    this.finishHold(n, t >= n.end - HOLD_GRACE, out);
    return out;
  }

  private finishHold(n: LiveNote, ok: boolean, out: GameEvent[]) {
    n.holding = false;
    n.holdResult = ok ? 'done' : 'broken';
    this.active[n.lane] = null;
    const s = this.stats;
    const level = this.scoring.overdrive, charged = this.scoring.charged;
    if (ok) {
      s.holdsDone++;
      this.scoring.holdDone(n.end - n.time);
    } else {
      if (s.combo >= 5) out.push({ type: 'comboBreak', combo: s.combo });
      s.combo = 0;
      this.scoring.holdBroken();
      this.hurt(DRAIN[this.difficulty] * 0.6, out);
    }
    s.score = this.scoring.score;
    this.scored(level, charged, out, !ok);
    out.push({ type: 'holdEnd', note: n, ok });
  }

  private advance(lane: number) {
    const list = this.byLane[lane];
    while (this.next[lane] < list.length && list[this.next[lane]].judged) this.next[lane]++;
  }

  /** Call every frame: misses tiles that slipped past and completes holds that ran their length. */
  update(t: number): GameEvent[] {
    const out: GameEvent[] = [];
    if (this.failed) return out;
    for (let lane = 0; lane < this.lanes; lane++) {
      const list = this.byLane[lane];
      for (let i = this.next[lane]; i < list.length; i++) {
        const n = list[i];
        if (n.time > t) break;
        if (!n.judged && t - n.time > this.windows.good) {
          // (Missed when it left the window: a miss just inside the grace is in it, even judged late.)
          this.passTime(n.time + this.windows.good);
          this.judge(n, 'miss', t - n.time, out);
          if (n.hold) n.holdResult = 'broken';
        }
      }
      this.advance(lane);
      const a = this.active[lane];
      if (a && t >= a.end) this.finishHold(a, true, out);
    }
    this.passTime(t);
    return out;
  }
}

export function gradeFor(accuracy: number, failed: boolean): Grade {
  if (failed) return 'F';
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.9) return 'A';
  if (accuracy >= 0.8) return 'B';
  if (accuracy >= 0.7) return 'C';
  return 'D';
}

export function starsFor(grade: Grade): number {
  return grade === 'S' || grade === 'A' ? 3 : grade === 'B' ? 2 : grade === 'C' ? 1 : 0;
}

/** Every difficulty plays on four lanes: D F J K by default (rebindable, src/lib/keys.ts; arrow keys and 1-4 work too). */
export const KEYS = [
  { code: 'KeyD', label: 'D' }, { code: 'KeyF', label: 'F' }, { code: 'KeyJ', label: 'J' }, { code: 'KeyK', label: 'K' },
];
const ALT: Record<string, number> = {
  ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
};
/**
 * The lane a key plays, or -1. `bound`: the lane keys as set (the defaults otherwise); `taken`:
 * keys bound to something else (the Overdrive key), which never play a lane by the alternates.
 */
export const laneForCode = (code: string, lanes = 4, bound: readonly string[] = KEYS.map((k) => k.code), taken: readonly string[] = []): number => {
  const i = bound.indexOf(code);
  const lane = i >= 0 ? i : taken.includes(code) ? -1 : ALT[code] ?? -1;
  return lane < lanes ? lane : -1;
};
