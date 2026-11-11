import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Song } from '../../src/api/types';

const FAKE_YOUTUBE = readFileSync('tests/e2e/fake-youtube.js', 'utf8');

/**
 * YouTube songs without YouTube: the IFrame API is replaced by a fake player that plays a bundled
 * test track (tests/e2e/fake-youtube.js), and Chrome's "share this tab" prompt by a stream of that
 * player's sound plus the page's own (so the listening pass hears its calibration tick).
 * `share: 'decline'` turns the prompt down instead.
 */
async function fakeYouTube(page: Page, { share = 'tab' as 'tab' | 'decline' | 'stop' | 'none', seconds = 40 } = {}) {
  await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YOUTUBE }));
  await page.route('https://i.ytimg.com/**', (r) => r.abort());
  await page.addInitScript(({ share, seconds }) => {
    const w = window as unknown as Record<string, unknown>;
    w.__fakeYtSeconds = seconds;
    // No song splitting or trained mapper in tests (they would download their 172 and 120 MB models).
    localStorage.setItem('rythm-architect:no-stems', '1');
    localStorage.setItem('rythm-architect:no-ensomi', '1');
    // 'none': a browser that can't share a tab's sound at all.
    if (share === 'none') { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }); return; }
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (share === 'decline') throw new DOMException('Permission denied', 'NotAllowedError');
      const yt = w.__fakeYt as { audio: HTMLAudioElement; node?: MediaElementAudioSourceNode };
      const listen = w.__listen as { ctx: () => AudioContext; connectTick: (n: AudioNode) => void };
      const ctx = listen.ctx();
      const dest = ctx.createMediaStreamDestination();
      if (!yt.node) { yt.node = ctx.createMediaElementSource(yt.audio); yt.node.connect(ctx.destination); }
      yt.node.connect(dest);
      listen.connectTick(dest);
      // 'stop': the player stops sharing part-way through.
      if (share === 'stop') setTimeout(() => dest.stream.getAudioTracks()[0].dispatchEvent(new Event('ended')), 3000);
      return dest.stream;
    };
  }, { share, seconds });
}

type Rythm = { time: () => number; game: { lanes: number; notes: { lane: number; time: number; end: number; hold: boolean }[] } };

/** Most tests start past the intro (it plays on every page load). */
const skipIntro = (page: Page) => page.addInitScript(() => sessionStorage.setItem('rythm-architect:intro', 'skip'));

