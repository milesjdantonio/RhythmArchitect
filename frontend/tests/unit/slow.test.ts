import { describe, expect, it } from 'vitest';
import { SlowWatch } from '../../src/game/slow';

describe('slow moments', () => {
  it('notes what was set off in the second before the frames fell, once a stretch', () => {
    const w = new SlowWatch();
    let at = 0;
    for (let i = 0; i < 10; i++) { at += 500; expect(w.sample({ page: 100, stage: 100, res: 1, song: i / 2 }, at)).toBeNull(); }
    w.note('hit', at + 100); w.note('hit', at + 200); w.note('overdrive', at + 300); w.note('callout combo', at - 5000);
    at += 500;
    const m = w.sample({ page: 98, stage: 24, res: 0.7, song: 5 }, at)!;
    expect(m).toMatchObject({ stage: 24, page: 98, usual: 100, res: 0.7 });
    expect(m.during).toEqual(['hit ×2', 'overdrive']);
    // Still slow half a second on: the same stretch, not a new moment.
    expect(w.sample({ page: 98, stage: 24, res: 0.7, song: 5.5 }, at + 500)).toBeNull();
    expect(w.suspects()[0]).toEqual({ what: 'hit', moments: 1 });
  });

  it('a steady slow machine is not a moment, nor a dip that stays near the usual', () => {
    const w = new SlowWatch();
    let at = 0;
    for (let i = 0; i < 10; i++) { at += 500; w.sample({ page: 55, stage: 55, res: 1, song: i }, at); }
    expect(w.sample({ page: 45, stage: 45, res: 1, song: 6 }, at + 500)).toBeNull();
    expect(w.moments).toHaveLength(0);
  });
});
