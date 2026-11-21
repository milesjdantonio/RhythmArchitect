// Every difficulty as the song's own lines, a phrase at a time (the user, Nov 20: players asked
// "what notes even are these?"; then "why not Hard and Ultra too", and "the piano solo at the
// start of Open Your Eyes should be mapped, every note"). Thinned from the trained mapper's chart,
// a phrase's tiles hopped between parts (a syllable, the kick, a synth stab), and dropping tiles by
// loudness left gaps that matched nothing in the music.
//
// Each 2-bar phrase takes a lead: the singing where there is singing, else the strongest of the
// instruments (their notes heard note by note: a piano solo is its notes), keeping the last
// phrase's lead while it's nearly as strong; and a second part. The difficulties:
//   Easy    the lead (the second part only where the lead is nearly silent)
//   Medium  the lead, the second part where the lead runs short
//   Hard    both lines, chords of two where they strike together on a strong hit
//   Ultra   both lines whole: every note of the lead (each piano note of a solo), chords where they meet
// Notes are kept by where they fall in the bar (a downbeat, a beat, an 8th, a 16th) before how loud
// they are, so an easier chart is the same rhythm simplified, not a scatter of the loudest notes; a
// note pushing just ahead of a beat that has none counts as that beat (syncopation stays). Tiles go
// on the beat map's grid; a phrase whose lead plays an earlier one's rhythm takes its pattern; the
// lanes follow the lead's pitch (lanes.ts flowChart).
//
// It needs the song split (the parts: SoundEvent.part, the syllables and the instruments' notes:
// voice.ts); without them the charts are the trained mapper's, thinned (thin.ts).

import type { Chart, ChartNote, Difficulty, SoundEvent } from '../api/types';
import { KEEP } from './thin';
import { flowChart } from './lanes';
import { barOf, beatAt, divisionAt, secAt, type BeatMap } from './beatmap';
import type { Syllable } from './voice';

type Part = 'vocals' | 'drums' | 'bass' | 'other';
interface Cand { sec: number; t: number; beat: number; part: Part; strength: number; midi: number | null; len: number }

/** How much each part's notes count when choosing a phrase's lead (the singing first). */
const LEAD_WEIGHT: Record<Part, number> = { vocals: 1.6, other: 1.2, drums: 1, bass: 0.6 };
/** A part needs this many notes in a phrase to lead it (or be its second). */
const LEAD_MIN = 3;
/** The last phrase's lead (and second) stays while it's at least this share of the best. */
const STAY = 0.7;
/** A phrase whose lead rhythm is this alike an earlier one's (16ths in common) takes its pattern. */
const ALIKE = 0.75;
/** Easy takes the second part only where the lead has under this share of the notes it wants. */
const EASY_FILL = 0.5;
/** A note held this long (s, and an 8th or more) is a hold. */
const HOLD_SEC = 0.35;
const HOLD_BEATS = 0.5;
/** Where a note falls in the bar, for keeping: the downbeat, a beat, an 8th, a triplet, a 16th. */
const METRIC = { downbeat: 1, beat: 0.8, eighth: 0.5, triplet: 0.35, sixteenth: 0.2 };
/** The lead's notes are kept before the second part's by this much. */
const LEAD_FIRST = 0.4;

/** Which parts each difficulty plays, and when two of them striking together are a chord. */
const PROFILE: Record<Difficulty, { second: 'sparse' | 'short' | 'always'; chords: 'never' | 'strong' | 'always' }> = {
  easy: { second: 'sparse', chords: 'never' },
  medium: { second: 'short', chords: 'never' },
  hard: { second: 'always', chords: 'strong' },
  ultra: { second: 'always', chords: 'always' },
};

export interface LeadInput {
  bpm: number;
  offset: number;
  events: SoundEvent[];
  voice: Syllable[];
  /** The instruments' notes (the "other" part), when heard. */
  played?: Syllable[];
  map: BeatMap | null;
  meter?: number;
}

/** Whether a song has what a lead line needs: its sounds labelled by part. */
export const hasParts = (events: SoundEvent[]) => events.some((e) => e.part);

