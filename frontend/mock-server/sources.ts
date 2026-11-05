// Where the mock backend finds songs it doesn't have yet:
//   findVideo   — the YouTube video that plays the song (its audio is never fetched).
//   findFanChart — a fan-made osu! chart of it, for when the browser can't listen to the video.
//
// Network rules: only metadata and chart text come over the wire (YouTube's search API or
// oEmbed, an osu! mirror's search, osu!'s .osu files). Tests point these at fixtures instead:
//   MOCK_YT_VIDEO=<id>    every search finds that video
//   MOCK_OSU_DIR=<dir>    search.json and <beatmapId>.osu come from that folder

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoMatch } from '../src/api/types';
import { parseOsu, type OsuMap } from '../src/mapping/osu';
import { bare, setScore, songFromVideo, videoIdIn, videoScore, type OsuSearchBeatmap, type OsuSearchSet } from './match';

// Mirrors ask apps to name themselves (some refuse anything that looks like a bot or server).
const UA = 'RythmArchitect/0.1 (private project)';

export class SourceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`, 502);
  return res.json();
}
async function getText(url: string, timeoutMs = 12_000): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`, 502);
  return res.text();
}

// ---------------------------------------------------------------- YouTube

interface YtSearchItem { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails?: { medium?: { url: string } } } }
interface YtVideo { id: string; contentDetails: { duration: string }; status?: { embeddable?: boolean } }

const isoSeconds = (d: string) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0)) : 0;
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function findVideo(title: string, artist: string): Promise<VideoMatch> {
  const pasted = videoIdIn(title) ?? videoIdIn(artist);
  const fixture = process.env.MOCK_YT_VIDEO;
  if (fixture && !pasted) {
    return { videoId: fixture, title: `${title}${artist ? ` - ${artist}` : ''} (test video)`, channel: 'Test channel', songTitle: title, songArtist: artist, seconds: Number(process.env.MOCK_YT_SECONDS) || undefined };
  }
  if (pasted) {
    if (fixture) return { videoId: pasted, title: 'Pasted video', channel: 'Test channel', songTitle: 'Pasted video', songArtist: artist };
    // oEmbed needs no key and says whether the video can be embedded (401/403 when it can't).
    let info: { title: string; author_name: string };
    try {
      info = (await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${pasted}`)}`)) as typeof info;
    } catch (e) {
      const status = /answered (\d+)/.exec((e as Error).message)?.[1];
      if (status === '401' || status === '403') throw new SourceError("That video can't be played outside YouTube (its owner turned embedding off). Try another upload of the song.", 422);
      if (status === '404' || status === '400') throw new SourceError("YouTube doesn't know that video. Check the link.", 404);
      throw new SourceError("Couldn't reach YouTube to check that link. Try again.", 502);
    }
    const guess = songFromVideo(info.title, info.author_name);
    const typedTitle = videoIdIn(title) ? '' : title;
    return {
      videoId: pasted, title: info.title, channel: info.author_name,
      songTitle: typedTitle || guess.title, songArtist: artist && !videoIdIn(artist) ? artist : guess.artist,
      thumbnail: `https://i.ytimg.com/vi/${pasted}/mqdefault.jpg`,
    };
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new SourceError("Finding songs on YouTube by name needs a YouTube Data API key (YOUTUBE_API_KEY in .env.local, then restart the dev server). Or paste the song's YouTube link into Title.", 503);
  }
  const q = `${artist} ${title}`.trim();
  const search = (await getJson(`https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q, key,
  })}`)) as { items?: YtSearchItem[] };
  const items = (search.items ?? []).filter((i) => i.id?.videoId);
  if (!items.length) throw new SourceError(`YouTube has nothing for “${q}”.`, 404);
  const details = (await getJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
    part: 'contentDetails,status', id: items.map((i) => i.id.videoId).join(','), key,
  })}`)) as { items?: YtVideo[] };
  const byId = new Map((details.items ?? []).map((d) => [d.id, d]));
  const ranked = items
    .map((i) => {
      const d = byId.get(i.id.videoId);
      const v = { title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle), seconds: d ? isoSeconds(d.contentDetails.duration) : undefined };
      return { i, v, ok: d?.status?.embeddable !== false, score: videoScore(v, title, artist) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) throw new SourceError(`None of YouTube's videos for “${q}” can be played outside YouTube.`, 404);
  return {
    videoId: best.i.id.videoId, title: best.v.title, channel: best.v.channel,
    songTitle: title, songArtist: artist || songFromVideo(best.v.title, best.v.channel).artist,
    seconds: best.v.seconds, thumbnail: best.i.snippet.thumbnails?.medium?.url,
  };
}

