// The mapper against human charts: Creative Commons songs with human-made osu!mania 4K charts
// (fetched by tools/fetch-cc-sets.py into a folder outside the repo: their audio is never kept in
// git). Each song is mapped the way the game does (lab/map-bench.ts, in a headless browser), and
// every difficulty is compared with the human charts:
//
//   F1      how well our tiles' moments match the human chart's, within ±50 ms (lanes aside: a
//           mirrored chart is as good), after the one shift that lines the two up best (fan
//           charts carry their own offset; reported)
//   recall  how much of the human chart Ultra has
//   density tiles a second against the human chart's; holds and chords, the same
//
// Each human chart is matched with the difficulty nearest its density.
//
//   node tools/map-human.mjs <sets folder> [--only=setId,setId] [--json out.json]

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withBrowser } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir || !existsSync(join(dir, 'index.json'))) {
  console.error('Usage: node tools/map-human.mjs <folder from tools/fetch-cc-sets.py> [--json out.json]');
  process.exit(1);
}
const jsonAt = args.indexOf('--json');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',').map(Number);
const sets = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).filter((s) => !only || only.includes(s.id));
const D = ['easy', 'medium', 'hard', 'ultra'];
const TOL = 0.05;

/** A mania chart's tiles: seconds into the audio, lane, hold. */
function readOsu(text) {
  const tiles = [];
  let on = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[')) { on = line.trim() === '[HitObjects]'; continue; }
    if (!on || !line.trim()) continue;
    const f = line.split(',');
    const x = Number(f[0]), ms = Number(f[2]), type = Number(f[3]);
    if (!Number.isFinite(ms)) continue;
    const hold = (type & 128) !== 0;
    const end = hold ? Number((f[5] ?? '').split(':')[0]) : ms;
    tiles.push({ sec: ms / 1000, lane: Math.min(3, Math.floor((x * 4) / 512)), hold, len: hold ? (end - ms) / 1000 : 0 });
  }
  return tiles.sort((a, b) => a.sec - b.sec);
}

/** A chart's moments (tiles within 2 ms of each other are one). */
function moments(tiles) {
  const out = [];
  for (const t of tiles) {
    const last = out[out.length - 1];
    if (last && t.sec - last.sec < 0.002) last.n++; else out.push({ sec: t.sec, n: 1 });
  }
  return out;
}

/** Matched moments one to one within TOL, `ours` moved by `shift`. */
function matches(ours, theirs, shift) {
  let i = 0, j = 0, hits = 0;
  while (i < ours.length && j < theirs.length) {
    const d = ours[i] + shift - theirs[j];
    if (Math.abs(d) <= TOL) { hits++; i++; j++; } else if (d < 0) i++; else j++;
  }
  return hits;
}

function compare(ours, human, span) {
  const a = moments(ours).map((m) => m.sec), b = moments(human).map((m) => m.sec);
  // Only where the human chart has tiles (it may start late or stop early).
  const from = b[0] - 1, to = b[b.length - 1] + 1;
  const a2 = a.filter((s) => s >= from && s <= to);
  let best = { hits: -1, shift: 0 };
  for (let s = -0.08; s <= 0.0801; s += 0.005) {
    const h = matches(a2, b, s);
    if (h > best.hits) best = { hits: h, shift: s };
  }
  const p = best.hits / Math.max(1, a2.length), r = best.hits / Math.max(1, b.length);
  const len = Math.max(1, to - from);
  return { f1: (2 * p * r) / Math.max(1e-9, p + r), p, r, shift: best.shift, rate: ours.filter((t) => t.sec >= from && t.sec <= to).length / len, span: len };
}

const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0);
const chordShare = (tiles) => { const m = moments(tiles); return share(m, (x) => x.n > 1); };
const pct = (x) => `${Math.round(x * 100)}%`;

