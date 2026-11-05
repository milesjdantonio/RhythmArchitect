// Bakes the hit and hold bursts (public/rive/hit.riv, hold.riv) into sprite sheets for the 3D
// stage: public/rive/baked/hit.png, hold.png and bursts.json.
// Runs the real Rive runtime in a headless browser on its own dev server (src/lab/rive-bake.ts).
// Re-run after `npm run rive` changes hit or hold.   npm run rive:bake
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { withBrowser } from '../browser.mjs';

const out = 'public/rive/baked';
mkdirSync(out, { recursive: true });
const port = 5198;
const server = await createServer({ server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
try {
  await withBrowser(async (browser) => {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/lab/rive-bake.html`);
    await page.waitForFunction(() => window.__bake, null, { timeout: 60_000 });
    const bake = await page.evaluate(() => window.__bake);
    if (bake.error) throw new Error(bake.error);
    const manifest = {};
    for (const [name, { png, meta }] of Object.entries(bake.sheets)) {
      writeFileSync(`${out}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
      manifest[name] = meta;
      const frames = Object.values(meta.clips).reduce((a, c) => a + c.count, 0);
      console.log(`${name}: ${Object.keys(meta.clips).length} clips, ${frames} frames, ${meta.rows} rows`);
    }
    writeFileSync(`${out}/bursts.json`, JSON.stringify(manifest, null, 1) + '\n');
  }, { maxSeconds: 120 });
} finally {
  await server.close();
}
