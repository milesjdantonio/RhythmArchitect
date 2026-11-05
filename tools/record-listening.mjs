// Records the listening and loading process into docs/media/listening.webm (plus a still,
// listening.png): Name a Song → a song that isn't mapped yet → Generate beatmap → the video is
// found → Listen and map → the song plays once while the skyline fills in → finding the beat and
// every note → the AI charter → the map lands → the song on stage → Play → the loading screen →
// the first seconds of the run.
// Re-run whenever the Generate flow, the listening / mapping / charting screens or the loader
// change:  npm run video:listen
//
// Self-contained: it starts its own dev server (port 5198) with a throwaway song store and the
// end-to-end tests' stand-in for YouTube (tests/e2e/fake-youtube.js: a bundled track plays as a
// 40-second "video", and tab sharing is simulated), so it needs no network or API keys and never
// touches .data/songs.json. The charter is the mock's (fixed rules), until the backend's is used.

import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withBrowser } from './browser.mjs';
import { startRecording } from './screencast.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'media');
const outFile = join(outDir, 'listening.webm');
const store = join(root, '.data', 'listen-video-songs.json');
const port = 5198;
const base = `http://localhost:${port}`;
const W = 1280, H = 720;
mkdirSync(outDir, { recursive: true });
rmSync(store, { force: true });

// The mock backend reads these when the server starts (vite.config.ts).
Object.assign(process.env, { MOCK_API_FILE: store, MOCK_API_SPEED: '1', MOCK_YT_VIDEO: 'e2eInkFury1', MOCK_OSU_DIR: 'tests/fixtures/osu' });
const FAKE_YOUTUBE = readFileSync(join(root, 'tests', 'e2e', 'fake-youtube.js'), 'utf8');

const server = await createServer({ root, server: { port, strictPort: true, host: 'localhost' }, logLevel: 'error' });
await server.listen();
let seconds = 0;
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YOUTUBE }));
    await page.route('https://i.ytimg.com/**', (r) => r.abort());
    await page.addInitScript(() => {
      sessionStorage.setItem('rythm-architect:intro', 'skip');
      window.__fakeYtSeconds = 40;
      // Tab sharing, simulated: the "video's" sound goes straight into the capture.
      navigator.mediaDevices.getDisplayMedia = async () => {
        const yt = window.__fakeYt, listen = window.__listen;
        const ctx = listen.ctx();
        const dest = ctx.createMediaStreamDestination();
        if (!yt.node) { yt.node = ctx.createMediaElementSource(yt.audio); yt.node.connect(ctx.destination); }
        yt.node.connect(dest);
        listen.connectTick(dest);
        return dest.stream;
      };
      // Say what the stand-in player is, so nobody mistakes it for a broken video.
      addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `.fake-yt { position: relative; } .fake-yt::after { content: 'YouTube player (stand-in)'; position: absolute; inset: 0; display: grid; place-items: center; font: 600 13px/1.2 system-ui, sans-serif; letter-spacing: 0.08em; color: rgb(255 255 255 / 0.7); }`;
        document.head.appendChild(s);
      });
    });

    await page.goto(`${base}/#/`);
    await page.waitForTimeout(400);
    const rec = await startRecording(page, outFile);
    await page.waitForTimeout(2200);

    // A song that isn't mapped yet: no results, so Generate beatmap is offered.
    await page.locator('#song-title').click();
    await page.locator('#song-title').pressSequentially('Night Toccata', { delay: 110 });
    await page.locator('#song-artist').pressSequentially('Studio Test', { delay: 90 });
    await page.waitForTimeout(1300);
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    // The video is found and shown; then the browser listens to it once.
    await page.getByRole('button', { name: 'Listen and map' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Listen and map' }).click();
    await page.getByRole('dialog', { name: 'Listening' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(22000);
    await page.screenshot({ path: join(outDir, 'listening.png') });
    // Mapping, charting, the map landing; then the song opens on stage.
    await page.waitForURL(/#\/song\//, { timeout: 120000 });
    await page.waitForTimeout(7500); // the preview starts on the stage
    // Play: the loading screen, the start card, the first seconds of the run.
    await page.locator('.now-playing .diff-option.diff-hard').click();
    await page.waitForTimeout(700);
    await page.locator('.play-btn').click();
    await page.waitForSelector('.overlay-card .btn-primary:not([disabled])', { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__rythm);
    await page.evaluate(() => {
      const { time, game } = window.__rythm;
      const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
      const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      const todo = game.notes.map((n) => ({ n, down: false, up: false }));
      const tick = () => {
        const t = time();
        for (const s of todo) {
          if (!s.down && t >= s.n.time) { key('keydown', codes[s.n.lane]); s.down = true; }
          if (s.down && !s.up && t >= (s.n.hold ? s.n.end + 0.02 : s.n.time + 0.07)) { key('keyup', codes[s.n.lane]); s.up = true; }
        }
        if (todo.some((s) => !s.up)) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForTimeout(12000);
    seconds = (await rec.stop()).seconds;
  }, { maxSeconds: 300 });
} finally {
  await server.close();
  rmSync(store, { force: true });
}
console.log(`video: ${outFile} (${(statSync(outFile).size / 1e6).toFixed(1)} MB, ${seconds.toFixed(0)} s)`);
