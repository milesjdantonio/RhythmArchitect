// Replay a saved listen through today's mapper, offline, in seconds: what the steps after the
// model work from (a mapping study: `node tools/remap-bank.mjs --only=<id> --study` saves
// .data/remap/<id>.study.json; CLAUDE.md "Mapping studies") charted again with the code as it is
// now, every difficulty at its star rating, then the sound-off check (soundoff.ts) beside the map
// the listen made (its dry run, <id>.json beside the study, when there is one).
//
//   node tools/replay-study.mjs .data/remap/<id>.study.json [...] [--out=<dir>]
//
// --out writes each replayed map as a song file (the dry run's, with the new charts): give them to
// `node tools/map-pop.mjs --songs=<file>` to compare with the fan charts.
// The modules load through Vite (as the app does), so no build is needed. The trained mapper's own
// charts come from the study (its raw charts); nothing is downloaded.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { starRating } from '@ensomi/runtime';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('Give study files: node tools/replay-study.mjs .data/remap/<id>.study.json'); process.exit(1); }
const outDir = arg('out');
if (outDir) mkdirSync(outDir, { recursive: true });

const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const E = await vite.ssrLoadModule('/src/mapping/ensomi.ts');
  const { soundOff, playingFrom, criteria } = await vite.ssrLoadModule('/src/mapping/soundoff.ts');
  const { decodeLevels } = await vite.ssrLoadModule('/src/mapping/levels.ts');
  const rate = async (chart) => starRating(chart);
  const pct = (x) => `${Math.round(x * 100)}%`;
  /** The sound-off report of each chart (as map-pop's soundOffOf: the straight grid's downbeats, the report's sections by label). */
  const lines = async (song, levels) => {
    const spb = 60 / song.bpm, at = song.offset ?? 0, meter = song.meter ?? 4;
    const playing = levels ? playingFrom(decodeLevels(levels)) : () => true;
    const out = [];
    for (const d of ['easy', 'medium', 'hard', 'ultra']) {
      const c = song.charts[d];
      if (!c?.notes.length) continue;
      const tiles = c.notes.map((n) => ({ sec: at + n.t * spb, lane: n.lane, end: at + (n.t + (n.hold ? n.len : 0)) * spb }));
      const seconds = Math.max(...tiles.map((t) => t.end)) + 1;
      const downbeats = [];
      for (let b = 0; at + b * spb < seconds; b += meter) downbeats.push(at + b * spb);
      const list = song.report?.sections ?? [], seen = new Map();
      const sections = list.map((x, i) => {
        const label = x.label.replace(/ \(drop\)$/, '');
        if (!seen.has(label)) seen.set(label, { group: seen.size, n: 0 });
        const g = seen.get(label);
        return { from: at + x.beat * spb, to: at + (list[i + 1]?.beat ?? (seconds - at) / spb) * spb, group: g.group, nth: g.n++ };
      });
      const r = soundOff({ tiles, downbeats, beatOf: (x) => (x - at) / spb, bar: meter * spb, playing, seconds, sections });
      const k = criteria(tiles, d);
      const stars = c.stars ?? await chartStarsOf(c.notes, song);
      out.push(`${d.padEnd(6)} ${stars.toFixed(2)}★ ${r.rate.toFixed(2)}/s · longest gap ${r.longest.toFixed(1)} s @${r.longestAt.toFixed(0)}s · holes ${r.holes} · downbeats ${pct(r.downbeats)} · returns ${r.returns ? `${pct(r.returns.rhythm)} rhythm / ${pct(r.returns.lanes)} lanes` : '-'} · criteria breaks ${k.fast + k.runs + k.jacks + k.trills + k.chords}`);
    }
    return out;
  };
  const chartStarsOf = (notes, g) => E.chartStars(notes, { bpm: g.bpm, offset: g.offset ?? 0 }, rate);
  for (const file of files) {
    const study = JSON.parse(readFileSync(file, 'utf8'));
    const id = basename(file).replace(/\.study\.json$/, '');
    const dryFile = join(dirname(file), `${id}.json`);
    const dry = existsSync(dryFile) ? JSON.parse(readFileSync(dryFile, 'utf8')) : null;
    const was = dry?.song ?? dry;
    const s = study.on;
    const on = { bpm: s.bpm, offset: s.offset, meter: s.meter, events: s.events, onGrid: s.onGrid, beats: study.tracked?.beats ?? [], voice: study.voice ?? [], played: study.played ?? [], levels: study.levels, barEnergy: s.barEnergy };
    const place = E.placer(on);
    let charts, path;
    if (E.canLead(on) && s.gridUsed && s.onGrid && on.beats.length) {
      charts = await place.calibrated([], rate);
      path = "the song's own lines";
    } else if (study.raws?.length) {
      // The trained mapper's charts as it made them, spliced by stretch as trainedCharts does.
      const targets = E.ultraTargets(on.events, on.bpm, study.seconds);
      const ultraOf = (notes) => E.perWindow(place.ultra(notes).notes, on, targets.length);
      const tries = study.raws.map((r) => { const notes = place.chart(r.objects, r.shift); return { star: r.star, notes, counts: ultraOf(notes) }; });
      const notes = tries.length > 1 ? E.splice(tries, targets, on) : tries[0].notes;
      charts = await place.calibrated(place.sung(notes).notes, rate);
      path = `the trained mapper's charts (${study.raws.map((r) => `${r.star}★`).join(' + ')}), thinned`;
    } else { console.log(`${id}: no lines and no raw charts in the study: skipped`); continue; }
    const sections = place.sections?.() ?? s.sections ?? was?.report?.sections ?? [];
    const levels = study.levels ?? was?.levels;
    const now = { bpm: s.bpm, offset: s.offset, meter: s.meter, charts, report: { sections } };
    console.log(`\n${was?.title ?? id}${was?.artist ? ` — ${was.artist}` : ''} (${s.bpm} BPM; ${path})`);
    console.log('  now:');
    for (const line of await lines(now, levels)) console.log(`    ${line}`);
    if (was?.charts) {
      console.log('  the listen made:');
      for (const line of await lines({ ...was, offset: (was.offset ?? 0) + (was.source?.offset ?? 0) }, levels)) console.log(`    ${line}`);
    }
    if (outDir) {
      const song = was ? { ...was, charts, report: { ...was.report, sections } } : { id, title: id, lengthBeats: s.lengthBeats, ...now };
      writeFileSync(join(outDir, `${id}.json`), JSON.stringify(song));
    }
  }
} finally {
  await vite.close();
}
