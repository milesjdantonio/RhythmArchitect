// The mapper against human charts of real pop songs: the bank's maps (made by listening to the
// songs' videos) against fan-made osu!mania 4K charts of the same songs. No audio is fetched: our
// maps come from the bank (or a remap's dry run), the human charts are chart text from an osu!
// mirror's search and osu! itself (as the app's fan-chart lookup gets them), kept in
// .data/pop-charts/ so a rerun asks nothing again.
//
//   node tools/map-pop.mjs [--songs=<file.json>,...] [--only=<title words>] [--json out.json]
//
// --songs compares candidate maps instead of the bank's (a NewSong or Song JSON each: the remap
// tool's dry runs write them to .data/remap/). For each human chart it finds the shift that lines
// it up with the video (its audio may start earlier or later), then measures, at the difficulty of
// ours nearest its density:
//   F1      the moments that match within ±50 ms (lanes aside); two human charts of one song agree
//           on about two thirds, so this is a guide, not a target
//   rhythm  the gaps between tiles: straight (16ths, 8ths...) or swung / triplet (12ths of a beat
//           that aren't 16ths): a vocal often swings where the drums don't
//   stars   osu!mania star rating (@ensomi/runtime starRating), human and each of ours
//   density, holds, chords, and the lane patterns (patterns.ts)
// A human chart timed at another tempo than the song's (not half or double it) is left out: it
// follows other audio (an edit) or is mistimed, and matches nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { starRating } from '@ensomi/runtime';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { patterns } = await import(pathToFileURL(join(root, 'src/mapping/patterns.ts')).href);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const API = (arg('api') ?? 'https://rhythmarchitect.onrender.com').replace(/\/$/, '');
const cache = join(root, '.data', 'pop-charts');
mkdirSync(cache, { recursive: true });
const UA = 'RythmArchitect/0.1 (private project)';
const D = ['easy', 'medium', 'hard', 'ultra'];
const pct = (x) => `${Math.round(x * 100)}%`;

async function cached(name, get) {
  const file = join(cache, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const text = await get();
  writeFileSync(file, text);
  return text;
}
async function fetchText(url, json) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(json ? { Accept: 'application/json' } : {}) }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.text();
}

// Our maps: the bank's, or the files given.
let songs;
const files = arg('songs');
if (files) songs = files.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')));
else {
  const lib = JSON.parse(await fetchText(`${API}/api/library`, true)).results;
  songs = [];
  for (const s of lib) songs.push(JSON.parse(await fetchText(`${API}/api/songs/${encodeURIComponent(s.id)}`, true)));
}
const only = arg('only')?.toLowerCase();
if (only) songs = songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(only));

/** A song's name without features or brackets, lower case, letters and digits only. */
const bare = (x) => x.toLowerCase().replace(/\((feat|ft)\.?[^)]*\)|\[[^\]]*\]|feat\..*$|ft\..*$/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The 4K human charts of a song (not rate edits), as .osu text. */
async function humanCharts(s) {
  const title = bare(s.title), artist = bare(s.artist).split(' ')[0];
  const q = `${title} ${bare(s.artist)}`;
  const sets = JSON.parse(await cached(`search-${q.replace(/ /g, '_')}.json`, () => fetchText(`https://catboy.best/api/v2/search?${new URLSearchParams({ q, mode: '3', limit: '50' })}`, true)));
  const out = [];
  for (const set of sets) {
    // The same song: its title has ours, its artist our first word.
    if (!bare(set.title).includes(title) || !bare(set.artist).includes(artist)) continue;
    for (const b of set.beatmaps ?? []) {
      if (b.mode !== 'mania' && b.mode_int !== 3 && b.mode !== 3) continue;
      if (Math.round(b.cs) !== 4 || /\d(\.\d+)?x|rate/i.test(b.version)) continue;
      const text = await cached(`${b.id}.osu`, () => fetchText(`https://osu.ppy.sh/osu/${b.id}`).catch(() => fetchText(`https://catboy.best/osu/${b.id}`)));
      out.push({ id: b.id, set: set.id, name: `${set.artist} - ${set.title} [${b.version}] by ${set.creator}`, status: set.status, text });
    }
  }
  return out;
}

/** A mania chart's tiles: seconds into its audio, lane, hold length. */
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

