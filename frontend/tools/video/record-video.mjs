// Records what real gameplay looks like into docs/media/gameplay.webm (plus a results still).
// Re-run whenever gameplay, the stage, the HUD or the charts change:  npm run video
//
// The video: the intro (building, lit by the lane keys, then the way in) → Name a Song: searching
// "ink" and picking "Ink and Fury" (real audio) → a bot playing it on Hard, with the dev tools
// opened partway → "One Dance", a YouTube song, to show where its video sits: its own spot in the
// bar under the stage while the preview plays, then the top-left corner in the game (it plays in
// YouTube's embedded player; needs the network and a store with the song, like .data/songs.json)
// → the hand-mapped test song played sloppily, so misses, combo breaks and the results screen
// show. Picture only (browsers can't capture their own audio here).
//
// How: tools/video/screencast.mjs (Chrome's screencast piped into the Playwright cache's ffmpeg).
// Needs the dev server running (npm run dev) or APP_URL pointing at one.

import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowser } from '../browser.mjs';
import { startRecording } from './screencast.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, '..', 'docs', 'media');
const outFile = join(outDir, 'gameplay.webm');
const base = process.env.APP_URL || 'http://localhost:5173';
const W = 1280, H = 720, FPS = 25;
mkdirSync(outDir, { recursive: true });


// Plays the current song from inside the page; `sloppy` skips some tiles and drops some holds.
async function bot(page, sloppy) {
  await page.waitForFunction(() => window.__rythm);
  await page.evaluate((sloppy) => {
    const { time, game } = window.__rythm;
    const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const todo = game.notes.map((n, i) => ({ n, i, down: false, up: false }));
    const tick = () => {
      const t = time();
      for (const s of todo) {
        if (sloppy && s.i % 6 === 2) continue;
        const jitter = sloppy ? (((s.i * 37) % 9) - 4) * 0.012 : 0;
        if (!s.down && t >= s.n.time + jitter) { key('keydown', codes[s.n.lane]); s.down = true; }
        const upAt = s.n.hold ? (sloppy && s.i % 4 === 0 ? s.n.time + 0.2 : s.n.end + 0.02) : s.n.time + 0.07;
        if (s.down && !s.up && t >= upAt) { key('keyup', codes[s.n.lane]); s.up = true; }
      }
      if (todo.some((s) => !s.up)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, sloppy);
}

let seconds = 0;
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`${base}/#/`);
  await page.waitForTimeout(200);
  const rec = await startRecording(page, outFile, { fps: FPS });

  // The intro builds itself; the lane keys light it; a click launches it.
  await page.waitForTimeout(3200);
  await page.mouse.move(380, 260);
  for (const k of ['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyJ', 'KeyF']) { await page.keyboard.press(k); await page.waitForTimeout(240); }
  await page.mouse.move(900, 480, { steps: 24 });
  await page.waitForTimeout(500);
  await page.mouse.click(900, 480);
  await page.waitForTimeout(4200);
  // Name a Song: search, and pick the real track.
  await page.locator('#song-title').pressSequentially('ink', { delay: 140 });
  await page.waitForTimeout(1400);
  await page.locator('.result', { hasText: 'Ink and Fury' }).click();
  await page.waitForTimeout(5000);
  await page.locator('.now-playing .diff-option.diff-hard').click();
  await page.waitForTimeout(900);
  await page.locator('.play-btn').click();
  await page.waitForSelector('.overlay-card .btn-primary:not([disabled])');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await bot(page, false);
  await page.waitForTimeout(18000);
  // The dev tools, live: autoplay, the queue, the clock, judgements, levels.
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(5500);
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);
  // A YouTube song: the video in its spot on the menu, then in the game's corner.
  await page.goto(`${base}/#/`);
  await page.locator('#song-title').pressSequentially('one dance', { delay: 110 });
  const oneDance = page.locator('.result', { hasText: 'One Dance' }).first();
  if (await oneDance.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await page.waitForTimeout(900);
    await oneDance.click();
    await page.locator('.yt-dock[data-shown="true"]').waitFor({ timeout: 25000 }).catch(() => console.log('One Dance: the preview video did not show'));
    await page.waitForTimeout(5000);
    await page.locator('.now-playing .diff-option.diff-medium').click();
    await page.waitForTimeout(700);
    await page.locator('.play-btn').click();
    await page.waitForSelector('.overlay-card .btn-primary:not([disabled])', { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await bot(page, false);
    await page.waitForTimeout(20000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  } else {
    console.log('One Dance is not in this store: skipped');
  }
  // The hand-mapped test song, played badly enough to show misses and the results screen.
  await page.goto(`${base}/#/play/demo-neon-blueprint/medium`);
  await page.waitForSelector('.overlay-card .btn-primary:not([disabled])');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await bot(page, true);
  await page.waitForSelector('.results-card', { timeout: 90000 });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(outDir, 'results.png') });
  seconds = (await rec.stop()).seconds;
}, { maxSeconds: 300 });

console.log(`video: ${outFile} (${(statSync(outFile).size / 1e6).toFixed(1)} MB, ${seconds.toFixed(0)} s)`);
