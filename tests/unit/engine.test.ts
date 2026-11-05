import { describe, expect, it } from 'vitest';
import type { Chart } from '../../src/api/types';
import { Game, gradeFor, laneForCode, multiplierFor } from '../../src/game/engine';

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

  it('ignores presses far from any tile and misses tiles that slip past', () => {
    const g = new Game(chart, 120, 'hard');
    expect(g.press(0, -1)).toEqual([]);
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

  it('easy windows are wider than hard', () => {
    const e = new Game(chart, 120, 'easy');
    const h = new Game(chart, 120, 'hard');
    expect(e.windows.good).toBeGreaterThan(h.windows.good);
    expect(e.press(0, 0.16)[0]).toMatchObject({ judgement: 'good' });
    expect(h.press(0, 0.16)).toEqual([]);
  });

  it('grades, multipliers and keys', () => {
    expect(gradeFor(0.97, false)).toBe('S');
    expect(gradeFor(0.97, true)).toBe('F');
    expect(gradeFor(0.5, false)).toBe('D');
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(35)).toBe(4);
    expect(laneForCode('KeyJ', 4)).toBe(2);
    expect(laneForCode('ArrowRight')).toBe(3);
    expect(laneForCode('Digit5')).toBe(-1);
    expect(laneForCode('Space')).toBe(-1);
  });
});
