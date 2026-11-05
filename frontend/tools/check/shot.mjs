// Screenshots a page of the running app.  node tools/check/shot.mjs <path> <out.png> [width] [height] [waitMs]
import { withBrowser } from '../browser.mjs';
const [path = '/', out = 'shot.png', w = '1440', h = '900', wait = '2500'] = process.argv.slice(2);
const base = process.env.APP_URL || 'http://localhost:5173';
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === "error") logs.push(m.text().slice(0, 600)); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.stack}`));
  await page.goto(base + path);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: out });
  if (logs.length) console.log(logs.join('\n'));
}, { maxSeconds: 60 });
