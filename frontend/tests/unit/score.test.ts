import { describe, expect, it } from 'vitest';
import { RunScore, holdBonus, multiplierFor, replayRun } from '../../src/game/score';
import { Game, hitResultFor } from '../../src/game/engine';
import type { Chart } from '../../src/api/types';

// The same run is checked against main.GameScore in src/java/test/main/GameScoreTest.java and
// through the server in backend ApiTests: all three must agree.
// 10 Perfects (×1 for the first 9, ×2 from the 10th), a Good and an Early (×2), a 1.5 s hold held
// to its end (180 × 2), a miss, a Late (×1), a hold let go (a miss), a Perfect (×1).
export const RUN = 'PPPPPPPPPPGEH1500;MLBP';

describe("the score: main.Score's rules, the multiplier and holds on top", () => {
  it("counts a run as GameScore does", () => {
    const s = replayRun(RUN)!;
    expect(s.score).toBe(900 + 200 + 150 + 100 + 360 + 50 + 100);
    expect(s.points).toBe(11 * 100 + 75 + 50 + 50); // Score.getScore()
    expect(s.maxCombo).toBe(12);
    expect(s.hits).toBe(14);
    expect(s.misses).toBe(2);
    expect(s.accuracy).toBeCloseTo(1275 / 1600, 10); // Score.getAccuracy() / 100
    expect(s.run).toBe(RUN);
  });

  it('multiplier, hold bonus, and runs that are not runs', () => {
    expect([0, 9, 10, 19, 20, 30, 99].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 4, 4]);
    expect(holdBonus(0.4)).toBe(120);
    expect(holdBonus(1.5)).toBe(180);
    expect(replayRun('PPX')).toBeNull();
    expect(replayRun('H12')).toBeNull();
    expect(replayRun('')!.accuracy).toBe(0);
  });

  it('a Good either side of the note is Early or Late, as main.HitResult has it', () => {
    expect(hitResultFor('perfect', 0.01)).toBe('PERFECT');
    expect(hitResultFor('great', -0.06)).toBe('GOOD');
    expect(hitResultFor('good', -0.12)).toBe('EARLY');
    expect(hitResultFor('good', 0.12)).toBe('LATE');
    expect(hitResultFor('miss', 0.2)).toBe('MISS');
  });

  it('the game records what it counts: replaying its run gives its score and accuracy', () => {
    // 120 BPM: a tap every beat on lane 0, a 2-beat hold on lane 1 at beat 4.
    const chart: Chart = { difficulty: 'hard', lanes: 4, notes: [
      ...[0, 1, 2, 3, 6, 7].map((t) => ({ t, lane: 0, pitch: 'C5', len: 0.25 })),
      { t: 4, lane: 1, pitch: 'C5', len: 2, hold: true },
    ] };
    const g = new Game(chart, 120, 'hard');
    g.press(0, 0); g.press(0, 0.5 + 0.07); g.press(0, 1 - 0.12); // Perfect, Good, Early
    g.update(1.8); // beat 3 missed
    g.press(1, 2); g.update(3.1); // the hold, held to its end
    g.press(0, 3); g.update(4); // a Perfect, then beat 7 missed
    const again = replayRun(g.run)!;
    expect(again.score).toBe(g.stats.score);
    expect(again.accuracy).toBeCloseTo(g.accuracy, 10);
    expect(again.maxCombo).toBe(g.stats.maxCombo);
    expect(g.run).toMatch(/^PGEMPH1000;PM$/);
    const fresh = new RunScore();
    expect(fresh.accuracy).toBe(0);
  });
});
