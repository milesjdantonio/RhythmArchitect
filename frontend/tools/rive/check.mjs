// Loads .riv files in the Rive lab (lab/rive-lab.html) with the real Rive web runtime and reports
// whether each loaded, what it contains, and any console errors. Ported from TerraSim.
//
//   node tools/rive/check.mjs [name,name] [--out dir] [--drive]
//   --drive   also steps every state-machine input and screenshots each step
//
// Starts its own Vite server on port 5199.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { withBrowser } from '../browser.mjs';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const out = resolve(flag('--out') || join(process.env.TEMP || '.', 'rythm-rive-check'));
const drive = has('--drive');
const names = args[0] ? args[0].split(',') : null;
mkdirSync(out, { recursive: true });

const port = 5199;
const server = await createServer({ server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
let failed = 0;
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
    const q = names ? `?file=${names.join(',')}` : '';
    await page.goto(`http://127.0.0.1:${port}/lab/rive-lab.html${q}`);
    await page.waitForFunction(() => Object.values(window.__rive || {}).length && Object.values(window.__rive).every((r) => r.loaded || r.error), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const reports = await page.evaluate(() => Object.values(window.__rive));
    for (const r of reports) {
      if (!r.loaded) failed++;
      console.log(`${r.loaded ? 'OK  ' : 'FAIL'} ${r.name}: ${r.error || `${r.animations.length} animations [${r.animations.join(', ')}]; ${r.stateMachines.map((s) => `${s.name}(${s.inputs.map((i) => `${i.name}:${i.type}`).join(',')})`).join(' ')}`}`);
    }
    await page.screenshot({ path: join(out, 'lab.png'), fullPage: true });
    if (drive) {
      const sections = await page.$$('section');
      for (let idx = 0; idx < reports.length; idx++) {
        const r = reports[idx];
        if (!r.loaded) continue;
        const sec = sections[idx];
        const safe = r.name.replace(/[^a-z0-9-]/gi, '_');
        await sec.screenshot({ path: join(out, `${safe}-0.png`) });
        const inputs = await sec.$$('.controls input, .controls button');
        let step = 1;
        for (const el of inputs) {
          const tag = await el.evaluate((e) => e.type || e.tagName);
          if (tag === 'range') {
            for (const v of [1, 2, 3, 4]) {
              await el.evaluate((e, val) => { e.value = val; e.dispatchEvent(new Event('input')); }, v);
              await page.waitForTimeout(900);
              await sec.screenshot({ path: join(out, `${safe}-${step++}.png`) });
            }
            continue;
          }
          await el.click();
          await page.waitForTimeout(tag === 'checkbox' ? 900 : 260);
          await sec.screenshot({ path: join(out, `${safe}-${step++}.png`) });
        }
      }
    }
    if (logs.length) console.log('console:\n  ' + [...new Set(logs)].join('\n  '));
    console.log(`screenshots: ${out}`);
  }, { maxSeconds: 170 });
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
