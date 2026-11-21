import { describe, expect, it } from 'vitest';
import type { ChartNote, SoundEvent } from '../../src/api/types';
import { noteName, syllableAt, syllables } from '../../src/mapping/voice';
import { withSyllables, type Placing } from '../../src/mapping/ensomi';
import { thinChart } from '../../src/mapping/thin';

const note = (sec: number, len = 0.2, amp = 0.6, midi = 64) => ({ sec, len, midi, amp, onset: 0.8 });

describe('the singing (voice.ts)', () => {
  it("finds syllables: notes' starts, merged within 80 ms, faint ones dropped", () => {
    const s = syllables([note(1), note(1.05, 0.4, 0.5, 67), note(1.5, 0.2, 0.2), note(2)]);
    expect(s.map((x) => x.sec)).toEqual([1, 2]);
    // The merged one keeps the longer note's pitch and length.
    expect(s[0]).toMatchObject({ len: 0.4, midi: 67 });
  });

  it('keeps a chord struck: another of its notes beside the longest, when they are 3 semitones or more apart', () => {
    const s = syllables([note(1, 0.3, 0.8, 72), note(1.02, 0.2, 0.8, 60), note(2, 0.3, 0.8, 72), note(2.02, 0.2, 0.8, 73)]);
    expect(s[0]).toMatchObject({ midi: 72, also: 60 });
    expect(s[1].also).toBeUndefined(); // a semitone: bleed or a slide, not a chord
  });

  it("counts a syllable only where the vocal carries a real share of the song's sound", () => {
    const sr = 1000;
    const mix = new Float32Array(3 * sr).fill(0.5);
    const vocal = new Float32Array(3 * sr);
    vocal.fill(0.4, 1000, 1100); // sung at 1 s; at 2 s the vocal stem is near-silent (bleed)
    vocal.fill(0.01, 2000, 2100);
    expect(syllables([note(1), note(2)], { vocal, mix, sr }).map((x) => x.sec)).toEqual([1]);
  });

  it('names notes and finds the syllable nearest a moment', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    const s = syllables([note(1), note(2)]);
    expect(syllableAt(s, 1.03, 0.05)?.sec).toBe(1);
    expect(syllableAt(s, 1.5, 0.05)).toBeUndefined();
  });
});

describe('tiles on the singing', () => {
  // 120 BPM, beat 0 at 0 s: a tile on every beat (every half second).
  // A sound under every beat but the one at 2 s.
  const sound = (sec: number) => ({ id: 0, t: sec * 2, sec, band: 'low', pitched: false, midi: null, note: null, bright: 60, strength: 0.6, len: 0.25, onBeat: true, accent: false }) as SoundEvent;
  const on = (voice: ReturnType<typeof syllables>): Placing => ({ bpm: 120, offset: 0, events: Array.from({ length: 16 }, (_, i) => sound(i * 0.5)).filter((e) => e.sec !== 2), onGrid: true, voice });
  const beats: ChartNote[] = Array.from({ length: 16 }, (_, i) => ({ t: i, lane: i % 4, pitch: 'C5', len: 0.25 }));

  it('adds a tile on each sung syllable without one, keeps the rest, never crowds a tile', () => {
    // A tile off the grid on no sound (2.03 s), and one on a sound (2.53 s).
    const chart = [...beats.filter((n) => n.t !== 4 && n.t !== 5), { t: 4.06, lane: 0, pitch: 'C5', len: 0.25 }, { t: 5.06, lane: 1, pitch: 'C5', len: 0.25 }];
    const placing = on(syllables([note(1.02), note(1.27), note(1.97), note(2.47), note(3.73, 0.5)]));
    placing.events.push(sound(2.53));
    const out = withSyllables(chart, placing, null);
    const secs = out.notes.map((n) => n.t * 0.5);
    // Each syllable's tile goes on the grid's nearest 16th. 1.02 has a tile (1.0); 1.27 gets one at
    // 1.25; 1.97 (grid 2.0) is crowded by the tile at 2.03, on no sound: it moves onto 2.0;
    // 2.47 (grid 2.5) is crowded by the tile at 2.53, on a sound of its own: it stays; 3.73 gets one
    // at 3.75, a hold (sung long).
    expect(secs).toContain(1.25);
    expect(secs).toContain(2);
    expect(secs).not.toContain(2.03);
    expect(secs).toContain(2.53);
    expect(secs).not.toContain(2.5);
    expect(secs).toContain(3.75);
    expect(out.notes.find((n) => n.t === 7.5)).toMatchObject({ hold: true, len: 1 });
    expect(out.note).toMatch(/5 sung syllables heard .*1 had a tile, 2 added, 1 moved onto them/);
    // The chart given is left as it was.
    expect(beats.find((n) => n.t === 4)).toBeDefined();
    // Without the voice: the chart as it was.
    expect(withSyllables(beats, on([]), null).notes).toBe(beats);
  });

  it('thinning keeps the sung rows over louder unsung ones', () => {
    // Two rows a quarter-second apart, only one fits; the first is on a syllable.
    const two = [{ t: 0, lane: 0, pitch: 'C5', len: 0.25 }, { t: 0.5, lane: 1, pitch: 'C5', len: 0.25 }];
    const ev = (sec: number, strength: number) => ({ id: 0, t: sec / 0.5, sec, band: 'low', pitched: false, midi: null, note: null, bright: 60, strength, len: 0.25, onBeat: true, accent: false }) as SoundEvent;
    const opts = { spb: 0.5, offset: 0, onGrid: false, rate: 10, floor: 0, minGap: 0.5, share: 1, maxChord: 1, chords: 1, holdsAlone: true, minHold: [0, 0] as [number, number], events: [ev(0, 0.3), ev(0.25, 0.7)] };
    expect(thinChart(two, opts)).toEqual([two[1]]);
    expect(thinChart(two, { ...opts, sung: (t: number) => (t === 0 ? 0.8 : 0) })).toEqual([two[0]]);
  });
});
