import { describe, expect, it } from 'vitest';
import { BUILD, buildProgress, type BuildWay } from '../../src/components/generate/GenerateDialog';

// The order a build reports its steps in (NameSong.tsx), each way.
const ORDER = ['find', 'listen', 'beat', 'split', 'notes', 'voice', 'load', 'ai', 'chart', 'save'] as const;

describe("the Generate dialog's progress (GenerateDialog.tsx BUILDS)", () => {
  for (const way of ['split', 'whole'] as BuildWay[]) {
    it(`${way}: runs from 0 to 1 without a gap or a step back`, () => {
      expect(buildProgress('find', 0, way)).toBe(0);
      expect(buildProgress('save', 1, way)).toBe(1);
      for (let i = 1; i < ORDER.length; i++) {
        // Each step starts where the one before ends.
        expect(buildProgress(ORDER[i], 0, way)).toBeCloseTo(buildProgress(ORDER[i - 1], 1, way), 9);
        expect(buildProgress(ORDER[i], 1, way)).toBeGreaterThanOrEqual(buildProgress(ORDER[i], 0, way));
      }
    });
  }

  it('the listen takes the same share both ways (the dialog counts the song\'s time from it)', () => {
    expect(buildProgress('listen', 0, 'whole')).toBe(BUILD.listen[0]);
    expect(buildProgress('listen', 1, 'whole')).toBe(BUILD.listen[1]);
  });

  it('a split build spends the end of the bar on what runs: the notes heard, not the trained mapper', () => {
    // Hearing the singing and the instruments ends near the end, the charts from the lines after it.
    expect(buildProgress('voice', 1, 'split')).toBeGreaterThan(0.95);
    expect(buildProgress('chart', 0, 'split') - buildProgress('voice', 1, 'split')).toBeLessThan(0.01);
  });
});
