// Client-side cache of the songs the player has opened, and the search over every mapped song.
// The backend is the source of truth; this keeps the stage, the game and search results in step
// after a new map, a new best score or a deletion without refetching everything.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '../api/client';
import type { Song, SongPatch, SongSummary } from '../api/types';

const cache = new Map<string, Song>();
const listeners = new Set<() => void>();
/** Bumped on every change, so searches re-run after a new map or score. */
let version = 0;
const changed = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function cachedSong(id: string) { return cache.get(id); }

export async function fetchSong(id: string): Promise<Song> {
  const hit = cache.get(id);
  if (hit) return hit;
  const song = await api.getSong(id);
  upsert(song);
  return song;
}

export function upsert(song: Song) {
  cache.set(song.id, song);
  changed();
}

export async function updateSong(id: string, patch: SongPatch) {
  const before = cache.get(id);
  if (before) { // optimistic
    const { offset, ...rest } = patch;
    upsert({ ...before, ...rest, ...(offset !== undefined ? { source: { ...before.source, offset } } : {}) });
  }
  try {
    upsert(await api.updateSong(id, patch));
  } catch (e) {
    if (before) upsert(before);
    throw e;
  }
}

export async function deleteSong(id: string) {
  await api.deleteSong(id);
  cache.delete(id);
  changed();
}

/** The song with this id, fetched when needed. */
export function useSong(id: string | undefined): { song: Song | null; status: 'idle' | 'loading' | 'ready' | 'missing' } {
  const song = useSyncExternalStore(subscribe, () => (id ? cache.get(id) ?? null : null));
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  useEffect(() => {
    if (!id) { setStatus('idle'); return; }
    if (cache.has(id)) { setStatus('ready'); return; }
    let live = true;
    setStatus('loading');
    fetchSong(id).then(() => live && setStatus('ready')).catch(() => live && setStatus('missing'));
    return () => { live = false; };
  }, [id]);
  return { song, status: song ? 'ready' : status };
}

export interface SearchState {
  results: SongSummary[];
  status: 'idle' | 'searching' | 'done' | 'error';
  error?: string;
}

/** Searches mapped songs as the player types (debounced; stale requests are cancelled). */
export function useSearch(title: string, artist: string): SearchState & { retry: () => void } {
  const t = title.trim(), a = artist.trim();
  return useQuery(!t && !a ? null : `${t}\n${a}`, (signal) => api.search(t, a, signal));
}

/** Every mapped song, A to Z (the music bank). */
export function useLibrary(): SearchState & { retry: () => void } {
  return useQuery('library', (signal) => api.library(signal));
}

/** The player's favourites, filtered by `q` (title or artist). Loads only while `open`. */
export function useFavorites(q: string, open: boolean): SearchState & { retry: () => void } {
  const query = q.trim();
  return useQuery(open ? `fav\n${query}` : null, (signal) => api.favorites(query, signal));
}

function useQuery(key: string | null, run: (signal: AbortSignal) => Promise<SongSummary[]>): SearchState & { retry: () => void } {
  const v = useSyncExternalStore(subscribe, () => version);
  const [state, setState] = useState<SearchState>({ results: [], status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key === null) { setState({ results: [], status: 'idle' }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: 'searching', error: undefined }));
    const timer = setTimeout(() => {
      run(ctrl.signal)
        .then((results) => setState({ results, status: 'done' }))
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          setState({ results: [], status: 'error', error: e instanceof ApiError ? e.message : 'Search failed. Try again.' });
        });
    }, 160);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [key, v, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
