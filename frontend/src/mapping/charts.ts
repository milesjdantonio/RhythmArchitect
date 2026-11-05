// Turns a song's notes into one chart per difficulty. Every tile is a note of the song at the
// exact time it sounds: nothing is added, nudged, or picked at random. Difficulty only decides
// which of the song's notes you play, and how:
//   Easy   — the notes that stand out most, at least a beat apart; holds where a sound rings 2+ beats.
//   Medium — more of them, half a beat apart; holds from 1.5 beats.
//   Hard   — every note; taps under held notes; the biggest hits as two-lane chords.
// Lanes follow the pitch (higher notes further right, within a two-bar window), so the hand
// moves with the melody. Fully deterministic: the same notes always give the same charts.

import type { Chart, ChartNote, Difficulty } from '../api/types';
import { midiToName } from './theory';

export interface MelodyNote {
  /** Beat the note sounds. Exact: notes from real audio may fall between 16ths. */
  t: number;
  /** How long it rings, in beats. */
  len: number;
  /** Pitch height used for lanes: any number that rises with pitch (scale degree, MIDI…). */
  degree: number;
  /** On a strong beat (stands in for `strength` when that is missing). */
  strong: boolean;
  /** MIDI pitch. */
  midi?: number;
  /** A big hit with everything at once. Hard plays it as a two-lane chord. */
  accent?: boolean;
  /** 0..1, how much the note stands out from the music around it. */
  strength?: number;
}

interface Rules {
  lanes: number;
  /** Smallest gap between tiles, in beats. */
  minGap: number;
  /** Share of the notes (the most prominent, judged within a few bars) that may become tiles. */
  keep: number;
  /** Notes that ring at least this long become holds. */
  holdMin: number;
  /** Other tiles may fall while a hold is down. */
  playDuringHold: boolean;
  chords: boolean;
}

export const RULES: Record<Difficulty, Rules> = {
  easy: { lanes: 4, minGap: 1, keep: 0.6, holdMin: 2, playDuringHold: false, chords: false },
  medium: { lanes: 4, minGap: 0.5, keep: 0.85, holdMin: 1.5, playDuringHold: false, chords: false },
  hard: { lanes: 4, minGap: 0.24, keep: 1, holdMin: 1.5, playDuringHold: true, chords: true },
};

const near = (t: number, g: number) => Math.abs(t / g - Math.round(t / g)) < 0.03;

/** Fast songs space Easy and Medium out more, so tiles per second stay friendly. */
function tempoRule(rule: Rules, difficulty: Difficulty, bpm?: number): Rules {
  if (!bpm || difficulty === 'hard') return rule;
  const f = bpm > 150 ? 2 : bpm > 125 ? 1.5 : 1;
  return { ...rule, minGap: rule.minGap * f };
}

/** How much a note stands out: its strength, a little extra on the beat and for long notes. */
function prominence(n: MelodyNote) {
  const base = n.strength ?? (n.accent ? 1 : n.strong ? 0.75 : 0.45);
  return base + (near(n.t, 1) ? 0.08 : 0) + (near(n.t, 2) ? 0.04 : 0) + Math.min(0.1, n.len * 0.03);
}

/** A diatonic third below `midi` (3 or 4 semitones, whichever is in the scale). */
function thirdBelow(midi: number, scale: number[], root: number) {
  const inScale = (m: number) => scale.includes((((m - root) % 12) + 12) % 12);
  return inScale(midi - 3) ? midi - 3 : inScale(midi - 4) ? midi - 4 : midi - 3;
}

type Picked = MelodyNote & { hold: boolean };

/** Which notes become tiles: the most prominent first, as long as they keep their distance. */
function pick(melody: MelodyNote[], rule: Rules): Picked[] {
  const notes = [...melody].sort((a, b) => a.t - b.t);
  const prom = notes.map(prominence);
  // Prominence is judged against the notes within 4 beats, so quiet passages still get tiles.
  const eligible = notes.filter((n, i) => {
    if (rule.keep >= 1) return true;
    let lower = 0, count = 0;
    for (let j = i; j >= 0 && n.t - notes[j].t <= 4; j--) { count++; if (prom[j] < prom[i]) lower++; }
    for (let j = i + 1; j < notes.length && notes[j].t - n.t <= 4; j++) { count++; if (prom[j] < prom[i]) lower++; }
    return count <= 1 || lower / (count - 1) >= 1 - rule.keep - 1e-9;
  });
  const order = eligible.map((n) => ({ n, p: prominence(n) })).sort((a, b) => b.p - a.p || a.n.t - b.n.t);
  const chosen: Picked[] = [];
  const at = (t: number) => {
    let lo = 0, hi = chosen.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (chosen[mid].t < t) lo = mid + 1; else hi = mid; }
    return lo;
  };
  for (const { n } of order) {
    const i = at(n.t);
    const prev = chosen[i - 1], next = chosen[i];
    if (prev && n.t - prev.t < rule.minGap - 1e-6) continue;
    if (next && next.t - n.t < rule.minGap - 1e-6) continue;
    // Nothing else is played inside a hold on Easy and Medium.
    if (!rule.playDuringHold && prev?.hold && n.t < prev.t + prev.len + 0.25) continue;
    let len = n.len;
    let hold = len >= rule.holdMin;
    if (hold && !rule.playDuringHold && next) {
      len = Math.min(len, next.t - n.t - 0.5);
      hold = len >= rule.holdMin - 0.5 && len >= 1;
    }
    chosen.splice(i, 0, { ...n, len: hold ? len : Math.min(n.len, 1), hold });
  }
  return chosen;
}

