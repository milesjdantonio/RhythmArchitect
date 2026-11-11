// Mock backend for local development. Runs inside the Vite dev/preview server (see
// vite.config.ts) and stores the song bank in .data/songs.json, so it survives reloads.
// It implements the same routes the real backend should (docs/api.md):
//
//   GET    /api/songs                 -> { songs }
//   POST   /api/songs                 NewSong -> Song (201)  (a song the browser mapped by listening)
//   GET    /api/songs/:id             -> Song
//   PATCH  /api/songs/:id             { title?, favorite?, offset? } -> Song
//   DELETE /api/songs/:id             -> 204
//   POST   /api/songs/:id/scores      ScoreSubmit -> Song  (counts a play, keeps the best)
//   GET    /api/search?title=&artist= -> { results: SongSummary[] }  (best matches first, max 8)
//   GET    /api/favorites?q=          -> { results: SongSummary[] }  (favourites, newest first; q filters title or artist)
//   GET    /api/library               -> { results: SongSummary[] }  (every song, A to Z by title: the music bank)
//   GET    /api/youtube?title=&artist= -> VideoMatch  (the YouTube video that plays the song)
//   POST   /api/fan-chart             FanChartRequest -> Song (201)  (an osu! fan chart, saved)
//
// The mock never makes up a song. A new song plays from YouTube; its tiles come from the browser
// listening to the video once (then POST /api/songs), or else from a fan-made osu! chart.
// Songs that earlier versions of this mock invented (stand-in audio) are dropped from the store.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FanChartRequest, NewSong, ScoreSubmit, Song, SongPatch, SongSummary } from '../src/api/types';
import { sortAtoZ } from '../src/library/bank';
import { DIFFICULTIES } from '../src/api/types';
import { builtInSongs } from './songs/builtins';
import { fanSong } from '../src/mapping/osu';
import { findFanChart, findVideo, SourceError } from './sources';

type Next = (err?: unknown) => void;

const MAX_FIELD = 120;

/** Lowercase, no punctuation or accents, single spaces: how titles and artists are compared. */
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well `have` matches what was typed: exact 4, starts with it 3, a whole word 2, inside 1. */
function match(have: string, typed: string) {
  const h = norm(have), q = norm(typed);
  if (!q) return 0;
  if (h === q) return 4;
  if (h.startsWith(q)) return 3;
  if (h.split(' ').some((w) => w.startsWith(q)) || q.split(' ').every((w) => h.split(' ').some((x) => x.startsWith(w)))) return 2;
  return h.includes(q) ? 1 : 0;
}

export function searchSongs(songs: Song[], title: string, artist: string): SongSummary[] {
  return songs
    .map((s) => {
      const t = match(s.title, title), a = match(s.artist, artist);
      // Every field the player filled in has to match.
      const ok = (!norm(title) || t > 0) && (!norm(artist) || a > 0) && (t > 0 || a > 0);
      return { s, score: ok ? t * 2 + a : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.plays - a.s.plays || b.s.createdAt.localeCompare(a.s.createdAt))
    .slice(0, 8)
    .map(({ s }) => summary(s));
}

export function summary(s: Song): SongSummary {
  return {
    id: s.id, title: s.title, artist: s.artist, bpm: s.bpm, lengthBeats: s.lengthBeats, hues: s.hues,
    source: { kind: s.source.kind, ...(s.source.standIn ? { standIn: true } : {}) },
    tiles: { easy: s.charts.easy.notes.length, medium: s.charts.medium.notes.length, hard: s.charts.hard.notes.length },
    best: s.best, plays: s.plays, favorite: !!s.favorite, ...(s.cover ? { cover: s.cover } : {}),
  };
}

/** Every mapped song, A to Z by title (then artist): the music bank. */
export function librarySongs(songs: Song[]): SongSummary[] {
  return sortAtoZ(songs).map(summary);
}

export function favoriteSongs(songs: Song[], q: string): SongSummary[] {
  const query = norm(q);
  return songs
    .filter((s) => s.favorite && (!query || match(s.title, q) > 0 || match(s.artist, q) > 0))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summary);
}

/** What's wrong with a song the browser mapped, or null if it can be saved. */
export function checkNewSong(b: NewSong): string | null {
  if (!b || typeof b !== 'object') return 'Expected a song';
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > MAX_FIELD) return 'The song needs a title';
  if (typeof b.artist !== 'string' || b.artist.length > MAX_FIELD) return 'Bad artist';
  if (!Number.isFinite(b.bpm) || b.bpm < 20 || b.bpm > 400) return 'Bad tempo';
  if (!Number.isFinite(b.lengthBeats) || b.lengthBeats <= 0) return 'Bad length';
  if (!b.source || b.source.kind !== 'youtube' || typeof b.source.videoId !== 'string' || !/^[\w-]{11}$/.test(b.source.videoId)) return 'Only songs that play from YouTube can be added this way';
  if (!Number.isFinite(b.source.offset ?? 0)) return 'Bad offset';
  for (const d of DIFFICULTIES) {
    const c = b.charts?.[d];
    if (!c || c.lanes !== 4 || !Array.isArray(c.notes)) return `Missing the ${d} chart`;
    for (const n of c.notes) {
      if (!Number.isFinite(n.t) || !Number.isInteger(n.lane) || n.lane < 0 || n.lane > 3 || !Number.isFinite(n.len)) return `A bad tile in the ${d} chart`;
    }
  }
  if (!b.charts.hard.notes.length) return 'The map has no tiles';
  if (!b.report || !Array.isArray(b.report.sections) || !Array.isArray(b.report.energy)) return 'Missing the map report';
  return null;
}

