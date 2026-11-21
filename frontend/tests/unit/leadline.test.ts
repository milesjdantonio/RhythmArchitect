import { describe, expect, it } from 'vitest';
import type { SoundEvent } from '../../src/api/types';
import { hasParts, leadLine } from '../../src/mapping/leadline';

// 120 BPM (a beat is half a second), beat 0 at 0 s, no beat map: the straight 16ths.
const SPB = 0.5;
const drum = (sec: number): SoundEvent => ({ id: 0, t: sec / SPB, sec, band: 'low', pitched: false, midi: null, note: null, bright: 50, strength: 0.6, len: 0.25, onBeat: true, accent: false, part: 'drums' });
const syl = (sec: number, midi = 64) => ({ sec, len: 0.2, midi, strength: 0.8 });

describe("every difficulty as the song's own lines (leadline.ts)", () => {
  // Three 2-bar phrases (4 s each): sung in the first two (the same rhythm: a little off the 16ths,
  // as a singer is), drums only in the third. Drums on every beat throughout.
  const drums = Array.from({ length: 24 }, (_, i) => drum(i * SPB));
  const sung = (from: number) => [0.27, 0.77, 1.26, 1.74, 2.27, 2.76, 3.24, 3.77].map((s, i) => syl(from + s, 60 + (i % 4) * 2));
  const voice = [...sung(0), ...sung(4)];

  const make = leadLine({ bpm: 120, offset: 0, events: drums, voice, map: null });
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

  it('Ultra plays every note of its lead: each note of a piano solo; Easy the same rhythm, simpler', () => {
    // A piano solo: sixteen notes an 8th apart (a little off the grid), nothing else playing.
    const piano = Array.from({ length: 16 }, (_, i) => ({ sec: i * 0.25 + 0.012, len: 0.2, midi: 60 + (i % 8), strength: 0.7 }));
    const solo = leadLine({ bpm: 120, offset: 0, events: [], voice: [], played: piano, map: null });
    const ultra = solo('ultra').notes;
    expect(ultra.length).toBe(16);
    expect(ultra.every((n) => Math.abs(n.t * 2 - Math.round(n.t * 2)) < 1e-6)).toBe(true);
    // Easy keeps fewer, and keeps the beats first: the same rhythm, simplified.
    const easyNotes = solo('easy').notes;
    expect(easyNotes.length).toBeLessThan(16);
    const onBeat = easyNotes.filter((n) => Math.abs(n.t - Math.round(n.t)) < 1e-6).length;
    expect(onBeat / easyNotes.length).toBeGreaterThan(0.6);
  });

  it('lanes mirror the tune: the lowest note left, the highest right, the same note the same lane', () => {
    // A tune up and down a phrase, an 8th apart: C E G B G E C E ...
    const tune = [60, 64, 67, 71, 67, 64];
    const played = Array.from({ length: 24 }, (_, i) => ({ sec: i * 0.5, len: 0.2, midi: tune[i % tune.length], strength: 0.7 }));
    const notes = leadLine({ bpm: 120, offset: 0, events: [], voice: [], played, map: null })('ultra').notes.sort((a, b) => a.t - b.t);
    expect(notes.length).toBe(24);
    const laneOf = new Map<number, Set<number>>();
    notes.forEach((n, i) => { const m = tune[i % tune.length]; if (!laneOf.has(m)) laneOf.set(m, new Set()); laneOf.get(m)!.add(n.lane); });
    // Each note keeps to one lane (most of the time), higher notes further right.
    const main = (m: number) => Math.min(...laneOf.get(m)!);
    expect(main(60)).toBeLessThan(main(67));
    expect(main(64)).toBeLessThan(main(71));
    let up = 0, steps = 0;
    for (let i = 1; i < notes.length; i++) {
      const dm = tune[i % tune.length] - tune[(i - 1) % tune.length], dl = notes[i].lane - notes[i - 1].lane;
      if (dl) { steps++; if (Math.sign(dl) === Math.sign(dm)) up++; }
    }
    expect(up / steps).toBeGreaterThan(0.8);
  });

  it('a chord struck on the piano is a chord on Ultra, one tile on Easy', () => {
    const played = Array.from({ length: 8 }, (_, i) => ({ sec: i, len: 0.2, midi: 72, strength: 0.8, also: 60 }));
    const line = leadLine({ bpm: 120, offset: 0, events: [], voice: [], played, map: null });
    const rows = (d: 'easy' | 'ultra') => {
      const by = new Map<number, number[]>();
      for (const n of line(d).notes) by.set(n.t, [...(by.get(n.t) ?? []), n.lane]);
      return [...by.values()];
    };
    const ultra = rows('ultra');
    expect(ultra.length).toBe(8);
    expect(ultra.every((r) => r.length === 2 && r[0] !== r[1])).toBe(true);
    expect(rows('easy').every((r) => r.length === 1)).toBe(true);
  });
});

