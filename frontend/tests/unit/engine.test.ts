import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Chart } from '../../src/api/types';
import { Game, OVERDRIVE_GRACE, OVERDRIVE_LOW, gradeFor, laneForCode, multiplierFor, type GameEvent } from '../../src/game/engine';
import { OVERDRIVE_LENGTH, POINT_SCALE, replayRun } from '../../src/game/score';

// 120 bpm: one beat = 0.5 s.
const chart: Chart = {
  difficulty: 'hard', lanes: 4,
  notes: [
    { t: 0, lane: 0, pitch: 'C5', len: 0.5 },
    { t: 1, lane: 1, pitch: 'D5', len: 0.5 },
    { t: 2, lane: 2, pitch: 'E5', len: 2, hold: true },
    { t: 3, lane: 0, pitch: 'F5', len: 0.5 },
    { t: 6, lane: 3, pitch: 'G5', len: 0.5 },
  ],
};

describe('game engine', () => {
  it('judges by timing', () => {
    const g = new Game(chart, 120, 'hard');
    expect(g.press(0, 0.01)[0]).toMatchObject({ type: 'judge', judgement: 'perfect' });
    expect(g.press(1, 0.5 + 0.07)[0]).toMatchObject({ judgement: 'great' });
    expect(g.stats.combo).toBe(2);
  });

  it('ignores presses long before the first tile and misses tiles that slip past', () => {
    const g = new Game(chart, 120, 'hard');
    expect(g.press(0, -1.5)).toEqual([]);
    const ev = g.update(0.3);
    expect(ev.find((e) => e.type === 'judge')).toMatchObject({ judgement: 'miss' });
    expect(g.stats.counts.miss).toBe(1);
    expect(g.stats.health).toBeLessThan(1);
  });

  it('completes a hold held to the end and breaks one released early', () => {
    const a = new Game(chart, 120, 'hard');
    a.press(2, 1.0);
    expect(a.isHolding(2)).toBe(true);
    const done = a.update(2.0);
    expect(done.find((e) => e.type === 'holdEnd')).toMatchObject({ ok: true });

    const b = new Game(chart, 120, 'hard');
    b.press(0, 0); b.press(1, 0.5); b.press(2, 1.0);
    const broken = b.release(2, 1.3);
    expect(broken.find((e) => e.type === 'holdEnd')).toMatchObject({ ok: false });
    expect(b.stats.combo).toBe(0);
  });

  it('fails when health runs out, unless no-fail is on', () => {
    const many: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 20 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.5 })) };
    const g = new Game(many, 120, 'hard');
    const ev = g.update(30);
    expect(ev.some((e) => e.type === 'fail')).toBe(true);
    expect(g.finished).toBe(true);
    const safe = new Game(many, 120, 'hard', { noFail: true });
    safe.update(30);
    expect(safe.failed).toBe(false);
    expect(safe.finished).toBe(true);
  });

  it('each difficulty is a little stricter than the one before; easy windows are wider than ultra', () => {
    const games = DIFFICULTIES.map((d) => new Game(chart, 120, d));
    for (let i = 1; i < games.length; i++) expect(games[i].windows.good).toBeLessThan(games[i - 1].windows.good);
    const e = games[0], u = games[games.length - 1];
    expect(e.press(0, 0.15)[0]).toMatchObject({ judgement: 'good' });
    expect(u.press(0, 0.15).some((e) => e.type === 'judge')).toBe(false);
  });

  it('a stray press (no tile to hit) costs signal and charge, so mashing fails the song', () => {
    const g = new Game(chart, 120, 'hard');
    g.press(0, 0); // a Perfect: some charge
    const charge = g.charge;
    expect(g.press(3, 0.2)).toContainEqual({ type: 'stray', lane: 3 });
    expect(g.stats.health).toBeLessThan(1);
    expect(g.charge).toBeLessThan(charge);
    expect(g.run).toBe('PX');
    // Mashing every key ten times a second, between the tiles:
    const masher = new Game({ ...chart, notes: Array.from({ length: 40 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.25 })) }, 120, 'hard');
    for (let t = 0; t < 20 && !masher.failed; t += 0.1) for (let l = 0; l < 4; l++) { masher.press(l, t); masher.release(l, t + 0.05); masher.update(t); }
    expect(masher.failed).toBe(true);
    expect(masher.strays).toBeGreaterThan(20);
  });

  it('Overdrive tells once when it is running out, then that it ran out, and counts what it added', () => {
    const long: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 90 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.5 })) };
    const g = new Game(long, 120, 'hard');
    const events: GameEvent[] = [];
    let i = 0;
    const hit = () => { events.push(...g.press(i % 4, i * 0.5)); g.release(i % 4, i * 0.5 + 0.05); i++; };
    while (!g.charged) hit();
    expect(i).toBe(20); // 20 Perfects fill the charge
    expect(g.overdrive()).toEqual([{ type: 'overdrive', level: 1 }]);
    for (let k = 0; k < OVERDRIVE_LENGTH; k++) hit();
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === 'overdriveLow')).toHaveLength(1);
    // Told with the hit that leaves OVERDRIVE_LOW tiles (just before its judgement), before it runs out on the last one.
    expect(kinds.slice(0, kinds.indexOf('overdriveLow')).filter((k) => k === 'judge')).toHaveLength(20 + OVERDRIVE_LENGTH - OVERDRIVE_LOW - 1);
    expect(kinds.indexOf('overdriveLow')).toBeLessThan(kinds.indexOf('overdriveEnd'));
    expect(g.overdriveLevel).toBe(0);
    expect(events.find((e) => e.type === 'overdriveEnd')).toEqual({ type: 'overdriveEnd', broken: false });
    expect(g.overdriveStats).toEqual({ peak: 1, fired: 1, bonus: OVERDRIVE_LENGTH * 100 * POINT_SCALE });
    expect(replayRun(g.run)!.score).toBe(g.stats.score);
  });

  it("Overdrive's grace: for OVERDRIVE_GRACE seconds after the press a miss doesn't end it; after that one does", () => {
    const long: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 60 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.5 })) };
    const g = new Game(long, 120, 'hard');
    let i = 0;
    const press = () => { g.press(i % 4, i * 0.5); g.release(i % 4, i * 0.5 + 0.05); i++; };
    while (!g.charged) press();
    g.overdrive(9.6);
    expect(g.graceLeft(9.6)).toBeCloseTo(OVERDRIVE_GRACE);
    // The tile at 10 s slips past, in the grace: Overdrive holds.
    i++;
    expect(g.update(10.3)).toContainEqual({ type: 'overdriveHeld' });
    expect(g.overdriveLevel).toBe(1);
    while (i * 0.5 < 15) press();
    expect(g.graceLeft(14.7)).toBe(0);
    // The tile at 15 s slips past after the grace: Overdrive ends, broken.
    i++;
    expect(g.update(15.3)).toContainEqual({ type: 'overdriveEnd', broken: true });
    expect(g.run).toMatch(/O.*M.*U.*M$/);
    expect(replayRun(g.run)!.score).toBe(g.stats.score);
  });

  it('grades, multipliers and keys', () => {
    expect(gradeFor(0.97, false)).toBe('S');
    expect(gradeFor(0.97, true)).toBe('F');
    expect(gradeFor(0.5, false)).toBe('D');
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(35)).toBe(4);
    expect(multiplierFor(45)).toBe(5);
    expect(laneForCode('KeyJ', 4)).toBe(2);
    expect(laneForCode('ArrowRight')).toBe(3);
    expect(laneForCode('Digit5')).toBe(-1);
    expect(laneForCode('Space')).toBe(-1);
  });
});