/** A chart's main tempo: its uninherited timing point that covers the most of it (BPM), or null. */
function osuTempo(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === '[TimingPoints]');
  if (at < 0) return null;
  const red = [];
  for (let i = at + 1; i < lines.length && lines[i].trim() && !lines[i].startsWith('['); i++) {
    const f = lines[i].split(',');
    if (Number(f[1]) > 0 && (f[6] === undefined || f[6].trim() === '1')) red.push({ t: Number(f[0]), bpm: 60000 / Number(f[1]) });
  }
  if (!red.length) return null;
  let best = red[0], span = -1;
  red.forEach((r, i) => { const s = (red[i + 1]?.t ?? r.t + 6e5) - r.t; if (s > span) { span = s; best = r; } });
  return best.bpm;
}
/** The chart is timed at the song's tempo (or half or double it), within 0.5%: else it follows other audio (an edit) or is mistimed. */
const sameTempo = (a, b) => [1, 2, 0.5].some((k) => Math.abs(a / (b * k) - 1) < 0.005);

/** Our chart's tiles, as heard on the video (the song's grid, plus its sync). */
function ours(s, d) {
  const spb = 60 / s.bpm, at = (s.offset ?? 0) + (s.source?.offset ?? 0);
  return s.charts[d].notes.map((n) => ({ sec: at + n.t * spb, lane: n.lane, hold: !!n.hold, len: n.hold ? n.len * spb : 0 })).sort((a, b) => a.sec - b.sec);
}

const moments = (t) => { const o = []; for (const x of t) { const l = o[o.length - 1]; if (l && x.sec - l.sec < 0.002) l.n++; else o.push({ sec: x.sec, n: 1 }); } return o; };
function matched(a, b, shift) {
  let i = 0, j = 0; const d = [];
  while (i < a.length && j < b.length) { const x = a[i] + shift - b[j]; if (Math.abs(x) <= 0.05) { d.push(x); i++; j++; } else if (x < 0) i++; else j++; }
  return d;
}
/** The shift (s, added to ours) that lines the human chart up with ours: coarse over ±20 s, then centred. */
function align(a, b) {
  let best = { n: -1, shift: 0 };
  for (let s = -20; s <= 20; s += 0.01) { const n = matched(a, b, s).length; if (n > best.n) best = { n, shift: s }; }
  for (let k = 0; k < 4; k++) { const d = matched(a, b, best.shift).sort((x, y) => x - y); best.shift -= d[d.length >> 1] ?? 0; }
  return best.shift;
}
function compare(a0, b0, shift) {
  const b = moments(b0).map((m) => m.sec);
  const from = b[0] - 1 - shift, to = b[b.length - 1] + 1 - shift;
  const a = moments(a0).map((m) => m.sec).filter((x) => x >= from && x <= to);
  const d = matched(a, b, shift);
  const p = d.length / Math.max(1, a.length), r = d.length / Math.max(1, b.length);
  return { f1: (2 * p * r) / Math.max(1e-9, p + r), p, r, rate: a.length / Math.max(1, to - from) };
}
/** Gaps between moments under a beat apart: straight (a 16th's multiple) or swung (a 12th's that isn't). */
function rhythm(tiles, spb) {
  const m = moments(tiles).map((x) => x.sec);
  let straight = 0, swung = 0, n = 0;
  for (let i = 1; i < m.length; i++) {
    const g = (m[i] - m[i - 1]) / spb;
    if (g > 1.01) continue;
    n++;
    if (Math.abs(g * 4 - Math.round(g * 4)) < 0.1) straight++;
    else if (Math.abs(g * 12 - Math.round(g * 12)) < 0.1) swung++;
  }
  return { straight: straight / Math.max(1, n), swung: swung / Math.max(1, n) };
}
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : 0);
const stars = (tiles, shift = 0) => starRating({
  duration_ms: Math.round((tiles[tiles.length - 1].sec + tiles[tiles.length - 1].len + 1) * 1000),
  objects: tiles.map((t) => ({ lane: t.lane, start_ms: Math.max(0, Math.round((t.sec + shift) * 1000)), ...(t.hold ? { end_ms: Math.round((t.sec + shift + t.len) * 1000) } : {}) })),
});

