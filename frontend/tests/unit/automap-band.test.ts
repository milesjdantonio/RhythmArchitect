import { describe, expect, it } from 'vitest';
import { automap } from '../../src/mapping/automap';
import { SR, band, score } from '../bench/band';

// A benchmark for the mapper: a small band rendered at a known tempo, so every note's true time is
// known. It has what real songs have and click tracks don't: a legato melody whose notes change
// pitch without getting louder, a vibrato that mustn't count as new notes, soft pad chord changes,
// a bass line, drums and a noise floor under everything.

describe('automap on a band (melody, chords, bass, drums)', () => {
  it('finds the tempo, and the notes where they are heard (legato pitch changes too)', () => {
    for (const [bpm, rough, minF] of [[92, false, 0.95], [124, false, 0.95], [148, true, 0.85]] as const) {
      const { x, times } = band(bpm, 12, 7, rough);
      const r = automap(x, SR);
      expect(Math.abs(r.bpm - bpm), `tempo ${bpm}`).toBeLessThan(1.5);
      const s = score(r.onsetTimes, times);
      // Legato notes on their own: the same band without its drums, the notes with no bass or pad
      // starting with them. Only a change of pitch marks them.
      const solo = band(bpm, 12, 7, rough, false);
      const legato = solo.truth.filter((t) => t.kind === 'legato').map((t) => t.at).filter((t) => !solo.truth.some((u) => u.kind !== 'legato' && Math.abs(u.at - t) < 0.06));
      const lg = score(automap(solo.x, SR).onsetTimes, legato);
      console.log(`band ${bpm} BPM${rough ? ' (room, noise, human timing)' : ''}: ${r.onsetTimes.length} found / ${times.length} true · precision ${(s.p * 100).toFixed(0)}% · recall ${(s.r * 100).toFixed(0)}% · F ${(s.f * 100).toFixed(0)}% · legato notes found ${(lg.r * 100).toFixed(0)}%`);
      // The previous mapper (three loudness bands) scored F 85% at 92 BPM and 62% at 124 BPM here,
      // finding half the legato notes at best.
      expect(s.f, `F-measure at ${bpm} BPM`).toBeGreaterThan(minF);
      expect(lg.r, `legato notes at ${bpm} BPM`).toBeGreaterThan(rough ? 0.7 : 0.9);
    }
  });
});
