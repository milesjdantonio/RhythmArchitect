// YouTube playback: one embedded player for the whole app (the IFrame Player API).
//
// YouTube's rules for embeds shape this module:
//   - The player stays visible while it plays, at least 200×200 px, and nothing is drawn over it.
//     It lives in a fixed "dock" above everything; screens mark where it should sit with a
//     <VideoSlot> and the dock follows that spot. With no slot on screen it's paused and hidden.
//   - It only shows while the song is playing (a slot can ask to show the cued video too), and
//     players never touch it: it's inert, so its links and buttons can't be clicked or focused.
//   - The page never gets the audio. The game's clock follows the player (clock.ts) instead.
// The player is created once and moved, never re-created, so a song doesn't reload between the
// stage and the game.

import { FollowClock } from './clock';
import { ORDER, nextFrame } from '../lib/ticker';

/** The subset of YT.Player this app uses. */
interface YTPlayer {
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  getIframe?(): HTMLIFrameElement;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
}
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export class VideoError extends Error {}

/** Messages for the player's error codes. */
const ERRORS: Record<number, string> = {
  2: "YouTube didn't accept that video id.",
  5: "This browser can't play that YouTube video.",
  100: 'That YouTube video was removed or made private.',
  101: "That video's owner doesn't allow it to play outside YouTube. Try another upload of the song.",
  150: "That video's owner doesn't allow it to play outside YouTube. Try another upload of the song.",
  153: "YouTube refused to play here (the page's address wasn't sent). Reload and try again.",
};

