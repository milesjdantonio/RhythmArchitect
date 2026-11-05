// Safe headless browser for checks and screenshots (ported from TerraSim).
//
// - one test browser at a time (a lock file in the system temp folder)
// - a hard time limit, after which the browser's whole process tree is killed and the script exits
// - the browser is closed on every exit path (normal end, error, Ctrl+C)
// - uses the Chromium already in the Playwright cache, or Microsoft Edge, so nothing is downloaded
//
// Usage from another script:
//   import { withBrowser } from './browser.mjs';
//   await withBrowser(async (browser) => { ... }, { maxSeconds: 120 });
//   Extra Chrome flags: { args: ['--auto-accept-this-tab-capture'] }. { mute: false } drops
//   --mute-audio (pair it with --disable-audio-output to render sound without playing it).
//   { headless: false } opens a real window (headless Chrome's tab capture carries no sound).

import { chromium } from '@playwright/test';
import { existsSync, readdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const LOCK = join(tmpdir(), 'rythm-architect-test-browser.lock');

function findChromium() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'));
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const exe = join(cache, d, sub);
        if (existsSync(exe)) return exe;
      }
    }
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (existsSync(edge)) return edge;
  return undefined; // let Playwright use its own default
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function takeLock() {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid && pidAlive(pid)) {
      throw new Error(`Another test browser is running (pid ${pid}). Wait for it to finish.`);
    }
  }
  writeFileSync(LOCK, String(process.pid));
}

function dropLock() {
  try { if (Number(readFileSync(LOCK, 'utf8')) === process.pid) unlinkSync(LOCK); } catch {}
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch {}
}

export async function withBrowser(fn, { maxSeconds = 180, args = [], mute = true, headless = true } = {}) {
  takeLock();
  let browser;
  let pid;
  const cleanup = () => {
    killTree(pid);
    dropLock();
  };
  const onSignal = () => { cleanup(); process.exit(130); };
  process.once('exit', cleanup);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const timer = setTimeout(() => {
    console.error(`Browser time limit (${maxSeconds}s) reached; closing it.`);
    cleanup();
    process.exit(124);
  }, maxSeconds * 1000);
  timer.unref();
  let server;
  try {
    // launchServer exposes the browser process, so its whole tree can be killed if needed.
    server = await chromium.launchServer({
      executablePath: findChromium(),
      headless,
      args: [...(mute ? ['--mute-audio'] : []), '--disable-extensions', '--no-first-run', '--disable-background-networking', '--enable-unsafe-swiftshader', ...args],
    });
    pid = server.process()?.pid;
    browser = await chromium.connect(server.wsEndpoint());
    return await fn(browser);
  } finally {
    clearTimeout(timer);
    try { await browser?.close(); } catch {}
    try { await server?.close(); } catch {}
    cleanup();
  }
}
