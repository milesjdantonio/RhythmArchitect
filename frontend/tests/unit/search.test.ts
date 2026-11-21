import { describe, expect, it } from 'vitest';
import { edits, match, near, searchMatch } from '../../src/library/near';

// The same cases as the backend's MappingTests (Text.searchMatch).
describe('the song search', () => {
  it('finds a song through a slip of the keys', () => {
    expect(searchMatch('One Dance', 'once dance')).toBe(1);
    expect(searchMatch('One Dance', 'onedance')).toBe(1);
    expect(searchMatch('Open Your Eyes', 'opne your eys')).toBe(1);
    expect(searchMatch('Hotline Bling', 'hotlien bl')).toBe(1);
    expect(searchMatch('Blinding Lights', 'blindng')).toBe(1);
    expect(searchMatch('Halo', 'halo')).toBe(4);
  });

  it("doesn't find what isn't close", () => {
    expect(searchMatch('One Dance', 'zq')).toBe(0);
    expect(searchMatch('One Dance', 'two dance')).toBe(0);
    expect(searchMatch('Halo', 'hello')).toBe(0);
    expect(near('One Dance', 'on')).toBe(false);
    expect(match('Halo Theme', 'hal')).toBe(3);
    expect(edits('abcd', 'abdc')).toBe(1);
  });
});
