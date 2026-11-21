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

/**
 * A busy phrase (scale above 1) lets the easier charts' tiles come closer: their minimum gap is
 * divided by its scale (Easy's 0.26 s down to about 0.21 s in the busiest phrases; the user, Nov 21:
 * "Easy can be made harder for this"). Without it a chorus couldn't get busier on Easy: its spacing,
 * not its budget, held it. Quiet phrases keep the difficulty's own gap.
 */
export const spacing = (scale: number) => 1 / Math.max(1, scale);

/**
 * The fewest tiles a second any stretch keeps where it has sounds (thin.ts each 4 s window,
 * leadline.ts each phrase), whatever the shape and the star calibration ask: a quiet verse on Easy
 * could otherwise thin to a tile every bar or two (the shape's 0.75 times the calibration's 0.7).
 */
export const STRETCH_FLOOR: Record<'easy' | 'medium' | 'hard' | 'ultra', number> = { easy: 0.5, medium: 0.8, hard: 1.1, ultra: 0 };

/**
 * In a phrase at least this busy, Medium lets taps come under a hold (as Hard always does): a
 * chorus on Medium was held back by its holds, not by its budget (on Open Your Eyes' saved chart
 * its busy phrases kept 12.6 tiles with the shape and without it; 14.5 with this). Its scales there
 * reach only 1.10, so the bar is the same as "busy" (GROW_FROM).
 */
export const HOLDS_FREE = 1.05;

/**
 * A repeated phrase builds on what it repeats in a busy part of the song (scale at least
 * GROW_FROM): from its second time on it takes GROW more of its notes each time (at most GROW_MAX),
 * so the last chorus is the busiest, as people chart it. Ultra plays every note anyway.
 */
export const GROW = 0.1;
export const GROW_MAX = 0.25;
export const GROW_FROM = 1.05;
/**
 * How much more a repeat (its `time`: 1 the first) in a phrase of `scale` takes; the pattern's last
 * time in the song (`last`: the final chorus) takes GROW_MAX, its payoff.
 */
export const growth = (scale: number, time: number, last = false) => (scale >= GROW_FROM && time >= 2 ? (last ? GROW_MAX : Math.min(GROW_MAX, GROW * (time - 1))) : 0);

/**
 * Where a chart has more holds than it may (KEEP.maxHolds), the ones worth least become taps:
 * worth is the hold's length, half again for a sung note (a held word) and half again for one that
 * ends a line (a rest of REST beats or more after it, or the song's end), so the holds kept are
 * the ones a person would hold. The song's last note keeps its hold.
 */
export const REST = 1;
export const holdWorth = (len: number, sung: boolean, endsLine: boolean) => len * (1 + (sung ? 0.5 : 0) + (endsLine ? 0.5 : 0));

/**
 * The most tiles a second any 4 s window of an easier chart may have (thin.ts), against its
 * difficulty's average cap (KEEP.rate): the star rating judges the whole chart, so a chorus could
 * otherwise spike far past the rest (the shape's 1.25, closer spacing, a repeat's growth).
 */
export const PEAK = 1.5;

/** A note within this (s) of a drop's first beat lands it: every difficulty keeps one there, Medium and up a chord of two where two parts strike. */
export const DROP_NEAR = 0.06;

export interface Shape {
  /** The scale of the phrase `p` (1 where nothing is known). */
  scale: (p: number) => number;
  /** The phrases a drop starts in. */
  drops: Set<number>;
  /**
   * Where each drop lands (seconds): the bar whose loudness jumps most against the bar before it,
   * from the last bar before the drop's phrase to its last bar (the loudness is by the bar, so a
   * drop in a phrase's second bar is placed there); the phrase's start without loudness.
   */
  dropSecs: number[];
}

/** Bars in a phrase. */
export const PHRASE_BARS = 2;

/**
 * The shape of a song from its sounds (seconds) and how a moment (seconds) maps to a phrase index,
 * with each phrase's length in seconds (for sounds a second).
 */
export function songShape(secs: number[], phraseOf: (sec: number) => number, startSec: (p: number) => number, barLoud?: (from: number, to: number) => number | null): Shape {
  const phraseSec = (p: number) => startSec(p + 1) - startSec(p);
  const loud = barLoud && ((p: number) => barLoud(startSec(p), startSec(p + 1)));
  const counts = new Map<number, number>();
  for (const s of secs) {
    const p = phraseOf(s);
    if (p < 0 || !Number.isFinite(p)) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const ids = [...counts.keys()].sort((a, b) => a - b);
  if (ids.length < 4) return { scale: () => 1, drops: new Set(), dropSecs: [] };
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
  // Each drop's bar.
  const dropSecs = [...drops].sort((a, b) => a - b).map((p) => {
    if (!useLoud || !barLoud) return startSec(p);
    // The bars from the last one before the phrase to its last, each against the bar before it.
    const bar = (q: number, k: number) => {
      const len = phraseSec(q) / PHRASE_BARS, from = startSec(q) + k * len;
      return { from, to: from + len };
    };
    const bars = [bar(p - 1, PHRASE_BARS - 2 >= 0 ? PHRASE_BARS - 2 : 0), bar(p - 1, PHRASE_BARS - 1), ...Array.from({ length: PHRASE_BARS }, (_, k) => bar(p, k))];
    let best = startSec(p), bestJump = 0;
    for (let k = 1; k < bars.length; k++) {
      const here = barLoud(bars[k].from + 1e-3, bars[k].to), before = barLoud(bars[k - 1].from + 1e-3, bars[k - 1].to);
      if (here == null || before == null) continue;
      const jump = here / Math.max(before, 1e-9);
      if (jump > bestJump * 1.05) { bestJump = jump; best = bars[k].from; }
    }
    return best;
  });
  return { scale: (p) => scales.get(p) ?? 1, drops, dropSecs };
}

/**
 * The breaths before a song's drops for one difficulty, in seconds: [start, end) of each, BREATH
 * beats long (`beatSec(sec)`: how long the beat is there), ending 10 ms before the drop's first beat.
 */
export function breathsOf(shape: Shape, d: keyof typeof BREATH, beatSec: (sec: number) => number): [number, number][] {
  if (!(BREATH[d] > 0)) return [];
  return shape.dropSecs.map((at) => [at - BREATH[d] * beatSec(at), at - 0.01] as [number, number]);
}

/** Whether `sec` falls inside one of the breaths. */
export const inBreath = (breaths: [number, number][], sec: number) => breaths.some(([a, b]) => sec > a && sec < b);

/** A hold shorter than this (beats) after being cut at a breath is a tap. */
const CUT_HOLD = 0.5;

/**
 * Holds that would ring on into a breath end where it starts (the breath is empty: the drop lands
 * after a pause), a tap if that leaves under CUT_HOLD beats. In place; `secOf` turns a tile's beat into seconds.
 */
export function cutHolds<T extends { t: number; len: number; hold?: boolean }>(notes: T[], breaths: [number, number][], secOf: (t: number) => number, beatOf: (sec: number) => number): T[] {
  if (!breaths.length) return notes;
  for (const n of notes) {
    if (!n.hold) continue;
    const from = secOf(n.t), to = secOf(n.t + n.len);
    const cut = breaths.find(([a]) => from <= a && to > a);
    if (!cut) continue;
    const len = Math.round((beatOf(cut[0]) - n.t) * 1000) / 1000;
    if (len >= CUT_HOLD) n.len = len;
    else { delete n.hold; n.len = 0.25; }
  }
  return notes;
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
