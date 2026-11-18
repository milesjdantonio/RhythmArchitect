// How a run is scored: the game's model class main.Score (src/java/main/Score.java, Darsh Sharma)
// wherever it has a rule, and what the game had before it where it has none, as main.GameScore
// (src/java/main/GameScore.java) adds them on top of Score.
//
//   From Score: a Perfect is 100 points, a Good 75, an Early or a Late 50; a miss scores nothing
//               and ends the combo; accuracy is the points over 100 for every hit and miss.
//   Added:      each hit's points times POINT_SCALE (a Perfect is 1,000) and the multiplier; a
//               held note held to its end scores 120 a second (at least 120) times the scale and
//               the multiplier; one let go early ends the combo (Score can only do that by
//               counting a miss, so it counts as one). A stray press (a key that hit no tile)
//               scores nothing and takes STRAY_CHARGE off the Overdrive charge.
//   Multiplier: the combo's (×1, then one more every 10 in a row, at most ×5) plus the Overdrive
//               level (0-3): at most ×8.
//   Overdrive:  accurate hits fill a charge (Perfect 5, Good 3, Early/Late 1, a hold held to its
//               end 5; a miss takes 20). With a full charge (100) the player sets it off (Space):
//               the charge empties, the level goes up one and it lasts the next OVERDRIVE_LENGTH
//               tiles judged. Set off again while it runs, it goes up again and starts its length
//               again, up to MAX_OVERDRIVE (at the top it can't be set off). One miss ends it,
//               every level, except in its grace: the first OVERDRIVE_GRACE seconds after each
//               press (getting back to the lanes from the key), when a miss doesn't. Otherwise it
//               ends when the length runs out.
//
// The game counts with these as it plays (engine.ts) and records the run in order (`run`: P G E
// L M for the hits and misses, H<ms>; for a hold held its length in milliseconds, B for a hold
// let go, X for a stray press, O where Overdrive was set off, U where its grace ended). The server checks the run against the chart it was played on (the difficulty's Queue of
// Notes) and replays it through GameScore, and saves that (backend RunReplay.java); the mock
// server does both here (runFits, replayRun). Free of browser APIs.

import type { Chart } from '../api/types';

/** main.HitResult. */
export type HitResult = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'MISS';

const CODE: Record<HitResult, string> = { PERFECT: 'P', GOOD: 'G', EARLY: 'E', LATE: 'L', MISS: 'M' };
export const CHARGE_FULL = 100;
export const MAX_OVERDRIVE = 3;
export const OVERDRIVE_LENGTH = 48;
/** Seconds after each press when a miss doesn't end Overdrive (the game ends the grace: U). */
export const OVERDRIVE_GRACE = 5;
export const MAX_COMBO_MULTIPLIER = 5;
/** Score's points are worth this many (GameScore.POINT_SCALE). */
export const POINT_SCALE = 10;
/** What a stray press takes off the charge. */
export const STRAY_CHARGE = 10;
/** GameScore.chargeFor: what a hit adds to the charge. */
const CHARGE: Record<HitResult, number> = { PERFECT: 5, GOOD: 3, EARLY: 1, LATE: 1, MISS: 0 };
const FROM_CODE: Record<string, HitResult> = { P: 'PERFECT', G: 'GOOD', E: 'EARLY', L: 'LATE', M: 'MISS' };
/** Score.addHit's points. */
const POINTS: Record<Exclude<HitResult, 'MISS'>, number> = { PERFECT: 100, GOOD: 75, EARLY: 50, LATE: 50 };

/** The combo multiplier: ×1, then one more every 10 in a row, at most ×5. */
export const multiplierFor = (combo: number) => 1 + Math.min(MAX_COMBO_MULTIPLIER - 1, Math.floor(Math.max(0, combo) / 10));

/** A held note held to its end: 120 a second, at least 120, before the multiplier. */
export const holdBonus = (seconds: number) => Math.round(60 * Math.max(1, seconds) * 2);

/** A run as GameScore counts it. */
export class RunScore {
  /** GameScore.getScore(): the points times the multiplier, and the holds. */
  score = 0;
  /** Score.getScore(): the hits' points without the multiplier. */
  points = 0;
  combo = 0;
  maxCombo = 0;
  perfect = 0;
  good = 0;
  earlyLate = 0;
  misses = 0;
  /** The run in order, for the server to replay. */
  run = '';
  /** Overdrive's charge, 0..CHARGE_FULL. */
  charge = 0;
  /** The Overdrive level, 0 (off) to MAX_OVERDRIVE. */
  overdrive = 0;
  /** Tiles judged before Overdrive ends. */
  overdriveLeft = 0;
  /**
   * For the results only (not part of the rules, so GameScore has no twin): the highest level
   * reached, how many times it was set off, and the points the Overdrive levels added.
   */
  overdrivePeak = 0;
  overdriveFired = 0;
  overdriveBonus = 0;
  /** Overdrive's grace: a miss doesn't end it (from each press until endGrace). */
  grace = false;

  /** GameScore.getMultiplier(): the combo's plus the Overdrive level. */
  get multiplier() { return multiplierFor(this.combo) + this.overdrive; }
  get charged() { return this.charge >= CHARGE_FULL; }

  /** Whether Overdrive can be set off now: a full charge, and below the top level. */
  get canOverdrive() { return this.charged && this.overdrive < MAX_OVERDRIVE; }

  /** Sets off Overdrive (a full charge, below the top level). Whether it started. */
  startOverdrive(): boolean {
    if (!this.canOverdrive) return false;
    this.run += 'O';
    this.ignite();
    this.overdriveFired++;
    this.overdrivePeak = Math.max(this.overdrivePeak, this.overdrive);
    return true;
  }