// Plays the current song with perfect timing (or not at all), driving the game's dev test hook.
async function autoplay(page: Page, { skip = false } = {}) {
  await page.waitForFunction(() => (window as unknown as { __rythm?: unknown }).__rythm);
  if (skip) return;
  await page.evaluate(() => {
    const { time, game } = (window as unknown as { __rythm: Rythm }).__rythm;
    const codes = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
    const key = (type: string, code: string) => dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const todo = game.notes.map((n) => ({ n, down: false, up: false }));
    const tick = () => {
      const t = time();
      for (const s of todo) {
        if (!s.down && t >= s.n.time) { key('keydown', codes[s.n.lane]); s.down = true; }
        if (s.down && !s.up && t >= (s.n.hold ? s.n.end + 0.02 : s.n.time + 0.06)) { key('keyup', codes[s.n.lane]); s.up = true; }
      }
      if (todo.some((s) => !s.up)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const startButton = (page: Page) => page.getByRole('button', { name: /^Start/ });
const title = (page: Page) => page.locator('#song-title');
const artist = (page: Page) => page.locator('#song-artist');

test.describe('Rythm Architect', () => {
  test('the intro builds, lights its lanes on D F J K, flies its title into the menu, and replays on reload', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'keyboard');
    await page.goto('/#/');
    const intro = page.getByRole('dialog', { name: 'Rythm Architect' });
    await expect(intro).toBeVisible();
    await expect(page.getByText('Click to start')).toBeVisible();
    await page.keyboard.press('KeyD');
    await page.keyboard.press('KeyK');
    await expect(intro).toBeVisible(); // lane keys play with it
    // Behind the intro the menu is mounted but out of reach.
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    await page.keyboard.press('Space');
    await expect(page.locator('#song-title')).toBeFocused(); // typing goes straight to the search
    await expect(intro).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Name a Song' })).toBeVisible();
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
    await page.keyboard.type('ink');
    await expect(page.locator('#song-title')).toHaveValue('ink');
    await page.reload();
    await expect(intro).toBeVisible(); // every load
    // It waits for a click (after its three seconds), then launches into the menu.
    await page.waitForTimeout(3600);
    await expect(intro).toBeVisible();
    await page.mouse.click(640, 300);
    await expect(intro).toHaveClass(/is-charging/);
    await expect(intro).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Name a Song' })).toBeVisible();
  });

  test('waits for a song, then searches by title and artist and puts one on stage @phone', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/');
    await expect(page.getByText('Name a song to begin')).toBeVisible();
    await expect(page.locator('#now-title')).toHaveCount(0);
    await title(page).fill('restless');
    const row = page.locator('.result', { hasText: 'The Restless Stacks' });
    await expect(row).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate/ })).toBeVisible(); // at the bottom of the search
    await row.click();
    await expect(page.locator('#now-title')).toHaveText('The Restless Stacks');
    await expect(page.locator('.now-playing')).toContainText('Notes'); // note counts under the difficulties
    await expect(page.getByText('Name a song to begin')).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    // The artist narrows it down; nothing matches an unknown artist.
    await artist(page).fill('nobody at all');
    await expect(page.getByText('No beatmap for that yet.')).toBeVisible();
    // Closing the song brings the waiting screen back.
    await page.getByRole('button', { name: 'Close song' }).click();
    await expect(page.getByText('Name a song to begin')).toBeVisible();
  });

  test('music stops when the player moves off a song', async ({ page }) => {
    await skipIntro(page);
    const playing = () => page.evaluate(() => (window as unknown as { __audio: { players: () => number } }).__audio.players());
    await page.goto('/#/song/builtin-ink-and-fury');
    await page.mouse.click(700, 300); // the first click allows sound; the preview starts
    await expect(page.getByRole('button', { name: /Preview playing/ })).toBeVisible({ timeout: 10_000 });
    expect(await playing()).toBe(1);
    // Hop between songs quickly, including while tracks are still loading.
    await artist(page).fill('SchmollCrossword');
    await page.locator('.result', { hasText: 'The Restless Stacks' }).click();
    await page.locator('.result', { hasText: 'Ink and Fury' }).click();
    await page.evaluate(() => { location.hash = '#/song/demo-neon-blueprint'; });
    await expect(page.locator('#now-title')).toHaveText('Neon Blueprint');
    await page.waitForTimeout(2500);
    expect(await playing()).toBe(0); // the synth song plays no track; both real tracks stopped
    await page.locator('.result', { hasText: 'The Restless Stacks' }).click();
    await expect(page.getByRole('button', { name: /Preview playing/ })).toBeVisible({ timeout: 10_000 });
    expect(await playing()).toBe(1);
    // Muting stops it.
    await page.getByRole('button', { name: /Preview playing/ }).click();
    await page.waitForTimeout(500);
    expect(await playing()).toBe(0);
    // Going to the game stops the preview too.
    await page.getByRole('button', { name: /Preview off/ }).click();
    await expect(page.getByRole('button', { name: /Preview playing/ })).toBeVisible({ timeout: 10_000 });
    await page.locator('.play-btn').click();
    await expect(startButton(page)).toBeVisible();
    expect(await playing()).toBe(0);
  });

  test('finds mapped songs, and never makes one up: Generate finds the video and waits to listen', async ({ page }) => {
    await skipIntro(page);
    await fakeYouTube(page);
    await page.goto('/#/');
    // No preset songs and no notes for the mapper: just the title and the artist.
    await expect(page.locator('.chip-btn')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
    await title(page).fill('Brightside');
    await expect(page.locator('.result', { hasText: 'Mr. Brightside' })).toBeVisible(); // mapped: it just comes up
    // Already mapped (typed loosely, without punctuation or capitals): no Generate on offer.
    await title(page).fill('mr brightside');
    await expect(page.locator('.result', { hasText: 'Mr. Brightside' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Generate/ })).toHaveCount(0);
    await title(page).fill('Levitating');
    await artist(page).fill('Dua Lipa');
    await expect(page.getByText('No beatmap for that yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ready to listen' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Listen and map' })).toBeVisible();
    // The video is on screen, where the slot is, and big enough for YouTube's rules.
    const dock = page.locator('.yt-dock[data-shown="true"]');
    await expect(dock).toBeVisible();
    // Once the dialog has finished opening (it scales in, and the video follows its slot).
    await expect.poll(async () => {
      const box = (await dock.boundingBox())!;
      const slot = (await dialog.locator('.video-slot-frame').boundingBox())!;
      return box.height >= 200 && Math.abs(box.x - slot.x) + Math.abs(box.y - slot.y) < 3;
    }, { timeout: 3000 }).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.yt-dock[data-shown="true"]')).toHaveCount(0);
    // Nothing was invented.
    await title(page).fill('Levitatin');
    await expect(page.getByText('No beatmap for that yet.')).toBeVisible();
  });

  test('a video that blocks embedding says so', async ({ page }) => {
    await skipIntro(page);
    await fakeYouTube(page);
    await page.goto('/#/');
    await title(page).fill('https://youtu.be/blockedvid1');
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    // (This server is 127.0.0.1, so the message also says why: label music refuses IP addresses.)
    await expect(page.getByRole('alert')).toContainText(/doesn't allow it to play outside YouTube|opened by IP address/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('maps a song by listening to its video once, lands the tiles on the sound, and plays it in sync with the video', async ({ page, request }) => {
    test.setTimeout(240_000);
    await skipIntro(page);
    await fakeYouTube(page, { seconds: 40 });
    await page.goto('/#/');
    await title(page).fill('Toccata Test');
    await artist(page).fill('E2E');
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    await page.getByRole('button', { name: 'Listen and map' }).click();
    await expect(page.getByRole('dialog', { name: 'Listening' })).toBeVisible();
    // The listening animation: the song fills in as it's heard, and the clock runs.
    await expect(page.locator('.scope-canvas')).toBeVisible();
    await expect(page.locator('.stages .is-now')).toContainText(/0:0[1-9] \/ 0:40/, { timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: /Mapping|Mapped/ })).toBeVisible({ timeout: 90_000 });
    await expect(page).toHaveURL(/#\/song\/yt-e2einkfury1-/, { timeout: 60_000 });
    // The video has its own spot in the bar under the stage, never on the stage.
    await expect(page.locator('.now-playing .now-video')).toBeVisible();
    await expect(page.locator('.stage-wrap .video-slot')).toHaveCount(0);

    const id = decodeURIComponent(/#\/song\/([^?]+)/.exec(page.url())![1]);
    const song = (await (await request.get(`/api/songs/${id}`)).json()) as Song;
    expect(song.source).toMatchObject({ kind: 'youtube', videoId: 'e2eInkFury1', chart: 'listened' });
    expect(song.source.credit).toContain('measured'); // the calibration tick was heard
    // The AI charter (the mock's stand-in for Claude) picked the tiles from what was measured.
    expect(song.report.mapper).toContain('Mock charter');
    expect(song.report.mapper).not.toContain('on-device');
    expect(song.levels?.rate).toBe(30);
    expect(song.levels!.bass.length).toBeGreaterThan(1000);
    // The same audio, mapped offline from the file (the bundled map): the tiles must land on the
    // same sounds. Times in seconds into the audio.
    const ref = (await (await request.get('/api/songs/builtin-ink-and-fury')).json()) as Song;
    const secs = (s: Song) => s.charts.hard.notes.map((n) => (n.t * 60) / s.bpm + (s.source.offset ?? 0));
    const want = secs(ref).filter((x) => x > 1 && x < 38);
    const got = secs(song).filter((x) => x > 1 && x < 38);
    expect(got.length).toBeGreaterThan(want.length * 0.6);
    // Signed: how far each listened tile is from the nearest offline one. The player reports its
    // position a touch ahead of the sound it's mixing; mapping and play read the same clock, so a
    // constant shift cancels in the game. What matters is that it is constant (small spread).
    const near = (g: number) => want.reduce((best, w) => (Math.abs(w - g) < Math.abs(best) ? w - g : best), Infinity);
    const errs = got.map((g) => -near(g)).filter((e) => Math.abs(e) < 0.08);
    expect(errs.length / got.length).toBeGreaterThan(0.6);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const bias = median(errs);
    const spread = median(errs.map((e) => Math.abs(e - bias)));
    expect(Math.abs(bias)).toBeLessThan(0.06);
    expect(spread).toBeLessThan(0.012);
    test.info().annotations.push({ type: 'alignment', description: `${got.length} tiles (offline map ${want.length}); ${Math.round((errs.length / got.length) * 100)}% on an offline-mapped sound; shift ${Math.round(bias * 1000)} ms, spread ${Math.round(spread * 1000)} ms; bpm ${song.bpm} vs ${ref.bpm}; ${song.source.credit}` });

    // Play it: the game's clock follows the video.
    await page.goto(`/#/play/${encodeURIComponent(id)}/medium`);
    await expect(startButton(page)).toBeEnabled({ timeout: 30_000 });
    // The video only shows while the song plays, and the player can't click or focus it.
    await expect(page.locator('.yt-dock[data-shown="true"]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('.yt-dock[data-shown="true"]')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('.yt-dock').evaluate((d) => (d as HTMLElement).inert && getComputedStyle(d).pointerEvents === 'none')).toBe(true);
    await autoplay(page);
    await page.waitForFunction(() => (window as unknown as { __rythm: Rythm }).__rythm.time() > 4, null, { timeout: 30_000 });
    const drift = await page.evaluate(() => {
      const r = (window as unknown as { __rythm: Rythm }).__rythm;
      const v = (window as unknown as { __fakeYt: { audio: HTMLAudioElement } }).__fakeYt.audio.currentTime;
      return { t: r.time(), v };
    });
    // Song time = video time - offset (less output latency): within a frame or two.
    expect(Math.abs(drift.v - (song.source.offset ?? 0) - drift.t)).toBeLessThan(0.08);
    test.info().annotations.push({ type: 'drift', description: `${Math.round((drift.v - (song.source.offset ?? 0) - drift.t) * 1000)} ms (video minus game clock, includes output latency)` });
    await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => {
      const g = (window as unknown as { __rythm: { game: { stats: { counts: Record<string, number> } } } }).__rythm.game;
      return g.stats.counts;
    });
    expect(stats.perfect).toBeGreaterThan(3);
    expect(stats.miss).toBe(0);
  });

  test('says so when sharing is turned down or stopped part-way, and can try again', async ({ page }) => {
    await skipIntro(page);
    await fakeYouTube(page, { share: 'stop' });
    await page.goto('/#/');
    await title(page).fill('Stopped Share Test');
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    await page.getByRole('button', { name: 'Listen and map' }).click();
    await expect(page.getByRole('dialog', { name: 'Listening' })).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Ready to listen' });
    await expect(dialog.getByRole('alert')).toContainText('Sharing stopped before the song ended', { timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page).toHaveURL(/#\/$/); // nothing was made
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a browser that cannot share a tab\'s sound gets a fan-made chart', async ({ page, request }) => {
    await skipIntro(page);
    await fakeYouTube(page, { share: 'none' });
    await page.goto('/#/');
    await title(page).fill('Fixture Song');
    await artist(page).fill('Test Artist');
    await page.getByRole('button', { name: 'Generate beatmap' }).click();
    await expect(page.getByText("can't share a tab's sound")).toBeVisible();
    await expect(page).toHaveURL(/#\/song\/yt-/, { timeout: 30_000 });
    const id = decodeURIComponent(/#\/song\/([^?]+)/.exec(page.url())![1]);
    const song = (await (await request.get(`/api/songs/${id}`)).json()) as Song;
    expect(song.source).toMatchObject({ kind: 'youtube', chart: 'fan', offset: 1 });
    expect(song.source.credit).toContain('fixturemapper');
    expect(song.bpm).toBe(120);
    expect(song.charts.hard.notes.length).toBeGreaterThan(80);
    expect(song.charts.easy.notes.length).toBeLessThan(song.charts.medium.notes.length);
    // It comes up in search like any mapped song.
    await page.goto('/#/');
    await title(page).fill('Fixture');
    await expect(page.locator('.result', { hasText: 'Fixture Song' })).toContainText('YouTube');
  });

  test('the music bank lists every song A to Z on its own screen, and a pick goes on stage', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/song/builtin-the-restless-stacks');
    await expect(page.locator('#now-title')).toHaveText('The Restless Stacks');
    await page.getByRole('button', { name: 'Music bank' }).click();
    await expect(page).toHaveURL(/#\/bank$/);
    await expect(page.getByRole('heading', { name: 'Music Bank' })).toBeVisible();
    // A to Z: the titles in the order shown are sorted (case ignored).
    await expect(page.locator('.bank-group .result').first()).toBeVisible();
    const titles = await page.locator('.bank-group .result-title').allInnerTexts();
    expect(titles.length).toBeGreaterThan(1);
    expect([...titles].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }))).toEqual(titles);
    // The search at the top: typing anywhere lands in it; Esc clears it first.
    await page.keyboard.type('fury');
    await expect(page.locator('.bank-search input')).toHaveValue('fury');
    await expect(page.locator('.bank-group .result')).toHaveCount(1);
    await expect(page.locator('.bank-group .result')).toContainText('Ink and Fury');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bank-search input')).toHaveValue('');
    await expect(page.locator('.bank-group .result')).toHaveCount(titles.length);
    // The rail jumps to a letter; Esc goes back to the menu as it was.
    await page.locator('.bank-rail').getByRole('button', { name: 'Letter T' }).click();
    await expect(page.locator('.bank-rail .is-on')).toHaveText('T');
    await page.keyboard.press('Escape');
    await expect(page.locator('#now-title')).toHaveText('The Restless Stacks');
    // Picking a song in the bank plays it there; going back puts it on stage in the menu.
    await page.getByRole('button', { name: 'Music bank' }).click();
    await page.locator('.bank-group .result', { hasText: 'Ink and Fury' }).click();
    await expect(page.locator('.bank-now-title')).toHaveText('Ink and Fury');
    await expect(page).toHaveURL(/#\/bank$/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#now-title')).toHaveText('Ink and Fury');
  });

  test('the song on stage plays on in the music bank, a pick plays there, and the menu carries on with it', async ({ page, request }) => {
    await skipIntro(page);
    await fakeYouTube(page);
    type Preview = { songId: string; beat0: number; time: () => number };
    const preview = () => page.evaluate(() => {
      const p = (window as unknown as { __preview?: Preview }).__preview;
      return p ? { songId: p.songId, beat0: p.beat0, time: p.time() } : null;
    });
    const players = () => page.evaluate(() => (window as unknown as { __audio: { players: () => number } }).__audio.players());

    // A real-audio song on stage: opening the bank doesn't stop it (the same preview plays on).
    await page.goto('/#/song/builtin-the-restless-stacks');
    await page.mouse.click(700, 300); // the first click allows sound; the preview starts
    await expect(page.getByRole('button', { name: /Preview playing/ })).toBeVisible({ timeout: 10_000 });
    const first = (await preview())!;
    await page.getByRole('button', { name: 'Music bank' }).click();
    await expect(page.getByRole('heading', { name: 'Music Bank' })).toBeVisible();
    await expect(page.locator('.bank-now-title')).toHaveText('The Restless Stacks');
    await page.waitForTimeout(4500); // longer than a hand-over's time limit
    expect((await preview())!.beat0).toBe(first.beat0);
    expect(await players()).toBe(1);

    // Picking another song plays it here, without leaving the bank.
    await page.locator('.bank-group .result', { hasText: 'Ink and Fury' }).click();
    await expect.poll(async () => (await preview())?.songId, { timeout: 10_000 }).toBe('builtin-ink-and-fury');
    await expect(page).toHaveURL(/#\/bank$/);
    await expect(page.locator('.bank-now-title')).toHaveText('Ink and Fury');
    const picked = (await preview())!;
    expect(await players()).toBe(1); // the first song stopped

    // Back on the menu: that song is on stage, and its preview plays on (not started again).
    await page.keyboard.press('Escape');
    await expect(page.locator('#now-title')).toHaveText('Ink and Fury');
    await expect(page.getByRole('button', { name: /Preview playing/ })).toBeVisible();
    const after = (await preview())!;
    expect(after.beat0).toBe(picked.beat0);
    expect(after.time).toBeGreaterThan(picked.time);

    // A YouTube song plays on in the bank too: its video has its spot in the "Now playing" card.
    const match = await (await request.get('/api/youtube?title=Fixture%20Song&artist=Test%20Artist')).json() as { videoId: string };
    const yt = await (await request.post('/api/fan-chart', { data: { title: 'Fixture Song', artist: 'Test Artist', videoId: match.videoId, seconds: 40 } })).json() as Song;
    await page.evaluate((id) => { location.hash = `#/song/${encodeURIComponent(id)}`; }, yt.id);
    await expect(page.locator('#now-title')).toHaveText('Fixture Song');
    const ytState = () => page.evaluate(() => (window as unknown as { __yt: { state: () => number } }).__yt.state());
    await expect.poll(ytState, { timeout: 15_000 }).toBe(1); // playing
    await page.getByRole('button', { name: 'Music bank' }).click();
    await expect(page.locator('.bank-now .video-slot')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await ytState()).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#now-title')).toHaveText('Fixture Song');
    expect(await ytState()).toBe(1);
  });

  test('a YouTube song keeps playing when the music bank opens for the first time', async ({ page, request }) => {
    await skipIntro(page);
    await fakeYouTube(page);
    const match = await (await request.get('/api/youtube?title=Fixture%20Song&artist=Test%20Artist')).json() as { videoId: string };
    const yt = await (await request.post('/api/fan-chart', { data: { title: 'Fixture Song', artist: 'Test Artist', videoId: match.videoId, seconds: 40 } })).json() as Song;
    await page.goto(`/#/song/${encodeURIComponent(yt.id)}`);
    await page.mouse.click(700, 300); // the first click allows sound; the preview starts
    const ytState = () => page.evaluate(() => (window as unknown as { __yt: { state: () => number } }).__yt.state());
    await expect.poll(ytState, { timeout: 15_000 }).toBe(1); // playing
    const time = () => page.evaluate(() => (window as unknown as { __preview: { time: () => number } }).__preview.time());
    // The bank hasn't been opened yet this page load: the video goes straight to its spot there.
    await page.getByRole('button', { name: 'Music bank' }).click();
    for (let i = 0; i < 12; i++) { expect(await ytState()).toBe(1); await page.waitForTimeout(100); }
    await expect(page.locator('.bank-now-title')).toHaveText('Fixture Song');
    const t1 = await time();
    await page.waitForTimeout(1000);
    expect(await time()).toBeGreaterThan(t1 + 0.7);
  });

  test('favourites a song and finds it in the favourites drop-down', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/song/builtin-the-restless-stacks');
    await expect(page.locator('#now-title')).toHaveText('The Restless Stacks');
    await page.locator('.now-playing').getByRole('button', { name: 'Add to favourites' }).click();
    await expect(page.locator('.now-playing').getByRole('button', { name: 'Remove from favourites' })).toBeVisible();
    await page.getByRole('button', { name: /Favorites/ }).click();
    const favs = page.locator('#fav-panel');
    await expect(favs.locator('.result', { hasText: 'The Restless Stacks' })).toBeVisible();
    await favs.getByPlaceholder('Search favorites').fill('zzz');
    await expect(favs.getByText('No favourites match that.')).toBeVisible();
    await favs.getByPlaceholder('Search favorites').fill('restless');
    await expect(favs.locator('.result')).toHaveCount(1);
    await favs.getByRole('button', { name: 'Remove The Restless Stacks from favourites' }).click();
    await expect(favs.locator('.result', { hasText: 'The Restless Stacks' })).toHaveCount(0);
  });

  test('plays the test song on Easy perfectly, shows the results and saves the best score', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/play/demo-neon-blueprint/easy');
    await startButton(page).click();
    await autoplay(page);
    // The run panel, with live counts; a milestone is called out on the right.
    await expect(page.locator('.hud-panel .hud-counts')).toBeVisible();
    await expect(page.locator('.callout-combo .callout-word')).toContainText('Combo', { timeout: 40_000 });
    // The finale plays before the results.
    await expect(page.locator('.banner-fever .banner-big')).toHaveText(/Full combo|Clear/, { timeout: 70_000 });
    const results = page.getByRole('dialog', { name: /Full combo|Flawless build|Song cleared/ });
    await expect(results).toBeVisible({ timeout: 70_000 });
    await expect(results.locator('.grade')).toHaveText(/S|A/);
    await expect(results.getByText('New best')).toBeVisible();
    await expect(results.getByText('Score saved.')).toBeVisible();
    await expect(results.getByRole('link')).toHaveCount(1); // Play again and Return to main menu, nothing else
    await results.getByRole('link', { name: /Return to main menu/ }).click();
    await expect(page.locator('.now-playing .diff-best').first()).toContainText(/Best (S|A)/);
  });

  test('dev tools: autoplay plays a run, shows the queue, and the score is not saved', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/play/demo-neon-blueprint/easy');
    await expect(startButton(page)).toBeEnabled();
    await page.keyboard.press('Backquote');
    const dev = page.getByRole('complementary', { name: 'Dev tools' });
    await expect(dev).toBeVisible();
    await dev.getByRole('radio', { name: 'Perfect' }).click();
    await startButton(page).click();
    await expect(page.locator('.hud-bot')).toHaveText('Autoplay');
    await expect(dev.locator('.dev-next li').first()).toContainText(/tap|hold/);
    await expect(dev.getByText(/Perfect/).first()).toBeVisible();
    const results = page.getByRole('dialog', { name: /Full combo|Flawless build|Song cleared/ });
    await expect(results).toBeVisible({ timeout: 70_000 });
    await expect(results.getByText('Autoplay run: not saved.')).toBeVisible();
    await expect(results.locator('.grade')).toHaveText('S');
  });

  test('dev tools delete a mapped song', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/');
    await title(page).fill('Brightside');
    await page.locator('.result', { hasText: 'Mr. Brightside' }).click();
    await page.locator('.play-btn').click();
    await expect(startButton(page)).toBeEnabled();
    await page.keyboard.press('Backquote');
    const dev = page.getByRole('complementary', { name: 'Dev tools' });
    await dev.getByRole('button', { name: 'Delete map' }).click();
    await dev.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Name a Song' })).toBeVisible();
    await title(page).fill('Brightside');
    await expect(page.getByText('No beatmap for that yet.')).toBeVisible();
  });

  test('starts a real-audio track and pauses and resumes with Escape', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/play/builtin-ink-and-fury/medium');
    await expect(page.locator('.overlay-card')).toContainText('real audio');
    await expect(startButton(page)).toBeEnabled();
    await page.keyboard.press('Enter');
    await autoplay(page);
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    const time = () => page.evaluate(() => (window as unknown as { __rythm: Rythm }).__rythm.time());
    const t1 = await time();
    await page.waitForTimeout(600);
    expect(Math.abs((await time()) - t1)).toBeLessThan(0.05); // the clock stops while paused
    await page.keyboard.press('Escape');
    await expect(paused).toBeHidden();
  });

  test('the Map Syncer checks a track against its map, puts a wrong offset right, and resyncs', async ({ page }) => {
    await skipIntro(page);
    const dev = page.getByRole('complementary', { name: 'Dev tools' });
    const status = dev.locator('.dev-sync p').first();
    // The built-in tracks are mapped on their sound: nothing to move.
    for (const id of ['builtin-ink-and-fury', 'builtin-the-restless-stacks']) {
      await page.goto(`/#/play/${id}/medium`);
      await expect(startButton(page)).toBeEnabled({ timeout: 20_000 });
      if (id === 'builtin-ink-and-fury') await page.keyboard.press('Backquote'); // stays open after
      await expect(status).toHaveText('Checked against the track: in sync.');
    }
    // The same song with beat 0 saved 60 ms late: the syncer moves the tiles back onto the sound.
    await page.route('**/api/songs/builtin-ink-and-fury', async (r) => {
      const res = await r.fetch();
      const song = (await res.json()) as Song;
      song.source.offset = (song.source.offset ?? 0) + 0.06;
      await r.fulfill({ response: res, json: song });
    });
    await page.goto('/#/play/builtin-ink-and-fury/medium');
    await page.reload();
    await expect(startButton(page)).toBeEnabled({ timeout: 20_000 });
    await expect(status).toHaveText(/tiles moved −?-?(5[5-9]|6[0-5]) ms/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as unknown as { __rythm?: unknown }).__rythm);
    await page.waitForTimeout(800);
    await dev.getByRole('button', { name: 'Resync' }).click();
    await expect(dev.getByRole('button', { name: 'Resynced' })).toBeVisible();
    await expect(status).toHaveText(/tiles moved/);
    // No hand-set offset anywhere any more: the settings have Resync in its place.
    await page.keyboard.press('Escape');
    await page.goto('/#/');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings.getByLabel('Audio offset')).toHaveCount(0);
    await settings.getByRole('button', { name: 'Resync' }).click();
    await expect(settings.getByRole('button', { name: 'Resynced' })).toBeVisible();
  });

  test('fails Hard when nothing is played', async ({ page }) => {
    await skipIntro(page);
    await page.goto('/#/play/demo-neon-blueprint/hard');
    await expect(startButton(page)).toBeEnabled();
    await page.keyboard.press('Enter');
    await autoplay(page, { skip: true });
    // The signal drops before the results: the flatline and the words, over a stage going dark.
    await expect(page.locator('.signal-lost')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('.play')).toHaveClass(/is-failing/);
    const results = page.getByRole('dialog', { name: 'The signal dropped' });
    await expect(results).toBeVisible({ timeout: 40_000 });
    await expect(results.locator('.grade')).toHaveText('F');
  });

  test('works on a phone: start screen and touch lanes @phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone only');
    await skipIntro(page);
    await page.goto('/#/play/demo-neon-blueprint/easy');
    await startButton(page).tap();
    await page.waitForFunction(() => (window as unknown as { __rythm?: unknown }).__rythm);
    await expect(page.locator('.hud-top')).toBeVisible();
  });
});
