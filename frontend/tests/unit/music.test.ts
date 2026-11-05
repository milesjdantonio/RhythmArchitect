import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Chart } from '../../src/api/types';
import { demoSong } from '../../mock-server/songs/demo-song';
import { chartFor, type MelodyNote } from '../../src/mapping/charts';
import { SCALES } from '../../src/mapping/theory';
import { cuesFor, cuesFromSections } from '../../src/mapping/cues';

function checkChart(chart: Chart) {
  expect(chart.notes.length).toBeGreaterThan(10);
  for (const n of chart.notes) {
    expect(n.lane).toBeGreaterThanOrEqual(0);
    expect(n.lane).toBeLessThan(chart.lanes);
    expect(n.pitch).toMatch(/^[A-G]#?\d$/);
    expect(n.len).toBeGreaterThan(0);
  }
  // No two tiles overlap in one lane (a hold blocks its lane until it ends).
  const byLane = new Map<number, typeof chart.notes>();
  for (const n of chart.notes) byLane.set(n.lane, [...(byLane.get(n.lane) ?? []), n]);
  for (const notes of byLane.values()) {
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1];
      expect(notes[i].t).toBeGreaterThanOrEqual(prev.t + (prev.hold ? prev.len : 0.25) - 1e-6);
    }
  }
}

describe('charts', () => {
  // Two bars of eighths with a long note and a gap of silence, then a bar of 16ths.
  const melody: MelodyNote[] = [
    ...Array.from({ length: 16 }, (_, i) => ({ t: i * 0.5, len: i === 6 ? 3 : 0.5, degree: (i * 3) % 7, midi: 60 + ((i * 3) % 7), strong: i % 2 === 0, accent: i === 0 })),
    ...Array.from({ length: 16 }, (_, i) => ({ t: 16 + i * 0.25, len: 0.25, degree: i % 5, midi: 62 + (i % 5), strong: i % 4 === 0 })),
    { t: 21.37, len: 0.5, degree: 4, midi: 67, strong: false, strength: 0.9 },
  ];
  it("only uses the song's own notes, at their exact times, and never at random", () => {
    for (const d of DIFFICULTIES) {
      const chart = chartFor(melody, d, SCALES.minor, 57, 120);
      for (const n of chart.notes) expect(melody.some((m) => Math.abs(m.t - n.t) < 1e-6), `${d} @${n.t}`).toBe(true);
      // Nothing in the silence between beat 8 and beat 16.
      expect(chart.notes.filter((n) => n.t > 8 && n.t < 16)).toHaveLength(0);
      expect(chartFor(melody, d, SCALES.minor, 57, 120)).toEqual(chart);
    }
    // Hard plays every note, including the one between 16ths.
    expect(new Set(chartFor(melody, 'hard', SCALES.minor, 57, 120).notes.map((n) => n.t)).size).toBe(melody.length);
  });
});

describe('demo song', () => {
  it('parses into valid charts with holds and chords', () => {
    const song = demoSong();
    for (const d of DIFFICULTIES) checkChart(song.charts[d]);
    expect(song.charts.hard.notes.some((n) => n.hold)).toBe(true);
    expect(song.charts.easy.notes.some((n) => n.hold)).toBe(true);
    expect(song.charts.hard.lanes).toBe(4);
    expect(song.charts.easy.lanes).toBe(4);
  });
});

describe('cues', () => {
  it('derives builds, drops and breaks from section labels', () => {
    const cues = cuesFromSections([{ label: 'Intro', beat: 0 }, { label: 'Chorus', beat: 32 }, { label: 'Bridge', beat: 64 }]);
    expect(cues.map((c) => `${c.kind}@${c.beat}`)).toEqual(['build@28', 'drop@32', 'break@64']);
  });

  it("prefers the mapper's own cues", () => {
    const own = [{ beat: 8, kind: 'flash' as const }];
    expect(cuesFor({ mapper: 'x', confidence: 1, sections: [{ label: 'Chorus', beat: 16 }], energy: [], cues: own })).toBe(own);
  });
});
