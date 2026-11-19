// The song's videos on YouTube, for the player to preview and choose from before mapping one
// (GET /api/youtube/search). A search by name costs YouTube quota (about 1% of a day's), so it runs
// only once the typing has paused, never for a song already mapped, and each one is kept for the
// session (the server keeps them too).

import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { VideoMatch } from '../api/types';
import { useServer } from '../lib/server';

/** How long the typing must pause before YouTube is searched. */
export const PAUSE_MS = 900;
/** The shortest title that is searched (a pasted link is always longer). */
const MIN_TITLE = 3;

export interface VideoSearch {
  /** The videos, best first (the last search's, while a new one is waiting or running). */
  results: VideoMatch[];
  /** idle: nothing to search. waiting: for the typing to pause. */
  status: 'idle' | 'waiting' | 'searching' | 'done' | 'error';
  error?: string;
  retry: () => void;
}

const kept = new Map<string, VideoMatch[]>();
const keyOf = (t: string, a: string) => `${t.toLowerCase().replace(/\s+/g, ' ')}\n${a.toLowerCase().replace(/\s+/g, ' ')}`;

/** The videos for what was typed, while `on` (the typed song isn't already mapped). */
export function useVideoSearch(title: string, artist: string, on: boolean): VideoSearch {
  const t = title.trim(), a = artist.trim();
  const key = on && t.length >= MIN_TITLE ? keyOf(t, a) : null;
  const [state, setState] = useState<Omit<VideoSearch, 'retry'>>({ results: [], status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  // Asked again when the song server comes up (a search that failed while it slept).
  const { ups } = useServer();
  useEffect(() => {
    if (key === null) { setState({ results: [], status: 'idle' }); return; }
    const done = kept.get(key);
    if (done) { setState({ results: done, status: 'done' }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ results: s.results, status: 'waiting' }));
    const timer = setTimeout(() => {
      setState((s) => ({ results: s.results, status: 'searching' }));
      api.searchVideos(t, a, ctrl.signal)
        .then((results) => { kept.set(key, results); setState({ results, status: 'done' }); })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setState({ results: [], status: 'error', error: e instanceof ApiError ? e.message : "Couldn't search YouTube. Try again." });
        });
    }, PAUSE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, attempt, ups]);
  return { ...state, retry: () => { if (key) kept.delete(key); setAttempt((n) => n + 1); } };
}
