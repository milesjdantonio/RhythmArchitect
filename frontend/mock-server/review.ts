// The mock's copy of the controller's review (the real one: backend InputReview, the same rules
// and limits): every input is looked at before it reaches Main's rules (play.ts), and the run as a
// whole is checked for what a person at a keyboard couldn't have done. A best score is kept only
// from a run that passed (api.ts, the scores route). The backend's limits on how often a client
// starts runs and sends inputs aren't copied: the mock has one player.

import type { PlayReview } from '../src/api/types';

const ORDER_SLACK = 0.35;
const END_SLACK = 30;
const DOUBLE_PRESS = 0.012;
const PACE_SLACK = 3;
const MAX_PER_SECOND = 40;
const REACH = 0.3;
const HIT_SLACK = 4;
const HIT_SHARE = 0.02;
/** Inputs out of order, and double presses, turned down before the run is flagged for them. */
export const TOLERATED = 20;

export class InputReview {
  private lanes: number[][] = [[], [], [], []];
  private used: boolean[][];
  private from = [0, 0, 0, 0];
  private lastPress = [-Infinity, -Infinity, -Infinity, -Infinity];
  private lastSecond: number[] = [];
  private flags = new Map<string, { check: string; detail: string; count: number }>();
  private latest = -Infinity;
  private firstSong = NaN;
  private firstWall = 0;
  private presses = 0;
  private explained = 0;
  private refusedCount = 0;
  private turnedDown = new Map<string, number>();
  private end: number;

  /** A review of a run on these notes (seconds, lanes), for a song `seconds` long, timed by `clock` (ms). */
  constructor(notes: { lane: number; time: number }[], private clock: () => number = () => Date.now(), seconds = 0) {
    for (const n of notes) if (n.lane >= 0 && n.lane < 4) this.lanes[n.lane].push(n.time);
    for (const l of this.lanes) l.sort((a, b) => a - b);
    this.used = this.lanes.map((l) => l.map(() => false));
    this.end = Math.max(seconds, ...notes.map((n) => n.time)) + END_SLACK;
  }

  /** Null when the input may go to Main, else the check that turned it down. */
  review(input: unknown): string | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return this.refuse('malformed', "an input that isn't an object");
    const i = input as Record<string, unknown>;
    const extra = Object.keys(i).find((k) => k !== 'lane' && k !== 'time');
    if (extra) return this.refuse('malformed', `an input with "${extra.slice(0, 24)}" in it`);
    const time = i.time;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) return this.refuse('malformed', "a time that isn't seconds from 0");
    const press = 'lane' in i;
    const lane = i.lane as number;
    if (press && (!Number.isInteger(lane) || lane < 0 || lane > 3)) return this.refuse('malformed', "a lane that isn't 0-3");
    if (time > this.end) return this.refuse('past the end', `an input at ${time.toFixed(2)} s, after the song's last note`);
    if (time < this.latest - ORDER_SLACK) return this.refuse('out of order', `an input at ${time.toFixed(2)} s after one at ${this.latest.toFixed(2)} s`, TOLERATED);
    if (press && time - this.lastPress[lane] < DOUBLE_PRESS && time >= this.lastPress[lane]) return this.refuse('double press', `lane ${lane} twice at ${time.toFixed(2)} s`, TOLERATED);
    const now = this.clock();
    if (Number.isNaN(this.firstSong)) { this.firstSong = time; this.firstWall = now; }
    else if (time - this.firstSong > (now - this.firstWall) / 1000 + PACE_SLACK) this.flag('too fast', `the song reached ${time.toFixed(2)} s ${((now - this.firstWall) / 1000).toFixed(2)} s after it started`);
    this.latest = Math.max(this.latest, time);
    if (!press) return null;
    this.presses++;
    this.lastPress[lane] = time;
    this.lastSecond.push(time);
    while (this.lastSecond.length && this.lastSecond[0] < time - 1) this.lastSecond.shift();
    if (this.lastSecond.length > MAX_PER_SECOND) this.flag('too many presses', `${this.lastSecond.length} presses in the second before ${time.toFixed(2)} s`);
    this.explain(lane, time);
    return null;
  }

  private explain(lane: number, time: number) {
    const at = this.lanes[lane], u = this.used[lane];
    while (this.from[lane] < at.length && at[this.from[lane]] < time - REACH) this.from[lane]++;
    let best = -1;
    for (let i = this.from[lane]; i < at.length && at[i] <= time + REACH; i++) {
      if (!u[i] && (best < 0 || Math.abs(at[i] - time) < Math.abs(at[best] - time))) best = i;
    }
    if (best >= 0) { u[best] = true; this.explained++; }
  }

  /** The run as the game judged it so far: its hits and strays can't outnumber the presses. */
  reviewRun(run: string) {
    let hits = 0, strays = 0;
    for (let i = 0; i < run.length; i++) {
      const c = run[i];
      if (c === 'H') { while (i < run.length && run[i] !== ';') i++; } else if ('PGEL'.includes(c)) hits++; else if (c === 'X') strays++;
    }
    const slack = HIT_SLACK + Math.ceil(HIT_SHARE * hits);
    if (hits > this.explained + slack) this.flag('unpressed hits', `${hits} hits claimed, ${this.explained} presses near a note in their lane`);
    if (hits + strays > this.presses + slack) this.flag('unpressed hits', `${hits + strays} presses judged, ${this.presses} sent`);
  }

  get passed() { return this.flags.size === 0; }
  why() { const f = [...this.flags.values()][0]; return f ? `${f.check}: ${f.detail}` : ''; }
  toJSON(): PlayReview { return { passed: this.passed, flags: [...this.flags.values()].map((f) => ({ ...f })), refused: this.refusedCount }; }

  /** Turned down; the run is flagged for it once more than `tolerated` of these have come. */
  private refuse(check: string, detail: string, tolerated = 0) {
    this.refusedCount++;
    const seen = (this.turnedDown.get(check) ?? 0) + 1;
    this.turnedDown.set(check, seen);
    if (seen > tolerated) this.flag(check, detail);
    return check;
  }
  private flag(check: string, detail: string) {
    const f = this.flags.get(check);
    this.flags.set(check, f ? { ...f, count: f.count + 1 } : { check, detail, count: 1 });
  }
}