let api: Promise<YTNamespace> | null = null;
let ready: Promise<YTPlayer> | null = null;
let player: YTPlayer | null = null;
let dock: HTMLDivElement | null = null;
let cued: string | null = null;
let state: number = YT_STATE.UNSTARTED;
let lastError: VideoError | null = null;
/** What the app last asked for, so a pause from inside the player can be told apart. */
let intent: 'play' | 'pause' = 'pause';
/** The muted run-up in ytWarm: playing, but not the song yet, so not shown. */
let warming = false;
/** The video has played since it was last asked to (see ytStarted). */
let playedSinceAsk = false;
let volume = 80;
const clock = new FollowClock();
const listeners = new Set<(state: number) => void>();
const errorListeners = new Set<(e: VideoError) => void>();

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!api) {
    api = new Promise<YTNamespace>((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => { api = null; reject(new VideoError("YouTube didn't load. Check the connection and try again.")); }, 15_000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); prev?.(); resolve(window.YT!); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { clearTimeout(timer); api = null; reject(new VideoError("YouTube didn't load. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return api;
}

function getPlayer(): Promise<YTPlayer> {
  if (!ready) {
    ready = loadApi().then((YT) => new Promise<YTPlayer>((resolve, reject) => {
      dock = document.createElement('div');
      dock.className = 'yt-dock';
      dock.dataset.shown = 'false';
      dock.inert = true;
      dock.setAttribute('aria-hidden', 'true');
      const mount = document.createElement('div');
      dock.appendChild(mount);
      document.body.appendChild(dock);
      const p = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => {
            player = p;
            p.setVolume(volume);
            p.getIframe?.()?.setAttribute('tabindex', '-1');
            resolve(p);
          },
          onStateChange: (e: { data: number }) => {
            state = e.data;
            if (state === YT_STATE.PLAYING) playedSinceAsk = true;
            listeners.forEach((l) => l(state));
          },
          onError: (e: { data: number }) => {
            let msg = ERRORS[e.data] ?? `YouTube couldn't play the video (error ${e.data}).`;
            // Label music refuses pages served from a bare IP address (127.0.0.1) but plays on localhost.
            if ((e.data === 101 || e.data === 150) && /^[\d.]+$|^\[/.test(location.hostname)) {
              msg = `YouTube won't play this video on a page opened by IP address (${location.hostname}). Open the game at localhost instead.`;
            }
            lastError = new VideoError(msg);
            errorListeners.forEach((l) => l(lastError!));
          },
        },
      });
      setTimeout(() => { if (!player) reject(new VideoError("YouTube's player didn't start. Reload and try again.")); }, 15_000);
    }));
    ready.catch(() => { ready = null; });
  }
  return ready;
}

const waitFor = (test: () => boolean, ms: number, step = 50) => new Promise<boolean>((resolve) => {
  const t0 = performance.now();
  const tick = () => {
    if (test()) resolve(true);
    else if (performance.now() - t0 > ms) resolve(false);
    else setTimeout(tick, step);
  };
  tick();
});

/** Loads a video into the player (without playing it). Resolves to its length in seconds (0 if unknown yet). */
export async function ytCue(videoId: string): Promise<number> {
  const p = await getPlayer();
  if (cued !== videoId) {
    lastError = null;
    cued = videoId;
    clock.reset();
    intent = 'pause';
    p.cueVideoById({ videoId, startSeconds: 0 });
    await waitFor(() => state === YT_STATE.CUED || !!lastError, 8000);
  }
  if (lastError) throw lastError;
  return p.getDuration() || 0;
}

/**
 * Gets a video ready to start without delay: plays it muted until the video itself is running
 * (past any ad), then rewinds and pauses. Resolves to its length in seconds.
 */
export async function ytWarm(videoId: string, expectSeconds?: number): Promise<number> {
  const p = await getPlayer();
  await ytCue(videoId);
  warming = true;
  try {
    p.mute();
    intent = 'play';
    p.playVideo();
    // An ad reports its own length; wait for the song's (or 20 s at most).
    await waitFor(() => {
      if (lastError) return true;
      if (state !== YT_STATE.PLAYING || p.getCurrentTime() <= 0.05) return false;
      const d = p.getDuration();
      return !expectSeconds || Math.abs(d - expectSeconds) < 3;
    }, 20_000);
    intent = 'pause';
    p.pauseVideo();
    p.seekTo(0, true);
    p.unMute();
    p.setVolume(volume);
    if (lastError) throw lastError;
    await waitFor(() => state === YT_STATE.PAUSED || state === YT_STATE.CUED, 1500);
  } finally {
    warming = false;
  }
  return p.getDuration() || 0;
}

/** Plays the cued video from `seconds`. */
export function ytPlayFrom(seconds: number) {
  if (!player) return;
  intent = 'play';
  playedSinceAsk = false;
  player.seekTo(Math.max(0, seconds), true);
  player.playVideo();
}
/**
 * Whether the video has played since it was last asked to (ytPlayFrom). Until it has, a "paused"
 * report is YouTube starting up (settling a seek, or its earlier warm-up's pause), not a pause.
 */
export const ytStarted = () => playedSinceAsk;
/** Asks again (YouTube sometimes stays paused after being asked to play). */
export function ytNudge() { if (intent === 'play') player?.playVideo(); }
export function ytPause() { intent = 'pause'; player?.pauseVideo(); }
export function ytResume() { intent = 'play'; player?.playVideo(); }

/** The video's position in seconds, smoothed (see clock.ts). */
export function ytTime(): number {
  if (!player) return 0;
  return clock.read(player.getCurrentTime() || 0, state === YT_STATE.PLAYING);
}
/** Drops the clock's smoothing: the next read takes the video's position as it is (Resync). */
export function ytResync() { clock.reset(); }
export const ytState = () => state;
export const ytDuration = () => player?.getDuration() || 0;
export const ytIntent = () => intent;
export const ytCued = () => cued;
export function ytSetVolume(v: number) {
  volume = Math.round(Math.max(0, Math.min(100, v)));
  player?.setVolume(volume);
}
export function ytOnState(fn: (state: number) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function ytOnError(fn: (e: VideoError) => void) { errorListeners.add(fn); return () => { errorListeners.delete(fn); }; }

// ---------------------------------------------------------------- the dock

const slots: HTMLElement[] = [];
let follow = 0;
let shownRect = '';
let shownSlot: HTMLElement | null = null;
let glideUntil = 0;

// Where the slot is costs a layout read (getBoundingClientRect), which makes the browser lay the
// page out again right then if anything changed since the last frame (the HUD, a judgement word).
// So it's read every frame only while the slot may be moving (just after it changes, the window
// resizes or scrolls, the slot resizes, the video shows or hides: for MOVING_MS), else four times
// a second, which catches anything else that moves it.
const MOVING_MS = 900;
const SETTLED_EVERY_MS = 250;
let movingUntil = 0;
let measureAt = 0;
let watched: HTMLElement | null = null;
const moving = () => { movingUntil = performance.now() + MOVING_MS; };
const slotSize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(moving) : null;
if (typeof window !== 'undefined') {
  addEventListener('resize', moving, { passive: true });
  addEventListener('scroll', moving, { passive: true, capture: true });
}
function watch(slot: HTMLElement | null) {
  if (slot === watched) return;
  if (watched) slotSize?.unobserve(watched);
  watched = slot;
  if (slot) slotSize?.observe(slot);
  moving();
}

// The dock runs with the UI's per-frame work, never put off: YouTube won't play a hidden player,
// and it is this that shows the player when the video starts.
function place() {
  follow = 0;
  if (!dock) { if (slots.length) follow = nextFrame(place, ORDER.ui); return; }
  const slot = slots[slots.length - 1];
  watch(slot ?? null);
  if (!slot) {
    dock.dataset.shown = 'false';
    shownRect = '';
    shownSlot = null;
    // Hidden means not playing (the rules ask for a visible player).
    if (intent === 'play') ytPause();
    return;
  }
  // Shown while the song plays; a slot with data-idle="show" (the Generate dialog) shows the
  // cued video before that too. The slot's frame comes and goes with it (data-live).
  const live = intent === 'play' && !warming && (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING);
  const visible = live || slot.dataset.idle === 'show';
  const figure = slot.closest<HTMLElement>('.video-slot') ?? slot;
  if (figure.dataset.live !== String(visible)) { figure.dataset.live = String(visible); moving(); }
  // Moving to a new spot (another screen's slot) glides; following its own slot is exact.
  const now = performance.now();
  if (slot !== shownSlot) {
    if (shownSlot && visible && dock.dataset.shown === 'true' && !matchMedia('(prefers-reduced-motion: reduce)').matches) glideUntil = now + 520;
    shownSlot = slot;
  }
  const gliding = now < glideUntil;
  if ((dock.dataset.glide === 'true') !== gliding) dock.dataset.glide = String(gliding);
  if (now < movingUntil || now >= measureAt || !shownRect) {
    measureAt = now + SETTLED_EVERY_MS;
    const r = slot.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (key !== shownRect) {
      // It moved by itself (an animation, a layout change): follow it every frame for a while.
      if (shownRect) moving();
      shownRect = key;
      dock.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
      dock.style.width = `${Math.round(r.width)}px`;
      dock.style.height = `${Math.round(r.height)}px`;
    }
  }
  if (dock.dataset.shown !== String(visible)) dock.dataset.shown = String(visible);
  follow = nextFrame(place, ORDER.ui);
}

/** Puts the player over `el` until the returned function is called. The newest slot wins. */
export function dockInto(el: HTMLElement): () => void {
  slots.push(el);
  getPlayer().catch(() => {});
  if (!follow) follow = nextFrame(place, ORDER.ui);
  return () => {
    const i = slots.lastIndexOf(el);
    if (i >= 0) slots.splice(i, 1);
    if (!follow) follow = nextFrame(place, ORDER.ui);
  };
}

/** Dev/test hook. */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __yt: unknown }).__yt = { time: ytTime, state: ytState, cued: ytCued, raw: () => player?.getCurrentTime() ?? 0, dock: () => ({ follow, slots: slots.length, intent, warming, shown: dock?.dataset.shown }) };
}