const port = 5195;
const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const rows = [];
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    // The songs' audio, from the folder (never copied into the app).
    await page.route('**/cc-bench/**', (route) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/cc-bench\//, ''));
      const file = join(dir, rel);
      if (!rel.split('/').every((p) => p && p !== '..') || !existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, body: readFileSync(file), contentType: 'audio/mpeg' });
    });
    await page.goto(`http://localhost:${port}/lab/rive-lab.html?file=logo`);
    const once = (u, t) => page.evaluate(async ([u, t]) => (await import('/lab/map-bench.ts')).benchAudio(u, t), [u, t]);
    const map = async (u, t) => { try { return await once(u, t); } catch (e) { if (!/context was destroyed|navigation/i.test(String(e))) throw e; await page.goto(`http://localhost:${port}/lab/rive-lab.html?file=logo`); return once(u, t); } };
    for (const s of sets) {
      let ours;
      try { ours = await map(`/cc-bench/${s.id}/${s.audio}`, s.title); } catch (e) { console.log(`${s.title}: failed (${String(e).slice(0, 120)})`); continue; }
      for (const c of s.charts) {
        const human = readOsu(readFileSync(join(dir, String(s.id), c.file), 'utf8'));
        if (human.length < 30) continue;
        const per = Object.fromEntries(D.map((d) => [d, compare(ours.charts[d], human)]));
        const humanRate = human.length / per.ultra.span;
        // The difficulty nearest the human chart's density.
        const near = D.reduce((a, d) => (Math.abs(Math.log(per[d].rate / humanRate)) < Math.abs(Math.log(per[a].rate / humanRate)) ? d : a), 'easy');
        const row = {
          song: `${s.artist} - ${s.title}`, chart: c.version, license: s.license, read: ours.read, tracker: ours.tracker, model: ours.model, rawLong: ours.rawLong,
          human: { rate: humanRate, holds: share(human, (t) => t.hold), chords: chordShare(human) },
          near, f1: per[near].f1, nearRate: per[near].rate, ultraRecall: per.ultra.r, shift: per[near].shift,
          ours: Object.fromEntries(D.map((d) => [d, { f1: per[d].f1, rate: per[d].rate, holds: share(ours.charts[d], (t) => t.hold), chords: chordShare(ours.charts[d]) }])),
        };
        rows.push(row);
        console.log(`${row.song} [${c.version}] ${ours.read} BPM (tracker ${ours.tracker ?? '-'}, model ${ours.model ?? '-'}) · human ${humanRate.toFixed(2)}/s holds ${pct(row.human.holds)} chords ${pct(row.human.chords)} · nearest ${near} ${row.nearRate.toFixed(2)}/s F1 ${pct(row.f1)} (shift ${Math.round(row.shift * 1000)} ms) · Ultra has ${pct(row.ultraRecall)} of it · F1 ${D.map((d) => `${d[0].toUpperCase()} ${pct(per[d].f1)}`).join(' ')} · our holds ${D.map((d) => pct(row.ours[d].holds)).join('/')} (the model wrote ${pct(ours.rawLong ?? 0)} long notes)`);
      }
    }
  }, { maxSeconds: 3600 });
} finally {
  await server.close();
}
if (rows.length) {
  const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`\n${rows.length} human charts, ${new Set(rows.map((r) => r.song)).size} songs`);
  console.log(`F1 at the nearest difficulty: mean ${pct(mean((r) => r.f1))} · Ultra has ${pct(mean((r) => r.ultraRecall))} of the human tiles`);
  console.log(`density: ours ${mean((r) => r.nearRate).toFixed(2)}/s at the nearest difficulty vs human ${mean((r) => r.human.rate).toFixed(2)}/s`);
  console.log(`holds: human ${pct(mean((r) => r.human.holds))} vs ours ${D.map((d) => `${d} ${pct(mean((r) => r.ours[d].holds))}`).join(', ')}`);
  console.log(`chords: human ${pct(mean((r) => r.human.chords))} vs ours ${D.map((d) => `${d} ${pct(mean((r) => r.ours[d].chords))}`).join(', ')}`);
}
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(rows, null, 1));
