// The song's shape: how busy each phrase is against the song's usual phrase, and where a drop lands.
// A human mapper charts a chorus busier than the verse around it, eases off in a break, builds into
// a drop and leaves a breath just before it lands. Thinning (thin.ts) and the lead line
// (leadline.ts) kept each stretch's share of its notes, so a chart's busy and quiet parts were only
// as far apart as the notes heard there: every phrase was charted the same way. This turns the
// sounds heard into a scale per phrase (SHAPE: more notes in a busy phrase, fewer in a quiet one)
// that the easier difficulties multiply their budget by. Ultra (the whole chart) is never scaled.
//
// How busy a phrase is: its sounds a second (every part, the whole mix) and, when known, how loud it
// is (the onset mapper's loudness of each bar: AutomapResult.barEnergy), the two against the song's
// median phrase multiplied and square-rooted (a loud chorus of long held chords is busy though it has
// few new sounds; a quiet run of hats isn't, though it has many). Not the sounds' strength:
// SoundEvent.strength is how much a sound stands out from the music around it, not how loud it is.
// Each phrase is smoothed with its neighbours (a section lasts several phrases, and a fill or a
// missed bar shouldn't swing one phrase).

/** How a phrase's busyness (against the song's median phrase) becomes its scale: rel^GAMMA, within LO..HI. */
export const SHAPE = { gamma: 0.4, lo: 0.75, hi: 1.25 };
/** A drop: a phrase at least this many times as busy as the two before it, and busier than the song's usual. */
export const DROP_JUMP = 1.45;
/** A drop by loudness: a phrase at least this many times as loud as the two before it (automap.ts cues use 1.3 by the bar), and louder than the song's usual. */
export const DROP_LOUD = 1.3;
/** The phrase before a drop builds: its scale is at least this. */
export const BUILD = 1.1;
/**
 * The breath before a drop (beats): the easier charts leave this much empty before the drop's first
 * beat (Ultra none). Only tiles strictly inside it go; the drop's own downbeat stays.
 */
export const BREATH: Record<'easy' | 'medium' | 'hard' | 'ultra', number> = { easy: 1, medium: 0.75, hard: 0.5, ultra: 0 };

export interface Shape {
  /** The scale of the phrase `p` (1 where nothing is known). */
  scale: (p: number) => number;
  /** The phrases a drop starts on. */
  drops: Set<number>;
}

/**
 * The shape of a song from its sounds (seconds) and how a moment (seconds) maps to a phrase index,
 * with each phrase's length in seconds (for sounds a second).
 */
export function songShape(secs: number[], phraseOf: (sec: number) => number, phraseSec: (p: number) => number, loud?: (p: number) => number | null): Shape {
  const counts = new Map<number, number>();
  for (const s of secs) {
    const p = phraseOf(s);
    if (p < 0 || !Number.isFinite(p)) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const ids = [...counts.keys()].sort((a, b) => a - b);
  if (ids.length < 4) return { scale: () => 1, drops: new Set() };
  const first = ids[0], last = ids[ids.length - 1];
  const rate = new Map<number, number>();
  for (let p = first; p <= last; p++) rate.set(p, (counts.get(p) ?? 0) / Math.max(0.5, phraseSec(p)));
  const at = (p: number) => rate.get(Math.min(last, Math.max(first, p))) ?? 0;
  const loudness = new Map<number, number>();
  if (loud) for (let p = first; p <= last; p++) { const v = loud(p); if (v != null && Number.isFinite(v)) loudness.set(p, v); }
  const useLoud = loudness.size >= (last - first + 1) / 2 && [...loudness.values()].some((v) => v > 0);
  const lat = (p: number) => loudness.get(Math.min(last, Math.max(first, p))) ?? 0;
  const smoothed = (f: (p: number) => number) => {
    const m = new Map<number, number>();
    for (let p = first; p <= last; p++) m.set(p, 0.5 * f(p) + 0.25 * f(p - 1) + 0.25 * f(p + 1));
    return m;
  };
  const medianOf = (m: Map<number, number>) => { const v = [...m.values()].filter((x) => x > 0).sort((a, b) => a - b); return v[v.length >> 1] || 1; };
  const smooth = smoothed(at), median = medianOf(smooth);
  const smoothLoud = useLoud ? smoothed(lat) : null, medianLoud = smoothLoud ? medianOf(smoothLoud) : 1;
  const rawLoudMedian = useLoud ? medianOf(loudness) : 1;
  const scales = new Map<number, number>();
  for (const [p, v] of smooth) {
    const rel = smoothLoud ? Math.sqrt((v / median) * ((smoothLoud.get(p) ?? 0) / medianLoud)) : v / median;
    scales.set(p, rel <= 0 ? SHAPE.lo : Math.min(SHAPE.hi, Math.max(SHAPE.lo, rel ** SHAPE.gamma)));
  }
  // Drops use the raw counts (smoothing would spread the jump over the phrase before it).
  const drops = new Set<number>();
  for (let p = first + 2; p <= last; p++) {
    const before = (at(p - 1) + at(p - 2)) / 2;
    const busier = at(p) >= median && at(p) >= DROP_JUMP * Math.max(before, 1e-9);
    const louder = useLoud && lat(p) >= rawLoudMedian && lat(p) >= DROP_LOUD * Math.max((lat(p - 1) + lat(p - 2)) / 2, 1e-9);
    if ((busier || louder) && !drops.has(p - 1)) {
      drops.add(p);
      scales.set(p - 1, Math.max(scales.get(p - 1) ?? 1, BUILD));
    }
  }
  return { scale: (p) => scales.get(p) ?? 1, drops };
}

/**
 * A phrase's loudness from the onset mapper's loudness of each bar (AutomapResult.barEnergy: bars of
 * `barSec` from `offset`): the mean of the bars it overlaps, null outside them.
 */
export function phraseLoudness(barEnergy: number[] | undefined, offset: number, barSec: number): ((from: number, to: number) => number | null) | undefined {
  if (!barEnergy?.length || !(barSec > 0)) return undefined;
  return (from, to) => {
    const a = Math.max(0, Math.floor((from - offset) / barSec)), z = Math.min(barEnergy.length - 1, Math.floor((to - offset - 1e-6) / barSec));
    if (z < a) return null;
    let s = 0;
    for (let b = a; b <= z; b++) s += barEnergy[b];
    return s / (z - a + 1);
  };
}
