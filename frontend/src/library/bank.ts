// The music bank's letter groups (screens/MusicBank.tsx).

import type { SongSummary } from '../api/types';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
/**
 * A to Z by title, then artist: case and accents ignored, numbers in order ("Track 2" before
 * "Track 10"). The backend's library order (mock-server/api.ts librarySongs uses this).
 */
export function sortAtoZ<T extends { title: string; artist?: string }>(songs: T[]): T[] {
  return [...songs].sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist ?? '', b.artist ?? ''));
}

/** Lower case, accents and punctuation gone (letters of any script and digits stay). */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The bank's search: every word typed appears in the title or the artist (case, accents and punctuation ignored). */
export function matchesSearch(song: { title: string; artist?: string }, query: string) {
  const words = plain(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${plain(song.title)} ${plain(song.artist ?? '')} `;
  return words.every((w) => hay.includes(w));
}

/** The rail's letters: "#" (numbers and symbols), then A to Z. */
export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** The letter a title files under: its first letter, accents dropped; anything else is "#". */
export function letterOf(title: string) {
  const c = title.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** The songs (already A to Z from the backend) in letter groups, "#" first; each keeps its order. */
export function groupByLetter(songs: SongSummary[]) {
  const groups = new Map<string, SongSummary[]>();
  for (const s of songs) {
    const k = letterOf(s.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return LETTERS.filter((l) => groups.has(l)).map((l) => ({ letter: l, songs: groups.get(l)! }));
}
