import { describe, expect, it } from 'vitest';
import type { SoundEvent } from '../../src/api/types';
import { beatAt, beatMap, beatPlace, divisionAt, secAt, snapSec } from '../../src/mapping/beatmap';
import { findRepeats, twinSec } from '../../src/mapping/repeats';

/** A song's beats: `n` of them from `at`, each `gap(i)` seconds after the last, the tracker's jitter (20 ms frames) on top. */
function song(n: number, gap: (i: number) => number, at = 0.5, jitter = 0.01) {
  const truth: number[] = [at];
  for (let i = 1; i < n; i++) truth.push(truth[i - 1] + gap(i));
  // Jitter that a frame grid gives: up to ±`jitter`, the same for the same song.
  const tracked = truth.map((b, i) => b + jitter * Math.sin(i * 2.3));
  return { truth, tracked };
}
/** Sounds on every 16th (or every `d`th of a beat) of the true beats, ±`spread` s. */
function sounds(truth: number[], d = 4, spread = 0.003) {
  const out: number[] = [];
  for (let i = 0; i + 1 < truth.length; i++) for (let k = 0; k < d; k++) out.push(truth[i] + ((truth[i + 1] - truth[i]) * k) / d + spread * Math.sin(i * 7 + k));
  return out;
}

describe('the beat map', () => {
  it('follows a tempo that drifts, where one straight grid runs off the music', () => {
    // 100 BPM speeding up to about 110 over two minutes.
    const { truth, tracked } = song(200, (i) => 0.6 - i * 0.00027);
    const s = sounds(truth);
    const map = beatMap({ beats: tracked }, s, { spb: 0.57, offset: 0.5, meter: 4 })!;
    expect(map).not.toBeNull();
    // Each beat within a few ms of the true one, the tracker's 10 ms jitter smoothed out.
    const err = truth.slice(5, -5).map((b, i) => Math.abs(map.secs[i + 5] - b));
    expect(Math.max(...err)).toBeLessThan(0.004);
    // A sound 8 ms off its 16th goes onto it, near the end too (a straight grid is 100+ ms off there).
    const x = truth[180] + (truth[181] - truth[180]) * 0.25;
    expect(Math.abs(snapSec(map, x + 0.008) - x)).toBeLessThan(0.004);
    expect(divisionAt(map, beatAt(map, x))).toBe(4);
    // One more than 20 ms off stays where it was heard.
    expect(snapSec(map, x + 0.03)).toBe(x + 0.03);
  });

  it('takes triplets where the sounds follow them, 16ths elsewhere', () => {
    const { truth, tracked } = song(120, () => 0.5, 0.5, 0);
    // The first half in 16ths, the second in 8th triplets.
    const s = [...sounds(truth.slice(0, 60)), ...sounds(truth.slice(59), 3)];
    const map = beatMap({ beats: tracked }, s, { spb: 0.5, offset: 0.5, meter: 4 })!;
    expect(divisionAt(map, 20)).toBe(4);
    expect([3, 6]).toContain(divisionAt(map, 95));
    // A triplet a little late goes onto the triplet, not the nearest 16th.
    const tri = truth[95] + 0.5 / 3;
    expect(Math.abs(snapSec(map, tri + 0.006) - tri)).toBeLessThan(0.003);
  });

  it('holds no grid where the sounds follow none', () => {
    const { truth, tracked } = song(80, () => 0.5, 0.5, 0);
    // Sounds scattered between the beats (a free, rubato line), at random (seeded).
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const s = truth.flatMap((b) => [b + 0.5 * rand(), b + 0.5 * rand()]).sort((a, b) => a - b);
    const map = beatMap({ beats: tracked }, s, { spb: 0.5, offset: 0.5, meter: 4 })!;
    const held = Array.from({ length: 70 }, (_, i) => divisionAt(map, i + 5)).filter((d) => d > 0).length;
    expect(held).toBeLessThan(10);
  });

  it("is at the grid's beat when the tracker followed double or half time, and none at another beat", () => {
    const { truth } = song(100, () => 0.5, 0.5, 0);
    const double = truth.flatMap((b, i) => (i + 1 < truth.length ? [b, b + 0.25] : [b]));
    const m2 = beatMap({ beats: double }, sounds(truth), { spb: 0.5, offset: 0.5, meter: 4 })!;
    expect(Math.abs(m2.secs[1] - m2.secs[0] - 0.5)).toBeLessThan(0.01);
    const half = truth.filter((_, i) => i % 2 === 0);
    const mh = beatMap({ beats: half }, sounds(truth), { spb: 0.5, offset: 0.5, meter: 4 })!;
    expect(Math.abs(mh.secs[11] - mh.secs[10] - 0.5)).toBeLessThan(0.01);
    expect(beatMap({ beats: truth }, sounds(truth), { spb: 0.75, offset: 0.5, meter: 4 })).toBeNull();
  });

  it('says where a moment sits in its beat, and turns beats and seconds into each other', () => {
    const { truth, tracked } = song(40, () => 0.5, 1, 0);
    const map = beatMap({ beats: tracked }, sounds(truth), { spb: 0.5, offset: 1, meter: 4 })!;
    expect(beatPlace(map, truth[10] + 0.01)).toBe('beat');
    expect(beatPlace(map, truth[10] + 0.25)).toBe('half');
    expect(beatPlace(map, truth[10] + 0.125)).toBeNull();
    expect(secAt(map, beatAt(map, 7.3))).toBeCloseTo(7.3, 6);
  });
});

describe('repeated phrases', () => {
  const ev = (sec: number, band: SoundEvent['band'], midi: number) => ({ sec, band, strength: 0.7, midi });

  it("finds a phrase's earlier twin and the moment at the same place in it", () => {
    const { truth, tracked } = song(64, () => 0.5, 0, 0);
    const map = beatMap({ beats: tracked }, sounds(truth), { spb: 0.5, offset: 0, meter: 4 })!;
    // Phrases of 2 bars (8 beats): A B A C A (the chorus A comes back twice; C is new).
    const phrase = (kind: 'A' | 'B' | 'C', start: number) => {
      const out = [];
      for (let k = 0; k < 8; k++) {
        const b = truth[start + k];
        if (kind === 'A') out.push(ev(b, k % 2 ? 'mid' : 'low', 60 + (k % 4)), ev(b + 0.25, 'high', 72));
        else if (kind === 'B') out.push(ev(b + 0.125, 'mid', 65 + k), ev(b + 0.375, 'mid', 63));
        else out.push(ev(b, 'high', 70 - k), ev(b + 0.375, 'low', 40));
      }
      return out;
    };
    const events = [...phrase('A', 0), ...phrase('B', 8), ...phrase('A', 16), ...phrase('C', 24), ...phrase('A', 32)];
    const r = findRepeats(map, events);
    const ph = (beat: number) => Math.floor((beat - map.downbeat) / 8);
    expect(r.of.get(ph(16))).toBe(ph(0));
    expect(r.of.get(ph(32))).toBe(ph(0));
    expect(r.of.has(ph(24))).toBe(false);
    // The moment a quarter beat after beat 18 has its twin a quarter beat after beat 2.
    expect(Math.abs(twinSec(r, truth[18] + 0.125)! - (truth[2] + 0.125))).toBeLessThan(0.005);
    expect(twinSec(r, truth[26])).toBeNull();
  });
});
