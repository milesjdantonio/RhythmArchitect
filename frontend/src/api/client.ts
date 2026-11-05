// Typed client for the songs, search and mapper API. Point VITE_API_BASE_URL at the real
// backend; when it is empty the app talks to the mock in mock-server/ on the same origin.

import type { ChartPlan, ChartRequest, FanChartRequest, NewSong, ScoreSubmit, SearchResults, Song, SongList, SongPatch, SongSummary, VideoMatch } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError("Can't reach the song server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

/** A result list, or none (a reply that isn't one, e.g. while the server restarts, mustn't break the page). */
const listOf = (r: SearchResults | undefined): SongSummary[] => (Array.isArray(r?.results) ? r.results : []);

export const api = {
  listSongs: () => request<SongList>('/songs').then((r) => r.songs),
  getSong: (id: string) => request<Song>(`/songs/${encodeURIComponent(id)}`),
  updateSong: (id: string, patch: SongPatch) => request<Song>(`/songs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSong: (id: string) => request<void>(`/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  submitScore: (id: string, score: ScoreSubmit) => request<Song>(`/songs/${encodeURIComponent(id)}/scores`, { method: 'POST', body: JSON.stringify(score) }),
  search: (title: string, artist: string, signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>(`/search?${new URLSearchParams({ title, artist })}`, { signal }).then(listOf),
  /** Every mapped song, A to Z by title: the music bank. */
  library: (signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>('/library', { signal }).then(listOf),
  favorites: (q: string, signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>(`/favorites?${new URLSearchParams({ q })}`, { signal }).then(listOf),
  findVideo: (title: string, artist: string, signal?: AbortSignal) =>
    request<VideoMatch>(`/youtube?${new URLSearchParams({ title, artist })}`, { signal }),
  fanChart: (req: FanChartRequest, signal?: AbortSignal) => request<Song>('/fan-chart', { method: 'POST', body: JSON.stringify(req), signal }),
  createSong: (song: NewSong) => request<Song>('/songs', { method: 'POST', body: JSON.stringify(song) }),
  /** The AI charter (backend): which measured sounds become tiles on each difficulty. */
  chartSong: (req: ChartRequest, signal?: AbortSignal) => request<ChartPlan>('/chart', { method: 'POST', body: JSON.stringify(req), signal }),
};
