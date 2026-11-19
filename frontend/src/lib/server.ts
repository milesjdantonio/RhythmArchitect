// Is the song server up? A free server (Render) sleeps when nobody has played for a while and takes
// a minute or so to wake: requests just hang meanwhile (and are answered once it's up). The app asks
// /api/health once when it opens, without holding anything back; while there's no answer the places
// that are waiting on the server (the searches, the bank, a song loading) say so where they are
// (ServerNote), and the asking goes on until it answers.

import { useSyncExternalStore } from 'react';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
/** An awake server answers well within this (the mock at once): until then nothing is said. */
export const QUICK_MS = 1500;
/** How long one ask may take (a waking server holds the request), and the pause between asks. */
const ASK_MS = 8000;
const PAUSE_MS = 1500;
/** After this long, it's taking longer than it should: say so and offer to try again. */
export const GIVE_UP_MS = 180_000;

export type ServerState = 'checking' | 'up' | 'waking' | 'down';

/** `ups`: how many times it has come up (lists that failed while it slept ask again when it does). */
interface Snapshot { state: ServerState; since: number; ups: number }
let snap: Snapshot = { state: 'checking', since: typeof performance !== 'undefined' ? performance.now() : 0, ups: 0 };
const listeners = new Set<() => void>();
let round = 0;
let started = false;

function set(state: ServerState, since = snap.since) {
  if (state === snap.state && since === snap.since) return;
  snap = { state, since, ups: snap.ups + (state === 'up' && snap.state !== 'up' ? 1 : 0) };
  listeners.forEach((l) => l());
}

async function ask(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(ASK_MS), cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Asks until the server answers (or GIVE_UP_MS). Started once; `retry` starts it again. */
function watch() {
  const mine = ++round;
  const start = performance.now();
  set(snap.state === 'up' ? 'up' : 'checking', start);
  const slow = setTimeout(() => { if (mine === round && snap.state === 'checking') set('waking'); }, QUICK_MS);
  void (async () => {
    while (mine === round) {
      if (await ask()) { clearTimeout(slow); if (mine === round) set('up'); return; }
      if (mine !== round) return;
      set('waking');
      if (performance.now() - start > GIVE_UP_MS) { set('down'); return; }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  })();
}

/** Starts watching the server (once, when the app opens). */
export function startServerWatch() {
  if (started) return;
  started = true;
  watch();
}

/** Try again (after it gave up). */
export function retryServer() {
  set('waking', performance.now());
  watch();
}

/** Whether the server is (still) waking up. */
export const isWaking = (s: ServerState) => s === 'waking' || s === 'down';

/** The server's state and when the wait began (ms, performance.now()). */
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const current = () => snap;

export function useServer(): Snapshot & { retry: () => void } {
  const s = useSyncExternalStore(subscribe, current);
  return { ...s, retry: retryServer };
}
