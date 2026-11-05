// Screenshots the menu's Bank button and the music bank with a song playing (dev server running).
//   node tools/check/bank-shot.mjs [outDir]
import { join } from 'node:path';
import { withBrowser } from '../browser.mjs';

const out = process.argv[2] || '.';
const base = process.env.APP_URL || 'http://localhost:5173';
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('rythm-architect:intro', 'skip'));
  await page.goto(`${base}/#/song/builtin-the-restless-stacks`);
  await page.getByRole('button', { name: /Sound on/i }).click(); // allows sound: the preview starts
  try { await page.getByRole('button', { name: /Preview playing/ }).waitFor({ timeout: 15_000 }); }
  catch (e) { await page.screenshot({ path: join(out, 'debug.png') }); throw e; }
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, 'menu.png'), clip: { x: 0, y: 0, width: 720, height: 220 } });
  await page.getByRole('button', { name: 'Music bank' }).click();
  await page.locator('.bank-now').waitFor();
  await page.locator('.bank-group .result', { hasText: 'Ink and Fury' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'bank.png') });
}, { maxSeconds: 90 });
