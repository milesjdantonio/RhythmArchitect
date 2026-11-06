import { describe, expect, it } from 'vitest';
import { alignOffset, hitDrift, onsetEnvelope, tileTimes } from '../../src/mapping/sync';

const SR = 22050;

/** A made-up song: plucks (a sharp attack that rings down) at `times` seconds into the audio, over a little noise. */
function render(times: number[], seconds: number, seed = 7): Float32Array {
  const pcm = new Float32Array(Math.ceil(seconds * SR));
  let r = seed;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  for (let i = 0; i < pcm.length; i++) pcm[i] = rand() * 0.01;
  times.forEach((t, k) => {
    const f = 220 * 2 ** ((k * 5) % 12 / 12);
    const a = Math.round(t * SR);
    for (let i = 0; i < SR * 0.25 && a + i < pcm.length; i++) pcm[a + i] += Math.sin((2 * Math.PI * f * i) / SR) * 0.6 * Math.exp(-i / (SR * 0.06));
  });
  return pcm;
}

/** Tiles (seconds from beat 0) at 120 BPM: a real-ish rhythm, not an even grid (16ths, dotted notes, rests). */
function tiles(): number[] {
  const pattern = [0, 0.75, 1, 1.5, 2.25, 3, 3.5, 4, 4.25, 5.5, 6, 6.75, 7, 7.5];
  const out: number[] = [];
  for (let bar = 0; bar < 12; bar++) for (const b of pattern) out.push((bar * 8 + b) * 0.5);
  return out;
}

describe('Map Syncer: tiles against the audio', () => {
  const beat0 = 1.2;
  const times = tiles();
  const env = onsetEnvelope(render(times.map((t) => t + beat0), beat0 + 52), SR);

  it('leaves a map that is already on the music alone', () => {
    const a = alignOffset(times, env, beat0);
    expect(a.trusted).toBe(false);
    expect(Math.abs(a.offset - beat0)).toBeLessThan(0.008);
  });

  it.each([-0.12, -0.04, 0.03, 0.09, 0.2])('finds beat 0 when the saved offset is %s s off', (err) => {
    const a = alignOffset(times, env, beat0 + err);
    expect(a.trusted).toBe(true);
    expect(Math.abs(a.offset - beat0)).toBeLessThan(0.006);
    expect(a.shift).toBeCloseTo(-err, 1);
  });

  it("doesn't move a map on audio that has nothing to do with it", () => {
    const noise = onsetEnvelope(render([], 50), SR);
    expect(alignOffset(times, noise, beat0).trusted).toBe(false);
  });

  it('reads stereo (two channels mixed) like mono', () => {
    const pcm = render(times.map((t) => t + beat0), beat0 + 52);
    const a = alignOffset(times, onsetEnvelope([pcm, pcm], SR), beat0 + 0.05);
    expect(Math.abs(a.offset - beat0)).toBeLessThan(0.006);
  });

  it('takes every tile from every chart once, in seconds', () => {
    const charts = { easy: { notes: [{ t: 0 }, { t: 2 }] }, hard: { notes: [{ t: 0 }, { t: 1 }, { t: 2 }] } };
    expect(tileTimes(charts, 120)).toEqual([0, 0.5, 1]);
  });
});

describe('Map Syncer: tiles against the hits', () => {
  const jitter = (base: number, n: number) => Array.from({ length: n }, (_, i) => base + Math.sin(i * 2.3) * 0.015);

  it('moves a map when hits are steadily late or early', () => {
    expect(hitDrift(jitter(0.045, 40))).toBeCloseTo(0.045, 2);
    expect(hitDrift(jitter(-0.06, 40))).toBeCloseTo(-0.06, 2);
  });

  it('leaves it alone when hits are on time, scattered or too few', () => {
    expect(hitDrift(jitter(0.005, 40))).toBeNull();
    expect(hitDrift(Array.from({ length: 40 }, (_, i) => Math.sin(i * 1.7) * 0.12))).toBeNull();
    expect(hitDrift(jitter(0.05, 10))).toBeNull();
  });

  it('never moves a map further than a little at a time', () => {
    expect(hitDrift(jitter(0.13, 40))).toBeLessThanOrEqual(0.12);
  });
});