  private ignite() {
    this.charge = 0;
    this.overdrive++;
    this.overdriveLeft = OVERDRIVE_LENGTH;
    this.grace = true;
  }

  /** GameScore.endGrace: the grace is over (recorded as U); a miss ends Overdrive again. */
  endGrace() {
    if (!this.grace) return;
    this.run += 'U';
    this.grace = false;
  }

  private fill(amount: number) { this.charge = Math.max(0, Math.min(CHARGE_FULL, this.charge + amount)); }

  private spend(tiles: number) {
    if (!this.overdrive) return;
    this.overdriveLeft -= tiles;
    if (this.overdriveLeft <= 0) { this.overdrive = 0; this.overdriveLeft = 0; this.grace = false; }
  }

  add(r: HitResult) {
    this.run += CODE[r];
    this.count(r);
  }

  /** A held note held to its end (its length in seconds). */
  holdDone(seconds: number) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    this.run += `H${ms};`;
    this.score += holdBonus(ms / 1000) * POINT_SCALE * this.multiplier;
    this.overdriveBonus += holdBonus(ms / 1000) * POINT_SCALE * this.overdrive;
    this.fill(5);
  }

  /** A stray press: a key that hit no tile. Nothing scored; the charge drains. */
  stray() {
    this.run += 'X';
    this.fill(-STRAY_CHARGE);
  }

  /** A held note let go early: the combo ends (a miss to Score). */
  holdBroken() {
    this.run += 'B';
    this.count('MISS');
  }

  private count(r: HitResult) {
    if (r === 'MISS') {
      this.misses++;
      this.combo = 0;
      this.fill(-20);
      // One miss ends Overdrive, every level (not in its grace).
      if (!this.grace) { this.overdrive = 0; this.overdriveLeft = 0; }
      return;
    }
    const p = POINTS[r];
    if (r === 'PERFECT') this.perfect++;
    else if (r === 'GOOD') this.good++;
    else this.earlyLate++;
    this.points += p;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += p * POINT_SCALE * this.multiplier;
    this.overdriveBonus += p * POINT_SCALE * this.overdrive;
    this.fill(CHARGE[r]);
    this.spend(1);
  }

  get hits() { return this.perfect + this.good + this.earlyLate; }

  /** Score.getAccuracy() as a share (0..1): the points over 100 for every hit and miss; 0 before any. */
  get accuracy() {
    const total = this.hits + this.misses;
    return total ? (this.perfect * 100 + this.good * 75 + this.earlyLate * 50) / (total * 100) : 0;
  }
}

/** A recorded run counted again, or null when it isn't one. */
export function replayRun(run: string): RunScore | null {
  if (typeof run !== 'string' || run.length > 400_000 || !/^(?:[PGELMBOXU]|H\d{1,7};)*$/.test(run)) return null;
  const s = new RunScore();
  for (const m of run.matchAll(/[PGELMBOXU]|H(\d+);/g)) {
    if (m[0] === 'O') { if (!s.startOverdrive()) return null; continue; }
    if (m[0] === 'U') { if (!s.grace) return null; s.endGrace(); continue; }
    if (m[0] === 'X') { s.stray(); continue; }
    if (m[1] !== undefined) s.holdDone(Number(m[1]) / 1000);
    else if (m[0] === 'B') s.holdBroken();
    else s.add(FROM_CODE[m[0]]);
  }
  return s;
}

/**
 * The most tiles a grace can judge on a chart (RunReplay.graceTiles): the most the chart has in
 * any OVERDRIVE_GRACE seconds (and a little: a tile judged late, one early), plus two. `times`:
 * the tiles' times in seconds.
 */
export function graceTiles(times: number[]): number {
  const t = [...times].sort((a, b) => a - b);
  const span = OVERDRIVE_GRACE + 0.6;
  let most = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] > span) j++;
    most = Math.max(most, i - j + 1);
  }
  return most + 2;
}

/** How far a hold's recorded time may be off its length, in milliseconds (rounding). */
export const HOLD_SLACK_MS = 2;

/**
 * Whether a run could have been played on the chart (backend RunReplay.fits, on the chart as the
 * model's Queue of Notes): every tile is judged once, so no more tiles judged than the chart has,
 * no more holds ended than it has, and the holds held to their end, longest first, each no longer
 * than the chart's holds, longest first; and no grace (O to U) longer than the chart allows
 * (graceTiles). A run ended early (a fail) judges fewer.
 */
export function runFits(run: string, chart: Chart, bpm: number): boolean {
  const spb = 60 / bpm;
  const holds = chart.notes.filter((n) => n.hold && n.len > 0).map((n) => Math.round(n.len * spb * 1000)).sort((a, b) => b - a);
  const held: number[] = [];
  let judged = 0;
  let ended = 0;
  const graceMax = graceTiles(chart.notes.map((n) => n.t * spb));
  let inGrace = false, graceJudged = 0;
  for (const m of run.matchAll(/[PGELMBOXU]|H(\d+);/g)) {
    if (m[0] === 'O') { inGrace = true; graceJudged = 0; continue; }
    if (m[0] === 'U') { inGrace = false; continue; }
    if (m[0] === 'X') continue;
    if (m[1] === undefined && m[0] !== 'B' && inGrace && ++graceJudged > graceMax) return false;
    if (m[1] !== undefined) held.push(Number(m[1]));
    if (m[1] !== undefined || m[0] === 'B') ended++;
    else judged++;
  }
  if (judged > chart.notes.length || ended > holds.length) return false;
  held.sort((a, b) => b - a);
  return held.every((ms, i) => ms <= holds[i] + HOLD_SLACK_MS);
}
