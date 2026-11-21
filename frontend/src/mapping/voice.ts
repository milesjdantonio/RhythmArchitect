// The singing, so the charts can go with the lyrics. The trained mapper doesn't follow the voice
// (on One Dance 35% of our tiles were on a sung syllable, about chance, and Ultra had a tile on 40%
// of the syllables), and the onset mapper hears few of them: a syllable glides in without a sharp
// attack (of the syllables Ultra missed, 27% were on a sound it measured). So after the listen the
// vocal is split from the song (stems.ts, Demucs) and its notes heard (notes.ts, Basic Pitch): each
// note's start is a syllable. ensomi.ts adds a tile on each that has none and thinning favours them.
//
// Basic Pitch hears other instruments' bleed in the split vocal too, so a syllable counts only
// where the vocal carries a real share of the song's sound there (VOICE_SHARE of the mix's level):
// an instrumental's vocal stem is near-silent and gives none.

import type { HeardNote } from './notes';

/** A sung syllable: where it starts (seconds into the audio), how long its note lasts, its pitch, how clearly it's sung (0..1). */
export interface Syllable {
  sec: number;
  len: number;
  midi: number;
  strength: number;
  /** Struck as a chord: another of its notes (CHORD_APART or more from `midi`: the lowest, or the highest when `midi` is the lowest). */
  also?: number;
}

/** Notes merged into one this many semitones or more apart are a chord (a piano's two hands), not bleed or a slide. */
export const CHORD_APART = 3;

/** Notes starting closer than this to the last syllable's start are part of it (a chord of bleed, a slide). */
export const MERGE = 0.08;
/** The vocal's level must be at least this share of the mix's (RMS, around the start) for a syllable. */
export const VOICE_SHARE = 0.3;
/** Notes fainter than this (Basic Pitch's mean activation) aren't sung syllables. */
export const MIN_AMP = 0.35;

const WINDOW = 0.06;

function rms(x: Float32Array, sr: number, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * sr)), b = Math.min(x.length, Math.ceil(to * sr));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}

/**
 * The syllables in the notes heard in the vocal: their starts, merged within MERGE (the longest
 * note's pitch and length kept), faint notes dropped, and with the stems at hand only where the
 * vocal is a real share of the song's sound.
 */
export function syllables(notes: HeardNote[], audio?: { vocal: Float32Array; mix: Float32Array; sr: number }): Syllable[] {
  const out: Syllable[] = [];
  for (const n of [...notes].sort((a, b) => a.sec - b.sec)) {
    if (n.amp < MIN_AMP) continue;
    const last = out[out.length - 1];
    if (last && n.sec - last.sec < MERGE) {
      const heard = [last.midi, n.midi, ...(last.also != null ? [last.also] : [])];
      if (n.len > last.len) { last.len = n.len; last.midi = n.midi; }
      last.strength = Math.max(last.strength, n.amp);
      // Two notes far enough apart: a chord, another of its notes kept beside the longest.
      const lowest = Math.min(...heard), highest = Math.max(...heard);
      const other = Math.abs(last.midi - lowest) >= CHORD_APART ? lowest : highest;
      if (Math.abs(last.midi - other) >= CHORD_APART) last.also = other;
      continue;
    }
    if (audio) {
      const v = rms(audio.vocal, audio.sr, n.sec, n.sec + WINDOW), m = rms(audio.mix, audio.sr, n.sec, n.sec + WINDOW);
      if (m <= 0 || v < VOICE_SHARE * m) continue;
    }
    out.push({ sec: n.sec, len: n.len, midi: n.midi, strength: n.amp });
  }
  return out;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** A MIDI pitch's note name (60: C4). */
export const noteName = (midi: number) => `${NAMES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;

/** Whether a sorted list of syllables has one starting within `lim` seconds of `sec`. */
export function syllableAt(sorted: Syllable[], sec: number, lim: number): Syllable | undefined {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].sec < sec) lo = m + 1; else hi = m; }
  return [sorted[lo - 1], sorted[lo]].filter((s) => s && Math.abs(s.sec - sec) <= lim).sort((a, b) => Math.abs(a.sec - sec) - Math.abs(b.sec - sec))[0];
}
