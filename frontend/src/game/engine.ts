// Game rules, free of DOM and audio so they can be unit tested.
// Times are seconds from beat 0 of the song.

import type { Chart, ChartNote, Difficulty, Grade } from '../api/types';
import { RunScore, multiplierFor, type HitResult } from './score';

export { multiplierFor };

export type Judgement = 'perfect' | 'great' | 'good' | 'miss';

/** Hit windows in seconds (either side of the note). Easier modes are more forgiving. */
const BASE_WINDOWS = { perfect: 0.045, great: 0.09, good: 0.14 };
const LENIENCY: Record<Difficulty, number> = { easy: 1.3, medium: 1.12, hard: 1 };
// Points, combo and accuracy are main.Score's, the multiplier and holds the game's own (score.ts).
const DRAIN: Record<Difficulty, number> = { easy: 0.05, medium: 0.075, hard: 0.1 };
/** A hold released this close to its end still counts as completed. */
const HOLD_GRACE = 0.14;

/** Seconds a tile takes to fall from the top to the hit line at speed 1. */
export const TRAVEL: Record<Difficulty, number> = { easy: 1.75, medium: 1.4, hard: 1.1 };
/**
 * Note speed, fixed for every player and every song: tiles fall at 0.85× (a touch slower than
 * TRAVEL). The same fall time on every song keeps reading and reaction time the same; the song's
 * tempo shows in how close the tiles are, not in how fast they fall.
 */
export const NOTE_SPEED = 0.85;
/** Seconds a tile takes to reach the hit line on this difficulty. */
export const fallTime = (d: Difficulty) => TRAVEL[d] / NOTE_SPEED;

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
  readonly scoring = new RunScore();
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

  get multiplier() { return multiplierFor(this.stats.combo); }

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
      s.health = Math.min(1, s.health + (j === 'perfect' ? 0.022 : j === 'great' ? 0.016 : 0.008));
    }
    this.scoring.add(hitResultFor(j, delta));
    s.score = this.scoring.score;
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
    const list = this.byLane[lane];
    for (let i = this.next[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.judged) continue;
      const d = t - n.time;
      if (d < -this.windows.good) break; // too early for anything: ignore the press
      if (d > this.windows.good) continue; // update() will mark it missed
      const ad = Math.abs(d);
      const j: Judgement = ad <= this.windows.perfect ? 'perfect' : ad <= this.windows.great ? 'great' : 'good';
      this.judge(n, j, d, out);
      if (n.hold) {
        n.holding = true;
        this.active[lane] = n;
        out.push({ type: 'holdStart', note: n });
      }
      this.advance(lane);
      break;
    }
    return out;
  }

  /** A lane key came up at time t. */
  release(lane: number, t: number): GameEvent[] {
    const out: GameEvent[] = [];
    const n = this.active[lane];
    if (!n) return out;
    this.finishHold(n, t >= n.end - HOLD_GRACE, out);
    return out;
  }

  private finishHold(n: LiveNote, ok: boolean, out: GameEvent[]) {
    n.holding = false;
    n.holdResult = ok ? 'done' : 'broken';
    this.active[n.lane] = null;
    const s = this.stats;
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
          this.judge(n, 'miss', t - n.time, out);
          if (n.hold) n.holdResult = 'broken';
        }
      }
      this.advance(lane);
      const a = this.active[lane];
      if (a && t >= a.end) this.finishHold(a, true, out);
    }
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

/** Every difficulty plays on four lanes: D F J K (arrow keys and 1-4 work too). */
export const KEYS = [
  { code: 'KeyD', label: 'D' }, { code: 'KeyF', label: 'F' }, { code: 'KeyJ', label: 'J' }, { code: 'KeyK', label: 'K' },
];
const ALT: Record<string, number> = {
  ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
};
export const laneForCode = (code: string, lanes = 4): number => {
  const i = KEYS.findIndex((k) => k.code === code);
  const lane = i >= 0 ? i : ALT[code] ?? -1;
  return lane < lanes ? lane : -1;
};
