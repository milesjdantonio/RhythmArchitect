// Hash routes, so the app works from any static host without server rewrites.
//   #/                      home: name a song (the stage shows the waiting screen)
//   #/song/:id?d=medium     home with a song picked: it plays on the stage
//   #/play/:id/:difficulty  playing
//   #/bank                  the music bank: every song, A to Z

import { useSyncExternalStore } from 'react';
import { DIFFICULTIES, type Difficulty } from '../api/types';

export type Route =
  | { name: 'home'; songId?: string; difficulty?: Difficulty; fresh?: boolean }
  | { name: 'play'; songId: string; difficulty: Difficulty }
  | { name: 'bank' };

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'song' && parts[1]) {
    const d = params.get('d') as Difficulty | null;
    return { name: 'home', songId: parts[1], difficulty: d && DIFFICULTIES.includes(d) ? d : undefined, fresh: params.has('fresh') };
  }
  if (parts[0] === 'bank' && parts.length === 1) return { name: 'bank' };
  if (parts[0] === 'play' && parts[1] && DIFFICULTIES.includes(parts[2] as Difficulty)) {
    return { name: 'play', songId: parts[1], difficulty: parts[2] as Difficulty };
  }
  return { name: 'home' };
}

export const href = {
  home: () => '#/',
  song: (id: string, d?: Difficulty) => `#/song/${encodeURIComponent(id)}${d ? `?d=${d}` : ''}`,
  play: (id: string, d: Difficulty) => `#/play/${encodeURIComponent(id)}/${d}`,
  bank: () => '#/bank',
};

/** Where the music bank's Back returns to: the menu as it was when the bank was opened. */
export const bankReturn = { hash: '#/' };
export function openBank() {
  bankReturn.hash = parse(location.hash).name === 'home' ? location.hash || '#/' : '#/';
  navigate(href.bank());
}

export function navigate(to: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

let cached = { hash: '', route: parse('') };
export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => { addEventListener('hashchange', l); addEventListener('popstate', l); return () => { removeEventListener('hashchange', l); removeEventListener('popstate', l); }; },
    () => {
      if (cached.hash !== location.hash) cached = { hash: location.hash, route: parse(location.hash) };
      return cached.route;
    },
  );
}
