// Every difficulty charted the way a person charts a song (Nov 21, the user: "it just doesn't feel
// right compared to other games that do this"; before: "what notes even are these?", "it
// recognizes the lyrics but doesn't understand how to follow them").
//
// What human osu!mania charters do, and so what this does:
//   - Follow one sound you can hear at a time (the "reference"): the singing wherever it's sung,
//     else the lead instrument's notes (a piano solo is its notes), else the drums. A phrase
//     doesn't hop between a syllable, a kick and a synth stab: that read as random tiles.
//   - Everything on the grid (16ths, or triplets where the song swings them). The notes heard by
//     pitch (the voice, the instruments, the bass) come late of their attacks (Basic Pitch hears a
//     note once its pitch settles: the voice ~12-27 ms, the drums on the grid), so each part's
//     lateness is measured and taken off before snapping (`lateness`).
//   - Long notes are holds, and while one is held the other hand plays the beat under it (the
//     classic 4K layering: "LN + taps on the other hand"). Before, any tile in any lane cut a
//     hold short, so a sung note held three seconds became taps of the piano.
//   - The drums fill in where the reference rests (Ultra, Hard), and a big hit that falls with a
//     reference note makes a chord: chords are emphasis, sized to the hit, not scattered.
//   - Lanes are the tune: low left, high right, the same note in the same lane, up the tune is to
//     the right; drums in fixed places (kick outside, snare inside, the other hand from the tune).
//   - A phrase that comes back is charted the same, lanes and all.
//   - Easier difficulties keep the reference's own rhythm, simplified by where notes fall in the
//     bar (downbeats, beats, 8ths before 16ths), line starts and long notes first; the fill goes
//     first. So Easy is the vocal line, simpler, not a scatter.
//
// It needs the song split (the parts: SoundEvent.part, the syllables and the instruments' notes:
// voice.ts); without them the charts are the trained mapper's, thinned (thin.ts).

import type { Chart, ChartNote, Difficulty, MapReport, SoundEvent } from '../api/types';
import { KEEP } from './thin';
import { barOf, beatAt, divisionAt, secAt, type BeatMap } from './beatmap';
import type { Syllable } from './voice';
import type { DecodedLevels } from './levels';
import { phraseFeatures, reportSections, songForm, type SongForm } from './sections';

type Layer = 'vocals' | 'other' | 'drums' | 'bass';
type Drum = 'kick' | 'snare' | 'hat';

/** A sound on the grid: its beat (the beat map's), its part, how strong, its pitch and length (s). */
interface Sound {
  beat: number;
  sec: number;
  layer: Layer;
  strength: number;
  midi: number | null;
  len: number;
  drum?: Drum;
  accent?: boolean;
  /** A chord struck (voice.ts Syllable.also): its other note. */
  also?: number;
}

/** A tile before lanes: its sound, and what it is in the chart. */
interface Tile {
  s: Sound;
  /** On the phrase's reference (the line followed), or filling in under it. */
  ref: boolean;
  /** Hold to this beat (the beat map's), or none. */
  until?: number;
  /** A second tile with it (emphasis): its sound. */
  chord?: Sound;
  /** Weight for keeping on easier charts. */
  keep: number;
  phrase: number;
  /** A fill tile: beats to the nearest note of the line, and whether it's under one of its holds. */
  gap?: number;
  under?: boolean;
  /** A kick or snare in a phrase the drums drive (the beat under the line), and whether it's only that. */
  beat?: boolean;
  onlyBeat?: boolean;
  /** The first note of a part, on a big hit: a chord on every difficulty. */
  opens?: boolean;
}

/** A part needs this many notes in a phrase to be followed there. */
const FOLLOW_MIN = 3;
/** A section's part (the one most of its phrases follow) is followed in a phrase where it has this many notes. */
const STICKY_MIN = 2;
/** A sung phrase with this few syllables still follows the voice when its neighbours are sung. */
const SUNG_GAP_MIN = 1;
/** Lateness measured within ±this (s), and only from at least LATE_MIN notes. */
const LATE_MAX = 0.045;
const LATE_MIN = 24;
/** A note at least this long (s) and this many beats is a hold. */
const HOLD_SEC = 0.4;
const HOLD_BEATS = 0.75;
/** A hold ends this many beats before the next note of its line at the latest. */
const HOLD_GAP = 0.25;
/** A drum hit this strong (or an accent) is emphasis: a chord where it meets the line (Hard; Ultra from CHORD_MIN). */
const BIG = 0.7;
const CHORD_MIN = 0.45;
/** A phrase this much more intense than the one before (0..1 of the song's range) opens a part. */
const LIFT = 0.3;
/** A drum hit this weak doesn't fill in. */
const FILL_MIN = 0.3;
/** A phrase whose line's rhythm is this alike an earlier one's (16ths in common) is charted like it. */
const ALIKE = 0.75;
/** A phrase of a section's return whose line is this alike its first time's (16ths in common) is charted like it. */
const SECTION_ALIKE = 0.4;
/** A return that's more intense than its first time adds up to this share of notes of its own. */
const GROW = 0.15;
/** Easy's longest run of tiles half a beat apart. */
const EASY_RUN = 5;
/** Where a note falls in the bar, for keeping: the downbeat, a beat, an 8th, a triplet, a 16th. */
const METRIC = { downbeat: 1, beat: 0.8, eighth: 0.5, triplet: 0.35, sixteenth: 0.2 };
/** Kept before the rest: the line's notes, a line's first note after a rest, a hold, a chord's hit. */
const KEEP_REF = 0.6;
const KEEP_START = 0.45;
const KEEP_HOLD = 0.3;
const KEEP_BIG = 0.25;
/** A line's note after this long (s) without one starts a line. */
const LINE_REST = 0.6;

