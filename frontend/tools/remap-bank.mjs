// Maps the bank's YouTube songs again with today's mapper, from the same videos, the way a player
// would: Generate beatmap → Listen and map in a real browser window (tab capture needs one; the
// song plays once, not out loud), the trained mapper charting it.
//
//   node tools/remap-bank.mjs [--api=https://rhythmarchitect.onrender.com] [--only=<id>,<id>] [--apply] [--study]
//
// Each new map is lined up with the old one first (lineUp): a listen's timing against the video
// comes out tens of milliseconds different from one listen to the next (Nov 20: three listens of
// One Dance landed 0, 46 and 70 ms late of the map before them), and the old map is the better
// reference (its offset may also have been moved by players' runs: syncer.ts learnFromRun).
//
// Without --apply it only listens and maps, saving each new song (the NewSong the page sent) to
// .data/remap/<old id>.json. With --apply each new map is added to the bank (POST /api/songs),
// then the old one is deleted (its best scores and plays go with it: the charts changed). A map the
// trained mapper didn't chart (it fell back to the onset mapper) is kept but never applied.
// Fan charts (source.chart "fan") are human-made and left alone unless named in --only. The search goes through the bank's
// backend (its YouTube key; about 1% of a day's quota per song), filtered to the song's own video.
// Its own dev server (port 5197) runs with a throwaway song store; .data/songs.json is never touched.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withBrowser } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const API = (arg('api') ?? 'https://rhythmarchitect.onrender.com').replace(/\/$/, '');
const only = arg('only')?.split(',');
const apply = process.argv.includes('--apply');
// --study: each listen also saves what the steps after the model worked from (the model's raw
// charts, the sounds, the beats, the notes heard; never the audio) to .data/remap/<id>.study.json,
// for replaying them offline against human charts.
const study = process.argv.includes('--study');
const outDir = join(root, '.data', 'remap');
const store = join(root, '.data', 'remap-songs.json');
const port = 5197;
const base = `http://localhost:${port}`;
mkdirSync(outDir, { recursive: true });
// An empty bank (not the mock's built-ins): a song it already has offers no Generate beatmap.
writeFileSync(store, JSON.stringify({ songs: [] }));

