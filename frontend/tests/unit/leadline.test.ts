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
    // Sung phrases: on a drum's beat only where a bar's skeleton needs it (Easy: beats 1 and 3,
    // the drum there, not the syllable half a beat ahead of it: round 13, a beat with a sound on it
    // keeps its tile), the singing between them.
    const offBeat = secs(0, 8).filter((s) => Math.abs(s / SPB - Math.round(s / SPB)) > 0.1);
    const onBeat = secs(0, 8).filter((s) => Math.abs(s / SPB - Math.round(s / SPB)) <= 0.1);
    expect(offBeat.length).toBeGreaterThan(0);
    for (const s of onBeat) expect(Math.round(s / SPB) % 2).toBe(0);
    for (let b = 0; b < 16; b += 2) expect(onBeat.some((s) => Math.abs(s / SPB - b) < 0.1)).toBe(true);
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

  it('an instrument running evenly under a syllable or two leads its phrase, not the voice', () => {
    // Sung phrases either side (8 syllables each), and between them one syllable over a piano
    // running 8ths: the run is the line there, kept whole on Ultra (round 14).
    // The run's phrase is the song's quietest (no drums under it), as a break before a drop is.
    const voice2 = [...sung(0), syl(4.27), ...sung(8), ...sung(12), ...sung(16)];
    const loud = Array.from({ length: 40 }, (_, i) => drum(i * SPB)).filter((e) => e.sec < 4 || e.sec >= 8);
    const run = Array.from({ length: 16 }, (_, i) => ({ sec: 4 + i * 0.25, len: 0.2, midi: 60 + (i % 4) * 3, strength: 0.3 }));
    const line = leadLine({ bpm: 120, offset: 0, events: loud, voice: voice2, played: run, map: null });
    const ultra = line('ultra').notes.map((n) => n.t * SPB).filter((s) => s >= 4 && s < 8 - 1e-6);
    for (const r of run) expect(ultra.some((s) => Math.abs(s - r.sec) < 0.01)).toBe(true);
    // Medium keeps the run's beats and 8ths evenly: every 8th of the phrase's run has a tile or
    // every beat does, nothing in between.
    const medium = line('medium').notes.map((n) => n.t * SPB).filter((s) => s >= 4 && s < 8 - 1e-6);
    expect(medium.every((s) => Math.abs(s * 4 - Math.round(s * 4)) < 1e-6)).toBe(true);
    expect(medium.length).toBeGreaterThanOrEqual(8);
  });

  it('notes heard in the silence after the song are not charted', () => {
    // A piano and drums for 8 s, then the mix silent; Basic Pitch still "hears" notes at 10-14 s.
    const rate = 30, len = 16 * rate;
    const level = (sec: number) => (sec < 8 ? 120 : 0);
    const band = () => Uint8Array.from({ length: len }, (_, i) => level(i / rate));
    const levels = { rate, bass: band(), mid: band(), high: band() };
    const piano = Array.from({ length: 16 }, (_, i) => ({ sec: i * 0.5, len: 0.3, midi: 60 + (i % 5), strength: 0.7 }));
    const ghost = Array.from({ length: 8 }, (_, i) => ({ sec: 10 + i * 0.5, len: 0.3, midi: 64, strength: 0.7 }));
    const line = leadLine({ bpm: 120, offset: 0, events: drums.filter((e) => e.sec < 8), voice: [], played: [...piano, ...ghost], map: null, levels });
    for (const d of ['easy', 'medium', 'hard', 'ultra'] as const) {
      const secs = line(d).notes.map((n) => n.t * SPB);
      expect(Math.max(...secs)).toBeLessThan(9);
    }
  });

  it("an even run doesn't skip a slot the mix strikes on (Medium, Hard, Ultra)", () => {
    // Sung 8ths for 16 s over drums on every 8th, some weak: thinning may leave a weak one out of a
    // run, and the run keeps going over it.
    const voice3 = Array.from({ length: 32 }, (_, i) => syl(i * 0.5 + 0.004, 60 + ((i * 5) % 9)));
    const kit = Array.from({ length: 64 }, (_, i) => ({ ...drum(i * 0.25), strength: i % 2 ? 0.2 + ((i * 7) % 5) * 0.05 : 0.6 }));
    const line = leadLine({ bpm: 120, offset: 0, events: kit, voice: voice3, map: null });
    const struck = (sec: number) => kit.some((e) => Math.abs(e.sec - sec) < 0.03);
    for (const d of ['medium', 'hard', 'ultra'] as const) {
      const b = [...new Set(line(d).notes.map((n) => Math.round(n.t * 1e4) / 1e4))].sort((x, y) => x - y);
      for (let i = 2; i + 2 < b.length; i++) {
        const G = b[i] - b[i - 1];
        if (G > 1 + 1e-6 || Math.abs(b[i - 1] - b[i - 2] - G) > 0.01 || Math.abs(b[i + 2] - b[i + 1] - G) > 0.01) continue;
        const k = Math.round((b[i + 1] - b[i]) / G);
        if (k < 2 || k > 3 || Math.abs(b[i + 1] - b[i] - k * G) > 0.01) continue;
        for (let j = 1; j < k; j++) expect(struck((b[i] + j * G) * SPB), `${d}: a run skips ${((b[i] + j * G) * SPB).toFixed(2)} s`).toBe(false);
      }
    }
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

