// Easy and Medium as one line of the song a phrase at a time (the user, Nov 20: players asked "what
// notes even are these?"). Thinned from the trained mapper's chart, a phrase's tiles hopped between
// parts (a syllable, the kick, a synth stab: two thirds of an Easy phrase on one part), and a bar
// of the song coming back rarely came back in the chart. Here each 2-bar phrase takes one part, its
// lead: the singing where there is singing, else the strongest of the instruments (drums, bass, the
// rest), keeping the last phrase's lead while it's nearly as strong; its tiles are that part's
// notes, on the beat map's grid; a phrase whose lead plays the rhythm of an earlier one takes that
// one's pattern; the lanes follow the lead's pitch (lanes.ts flowChart).
//
// It needs the song split (the parts: SoundEvent.part, the syllables: voice.ts); without them
// Easy and Medium are thinned from the trained mapper's chart as before (thin.ts).

import type { Chart, ChartNote, SoundEvent } from '../api/types';
import { KEEP } from './thin';
import { flowChart } from './lanes';
import { barOf, beatAt, divisionAt, secAt, type BeatMap } from './beatmap';
import type { Syllable } from './voice';

type Part = 'vocals' | 'drums' | 'bass' | 'other';
interface Cand { sec: number; t: number; part: Part; strength: number; midi: number | null; len: number; band: SoundEvent['band'] | null }

/** How much each part's notes count when choosing a phrase's lead (the singing first). */
const LEAD_WEIGHT: Record<Part, number> = { vocals: 1.6, other: 1.1, drums: 1, bass: 0.6 };
/** A part needs this many notes in a phrase to lead it. */
const LEAD_MIN = 3;
/** The last phrase's lead stays while it's at least this share of the best one. */
const STAY = 0.7;
/** A phrase whose lead rhythm is this alike an earlier one's (16ths in common) takes its pattern. */
const ALIKE = 0.75;
/** Easy fills from the second part only where the lead has under this share of the notes it wants. */
const EASY_FILL = 0.5;
/** A sung note this long (s, and an 8th or more) is a hold. */
const HOLD_SEC = 0.35;
const HOLD_BEATS = 0.5;

export interface LeadInput {
  bpm: number;
  offset: number;
  events: SoundEvent[];
  voice: Syllable[];
  map: BeatMap | null;
}

/** Whether a song has what a lead line needs: its sounds labelled by part. */
export const hasParts = (events: SoundEvent[]) => events.some((e) => e.part);

/** The nearest point of the song's grid (the beat map's division there, 16ths where it has none). */
function gridSec(sec: number, o: LeadInput): number {
  const spb = 60 / o.bpm;
  if (!o.map) return o.offset + (Math.round(((sec - o.offset) / spb) * 4) / 4) * spb;
  const p = beatAt(o.map, sec), d = divisionAt(o.map, p) || 4;
  return secAt(o.map, Math.round(p * d) / d);
}

/**
 * The lead line's Easy or Medium (`scale` times KEEP's share, rate and floor, as thin.ts's are
 * calibrated). `ultra`: the trained mapper's whole chart, whose tiles a phrase's share is counted from.
 */
