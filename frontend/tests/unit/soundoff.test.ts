import { describe, expect, it } from 'vitest';
import { CRITERIA_BEAT, criteria, playingFrom, soundOff } from '../../src/mapping/soundoff';
import { onAttack } from '../../src/mapping/leadline';

const bar = 2; // 120 BPM, 4/4
const downbeats = Array.from({ length: 30 }, (_, i) => i * bar);
const base = { downbeats, beatOf: (s: number) => s * 2, bar, playing: () => true, seconds: 60 };
const tap = (sec: number, lane = 0) => ({ sec, lane, end: sec });

describe('soundOff', () => {
  it('finds the longest stretch with no tile while the song plays, and the holes of two bars', () => {
    const tiles = [...Array.from({ length: 20 }, (_, i) => tap(i * 0.5)), ...Array.from({ length: 20 }, (_, i) => tap(20 + i * 0.5))];
    const r = soundOff({ ...base, tiles });
    expect(r.longest).toBeGreaterThan(40 - 20 - 9.5 - 0.2); // the end of the song (39.5 → 60) is the longest
    expect(r.holes).toBe(2);
  });
  it("doesn't count silence as a gap", () => {
    const r = soundOff({ ...base, tiles: [tap(0), tap(30)], seconds: 30.5, playing: (s) => s < 1 || s > 29.5 });
    expect(r.holes).toBe(0);
  });
  it('a hold covers its length', () => {
    const r = soundOff({ ...base, seconds: 10, tiles: [{ sec: 0, lane: 0, end: 9.9 }] });
    expect(r.longest).toBeLessThan(0.3);
  });
  it('counts downbeats with a tile', () => {
    const tiles = downbeats.filter((_, i) => i % 2 === 0).map((d) => tap(d + 0.03));
    expect(soundOff({ ...base, tiles }).downbeats).toBeCloseTo(0.5, 1);
  });
  it("compares a section's return with its first time, rhythm and lanes", () => {
    const first = [tap(0, 0), tap(1, 1), tap(2, 2), tap(3, 3)];
    const back = [tap(10, 0), tap(11, 1), tap(12, 3), tap(13.25, 3)];
    const r = soundOff({ ...base, tiles: [...first, ...back], sections: [{ from: 0, to: 8, group: 0, nth: 0 }, { from: 10, to: 18, group: 0, nth: 1 }] });
    expect(r.returns?.n).toBe(1);
    expect(r.returns!.rhythm).toBeCloseTo(3 / 5, 2);
    expect(r.returns!.lanes).toBeCloseTo(2 / 3, 2);
  });
});

describe('playingFrom', () => {
  it('is false where the song is quiet against its median, and past its end', () => {
    const n = 100, loud = new Uint8Array(n).fill(100);
    for (let i = 40; i < 60; i++) loud[i] = 2;
    const playing = playingFrom({ rate: 10, bass: loud, mid: loud, high: loud });
    expect(playing(1)).toBe(true);
    expect(playing(5)).toBe(false);
    expect(playing(20)).toBe(false);
  });
});

describe('onAttack', () => {
  const spb = 0.5;
  it("moves a syllable onto the mix's onset just before it, the vocals' first", () => {
    const at = onAttack([{ sec: 1.0, part: 'drums' }, { sec: 1.03, part: 'vocals' }, { sec: 2.0, part: 'drums' }], spb);
    expect(at(1.09)).toBe(1.03);
    expect(at(2.06)).toBe(2.0);
  });
  it('not onto the 16th before, nor one long after; none there is null', () => {
    const at = onAttack([{ sec: 1.0, part: 'vocals' }], spb);
    expect(at(1.12)).toBeNull(); // 120 ms: past 0.85 of a 16th (106 ms) at 120 BPM
    expect(at(0.95)).toBeNull(); // the onset 50 ms after
    expect(at(0.98)).toBe(1.0);
  });
});

describe('criteria (osu!mania ranking criteria, at about 180 BPM)', () => {
  const B = CRITERIA_BEAT;
  it("counts Easy's runs past five half beats and its fast pairs", () => {
    const run = Array.from({ length: 8 }, (_, i) => tap(i * (B / 2)));
    expect(criteria(run, 'easy').runs).toBe(1);
    expect(criteria([tap(0), tap(B / 4), tap(B / 2)], 'easy').fast).toBe(1);
    expect(criteria([tap(0), tap(B), tap(2 * B)], 'easy')).toMatchObject({ fast: 0, runs: 0 });
  });
  it("counts Normal's quarter-beat jacks and big chords", () => {
    expect(criteria([tap(0, 1), tap(B / 4, 1)], 'medium').jacks).toBe(1);
    expect(criteria([tap(0, 0), tap(0, 1), tap(0, 2)], 'medium').chords).toBe(1);
    expect(criteria([tap(0, 0), tap(0, 1), tap(0, 2)], 'hard').chords).toBe(0);
  });
  it("counts Hard's trills past nine notes", () => {
    const trill = Array.from({ length: 12 }, (_, i) => tap(i * (B / 2), i % 2));
    expect(criteria(trill, 'hard').trills).toBe(1);
  });
});
