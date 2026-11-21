import { describe, expect, it } from 'vitest';
import type { SoundEvent } from '../../src/api/types';
import { hasParts, leadLine } from '../../src/mapping/leadline';

// 120 BPM (a beat is half a second), beat 0 at 0 s, no beat map: the straight 16ths.
const SPB = 0.5;
const drum = (sec: number): SoundEvent => ({ id: 0, t: sec / SPB, sec, band: 'low', pitched: false, midi: null, note: null, bright: 50, strength: 0.6, len: 0.25, onBeat: true, accent: false, part: 'drums' });
const syl = (sec: number, midi = 64) => ({ sec, len: 0.2, midi, strength: 0.8 });
/** A chart's tiles without its last hit (every chart ends on a chord: tested on its own). */
const body = <T extends { t: number }>(notes: T[]) => { const end = Math.max(...notes.map((n) => n.t)); return notes.filter((n) => n.t < end - 1e-6); };

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
    const ultra = body(solo('ultra').notes);
    expect(ultra.length).toBe(15);
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
    const notes = body(leadLine({ bpm: 120, offset: 0, events: [], voice: [], played, map: null })('ultra').notes).sort((a, b) => a.t - b.t);
    expect(notes.length).toBe(23);
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
      for (const n of body(line(d).notes)) by.set(n.t, [...(by.get(n.t) ?? []), n.lane]);
      return [...by.values()];
    };
    const ultra = rows('ultra');
    expect(ultra.length).toBe(7);
    expect(ultra.every((r) => r.length === 2 && r[0] !== r[1])).toBe(true);
    expect(rows('easy').every((r) => r.length === 1)).toBe(true);
  });

  it('every chart ends on a chord: its last hit, on both hands', () => {
    for (const d of ['easy', 'medium', 'hard', 'ultra'] as const) {
      const notes = make(d).notes;
      const end = Math.max(...notes.map((n) => n.t));
      const last = notes.filter((n) => Math.abs(n.t - end) < 1e-6);
      expect(last.length).toBe(2);
      expect(last[0].lane < 2).not.toBe(last[1].lane < 2);
    }
  });
});

