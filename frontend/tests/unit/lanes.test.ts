import { describe, expect, it } from 'vitest';
import type { ChartNote } from '../../src/api/types';
import { flowChart } from '../../src/mapping/lanes';
import { patterns } from '../../src/mapping/patterns';

const SPB = 0.5; // 120 BPM
const tiles = (notes: ChartNote[]) => notes.map((n) => ({ sec: n.t * SPB, lane: n.lane }));

/** A chart thinned from a busier one: a tile every half beat, its lanes as a whole chart left them (repeats and leaps). */
function thinned(): ChartNote[] {
  const lanes = [0, 0, 3, 3, 0, 3, 1, 1, 3, 0, 0, 2, 3, 0, 3, 3];
  return Array.from({ length: 240 }, (_, i) => ({ t: i * 0.5, lane: lanes[i % lanes.length], pitch: 'C5', len: 0.25 }));
}

describe('lane flow', () => {
  it('fewer quick repeats and leaps on Easy, no tile moved in time', () => {
    const src = thinned();
    const out = flowChart(src, 'easy', SPB);
    expect(out.map((n) => n.t)).toEqual(src.map((n) => n.t));
    const before = patterns(tiles(src)), after = patterns(tiles(out));
    expect(after.jacks).toBeLessThan(before.jacks / 2);
    expect(after.move).toBeLessThan(before.move);
    expect(after.move).toBeLessThan(1.3);
    // Every lane still used.
    expect(new Set(out.map((n) => n.lane)).size).toBe(4);
    // The source chart is left as it was (each difficulty flows its own copies).
    expect(src[1].lane).toBe(0);
  });

  it('never puts a tile in a lane while a hold there is held, and leaves chords as they are', () => {
    const src: ChartNote[] = [
      { t: 0, lane: 1, pitch: 'C5', len: 4, hold: true },
      { t: 1, lane: 1, pitch: 'C5', len: 0.25 }, // can't stay in lane 1 (held): it must move
      { t: 2, lane: 0, pitch: 'C5', len: 0.25 },
      { t: 2, lane: 3, pitch: 'C5', len: 0.25 }, // a chord
      { t: 3, lane: 2, pitch: 'C5', len: 0.25 },
    ];
    const out = flowChart(src, 'hard', SPB);
    const held = out[0];
    for (const n of out.slice(1)) if (n.t > held.t && n.t < held.t + held.len) expect(n.lane).not.toBe(held.lane);
    expect(out.filter((n) => n.t === 2).map((n) => n.lane).sort()).toEqual([0, 3]);
  });

  it('plays a repeated phrase in the lanes its twin was played in', () => {
    // The same rhythm twice, 8 beats apart; the model wrote the repeat in other lanes.
    const first = [0, 2, 1, 3, 2, 0, 1, 3], again = [3, 1, 0, 2, 0, 3, 2, 1];
    const src: ChartNote[] = [
      ...first.map((lane, i) => ({ t: i, lane, pitch: 'C5', len: 0.25 })),
      ...again.map((lane, i) => ({ t: 8 + i, lane, pitch: 'C5', len: 0.25 })),
    ];
    const twin = (n: ChartNote) => (n.t >= 8 ? src.find((m) => m.t === n.t - 8) : undefined);
    const out = flowChart(src, 'hard', SPB, { twin });
    const lanes = (from: number) => out.filter((n) => n.t >= from && n.t < from + 8).map((n) => n.lane);
    const same = lanes(8).filter((l, i) => l === lanes(0)[i]).length;
    // (A pull, not a copy: a twin's lane still gives way to a big leap or a quick repeat; on the
    // human-chart benchmark repeats then share their lanes about as often as the humans' do.)
    expect(same).toBeGreaterThanOrEqual(5);
    // Without twins, the repeat stays mostly the model's.
    const free = flowChart(src, 'hard', SPB);
    expect(free.filter((n) => n.t >= 8).filter((n, i) => n.lane === free[i].lane).length).toBeLessThan(4);
  });

  it('moves the lanes with the tune where the model moved against it', () => {
    // A tune going up and down by steps; the model's lanes go the other way each time.
    const midi = [60, 62, 64, 65, 67, 65, 64, 62];
    const src = Array.from({ length: 64 }, (_, i) => {
      const up = midi[(i + 1) % 8] > midi[i % 8];
      return { t: i, lane: up ? 3 - (i % 2) : i % 2, pitch: 'C5', len: 0.25, i };
    });
    const pitch = (n: ChartNote) => midi[(n as unknown as { i: number }).i % 8];
    const against = (out: ChartNote[]) => {
      let n = 0;
      for (let i = 1; i < out.length; i++) {
        const dl = out[i].lane - out[i - 1].lane, dp = pitch(out[i]) - pitch(out[i - 1]);
        if (dl && dp && Math.sign(dl) !== Math.sign(dp)) n++;
      }
      return n;
    };
    expect(against(flowChart(src, 'medium', SPB, { pitch }))).toBeLessThan(against(flowChart(src, 'medium', SPB)));
  });

  it('keeps the model\'s lanes where they already play well', () => {
    // A walk up and down, a step at a time, spaced out: nothing to fix.
    const walk = [0, 1, 2, 3, 2, 1];
    const src = Array.from({ length: 60 }, (_, i) => ({ t: i * 2, lane: walk[i % walk.length], pitch: 'C5', len: 0.25 }));
    const out = flowChart(src, 'medium', SPB);
    const same = out.filter((n, i) => n.lane === src[i].lane).length;
    expect(same / src.length).toBeGreaterThan(0.8);
  });
});
