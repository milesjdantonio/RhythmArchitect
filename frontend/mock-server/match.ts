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

/**
 * Title and artist from a video's title and channel: "Artist - Title", "Title - Artist" (lyric and
 * fan channels post both), `Artist "Title"`, and "Artist - Topic" channels. Which side of the dash
 * is the title: the one that matches what the player typed as the title (`typedTitle`), else the
 * other side of the one that matches the channel, else the first is the artist (the usual way).
 * (Assuming "Artist - Title" filed "Blinding Lights - The Weeknd (Lyrics)" as a song called The
 * Weeknd by Blinding Lights.) Matching.songFromVideo is the same.
 */
export function songFromVideo(videoTitle: string, channel: string, typedTitle = ''): { title: string; artist: string } {
  const ch = channel.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*(Media|Official)$/i, '').trim();
  const topic = / - Topic$/i.test(channel);
  const parts = videoTitle.split(/\s+[-–—|]\s+/);
  if (topic || parts.length < 2) {
    const quoted = topic ? null : /^(.+?)\s+["“](.+?)["”]/.exec(videoTitle);
    if (quoted) return { title: tidy(quoted[2]), artist: tidy(quoted[1]) };
    return { title: tidy(videoTitle), artist: ch };
  }
  const a = parts[0], b = parts.slice(1).join(' - ');
  const asTitle = (t: string, r: string) => ({ title: tidy(t), artist: tidy(r) });
  const want = bare(typedTitle);
  if (want) {
    const isTitle = (x: string) => { const v = bare(x); return !!v && (v === want || (v.length > 2 && (v.includes(want) || want.includes(v)))); };
    if (isTitle(a) && !isTitle(b)) return asTitle(a, b);
    if (isTitle(b) && !isTitle(a)) return asTitle(b, a);
  }
  // The channel names the artist (spaces and case aside: TheWeekndVEVO is The Weeknd).
  const squash = (s: string) => norm(s).replace(/ /g, '');
  const c = squash(ch);
  if (c.length > 1) {
    if (squash(b).includes(c) && !squash(a).includes(c)) return asTitle(a, b);
    if (squash(a).includes(c)) return asTitle(b, a);
  }
  return asTitle(b, a);
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

/** Words in a video's title that say it isn't a song, whatever else it says (unless the player typed them). */
export const NOT_A_SONG = ['reaction', 'reacts', 'tutorial', 'how to', 'lesson', 'podcast', 'gameplay', 'walkthrough', 'let s play',
  'unboxing', 'full album', 'compilation', 'playlist', 'hours', '1 hour', 'livestream', 'live stream', 'asmr', 'prank', 'speedrun',
  'stream highlights'];
/** Words that say it probably isn't, unless something marks it as music (songs are called "Breakdown" or "Good News" too). */
export const MAYBE_NOT_A_SONG = ['review', 'interview', 'vlog', 'trailer', 'teaser', 'documentary', 'explained', 'breakdown',
  'behind the scenes', 'highlights', 'episode', 'meme', 'analysis', 'news', 'podcast clip'];
/** Signs a video is a song: how song uploads are titled. */
const MUSIC_SIGNS = /\b(official (music )?video|official audio|official lyric video|lyric video|lyrics|visuali[sz]er|audio|ft|feat|prod)\b/;
/** YouTube's Music category. */
export const MUSIC_CATEGORY = '10';
/** Songs are between these lengths (seconds). */
export const SONG_SECONDS = { min: 45, max: 900 };

const has = (t: string, w: string) => new RegExp(`\\b${w}\\b`).test(t);
const what = (w: string) => (w === 'hours' || w === '1 hour' ? 'long loop' : w === 'let s play' ? "let's play" : w.replace(/s$/, ''));

/**
 * Why a video isn't a song, or null when it is one. What's known decides: the title and channel
 * always (a pasted link without an API key has only these), the length and YouTube's category when
 * the API gave them.
 * - A title that says it's something else (a reaction, a tutorial, a full album, ten hours of it)
 *   is never a song, unless the player typed that word.
 * - A length outside SONG_SECONDS isn't either.
 * - Something marks it as music: YouTube's Music category, a "- Topic" or VEVO channel, or a song
 *   upload's title ("Official Audio", "Lyrics", "ft.", "Artist - Title"). Without any of that, a
 *   title like a review, a trailer or the news isn't a song, and with the category known (not
 *   Music) nothing else is either.
 */
export function notSongReason(v: { title: string; channel: string; seconds?: number; categoryId?: string }, typed = ''): string | null {
  const t = norm(v.title), ch = norm(v.channel), asked = norm(typed);
  for (const w of NOT_A_SONG) if (has(t, w) && !asked.includes(w)) return `it looks like a ${what(w)} video, not a song`;
  if (v.seconds !== undefined && v.seconds > 0) {
    if (v.seconds < SONG_SECONDS.min) return `it's only ${v.seconds} seconds long`;
    if (v.seconds > SONG_SECONDS.max) return `it's ${Math.round(v.seconds / 60)} minutes long (a song is under ${SONG_SECONDS.max / 60})`;
  }
  const channelSays = / topic$/.test(ch) || /vevo$/.test(ch);
  const titleSays = MUSIC_SIGNS.test(t) || /\s[-–|]\s/.test(v.title);
  const music = v.categoryId === MUSIC_CATEGORY || channelSays || titleSays;
  if (!music) {
    for (const w of MAYBE_NOT_A_SONG) if (has(t, w) && !asked.includes(w)) return `it looks like a ${what(w)} video, not a song`;
    if (v.categoryId !== undefined) return "YouTube doesn't list it as music";
  }
  return null;
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
