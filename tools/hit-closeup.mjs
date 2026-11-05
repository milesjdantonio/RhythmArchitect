// Close-ups of the pads while tiles are hit, for comparing versions' hit effects frame by frame.
// Dev server running. Headless (the test stand-in for YouTube).
//   node tools/hit-closeup.mjs [outDir] [versions=unified,webgpu] [frames=8]
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withBrowser } from './browser.mjs';

const [out = join(tmpdir(), 'rythm-hits'), versions = 'unified,webgpu', frames = '8'] = process.argv.slice(2);
const base = process.env.APP_URL || 'http://localhost:5173';
const FAKE = readFileSync('tests/e2e/fake-youtube.js', 'utf8').replace("e2eRestless: ", "'FOqKN-ouAUE': '/audio/ink-and-fury.mp3', e2eRestless: ");
const INDEX = { unified: 0, webgpu: 1 };
mkdirSync(out, { recursive: true });

await withBrowser(async (browser) => {
  for (const name of versions.split(',')) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.route('https://i.ytimg.com/**', (r) => r.abort());
    await page.addInitScript(() => { window.__fakeYtSeconds = 60; });
    await page.goto(`${base}/demo`);
    await page.getByRole('button', { name: 'Run this version' }).nth(INDEX[name]).click();
    await page.getByRole('button', { name: /^Start/ }).click({ timeout: 30_000 });
    await page.waitForTimeout(7000);
    // The pads: the bottom middle of the screen.
    for (let i = 0; i < Number(frames); i++) {
      await page.screenshot({ path: `${out}/${name}-${i}.png`, clip: { x: 380, y: 560, width: 680, height: 340 } });
      await page.waitForTimeout(60);
    }
    await page.close();
  }
}, { maxSeconds: 150 });
console.log(out);
