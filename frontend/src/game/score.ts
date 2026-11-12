// How a run is scored: the game's model class main.Score (src/java/main/Score.java, Darsh Sharma)
// wherever it has a rule, and what the game had before it where it has none, as main.GameScore
// (src/java/main/GameScore.java) adds them on top of Score.
//
//   From Score: a Perfect is 100 points, a Good 75, an Early or a Late 50; a miss scores nothing
//               and ends the combo; accuracy is the points over 100 for every hit and miss.
//   Added:      each hit's points times the combo multiplier (×1, then ×2, ×3, ×4 every 10 in a
//               row); a held note held to its end scores 120 a second (at least 120) times the
//               multiplier; one let go early ends the combo (Score can only do that by counting
//               a miss, so it counts as one).
//
// The game counts with these as it plays (engine.ts) and records the run in order (`run`: P G E
// L M for the hits and misses, H<ms>; for a hold held its length in milliseconds, B for a hold let
// go). The server replays the run through GameScore and saves that (backend RunReplay.java); the
// mock server replays it here (replayRun). Free of browser APIs.

/** main.HitResult. */
export type HitResult = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'MISS';

const CODE: Record<HitResult, string> = { PERFECT: 'P', GOOD: 'G', EARLY: 'E', LATE: 'L', MISS: 'M' };
const FROM_CODE: Record<string, HitResult> = { P: 'PERFECT', G: 'GOOD', E: 'EARLY', L: 'LATE', M: 'MISS' };
/** Score.addHit's points. */
const POINTS: Record<Exclude<HitResult, 'MISS'>, number> = { PERFECT: 100, GOOD: 75, EARLY: 50, LATE: 50 };

/** The combo multiplier: ×1, then one more every 10 in a row, at most ×4. */
export const multiplierFor = (combo: number) => 1 + Math.min(3, Math.floor(combo / 10));

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

  add(r: HitResult) {
    this.run += CODE[r];
    this.count(r);
  }

  /** A held note held to its end (its length in seconds). */
  holdDone(seconds: number) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    this.run += `H${ms};`;
    this.score += holdBonus(ms / 1000) * multiplierFor(this.combo);
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
      return;
    }
    const p = POINTS[r];
    if (r === 'PERFECT') this.perfect++;
    else if (r === 'GOOD') this.good++;
    else this.earlyLate++;
    this.points += p;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += p * multiplierFor(this.combo);
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
  if (typeof run !== 'string' || run.length > 400_000 || !/^(?:[PGELMB]|H\d{1,7};)*$/.test(run)) return null;
  const s = new RunScore();
  for (const m of run.matchAll(/[PGELMB]|H(\d+);/g)) {
    if (m[1] !== undefined) s.holdDone(Number(m[1]) / 1000);
    else if (m[0] === 'B') s.holdBroken();
    else s.add(FROM_CODE[m[0]]);
  }
  return s;
}
