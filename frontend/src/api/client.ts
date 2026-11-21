// Typed client for the songs, search and mapper API. Point VITE_API_BASE_URL at the real
// backend; when it is empty the app talks to the mock in mock-server/ on the same origin.

import type { ChartsUpdate, FanChartRequest, FeelSubmit, NewSong, PlayInput, PlayReply, PlayStart, ScoreSubmit, SearchResults, Song, SongList, SongPatch, SongSummary, VideoMatch, VideoResults } from './types';
import { rethinSong, upgradeSong, upgradeSummary } from './upgrade';

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
const listOf = (r: SearchResults | undefined): SongSummary[] => (Array.isArray(r?.results) ? r.results.map(upgradeSummary) : []);
/** A song on today's four charts (one saved before Ultra had three: upgrade.ts). */
const song = (p: Promise<Song>) => p.then(upgradeSong);

/**
 * A song the trained mapper charted before today's ladder: its charts made again from its Ultra
 * and kept on the server (which checks every tile is one of its Ultra's) the first time it's
 * opened. If the server can't take them now, the song stays as it is (its runs are checked
 * against the server's charts).
 */
async function onLadder(s: Song): Promise<Song> {
  const update = rethinSong(s);
  if (!update) return s;
  try {
    return upgradeSong(await request<Song>(`/songs/${encodeURIComponent(s.id)}/charts`, { method: 'PUT', body: JSON.stringify(update satisfies ChartsUpdate) }));
  } catch {
    return s;
  }
}

export const api = {
  listSongs: () => request<SongList>('/songs').then((r) => r.songs.map(upgradeSong)),
  getSong: (id: string) => song(request<Song>(`/songs/${encodeURIComponent(id)}`)).then(onLadder),
  updateSong: (id: string, patch: SongPatch) => song(request<Song>(`/songs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })),
  deleteSong: (id: string) => request<void>(`/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  submitScore: (id: string, score: ScoreSubmit) => song(request<Song>(`/songs/${encodeURIComponent(id)}/scores`, { method: 'POST', body: JSON.stringify(score) })),
  /** How a run felt: once a run, after its score was kept. */
  sendFeel: (id: string, feel: FeelSubmit) => song(request<Song>(`/songs/${encodeURIComponent(id)}/feel`, { method: 'POST', body: JSON.stringify(feel) })),
  search: (title: string, artist: string, signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>(`/search?${new URLSearchParams({ title, artist })}`, { signal }).then(listOf),
  /** Every mapped song, A to Z by title: the music bank. */
  library: (signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>('/library', { signal }).then(listOf),
  favorites: (q: string, signal?: AbortSignal): Promise<SongSummary[]> =>
    request<SearchResults>(`/favorites?${new URLSearchParams({ q })}`, { signal }).then(listOf),
  findVideo: (title: string, artist: string, signal?: AbortSignal) =>
    request<VideoMatch>(`/youtube?${new URLSearchParams({ title, artist })}`, { signal }),
  /** The song's YouTube videos, best first, to preview and choose from. */
  searchVideos: (title: string, artist: string, signal?: AbortSignal): Promise<VideoMatch[]> =>
    request<VideoResults>(`/youtube/search?${new URLSearchParams({ title, artist })}`, { signal })
      .then((r) => (Array.isArray(r?.results) ? r.results.filter((v) => v && typeof v.videoId === 'string') : [])),
  fanChart: (req: FanChartRequest, signal?: AbortSignal) => song(request<Song>('/fan-chart', { method: 'POST', body: JSON.stringify(req), signal })),
  createSong: (s: NewSong) => song(request<Song>('/songs', { method: 'POST', body: JSON.stringify(s) })),
  /** Starts a run through the controller (main.Main on the server). */
  startPlay: (songId: string, difficulty: string, part?: { from: number; to: number }) => request<PlayStart>('/play', { method: 'POST', body: JSON.stringify({ songId, difficulty, ...part }) }),
  /** What the player did since the last call, in order: the model's state comes back. */
  playInputs: (run: string, inputs: PlayInput[], judged?: string) => request<PlayReply>(`/play/${encodeURIComponent(run)}/inputs`, { method: 'POST', body: JSON.stringify({ inputs, ...(judged !== undefined ? { run: judged } : {}) }) }),
};
