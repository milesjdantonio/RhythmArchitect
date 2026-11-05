// "Neon Blueprint": a hand-written test song the mock starts with, so every effect can be
// tried without composing first: perfect/great/good/miss bursts, holds, two-lane chords,
// taps under a held tile (Hard), combo milestones, and the fail screen if you stop playing.
// Original melody in A minor over Am–F–C–G.

import type { Chart, ChartNote, Difficulty, Song } from '../api/types';
import { SCALES, degreeToMidi, midiToName, nameToMidi } from './theory';
import { cuesFromSections } from './cues';

// Melody, one string per bar, 8 eighth-note slots: a pitch, '-' (keeps sounding) or '.' (rest).
const MELODY = [
  'A4 - C5 - E5 - D5 C5', 'A4 - - - F4 - G4 A4', 'G4 - C5 - E5 - G5 -', 'F5 - E5 D5 B4 - - -',
  'A4 - C5 - E5 - A5 -', 'G5 F5 E5 - C5 - A4 -', 'E5 - G5 - C6 - B5 A5', 'B5 - - - - - . .',
  'C6 B5 A5 G5 A5 - F5 -', 'G5 E5 C5 E5 G5 - C6 -', 'B5 A5 G5 F5 G5 - D5 -', 'E5 - - - A5 - - -',
  'A5 G5 E5 G5 A5 G5 E5 C5', 'D5 E5 F5 A5 C6 A5 F5 E5', 'E5 G5 C6 G5 E5 G5 C6 E6', 'D6 - B5 - G5 - D5 -',
  'C5 - E5 - A5 - - -', 'A5 - - - - - - .',
];
const CHORD_TONES = [['A4', 'C5', 'E5'], ['F4', 'A4', 'C5'], ['C5', 'E5', 'G5'], ['G4', 'B4', 'D5']];

// Charts, same layout. A slot holds '.', a lane ("2"), a hold ("2h4" = held for 4 slots) or a
// chord of several joined by '+' ("0+3", "0h4+3h4").
const CHARTS: Record<Difficulty, { lanes: number; bars: string[] }> = {
  easy: {
    lanes: 4,
    bars: [
      '0 . 1 . 3 . . .', '1h3 . . . 0 . . .', '0 . 2 . 3 . . .', '3 . 2 . 0h4 . . .',
      '0 . 1 . 2 . . .', '3 . 2 . 1 . 0 .', '1 . 2 . 3 . . .', '2h6 . . . . . . .',
      '3 . 2 . 2 . 0 .', '2 . 0 . 2 . 3 .', '3 . 1 . 1 . 0 .', '0h3 . . . 3h3 . . .',
      '3 . 1 . 3 . 1 .', '0 . 1 . 3 . 1 .', '0 . 3 . 0 . 3 .', '3 . 2 . 1 . 0 .',
      '0 . 1 . 3h4 . . .', '2h7 . . . . . . .',
    ],
  },
  medium: {
    lanes: 4,
    bars: [
      '0 . 1 . 3 . 2 1', '1h3 . . . 0 . 1 2', '0 . 1 . 2 . 3 .', '3 . 2 1 0h4 . . .',
      '0 . 1 . 2 . 3 .', '3 2 1 . 1 . 0 .', '0 . 1 . 3 . 2 1', '2h6 . . . . . . .',
      '3 2 1 0 1 . 0 .', '2 1 0 1 2 . 3 .', '3 2 1 0 1 . 0 .', '0h3 . . . 3h3 . . .',
      '3 2 0 2 3 2 0 .', '0 1 2 . 3 . 1 0', '0 1 3 . 0 . 3 .', '3 . 2 . 1 . 0 .',
      '0 . 1 . 3h4 . . .', '2h7 . . . . . . .',
    ],
  },
  hard: {
    lanes: 4,
    bars: [
      '0+2 . 1 . 3 . 2 1', '2h4 . 3 . 0 . 1 2', '0 . 1 . 2 . 3 .', '3 . 2 1 0h4+2h4 . . .',
      '0+3 . 1 . 2 . 3 .', '3 2 1 . 2 . 0 .', '1 . 2 . 3 . 2 1', '3h6 . 0 1 2 . . .',
      '3+0 2 1 0 1 . 0 .', '2 1 0 1 2 . 3 .', '3 2 1 0 1 . 0 .', '1h4+3h4 . . . 0 . 2 .',
      '3+0 2 1 2 3 2 1 0', '0 1 2 3 3 2 1 0', '0 1 3 1 0 1 2 3', '3+1 . 2 . 1 . 0 .',
      '0 . 1 . 3h4+1h4 . . .', '2h7+0h7 . . . . . . .',
    ],
  },
};

