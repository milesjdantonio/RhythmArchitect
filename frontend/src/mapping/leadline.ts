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
import { HOLDS_FREE, SHAPE, STRETCH_FLOOR, spacing } from './shape';

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
  /** A big hit of a part that's neither the line nor the second (a drum fill, a stab): Ultra's, where nothing else is. */
  accent?: boolean;
  /** The first note of a part, on a big hit: a chord on every difficulty. */
  opens?: boolean;
  /** Its chord is the drum hit under it doubled (no other part strikes with it): DOUBLE. */
  doubled?: boolean;
}

/**
 * The other parts' big hits Hard and Ultra take (strength at least this), where the line rests
 * ACCENT_CLEAR beats either side (Nov 21). Without them Ultra was the line and one part under it:
 * 3.3-4.8 tiles a second on the saved listens against 4.6-6.1 on Nov 20, 1.9-2.5 stars against
 * 2.2-3.35 (Hotline Bling's fan Hard: 2.93, 5.6 a second). The fan charts that are well timed chart
 * 74-91% of the mix's strong onsets (soundoff study), more than any other kind of sound. With
 * these: Ultra 4.1 → 4.6 a second on Hotline Bling, its downbeats 65% → 74%, Hard 1.50 → 1.66 stars.
 */
const ACCENT: Record<Difficulty, number> = { easy: Infinity, medium: Infinity, hard: 0.7, ultra: 0.3 };
/** A sung syllable joins as an accent only from this (the vocal stem's onsets are charted by the fan charts at or below chance). */
const ACCENT_SUNG = 0.45;
const ACCENT_CLEAR = 0.25;
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
const CHORD_MIN = 0.3;
/** Hard: two firm hits together are a chord too (both at least this), as before 11ab68c. */
const HARD_CHORD = 0.6;
/**
 * A tile on a kick or snare at least this strong doubles it (a chord of the one hit; Medium only on
 * a beat, Easy never) (Nov 21, round 5). The fan charts of Hotline Bling chord their drum hits, not
 * two parts at once: under their chords two of our parts sound within 30 ms only 8% of the time
 * (singles 5-6%), a kick or snare 45-54% (33-38%). Where our Ultra had a single tile on a kick or
 * snare, a human chorded 28-65% of the time (0.3-0.7), with none under it 16-17%. Ultra 0.3 / Hard
 * 0.5 made 36-66% / 25-52% of moments chords (the fan charts 29-36%).
 */
const DOUBLE: Record<'medium' | 'hard' | 'ultra', number> = { medium: 0.9, hard: 0.7, ultra: 0.5 };
/** A phrase this much more intense than the one before (0..1 of the song's range) opens a part. */
const LIFT = 0.3;
/** A drum hit this weak doesn't fill in. */
const FILL_MIN = 0.3;
/**
 * Ultra's ghost notes: a kick or snare from this strength fills in too (round 7). Of Hotline
 * Bling's kicks and snares at 0.15-0.3 that our Ultra left out, its fan charts put a tile on
 * 51-64% (chance at their density ~33%); bass and instrument onsets that weak 39-50%, the vocal
 * stem's 13-15%: those stay out. Round 11 (the line's glides off the 16ths gone, BARE_NEAR): of the
 * mix's sounds Ultra left out, both fan charts put a tile on bass at 0.15-0.3 79-85%, under 0.15
 * 45-89%, hats at 0.15-0.3 87%, kicks under 0.15 82% (chance for both 7%); the vocal stem's 0-2%.
 * So every drum and the bass from 0.1 (0.15 gave F1 80%, 0.1 82%).
 */