const rows = [];
for (const s of songs) {
  let charts;
  try { charts = await humanCharts(s); } catch (e) { console.log(`${s.title}: the search failed (${e.message})`); continue; }
  const spb = 60 / s.bpm;
  const ourTiles = Object.fromEntries(D.map((d) => [d, ours(s, d)]));
  const ourStars = {};
  for (const d of D) ourStars[d] = await stars(ourTiles[d], 5);
  console.log(`\n${s.title} - ${s.artist} (${s.bpm} BPM): ours ${D.map((d) => `${d[0].toUpperCase()} ${ourStars[d].toFixed(2)}★ ${(ourTiles[d].length / (ourTiles[d].at(-1).sec - ourTiles[d][0].sec)).toFixed(2)}/s`).join(' · ')}; ${charts.length} human 4K chart(s)`);
  const au = moments(ourTiles.ultra).map((m) => m.sec);
  for (const c of charts) {
    const human = readOsu(c.text);
    if (human.length < 30) continue;
    // (One Dance's human charts at 141 and 92 BPM matched nothing: a mistimed chart and an edit.)
    const tempo = osuTempo(c.text);
    if (tempo && !sameTempo(tempo, s.bpm)) { console.log(`  ${c.name.slice(0, 70)}: timed at ${tempo.toFixed(2)} BPM, not the song's ${s.bpm}: left out`); continue; }
    const shift = align(au, moments(human).map((m) => m.sec));
    const per = Object.fromEntries(D.map((d) => [d, compare(ourTiles[d], human, shift)]));
    const hr = human.length / (human.at(-1).sec - human[0].sec + 2);
    const near = D.reduce((a, d) => (Math.abs(Math.log(per[d].rate / hr)) < Math.abs(Math.log(per[a].rate / hr)) ? d : a), 'easy');
    // The human chart on the video's timeline, for its rhythm and patterns.
    const h = human.map((t) => ({ ...t, sec: t.sec - shift }));
    const hs = await stars(human);
    const rh = rhythm(h, spb), ro = rhythm(ourTiles[near], spb);
    const ph = patterns(h), po = patterns(ourTiles[near]);
    const row = {
      song: s.title, human: c.name, status: c.status, shift, near, f1: per[near].f1, p: per[near].p, r: per[near].r, ultraRecall: per.ultra.r,
      stars: { human: hs, ours: ourStars[near], all: ourStars }, rate: { human: hr, ours: per[near].rate },
      holds: { human: share(human, (t) => t.hold), ours: share(ourTiles[near], (t) => t.hold) },
      chords: { human: share(moments(human), (m) => m.n > 1), ours: share(moments(ourTiles[near]), (m) => m.n > 1) },
      rhythm: { human: rh, ours: ro }, patterns: { human: ph, ours: po },
    };
    rows.push(row);
    console.log(`  ${c.name.slice(0, 70)} (${c.status}): shift ${shift.toFixed(2)} s · human ${hs.toFixed(2)}★ ${hr.toFixed(2)}/s · nearest ours ${near} ${ourStars[near].toFixed(2)}★ ${per[near].rate.toFixed(2)}/s · F1 ${pct(row.f1)} (p ${pct(row.p)} r ${pct(row.r)}) · Ultra has ${pct(row.ultraRecall)}`);
    console.log(`     holds h ${pct(row.holds.human)} o ${pct(row.holds.ours)} · chords h ${pct(row.chords.human)} o ${pct(row.chords.ours)} · straight/swung h ${pct(rh.straight)}/${pct(rh.swung)} o ${pct(ro.straight)}/${pct(ro.swung)} · move h ${ph.move.toFixed(2)} o ${po.move.toFixed(2)} · jacks h ${pct(ph.jacks)} o ${pct(po.jacks)}`);
  }
}
if (rows.length) {
  const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`\n${rows.length} human charts of ${new Set(rows.map((r) => r.song)).size} songs: F1 ${pct(mean((r) => r.f1))} at the nearest difficulty · Ultra has ${pct(mean((r) => r.ultraRecall))} of the human tiles`);
  console.log(`swung gaps: human ${pct(mean((r) => r.rhythm.human.swung))}, ours ${pct(mean((r) => r.rhythm.ours.swung))} · holds: human ${pct(mean((r) => r.holds.human))}, ours ${pct(mean((r) => r.holds.ours))} · chords: human ${pct(mean((r) => r.chords.human))}, ours ${pct(mean((r) => r.chords.ours))}`);
  console.log(`stars: human ${mean((r) => r.stars.human).toFixed(2)}★ against ours at the nearest difficulty ${mean((r) => r.stars.ours).toFixed(2)}★`);
}
const jsonAt = process.argv.indexOf('--json');
if (jsonAt >= 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rows, null, 1));
