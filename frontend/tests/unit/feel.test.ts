import { describe, expect, it } from 'vitest';
import type { Song } from '../../src/api/types';
import { addFeel, feelLine } from '../../src/game/feel';

// The same cases as the backend's FeelTests (RunFeel).
const song = (): Pick<Song, 'charts' | 'feel'> => ({
  charts: { hard: { difficulty: 'hard', lanes: 4, notes: [{ t: 0, lane: 0 }] } } as unknown as Song['charts'],
});

describe('how a run felt', () => {
  it('counts right, off and why (a reason once a run)', () => {
    const s = song();
    expect(addFeel(s, 'hard', 'right', undefined)).toBe(true);
    expect(addFeel(s, 'hard', 'off', ['notes', 'hard', 'notes'])).toBe(true);
    expect(s.feel?.hard).toEqual({ right: 1, off: 1, notes: 1, hard: 1 });
    expect(feelLine(s.feel?.hard)).toBe('1 right, 1 off: notes 1, too hard 1');
  });

  it('refuses answers it does not know', () => {
    const s = song();
    expect(addFeel(s, 'hard', 'great', undefined)).toBe(false);
    expect(addFeel(s, 'hard', 'off', ['boring'])).toBe(false);
    expect(addFeel(s, 'hard', 'right', ['notes'])).toBe(false);
    expect(addFeel(s, 'hard', 'off', 'notes')).toBe(false);
    expect(addFeel(s, 'easy', 'right', undefined)).toBe(false);
    expect(s.feel).toBeUndefined();
    expect(feelLine(undefined)).toBe('');
  });
});