async function bank(path, init) {
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(`${API}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (tries >= 2 || /: 4\d\d /.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 5000)); // a sleeping server wakes up
    }
  }
}

const library = await bank('/library');
const listed = library.results; // GET /api/library: { results: SongSummary[] }
const songs = [];
for (const s of listed) {
  if (only && !only.includes(s.id)) continue;
  const full = await bank(`/songs/${encodeURIComponent(s.id)}`);
  if (full.source?.kind !== 'youtube' || !full.source.videoId) { console.log(`skip ${s.id}: not a YouTube song`); continue; }
  if (full.source.chart === 'fan' && !only) { console.log(`skip ${s.id}: a fan chart (human-made; name it in --only to map it)`); continue; }
  songs.push(full);
}
console.log(`${songs.length} song(s) to map again${apply ? ', applied to the bank' : ' (dry run: --apply to save them)'}`);

// The video each was mapped from, as the search describes it now (its title and artist come from
// the video's own wording); the old song's names if the search doesn't find it (since Nov 20 the
// search leaves out the bank's own videos, so that's the usual case: the names are the song's).
for (const s of songs) {
  const found = await bank(`/youtube/search?${new URLSearchParams({ title: s.title, artist: s.artist })}`).catch(() => ({ results: [] }));
  s.match = found.results?.find((v) => v.videoId === s.source.videoId)
    ?? { videoId: s.source.videoId, title: s.title, channel: '', songTitle: s.title, songArtist: s.artist, seconds: Math.round((s.lengthBeats * 60) / s.bpm) };
  console.log(`  ${s.id}: "${s.match.songTitle}" by ${s.match.songArtist} (${s.match.videoId}, ${s.match.seconds ?? '?'} s)`);
}

Object.assign(process.env, { MOCK_API_FILE: store, MOCK_API_SPEED: '1' });
const server = await createServer({ root, server: { port, strictPort: true, host: 'localhost' }, logLevel: 'error' });
await server.listen();
const total = songs.reduce((a, s) => a + (s.match.seconds ?? 300), 0);
const results = [];
try {
  await withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const s of songs) {
      const started = Date.now();
      try {
        const sent = await mapOne(context, s);
        const moved = lineUp(sent, s);
        if (moved !== null) console.log(`  lined up with the old map: moved ${moved > 0 ? '+' : ''}${Math.round(moved * 1000)} ms`);
        const r = { id: s.id, title: sent.title, artist: sent.artist, bpm: sent.bpm, mapper: sent.report?.mapper ?? '', tiles: Object.fromEntries(Object.entries(sent.charts).map(([k, v]) => [k, v.notes.length])) };
        writeFileSync(join(outDir, `${s.id}.json`), JSON.stringify(sent));
        const trained = /Ensomi|song.s own lines/.test(r.mapper);
        console.log(`mapped ${s.id} in ${((Date.now() - started) / 1000).toFixed(0)} s: "${r.title}" by ${r.artist}, ${r.bpm} BPM, tiles E${r.tiles.easy} M${r.tiles.medium} H${r.tiles.hard} U${r.tiles.ultra}${trained ? '' : ' (NOT the trained mapper: not applied)'}`);
        if (apply && trained) {
          const made = await bank('/songs', { method: 'POST', body: JSON.stringify(sent) });
          if (s.favorite) await bank(`/songs/${encodeURIComponent(made.id)}`, { method: 'PATCH', body: JSON.stringify({ favorite: true }) });
          await bank(`/songs/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
          r.now = made.id;
          console.log(`  in the bank as ${made.id}; ${s.id} deleted`);
        }
        results.push(r);
      } catch (e) {
        console.log(`FAILED ${s.id}: ${e.message}`);
        results.push({ id: s.id, failed: e.message });
      }
    }
  }, { maxSeconds: Math.round(total * 2.5 + songs.length * 600 + 300), headless: false, mute: false, edge: true,
    // Not --mute-audio: it silences the capture too; nor --disable-audio-output: without an audio
    // device YouTube's player fails now and then (error 5). The capture keeps the sound off the
    // speakers (mapOne: suppressLocalAudioPlayback).
    args: ['--auto-accept-this-tab-capture', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
} finally {
  await server.close();
  rmSync(store, { force: true });
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(results, null, 2));
console.log(`done: ${results.filter((r) => !r.failed).length} mapped, ${results.filter((r) => r.failed).length} failed (summary: ${join(outDir, 'summary.json')})`);

/**
 * Moves the new map (its source.offset) to sit where the old one of the same video does: the
 * shift (within 0.15 s) at which most of their Ultra tiles meet within 8 ms, when that's a clear
 * peak. Returns the move (seconds), or null when there was none to make or none was clear.
 */
function lineUp(sent, old) {
  const LINE_UP = 0.15;
  if (!old?.charts?.ultra || sent.source?.videoId !== old.source?.videoId) return null;
  const at = (song) => song.charts.ultra.notes.map((n) => (song.source?.offset ?? 0) + (n.t * 60) / song.bpm).sort((a, b) => a - b);
  const a = at(old), b = at(sent);
  const meet = (sh) => { let n = 0, j = 0; for (const t of a) { while (j < b.length && b[j] < t + sh - 0.008) j++; if (j < b.length && Math.abs(b[j] - t - sh) <= 0.008) n++; } return n; };
  const profile = [];
  for (let sh = -LINE_UP; sh <= LINE_UP + 1e-9; sh += 0.002) profile.push({ sh, n: meet(sh) });
  const best = profile.reduce((x, y) => (y.n > x.n ? y : x));
  const median = [...profile].sort((x, y) => x.n - y.n)[profile.length >> 1].n;
  if (best.n < 0.3 * Math.min(a.length, b.length) || best.n < 3 * Math.max(1, median)) return null;
  if (Math.abs(best.sh) < 0.008) return 0;
  sent.source.offset = Math.round(((sent.source.offset ?? 0) - best.sh) * 1000) / 1000;
  return -best.sh;
}

/** One song through the page's own Generate beatmap → Listen and map; the NewSong it sends. */
async function mapOne(context, s) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  page.on('console', (m) => { if (/\[mapper\]|\[listen\]/.test(m.text())) console.log('  ' + m.text().slice(0, 300)); });
  // The search answers with the song's own video only.
  await page.route('**/api/youtube/search**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [s.match] }) }));
  // ...and no mapped song matches (the mock has built-ins of its own, One Dance among them).
  await page.route('**/api/search?**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }) }));
  await page.addInitScript((STUDY) => {
    sessionStorage.setItem('rythm-architect:intro', 'skip');
    if (STUDY) localStorage.setItem('rythm-architect:study', '1');
    // The tab's sound goes to the capture only, not out of the speakers (suppressLocalAudioPlayback).
    const share = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = (o = {}) =>
      share({ ...o, audio: { ...(typeof o.audio === 'object' ? o.audio : {}), suppressLocalAudioPlayback: true } });
  }, study);
  try {
    await page.goto(`${base}/#/`);
    await page.locator('#song-title').fill(s.match.songTitle);
    await page.locator('#song-artist').fill(s.match.songArtist);
    await page.getByRole('button', { name: /^Generate beatmap from / }).first().click({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Listen and map' }).click({ timeout: 30_000 });
    const posted = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/songs', { timeout: ((s.match.seconds ?? 300) * 2.5 + 600) * 1000 });
    // A listen that went wrong comes back to the dialog with the problem and Try again.
    const problem = page.locator('.listen-problem').waitFor({ timeout: ((s.match.seconds ?? 300) * 2.5 + 600) * 1000 })
      .then(async () => { throw new Error(`the listen failed: ${await page.locator('.listen-problem').textContent()}`); });
    const req = await Promise.race([posted, problem]);
    problem.catch(() => {});
    const res = await req.response();
    if (!res?.ok()) throw new Error(`the page's save was refused: ${res?.status()} ${await res?.text()}`);
    if (study) {
      const data = await page.evaluate(() => window.__rythmStudy);
      if (data) writeFileSync(join(outDir, `${s.id}.study.json`), JSON.stringify(data));
      else console.log('  (no study data came back)');
    }
    return JSON.parse(req.postData());
  } catch (e) {
    // What the page showed when it went wrong.
    await page.screenshot({ path: join(outDir, `${s.id}.failed.png`) }).catch(() => {});
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}
