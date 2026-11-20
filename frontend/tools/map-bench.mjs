// The whole mapper's benchmark: renders the synthetic band (tests/bench/band.ts) at a spread of
// tempos, clean and rough, maps each the way the game does (beat tracker, onset mapper, trained
// mapper: lab/map-bench.ts) in a headless browser, and prints a table: the tempo read (right, half,
// double...), each difficulty's tiles on real notes and strong notes caught, holds, and the ladder.
// The bundled tracks come last (tempo and ladder only). The trained model downloads on first use.
//
//   node tools/map-bench.mjs [bpm,bpm,...] [--clean] [--no-tracks] [--voice-only] [--json out.json]
//
// The bundled tracks (instrumental) also have their vocal split counted: the syllables the voice
// step (voice.ts) hears in them should be nearly none. --voice-only runs just that.
//
// Run it after changing the beat grid, the trained mapper's placement or thin.ts.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withBrowser } from './browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const list = args.find((a) => /^\d/.test(a));
const TEMPOS = list ? list.split(',').map(Number) : [76, 92, 108, 124, 140, 156, 172, 188];
const roughToo = !args.includes('--clean');
const voiceOnly = args.includes('--voice-only');
const tracks = !args.includes('--no-tracks');
const jsonAt = args.indexOf('--json');
const D = ['easy', 'medium', 'hard', 'ultra'];

const port = 5196;
const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const rows = [];
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/lab/rive-lab.html?file=logo`);
    const once = (fn, a) => page.evaluate(async ([fn, a]) => (await import('/lab/map-bench.ts'))[fn](...a), [fn, a]);
    // Vite may reload the page once while it optimizes a dependency it found late: then again.
    const run = async (fn, a) => {
      try { return await once(fn, a); } catch (e) {
        if (!/context was destroyed|navigation/i.test(String(e))) throw e;
        await page.goto(`http://localhost:${port}/lab/rive-lab.html?file=logo`);
        return once(fn, a);
      }
    };
    for (const bpm of voiceOnly ? [] : TEMPOS) {
      for (const rough of roughToo ? [false, true] : [false]) {
        const r = await run('benchBand', [bpm, rough]);
        rows.push(r);
        const per = D.map((d) => `${d[0].toUpperCase()} ${String(r.per[d].onNote).padStart(3)}%/${String(r.per[d].strong).padStart(3)}%`).join('  ');
        console.log(`${String(bpm).padStart(3)} ${rough ? 'rough' : 'clean'}  read ${String(r.read).padEnd(6)} ${r.call.padEnd(6)} (tracker ${r.tracker ?? '-'}, onset ${r.onset}, model ${r.model ?? '-'})  on-note/strong: ${per}  tiles/s ${r.perSecond.join(' ')}  steps ×${r.steps.join(' ×')}  holds ${D.map((d) => r.per[d].holds).join('/')}%`);
      }
    }
    if (tracks) {
      for (const id of ['ink-and-fury', 'the-restless-stacks']) {
        if (!voiceOnly) {
          const r = await run('benchTrack', [id]);
          rows.push(r);
          console.log(`${id}: read ${r.read} (tracker ${r.tracker ?? '-'}, onset ${r.onset}, model ${r.model ?? '-'})  tiles/s ${r.perSecond.join(' ')}  steps ×${r.steps.join(' ×')}`);
        }
        const v = await run('benchVoice', [id]);
        console.log(v.skipped ? `${id} voice: skipped (${v.skipped})` : `${id} voice (instrumental): ${v.syllables} syllables let through (${(v.syllables / v.seconds).toFixed(2)}/s; ${v.ungated} before the gate, ${v.notes} notes heard in the split vocal)`);
      }
    }
  }, { maxSeconds: 2400 });
} finally {
  await server.close();
}
const bands = rows.filter((r) => r.call);
if (bands.length) {
  const right = bands.filter((r) => r.call === 'right').length;
  const mean = (f) => Math.round(bands.reduce((a, r) => a + f(r), 0) / bands.length);
  console.log(`\ntempo right ${right}/${bands.length} (${bands.filter((r) => r.call !== 'right').map((r) => `${r.bpm}${r.rough ? 'r' : ''}: ${r.call}`).join(', ') || 'none wrong'})`);
  console.log(`mean on-note ${D.map((d) => `${d} ${mean((r) => r.per[d].onNote)}%`).join(', ')}`);
  console.log(`mean strong caught ${D.map((d) => `${d} ${mean((r) => r.per[d].strong)}%`).join(', ')}`);
}
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(rows, null, 1));