export interface MockApiOptions {
  file: string;
  /** Multiplies the simulated network delay. 0 makes it instant (used by tests). */
  speed?: number;
}

export function createMockApi({ file, speed = 1 }: MockApiOptions) {

  const builtIns = builtInSongs;

  function load(): Song[] {
    if (!existsSync(file)) {
      const seeded = builtIns();
      save(seeded);
      return seeded;
    }
    try {
      return migrate(JSON.parse(readFileSync(file, 'utf8')).songs as Song[]);
    } catch {
      return builtIns();
    }
  }

  // Keeps stored songs playable as the format moves on: built-in songs always get their latest
  // charts and audio (scores, plays, favourite and title kept) and missing ones are added back;
  // songs from before the "map a real song" format get an artist, a source and a report; charts
  // from before every difficulty had four lanes are spread onto four.
  function migrate(stored: Song[]): Song[] {
    let changed = false;
    const latest = new Map(builtIns().map((b) => [b.id, b]));
    // Built-ins that no longer exist go, and so do songs an earlier mock invented (no real audio).
    const songs = stored.filter((s) => (s.builtIn ? latest.has(s.id) : !!s.source && !s.source.standIn));
    if (songs.length !== stored.length) changed = true;
    for (const b of latest.values()) if (!songs.some((s) => s.id === b.id)) { songs.push(b); changed = true; }
    const out = songs.map((s) => {
      if (s.builtIn) {
        const fresh = latest.get(s.id)!;
        const keep = { title: s.title, best: s.best, plays: s.plays, favorite: s.favorite };
        if (JSON.stringify({ ...s, ...keep }) === JSON.stringify({ ...fresh, ...keep })) return s;
        changed = true;
        return { ...fresh, ...keep };
      }
      if (!s.best || s.plays == null) {
        changed = true;
        s = { ...s, best: s.best ?? {}, plays: s.plays ?? 0 };
      }
      if (!s.source || !s.report || !s.artist) {
        changed = true;
        s = {
          ...s,
          artist: s.artist ?? 'Unknown artist',
          source: s.source ?? { kind: 'synth', standIn: true },
          report: s.report ?? { mapper: 'Mock mapper (stand-in audio)', confidence: 0.6, sections: [{ label: 'Intro', beat: 0 }], energy: new Array(48).fill(0.6) },
        };
      }
      for (const d of DIFFICULTIES) {
        const c = s.charts[d];
        if (c.lanes === 4) continue;
        changed = true;
        const taken = new Set<string>();
        c.notes = c.notes
          .map((n) => ({ ...n, lane: Math.round((n.lane * 3) / Math.max(1, c.lanes - 1)) }))
          .filter((n) => { const k = `${n.t}:${n.lane}`; if (taken.has(k)) return false; taken.add(k); return true; });
        c.lanes = 4;
      }
      return s;
    });
    if (changed) save(out);
    return out;
  }
  function save(songs: Song[]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ songs }, null, 2));
  }

  function send(res: ServerResponse, status: number, body?: unknown) {
    res.statusCode = status;
    if (body === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }
  const fail = (res: ServerResponse, status: number, message: string) => send(res, status, { error: message });

  async function readJson(req: IncomingMessage, limit = 64_000): Promise<unknown> {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > limit) throw new Error('Body too large');
    }
    return raw ? JSON.parse(raw) : {};
  }

  // A new song from the store's point of view: an id, a date, no scores yet.
  function add(songs: Song[], body: NewSong): Song {
    const base = (body.source.videoId ?? body.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
    const song: Song = { ...body, id: `yt-${base}-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), best: {}, plays: 0, favorite: false };
    songs.unshift(song);
    save(songs);
    return song;
  }

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms * speed));

  return async function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return next();
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const method = req.method ?? 'GET';
    try {
      await delay(120);
      if (parts[0] === 'songs') {
        const songs = load();
        if (parts.length === 1 && method === 'GET') return send(res, 200, { songs });
        if (parts.length === 1 && method === 'POST') {
          const body = (await readJson(req, 4_000_000)) as NewSong;
          const problem = checkNewSong(body);
          if (problem) return fail(res, 400, problem);
          return send(res, 201, add(songs, body));
        }
        const idx = songs.findIndex((s) => s.id === parts[1]);
        if (idx < 0) return fail(res, 404, 'Song not found');
        const song = songs[idx];
        if (parts.length === 2 && method === 'GET') return send(res, 200, song);
        if (parts.length === 2 && method === 'PATCH') {
          const body = (await readJson(req)) as SongPatch;
          if (body.title !== undefined) {
            const t = String(body.title).trim().slice(0, 60);
            if (!t) return fail(res, 400, 'Title cannot be empty');
            song.title = t;
          }
          if (body.favorite !== undefined) song.favorite = Boolean(body.favorite);
          if (body.offset !== undefined) {
            const o = Number(body.offset);
            if (!Number.isFinite(o) || Math.abs(o) > 600) return fail(res, 400, 'Bad offset');
            song.source = { ...song.source, offset: Math.round(o * 1000) / 1000 };
          }
          save(songs);
          return send(res, 200, song);
        }
        if (parts.length === 2 && method === 'DELETE') {
          songs.splice(idx, 1);
          save(songs);
          return send(res, 204);
        }
        if (parts.length === 3 && parts[2] === 'scores' && method === 'POST') {
          const body = (await readJson(req)) as ScoreSubmit;
          if (!DIFFICULTIES.includes(body.difficulty) || !Number.isFinite(body.score)) return fail(res, 400, 'Bad score');
          song.plays += 1;
          const prev = song.best[body.difficulty];
          if (!prev || body.score > prev.score) {
            song.best[body.difficulty] = {
              score: Math.round(body.score), accuracy: body.accuracy, maxCombo: body.maxCombo, grade: body.grade, at: new Date().toISOString(),
            };
          }
          save(songs);
          return send(res, 200, song);
        }
      }
      if (parts[0] === 'library' && parts.length === 1 && method === 'GET') {
        return send(res, 200, { results: librarySongs(load()) });
      }
      if (parts[0] === 'favorites' && parts.length === 1 && method === 'GET') {
        return send(res, 200, { results: favoriteSongs(load(), (url.searchParams.get('q') ?? '').slice(0, MAX_FIELD)) });
      }
      if (parts[0] === 'search' && parts.length === 1 && method === 'GET') {
        const title = (url.searchParams.get('title') ?? '').slice(0, MAX_FIELD);
        const artist = (url.searchParams.get('artist') ?? '').slice(0, MAX_FIELD);
        return send(res, 200, { results: searchSongs(load(), title, artist) });
      }
      if (parts[0] === 'youtube' && parts.length === 1 && method === 'GET') {
        const title = (url.searchParams.get('title') ?? '').trim();
        const artist = (url.searchParams.get('artist') ?? '').trim();
        if (!title) return fail(res, 400, 'Type the title of the song (or paste its YouTube link).');
        if (title.length > 300 || artist.length > MAX_FIELD) return fail(res, 400, `Keep the title and artist under ${MAX_FIELD} characters each.`);
        return send(res, 200, await findVideo(title, artist));
      }
      if (parts[0] === 'fan-chart' && parts.length === 1 && method === 'POST') {
        const body = (await readJson(req)) as FanChartRequest;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
        if (!title || typeof body.videoId !== 'string' || !/^[\w-]{11}$/.test(body.videoId)) return fail(res, 400, 'Need the song title and its YouTube video.');
        const seconds = typeof body.seconds === 'number' && body.seconds > 0 ? body.seconds : undefined;
        const found = await findFanChart(title, artist, seconds);
        const song = fanSong(found.maps, { title, artist, videoId: body.videoId, seconds });
        return send(res, 201, add(load(), song));
      }
      return fail(res, 404, 'No such route');
    } catch (e) {
      if (e instanceof SourceError) return fail(res, e.status, e.message);
      return fail(res, 400, e instanceof Error ? e.message : 'Bad request');
    }
  };
}
