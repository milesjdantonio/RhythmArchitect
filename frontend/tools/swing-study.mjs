// Where a saved listen's sounds fall inside the beat, on its beat map: do they sit on 16ths, or
// swing (the off 8th or the off 16ths pushed late, toward the triplet points)? For each study, the
// mix's onsets and the sung syllables in 24 bins a beat, the beat map's divisions, and per part the
// share of sounds nearer a triplet point (1/3, 1/6) than a 16th by more than 15 ms.
//
//   node tools/swing-study.mjs .data/remap/<id>.study.json [...]
//
// Modules load through Vite, as replay-study does. Nothing is written.

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const E = await vite.ssrLoadModule('/src/mapping/ensomi.ts');
  const B = await vite.ssrLoadModule('/src/mapping/beatmap.ts');
  for (const file of files) {
    const study = JSON.parse(readFileSync(file, 'utf8'));
    const s = study.on;
    const on = { bpm: s.bpm, offset: s.offset, meter: s.meter, events: s.events, onGrid: s.onGrid, beats: study.tracked?.beats ?? [], voice: study.voice ?? [], played: study.played ?? [] };
    const map = E.placer(on).placed.map;
    if (!map) { console.log(`${basename(file)}: no beat map`); continue; }
    const div = new Map();
    for (const d of map.division) div.set(d, (div.get(d) ?? 0) + 1);
    const where = (sec) => {
      const b = B.beatAt(map, sec), i = Math.floor(b), f = b - i;
      const len = B.secAt(map, i + 1) - B.secAt(map, i);
      const near16 = Math.abs(f - Math.round(f * 4) / 4) * len, near6 = Math.abs(f - Math.round(f * 6) / 6) * len;
      return { f, near16, near6, len };
    };
    const hist = (secs) => {
      const h = new Array(24).fill(0);
      for (const x of secs) h[Math.min(23, Math.floor(where(x).f * 24))]++;
      const max = Math.max(...h);
      return h.map((v) => ' ▁▂▃▄▅▆▇█'[Math.round((v / max) * 8)]).join('');
    };
    const swungShare = (secs) => secs.length ? secs.filter((x) => { const w = where(x); return w.near6 + 0.015 < w.near16; }).length / secs.length : 0;
    const strong = s.events.filter((e) => e.strength >= 0.3).map((e) => e.sec);
    const parts = {};
    for (const e of s.events) if (e.part) (parts[e.part] ??= []).push(e.sec);
    const sung = (study.voice ?? []).map((v) => v.sec);
    console.log(`\n${basename(file).replace(/\.study\.json$/, '')} (${s.bpm} BPM; divisions ${[...div].map(([d, n]) => `${d}:${Math.round((n / map.division.length) * 100)}%`).join(' ')})`);
    console.log(`  bins: |0     1/4    1/2    3/4   |  (24 a beat; 1/3 at bin 8, 2/3 at 16)`);
    console.log(`  mix  |${hist(strong)}|  nearer a triplet point: ${Math.round(swungShare(strong) * 100)}%`);
    for (const [p, secs] of Object.entries(parts)) console.log(`  ${p.padEnd(5)}|${hist(secs)}|  ${Math.round(swungShare(secs) * 100)}%`);
    if (sung.length) console.log(`  sung |${hist(sung)}|  ${Math.round(swungShare(sung) * 100)}%`);
  }
} finally {
  await vite.close();
}
