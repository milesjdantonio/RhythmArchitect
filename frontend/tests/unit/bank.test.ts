import { describe, expect, it } from 'vitest';
import type { SongSummary } from '../../src/api/types';
import { groupByLetter, letterOf, matchesSearch, sortAtoZ } from '../../src/library/bank';

describe('the music bank', () => {
  it('lists every song A to Z, ignoring case and accents, with numbers in order', () => {
    const titles = sortAtoZ(['zebra', 'Éclair', 'apple', 'Track 10', 'Track 2', 'Banana'].map((title) => ({ title }))).map((s) => s.title);
    expect(titles).toEqual(['apple', 'Banana', 'Éclair', 'Track 2', 'Track 10', 'zebra']);
  });

  it('breaks a tie on the title with the artist', () => {
    const songs = sortAtoZ([{ title: 'Intro', artist: 'Zed' }, { title: 'intro', artist: 'Abba' }]);
    expect(songs.map((s) => s.artist)).toEqual(['Abba', 'Zed']);
  });

  it('files titles under their first letter, accents dropped, everything else under #', () => {
    expect(letterOf('Éclair')).toBe('E');
    expect(letterOf('  one dance')).toBe('O');
    expect(letterOf('99 Problems')).toBe('#');
    expect(letterOf('白鲨')).toBe('#');
  });

  it('searches titles and artists: every word must match, case, accents and punctuation ignored', () => {
    const one = { title: 'One Dance (feat. WizKid & Kyla)', artist: 'Drake' };
    expect(matchesSearch(one, '')).toBe(true);
    expect(matchesSearch(one, 'one dance')).toBe(true);
    expect(matchesSearch(one, 'drake ONE')).toBe(true);
    expect(matchesSearch(one, 'wizkid,')).toBe(true);
    expect(matchesSearch(one, 'one drake two')).toBe(false);
    expect(matchesSearch({ title: 'Griddlë', artist: 'Yeat' }, 'griddle')).toBe(true);
    expect(matchesSearch({ title: 'Link Click《VORTEX》by 白鲨JAWS', artist: 'Jiu Jiu' }, '白鲨')).toBe(true);
  });

  it('groups in rail order, # first, keeping each group in the given order', () => {
    const s = (title: string) => ({ title }) as SongSummary;
    const groups = groupByLetter([s('Apple'), s('Avocado'), s('Cherry'), s('7 Rings')]);
    expect(groups.map((g) => g.letter)).toEqual(['#', 'A', 'C']);
    expect(groups[1].songs.map((x) => x.title)).toEqual(['Apple', 'Avocado']);
  });
});
