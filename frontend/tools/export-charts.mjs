// Writes the built-in songs' charts as chart files for the Java model (src/java/charts/<name>.chart),
// the format SongWriter reads (src/java/main/SongWriter.java). Run from frontend/ after the built-in
// songs change (and after tools/export-seed.mjs):  node tools/export-charts.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const seed = JSON.parse(readFileSync(join(root, 'backend', 'src', 'main', 'resources', 'seed', 'songs.json'), 'utf8'));
const songs = Array.isArray(seed) ? seed : seed.songs;
const out = join(root, 'src', 'java', 'charts');
mkdirSync(out, { recursive: true });

const num = (x) => String(Math.round(x * 1000) / 1000);
for (const s of songs) {
  const name = s.id.replace(/^(builtin|demo)-/, '');
  const lines = [
    `# ${s.title}: the built-in chart, exported by frontend/tools/export-charts.mjs.`,
    '# Notes are beat:lane[:holdBeats[:letter]] (beats from beat 0, lanes 0-3 = D F J K).',
    `title: ${s.title}`,
    `artist: ${s.artist}`,
    `bpm: ${num(s.bpm)}`,
    `duration: ${num((s.lengthBeats * 60) / s.bpm)}`,
  ];
  for (const d of ['easy', 'medium', 'hard']) {
    const notes = s.charts?.[d]?.notes ?? [];
    const tiles = notes.map((n) => {
      const letter = /^[A-G]/.exec(n.pitch ?? '')?.[0];
      const hold = n.hold ? num(n.len) : '0';
      return letter ? `${num(n.t)}:${n.lane}:${hold}:${letter}` : n.hold ? `${num(n.t)}:${n.lane}:${hold}` : `${num(n.t)}:${n.lane}`;
    });
    lines.push(`${d}: ${tiles.join(' ')}`);
  }
  writeFileSync(join(out, `${name}.chart`), `${lines.join('\n')}\n`);
  console.log(`${name}.chart: ${['easy', 'medium', 'hard'].map((d) => `${d} ${s.charts?.[d]?.notes?.length ?? 0}`).join(', ')}`);
}
