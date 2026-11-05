// Cues for the visuals (see Cue in src/api/types.ts). The AI mapper may send its own; when it
// doesn't, they are derived from the section labels: a drop where a chorus or drop starts (with a
// build four beats before it), a break where a break, bridge or outro starts.

import type { Cue, MapReport } from '../api/types';

export function cuesFromSections(sections: MapReport['sections']): Cue[] {
  const cues: Cue[] = [];
  for (const s of sections) {
    if (/chorus|drop/i.test(s.label)) {
      if (s.beat >= 4) cues.push({ beat: s.beat - 4, kind: 'build', strength: 0.8 });
      cues.push({ beat: s.beat, kind: 'drop', strength: 1 });
    } else if (/break|bridge|outro/i.test(s.label)) {
      cues.push({ beat: s.beat, kind: 'break', strength: 0.7 });
    }
  }
  return cues.sort((a, b) => a.beat - b.beat);
}

/** The cues a song's visuals should use: the mapper's own, or ones derived from its sections. */
export function cuesFor(report: MapReport | undefined): Cue[] {
  if (!report) return [];
  return report.cues?.length ? report.cues : cuesFromSections(report.sections);
}
