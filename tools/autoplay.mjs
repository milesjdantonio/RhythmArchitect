// Plays a song with a bot in a headless browser and screenshots it mid-song and at the results.
//   node tools/autoplay.mjs <songId> <difficulty> [outDir] [--sloppy]
// --sloppy skips every 7th tile and lets go of holds early, to show misses and combo breaks.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowser } from './browser.mjs';
const args = process.argv.slice(2);
const sloppy = args.includes('--sloppy');
const [id = 'demo-neon-blueprint', diff = 'hard', out = join(process.env.TEMP || '.', 'rythm-autoplay')] = args.filter((a) => !a.startsWith('--'));
const base = process.env.APP_URL || 'http://localhost:5173';
mkdirSync(out, { recursive: true });
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  await page.goto(`${base}/#/play/${id}/${diff}`);
  await page.waitForSelector('.overlay-card .btn-primary');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__rythm);
  // The bot runs inside the page so its timing is frame-accurate.
  await page.evaluate((sloppy) => {
    const { time, game } = window.__rythm;
    const codes = { 4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'] }[game.lanes];
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const todo = game.notes.map((n, i) => ({ n, i, down: false, up: false }));
    const tick = () => {
      const t = time();
      for (const s of todo) {
        if (sloppy && s.i % 7 === 3) continue;
        if (!s.down && t >= s.n.time + 0.012) { key('keydown', codes[s.n.lane]); s.down = true; }
        const upAt = s.n.hold ? (sloppy && s.i % 5 === 0 ? s.n.time + 0.25 : s.n.end + 0.02) : s.n.time + 0.08;
        if (s.down && !s.up && t >= upAt) { key('keyup', codes[s.n.lane]); s.up = true; }
      }
      if (todo.some((s) => !s.up)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, sloppy);
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
  console.log('fps during play:', fps);
  for (const [name, at] of [['early', 4000], ['mid', 9000], ['late', 16000]]) {
    await page.waitForTimeout(at - (name === 'early' ? 0 : name === 'mid' ? 4000 : 9000));
    await page.screenshot({ path: join(out, `${diff}-${name}.png`) });
    console.log('shot', name);
  }
  await page.waitForSelector('.results-card', { timeout: 150000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, `${diff}-results.png`) });
  const summary = await page.evaluate(() => document.querySelector('.results-card')?.innerText.replace(/\s+/g, ' '));
  console.log('results:', summary);
  if (logs.length) console.log('errors:\n' + [...new Set(logs)].join('\n'));
}, { maxSeconds: 240 });
