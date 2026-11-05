// Maps the bundled test tracks with the onset mapper (src/mapping/automap.ts) and writes their
// charts to mock-server/songs/tracks/<id>.json: every tile is a sound in the track, at the moment it's
// heard. The audio is decoded by a real browser (Node has no MP3 decoder), driven by Playwright
// against a temporary Vite server. Mapping songs on request is the backend's job (docs/api.md).
//
//   node tools/map-audio.mjs [id,id] [--request]
//
// --request also writes docs/samples/<id>.chart-request.json: what the browser sends the AI
// charter (POST /api/chart) for that track, for building and testing the backend against.
//
// Re-run after changing automap.ts or charts.ts, then re-record the gameplay video (npm run video).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withBrowser } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Both pieces were composed by Claude for SchmollCrossword (MIT licence), rendered with the
// GeneralUser GS SoundFont by S. Christian Collins (free for any use). See NOTICE.md.
const CREDIT = 'Composed by Claude for SchmollCrossword (MIT). Rendered with GeneralUser GS by S. Christian Collins.';
const TRACKS = [
  { id: 'ink-and-fury', title: 'Ink and Fury', artist: 'SchmollCrossword OST', meter: 4, key: 'C', scale: 'minor', scaleLabel: 'Minor', mood: 'Epic', hues: [350, 268], bpmRange: [90, 180] },
  { id: 'the-restless-stacks', title: 'The Restless Stacks', artist: 'SchmollCrossword OST', meter: 3, key: 'D', scale: 'minor', scaleLabel: 'Minor', mood: 'Dark', hues: [168, 286], bpmRange: [100, 200] },
];
const args = process.argv.slice(2);
const writeRequest = args.includes('--request');
const only = args.find((a) => !a.startsWith('--'))?.split(',');

const port = 5197;
const server = await createServer({ root, server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/lab/rive-lab.html?file=logo`);
    for (const t of TRACKS.filter((x) => !only || only.includes(x.id))) {
      const res = await page.evaluate(async (t) => {
        const { automap } = await import('/src/mapping/automap.ts');
        const got = await fetch(`/audio/${t.id}.mp3`);
        if (!got.ok) throw new Error(`Couldn't load the audio (${got.status})`);
        const buf = await got.arrayBuffer();
        const ctx = new OfflineAudioContext(1, 22050, 22050);
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const mono = new Float32Array(ch.length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const d = audio.getChannelData(c);
          for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels;
        }
        const r = automap(mono, audio.sampleRate, { meter: t.meter, key: t.key, scale: t.scale, bpmRange: t.bpmRange, seed: 11 });
        const { chartRequest } = await import('/src/mapping/charter.ts');
        const request = chartRequest(r, { title: t.title, artist: t.artist, seconds: Math.round(audio.duration * 10) / 10 }, t.meter);
        return { ...r, duration: audio.duration, request };
      }, t);
      const out = {
        id: t.id, title: t.title, artist: t.artist, meter: t.meter, key: t.key, scale: t.scaleLabel, mood: t.mood, hues: t.hues,
        bpm: res.bpm, lengthBeats: res.lengthBeats,
        source: { kind: 'stream', url: `/audio/${t.id}.mp3`, offset: res.offset, credit: CREDIT },
        report: res.report, charts: res.charts,
      };
      writeFileSync(join(root, 'mock-server', 'songs', 'tracks', `${t.id}.json`), JSON.stringify(out));
      if (writeRequest) {
        mkdirSync(join(root, '..', 'docs', 'samples'), { recursive: true });
        writeFileSync(join(root, '..', 'docs', 'samples', `${t.id}.chart-request.json`), JSON.stringify(res.request, null, 1));
      }
      const c = (d) => `${res.charts[d].notes.length}`;
      console.log(`${t.id}: ${res.bpm} BPM, beat 0 at ${res.offset}s, ${res.duration.toFixed(1)}s, ${res.onsets} onsets, confidence ${res.report.confidence}; easy ${c('easy')} / medium ${c('medium')} / hard ${c('hard')} tiles; sections ${res.report.sections.map((s) => s.label).join(' → ')}`);
    }
  }, { maxSeconds: 120 });
} finally {
  await server.close();
}
