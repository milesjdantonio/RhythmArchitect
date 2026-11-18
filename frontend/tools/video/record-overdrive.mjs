// Records the Overdrive update into docs/media/overdrive.webm, with stills in docs/media
// (settings, start card, each Overdrive level overdrive-1..3.png, strays, practice).
//   npm run video:overdrive
//
// The video, in order:
//   1. Settings: the Background themes (a fixed colour, then back to Dynamic), the sliders moving
//      in 1% steps, and a lane key rebound (then the default keys again).
//   2. The start card: the bound keys, the Overdrive line, the Practice picker opened.
//   3. A real track on Ultra, played by a bot that hits every tile and sets off Overdrive (Space)
//      each time its charge fills, a few seconds apart: Neon, Eclipse, Prism (×8), then let run
//      out (the colours flow back).
//   4. Mashing the keys on the test song: every press with no tile is a Stray, and the signal
//      drains fast.
//   5. Practice: a loop from 0:20 to 0:30, slowed to 75%, played round twice (Loop 2).
// Picture only (browsers can't capture their own audio here).
//
// Needs the dev server running (npm run dev) or APP_URL pointing at one. SONG and DIFFICULTY pick
// the Overdrive song (a dense one fills the charge quickly).

import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowser } from '../browser.mjs';
import { startRecording } from './screencast.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, '..', 'docs', 'media');
const outFile = join(outDir, 'overdrive.webm');
const base = process.env.APP_URL || 'http://localhost:5173';
const song = process.env.SONG || 'builtin-ink-and-fury';
const difficulty = process.env.DIFFICULTY || 'ultra';
const W = 1280, H = 720, FPS = 25;
/** Seconds between level-ups, so each level is seen. */
const GAP = Number(process.env.GAP || 4.5);
mkdirSync(outDir, { recursive: true });
const still = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });

/**
 * A perfect bot, inside the page. It follows whichever run is on (a practice loop starts a fresh
 * one). `overdrive`: set it off whenever it can go up and GAP seconds have passed since the last
 * level (at the top it can't, so it runs out).
 */
