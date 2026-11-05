// Runs each /demo version for a few seconds in a headless browser (the test stand-in for YouTube)
// and prints the meter, so the page can be checked without a person. Not a benchmark: headless
// Chrome renders in software. Dev server running.  node tools/demo-check.mjs [seconds] [outDir]
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withBrowser } from './browser.mjs';

const [seconds = '12', out = join(tmpdir(), 'rythm-demo-check')] = process.argv.slice(2);
const base = process.env.APP_URL || 'http://localhost:5173';
// The stand-in only knows its test tracks: One Dance's video plays one of them (timing is what's checked).
const FAKE = readFileSync('tests/e2e/fake-youtube.js', 'utf8').replace("e2eRestless: ", "'FOqKN-ouAUE': '/audio/ink-and-fury.mp3', e2eRestless: ");
mkdirSync(out, { recursive: true });

await withBrowser(async (browser) => {
  // DEMO_DPR: the device pixel ratio (a laptop's high-density screen is 1.5 to 2).
  // DEMO_HEADED: a real window on this screen (its real refresh rate and pixel density).
  const page = process.env.DEMO_HEADED
    ? await browser.newPage({ viewport: null })
    : await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DEMO_DPR || 1) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  // DEMO_REAL_YT: the real YouTube player (its video decoding counts too), not the test stand-in.
  if (!process.env.DEMO_REAL_YT) {
    await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.route('https://i.ytimg.com/**', (r) => r.abort());
  }
  await page.addInitScript((s) => { window.__fakeYtSeconds = s; }, Number(seconds) + 20);
  // DEMO_QUERY: extra query, e.g. "set=ticker:false" (single-setting experiments).
  // DEMO_ARGS: extra browser flags, e.g. "--disable-features=WebGPU" (to try the WebGL fallback).
  await page.goto(`${base}/demo${process.env.DEMO_QUERY ? `?${process.env.DEMO_QUERY}` : ""}`);
  await page.getByRole('button', { name: 'Run this version' }).first().waitFor();
  await page.waitForTimeout(2500); // the page measures the screen's refresh rate
  const headed = !!process.env.DEMO_HEADED;
  const step = (s) => { if (headed) console.log(`· ${s}`); };
  console.log((await page.locator('.demo-head p').first().innerText()).match(/Display: \d+ Hz/)?.[0] ?? 'Display: ?', '· DPR', await page.evaluate(() => devicePixelRatio), '·', await page.evaluate(() => innerWidth + 'x' + innerHeight));
  // Screenshots of a visible window can stall it; only headless runs take them.
  if (!headed) await page.screenshot({ path: `${out}/versions.png` });

  // Optional third argument: which versions, in order (repeats allowed), e.g. current,capped,current,capped.
  const INDEX = { unified: 0, webgpu: 1, classic: -1, current: -1 };
  const order = (process.argv[4] ?? 'unified,webgpu,classic').split(',');
  for (const [i, name] of order.map((n) => [INDEX[n], n])) {
    step(`${name}: opening`);
    await (i < 0 ? page.getByRole('button', { name: 'Run for reference' }) : page.getByRole('button', { name: 'Run this version' }).nth(i)).click({ timeout: 15_000 });
    try {
      step(`${name}: waiting for Start`);
      await page.getByRole('button', { name: /^Start/ }).click({ timeout: 30_000 });
    } catch (e) {
      if (!headed) await page.screenshot({ path: `${out}/${name}-stuck.png` });
      console.log(errors.join('\n'));
      throw e;
    }
    step(`${name}: playing ${seconds} s`);
    await page.waitForTimeout(Number(seconds) * 1000);
    // The meter first: a screenshot stalls the page's frames for a moment.
    const meter = await page.locator('.perf-meter').innerText({ timeout: 10_000 });
    const jumps = process.env.DEMO_JUMPS ? await page.evaluate(() => ({ jumps: window.__recorder?.log.slice(0, 30), slow: window.__recorder?.slow.slice(0, 60), stage: window.__stageSlow?.slice(-20) })) : null;
    if (!headed) await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`--- ${name}\n${meter.replace(/\n+/g, ' | ')}`);
    if (jumps) console.log('jumps', JSON.stringify(jumps));
    await page.locator('.perf-meter').getByRole('button', { name: 'Versions' }).click();
    await page.getByRole('button', { name: 'Run this version' }).first().waitFor();
  }
  await page.waitForTimeout(500);
  if (!headed) await page.screenshot({ path: `${out}/compare.png`, fullPage: true });
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
}, { maxSeconds: Number(process.env.DEMO_MAX_SECONDS || 240), headless: !process.env.DEMO_HEADED, args: [...(process.env.DEMO_HEADED ? ['--window-position=0,0', '--start-maximized','--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] : []), ...(process.env.DEMO_ARGS ?? '').split(' ').filter(Boolean)] });