export function chartFor(melody: MelodyNote[], difficulty: Difficulty, scale: number[], baseMidi: number, bpm?: number): Chart {
  const rule = tempoRule(RULES[difficulty], difficulty, bpm);
  const L = rule.lanes;
  const root = ((baseMidi % 12) + 12) % 12;
  const kept = pick(melody, rule);

  const notes: ChartNote[] = [];
  const holdEnd = new Array<number>(L).fill(-1);
  let lastLane = -1;
  let sameRun = 0;
  for (let i = 0; i < kept.length; i++) {
    const n = kept[i];
    const midi = n.midi ?? 60;
    // Lane from how high the sound is, ranked among the notes of its two-bar window: the hand
    // follows the melody's shape, every lane gets used, and one very high or low sound (a hat,
    // a kick) doesn't squeeze the rest into one lane.
    const block = Math.floor(n.t / 8);
    let below = 0, same = 0, total = 0;
    for (const m of kept) {
      if (Math.floor(m.t / 8) !== block) continue;
      total++;
      if (m.degree < n.degree) below++; else if (m.degree === n.degree) same++;
    }
    let lane = below === 0 && same === total ? (block % 2 ? 2 : 1) : Math.min(L - 1, Math.floor(((below + (same - 1) / 2) / Math.max(1, total - 1)) * L * 0.999));
    const prev = kept[i - 1];
    if (prev && lane === lastLane && prev.degree !== n.degree) {
      // A different pitch moves the hand, in the direction the melody went.
      lane = Math.max(0, Math.min(L - 1, lane + (n.degree > prev.degree ? 1 : -1)));
      if (lane === lastLane) lane = lane === 0 ? 1 : lane - 1;
    }
    // Long runs on one key get split across neighbours.
    if (lane === lastLane && ++sameRun >= (difficulty === 'hard' ? 3 : 2)) {
      lane = lane <= 1 ? lane + 1 : lane - 1;
      sameRun = 0;
    } else if (lane !== lastLane) sameRun = 0;
    // Never put a tile on a lane that is still held.
    if (holdEnd[lane] > n.t) {
      const free = [...Array(L).keys()].filter((l) => holdEnd[l] <= n.t).sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane) || a - b);
      if (!free.length) continue;
      lane = free[0];
    }
    notes.push({ t: round(n.t, 1000), lane, pitch: midiToName(midi), len: round(n.len, 100), ...(n.hold ? { hold: true } : {}) });
    if (n.hold) holdEnd[lane] = n.t + n.len + 0.25;
    lastLane = lane;

    // Hard: the biggest hits (everything at once in the music) become two-lane chords.
    if (rule.chords && n.accent) {
      const options = [...Array(L).keys()].filter((l) => Math.abs(l - lane) >= 2 && holdEnd[l] <= n.t)
        .sort((a, b) => Math.abs(b - lane) - Math.abs(a - lane) || a - b);
      if (options.length) {
        const l2 = options[0];
        notes.push({ t: round(n.t, 1000), lane: l2, pitch: midiToName(thirdBelow(midi, scale, root)), len: round(n.len, 100), ...(n.hold ? { hold: true } : {}) });
        if (n.hold) holdEnd[l2] = n.t + n.len + 0.25;
      }
    }
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return { difficulty, lanes: L, notes };
}

const round = (x: number, k: number) => Math.round(x * k) / k;

export function buildCharts(melody: MelodyNote[], scale: number[], baseMidi: number, bpm?: number): Record<Difficulty, Chart> {
  return {
    easy: chartFor(melody, 'easy', scale, baseMidi, bpm),
    medium: chartFor(melody, 'medium', scale, baseMidi, bpm),
    hard: chartFor(melody, 'hard', scale, baseMidi, bpm),
  };
}
