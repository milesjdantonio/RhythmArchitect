import { describe, expect, it } from 'vitest';
import { gridFromBeats, logMel, peaks, resample } from '../../src/mapping/beats';

/** Beats every `spb` s from `start`, a little jittered; downbeats every `meter` beats. */
function track(bpm: number, start: number, count: number, meter = 4, jitter = 0.008) {
  const spb = 60 / bpm;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const beats = Array.from({ length: count }, (_, i) => start + i * spb + rnd() * 2 * jitter);
  return { beats, downbeats: beats.filter((_, i) => i % meter === 0) };
}

describe('the beat grid from tracked beats', () => {
  it('finds the tempo, the meter and a downbeat of a steady groove', () => {
    const g = gridFromBeats(track(104, 0.37, 300))!;
    expect(g.bpm).toBeCloseTo(104, 0);
    expect(g.meter).toBe(4);
    const bar = (60 / 104) * 4;
    // The offset is a downbeat (0.37 s plus whole bars), the earliest at or after 0 s.
    const k = (g.offset - 0.37) / bar;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(0.02);
    expect(g.offset).toBeGreaterThanOrEqual(0);
    expect(g.offset).toBeLessThan(bar);
    expect(g.confidence).toBeGreaterThan(0.9);
  });

  it('keeps the real beat when a passage was tracked at double time', () => {
    const { beats, downbeats } = track(176, 1, 200);
    // A run in the middle where every half beat was taken for a beat.
    const spb = 60 / 176;
    const extra = Array.from({ length: 40 }, (_, i) => 1 + (80 + i) * spb + spb / 2);
    const all = { beats: [...beats, ...extra].sort((a, b) => a - b), downbeats };
    const g = gridFromBeats(all)!;
    expect(g.bpm).toBeCloseTo(176, 0);
  });

  it('hears a waltz in three', () => {
    const g = gridFromBeats(track(170, 0.5, 240, 3))!;
    expect(g.meter).toBe(3);
    expect(g.bpm).toBeCloseTo(170, 0);
  });

  it('reads bars of two as four (the same feel, for the game)', () => {
    expect(gridFromBeats(track(120, 0.2, 200, 2))!.meter).toBe(4);
  });

  it('gives up with too few beats', () => {
    expect(gridFromBeats(track(120, 0, 5))).toBeNull();
  });
});

describe('the tracker\'s input and output', () => {
  it('peaks are the local maxima above 0, a plateau counted once', () => {
    const l = Float32Array.from([-1, 2, -1, -1, -1, -1, 0.5, 0.5, -1, -1, -1, -1, -0.2, -1]);
    expect(peaks(l)).toEqual([1, 6.5]);
  });

  it('the log-mel spectrogram has one frame every 441 samples, plus one', () => {
    const x = Float32Array.from({ length: 22050 }, (_, i) => Math.sin(i * 0.1));
    const fb = new Float32Array(513 * 128).fill(0.001);
    const { data, frames } = logMel(x, fb);
    expect(frames).toBe(1 + Math.floor(22050 / 441));
    expect(data.length).toBe(frames * 128);
    expect(data.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });

  it('resamples to 22050 Hz', () => {
    expect(resample(new Float32Array(24000), 24000).length).toBe(22050);
    const same = new Float32Array(10);
    expect(resample(same, 22050)).toBe(same);
  });
});
