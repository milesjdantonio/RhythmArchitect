import { describe, expect, it } from 'vitest';
import { CHORUS_DROP, dropAt, dropZones } from '../../src/mapping/cues';
import type { MapReport } from '../../src/api/types';

const report = (sections: MapReport['sections'], cues?: MapReport['cues']): MapReport => ({ mapper: 't', confidence: 1, sections, energy: [], cues });

describe('drop zones', () => {
  it('runs a drop from its chorus to the next section, a plain chorus lighter', () => {
    // Hotline Bling's form (the testing ground's map).
    const r = report([
      { label: 'Intro', beat: 0 }, { label: 'Chorus (drop)', beat: 32 }, { label: 'Verse', beat: 88 },
      { label: 'Chorus', beat: 152 }, { label: 'Verse', beat: 216 }, { label: 'Outro', beat: 480 },
    ]);
    const z = dropZones(r, 600);
    expect(z.map((x) => [x.from, x.to])).toEqual([[32, 88], [152, 216]]);
    expect(z[0]).toMatchObject({ strength: 1, big: true });
    expect(z[1]).toMatchObject({ strength: CHORUS_DROP, big: false });
  });

  it("follows the mapper's own cues: ends on a break, never past 16 bars or the song", () => {
    const r = report([{ label: 'Intro', beat: 0 }, { label: 'Verse', beat: 4 }], [
      { beat: 12, kind: 'build' }, { beat: 16, kind: 'drop' }, { beat: 20, kind: 'flash' }, { beat: 40, kind: 'break' },
      { beat: 100, kind: 'drop' },
    ]);
    const z = dropZones(r, 150);
    expect(z.map((x) => [x.from, x.to])).toEqual([[16, 40], [100, 150]]);
    // The mapper's own drop, out of any chorus, is a real one, however soft its cue.
    expect(dropZones(report([{ label: 'Intro', beat: 0 }], [{ beat: 16, kind: 'drop', strength: 0.64 }]), 100)[0]).toMatchObject({ big: true, strength: 0.8 });
    expect(dropZones(report([], [{ beat: 0, kind: 'drop' }]), 500)[0].to).toBe(64);
  });

  it('a section starting right after the drop cue does not cut it short', () => {
    // One Dance: the drop cue a moment before its verse starts.
    const r = report([{ label: 'Intro', beat: 0 }, { label: 'Verse', beat: 16 }, { label: 'Chorus', beat: 52 }],
      [{ beat: 15.6, kind: 'drop' }, { beat: 50.3, kind: 'drop' }]);
    const z = dropZones(r, 120);
    expect(z[0].from).toBeCloseTo(15.6);
    expect(z[0].to).toBeCloseTo(50.3);
  });

  it('finds the drop playing at a beat, and how far through it is', () => {
    const z = dropZones(report([{ label: 'Verse', beat: 0 }, { label: 'Chorus (drop)', beat: 32 }, { label: 'Verse', beat: 64 }]), 100);
    expect(dropAt(z, 10)).toBeNull();
    expect(dropAt(z, 48)?.through).toBeCloseTo(0.5);
    expect(dropAt(z, 64)).toBeNull();
  });
});