/**
 * What each difficulty plays beyond the line: the second part where the line rests at least `clear`
 * beats either side (and only on points at least `on` in the bar), under the line's holds or not,
 * and chords.
 */
const PROFILE: Record<Difficulty, { clear: number; on: number; chords: 'never' | 'big' | 'always'; under: boolean; beat: number }> = {
  easy: { clear: 2, on: METRIC.beat, chords: 'never', under: false, beat: 0 },
  medium: { clear: 1, on: METRIC.eighth, chords: 'never', under: false, beat: 0 },
  hard: { clear: 0.5, on: METRIC.eighth, chords: 'big', under: true, beat: 0.5 },
  ultra: { clear: 0.5, on: 0, chords: 'always', under: true, beat: 0.25 },
};
/** A phrase whose kick and snare carry at least this much a beat (and above the song's lowest third) is driven by the drums. */
const DRIVE_MIN = 0.3;
/** Ultra's tiles a second at most, in the song's calmest phrase and its most intense. */
const ULTRA_RATE = [3.5, 8];
/**
 * Ultra's part under its lines: none in a section this calm (intensity, sections.ts), all of it
 * from this (its lines are always whole). Against the human charts (r of the density curves):
 * [0.45, 1] 0.44, [0.6, 1.15] 0.43, [0.3, 0.9] 0.35.
 */
const ULTRA_FILL = [0.45, 1];
/** How much each part counts when choosing the second part. */
const SECOND_WEIGHT: Record<Layer, number> = { vocals: 1.4, other: 1.2, drums: 1, bass: 0.6 };
/** The same lane again within this (s) is a quick repeat: avoided unless it's the same note again. */
const JACK: Record<Difficulty, number> = { easy: 0.5, medium: 0.36, hard: 0.24, ultra: 0.16 };
/** The same drum again within this many beats alternates between its hand's two lanes. */
const DRUM_TURN = 1.5;
/** The same note again in its lane no sooner than this (s). */
const SAME_JACK: Record<Difficulty, number> = { easy: 0.45, medium: 0.3, hard: 0.2, ultra: 0.14 };

export interface LeadInput {
  bpm: number;
  offset: number;
  events: SoundEvent[];
  voice: Syllable[];
  /** The instruments' notes (the "other" part), when heard. */
  played?: Syllable[];
  map: BeatMap | null;
  meter?: number;
  /** The song's loudness (levels.ts): how intense each phrase is. */
  levels?: DecodedLevels;
}

/** Whether a song has what a lead line needs: its sounds labelled by part. */
export const hasParts = (events: SoundEvent[]) => events.some((e) => e.part);

