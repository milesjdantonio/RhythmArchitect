// The songs the mock backend starts with:
//   Neon Blueprint       — hand-mapped synth test, built to show every effect.
//   Ink and Fury         — real audio (an organ toccata), mapped by the onset mapper.
//   The Restless Stacks  — real audio (a waltz in 3/4), mapped by the onset mapper.
// The two real tracks were composed by Claude for SchmollCrossword (MIT); see NOTICE.md.
// Their charts come from tools/map-audio.mjs; re-run it after changing the mapper.

import type { Difficulty, Song } from '../api/types';
import { demoSong } from './demo-song';
import inkAndFury from './tracks/ink-and-fury.json';
import restlessStacks from './tracks/the-restless-stacks.json';

type MappedTrack = typeof inkAndFury;

function fromTrack(t: MappedTrack, createdAt: string): Song {
  return {
    id: `builtin-${t.id}`,
    title: t.title,
    artist: t.artist,
    prompt: `${t.title} by ${t.artist}`,
    createdAt,
    bpm: t.bpm,
    meter: t.meter,
    key: t.key,
    scale: t.scale,
    mood: t.mood,
    lengthBeats: t.lengthBeats,
    hues: t.hues as [number, number],
    source: t.source as Song['source'],
    report: t.report as Song['report'],
    // Real audio carries the music; the patch is unused (hits make no sound).
    patch: { name: 'Glass Bell', oscillator: 'triangle', attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.4, cutoff: 6000, space: 0.3 },
    backing: { bass: ['C2'], drums: '................' },
    charts: t.charts as Record<Difficulty, Song['charts'][Difficulty]>,
    best: {},
    plays: 0,
    favorite: false,
    builtIn: true,
  };
}

export function builtInSongs(): Song[] {
  return [
    demoSong(),
    fromTrack(inkAndFury, '2026-10-30T12:02:00.000Z'),
    fromTrack(restlessStacks as MappedTrack, '2026-10-30T12:01:00.000Z'),
  ];
}