async function bot(page, { overdrive = false } = {}) {
  await page.waitForFunction(() => window.__rythm);
  await page.evaluate(({ GAP, overdrive }) => {
    const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    let game = null, todo = [], last = -99;
    window.__botOn = true;
    const tick = () => {
      if (!window.__botOn) return;
      const r = window.__rythm;
      if (r && r.game !== game) { game = r.game; todo = game.notes.map((n) => ({ n, down: false, up: false })); }
      if (game) {
        const t = r.time();
        for (const s of todo) {
          if (!s.down && t >= s.n.time) { key('keydown', codes[s.n.lane]); s.down = true; }
          const upAt = s.n.hold ? s.n.end + 0.02 : s.n.time + 0.07;
          if (s.down && !s.up && t >= upAt) { key('keyup', codes[s.n.lane]); s.up = true; }
        }
        const level = game.overdriveLevel;
        if (overdrive && game.canOverdrive && (t - last >= GAP || level === 0)) {
          key('keydown', 'Space'); key('keyup', 'Space');
          last = t;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { GAP, overdrive });
}
const stopBot = (page) => page.evaluate(() => { window.__botOn = false; });
const ready = (page) => page.waitForSelector('.overlay-card .btn-primary:not([disabled])', { timeout: 60000 });

let seconds = 0;
await withBrowser(async (browser) => {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // No intro (it plays on every load); default keys and background to start from.
  await page.addInitScript(() => {
    sessionStorage.setItem('rythm-architect:intro', 'skip');
    if (!sessionStorage.getItem('showcase')) {
      sessionStorage.setItem('showcase', '1');
      localStorage.setItem('rythm-architect:settings', JSON.stringify({ laneKeys: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], overdriveKey: 'Space', backdrop: 'dynamic' }));
    }
  });
  await page.goto(`${base}/#/`);
  // (A dev server's first visit can reload the page once while it bundles: wait it out.)
  await page.getByRole('heading', { name: 'Name a Song' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByRole('heading', { name: 'Name a Song' }).waitFor({ timeout: 30000 });
  const rec = await startRecording(page, outFile, { fps: FPS });
  await page.waitForTimeout(2000);

  // 1. Settings.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('dialog.settings');
  await dialog.waitFor();
  await page.waitForTimeout(900);
  const volume = page.locator('#set-volume');
  await volume.focus();
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(160); }
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
  const bg = dialog.locator('.set-backdrop');
  await bg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  for (const name of ['Ember', 'Ocean']) {
    await bg.locator('.backdrop-swatch', { hasText: name }).click();
    await page.waitForTimeout(1800);
  }
  await still(page, 'showcase-background');
  await bg.locator('.backdrop-swatch', { hasText: 'Dynamic' }).click();
  await page.waitForTimeout(900);
  const keys = dialog.locator('.set-keys');
  await keys.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await keys.getByRole('button', { name: /^Lane 1:/ }).click();
  await page.waitForTimeout(900);
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(1200);
  await still(page, 'showcase-keys');
  await keys.getByRole('button', { name: 'Default keys' }).click();
  await page.waitForTimeout(1000);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(800);

  // 2. The start card, and the Practice picker.
  await page.goto(`${base}/#/play/${song}/${difficulty}`);
  await ready(page);
  await page.waitForTimeout(1600);
  await page.getByRole('radio', { name: 'Practice a part' }).click();
  await page.waitForTimeout(1800);
  await still(page, 'showcase-start');
  await page.getByRole('radio', { name: 'Play the song' }).click();
  await page.waitForTimeout(600);

  // 3. Overdrive, every level.
  await page.keyboard.press('Enter');
  await bot(page, { overdrive: true });
  const shot = new Set();
  const started = Date.now();
  let lapsed = false;
  while (Date.now() - started < 90_000) {
    const s = await page.evaluate(() => {
      const r = window.__rythm;
      return r ? { level: r.game.overdriveLevel, done: r.game.finished, t: r.time() } : null;
    }).catch(() => null);
    if (!s) break;
    if (s.level && !shot.has(s.level)) {
      shot.add(s.level);
      await page.waitForTimeout(900);
      await still(page, `overdrive-${s.level}`);
      console.log(`level ${s.level} at ${s.t.toFixed(1)} s`);
    }
    if (shot.has(3) && s.level === 0 && !lapsed) { lapsed = true; console.log(`ran out at ${s.t.toFixed(1)} s`); }
    if (lapsed) { await page.waitForTimeout(3500); break; }
    if (s.done) break;
    await page.waitForTimeout(150);
  }
  if (shot.size < 3) console.log(`only reached level ${Math.max(0, ...shot)}: try a denser song (SONG=...) or a smaller GAP`);
  await stopBot(page);

  // 4. Strays: mashing every key on the test song drains the signal.
  await page.goto(`${base}/#/play/demo-neon-blueprint/medium`);
  await ready(page);
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__rythm && window.__rythm.time() > window.__rythm.game.notes[0].time - 0.5, null, { timeout: 30000 });
  for (let i = 0; i < 70; i++) {
    const r = await page.evaluate(() => ({ failed: window.__rythm.game.failed, strays: window.__rythm.game.strays }));
    if (r.failed) break;
    await page.keyboard.press(['KeyD', 'KeyF', 'KeyJ', 'KeyK'][i % 4]);
    await page.waitForTimeout(45);
    if (i === 30) await still(page, 'showcase-strays');
  }
  await page.waitForTimeout(3500); // the signal drops

  // 5. Practice: 0:20 to 0:30 at 75%, round twice.
  await page.goto(`${base}/#/play/${song}/${difficulty}`);
  await ready(page);
  await page.waitForTimeout(900);
  await page.getByRole('radio', { name: 'Practice a part' }).click();
  await page.waitForTimeout(800);
  // The loop's end out to 0:30, then its start in to 0:20 (a second a step), short enough to come round.
  await page.getByRole('slider', { name: 'Loop end' }).focus();
  for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(40); }
  await page.getByRole('slider', { name: 'Loop start' }).focus();
  for (let i = 0; i < 20; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(40); }
  await page.waitForTimeout(600);
  // The speeds YouTube has: 50%, then 75%.
  await page.getByRole('radio', { name: '50%' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('radio', { name: '75%' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Practise / }).click();
  await bot(page);
  await page.waitForTimeout(6000);
  await still(page, 'showcase-practice');
  const loop2 = await page.locator('.banner-section .banner-big', { hasText: 'Loop 2' }).waitFor({ timeout: 45000 }).then(() => true, () => false);
  console.log(loop2 ? 'practice looped' : 'practice: no second loop within a minute (a long part)');
  await page.waitForTimeout(4000);
  await stopBot(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  seconds = (await rec.stop()).seconds;
}, { maxSeconds: 420 });

console.log(`video: ${outFile} (${(statSync(outFile).size / 1e6).toFixed(1)} MB, ${seconds.toFixed(0)} s)`);