const MINOR = SCALES.minor;
const A3 = nameToMidi('A3');

/** A diatonic third below a pitch in A minor. */
function thirdBelow(pitch: string): string {
  const midi = nameToMidi(pitch);
  for (let d = 30; d >= -10; d--) {
    if (degreeToMidi(d, MINOR, A3) === midi) return midiToName(degreeToMidi(d - 2, MINOR, A3));
  }
  return midiToName(midi - 3);
}

function buildChart(difficulty: Difficulty): Chart {
  const { lanes, bars } = CHARTS[difficulty];
  const notes: ChartNote[] = [];
  bars.forEach((bar, b) => {
    const melody = MELODY[b].split(' ');
    bar.split(' ').forEach((slot, s) => {
      if (slot === '.') return;
      const t = b * 4 + s * 0.5;
      const parts = slot.split('+');
      parts.forEach((part, k) => {
        const m = /^(\d)(?:h(\d+))?$/.exec(part);
        if (!m) throw new Error(`demo chart: bad slot "${slot}"`);
        const lane = Number(m[1]);
        const holdSlots = m[2] ? Number(m[2]) : 0;
        const tone = melody[s];
        let pitch = /^[A-G]/.test(tone) ? tone : CHORD_TONES[b % 4][lane % 3];
        if (k > 0) pitch = thirdBelow(notes[notes.length - 1].pitch);
        notes.push({ t, lane, pitch, len: holdSlots ? holdSlots * 0.5 : 0.5, ...(holdSlots ? { hold: true } : {}) });
      });
    });
  });
  return { difficulty, lanes, notes };
}

export const DEMO_SONG_ID = 'demo-neon-blueprint';
const DEMO_SECTIONS = [{ label: 'Intro', beat: 0 }, { label: 'Verse', beat: 16 }, { label: 'Chorus', beat: 32 }, { label: 'Drop', beat: 48 }, { label: 'Outro', beat: 64 }];

export function demoSong(): Song {
  return {
    id: DEMO_SONG_ID,
    title: 'Neon Blueprint',
    artist: 'Rythm Architect',
    prompt: 'Test track, hand-mapped so every effect shows up: holds, chords, taps under a hold.',
    createdAt: '2026-10-30T12:00:00.000Z',
    bpm: 116,
    key: 'A',
    scale: 'Minor',
    mood: 'Dark',
    lengthBeats: MELODY.length * 4 + 2,
    hues: [318, 188],
    source: { kind: 'synth' },
    report: {
      mapper: 'Hand-mapped',
      confidence: 1,
      sections: DEMO_SECTIONS,
      cues: cuesFromSections(DEMO_SECTIONS),
      energy: Array.from({ length: 48 }, (_, i) => Math.round((0.45 + 0.5 * Math.min(1, i / 30) * (i > 42 ? 0.6 : 1)) * 100) / 100),
    },
    patch: { name: 'Neon Lead', oscillator: 'fatsawtooth', attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.4, cutoff: 2800, space: 0.35 },
    backing: { bass: ['A2', 'F2', 'C3', 'G2'], drums: 'k.h.s.h.k.h.s.hh' },
    charts: { easy: buildChart('easy'), medium: buildChart('medium'), hard: buildChart('hard') },
    best: {},
    plays: 0,
    favorite: true,
    builtIn: true,
  };
}