// ---------------------------------------------------------------- osu!

export interface FanChart {
  maps: OsuMap[];
  setId: number;
  creator: string;
}

/** The best fan chart for a song: osu!mania 4K first, then other key counts, then osu! standard. */
export async function findFanChart(title: string, artist: string, seconds?: number): Promise<FanChart> {
  const dir = process.env.MOCK_OSU_DIR;
  const searchSets = async (mode: number): Promise<OsuSearchSet[]> => {
    if (dir) {
      const f = join(dir, `search-${mode}.json`);
      return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
    }
    const q = `${bare(title)} ${artist}`.trim();
    const sets = (await getJson(`https://catboy.best/api/v2/search?${new URLSearchParams({ q, mode: String(mode), limit: '50' })}`)) as OsuSearchSet[];
    return Array.isArray(sets) ? sets : [];
  };
  const osuFile = async (id: number): Promise<string> => {
    if (dir) return readFileSync(join(dir, `${id}.osu`), 'utf8');
    try { return await getText(`https://osu.ppy.sh/osu/${id}`); } catch { return getText(`https://catboy.best/osu/${id}`); }
  };

  const tiers: { mode: number; pick: (b: OsuSearchBeatmap) => boolean; bonus: number }[] = [
    { mode: 3, pick: (b) => b.mode_int === 3 && Math.round(b.cs) === 4, bonus: 6 },
    { mode: 3, pick: (b) => b.mode_int === 3 && b.cs >= 5 && b.cs <= 10, bonus: 3 },
    { mode: 0, pick: (b) => b.mode_int === 0, bonus: 0 },
  ];
  let reachable = false;
  const candidates: { set: OsuSearchSet; maps: OsuSearchBeatmap[]; score: number }[] = [];
  for (const mode of [3, 0]) {
    let sets: OsuSearchSet[];
    try { sets = await searchSets(mode); reachable = true; } catch { continue; }
    for (const tier of tiers.filter((t) => t.mode === mode)) {
      for (const set of sets) {
        const maps = (set.beatmaps ?? []).filter(tier.pick);
        if (!maps.length) continue;
        const s = setScore(set, maps, title, artist, seconds);
        if (s >= 0) candidates.push({ set, maps, score: s + tier.bonus });
      }
    }
    if (candidates.some((c) => c.score >= 6)) break; // a 4K chart: no need to look at standard maps
  }
  if (!reachable) throw new SourceError("Couldn't reach osu! to look for a fan-made chart. Try again.", 502);
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) throw new SourceError(`No fan-made chart of “${title}”${artist ? ` by ${artist}` : ''} on osu! either.`, 404);
  // Up to six difficulties, spread from easiest to hardest.
  const sorted = [...best.maps].sort((a, b) => a.difficulty_rating - b.difficulty_rating);
  const take = sorted.length <= 6 ? sorted : [0, 1, 2, 3, 4, 5].map((i) => sorted[Math.round((i * (sorted.length - 1)) / 5)]);
  const maps: OsuMap[] = [];
  for (const b of take) {
    try { maps.push(parseOsu(await osuFile(b.id))); } catch { /* one missing difficulty is fine */ }
  }
  if (!maps.length) throw new SourceError("Found a fan chart, but couldn't download it. Try again.", 502);
  return { maps, setId: best.set.id, creator: best.set.creator };
}
