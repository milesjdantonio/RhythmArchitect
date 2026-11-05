import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Use the Chromium already in the Playwright cache (or Edge) so tests never download a browser.
// Same rule as tools/browser.mjs, ported from TerraSim.
function cachedChromium(): string | undefined {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const exe = join(cache, d, sub);
        if (existsSync(exe)) return exe;
      }
    }
  }
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  return existsSync(edge) ? edge : undefined;
}
const executablePath = cachedChromium();

// End-to-end tests run against their own dev server and their own mock database
// (.data/e2e-songs.json, reset before every run), with composing sped up.
const PORT = 5180;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 860 },
    launchOptions: { executablePath, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions: { executablePath, args: ['--mute-audio'] } } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath, args: ['--mute-audio'] } }, grep: /@phone/ },
  ],
  webServer: {
    command: `npx vite --configLoader runner --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    // YouTube songs come from fixtures: every video search finds the fake player's test track,
    // and fan charts come from tests/fixtures/osu (no network).
    env: { MOCK_API_FILE: '.data/e2e-songs.json', MOCK_API_SPEED: '0.15', MOCK_YT_VIDEO: 'e2eInkFury1', MOCK_OSU_DIR: 'tests/fixtures/osu' },
  },
});