describe('the song shape in the lead line', () => {
  // Four quiet phrases (a drum each beat), then four busy ones (a drum each 8th): a drop at 16 s.
  const quiet = Array.from({ length: 32 }, (_, i) => drum(i * SPB));
  const busy = Array.from({ length: 64 }, (_, i) => drum(16 + i * SPB / 2));
  const make = leadLine({ bpm: 120, offset: 0, events: [...quiet, ...busy], voice: [], map: null });

  it('Easy leaves a breath before the drop, Ultra keeps every note', () => {
    const easy = make('easy').notes.map((n) => n.t * SPB);
    expect(easy.some((s) => s > 15.5 && s < 15.99)).toBe(false);
    expect(easy.some((s) => Math.abs(s - 16) < 1e-6)).toBe(true);
    const ultra = make('ultra').notes.map((n) => n.t * SPB);
    expect(ultra.some((s) => Math.abs(s - 15.5) < 1e-6)).toBe(true);
  });
});

describe('the breath before a drop keeps the lyric', () => {
  const quiet = Array.from({ length: 32 }, (_, i) => drum(i * SPB));
  const busy = Array.from({ length: 64 }, (_, i) => drum(16 + i * SPB / 2));
  const make = leadLine({ bpm: 120, offset: 0, events: [...quiet, ...busy], voice: [12.25, 12.75, 13.25, 13.75, 14.25, 14.75, 15.25, 15.75].map((s) => syl(s)), map: null });
  it('a syllable sung into the drop stays (Medium: its breath is the last ¾ beat)', () => {
    const medium = make('medium').notes.map((n) => n.t * SPB);
    expect(medium.some((s) => Math.abs(s - 15.75) < 1e-6)).toBe(true);
  });
});

describe('a repeat in a quieter part', () => {
  // The same drum phrase all song (8th notes), loud for 16 s, then quiet for 16 s, then loud again.
  const drums = Array.from({ length: 96 }, (_, i) => drum(i * SPB / 2));
  const barEnergy = Array.from({ length: 24 }, (_, b) => (b >= 8 && b < 16 ? 0.25 : 1));
  const make = leadLine({ bpm: 120, offset: 0, events: drums, voice: [], map: null, barEnergy });
  it('keeps fewer of the copied notes than the loud phrase it repeats', () => {
    const easy = make('easy').notes.map((n) => n.t * SPB);
    const count = (a: number, b: number) => easy.filter((s) => s >= a && s < b).length;
    expect(count(20, 28)).toBeLessThan(count(4, 12));
  });
});

describe('drops land, the last chorus pays off', () => {
  // Quiet (a drum each beat) for 16 s, then busy (each 8th), with a bass note on the drop's beat.
  const quiet = Array.from({ length: 32 }, (_, i) => drum(i * SPB));
  const busy = Array.from({ length: 64 }, (_, i) => drum(16 + i * SPB / 2));
  const bass: SoundEvent = { ...drum(16), part: 'bass', band: 'low', pitched: true, midi: 40, note: 'E2', strength: 0.5 };
  const make = leadLine({ bpm: 120, offset: 0, events: [...quiet, ...busy, bass], voice: [], map: null });
  it('every difficulty has a tile on the drop, Medium and up a chord', () => {
    for (const d of ['easy', 'medium', 'hard', 'ultra'] as const) {
      const at = make(d).notes.filter((n) => Math.abs(n.t * SPB - 16) < 1e-6).length;
      expect(at).toBeGreaterThanOrEqual(d === 'easy' ? 1 : 2);
    }
  });

  it('the last time a busy pattern comes back is its busiest', () => {
    // The same 8th-note phrase every 4 s, loud all the way (busy, but all alike), 8 phrases.
    const drums = Array.from({ length: 64 }, (_, i) => drum(i * SPB / 2));
    // A louder second half makes those phrases busy (scale above 1).
    const barEnergy = Array.from({ length: 16 }, (_, b) => (b >= 8 ? 1 : 0.4));
    const easy = leadLine({ bpm: 120, offset: 0, events: drums, voice: [], map: null, barEnergy })('medium').notes.map((n) => n.t * SPB);
    const count = (a: number) => easy.filter((s) => s >= a && s < a + 4).length;
    expect(count(28)).toBeGreaterThanOrEqual(count(20));
  });
});
