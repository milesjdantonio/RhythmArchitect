// Records every frame from the click on Start to a few seconds past beat 0, to find freezes at the
// start of a run: long frames (wall clock) and holds (the song clock standing still while time
// passes). Dev server running; YouTube is the test stand-in, optionally slow to start.
//   node tools/start-probe.mjs [version=unified] [song=One Dance's id] [startLagMs=0]
import { readFileSync } from 'node:fs';
import { withBrowser } from './browser.mjs';

const [version = 'unified', song = 'yt-foqkn-ouaue-mvx4rlfb', lag = '0'] = process.argv.slice(2);
const base = process.env.APP_URL || 'http://localhost:5173';
// One Dance's video plays a test track; `lag` delays its start the way YouTube's player does.
const FAKE = readFileSync('tests/e2e/fake-youtube.js', 'utf8').replace("e2eRestless: ", "'FOqKN-ouAUE': '/audio/ink-and-fury.mp3', e2eRestless: ");
const INDEX = { unified: 0, webgpu: 1 };

await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route('https://i.ytimg.com/**', (r) => r.abort());
  await page.addInitScript((lagMs) => {
    window.__fakeYtSeconds = 60;
    if (!lagMs) return;
    // Slow starts: the stand-in's play() waits `lagMs` before the audio starts.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { return new Promise((r) => setTimeout(r, lagMs)).then(() => play.call(this)); };
  }, Number(lag));
  await page.goto(`${base}/demo?song=${song}`);
  const btn = version === 'current' ? page.getByRole('button', { name: 'Run for reference' }) : page.getByRole('button', { name: 'Run this version' }).nth(INDEX[version]);
  await btn.click();
  const start = page.getByRole('button', { name: /^Start/ });
  await start.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const w = window;
    w.__probe = [];
    const tick = (ts) => {
      const r = w.__rythm;
      const count = document.querySelector('.countdown')?.textContent ?? '';
      const tiles = r?.game?.notes ? r.game.notes.filter((n) => n.time - r.time() < 3).length : 0;
      w.__probe.push([performance.now(), r ? r.time() : null, count, tiles]);
      if (w.__probe.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await start.click();
  const clickedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(9000);
  const rows = await page.evaluate(() => window.__probe);
  let prev = null;
  const events = [];
  for (const [ts, t, count, tiles] of rows) {
    if (ts < clickedAt - 20) { prev = [ts, t]; continue; }
    if (prev) {
      const dt = ts - prev[0];
      const dSong = t !== null && prev[1] !== null ? (t - prev[1]) * 1000 : null;
      if (dt > 50) events.push(`frame ${dt.toFixed(0)} ms at song ${t?.toFixed(2) ?? '(not started)'} count "${count}"`);
      if (dSong !== null && dt > 8 && Math.abs(dSong - dt) > 12) events.push(`clock moved ${dSong.toFixed(0)} ms in a ${dt.toFixed(0)} ms frame at song ${t.toFixed(2)} count "${count}"`);
    }
    prev = [ts, t];
  }
  const first = rows.find(([ts, t]) => ts >= clickedAt && t !== null);
  console.log(`${version}: first frame with the game running ${first ? (first[0] - clickedAt).toFixed(0) : '?'} ms after the click, at song ${first?.[1]?.toFixed(2)}`);
  console.log(events.slice(0, 40).join('\n') || 'no long frames or clock holds');
}, { maxSeconds: 90 });
