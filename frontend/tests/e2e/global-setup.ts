import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// Start every run from a bank holding one mapped song that can be deleted ("Mr. Brightside",
// using a built-in track's audio and map); the mock adds the built-in songs on first load.
// The mock never generates songs.
export default function globalSetup() {
  rmSync('.data/e2e-songs.json', { force: true });
  rmSync('.data/e2e-songs-tracks', { recursive: true, force: true });
  mkdirSync('.data', { recursive: true });
  const t = JSON.parse(readFileSync('mock-server/songs/tracks/the-restless-stacks.json', 'utf8'));
  const song = {
    id: 'e2e-mapped', title: 'Mr. Brightside', artist: 'The Killers', prompt: 'Mr. Brightside by The Killers',
    createdAt: '2026-10-31T00:00:00.000Z', bpm: t.bpm, meter: t.meter, key: t.key, scale: t.scale, mood: t.mood,
    lengthBeats: t.lengthBeats, hues: t.hues, source: t.source, report: t.report,
    patch: { name: 'Glass Bell', oscillator: 'triangle', attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.4, cutoff: 6000, space: 0.3 },
    backing: { bass: ['C2'], drums: '................' },
    charts: t.charts, best: {}, plays: 0, favorite: false,
  };
  writeFileSync('.data/e2e-songs.json', JSON.stringify({ songs: [song] }));
}