export function leadLine(o: LeadInput, ultra: ChartNote[]): (d: 'easy' | 'medium', scale?: number) => Chart {
  const spb = 60 / o.bpm;
  const toT = (sec: number) => Math.round(((sec - o.offset) / spb) * 1000) / 1000;
  const phraseOf = (sec: number) => (o.map ? Math.floor(barOf(o.map, beatAt(o.map, sec)) / 2) : Math.floor(((sec - o.offset) / spb) / 8));

  // Every part's notes, on the grid (one per part per grid point: the strongest).
  const cands: Cand[] = [];
  const seen = new Map<string, Cand>();
  const add = (c: Cand) => {
    const key = `${c.part}:${Math.round(c.sec * 1000)}`;
    const had = seen.get(key);
    if (had && had.strength >= c.strength) return;
    if (had) cands.splice(cands.indexOf(had), 1);
    seen.set(key, c);
    cands.push(c);
  };
  for (const s of o.voice) {
    const sec = gridSec(s.sec, o);
    if (sec < o.offset) continue;
    add({ sec, t: toT(sec), part: 'vocals', strength: 0.4 + s.strength * 0.6, midi: s.midi, len: s.len, band: null });
  }
  for (const e of o.events) {
    if (!e.part || e.part === 'vocals') continue;
    const sec = gridSec(e.sec, o);
    if (sec < o.offset) continue;
    // Drums have no pitch: the kick low, the rest high, so the lanes split them.
    const midi = e.part === 'drums' ? (e.band === 'low' ? 40 : e.band === 'high' ? 84 : 64) : e.midi;
    add({ sec, t: toT(sec), part: e.part, strength: e.strength + (e.accent ? 0.3 : 0), midi, len: e.len * spb, band: e.band });
  }
  cands.sort((a, b) => a.sec - b.sec);

  // The phrases, their lead, and the Ultra tiles each has (the share is counted from those).
  const phrases = new Map<number, Cand[]>();
  for (const c of cands) { const p = phraseOf(c.sec); if (!phrases.has(p)) phrases.set(p, []); phrases.get(p)!.push(c); }
  const ultraIn = new Map<number, number>();
  for (const n of ultra) { const p = phraseOf(o.offset + n.t * spb); ultraIn.set(p, (ultraIn.get(p) ?? 0) + 1); }
  const ids = [...new Set([...phrases.keys(), ...ultraIn.keys()])].sort((a, b) => a - b);
  const lead = new Map<number, Part>();
  // Each phrase's second part: where the lead has too few notes for the difficulty (a sung line is
  // sparser than Medium), its tiles come from this one part, not from whatever is loudest.
  const second = new Map<number, Part>();
  let last: Part | null = null, lastSecond: Part | null = null;
  for (const p of ids) {
    const score = new Map<Part, number>(), count = new Map<Part, number>();
    for (const c of phrases.get(p) ?? []) {
      score.set(c.part, (score.get(c.part) ?? 0) + c.strength * LEAD_WEIGHT[c.part]);
      count.set(c.part, (count.get(c.part) ?? 0) + 1);
    }
    const able = [...score.entries()].filter(([k]) => (count.get(k) ?? 0) >= LEAD_MIN).sort((a, b) => b[1] - a[1]);
    if (!able.length) continue;
    const best = able[0];
    const keep: boolean = !!last && score.has(last) && (count.get(last) ?? 0) >= LEAD_MIN && (score.get(last) ?? 0) >= best[1] * STAY;
    const chosen: Part = keep ? last! : best[0];
    lead.set(p, chosen);
    last = chosen;
    const rest = able.filter(([k]) => k !== chosen);
    if (rest.length) {
      const keep2: boolean = !!lastSecond && lastSecond !== chosen && rest.some(([k, v]) => k === lastSecond && v >= rest[0][1] * STAY);
      const two: Part = keep2 ? lastSecond! : rest[0][0];
      second.set(p, two);
      lastSecond = two;
    }
  }

  // A phrase's lead rhythm: its notes' 16ths from the phrase's first beat.
  const slotOf = (c: Cand, p: number) => {
    const beat = o.map ? beatAt(o.map, c.sec) : (c.sec - o.offset) / spb;
    const first = o.map ? (() => { let b = Math.floor(beat); while (b > 0 && phraseOf(secAt(o.map!, b - 1)) === p) b--; return b; })() : p * 8;
    return Math.round((beat - first) * 4);
  };

  return (d, scale = 1) => {
    const k = KEEP[d];
    const share = Math.min(1, k.share * scale), rate = k.rate * scale, floor = k.floor * scale;
    const picked: Cand[] = [];
    const patterns: { part: Part; slots: Set<number>; chosen: Set<string> }[] = [];
    const keyOf = (c: Cand, p: number) => `${c.part}:${slotOf(c, p)}`;
    for (const p of ids) {
      const part = lead.get(p);
      if (!part) continue;
      const own = (phrases.get(p) ?? []).filter((c) => c.part === part);
      const two = second.get(p);
      const fillFrom = two ? (phrases.get(p) ?? []).filter((c) => c.part === two) : [];
      const secs = own.length ? own[own.length - 1].sec - own[0].sec + spb : 8 * spb;
      const span = Math.max(8 * spb * 0.5, secs);
      const budget = Math.max(1, Math.round(Math.min(Math.max((ultraIn.get(p) ?? own.length) * share, floor * span), rate * span)));
      const slots = new Map(own.map((c) => [slotOf(c, p), c] as const));
      // Medium fills from the second part where the lead runs short; Easy only where the lead has
      // under half the notes it wants (a phrase with a few long sung notes), else it's the lead alone.
      const fill = d === 'medium' || own.length < budget * EASY_FILL ? fillFrom : [];
      // The same rhythm as an earlier phrase on the same part: its pattern again.
      const twin = patterns.find((q) => q.part === part && jaccard(q.slots, new Set(slots.keys())) >= ALIKE);
      let chosen: Cand[];
      if (twin) {
        chosen = [...own, ...fill].filter((c) => twin.chosen.has(keyOf(c, p)));
      } else {
        chosen = [];
        // The strongest, on the beat a little first, as far apart as the difficulty wants: the
        // lead's notes, then (while it's short) the second part's.
        const weight = (c: Cand) => c.strength + (Math.abs(c.t - Math.round(c.t)) < 0.01 ? 0.1 : 0);
        for (const from of [own, fill]) {
          for (const c of [...from].sort((a, b) => weight(b) - weight(a) || a.sec - b.sec)) {
            if (chosen.length >= budget) break;
            if (chosen.some((x) => Math.abs(x.sec - c.sec) < k.minGap)) continue;
            if (picked.some((x) => Math.abs(x.sec - c.sec) < k.minGap)) continue;
            chosen.push(c);
          }
        }
      }
      chosen = chosen.filter((c) => !picked.some((x) => Math.abs(x.sec - c.sec) < k.minGap));
      chosen.sort((a, b) => a.sec - b.sec);
      chosen = chosen.filter((c, i) => i === 0 || c.sec - chosen[i - 1].sec >= k.minGap);
      patterns.push({ part, slots: new Set(slots.keys()), chosen: new Set(chosen.map((c) => keyOf(c, p))) });
      picked.push(...chosen);
    }
    picked.sort((a, b) => a.sec - b.sec);
    // Long sung notes are holds (nothing starts under one: the next tile's gap is kept).
    const notes: ChartNote[] = picked.map((c, i) => {
      const next = picked[i + 1];
      const room = next ? next.sec - c.sec - k.minGap : c.len;
      const len = Math.min(c.len, room);
      const n: ChartNote = { t: c.t, lane: 0, pitch: 'C5', len: 0.25 };
      if (c.part === 'vocals' && len >= HOLD_SEC && len / spb >= Math.max(HOLD_BEATS, k.minHold[0])) { n.hold = true; n.len = Math.round((len / spb) * 1000) / 1000; }
      return n;
    });
    // Too many holds for the difficulty: the shortest are taps.
    const holds = notes.filter((n) => n.hold).sort((a, b) => a.len - b.len);
    const room = Math.floor((k.maxHolds ?? 1) * notes.length);
    for (const n of holds.slice(0, Math.max(0, holds.length - room))) { delete n.hold; n.len = 0.25; }
    const pitchAt = new Map(picked.map((c, i) => [notes[i], c.midi] as const));
    return { difficulty: d, lanes: 4, notes: flowChart(notes, d, spb, { pitch: (n) => pitchAt.get(n) ?? null }) };
  };
}

function jaccard(a: Set<number>, b: Set<number>) {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / Math.max(1, a.size + b.size - i);
}
