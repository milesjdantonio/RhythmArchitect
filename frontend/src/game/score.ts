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
//   Overdrive:  accurate hits fill a charge (Perfect 3, Good 2, Early/Late 1, a hold held to its
//               end 3; a miss takes 20): about 34 Perfects in a row. When Overdrive ends (run out
//               or broken), the charge empties: no starting again at once. With a full charge (100) the player sets it off (Space):
//               the charge empties, the level goes up one and it lasts the next OVERDRIVE_LENGTH
//               tiles judged. Set off again while it runs, it goes up again and starts its length
//               again, up to MAX_OVERDRIVE (at the top it can't be set off). One miss ends it,
//               every level, except in its grace: the first OVERDRIVE_GRACE seconds after each
//               press (getting back to the lanes from the key), when a miss doesn't. Otherwise it
//               ends when the length runs out: each tile judged uses one, and it drops on its own
//               as the song plays, OVERDRIVE_DRAIN tiles' worth a second (the user, Nov 20: "make
//               overdrive also passively drop"). The song's clock for that is the chart's: the
//               k-th tile judged is at the k-th tile's time (passTime between them, to the ms),
//               so the server, which has no clock of the run, counts the same.
//
// The game counts with these as it plays (engine.ts) and records the run in order (`run`: P G E
// L M for the hits and misses, H<ms>; for a hold held its length in milliseconds, B for a hold
// let go, X for a stray press, O where Overdrive was set off, U where its grace ended). The server checks the run against the chart it was played on (the difficulty's Queue of
// Notes) and replays it through GameScore, and saves that (backend RunReplay.java); the mock
// server does both here (runFits, replayRun). Free of browser APIs.

import type { Chart, Grade } from '../api/types';

/** main.HitResult. */
export type HitResult = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'MISS';

/** A tile's letter in a run (and in its tiles: engine.ts tiles()). */
export const CODE: Record<HitResult, string> = { PERFECT: 'P', GOOD: 'G', EARLY: 'E', LATE: 'L', MISS: 'M' };
export const CHARGE_FULL = 100;
export const MAX_OVERDRIVE = 3;
/**
 * Tiles judged per Overdrive level (GameScore.OVERDRIVE_LENGTH): 60 since Nov 22 (48 before; the
 * user: "give the overdrive bar a little more time, to ease up on how hard it is to get a second
 * overdrive"). The next level needs a full charge (34 Perfects) inside one; with the drain, 48 left
 * room for about 30 tiles at Medium's rate (2.6 a second), 33 at Hard's (3.5), 36 at Ultra's (4.8):
 * a second level was out of reach below Ultra. 60: about 38, 42 and 46.
 */
export const OVERDRIVE_LENGTH = 60;
/** Seconds after each press when a miss doesn't end Overdrive (the game ends the grace: U). 3 since Nov 22 (5 before). */
export const OVERDRIVE_GRACE = 3;
/** Tiles' worth of Overdrive's length used up each second of the song, besides the tiles (GameScore.OVERDRIVE_DRAIN). */
export const OVERDRIVE_DRAIN = 1.5;
export const MAX_COMBO_MULTIPLIER = 5;
/** Score's points are worth this many (GameScore.POINT_SCALE). */
export const POINT_SCALE = 10;
/** What a stray press takes off the charge. */
export const STRAY_CHARGE = 10;
/** GameScore.chargeFor: what a hit adds to the charge. */
const CHARGE: Record<HitResult, number> = { PERFECT: 3, GOOD: 2, EARLY: 1, LATE: 1, MISS: 0 };
/** What a hold held to its end adds to the charge (GameScore.HOLD_CHARGE). */
export const HOLD_CHARGE = 3;
/** Perfects in a row that fill the charge from empty. */
export const PERFECTS_TO_CHARGE = Math.ceil(CHARGE_FULL / CHARGE.PERFECT);
const FROM_CODE: Record<string, HitResult> = { P: 'PERFECT', G: 'GOOD', E: 'EARLY', L: 'LATE', M: 'MISS' };
/** Score.addHit's points. */
const POINTS: Record<Exclude<HitResult, 'MISS'>, number> = { PERFECT: 100, GOOD: 75, EARLY: 50, LATE: 50 };

/** The combo multiplier: ×1, then one more every 10 in a row, at most ×5. */
export const multiplierFor = (combo: number) => 1 + Math.min(MAX_COMBO_MULTIPLIER - 1, Math.floor(Math.max(0, combo) / 10));

/** A held note held to its end: 120 a second, at least 120, before the multiplier. */
export const holdBonus = (seconds: number) => Math.round(60 * Math.max(1, seconds) * 2);

