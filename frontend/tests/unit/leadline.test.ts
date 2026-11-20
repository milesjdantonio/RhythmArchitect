import { describe, expect, it } from 'vitest';
import type { ChartNote, SoundEvent } from '../../src/api/types';
import { hasParts, leadLine } from '../../src/mapping/leadline';

// 120 BPM (a beat is half a second), beat 0 at 0 s, no beat map: the straight 16ths.
const SPB = 0.5;
const drum = (sec: number): SoundEvent => ({ id: 0, t: sec / SPB, sec, band: 'low', pitched: false, midi: null, note: null, bright: 50, strength: 0.6, len: 0.25, onBeat: true, accent: false, part: 'drums' });
const syl = (sec: number, midi = 64) => ({ sec, len: 0.2, midi, strength: 0.8 });

describe('Easy and Medium as one line a phrase (leadline.ts)', () => {
  // Three 2-bar phrases (4 s each): sung in the first two (the same rhythm: a little off the 16ths,
  // as a singer is), drums only in the third. Drums on every beat throughout.
  const drums = Array.from({ length: 24 }, (_, i) => drum(i * SPB));
  const sung = (from: number) => [0.27, 0.77, 1.26, 1.74, 2.27, 2.76, 3.24, 3.77].map((s, i) => syl(from + s, 60 + (i % 4) * 2));
  const voice = [...sung(0), ...sung(4)];
  const ultra: ChartNote[] = Array.from({ length: 48 }, (_, i) => ({ t: i / 2, lane: i % 4, pitch: 'C5', len: 0.25 }));
  const make = leadLine({ bpm: 120, offset: 0, events: drums, voice, map: null }, ultra);
  const easy = make('easy').notes;
  const secs = (from: number, to: number) => easy.map((n) => n.t * SPB).filter((s) => s >= from && s < to);

  it('needs the parts', () => {
    expect(hasParts(drums)).toBe(true);
    expect(hasParts(drums.map(({ part: _p, ...e }) => e))).toBe(false);
  });

  it('a sung phrase follows the singing, on the grid; an instrumental one, the drums', () => {
    // Every tile on a 16th.
    for (const n of easy) expect(Math.abs(n.t * 4 - Math.round(n.t * 4))).toBeLessThan(1e-6);
    // Sung phrases: tiles on the syllables' 16ths (between the beats), none on the drums' beats.
    for (const s of secs(0, 8)) expect(Math.abs(s / SPB - Math.round(s / SPB))).toBeGreaterThan(0.1);
    expect(secs(0, 4).length).toBeGreaterThan(2);
    // The instrumental phrase: on the beats.
    const inst = secs(8, 12);
    expect(inst.length).toBeGreaterThan(2);
    for (const s of inst) expect(Math.abs(s / SPB - Math.round(s / SPB))).toBeLessThan(1e-6);
  });

  it('a phrase that comes back is charted alike', () => {
    const first = secs(0, 4), again = secs(4, 8).map((s) => s - 4);
    expect(again).toEqual(first);
  });

  it('Medium is busier than Easy, still one line where the lead has enough', () => {
    const medium = make('medium').notes;
    expect(medium.length).toBeGreaterThanOrEqual(easy.length);
    expect(medium.every((n) => Math.abs(n.t * 4 - Math.round(n.t * 4)) < 1e-6)).toBe(true);
  });
});
