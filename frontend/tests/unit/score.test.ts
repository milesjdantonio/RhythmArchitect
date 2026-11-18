import { describe, expect, it } from 'vitest';
import { CHARGE_FULL, MAX_OVERDRIVE, OVERDRIVE_LENGTH, STRAY_CHARGE, RunScore, graceTiles, holdBonus, multiplierFor, replayRun, runFits } from '../../src/game/score';
import { Game, hitResultFor } from '../../src/game/engine';
import type { Chart } from '../../src/api/types';

// The same run is checked against main.GameScore in src/test/main/GameScoreTest.java and
// through the server in backend ApiTests: all three must agree.
// 10 Perfects (×1 for the first 9, ×2 from the 10th), a Good and an Early (×2), a 1.5 s hold held
// to its end (180 × 2), a miss, a Late (×1), a hold let go (a miss), a Perfect (×1).
export const RUN = 'PPPPPPPPPPGEH1500;MLBP';
// Overdrive (GameScoreTest, ApiTests): 20 Perfects fill the charge (x1, x2, then x3), O sets it off
// (+1: x4), Perfect, Perfect, Good, a miss in its grace (the charge goes, Overdrive stays), U (the
// grace is over), a 1 s hold at x2 (combo x1 + 1), a Perfect at x2, then a miss, which ends it.
export const OVERDRIVE_RUN = 'PPPPPPPPPPPPPPPPPPPPOPPGMUH1000;PM';

