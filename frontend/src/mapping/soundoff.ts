// The sound-off report (the user, Nov 21: "with sound off, I could not find the rhythm or chorus";
// "significant pauses for parts that definitely should be played"). What a chart shows a player who
// can't hear the song: whether it keeps going while the music does, whether the bar's downbeat is
// there to count from, and whether a section that comes back looks like it did the first time.
// Measured the same way on our charts and on human ones (tools/map-pop.mjs, the dev tools).
//
//   longest   the longest stretch (s) with no tile (a hold counts while held) while the song plays
//   holes     stretches of at least two bars like that
//   downbeats the share of the bars' first beats, where the song plays, with a tile on them
//   returns   a section that comes back: the share of its rhythm (tile positions in the section) its
//             first time had, and of those the share in the same lane
//   rate      tiles a second while the song plays

export interface SoundOffTile {
  sec: number;
  lane: number;
  /** When it ends (s): its own time for a tap. */
  end: number;
}

export interface SoundOffSection {
  /** Its start and end (s), and which music it is (the same group is the same music; nth 0 its first time). */
  from: number;
  to: number;
  group: number;
  nth: number;
}

export interface SoundOffInput {
  tiles: SoundOffTile[];
  /** Every bar's first beat (s). */
  downbeats: number[];
  /** The song's beat at a time (any grid: the beat map's or the straight one), for rhythm positions. */
  beatOf: (sec: number) => number;
  /** Seconds per bar, for counting holes. */
  bar: number;
  /** Whether the song plays at a time (playingFrom: its loudness above the quiet level). */
  playing: (sec: number) => boolean;
  /** The song's length (s). */
  seconds: number;
  sections?: SoundOffSection[];
}

export interface SoundOff {
  longest: number;
  /** Where the longest stretch starts (s). */
  longestAt: number;
  holes: number;
  downbeats: number;
  /** Rhythm and lanes kept on a section's returns (null without returns). */
  returns: { rhythm: number; lanes: number; n: number } | null;
  rate: number;
}

/** A tile within this (s) of a downbeat is on it. */
const ON_DOWNBEAT = 0.07;
/** Seconds the playing test steps by. */
const STEP = 0.05;

export function soundOff(o: SoundOffInput): SoundOff {
  const tiles = [...o.tiles].sort((a, b) => a.sec - b.sec);
  // The stretches with no tile (a hold covers its length), measured only where the song plays.
  let longest = 0, longestAt = 0, holes = 0;
  let covered = 0;
  const runIn = (a: number, b: number) => {
    let run = 0, best = 0, bestAt = a, from = a;
    for (let t = a; t < b; t += STEP) {
      if (o.playing(t)) { if (!run) from = t; run += STEP; if (run > best) { best = run; bestAt = from; } } else run = 0;
    }
    return { best, bestAt };
  };
  const gaps: [number, number][] = [];
  for (const t of tiles) {
    if (t.sec > covered) gaps.push([covered, t.sec]);
    covered = Math.max(covered, t.end, t.sec);
  }
  gaps.push([covered, o.seconds]);
  for (const [a, b] of gaps) {
    if (b - a < 2 * STEP) continue;
    const { best, bestAt } = runIn(a, b);
    if (best >= o.bar * 2) holes++;
    if (best > longest) { longest = best; longestAt = bestAt; }
  }
  // Downbeats where it plays, with a tile.
  let bars = 0, hit = 0, j = 0;
  for (const d of o.downbeats) {
    if (d < 0 || d > o.seconds || !o.playing(d)) continue;
    bars++;
    while (j < tiles.length && tiles[j].sec < d - ON_DOWNBEAT) j++;
    if (j < tiles.length && Math.abs(tiles[j].sec - d) <= ON_DOWNBEAT) hit++;
  }
  // A section's returns against its first time, position by position (12ths of a beat from its start).
  let returns: SoundOff['returns'] = null;
  if (o.sections?.length) {
    const slots = (s: SoundOffSection) => {
      const start = o.beatOf(s.from);
      const m = new Map<number, Set<number>>();
      for (const t of tiles) {
        if (t.sec < s.from - 0.03 || t.sec >= s.to - 0.03) continue;
        const k = Math.round((o.beatOf(t.sec) - start) * 12);
        if (!m.has(k)) m.set(k, new Set());
        m.get(k)!.add(t.lane);
      }
      return m;
    };
    let rhythm = 0, lanes = 0, n = 0;
    for (const s of o.sections) {
      if (s.nth === 0) continue;
      const first = o.sections.find((x) => x.group === s.group && x.nth === 0);
      if (!first) continue;
      const a = slots(first), b = slots(s);
      // Compare as long as both run.
      const len = Math.min(first.to - first.from, s.to - s.from);
      const within = (m: Map<number, Set<number>>, from: number) => [...m.keys()].filter((k) => k / 12 < o.beatOf(from + len) - o.beatOf(from) - 0.01);
      const ka = within(a, first.from), kb = new Set(within(b, s.from));
      if (!ka.length && !kb.size) continue;
      const both = ka.filter((k) => kb.has(k));
      rhythm += both.length / Math.max(1, new Set([...ka, ...kb]).size);
      lanes += both.length ? both.filter((k) => same(a.get(k)!, b.get(k)!)).length / both.length : 0;
      n++;
    }
    if (n) returns = { rhythm: rhythm / n, lanes: lanes / n, n };
  }
  let playTime = 0;
  for (let t = 0; t < o.seconds; t += STEP) if (o.playing(t)) playTime += STEP;
  const starts = new Set(tiles.map((t) => Math.round(t.sec * 500))).size;
  return { longest, longestAt, holes, downbeats: bars ? hit / bars : 0, returns, rate: playTime ? starts / playTime : 0 };
}

function same(a: Set<number>, b: Set<number>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Whether the song plays at a time, from its loudness (levels.ts: three bands at `rate` a second):
 * the sum over half a second against the song's median, at least QUIET of it. A fade's last
 * whisper and the silence after the end don't count; a quiet verse does.
 */
export const QUIET = 0.2;
export function playingFrom(l: { rate: number; bass: ArrayLike<number>; mid: ArrayLike<number>; high: ArrayLike<number> }): (sec: number) => boolean {
  const n = l.bass.length;
  const sum = new Float32Array(n);
  for (let i = 0; i < n; i++) sum[i] = l.bass[i] + l.mid[i] + l.high[i];
  const sorted = [...sum].filter((x) => x > 0).sort((a, b) => a - b);
  const floor = (sorted[sorted.length >> 1] ?? 0) * QUIET;
  const half = Math.max(1, Math.round(l.rate * 0.25));
  return (sec: number) => {
    const i = Math.round(sec * l.rate);
    if (i < 0 || i >= n) return false;
    let s = 0, k = 0;
    for (let x = Math.max(0, i - half); x <= Math.min(n - 1, i + half); x++) { s += sum[x]; k++; }
    return s / k >= floor;
  };
}
