// The song's shape: how busy each phrase is against the song's usual phrase, and where a drop lands.
// A human mapper charts a chorus busier than the verse around it, eases off in a break, builds into
// a drop and leaves a breath just before it lands. Thinning (thin.ts) and the lead line
// (leadline.ts) kept each stretch's share of its notes, so a chart's busy and quiet parts were only
// as far apart as the notes heard there: every phrase was charted the same way. This turns the
// sounds heard into a scale per phrase (SHAPE: more notes in a busy phrase, fewer in a quiet one)
// that the easier difficulties multiply their budget by. Ultra (the whole chart) is never scaled.
//
// How busy a phrase is: its sounds a second (every part, the whole mix), not their strength
// (SoundEvent.strength is how much a sound stands out from the music around it, not how loud it
// is). Each phrase's count is smoothed with its neighbours' (a section lasts several phrases, and a
// fill or a missed bar shouldn't swing one phrase).

/** How a phrase's busyness (against the song's median phrase) becomes its scale: rel^GAMMA, within LO..HI. */
export const SHAPE = { gamma: 0.4, lo: 0.75, hi: 1.25 };
/** A drop: a phrase at least this many times as busy as the two before it, and busier than the song's usual. */
export const DROP_JUMP = 1.45;
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
export function songShape(secs: number[], phraseOf: (sec: number) => number, phraseSec: (p: number) => number): Shape {
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
  const smooth = new Map<number, number>();
  for (let p = first; p <= last; p++) smooth.set(p, 0.5 * at(p) + 0.25 * at(p - 1) + 0.25 * at(p + 1));
  const busy = [...smooth.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const median = busy[busy.length >> 1] || 1;
  const scales = new Map<number, number>();
  for (const [p, v] of smooth) {
    const rel = v / median;
    scales.set(p, rel <= 0 ? SHAPE.lo : Math.min(SHAPE.hi, Math.max(SHAPE.lo, rel ** SHAPE.gamma)));
  }
  // Drops use the raw counts (smoothing would spread the jump over the phrase before it).
  const drops = new Set<number>();
  for (let p = first + 2; p <= last; p++) {
    const before = (at(p - 1) + at(p - 2)) / 2;
    if (at(p) >= median && at(p) >= DROP_JUMP * Math.max(before, 1e-9) && !drops.has(p - 1)) {
      drops.add(p);
      scales.set(p - 1, Math.max(scales.get(p - 1) ?? 1, BUILD));
    }
  }
  return { scale: (p) => scales.get(p) ?? 1, drops };
}
