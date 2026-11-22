import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Chart } from '../../src/api/types';
import { Game, OVERDRIVE_GRACE, gradeFor, laneForCode, multiplierFor, type GameEvent } from '../../src/game/engine';
import { OVERDRIVE_LENGTH, PERFECTS_TO_CHARGE, POINT_SCALE, OVERDRIVE_DRAIN, replayRun, tileTimes } from '../../src/game/score';

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
  it("lists each tile's result in the chart's own order, the run's letters for them", () => {
    // The chart stored out of time order: the tiles string follows the stored order.
    const shuffled: Chart = { ...chart, notes: [chart.notes[3], chart.notes[0], chart.notes[4], chart.notes[1], chart.notes[2]] };
    const g = new Game(shuffled, 120, 'hard', { noFail: true });
    g.press(0, 0.01); // t 0: perfect
    g.update(0.9); // t 1 (lane 1) passes unhit: a miss
    g.press(2, 1.0); g.release(2, 2.0); // t 2: the hold
    expect(g.tiles()).toHaveLength(5);
    // Stored order: t 3 (not reached yet), t 0, t 6 (not reached), t 1, t 2.
    expect(g.tiles()).toMatch(/^-P-MP$/);
    // The same letters as the run (in whatever order the run judged them).
    const letters = (s: string) => [...s.replace(/H\d+;/g, '')].filter((c) => 'PGELM'.includes(c)).sort().join('');
    expect(letters(g.tiles())).toBe(letters(g.run));
  });

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
    expect(i).toBe(PERFECTS_TO_CHARGE); // Perfects fill the charge (3 each, to 100)
    expect(g.overdrive()).toEqual([{ type: 'overdrive', level: 1 }]);
    // Half a second apart: each tile uses one, and the half second before it 0.75 more
    // (OVERDRIVE_DRAIN), so 27 tiles have it and the 28th's half second runs it out.
    const per = 1 + 0.5 * OVERDRIVE_DRAIN, lasted = Math.ceil(OVERDRIVE_LENGTH / per) - 1;
    for (let k = 0; k < OVERDRIVE_LENGTH && g.overdriveLevel; k++) {
      // The bar drops between tiles too.
      const before = g.overdriveLeft;
      g.update(i * 0.5 - 0.25);
      expect(g.overdriveLeft).toBeLessThan(before);
      hit();
    }
    expect(i).toBe(PERFECTS_TO_CHARGE + lasted + 1);
    const kinds = events.map((e) => e.type);
    expect(kinds.filter((k) => k === 'overdriveLow')).toHaveLength(1);
    expect(kinds.indexOf('overdriveLow')).toBeLessThan(kinds.indexOf('overdriveEnd'));
    expect(g.overdriveLevel).toBe(0);
    expect(events.find((e) => e.type === 'overdriveEnd')).toEqual({ type: 'overdriveEnd', broken: false });
    expect(g.overdriveStats).toEqual({ peak: 1, fired: 1, bonus: lasted * 100 * POINT_SCALE });
    // The server's replay, on the chart's clock, counts the same.
    expect(replayRun(g.run, tileTimes(long, 120))!.score).toBe(g.stats.score);
  });

  it("Overdrive's grace: for OVERDRIVE_GRACE seconds after the press a miss doesn't end it; after that one does", () => {
    const long: Chart = { difficulty: 'hard', lanes: 4, notes: Array.from({ length: 80 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.5 })) };
    const g = new Game(long, 120, 'hard');
    let i = 0;
    const press = () => { g.press(i % 4, i * 0.5); g.release(i % 4, i * 0.5 + 0.05); i++; };
    while (!g.charged) press();
    // Set off a moment after the last Perfect (each tile is half a second apart).
    const at = i * 0.5 - 0.4;
    g.overdrive(at);
    expect(g.graceLeft(at)).toBeCloseTo(OVERDRIVE_GRACE);
    // The next tile slips past, in the grace: Overdrive holds.
    const first = i * 0.5;
    i++;
    expect(g.update(first + 0.3)).toContainEqual({ type: 'overdriveHeld' });
    expect(g.overdriveLevel).toBe(1);
    while (i * 0.5 < at + OVERDRIVE_GRACE + 0.5) press();
    expect(g.graceLeft(at + OVERDRIVE_GRACE + 0.1)).toBe(0);
    // The next tile slips past after the grace: Overdrive ends, broken, and the charge empties.
    const late = i * 0.5;
    i++;
    expect(g.update(late + 0.3)).toContainEqual({ type: 'overdriveEnd', broken: true });
    expect(g.charge).toBe(0);
    expect(g.run).toMatch(/O.*M.*U.*M$/);
    expect(replayRun(g.run, tileTimes(long, 120))!.score).toBe(g.stats.score);
  });

  it('grades, multipliers and keys', () => {
    // By the score against the chart's best (parScore).
    expect(gradeFor(900, 1000, false)).toBe('S');
    expect(gradeFor(850, 1000, false)).toBe('S');
    expect(gradeFor(700, 1000, false)).toBe('A');
    expect(gradeFor(500, 1000, false)).toBe('B');
    expect(gradeFor(300, 1000, false)).toBe('C');
    expect(gradeFor(100, 1000, false)).toBe('D');
    expect(gradeFor(1200, 1000, false)).toBe('S');
    expect(gradeFor(900, 1000, true)).toBe('F');
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(35)).toBe(4);
    expect(multiplierFor(45)).toBe(5);
    expect(laneForCode('KeyJ', 4)).toBe(2);
    expect(laneForCode('ArrowRight')).toBe(3);
    expect(laneForCode('Digit5')).toBe(-1);
    expect(laneForCode('Space')).toBe(-1);
  });
});