/** A charting of every difficulty from the song's lines: `make(d, scale)`, scale trading notes for stars. */
export function leadLine(o: LeadInput): ((d: Difficulty, scale?: number) => Chart) & { form: SongForm; beatOfPhrase: (p: number) => number; sections: () => MapReport['sections'] } {
  const spb = 60 / o.bpm;
  const meter = o.meter ?? 4;
  const map = o.map;
  const beatOf = (sec: number) => (map ? beatAt(map, sec) : (sec - o.offset) / spb);
  const secOf = (beat: number) => (map ? secAt(map, beat) : o.offset + beat * spb);
  const phraseOf = (beat: number) => (map ? Math.floor(barOf(map, beat + 1e-6) / 2) : Math.floor((beat + 1e-6) / (meter * 2)));
  const downbeat = map?.downbeat ?? 0;
  /** The grid's point for a sound at `sec`: its stretch's division (16ths where none holds, triplets only where clearly so). */
  const snap = (sec: number) => {
    const b = beatOf(sec);
    const d = map ? divisionAt(map, b) : 4;
    if (d) return Math.round(b * d) / d;
    const four = Math.round(b * 4) / 4, three = Math.round(b * 3) / 3;
    return Math.abs(secOf(three) - sec) < 0.012 && Math.abs(secOf(four) - sec) > 0.035 ? three : four;
  };
  /** How late a part's notes come of the grid (s): the shift that puts the most of them on its 16ths. */
  const lateness = (secs: number[]) => {
    if (secs.length < LATE_MIN) return 0;
    let best = 0, bestN = -1;
    for (let sh = -LATE_MAX; sh <= LATE_MAX + 1e-9; sh += 0.003) {
      let n = 0;
      for (const s of secs) { const b = beatOf(s - sh); if (Math.abs(secOf(Math.round(b * 4) / 4) - (s - sh)) < 0.015) n++; }
      if (n > bestN + 2 || (n >= bestN - 2 && Math.abs(sh) < Math.abs(best) && n > bestN)) { bestN = n; best = sh; }
    }
    return best;
  };

  // Every part's sounds on the grid, one per part per point (the strongest; the longest length).
  const sounds: Sound[] = [];
  const byKey = new Map<string, Sound>();
  const put = (sec: number, layer: Layer, strength: number, midi: number | null, len: number, extra: Partial<Sound> = {}) => {
    const beat = snap(sec);
    const at = secOf(beat);
    if (at < o.offset - 0.001) return;
    const key = `${layer}:${extra.drum ?? ''}:${beat.toFixed(4)}`;
    const had = byKey.get(key);
    if (had) {
      if (strength > had.strength) { had.strength = strength; had.midi = midi ?? had.midi; if (extra.also != null) had.also = extra.also; }
      had.len = Math.max(had.len, len);
      had.accent ||= !!extra.accent;
      return;
    }
    const s: Sound = { beat, sec: at, layer, strength, midi, len, ...extra };
    byKey.set(key, s);
    sounds.push(s);
  };
  const voiceLate = lateness(o.voice.map((s) => s.sec));
  for (const s of held(o.voice)) put(s.sec - voiceLate, 'vocals', 0.4 + s.strength * 0.6, s.midi, s.len);
  const played = o.played ?? [];
  const playedLate = lateness(played.map((s) => s.sec));
  for (const s of played) put(s.sec - playedLate, 'other', 0.4 + s.strength * 0.6, s.midi, s.len, s.also != null ? { also: s.also } : {});
  const bassEvents = o.events.filter((e) => e.part === 'bass');
  const bassLate = lateness(bassEvents.map((e) => e.sec));
  for (const e of o.events) {
    if (!e.part || e.part === 'vocals' || (e.part === 'other' && played.length)) continue;
    if (e.part === 'drums') {
      const drum: Drum = e.band === 'low' ? 'kick' : e.band === 'high' ? 'hat' : 'snare';
      put(e.sec, 'drums', e.strength + (e.accent ? 0.3 : 0), null, 0, { drum, accent: !!e.accent });
    } else put(e.sec - (e.part === 'bass' ? bassLate : 0), e.part, e.strength + (e.accent ? 0.3 : 0), e.midi, e.len * spb);
  }
  sounds.sort((a, b) => a.beat - b.beat);

  // The phrases (two bars) and the line each follows: the singing where it's sung, else the lead
  // instrument's notes, else the drums, else the bass.
  const phrases = new Map<number, Sound[]>();
  for (const s of sounds) { const p = phraseOf(s.beat); if (!phrases.has(p)) phrases.set(p, []); phrases.get(p)!.push(s); }
  const ids = [...phrases.keys()].sort((a, b) => a - b);
  const count = (p: number, layer: Layer) => (phrases.get(p) ?? []).filter((s) => s.layer === layer && (layer !== 'drums' || s.drum !== 'hat' || s.strength >= 0.5)).length;
  // The phrases the drums drive: kick and snare carrying DRIVE_MIN a beat, above the song's lowest third.
  const drive = new Map<number, number>();
  for (const p of ids) drive.set(p, (phrases.get(p) ?? []).filter((s) => s.layer === 'drums' && s.drum !== 'hat').reduce((a, s) => a + s.strength, 0) / (meter * 2));
  const drives = [...drive.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const driveLow = drives[Math.floor(drives.length * 0.35)] ?? Infinity;
  const intense = new Set(ids.filter((p) => (drive.get(p) ?? 0) >= Math.max(DRIVE_MIN, driveLow)));
  const follows = new Map<number, Layer>();
  for (const p of ids) {
    const v = count(p, 'vocals');
    const sungAround = count(p - 1, 'vocals') >= FOLLOW_MIN && count(p + 1, 'vocals') >= FOLLOW_MIN;
    // Unsung: the instrument's notes where it's calm (a piano intro), the drums where they drive it
    // (an instrumental break: "the main notes on the loudest sound").
    const drumsLead = intense.has(p) && count(p, 'drums') >= count(p, 'other');
    const pick: Layer | null = v >= FOLLOW_MIN || (v >= SUNG_GAP_MIN && sungAround) ? 'vocals'
      : count(p, 'other') >= FOLLOW_MIN && !drumsLead ? 'other'
        : count(p, 'drums') >= FOLLOW_MIN ? 'drums'
          : count(p, 'bass') >= FOLLOW_MIN ? 'bass' : null;
    if (pick) follows.set(p, pick);
  }

  // How intense each phrase is against the rest of the song (0 the calmest, 1 the most): its drums
  // and the strength of every sound in it, a second. Density follows it (the chorus densest, a
  // quiet piano intro with room): before, every note of the intro's piano made it the densest part.
  // By the song's loudness where it's given (the mean over the phrase); else by its drums and sounds.
  const energy = new Map<number, number>();
  for (const p of ids) {
    if (o.levels) {
      const a = secOf(firstBeatOfPhrase(p)), b = secOf(firstBeatOfPhrase(p + 1));
      const L = o.levels, i0 = Math.max(0, Math.floor(a * L.rate)), i1 = Math.min(L.bass.length, Math.ceil(b * L.rate));
      let sum = 0;
      for (let i = i0; i < i1; i++) sum += L.bass[i] + L.mid[i] + L.high[i];
      energy.set(p, i1 > i0 ? sum / (i1 - i0) : 0);
      continue;
    }
    const list = phrases.get(p) ?? [];
    energy.set(p, list.reduce((a, s) => a + s.strength * (s.layer === 'drums' && s.drum !== 'hat' ? 1.5 : 1), 0) + (drive.get(p) ?? 0) * meter * 2);
  }
  // The song's form (sections.ts): where its sections are and how dense each wants to be.
  const lastPhrase = ids.length ? ids[ids.length - 1] : 0;
  const form = songForm(phraseFeatures({
    events: o.events, voice: o.voice, levels: o.levels,
    phrases: lastPhrase + 1, startOf: (p) => secOf(firstBeatOfPhrase(p)), beatsPerPhrase: meter * 2,
    phraseAt: (sec) => { const b = beatOf(sec); const p = phraseOf(b); return { p, at: (b - firstBeatOfPhrase(p)) / (meter * 2) }; },
  }));
  // One part a section: the part most of its phrases follow (a return: the part its first time
  // followed, where it plays enough of the section), wherever it has STICKY_MIN notes; the singing
  // still leads wherever it's clearly sung. Before, the line could hop phrase to phrase (Change:
  // the instrument, the voice, the drums in turn), so a section's return was charted unlike it.
  const sectionLead = new Map<number, Layer>();
  form.sections.forEach((s, i) => {
    const votes = new Map<Layer, number>();
    for (let p = s.from; p < s.to; p++) { const l = follows.get(p); if (l) votes.set(l, (votes.get(l) ?? 0) + 1); }
    let lead = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const first = s.nth > 0 ? form.sections.findIndex((x) => x.group === s.group && x.nth === 0) : -1;
    const was = first >= 0 ? sectionLead.get(first) : undefined;
    if (was && (votes.get(was) ?? 0) * 3 >= s.to - s.from) lead = was;
    if (!lead) return;
    sectionLead.set(i, lead);
    for (let p = s.from; p < s.to; p++) {
      const own = follows.get(p);
      if (!own || own === lead || (own === 'vocals' && count(p, 'vocals') >= FOLLOW_MIN)) continue;
      if (count(p, lead) >= STICKY_MIN) follows.set(p, lead);
    }
  });
  const sectionStarts = new Set(form.sections.slice(1).map((x) => x.from));
  const drops = new Set(form.sections.filter((x) => x.drop).map((x) => x.from));
  const ranked = [...energy.values()].sort((a, b) => a - b);
  const intensity = (p: number) => {
    const v = energy.get(p) ?? 0;
    let lo = 0; while (lo < ranked.length && ranked[lo] < v) lo++;
    return ranked.length > 1 ? lo / (ranked.length - 1) : 0.5;
  };

  // Where a beat falls in the bar.
  const metric = (beat: number) => {
    const f = beat - Math.floor(beat + 1e-6);
    const near = (x: number) => Math.abs(f - x) < 0.02;
    if (near(0)) return ((Math.round(beat) - downbeat) % meter + meter) % meter === 0 ? METRIC.downbeat : METRIC.beat;
    return near(0.5) ? METRIC.eighth : near(1 / 3) || near(2 / 3) ? METRIC.triplet : METRIC.sixteenth;
  };

  // The whole chart (Ultra) as tiles: each phrase's line, its holds, the drums filling in where it
  // rests and under its holds, chords where a big hit meets it.
  const tiles: Tile[] = [];
  const lineOf = new Map<number, Sound[]>();
  for (const p of ids) {
    const layer = follows.get(p);
    if (!layer) continue;
    const all = phrases.get(p)!;
    const line = all.filter((s) => s.layer === layer && (layer !== 'drums' || s.drum !== 'hat' || s.strength >= 0.5));
    lineOf.set(p, line);
    let lastEnd = -Infinity;
    for (let i = 0; i < line.length; i++) {
      const s = line[i];
      // The next note of the line, across phrases.
      const next = line[i + 1]?.beat ?? nextLineBeat(layer, s.beat);
      const t: Tile = { s, ref: true, keep: 0, phrase: p };
      if (s.layer !== 'drums' && s.len >= HOLD_SEC && s.len / spb >= HOLD_BEATS) {
        const end = Math.min(snapEnd(s.sec + s.len), next - HOLD_GAP);
        if (end - s.beat >= 0.5) t.until = end;
      }
      const rested = s.sec - lastEnd >= LINE_REST;
      t.keep = metric(s.beat) + s.strength * 0.5 + KEEP_REF + (rested ? KEEP_START : 0) + (t.until ? KEEP_HOLD : 0);
      lastEnd = secOf(t.until ?? s.beat) + (t.until ? 0 : Math.min(s.len, spb));
      tiles.push(t);
    }
    // A kick or snare with a note of the line: a chord (Ultra any firm one, Hard the big ones, the
    // easier ones only to open a part).
    if (layer !== 'drums') {
      for (const h of all) {
        if (h.layer !== 'drums' || h.strength < CHORD_MIN || h.drum === 'hat') continue;
        const same = tiles.find((t) => t.phrase === p && t.ref && Math.abs(t.s.beat - h.beat) < 0.01);
        if (same && (!same.chord || h.strength > same.chord.strength)) { if (!same.chord && (h.strength >= BIG || h.accent)) same.keep += KEEP_BIG; same.chord = h; }
      }
    }
    // A part opens (the line changes, a section starts, or the song lifts) on a big hit on its
    // downbeat: that tile is the "beginning of a part with a heavy cymbal", a chord on every difficulty.
    const prevLayer = follows.get(p - 1);
    if (prevLayer !== layer || sectionStarts.has(p) || intensity(p) - intensity(p - 1) >= LIFT) {
      const down = firstBeatOfPhrase(p);
      const hit = all.filter((h) => h.layer === 'drums' && Math.abs(h.beat - down) < 0.01 && (h.strength >= BIG || h.accent)).sort((a, b) => b.strength - a.strength)[0];
      const there = tiles.find((t) => t.phrase === p && t.ref && Math.abs(t.s.beat - down) < 0.01);
      if (hit && there) { there.opens = true; there.chord ??= hit; there.keep += KEEP_START; }
      else if (hit) tiles.push({ s: hit, ref: false, keep: METRIC.downbeat + KEEP_REF + KEEP_START, phrase: p, opens: true, gap: Infinity });
    }
    // The second part (the strongest other: the instrument's notes, else the drums, else the bass)
    // where the line rests, and under its holds.
    // In a phrase where the drums drive (Hard, Ultra), the kick and snare too: the beat under the line.
    const two = secondOf(p, layer);
    const backbone = layer !== 'drums' && intense.has(p);
    const lineBeats = line.map((s) => s.beat);
    const ref = tiles.filter((t) => t.phrase === p && t.ref);
    for (const h of all) {
      const asSecond = h.layer === two && !(h.layer === 'drums' && h.drum === 'hat' && h.strength < 0.6);
      const asBeat = backbone && h.layer === 'drums' && h.drum !== 'hat';
      if ((!asSecond && !asBeat) || h.strength < FILL_MIN) continue;
      if (lineBeats.some((b) => Math.abs(b - h.beat) < 0.01) || tiles.some((t) => t.phrase === p && t.s === h)) continue;
      const gap = Math.min(...lineBeats.map((b) => Math.abs(b - h.beat)), Infinity);
      const under = ref.some((t) => t.until != null && h.beat > t.s.beat + 0.49 && h.beat < t.until - 0.24);
      tiles.push({ s: h, ref: false, keep: metric(h.beat) + h.strength * 0.5 + (h.strength >= BIG ? KEEP_BIG : 0), phrase: p, gap, under, ...(asBeat ? { beat: true } : {}), ...(asSecond ? {} : { onlyBeat: true }) });
    }
  }
  tiles.sort((a, b) => a.s.beat - b.s.beat || Number(b.ref) - Number(a.ref));

  // Phrases that come back: the line's rhythm alike an earlier phrase's.
  const slotsOf = (p: number) => {
    const start = firstBeatOfPhrase(p);
    return { start, slots: new Set((lineOf.get(p) ?? []).map((s) => Math.round((s.beat - start) * 12))) };
  };
  const twinOf = new Map<number, number>();
  const seen: { p: number; layer: Layer; slots: Set<number> }[] = [];
  for (const p of ids) {
    const layer = follows.get(p);
    if (!layer) continue;
    const { slots } = slotsOf(p);
    const twin = seen.find((q) => q.layer === layer && jaccard(q.slots, slots) >= ALIKE);
    if (twin) twinOf.set(p, twin.p); else seen.push({ p, layer, slots });
  }
  // A section that comes back (sections.ts: the same music) is charted like its first time, phrase
  // by phrase, wherever its line is somewhat alike (SECTION_ALIKE: it's known to be the same music):
  // human charts keep a repeat's rhythm (41-84% of a chorus's return's tiles where the first had
  // them; ours were 13-64% on Easy) and let its lanes vary (about half the same). It may grow: a
  // return that's more intense adds a few notes of its own (growsOn).
  const growsOn = new Set<number>();
  for (const s of form.sections) {
    if (s.nth === 0) continue;
    const first = form.sections.find((x) => x.group === s.group && x.nth === 0);
    if (!first) continue;
    for (let k = 0; k < Math.min(s.to - s.from, first.to - first.from); k++) {
      const p = s.from + k, q = first.from + k;
      if (!follows.get(p) || follows.get(p) !== follows.get(q)) continue;
      if (jaccard(slotsOf(q).slots, slotsOf(p).slots) < SECTION_ALIKE) continue;
      twinOf.set(p, q);
      if (s.intensity > first.intensity * 1.01) growsOn.add(p);
    }
  }

  /** A phrase's second part: of the others with enough notes, the strongest (weighted by part). */
  function secondOf(p: number, layer: Layer): Layer | null {
    const score = new Map<Layer, number>(), n = new Map<Layer, number>();
    for (const s of phrases.get(p) ?? []) {
      if (s.layer === layer || (s.layer === 'drums' && s.drum === 'hat' && s.strength < 0.6)) continue;
      score.set(s.layer, (score.get(s.layer) ?? 0) + s.strength * SECOND_WEIGHT[s.layer]);
      n.set(s.layer, (n.get(s.layer) ?? 0) + 1);
    }
    const able = [...score].filter(([l]) => (n.get(l) ?? 0) >= 2).sort((a, b) => b[1] - a[1]);
    return able[0]?.[0] ?? null;
  }
  /** The next note of the same part after `after` (a hold runs on into the next phrase until it). */
  function nextLineBeat(layer: Layer, after: number): number {
    const n = sounds.find((s) => s.layer === layer && s.beat > after + 1e-6 && (layer !== 'drums' || s.drum !== 'hat'));
    return n ? n.beat : Infinity;
  }
  function snapEnd(sec: number) {
    const b = beatOf(sec);
    return Math.round(b * 4) / 4;
  }
  function firstBeatOfPhrase(p: number) {
    return map ? downbeat + p * 2 * meter : p * meter * 2;
  }

  const make = (d: Difficulty, scale = 1) => {
    const k = KEEP[d], prof = PROFILE[d];
    const share = d === 'ultra' ? Math.min(1, scale) : Math.min(1, k.share * scale);
    const minGap = k.minGap;
    // Which tiles: per phrase, a share of its tiles by weight (Ultra all), the line before the fill,
    // nothing closer than the difficulty's gap, nothing under a hold where the difficulty has none.
    const kept: Tile[] = [];
    const chosenKeys = new Map<number, Set<string>>();
    const keyOf = (t: Tile, p: number) => `${t.ref ? 'r' : 'f'}:${Math.round((t.s.beat - firstBeatOfPhrase(p)) * 12)}`;
    for (const p of ids) {
      const mine = tiles.filter((t) => t.phrase === p && (t.ref || fillOk(t)));
      // How dense its section wants it (sections.ts: the song's average 1; nothing once it's faded).
      const lean = form.intensity[p] ?? 1;
      if (!mine.length || lean <= 0) continue;
      const span = Math.max(meter * spb, secOf(Math.max(...mine.map((t) => t.s.beat))) - secOf(Math.min(...mine.map((t) => t.s.beat))) + spb);
      // The most a second: Ultra's by how intense the phrase is; the others' rate, leaning with the section.
      const ceiling = d === 'ultra' ? (ULTRA_RATE[0] + (ULTRA_RATE[1] - ULTRA_RATE[0]) * intensity(p)) * scale * span : k.rate * lean * scale * span;
      // Ultra keeps its lines whole; the section says how much of the part under them comes in (a
      // verse the voice, a chorus the beat with it). The others take a share of it all, by the section.
      const lines = mine.filter((t) => t.ref).length;
      const want = d === 'ultra' ? (lines + (mine.length - lines) * Math.min(1, Math.max(0, (lean - ULTRA_FILL[0]) / (ULTRA_FILL[1] - ULTRA_FILL[0])))) * share
        : Math.max(mine.length * share * lean, k.floor * scale * span * lean);
      const budget = Math.max(1, Math.round(Math.min(want, ceiling)));
      const twin = twinOf.get(p);
      const pattern = twin != null ? chosenKeys.get(twin) : undefined;
      const byKeep = [...mine].sort((a, b) => b.keep - a.keep || a.s.beat - b.s.beat);
      // A repeat: its twin's pattern (all of it, the budget aside), and where it grows a few of its own.
      const same = pattern ? byKeep.filter((t) => pattern.has(keyOf(t, p))) : [];
      const extra = pattern && growsOn.has(p) ? Math.min(Math.max(0, budget - same.length), Math.ceil(same.length * GROW)) : 0;
      const order = pattern ? [...same, ...byKeep.filter((t) => !pattern.has(keyOf(t, p)))] : byKeep;
      const cap = pattern ? same.length + extra : budget;
      const chosen: Tile[] = [];
      for (const t of order) {
        if (chosen.length >= cap) break;
        const at = t.s.sec;
        if ([...kept.slice(-8), ...chosen].some((x) => Math.abs(x.s.sec - at) < minGap)) continue;
        if (!prof.under && [...kept.slice(-8), ...chosen].some((x) => x.until != null && at > x.s.sec - 1e-6 && at < secOf(x.until) + minGap)) continue;
        if (!prof.under && t.until != null && [...kept.slice(-8), ...chosen].some((x) => x.s.sec > at && x.s.sec < secOf(t.until!) + minGap)) continue;
        chosen.push(t);
      }
      chosen.sort((a, b) => a.s.beat - b.s.beat);
      chosenKeys.set(p, new Set(chosen.map((t) => keyOf(t, p))));
      kept.push(...chosen);
    }
    // Room before a drop (Easy, Medium): the beat before it clear of all but the line's own notes on
    // the beat (human charts leave it empty at a lift 28% of the time, at any section 12%).
    if (d === 'easy' || d === 'medium') {
      for (const p of drops) {
        const down = firstBeatOfPhrase(p);
        for (let i = kept.length - 1; i >= 0; i--) {
          const t = kept[i];
          if (t.s.beat >= down - 1 - 1e-6 && t.s.beat < down - 1e-6 && !(t.ref && metric(t.s.beat) >= METRIC.beat)) kept.splice(i, 1);
        }
      }
    }
    // Easy: at most EASY_RUN tiles in a row half a beat apart (osu!mania's ranking criteria for an
    // Easy: "max 5 consecutive 1/2 notes"); past that the weaker of the next two goes.
    if (d === 'easy') {
      kept.sort((a, b) => a.s.beat - b.s.beat);
      let run = 1;
      for (let i = 1; i < kept.length; i++) {
        if (kept[i].s.beat - kept[i - 1].s.beat <= 0.5 + 1e-6) run++; else { run = 1; continue; }
        if (run <= EASY_RUN) continue;
        const drop = i + 1 < kept.length && kept[i + 1].s.beat - kept[i].s.beat <= 0.5 + 1e-6 && kept[i + 1].keep < kept[i].keep ? i + 1 : i;
        kept.splice(drop, 1);
        i = Math.max(0, drop - 1);
        run = 1;
        for (let j = i; j > 0 && kept[j].s.beat - kept[j - 1].s.beat <= 0.5 + 1e-6; j--) run++;
      }
    }

    // The tiles: holds where the difficulty allows them, chords where it has them.
    const notes: ChartNote[] = [];
    const info = new Map<ChartNote, { t: Tile; second?: boolean }>();
    const tOf = (beat: number) => Math.round(((secOf(beat) - o.offset) / spb) * 1000) / 1000;
    const minHold = Math.max(0.5, k.minHold[0], k.minHold[1] / spb);
    for (const t of kept) {
      const n: ChartNote = { t: tOf(t.s.beat), lane: 0, pitch: 'C5', len: 0.25 };
      if (t.until != null) {
        const len = tOf(t.until) - n.t;
        if (len >= minHold) { n.hold = true; n.len = Math.round(len * 1000) / 1000; }
      }
      notes.push(n);
      info.set(n, { t });
      // A struck chord's other note only on the line itself, and not under a hold (three fingers).
      // And only for emphasis: on a beat, or struck hard (the intro's piano was a chord every note).
      const struck = t.s.also != null && t.ref && (metric(t.s.beat) >= METRIC.beat || t.s.strength >= 0.85);
      const chordSound = t.chord ?? (struck ? { ...t.s, midi: t.s.also! } : undefined);
      const chordOk = !!t.opens || prof.chords === 'always'
        || (prof.chords === 'big' && ((!!t.chord && (t.chord.strength >= BIG || !!t.chord.accent)) || (struck && t.s.strength >= 0.85)));
      if (chordSound && chordOk) {
        const c: ChartNote = { t: n.t, lane: 0, pitch: 'C5', len: 0.25 };
        notes.push(c);
        info.set(c, { t: { ...t, s: chordSound, ref: false }, second: true });
      }
    }
    // Too many holds for the difficulty: the shortest are taps.
    const holds = notes.filter((n) => n.hold).sort((a, b) => a.len - b.len);
    const room = Math.floor((k.maxHolds ?? 1) * notes.filter((n) => !info.get(n)!.second).length);
    for (const n of holds.slice(0, Math.max(0, holds.length - room))) { delete n.hold; n.len = 0.25; }

    placeLanes(notes, info, d);
    // A phrase charted like an earlier one takes its lanes too.
    const byPhraseSlot = new Map<string, ChartNote[]>();
    for (const n of notes) {
      const { t, second } = info.get(n)!;
      const key = `${t.phrase}|${keyOf(t, t.phrase)}|${second ? 2 : 1}`;
      if (!byPhraseSlot.has(key)) byPhraseSlot.set(key, []);
      byPhraseSlot.get(key)!.push(n);
    }
    for (const n of notes) {
      const { t, second } = info.get(n)!;
      const twin = twinOf.get(t.phrase);
      if (twin == null) continue;
      const from = byPhraseSlot.get(`${twin}|${keyOf(t, t.phrase)}|${second ? 2 : 1}`)?.[0];
      // Only the same sound in the same place: a phrase in the same rhythm on other notes keeps its own tune.
      const was = from && info.get(from)!.t.s;
      if (from && was && was.midi === t.s.midi && was.drum === t.s.drum) n.lane = from.lane;
    }
    fixClashes(notes, d);
    endOnChord(notes);
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    return { difficulty: d, lanes: 4, notes };

    function fillOk(t: Tile) {
      if (t.ref || t.opens) return true;
      if (t.under) return prof.under;
      const gap = t.gap ?? Infinity;
      if (t.beat && prof.beat > 0 && gap >= prof.beat - 1e-6 && metric(t.s.beat) >= METRIC.eighth - 1e-6) return true;
      if (t.onlyBeat) return false;
      return gap >= prof.clear - 1e-6 && metric(t.s.beat) >= prof.on - 1e-6;
    }
  };
  /** The form as the report's sections, in the song's beats. */
  const sections = () => reportSections(form, (p) => (secOf(firstBeatOfPhrase(p)) - o.offset) / spb);
  return Object.assign(make, { form, beatOfPhrase: firstBeatOfPhrase, sections });

  /**
   * Lanes: the line's notes by pitch (each phrase's notes ranked: lowest left, highest right, the
   * same note the same lane; up the tune moves right), the drums in fixed places on the hand the
   * line isn't on (kick outside, snare and hat inside), a chord's second tile on the other hand.
   * A lane held is never taken; a quick repeat of a lane moves next door unless it's the same note.
   */
  function placeLanes(notes: ChartNote[], info: Map<ChartNote, { t: Tile; second?: boolean }>, d: Difficulty) {
    const order = [...notes].sort((a, b) => a.t - b.t || Number(!!info.get(a)!.second) - Number(!!info.get(b)!.second));
    // Each phrase's pitches, for ranking.
    const pitches = new Map<number, number[]>();
    for (const n of order) {
      const { t, second } = info.get(n)!;
      if (second || !t.ref || t.s.midi == null) continue;
      if (!pitches.has(t.phrase)) pitches.set(t.phrase, []);
      pitches.get(t.phrase)!.push(t.s.midi);
    }
    const rankLane = (p: number, midi: number) => {
      const list = [...new Set(pitches.get(p) ?? [])].sort((a, b) => a - b);
      if (list.length <= 1) return null;
      const span = Math.min(3, list.length - 1), base = Math.floor((3 - span) / 2);
      return base + Math.round((list.indexOf(midi) / (list.length - 1)) * span);
    };
    const heldUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
    const lastAt = [-Infinity, -Infinity, -Infinity, -Infinity];
    const lastMidi: (number | null)[] = [null, null, null, null];
    let lineLane = 1, lineMidi: number | null = null, lineT = -Infinity;
    let streakLane = -1, streak = 0;
    const lastDrum = new Map<Drum, { lane: number; t: number }>();
    const jack = JACK[d] / spb;
    for (let i = 0; i < order.length; i++) {
      const n = order[i];
      const { t, second } = info.get(n)!;
      const free = (l: number) => heldUntil[l] <= n.t + 1e-6;
      const ok = (l: number, same: boolean) => free(l) && (same || n.t - lastAt[l] >= jack - 1e-6);
      let want: number;
      if (second) {
        // The chord's partner: the other hand from its first tile, outside for a kick.
        const first = order.slice(0, i).reverse().find((x) => Math.abs(x.t - n.t) < 0.002 && !info.get(x)!.second);
        const from = first?.lane ?? lineLane;
        const hand = from < 2 ? [2, 3] : [0, 1];
        const pref = t.s.drum === 'kick' ? (from < 2 ? 3 : 0) : t.s.midi != null && t.s.midi < (first ? info.get(first)!.t.s.midi ?? 60 : 60) ? Math.min(...hand) : t.s.drum ? (from < 2 ? 2 : 1) : Math.max(...hand);
        want = pick([pref, ...hand, 0, 1, 2, 3].filter((l) => l !== from), (l) => ok(l, false));
      } else if (t.ref && t.s.layer !== 'drums') {
        const ranked = t.s.midi != null ? rankLane(t.phrase, t.s.midi) : null;
        let pref = ranked ?? lineLane;
        // Up the tune is right, down is left, even where the ranks say otherwise.
        if (lineMidi != null && t.s.midi != null && n.t - lineT < 2 && Math.abs(t.s.midi - lineMidi) >= 1) {
          const up = t.s.midi > lineMidi;
          if (up && pref <= lineLane) pref = Math.min(3, lineLane + 1);
          if (!up && pref >= lineLane) pref = Math.max(0, lineLane - 1);
        }
        // The same note again may come back to its lane (a jack: "two sounds that sound exactly the
        // same"), not too quickly, and at most three in a row; past that it trills with the lane beside.
        const gapThere = (n.t - lastAt[pref]) * spb;
        const same = t.s.midi != null && lastMidi[pref] === t.s.midi && gapThere >= SAME_JACK[d] - 1e-6 && !(streakLane === pref && streak >= 2 && gapThere < 0.45);
        const step = lineMidi != null && t.s.midi != null ? Math.sign(t.s.midi - lineMidi) : 0;
        const around = step > 0 ? [pref, pref + 1, pref - 1, pref + 2, pref - 2] : step < 0 ? [pref, pref - 1, pref + 1, pref - 2, pref + 2] : [pref, pref + 1, pref - 1, pref + 2, pref - 2];
        want = pick(around.filter((l) => l >= 0 && l <= 3), (l) => ok(l, same && l === pref));
        lineLane = want; lineMidi = t.s.midi ?? lineMidi; lineT = n.t;
      } else {
        // A drum: the line's own (a drum-led phrase) kick left, snare right, hat between; as fill, the
        // hand the line isn't on, kick outside.
        // The same drum back within DRUM_TURN beats takes its hand's other lane (alternating, not a jack).
        const away = lineLane < 2 ? [3, 2] : [0, 1];
        let pref = t.ref ? (t.s.drum === 'kick' ? [0, 1] : t.s.drum === 'snare' ? [3, 2] : [1, 2]) : t.s.drum === 'kick' ? away : [away[1], away[0]];
        const kind = t.s.drum ?? 'snare';
        const prev = lastDrum.get(kind);
        if (prev && n.t - prev.t <= DRUM_TURN && pref.includes(prev.lane)) pref = [pref.find((l) => l !== prev.lane)!, prev.lane];
        want = pick([...pref, 0, 1, 2, 3], (l) => ok(l, false));
        lastDrum.set(kind, { lane: want, t: n.t });
        if (t.ref) { lineLane = want; lineT = n.t; }
      }
      n.lane = want;
      if (!second) {
        if (want === streakLane && (n.t - lastAt[want]) * spb < 0.45) streak++;
        else { streakLane = want; streak = 0; }
      }
      lastAt[want] = n.t;
      lastMidi[want] = t.s.midi ?? null;
      if (n.hold) heldUntil[want] = n.t + n.len;
    }
    function pick(list: number[], good: (l: number) => boolean) {
      for (const l of list) if (l >= 0 && l <= 3 && good(l)) return l;
      // Every choice is held or quick: the least recently played lane that isn't held.
      const now = lastAt.reduce((a, b) => Math.max(a, b), -Infinity);
      const free = [0, 1, 2, 3].filter((l) => heldUntil[l] <= now + 1e-6);
      return (free.length ? free : [0, 1, 2, 3]).sort((a, b) => lastAt[a] - lastAt[b])[0];
    }
  }
}

/**
 * The last hit a chord, held if it's held: human charts end on one (15 of 26 Creative Commons
 * charts end on a chord, 14 on a hold; ours ended on a single tile). Its partner goes on the other
 * hand, in a lane free then.
 */
function endOnChord(notes: ChartNote[]) {
  if (!notes.length) return;
  const lastT = Math.max(...notes.map((n) => n.t));
  const row = notes.filter((n) => Math.abs(n.t - lastT) < 0.002);
  if (row.length !== 1) return;
  const a = row[0];
  const busy = (l: number) => notes.some((n) => n !== a && n.lane === l && n.t <= lastT + 1e-6 && n.t + (n.hold ? n.len : 0) > lastT - 1e-6);
  const lane = (a.lane < 2 ? [3, 2] : [0, 1]).find((l) => !busy(l));
  if (lane != null) notes.push({ ...a, lane });
}

/** Two tiles in one lane at once, or a tile in a lane while it's held: the later one moves to a free lane (or goes). */
function fixClashes(notes: ChartNote[], d: Difficulty) {
  void d;
  notes.sort((a, b) => a.t - b.t);
  const heldUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
  const out: ChartNote[] = [];
  for (let i = 0; i < notes.length;) {
    let j = i + 1;
    while (j < notes.length && Math.abs(notes[j].t - notes[i].t) < 0.002) j++;
    const row = notes.slice(i, j);
    const used = new Set<number>();
    for (const n of row) {
      let lane = n.lane;
      if (used.has(lane) || heldUntil[lane] > n.t + 1e-6) {
        const alt = [lane + 1, lane - 1, lane + 2, lane - 2, lane + 3, lane - 3].find((l) => l >= 0 && l <= 3 && !used.has(l) && heldUntil[l] <= n.t + 1e-6);
        if (alt == null) continue;
        lane = alt;
      }
      n.lane = lane;
      used.add(lane);
      if (n.hold) heldUntil[lane] = n.t + n.len;
      out.push(n);
    }
    i = j;
  }
  notes.length = 0;
  notes.push(...out);
}

/**
 * A held sung note is one note: the pitch tracker splits a long note where the voice wavers (Open
 * Your Eyes' three-second "aaah" came as four notes end to end, all G3), so a note that carries on
 * a long one (starts as it ends, the same pitch) joins it.
 */
export function held(voice: Syllable[]): Syllable[] {
  const out: Syllable[] = [];
  for (const s of [...voice].sort((a, b) => a.sec - b.sec)) {
    const last = out[out.length - 1];
    if (last && last.len >= HELD_LONG && Math.abs(s.midi - last.midi) <= 1 && s.sec - (last.sec + last.len) <= HELD_JOIN) {
      last.len = Math.max(last.len, s.sec + s.len - last.sec);
      last.strength = Math.max(last.strength, s.strength);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}
const HELD_LONG = 0.6;
const HELD_JOIN = 0.03;

function jaccard(a: Set<number>, b: Set<number>) {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / Math.max(1, a.size + b.size - i);
}
