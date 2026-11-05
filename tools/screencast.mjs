// Records a Playwright page to a .webm (picture only), for the videos in docs/media.
//
// How: Chrome's screencast (CDP) sends JPEG frames; they're paced to a steady frame rate (the
// latest frame repeated for every slot of wall-clock time) and piped into the ffmpeg that's
// already in the Playwright cache. Nothing is downloaded.
//
//   const rec = await startRecording(page, outFile);   // starts at once
//   ...                                                 // drive the page
//   const { seconds } = await rec.stop();

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

export function findFfmpeg() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'));
  if (!existsSync(cache)) return null;
  for (const d of readdirSync(cache).filter((x) => /^ffmpeg-\d+$/.test(x)).sort().reverse()) {
    for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
      if (existsSync(join(cache, d, exe))) return join(cache, d, exe);
    }
  }
  return null;
}

/** Starts recording the page (its viewport size) into `outFile`. */
export async function startRecording(page, outFile, { fps = 25, scale = '960:540' } = {}) {
  const ffmpegPath = findFfmpeg();
  if (!ffmpegPath) throw new Error('No ffmpeg in the Playwright cache. Run `npx playwright install ffmpeg` once (ask first).');
  const vp = page.viewportSize() ?? { width: 1280, height: 720 };
  const ffmpeg = spawn(ffmpegPath, [
    '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-y', '-an', '-c:v', 'vp8', '-b:v', '1000k', '-maxrate', '1400k', '-bufsize', '2000k', '-qmin', '10', '-qmax', '63', '-deadline', 'good', '-cpu-used', '4',
    '-vf', `scale=${scale}`, outFile,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ffmpeg.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));

  const cdp = await page.context().newCDPSession(page);
  let latest = null;
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    latest = Buffer.from(data, 'base64');
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch { /* page closing */ }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  const started = Date.now();
  let written = 0;
  const pump = setInterval(() => {
    if (!latest) return;
    const due = Math.floor(((Date.now() - started) / 1000) * fps);
    while (written < due) { ffmpeg.stdin.write(latest); written++; }
  }, 1000 / fps);

  return {
    async stop() {
      try { await cdp.send('Page.stopScreencast'); } catch { /* page closed */ }
      clearInterval(pump);
      ffmpeg.stdin.end();
      await done;
      return { seconds: written / fps };
    },
  };
}