const GHOST_MIN = 0.1;
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
 * and chords: Medium a few (a big hit on a beat, as thin.ts gives the trained mapper's Medium), Hard
 * the big and firm ones, Ultra every one. Hard and Ultra take the second part wherever it plays
 * (`clear` 0, Nov 21 evening: it came in only where the line rested half a beat, and Ultra was
 * 10-25% sparser than the lead line before 11ab68c on the same listens).
 */
const PROFILE: Record<Difficulty, { clear: number; on: number; chords: 'never' | 'few' | 'big' | 'always'; under: boolean; beat: number }> = {
  easy: { clear: 2, on: METRIC.beat, chords: 'never', under: false, beat: 0 },
  medium: { clear: 1, on: METRIC.eighth, chords: 'few', under: false, beat: 0 },
  hard: { clear: 0, on: 0, chords: 'big', under: true, beat: 0.5 },
  ultra: { clear: 0, on: 0, chords: 'always', under: true, beat: 0.25 },
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
/**
 * The least a phrase leans (its section's intensity, sections.ts) wherever the song plays: Easy and
 * Medium LEAN_MIN, Hard and Ultra LEAN_HIGH. The form drove calm stretches to 0.13-0.4 (Open Your
 * Eyes' piano intro 0.30, One Dance's break 0.27, Hotline Bling's outro 0.38), and Easy at a tile a
 * bar there read as a pause in music that plays (the user, Nov 21: "significant pauses for parts
 * that definitely should be played"; a section "slightly lighter is fine"). Human charts move their
 * density far less (CV 0.23-0.30 per 4 bars).
 */
const LEAN_MIN = 0.7;
const LEAN_HIGH = 0.85;
/** A phrase quieter than this share of the song's median phrase is silence: no tiles (a fade's sound stopping, not its volume). */
const SILENT = 0.2;
/**
 * The rhythm you can count with the sound off (Nov 21, the user: "with sound off, I could not find
 * the rhythm or chorus"): the beats of every bar (0 the downbeat) each difficulty keeps a tile on
 * wherever a sound is there (skeletonOf). osu!mania's ranking criteria: an Easy is "mostly 1/1",
 * a Normal "mostly 1/1 and 1/2"; the well-timed fan charts put a tile on 82-92% of the downbeats,
 * ours 31-49% on Easy, 49-80% on Hard. A note pushing up to SKELETON_AHEAD beats ahead of an empty
 * beat stands for it (a syncopated line).
 */
const SKELETON: Record<Difficulty, number[]> = { easy: [0, 2], medium: [0], hard: [0], ultra: [] };
const SKELETON_AHEAD = 0.5;
/**
 * The difficulties that keep every note of the line (the star calibration trims only the part under
 * it), and those that keep every line note on a beat. Nov 21, the user: "it sometimes skips certain
 * notes in what it's trying to match", "the difficulty of Hard dropped a lot": calibrated to its even
 * step, Hard was cut to 0.77-0.85 of its share and the cut fell on the line (it kept 68-81% of it,
 * Hotline Bling 72 holes on 8ths or stronger), Medium 52-59% of it (88% of its beats on One Dance).
 */
const LINE_WHOLE = new Set<Difficulty>(['hard', 'ultra']);
const LINE_BEATS = new Set<Difficulty>(['medium']);
/** The difficulties that chart a section's every return from its first time, rhythm and lanes (returnOf). */
const RETURN_COPY = new Set<Difficulty>(['easy', 'medium']);
/** Easy's breath before a drop (beats); the others play into it. */
const DROP_BREATH = 0.5;
/** How much each part counts when choosing the second part. */
const SECOND_WEIGHT: Record<Layer, number> = { vocals: 1.4, other: 1.2, drums: 1, bass: 0.6 };
/** The same lane again within this (s) is a quick repeat: avoided unless it's the same note again. */
const JACK: Record<Difficulty, number> = { easy: 0.5, medium: 0.36, hard: 0.24, ultra: 0.16 };
/** The same drum again within this many beats alternates between its hand's two lanes. */
const DRUM_TURN = 1.5;
/** A chord's partner and the part under the line take a lane not played this long (s) where they can (patterns.ts JACK). */
const JACK_SOFT = 0.3;
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
  // Each syllable on its attack in the mix where one is just before it (onAttack); the rest by the
  // voice's lateness.
  const voiceLate = lateness(o.voice.map((s) => s.sec));
  const attack = onAttack(o.events, spb);
  // A note heard with no attack in the mix within BARE_NEAR (a syllable gliding on, an instrument's
  // note under the rest) is kept only on a beat or an 8th (bareOff).
  const onsets = o.events.map((e) => e.sec).sort((a, b) => a - b);
  const struckAt = (sec: number) => { let lo = 0, hi = onsets.length; while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < sec - BARE_NEAR) lo = m + 1; else hi = m; } return lo < onsets.length && onsets[lo] <= sec + BARE_NEAR; };
  const bareOff = (sec: number) => { if (struckAt(sec)) return false; const f = ((snap(sec) % 0.5) + 0.5) % 0.5; return Math.min(f, 0.5 - f) > 0.02; };
  for (const s of held(o.voice)) {
    const sec = attack(s.sec) ?? s.sec - voiceLate;
    if (!bareOff(sec)) put(sec, 'vocals', 0.4 + s.strength * 0.6, s.midi, s.len);
  }
  const played = o.played ?? [];
  const playedLate = lateness(played.map((s) => s.sec));
  for (const s of played) if (!bareOff(s.sec - playedLate)) put(s.sec - playedLate, 'other', 0.4 + s.strength * 0.6, s.midi, s.len, s.also != null ? { also: s.also } : {});
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
  // Where the song plays: a phrase at least SILENT of the median phrase's loudness, with sounds, or
  // with a line to follow however quiet it is (a fade is the sound stopping, not the volume: Hotline
  // Bling's 43-s outro is 1-14% of the median's loudness with 15-20 sung notes a phrase, and the
  // fan charts play it to the end; it was left empty on every difficulty).
  const medEnergy = [...energy.values()].sort((a, b) => a - b)[energy.size >> 1] || 0;
  const plays = (p: number) => (phrases.get(p)?.length ?? 0) > 0
    && ((energy.get(p) ?? 0) >= SILENT * medEnergy || (follows.has(p) && count(p, follows.get(p)!) >= FOLLOW_MIN));
  // No part with enough notes to follow, yet the song plays: the strongest part there, so no
  // stretch where the music plays goes empty.
  for (const p of ids) {
    if (follows.has(p) || !plays(p)) continue;
    const sum = new Map<Layer, number>();
    for (const s of phrases.get(p)!) if (s.layer !== 'drums' || s.drum !== 'hat' || s.strength >= 0.5) sum.set(s.layer, (sum.get(s.layer) ?? 0) + s.strength);
    const best = [...sum].sort((a, b) => b[1] - a[1])[0];
    if (best) follows.set(p, best[0]);
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
    // Another part striking with a note of the line: a chord (Ultra any firm one, Hard the big ones,
    // the easier ones only to open a part). A kick or snare first; else the bass, an instrument or
    // the voice under a drum line (Nov 21: 4K layering is two parts at once; with CHORD_MIN 0.3 Ultra
    // chords 3-18% → 10-28% of its moments, the fan charts 29-36%, Ultra +0.1-0.3 stars).
    const weight = (h: Sound) => h.strength + (h.layer === 'drums' ? 1 : 0);
    for (const h of all) {
      if (h.layer === layer || h.strength < CHORD_MIN || h.drum === 'hat') continue;
      const same = tiles.find((t) => t.phrase === p && t.ref && Math.abs(t.s.beat - h.beat) < 0.01);
      if (same && (!same.chord || weight(h) > weight(same.chord))) { if (!same.chord && (h.strength >= BIG || h.accent)) same.keep += KEEP_BIG; same.chord = h; }
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
      const ghost = h.layer === 'drums' || h.layer === 'bass';
      const asAccent = !asSecond && !asBeat && h.layer !== layer && h.strength >= (ghost ? GHOST_MIN : Math.min(...Object.values(ACCENT)));
      if ((!asSecond && !asBeat && !asAccent) || h.strength < (ghost ? GHOST_MIN : FILL_MIN)) continue;
      if (lineBeats.some((b) => Math.abs(b - h.beat) < 0.01) || tiles.some((t) => t.phrase === p && t.s === h)) continue;
      const gap = Math.min(...lineBeats.map((b) => Math.abs(b - h.beat)), Infinity);
      const under = ref.some((t) => t.until != null && h.beat > t.s.beat + 0.49 && h.beat < t.until - 0.24);
      tiles.push({ s: h, ref: false, keep: metric(h.beat) + h.strength * 0.5 + (h.strength >= BIG ? KEEP_BIG : 0), phrase: p, gap, under, ...(asBeat ? { beat: true } : {}), ...(asSecond || asAccent ? {} : { onlyBeat: true }), ...(asAccent ? { accent: true } : {}) });
    }
    // A fill tile another part strikes with (a kick with the bass, a stab with the snare) is a chord
    // too, as a line note is: before, only the line's notes took a partner, so the part under the
    // line never doubled (Hard's chords 2-37% before 11ab68c, 3-16% after it, on the same listens).
    for (const t of tiles) {
      if (t.phrase !== p || t.ref || t.chord) continue;
      const h = all.filter((x) => x !== t.s && x.layer !== t.s.layer && x.layer !== layer && x.drum !== 'hat' && x.strength >= CHORD_MIN && Math.abs(x.beat - t.s.beat) < 0.01)
        .sort((a, b) => weight(b) - weight(a))[0];
      if (h) t.chord = h;
    }
    // A tile on a kick or snare, with no other part to pair it, can double it (`doubled`: Ultra from
    // DOUBLE.ultra, Hard from DOUBLE.hard): the emphasis human charters give a drum hit.
    for (const t of tiles) {
      if (t.phrase !== p || t.chord) continue;
      const hit = all.filter((x) => x.layer === 'drums' && x.drum !== 'hat' && Math.abs(x.beat - t.s.beat) < 0.01).sort((a, b) => b.strength - a.strength)[0];
      if (hit && hit.strength >= Math.min(DOUBLE.medium, DOUBLE.hard, DOUBLE.ultra)) { t.chord = hit; t.doubled = true; }
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
  // Easy and Medium chart every return from its first time, alike or not, lanes and all (RETURN_COPY:
  // "a chorus you can see", Nov 21: with the sound off the user couldn't find the chorus; ours kept
  // 43-58% of a return's rhythm, the fan charts 82-87%). Only its own sounds can be kept, so a return
  // whose music differs keeps the slots it shares.
  const returnOf = new Map<number, number>();
  for (const s of form.sections) {
    if (s.nth === 0) continue;
    const first = form.sections.find((x) => x.group === s.group && x.nth === 0);
    if (!first) continue;
    for (let k = 0; k < Math.min(s.to - s.from, first.to - first.from); k++) {
      const p = s.from + k, q = first.from + k;
      if (follows.get(p) && follows.get(q)) returnOf.set(p, q);
      if (!follows.get(p) || follows.get(p) !== follows.get(q)) continue;
      if (jaccard(slotsOf(q).slots, slotsOf(p).slots) < SECTION_ALIKE) continue;
      twinOf.set(p, q);
      if (s.intensity > first.intensity * 1.01) growsOn.add(p);
    }
  }

  /**
   * A phrase's skeleton for a difficulty: a tile on each of SKELETON's beats of every bar, from the
   * line's note there, else the line's note pushing up to SKELETON_AHEAD ahead of it (it counts as
   * the beat), else the strongest sound on that beat (any part: the line is silent there; the plan
   * agreed Nov 21). A bar with sounds but none of those, its strongest. With the line's note after
   * the beat standing in too, Easy's downbeats were 46-71% (66-92% this way; humans 82-92%).
   * Only real sounds: a bar with none stays empty.
   */
  function skeletonOf(p: number, d: Difficulty, mine: Tile[]): Tile[] {
    const beats = SKELETON[d];
    if (!beats.length) return [];
    const layer = follows.get(p);
    const all = phrases.get(p) ?? [];
    const out: Tile[] = [];
    for (let bar = 0; bar < 2; bar++) {
      const had = out.length;
      for (const k of beats) {
        if (k >= meter) continue;
        const b = firstBeatOfPhrase(p) + bar * meter + k;
        const at = (t: Tile) => Math.abs(t.s.beat - b) < 0.01;
        // The line's note on the beat, or pushing ahead of it (a syncopated line keeps its own
        // rhythm); else anything on the beat.
        let t = mine.find((x) => at(x) && x.ref)
          ?? mine.filter((x) => x.ref && x.s.beat < b - 0.01 && x.s.beat >= b - SKELETON_AHEAD - 1e-6).sort((x, y) => y.s.beat - x.s.beat)[0]
          ?? mine.find(at);
        if (!t) {
          const s = all.filter((x) => Math.abs(x.beat - b) < 0.01 && x.strength >= FILL_MIN && (x.layer !== 'drums' || x.drum !== 'hat' || x.strength >= 0.5))
            .sort((x, y) => Number(y.layer === layer) - Number(x.layer === layer) || y.strength - x.strength)[0];
          if (s) t = { s, ref: s.layer === layer, keep: METRIC.downbeat + s.strength * 0.5, phrase: p, gap: 0 };
        }
        if (t && !out.includes(t)) out.push(t);
      }
      // A bar with sounds but none on its beats (a chord ringing, a syncopated riff): its strongest.
      if (out.length === had) {
        const from = firstBeatOfPhrase(p) + bar * meter, inBar = (x: number) => x >= from - 1e-6 && x < from + meter - 1e-6;
        const t = [...mine].filter((x) => inBar(x.s.beat)).sort((x, y) => Number(y.ref) - Number(x.ref) || y.keep - x.keep)[0];
        const s = t ? null : all.filter((x) => inBar(x.beat) && x.strength >= FILL_MIN && (x.layer !== 'drums' || x.drum !== 'hat' || x.strength >= 0.5)).sort((x, y) => y.strength - x.strength)[0];
        if (t) out.push(t);
        else if (s) out.push({ s, ref: s.layer === layer, keep: metric(s.beat) + s.strength * 0.5, phrase: p, gap: 0 });
      }
    }
    return out;
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
    const copyAll = RETURN_COPY.has(d);
    const twinFor = (p: number) => (copyAll ? returnOf.get(p) ?? twinOf.get(p) : twinOf.get(p));
    const share = d === 'ultra' ? Math.min(1, scale) : Math.min(1, k.share * scale);
    const minGap = k.minGap;
    // Which tiles: per phrase, a share of its tiles by weight (Ultra all), the line before the fill,
    // nothing closer than the difficulty's gap, nothing under a hold where the difficulty has none.
    const kept: Tile[] = [];
    const chosenKeys = new Map<number, Set<string>>();
    const keyOf = (t: Tile, p: number) => `${t.ref ? 'r' : 'f'}:${Math.round((t.s.beat - firstBeatOfPhrase(p)) * 12)}`;
    for (const p of ids) {
      const mine = tiles.filter((t) => t.phrase === p && (t.ref || fillOk(t)));
      // How dense its section wants it (sections.ts: the song's average 1), never under LEAN_MIN
      // (Hard and Ultra LEAN_HIGH) while the song plays; nothing once it's silent.
      if (!mine.length || !plays(p)) continue;
      const lean = Math.max(d === 'hard' || d === 'ultra' ? LEAN_HIGH : LEAN_MIN, form.intensity[p] ?? 1);
      const span = Math.max(meter * spb, secOf(Math.max(...mine.map((t) => t.s.beat))) - secOf(Math.min(...mine.map((t) => t.s.beat))) + spb);
      // The most a second: Ultra's by how intense the phrase is; the others' rate, leaning with the section.
      const ceiling = d === 'ultra' ? (ULTRA_RATE[0] + (ULTRA_RATE[1] - ULTRA_RATE[0]) * intensity(p)) * scale * span : k.rate * lean * scale * span;
      // Ultra keeps its lines whole; the section says how much of the part under them comes in (a
      // verse the voice, a chorus the beat with it). The others take a share of it all, by the section.
      const lines = mine.filter((t) => t.ref).length;
      const want = d === 'ultra' ? (lines + (mine.length - lines) * Math.min(1, Math.max(0, (lean - ULTRA_FILL[0]) / (ULTRA_FILL[1] - ULTRA_FILL[0])))) * share
        : Math.max(mine.length * share * lean, k.floor * scale * span * lean);
      // Never under STRETCH_FLOOR tiles a second where the section plays (shape.ts): a calm verse
      // leaning low and the star calibration together could thin it to a tile every bar or two.
      // Ultra's lines are whole: the ceiling and the section hold back only the part under them.
      const budget = Math.max(1, d === 'ultra' ? Math.round(lines * share) : Math.round(STRETCH_FLOOR[d] * span), Math.round(Math.min(want, ceiling)));
      // An intense section lets the easier charts' tiles come closer (shape.ts spacing, the lean
      // taken at most SHAPE.hi; the user, Nov 21: "Easy can be made harder"), and Medium play taps
      // under a hold there (HOLDS_FREE), as Hard always does: else their spacing and holds, not
      // their budget, held a chorus back.
      const gap = d === 'ultra' ? minGap : minGap * spacing(Math.min(SHAPE.hi, lean));
      const under = prof.under || (d === 'medium' && lean >= HOLDS_FREE);
      const twin = twinFor(p);
      const pattern = twin != null ? chosenKeys.get(twin) : undefined;
      const byKeep = [...mine].sort((a, b) => b.keep - a.keep || a.s.beat - b.s.beat);
      // A repeat: its twin's pattern (all of it, the budget aside), and where it grows a few of its own.
      const same = pattern ? byKeep.filter((t) => pattern.has(keyOf(t, p))) : [];
      const extra = pattern && growsOn.has(p) ? Math.min(Math.max(0, budget - same.length), Math.ceil(same.length * GROW)) : 0;
      // The beats every bar keeps (skeletonOf) go first: the rhythm you can count with the sound off.
      const skel = skeletonOf(p, d, mine);
      const inSkel = new Set(skel);
      const rest = pattern ? [...same, ...byKeep.filter((t) => !pattern.has(keyOf(t, p)))] : byKeep;
      const ordered = [...skel, ...rest.filter((t) => !inSkel.has(t))];
      // Hard and Ultra (LINE_WHOLE): the bar's skeleton, then every note of the line before any of
      // the part under it, and a repeat keeps its own line whole too (it was held to its twin's
      // pattern: 23 of Hotline Bling's line notes lost). Medium (LINE_BEATS): every line note on a
      // beat, after a return's own slots. The star calibration then trims only what's left.
      const whole = LINE_WHOLE.has(d);
      const onBeat = (t: Tile) => LINE_BEATS.has(d) && t.ref && metric(t.s.beat) >= METRIC.beat - 1e-6;
      const inPattern = (t: Tile) => inSkel.has(t) || (!!pattern && pattern.has(keyOf(t, p)));
      const order = whole ? [...skel, ...ordered.filter((t) => t.ref && !inSkel.has(t)), ...ordered.filter((t) => !t.ref && !inSkel.has(t))]
        : LINE_BEATS.has(d) ? [...ordered.filter(inPattern), ...ordered.filter((t) => !inPattern(t) && onBeat(t)), ...ordered.filter((t) => !inPattern(t) && !onBeat(t))]
        : ordered;
      const beats = mine.filter(onBeat);
      const cap = pattern && !whole ? new Set([...same, ...skel, ...beats]).size + extra
        : Math.max(budget, skel.length, beats.length, whole ? lines + skel.filter((t) => !t.ref).length : 0);
      const chosen: Tile[] = [];
      for (const t of order) {
        if (chosen.length >= cap) break;
        const at = t.s.sec;
        if ([...kept.slice(-8), ...chosen].some((x) => Math.abs(x.s.sec - at) < gap)) continue;
        if (!under && [...kept.slice(-8), ...chosen].some((x) => x.until != null && at > x.s.sec - 1e-6 && at < secOf(x.until) + minGap)) continue;
        if (!under && t.until != null && [...kept.slice(-8), ...chosen].some((x) => x.s.sec > at && x.s.sec < secOf(t.until!) + minGap)) continue;
        chosen.push(t);
      }
      chosen.sort((a, b) => a.s.beat - b.s.beat);
      chosenKeys.set(p, new Set(chosen.map((t) => keyOf(t, p))));
      kept.push(...chosen);
    }
    // Room before a drop (Easy): the half beat before it clear of all but the line's own notes on
    // the beat (human charts leave it empty at a lift 28% of the time, at any section 12%). It was
    // the whole beat on Easy and Medium: with the form's calm sections that read as a pause.
    if (d === 'easy') {
      for (const p of drops) {
        const down = firstBeatOfPhrase(p), from = down - DROP_BREATH;
        for (let i = kept.length - 1; i >= 0; i--) {
          const t = kept[i];
          if (t.s.beat >= from - 1e-6 && t.s.beat < down - 1e-6 && !(t.ref && metric(t.s.beat) >= METRIC.beat)) kept.splice(i, 1);
          // A hold ringing on into that beat ends where it starts (a tap if that leaves under half a beat).
          else if (t.until != null && t.s.beat < from - 1e-6 && t.until > from + 1e-6) {
            if (from - t.s.beat >= 0.5) kept[i] = { ...t, until: from };
            else { const { until: _u, ...rest } = t; kept[i] = rest; }
          }
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
      const chordOk = t.doubled && !t.opens ? d !== 'easy' && t.chord!.strength >= DOUBLE[d] - 1e-9 && (d !== 'medium' || metric(t.s.beat) >= METRIC.beat)
        : !!t.opens || prof.chords === 'always'
        || (prof.chords === 'big' && ((!!t.chord && (t.chord.strength >= BIG || !!t.chord.accent || Math.min(t.chord.strength, t.s.strength) >= HARD_CHORD)) || (struck && t.s.strength >= 0.85)))
        || (prof.chords === 'few' && !!t.chord && (t.chord.strength >= BIG || !!t.chord.accent) && metric(t.s.beat) >= METRIC.beat);
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
      const twin = twinFor(t.phrase);
      if (twin == null) continue;
      const from = byPhraseSlot.get(`${twin}|${keyOf(t, t.phrase)}|${second ? 2 : 1}`)?.[0];
      // Only the same sound in the same place: a phrase in the same rhythm on other notes keeps its
      // own tune; but on Easy and Medium a section's return takes its first time's lanes whatever
      // the notes (RETURN_COPY), so it looks the same.
      const was = from && info.get(from)!.t.s;
      if (from && was && ((copyAll && returnOf.get(t.phrase) === twin) || (was.midi === t.s.midi && was.drum === t.s.drum))) n.lane = from.lane;
    }
    fixClashes(notes, d);
    endOnChord(notes);
    notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
    return { difficulty: d, lanes: 4, notes };

    function fillOk(t: Tile) {
      if (t.ref || t.opens) return true;
      // A ghost note (a kick or snare under FILL_MIN) only on Ultra.
      if (t.s.strength < FILL_MIN && d !== 'ultra') return false;
      if (t.accent) return t.s.strength >= (t.s.layer === 'vocals' ? Math.max(ACCENT[d], ACCENT_SUNG) : t.s.strength < FILL_MIN ? GHOST_MIN : ACCENT[d]) && (t.under ? prof.under : (t.gap ?? Infinity) >= ACCENT_CLEAR - 1e-6);
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
   * line isn't on (kick outside, snare and hat inside), a chord's second tile on the lane played least lately.
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
      // A chord's partner and the part under the line: a lane not played in the last JACK_SOFT
      // seconds where there is one (the line's notes go by the tune instead).
      const rested = (l: number) => ok(l, false) && (n.t - lastAt[l]) * spb >= JACK_SOFT - 1e-6;
      const soft = (list: number[]) => list.find((l) => l >= 0 && l <= 3 && rested(l)) ?? pick(list, (l) => ok(l, false));
      let want: number;
      if (second) {
        // The chord's partner: the lane played least lately, either hand (round 6). A fixed lane on
        // the other hand, outside for a kick, put a doubled kick on every beat in the one lane
        // (Hotline Bling's Ultra jacks 17% → 27%, the fan charts 13-19%; this way 18%), and chords
        // only ever split across the hands kept the chart centred (lane moves 0.89-0.95 a step, the
        // fan charts 1.15-1.47; this way 0.98-1.11): human 4K charts jump on one hand too.
        const first = order.slice(0, i).reverse().find((x) => Math.abs(x.t - n.t) < 0.002 && !info.get(x)!.second);
        const from = first?.lane ?? lineLane;
        const hand = [0, 1, 2, 3].filter((l) => l !== from).sort((a, b) => lastAt[a] - lastAt[b]);
        want = soft([...hand, 0, 1, 2, 3].filter((l) => l !== from));
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
        want = t.ref ? pick([...pref, 0, 1, 2, 3], (l) => ok(l, false)) : soft([...pref, 0, 1, 2, 3]);
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
/**
 * Where a sung syllable starts: the mix's onset (the vocals' own first) at most ATTACK_BEFORE
 * before it (and under 0.85 of a 16th, so not the 16th before) or ATTACK_AFTER after it, nearest;
 * null where there's none. The pitch tracker hears a syllable once its pitch settles, 20-80 ms
 * after its attack and not by one fixed amount (Nov 21: against the well-timed fan charts of
 * Hotline Bling and California Gurls, the syllables were charted 17-37% of the time, at or below
 * chance; moved onto their attacks 38-62%, 1.5-2.2 times chance). The voice's one lateness
 * (`lateness`, at most 45 ms) couldn't follow it syllable by syllable.
 */
export function onAttack(events: Pick<SoundEvent, 'sec' | 'part'>[], spb: number): (sec: number) => number | null {
  const voc = events.filter((e) => e.part === 'vocals').map((e) => e.sec).sort((a, b) => a - b);
  const all = events.map((e) => e.sec).sort((a, b) => a - b);
  const before = Math.min(ATTACK_BEFORE, (spb / 4) * 0.85);
  const nearest = (list: number[], sec: number) => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < sec - before) lo = m + 1; else hi = m; }
    let best: number | null = null;
    for (let i = lo; i < list.length && list[i] <= sec + ATTACK_AFTER; i++) if (best == null || Math.abs(list[i] - sec) < Math.abs(best - sec)) best = list[i];
    return best;
  };
  return (sec) => nearest(voc, sec) ?? nearest(all, sec);
}
const ATTACK_BEFORE = 0.12;
const ATTACK_AFTER = 0.03;
/**
 * A sung or played note with no sound found in the mix within this (s) of where it goes, on a 16th or
 * a triplet, isn't charted (on a beat or an 8th it is). Nov 21, against Hotline Bling's two timed fan
 * charts: Ultra had 252 such tiles; both humans charted 18 of them (7%), neither one within 80 ms 142
 * (56%): of the tiles they have nothing near, 77% were these (Basic Pitch hears a syllable gliding on
 * where the mix has no new attack). Their sung tiles on beats and 8ths they chart.
 */
const BARE_NEAR = 0.03;

const HELD_LONG = 0.6;
const HELD_JOIN = 0.03;

function jaccard(a: Set<number>, b: Set<number>) {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / Math.max(1, a.size + b.size - i);
}