/** A run as GameScore counts it. */
export class RunScore {
  /** `times`: the chart's tiles' times (seconds), in order: the clock Overdrive drains by (none: no drain). */
  constructor(readonly times?: number[]) {}
  /** Tiles judged (P G E L M), for the clock. */
  private judgedTiles = 0;
  /** The song time of the last tile judged, by the chart's clock (NaN before any). */
  get lastTileTime() { return this.times && this.judgedTiles > 0 ? this.times[Math.min(this.judgedTiles, this.times.length) - 1] : NaN; }
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
    if (this.overdriveLeft <= 0) this.endOverdrive();
  }

  /** Overdrive ends (run out, or a miss): every level, and the charge empties with it. */
  private endOverdrive() {
    this.overdrive = 0;
    this.overdriveLeft = 0;
    this.grace = false;
    this.charge = 0;
  }

  /** GameScore.passTime: the song plays on (to the ms); Overdrive drains. */
  passTime(seconds: number) {
    const ms = Math.round(seconds * 1000);
    if (ms > 0) this.spend((ms * OVERDRIVE_DRAIN) / 1000);
  }

  add(r: HitResult) {
    // The chart's clock: the time since the last tile judged (RunReplay does the same).
    const k = this.judgedTiles++;
    if (this.times && k > 0 && k < this.times.length) this.passTime(this.times[k] - this.times[k - 1]);
    this.run += CODE[r];
    this.count(r);
  }

  /** A held note held to its end (its length in seconds). */
  holdDone(seconds: number) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    this.run += `H${ms};`;
    this.score += holdBonus(ms / 1000) * POINT_SCALE * this.multiplier;
    this.overdriveBonus += holdBonus(ms / 1000) * POINT_SCALE * this.overdrive;
    this.fill(HOLD_CHARGE);
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
      if (this.overdrive && !this.grace) this.endOverdrive();
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

/** The chart's tiles' times in seconds, in order (the clock Overdrive drains by: RunReplay.timesOf). */
export const tileTimes = (chart: Pick<Chart, 'notes'>, bpm: number) => chart.notes.map((n) => n.t * (60 / bpm)).sort((a, b) => a - b);

/**
 * The highest score a chart allows (GameScore.parScore): every tile Perfect, every hold held to its
 * end, Overdrive set off the moment it's charged (its grace ending OVERDRIVE_GRACE seconds later),
 * on the chart's clock. A player who saves Overdrive for a busy stretch can beat it a little.
 */
export function parScore(chart: Pick<Chart, 'notes'>, bpm: number): number {
  const spb = 60 / bpm;
  const ev: { at: number; end: boolean; ms: number }[] = [];
  for (const n of chart.notes) {
    ev.push({ at: n.t * spb, end: false, ms: 0 });
    if (n.hold && n.len > 0) ev.push({ at: (n.t + n.len) * spb, end: true, ms: Math.round(n.len * spb * 1000) });
  }
  // In time; a hold ending with a tile ends first.
  ev.sort((a, b) => (Math.abs(a.at - b.at) > 1e-6 ? a.at - b.at : Number(b.end) - Number(a.end)));
  const s = new RunScore(tileTimes(chart, bpm));
  let graceUntil = -Infinity;
  for (const e of ev) {
    if (s.grace && e.at >= graceUntil - 1e-6) s.endGrace();
    if (e.end) s.holdDone(e.ms / 1000);
    else s.add('PERFECT');
    if (s.startOverdrive()) graceUntil = e.at + OVERDRIVE_GRACE;
  }
  return s.score;
}

/**
 * A run's grade is its score against the chart's best (parScore), not its accuracy (GameScore.gradeFor;
 * the user, Nov 22: "the letter scores should be based on the number score"): at least these shares
 * of it for S, A, B, C; less is D; a failed run F. Simulated players on the 8 bank songs' charts
 * (Medium, Hard, Ultra; Overdrive set off when charged): 98% accuracy (a miss in 300) made 80-93%
 * of the best, 95% (1 in 100) 60-83%, 91% (2 in 100) 49-63%, 85% (4 in 100) 32-45%, 80% 22-28%,
 * 70% 12-16%; a run with every tile Perfect and no Overdrive 75-80%.
 */
export const GRADE_SHARES: [Grade, number][] = [['S', 0.85], ['A', 0.65], ['B', 0.45], ['C', 0.25]];
export function gradeFor(score: number, par: number, failed: boolean): Grade {
  if (failed) return 'F';
  const share = par > 0 ? score / par : 0;
  return GRADE_SHARES.find(([, at]) => share >= at)?.[0] ?? 'D';
}

/** A recorded run counted again (on the chart's clock with `times`: tileTimes), or null when it isn't one. */
export function replayRun(run: string, times?: number[]): RunScore | null {
  if (typeof run !== 'string' || run.length > 400_000 || !/^(?:[PGELMBOXU]|H\d{1,7};)*$/.test(run)) return null;
  const s = new RunScore(times);
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
