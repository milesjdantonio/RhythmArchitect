// Is the song server up? A free server (Render) sleeps when nobody has played for a while and takes
// a minute or so to wake: the first requests just hang meanwhile. The app asks /api/health when it
// opens; no answer within QUICK_MS and it shows the "waking the server" screen (BootScreen) and
// keeps asking until the server answers, holding the screens back so none of them fails on a
// request that was never going to come back.

import { useEffect, useState } from 'react';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
/** An awake server answers well within this (the mock at once). */
export const QUICK_MS = 1500;
/** How long one ask may take (a waking server holds the request), and the pause between asks. */
const ASK_MS = 8000;
const PAUSE_MS = 1500;
/** After this long, the screen says it's taking longer than it should and offers to try again. */
export const GIVE_UP_MS = 180_000;

export type ServerState = 'checking' | 'up' | 'waking' | 'down';

async function ask(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(ASK_MS), cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** The server's state, and when the wait began (ms, performance.now()) and a way to try again. */
export function useServer(): { state: ServerState; since: number; retry: () => void } {
  const [state, setState] = useState<ServerState>('checking');
  const [since, setSince] = useState(() => performance.now());
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    const start = performance.now();
    setSince(start);
    // Quick: up already. Otherwise the waking screen, while the asking goes on.
    const slow = setTimeout(() => { if (live) setState((s) => (s === 'checking' ? 'waking' : s)); }, QUICK_MS);
    (async () => {
      while (live) {
        if (await ask()) { if (live) setState('up'); return; }
        if (!live) return;
        setState('waking');
        if (performance.now() - start > GIVE_UP_MS) { setState('down'); return; }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    })();
    return () => { live = false; clearTimeout(slow); };
  }, [round]);
  return { state, since, retry: () => { setState('waking'); setRound((n) => n + 1); } };
}