describe("the score: main.Score's rules, the multiplier and holds on top", () => {
  it("counts a run as GameScore does", () => {
    const s = replayRun(RUN)!;
    expect(s.score).toBe((900 + 200 + 150 + 100 + 360 + 50 + 100) * 10); // a Perfect is 1,000
    expect(s.points).toBe(11 * 100 + 75 + 50 + 50); // Score.getScore()
    expect(s.maxCombo).toBe(12);
    expect(s.hits).toBe(14);
    expect(s.misses).toBe(2);
    expect(s.accuracy).toBeCloseTo(1275 / 1600, 10); // Score.getAccuracy() / 100
    expect(s.run).toBe(RUN);
  });

  it('multiplier, hold bonus, and runs that are not runs', () => {
    expect([0, 9, 10, 19, 20, 30, 39, 40, 99].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
    expect(holdBonus(0.4)).toBe(120);
    expect(holdBonus(1.5)).toBe(180);
    expect(replayRun('PPZ')).toBeNull();
    expect(replayRun('H12')).toBeNull();
    expect(replayRun('')!.accuracy).toBe(0);
  });

  it('Overdrive: set off with a full charge, it adds its level to the multiplier; one miss ends it', () => {
    const s = replayRun(OVERDRIVE_RUN)!;
    expect(s.score).toBe((3200 + 400 + 400 + 300 + 240 + 200) * 10);
    expect(s.points).toBe(2375);
    expect(s.maxCombo).toBe(23);
    expect(s.accuracy).toBeCloseTo(2375 / 2600, 10);
    expect(s.overdrive).toBe(0); // the last miss (after the grace) ended it
    expect(s.overdriveLeft).toBe(0);
    expect(s.run).toBe(OVERDRIVE_RUN);
    expect(replayRun('PPPO')).toBeNull(); // not charged
    // Strays (X) score nothing but drain the charge: 20 Perfects and a stray can't set it off.
    expect(replayRun('P'.repeat(20) + 'XO')).toBeNull();
    expect(replayRun('P'.repeat(20) + 'X')!.charge).toBe(CHARGE_FULL - STRAY_CHARGE);
    expect(replayRun('PX')!.score).toBe(replayRun('P')!.score);
    expect(runFits(OVERDRIVE_RUN, { difficulty: 'hard', lanes: 4, notes: [
      ...Array.from({ length: 26 }, (_, t) => ({ t, lane: 0, pitch: 'C5', len: 0.25 })),
      { t: 30, lane: 1, pitch: 'C5', len: 2, hold: true },
    ] }, 120)).toBe(true); // O isn't a tile
  });

  it('Overdrive stacks to level 3 (x8 at most), can\'t be set off at the top, and drops to 0 when it runs out', () => {
    const s = new RunScore();
    for (let level = 1; level <= MAX_OVERDRIVE; level++) {
      for (let i = 0; i < 20; i++) s.add('PERFECT');
      expect(s.charge).toBe(CHARGE_FULL);
      expect(s.startOverdrive()).toBe(true);
      expect(s.overdrive).toBe(level);
    }
    expect(s.multiplier).toBe(8);
    for (let i = 0; i < 20; i++) s.add('PERFECT');
    expect(s.charged).toBe(true);
    expect(s.canOverdrive).toBe(false);
    expect(s.startOverdrive()).toBe(false); // the top: no fourth level, no renewing
    expect(replayRun(s.run + 'O')).toBeNull();
    for (let i = 0; i < OVERDRIVE_LENGTH - 20; i++) s.add('PERFECT');
    expect(s.overdrive).toBe(0);
    expect(s.multiplier).toBe(5);
    expect(replayRun(s.run)!.score).toBe(s.score);
  });

  it("Overdrive's grace: a miss just after the press doesn't end it, one after U does, and no grace longer than the chart allows", () => {
    const charged = 'P'.repeat(20) + 'O';
    expect(replayRun(charged + 'M')!.overdrive).toBe(1); // in the grace
    expect(replayRun(charged + 'UM')!.overdrive).toBe(0); // after it
    expect(replayRun('PU')).toBeNull(); // no grace to end
    expect(replayRun(charged + 'UU')).toBeNull();
    // A tile every beat at 120 BPM: OVERDRIVE_GRACE (and 0.6 s) holds 12 of them, so a grace may judge 14.
    const chart: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 60 }, (_, t) => ({ t, lane: 0, pitch: 'C5', len: 0.25 })) };
    expect(graceTiles(chart.notes.map((n) => n.t * 0.5))).toBe(14);
    expect(runFits(charged + 'P'.repeat(14) + 'U', chart, 120)).toBe(true);
    expect(runFits(charged + 'P'.repeat(15) + 'U', chart, 120)).toBe(false);
    expect(runFits(charged + 'P'.repeat(15), chart, 120)).toBe(false); // never ended
  });

  it('the game sets off Overdrive: events, and the run the server replays', () => {
    const chart: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 30 }, (_, t) => ({ t, lane: t % 4, pitch: 'C5', len: 0.25 })) };
    const g = new Game(chart, 120, 'hard');
    expect(g.overdrive()).toEqual([]);
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) seen.push(...g.press(i % 4, i * 0.5).map((e) => e.type));
    expect(seen.filter((t) => t === 'charged')).toHaveLength(1);
    expect(g.charged).toBe(true);
    expect(g.overdrive()).toEqual([{ type: 'overdrive', level: 1 }]);
    expect(g.multiplier).toBe(4);
    g.update(14);
    expect(replayRun(g.run)!.score).toBe(g.stats.score);
    expect(g.run.startsWith('P'.repeat(20) + 'O')).toBe(true);
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
    expect(runFits(g.run, chart, 120)).toBe(true); // the server would take it
    const fresh = new RunScore();
    expect(fresh.accuracy).toBe(0);
  });

  it('a run is checked against the chart it was played on, as the backend does (RunReplay.fits)', () => {
    // 120 BPM: a tap, then a hold of two beats (one second). The same chart as backend MappingTests.
    const chart: Chart = { difficulty: 'hard', lanes: 4, notes: [
      { t: 0, lane: 0, pitch: 'C5', len: 0.25 },
      { t: 2, lane: 2, pitch: 'E5', len: 2, hold: true },
    ] };
    for (const ok of ['PPH1000;', 'PPH1002;', 'PPB', 'PM', '']) expect(runFits(ok, chart, 120), ok).toBe(true);
    for (const bad of ['PPP', 'PPH1003;', 'PPH500;B']) expect(runFits(bad, chart, 120), bad).toBe(false);
    expect(runFits('P', { ...chart, notes: [] }, 120)).toBe(false);
  });
});