/** A charting of every difficulty from the song's lines: `make(d, scale)`, scale trading notes for stars. */
export function leadLine(o: LeadInput): (d: Difficulty, scale?: number) => Chart {
  const spb = 60 / o.bpm;
  const meter = o.meter ?? 4;
  const beatOf = (sec: number) => (o.map ? beatAt(o.map, sec) : (sec - o.offset) / spb);
  const secOf = (beat: number) => (o.map ? secAt(o.map, beat) : o.offset + beat * spb);
  const phraseOf = (beat: number) => (o.map ? Math.floor(barOf(o.map, beat) / 2) : Math.floor(beat / (meter * 2)));
  /** The grid's nearest point to `sec` (the beat map's division there, 16ths where it has none), in beats. */
  const gridBeat = (sec: number) => {
    const b = beatOf(sec);
    const d = (o.map ? divisionAt(o.map, b) : 4) || 4;
    return Math.round(b * d) / d;
  };

  // Every part's notes, on the grid (one per part per grid point: the strongest).
  const byKey = new Map<string, Cand>();
  const add = (sec: number, part: Part, strength: number, midi: number | null, len: number) => {
    const beat = gridBeat(sec);
    const at = secOf(beat);
    if (at < o.offset - 0.001) return;
    const key = `${part}:${beat.toFixed(4)}`;
    const had = byKey.get(key);
    if (had && had.strength >= strength) return;
    byKey.set(key, { sec: at, t: Math.round(((at - o.offset) / spb) * 1000) / 1000, beat, part, strength, midi, len });
  };
  for (const s of o.voice) add(s.sec, 'vocals', 0.4 + s.strength * 0.6, s.midi, s.len);
  const notesOther = o.played ?? [];
  for (const s of notesOther) add(s.sec, 'other', 0.4 + s.strength * 0.6, s.midi, s.len);
  for (const e of o.events) {
    if (!e.part || e.part === 'vocals' || (e.part === 'other' && notesOther.length)) continue;
    // Drums have no pitch: the kick low, the rest high, so the lanes split them.
    const midi = e.part === 'drums' ? (e.band === 'low' ? 40 : e.band === 'high' ? 84 : 64) : e.midi;
    add(e.sec, e.part, e.strength + (e.accent ? 0.3 : 0), midi, e.part === 'drums' ? 0 : e.len * spb);
  }
  const cands = [...byKey.values()].sort((a, b) => a.sec - b.sec || a.part.localeCompare(b.part));

  // Where each note falls in the bar; one pushing ahead of a beat with no note of its part counts as that beat.
  const metricOf = new Map<Cand, number>();
  const has = new Set(cands.map((c) => `${c.part}:${c.beat.toFixed(4)}`));
  for (const c of cands) {
    const f = c.beat - Math.floor(c.beat + 1e-6);
    const near = (x: number) => Math.abs(f - x) < 0.02;
    let m = near(0) ? (Math.round(c.beat) % meter === 0 ? METRIC.downbeat : METRIC.beat)
      : near(0.5) ? METRIC.eighth : near(1 / 3) || near(2 / 3) ? METRIC.triplet : METRIC.sixteenth;
    const next = Math.ceil(c.beat + 1e-6);
    if (m < METRIC.beat && next - c.beat <= 0.5 + 1e-6 && !has.has(`${c.part}:${next.toFixed(4)}`)) m = Math.min(METRIC.beat, m + 0.3);
    metricOf.set(c, m);
  }

  // The phrases, each one's lead and second part.
  const phrases = new Map<number, Cand[]>();
  for (const c of cands) { const p = phraseOf(c.beat); if (!phrases.has(p)) phrases.set(p, []); phrases.get(p)!.push(c); }
  const ids = [...phrases.keys()].sort((a, b) => a - b);
  const lead = new Map<number, Part>(), second = new Map<number, Part>();
  let last: Part | null = null, lastSecond: Part | null = null;
  for (const p of ids) {
    const score = new Map<Part, number>(), count = new Map<Part, number>();
    for (const c of phrases.get(p)!) {
      score.set(c.part, (score.get(c.part) ?? 0) + c.strength * LEAD_WEIGHT[c.part]);
      count.set(c.part, (count.get(c.part) ?? 0) + 1);
    }
    const able = [...score.entries()].filter(([k]) => (count.get(k) ?? 0) >= LEAD_MIN).sort((a, b) => b[1] - a[1]);
    if (!able.length) continue;
    const stays = (k: Part | null, list: [Part, number][]) => !!k && list.some(([x, v]) => x === k && v >= list[0][1] * STAY);
    const one: Part = stays(last, able) ? last! : able[0][0];
    lead.set(p, one);
    last = one;
    const rest = able.filter(([k]) => k !== one);
    if (rest.length) {
      const two: Part = stays(lastSecond, rest) ? lastSecond! : rest[0][0];
      second.set(p, two);
      lastSecond = two;
    }
  }
  // The 16th of a note from its phrase's start (for telling rhythms apart).
  const firstBeat = new Map<number, number>();
  for (const p of ids) firstBeat.set(p, Math.floor(Math.min(...phrases.get(p)!.map((c) => c.beat))));
  const slotOf = (c: Cand, p: number) => Math.round((c.beat - firstBeat.get(p)!) * 4);
  const keyOf = (c: Cand, p: number) => `${c.part}:${slotOf(c, p)}`;

  return (d, scale = 1) => {
    const k = KEEP[d], prof = PROFILE[d];
    const minGap = k.minGap;
    const share = d === 'ultra' ? Math.min(1, scale) : Math.min(1, k.share * scale);
    const picked: { c: Cand; chord: boolean }[] = [];
    const patterns: { part: Part; slots: Set<number>; chosen: Set<string> }[] = [];
    let chordsLeft = prof.chords === 'never' ? 0 : Infinity;
    for (const p of ids) {
      const one = lead.get(p);
      if (!one) continue;
      const all = phrases.get(p)!;
      const own = all.filter((c) => c.part === one);
      const two = second.get(p);
      const fillFrom = two ? all.filter((c) => c.part === two) : [];
      // The phrase's tiles: a share of both lines' notes (Ultra all of them), at most `rate` a second.
      const span = Math.max(meter * spb, (Math.max(...all.map((c) => c.sec)) - Math.min(...all.map((c) => c.sec))) + spb);
      const whole = own.length + fillFrom.length;
      const budget = Math.max(1, Math.round(Math.min(Math.max(whole * share, k.floor * scale * span), k.rate * scale * span)));
      const takeSecond = prof.second !== 'sparse' || own.length < budget * EASY_FILL;
      const pool = takeSecond ? [...own, ...fillFrom] : own;
      const slots = new Set(own.map((c) => slotOf(c, p)));
      const twin = patterns.find((q) => q.part === one && jaccard(q.slots, slots) >= ALIKE);
      const weight = (c: Cand) => metricOf.get(c)! + c.strength * 0.6 + (c.part === one ? LEAD_FIRST : 0);
      const chosen: { c: Cand; chord: boolean }[] = [];
      const clash = (c: Cand) => [...picked, ...chosen].find((x) => Math.abs(x.c.sec - c.sec) < minGap);
      const order = twin ? pool.filter((c) => twin.chosen.has(keyOf(c, p))) : [...pool].sort((a, b) => weight(b) - weight(a) || a.sec - b.sec);
      for (const c of order) {
        if (!twin && chosen.length >= budget) break;
        const x = clash(c);
        if (!x) { chosen.push({ c, chord: false }); continue; }
        // Two parts striking together: a chord where the difficulty has them.
        const together = Math.abs(x.c.sec - c.sec) < 0.002 && x.c.part !== c.part && !x.chord && chordsLeft > 0
          && (prof.chords === 'always' || (prof.chords === 'strong' && c.strength >= 0.6 && x.c.strength >= 0.6));
        if (together) { x.chord = true; chosen.push({ c, chord: true }); chordsLeft--; }
      }
      patterns.push({ part: one, slots, chosen: new Set(chosen.map((x) => keyOf(x.c, p))) });
      picked.push(...chosen);
    }
    picked.sort((a, b) => a.c.sec - b.c.sec);

    // The tiles: holds where a note is held long (on the easier difficulties nothing starts under
    // one), a chord's two tiles on lanes apart, lanes with the lead's pitch.
    const notes: ChartNote[] = [];
    const pitchOf = new Map<ChartNote, number | null>();
    for (let i = 0; i < picked.length; i++) {
      const { c } = picked[i];
      const next = picked.slice(i + 1).find((x) => x.c.sec - c.sec > 0.002);
      const room = next ? next.c.sec - c.sec - (k.holdsAlone ? minGap : 0) : c.len;
      const len = Math.min(c.len, room);
      const n: ChartNote = { t: c.t, lane: 0, pitch: 'C5', len: 0.25 };
      const minHold = Math.max(HOLD_BEATS, k.minHold[0], k.minHold[1] / spb);
      if (c.part !== 'drums' && len >= HOLD_SEC && len / spb >= minHold) { n.hold = true; n.len = Math.round((len / spb) * 1000) / 1000; }
      notes.push(n);
      pitchOf.set(n, c.midi);
    }
    for (let i = 0; i + 1 < notes.length; i++) {
      if (Math.abs(notes[i + 1].t - notes[i].t) >= 0.002) continue;
      const low = (pitchOf.get(notes[i]) ?? 60) <= (pitchOf.get(notes[i + 1]) ?? 60);
      const pair = i % 4 < 2 ? [0, 2] : [1, 3];
      notes[i].lane = low ? pair[0] : pair[1];
      notes[i + 1].lane = low ? pair[1] : pair[0];
      i++;
    }
    // Too many holds for the difficulty: the shortest are taps.
    const holds = notes.filter((n) => n.hold).sort((a, b) => a.len - b.len);
    const room = Math.floor((k.maxHolds ?? 1) * notes.length);
    for (const n of holds.slice(0, Math.max(0, holds.length - room))) { delete n.hold; n.len = 0.25; }
    return { difficulty: d, lanes: 4, notes: flowChart(notes, d, spb, { pitch: (n) => pitchOf.get(n) ?? null }) };
  };
}

function jaccard(a: Set<number>, b: Set<number>) {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / Math.max(1, a.size + b.size - i);
}
