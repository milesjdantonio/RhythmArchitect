// How the mock backend decides which YouTube video and which osu! chart are the song asked for.
// Pure functions (no network, no Node APIs), so unit tests can check them.

export const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A title without "(feat. …)", "[Official Audio]" and the like. */
export const bare = (s: string) => norm(s.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\b(feat|ft)\.?\s.*$/i, ' '));

/** A YouTube video id in a link someone pasted (watch, youtu.be, embed, shorts, music). */
export function videoIdIn(text: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/i.exec(text);
  return m ? m[1] : null;
}

const JUNK = /\b(official\s+(music\s+)?video|official\s+audio|official\s+lyric\s+video|lyric(s)?\s+video|lyrics?|audio|visuali[sz]er|hd|hq|4k|explicit|clean)\b/gi;
const tidy = (s: string) => s.replace(/[([][^)\]]*(official|audio|video|lyric|visuali|explicit|hd|hq)[^)\]]*[)\]]/gi, '').replace(JUNK, '').replace(/\s{2,}/g, ' ').replace(/[\s\-–|]+$/, '').trim();

/** Title and artist from a video's title and channel ("Artist - Title", "Title - Artist", "Artist - Topic"). */
export function songFromVideo(videoTitle: string, channel: string): { title: string; artist: string } {
  const ch = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*Media$/i, '').trim();
  const parts = videoTitle.split(/\s+[-–|]\s+/);
  if (/ - Topic$/i.test(channel) || parts.length < 2) return { title: tidy(videoTitle), artist: ch };
  const [a, b] = parts;
  if (norm(b).includes(norm(ch)) && norm(ch)) return { title: tidy(a), artist: tidy(b) };
  return { title: tidy(parts.slice(1).join(' - ')), artist: tidy(a) };
}

/** How likely a search result is the song itself, as released (not a live take, cover or edit). */
export function videoScore(v: { title: string; channel: string; seconds?: number }, title: string, artist: string): number {
  const t = norm(v.title), ch = norm(v.channel);
  const typed = norm(`${title} ${artist}`);
  let s = 0;
  if (bare(title) && t.includes(bare(title))) s += 3;
  if (artist && (ch.includes(norm(artist)) || t.includes(norm(artist)))) s += 2;
  if (/ topic$/.test(ch)) s += 3;
  if (/official audio/.test(t)) s += 2.5;
  else if (/\baudio\b/.test(t)) s += 1;
  if (/official (music )?video/.test(t)) s -= 0.5; // music videos often add intros and skits
  for (const bad of ['live', 'cover', 'remix', 'sped up', 'slowed', 'reverb', 'nightcore', '8d', 'karaoke', 'instrumental', 'hour', 'loop', 'reaction', 'tutorial', 'acoustic', 'mashup']) {
    if (new RegExp(`\\b${bad}\\b`).test(t) && !typed.includes(bad)) s -= 4;
  }
  if (v.seconds !== undefined && (v.seconds < 60 || v.seconds > 600)) s -= 3;
  return s;
}

export interface OsuSearchBeatmap { id: number; mode_int: number; cs: number; version: string; difficulty_rating: number; total_length: number }
export interface OsuSearchSet { id: number; title: string; artist: string; creator: string; status: string; play_count: number; beatmaps: OsuSearchBeatmap[] }

/** How good a beatmap set is as this song's chart. Below 0: not this song. */
export function setScore(set: OsuSearchSet, maps: OsuSearchBeatmap[], title: string, artist: string, seconds?: number): number {
  const t = bare(set.title), want = bare(title);
  if (!want || !(t === want || t.startsWith(want) || want.startsWith(t) || t.includes(want))) return -1;
  const a = norm(set.artist);
  if (artist && !(a.includes(norm(artist)) || norm(artist).includes(a) || norm(set.title).includes(norm(artist)))) return -1;
  let s = t === want ? 3 : 1.5;
  if (['ranked', 'loved', 'approved', 'qualified'].includes(set.status)) s += 2;
  s += Math.log10(1 + (set.play_count ?? 0)) * 0.6;
  s += Math.min(2, maps.length * 0.4);
  const typed = norm(`${title} ${artist}`);
  const label = norm(`${set.title} ${maps.map((m) => m.version).join(' ')}`);
  for (const cut of ['tv size', 'cut ver', 'short ver', 'sped up', 'speed up', 'nightcore', 'remix', 'edit', 'extended', 'bootleg', 'cover']) {
    if (label.includes(cut) && !typed.includes(cut)) s -= 3;
  }
  const len = Math.max(...maps.map((m) => m.total_length));
  if (seconds && len) {
    // A chart of a shorter cut won't line up with the full song.
    if (len > seconds + 5) return -1;
    if (seconds - len > 45) s -= 4;
    else if (seconds - len > 20) s -= 1.5;
  }
  return s;
}
