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

/**
 * A stretch of the song the drop plays through, in beats: the visuals stay in drop mode from
 * `from` to `to` (the stage's lasers and warp, the edges). `big`: a real drop (a "Chorus (drop)"
 * section, or a drop cue outside any chorus: the mapper's own) gets the DROP badge too; a plain
 * chorus doesn't. `strength` 0..1, how hard it all shows: a real drop at least `DROP_LEAST` (more
 * as its cue says), a plain chorus `CHORUS_DROP` of its cue, so the song's biggest moment stands out.
 */
export interface DropZone { from: number; to: number; strength: number; big: boolean; label: string }

/** A plain chorus's drop mode, against a real drop's 1. */
export const CHORUS_DROP = 0.6;
/** The least a real drop shows (its cue's strength above it). */
const DROP_LEAST = 0.8;
/** The shortest a drop runs before a new section can end it (beats: 4 bars). */
const DROP_MIN = 16;
/** The shortest before a break or build cue can end it (beats: 2 bars). */
const CUE_MIN = 8;
/** The longest one drop mode lasts (beats: 16 bars), so a mislabelled song isn't lit throughout. */
const DROP_MAX = 64;

/**
 * Where the song's drops play, from its drop cues: each runs until the next drop, break or build
 * cue (at least CUE_MIN beats on), or the next section after DROP_MIN beats, at most DROP_MAX
 * beats, never past the song's end.
 */
export function dropZones(report: MapReport | undefined, lengthBeats: number): DropZone[] {
  if (!report) return [];
  const cues = cuesFor(report);
  const sections = [...(report.sections ?? [])].sort((a, b) => a.beat - b.beat);
  const sectionAt = (beat: number) => {
    let s: MapReport['sections'][number] | undefined;
    for (const x of sections) { if (x.beat <= beat + 0.5) s = x; else break; }
    return s;
  };
  const zones: DropZone[] = [];
  const drops = cues.filter((c) => c.kind === 'drop').sort((a, b) => a.beat - b.beat);
  for (const d of drops) {
    const from = Math.max(0, d.beat);
    if (from >= lengthBeats - 1) continue;
    let to = Math.min(lengthBeats, from + DROP_MAX);
    for (const c of cues) {
      if (c.beat <= from + 1e-6) continue;
      if (c.kind === 'drop' || ((c.kind === 'break' || c.kind === 'build') && c.beat >= from + CUE_MIN)) { to = Math.min(to, c.beat); break; }
    }
    for (const s of sections) {
      if (s.beat >= from + DROP_MIN) { to = Math.min(to, s.beat); break; }
    }
    // Under a bar of it: nothing to keep up (a drop cue a moment before the next one).
    if (to - from < 4) continue;
    const sec = sectionAt(from);
    const label = sec?.label ?? 'Drop';
    const big = /drop/i.test(label) || !/chorus/i.test(label);
    const cue = Math.max(0, Math.min(1, d.strength ?? 1));
    if (cue <= 0) continue;
    const strength = big ? Math.max(DROP_LEAST, cue) : cue * CHORUS_DROP;
    // Back to back with the last, the stage stays in drop mode across the join (Play): a new drop
    // lands on it with its own burst.
    zones.push({ from, to, strength, big, label });
  }
  return zones;
}

/** The drop playing at `beat` (and how far through it, 0..1), or null. Zones are in order. */
export function dropAt(zones: DropZone[], beat: number): { zone: DropZone; index: number; through: number } | null {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (beat < z.from) return null;
    if (beat < z.to) return { zone: z, index: i, through: (beat - z.from) / (z.to - z.from) };
  }
  return null;
}
