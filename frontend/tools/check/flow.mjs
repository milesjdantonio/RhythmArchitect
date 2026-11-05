// Screenshots the main views of the running app (APP_URL, default http://localhost:5173):
// the intro, the waiting screen, a search, a picked song, favourites, and a game run by autoplay
// with the dev tools open.
//   node tools/check/flow.mjs [outDir] [width] [height]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowser } from '../browser.mjs';
const [out = join(process.env.TEMP || '.', 'rythm-flow'), w = '1440', h = '900'] = process.argv.slice(2);
const base = process.env.APP_URL || 'http://localhost:5173';
mkdirSync(out, { recursive: true });
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.stack}`));
  const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name); };
  await page.goto(`${base}/#/`);
  await page.evaluate(() => localStorage.removeItem('rythm-architect:settings'));
  await page.reload();
  await shot('intro', 3200);
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyJ');
  await shot('intro-keys', 250);
  await page.keyboard.press('Space');
  await shot('home', 3000);
  await page.locator('#song-title').pressSequentially('the rest', { delay: 60 });
  await shot('search', 1200);
  await page.locator('.result', { hasText: 'The Restless Stacks' }).click();
  await shot('song-picked', 3500);
  await page.locator('.fav-toggle').click();
  await shot('favorites', 1200);
  await page.locator('.play-btn').click();
  await shot('play-ready', 2500);
  await page.keyboard.press('Backquote');
  await page.locator('.seg button', { hasText: 'Perfect' }).click();
  await page.locator('.overlay-card .btn-primary').click();
  await shot('play-autoplay', 9000);
  await shot('play-later', 6000);
  if (logs.length) console.log('errors:\n' + [...new Set(logs)].join('\n'));
}, { maxSeconds: 150 });
