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

describe('the map report says what the beat tracker did', () => {
  // Four seconds of clicks at 120 BPM.
  const sr = 22050;
  const x = new Float32Array(sr * 8);
  for (let b = 0; b < 16; b++) for (let i = 0; i < 200; i++) x[Math.floor(b * 0.5 * sr) + i] = Math.sin(i * 0.3) * (1 - i / 200);

  it('used when its beat is steady', async () => {
    const { automap } = await import('../../src/mapping/automap');
    const r = automap(x.slice(), sr, { grid: { bpm: 120, offset: 0, meter: 4, confidence: 0.9, fit: 0.95 } });
    expect(r.report.beat).toMatch(/120 BPM, 4\/4, steady 90%, one straight grid 95% \(used; own estimate was/);
    expect(r.bpm).toBe(120);
    expect(r.onBeatGrid).toBe(true);
  });

  it('used when its beat is steady but drifts off one straight grid, which the tiles then don\'t lean on', async () => {
    const { automap } = await import('../../src/mapping/automap');
    // A long song at 200 BPM whose beats drift: the tempo is right, one straight grid explains little.
    const r = automap(x.slice(), sr, { grid: { bpm: 199.87, offset: 0, meter: 4, confidence: 0.92, fit: 0.16 } });
    expect(r.bpm).toBe(199.87);
    expect(r.report.beat).toMatch(/steady 92%, one straight grid 16% \(used/);
    expect(r.onBeatGrid).toBe(false);
  });

  it('not used, with why, when it is unsteady, 3:2 off a drifting grid, or failed', async () => {
    const { automap, gridRefusal } = await import('../../src/mapping/automap');
    expect(automap(x.slice(), sr, { grid: { bpm: 90, offset: 0, meter: 4, confidence: 0.3 } }).report.beat).toMatch(/not used: its beat is steady for only 30% of the song \(needs 50%\); own estimate/);
    expect(automap(x.slice(), sr, { grid: null }).report.beat).toMatch(/no steady beat/);
    expect(automap(x.slice(), sr, { gridError: 'beat model: 404' }).report.beat).toMatch(/failed \(beat model: 404\)/);
    expect(automap(x.slice(), sr).report.beat).toBeUndefined();
    // The swing/triplet trap: 197 BPM against an onset estimate of 133, its beats off one grid.
    expect(gridRefusal({ bpm: 197.13, confidence: 0.75, fit: 0.07 }, 133)).toMatch(/3:2/);
    // 3:2 apart but its beats hold one grid: trusted. And 200 against 121 isn't 3:2: trusted.
    expect(gridRefusal({ bpm: 180, confidence: 0.9, fit: 0.9 }, 120)).toBeNull();
    expect(gridRefusal({ bpm: 199.87, confidence: 0.92, fit: 0.16 }, 120.97)).toBeNull();
  });
});

describe('the steady score holds where one straight grid loses phase', () => {
  it('a long song whose tempo drifts a little is still steady at the right tempo', () => {
    // 1400 beats at 200 BPM, speeding up by 0.5% over the song.
    const beats: number[] = [];
    let t = 0.5;
    for (let i = 0; i < 1400; i++) { beats.push(t); t += (60 / 200) * (1 - 0.005 * (i / 1400)); }
    const g = gridFromBeats({ beats, downbeats: beats.filter((_, i) => i % 4 === 0) })!;
    expect(g.bpm).toBeGreaterThan(198);
    expect(g.bpm).toBeLessThan(202);
    expect(g.confidence).toBeGreaterThan(0.9);
    expect(g.fit!).toBeLessThan(g.confidence);
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
