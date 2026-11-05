// The mock AI mapper. The real backend finds the requested track and maps its audio; this mock
// can't fetch songs, so it reads the request for the title and artist, guesses a mood and tempo
// from its words, and writes a stand-in: a synth melody the app can play, with one chart per
// difficulty laid over it. The Song it returns is marked `source.standIn` so the UI can say so.
// Deterministic for a given (request, seed).
//
// The real backend replaces this entirely: it only has to return a `Song` (src/api/types.ts).

import type { Backing, MapReport, Song, SynthPatch } from '../api/types';
import { buildCharts, type MelodyNote } from './charts';
import { cuesFromSections } from './cues';
import { hashString, rng, type Rng } from './rng';
import { KEYS, SCALES, SCALE_LABEL, degreeToMidi, midiToName, rootIndex } from './theory';

type Mood = 'bright' | 'dark' | 'epic' | 'chill';

const MOOD_WORDS: Record<Mood, string[]> = {
  bright: ['happy', 'sunny', 'joy', 'summer', 'bright', 'upbeat', 'party', 'dance', 'fun', 'pop', 'love', 'candy', 'disco', 'sparkle', 'gold', 'morning', 'beach', 'smile'],
  dark: ['dark', 'night', 'sad', 'rain', 'lonely', 'haunted', 'spooky', 'mystery', 'cyber', 'noir', 'shadow', 'cold', 'ghost', 'midnight', 'neon', 'city', 'tears', 'storm'],
  epic: ['epic', 'battle', 'boss', 'hero', 'space', 'galaxy', 'rise', 'power', 'anthem', 'war', 'dragon', 'quest', 'legend', 'titan', 'orbit', 'launch', 'final', 'chase'],
  chill: ['chill', 'lofi', 'lo-fi', 'calm', 'relax', 'sleep', 'ocean', 'dream', 'soft', 'slow', 'cozy', 'sunset', 'float', 'cloud', 'study', 'lazy', 'gentle', 'waves'],
};
const FAST_WORDS = ['fast', 'hype', 'intense', 'rush', 'race', 'turbo', 'speed', 'hard', 'frantic', 'overdrive', 'energetic', 'banger', 'drop'];
const SLOW_WORDS = ['slow', 'lazy', 'sleepy', 'ballad', 'gentle', 'drift'];

interface MoodSpec {
  label: string;
  scales: string[];
  bpm: [number, number];
  /** Chord roots as scale degrees, one per bar. */
  progressions: number[][];
  drums: string[];
  patches: SynthPatch[];
}

const P = (name: string, oscillator: SynthPatch['oscillator'], o: Partial<SynthPatch> = {}): SynthPatch => ({
  name, oscillator, attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.4, cutoff: 3200, space: 0.3, ...o,
});

const PATCHES = {
  neonLead: P('Neon Lead', 'fatsawtooth', { cutoff: 2800, sustain: 0.5, space: 0.35 }),
  glassBell: P('Glass Bell', 'triangle', { decay: 0.6, sustain: 0.1, release: 1.1, cutoff: 6000, space: 0.5 }),
  chipSquare: P('Chip Square', 'square', { decay: 0.12, sustain: 0.5, release: 0.15, cutoff: 5000, space: 0.15 }),
  acidPluck: P('Acid Pluck', 'sawtooth', { decay: 0.18, sustain: 0.15, release: 0.25, cutoff: 1500, space: 0.25 }),
  dreamPad: P('Dream Keys', 'fattriangle', { attack: 0.01, decay: 0.8, sustain: 0.45, release: 1.4, cutoff: 2400, space: 0.65 }),
  pulseLead: P('Pulse Runner', 'pulse', { decay: 0.2, sustain: 0.45, release: 0.3, cutoff: 3600, space: 0.25 }),
  sineKeys: P('Soft Sine', 'sine', { decay: 0.5, sustain: 0.4, release: 0.9, cutoff: 8000, space: 0.45 }),
} satisfies Record<string, SynthPatch>;

const MOODS: Record<Mood, MoodSpec> = {
  bright: {
    label: 'Bright', scales: ['major', 'mixolydian'], bpm: [112, 132],
    progressions: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 0], [0, 3, 4, 3]],
    drums: ['k.h.s.h.k.h.s.hh', 'k.hhs.h.k.hhs.hk'],
    patches: [PATCHES.neonLead, PATCHES.glassBell, PATCHES.pulseLead],
  },
  dark: {
    label: 'Dark', scales: ['minor', 'minor', 'harmonicMinor'], bpm: [98, 124],
    progressions: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 0, 5, 4]],
    drums: ['k..hs..hk.khs..h', 'k.h.s.hkk.h.s.h.'],
    patches: [PATCHES.acidPluck, PATCHES.neonLead, PATCHES.pulseLead],
  },
  epic: {
    label: 'Epic', scales: ['harmonicMinor', 'dorian', 'minor'], bpm: [126, 148],
    progressions: [[0, 5, 6, 0], [0, 6, 5, 6], [0, 3, 6, 4], [5, 6, 0, 0]],
    drums: ['k.hks.h.k.hks.hh', 'k.k.s.hkk.k.s.hs'],
    patches: [PATCHES.neonLead, PATCHES.pulseLead, PATCHES.chipSquare],
  },
  chill: {
    label: 'Chill', scales: ['dorian', 'major', 'mixolydian'], bpm: [80, 96],
    progressions: [[0, 3, 1, 4], [0, 5, 3, 4], [1, 4, 0, 5], [0, 2, 3, 3]],
    drums: ['k..h..s.k..h..s.', 'k...h.s...kh..s.'],
    patches: [PATCHES.dreamPad, PATCHES.sineKeys, PATCHES.glassBell],
  },
};

// Sound words override the mood's default patch.
const SOUND_WORDS: [string[], SynthPatch][] = [
  [['chip', 'chiptune', '8-bit', '8bit', 'arcade', 'retro', 'pixel', 'gameboy'], PATCHES.chipSquare],
  [['bell', 'glass', 'crystal', 'music box', 'chime', 'ice'], PATCHES.glassBell],
  [['acid', 'bass', 'squelch', '303', 'techno'], PATCHES.acidPluck],
  [['pad', 'dream', 'ambient', 'ethereal', 'float'], PATCHES.dreamPad],
  [['piano', 'keys', 'soft', 'lullaby'], PATCHES.sineKeys],
  [['laser', 'synthwave', 'outrun', 'neon', 'lead'], PATCHES.neonLead],
];


export interface ComposeOptions {
  /** Extra randomness so the same prompt gives a new song each time. */
  seed?: number;
  /** The title and artist as typed (otherwise read out of the prompt). */
  title?: string;
  artist?: string;
}

export type ComposedSong = Omit<Song, 'id' | 'createdAt' | 'best' | 'plays' | 'favorite'>;

const SECTIONS_SHORT = ['Intro', 'Verse', 'Chorus', 'Verse 2', 'Drop', 'Outro'];
const SECTIONS_LONG = ['Intro', 'Verse', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge', 'Drop', 'Outro'];

export function words(prompt: string): string[] {
  return prompt.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
}

export function detectMood(prompt: string): { mood: Mood; tempo: -1 | 0 | 1 } {
  const ws = words(prompt);
  const text = ` ${ws.join(' ')} `;
  const score: Record<Mood, number> = { bright: 0, dark: 0, epic: 0, chill: 0 };
  for (const m of Object.keys(MOOD_WORDS) as Mood[]) {
    for (const w of MOOD_WORDS[m]) if (text.includes(` ${w} `) || text.includes(` ${w}s `)) score[m]++;
  }
  const best = (Object.keys(score) as Mood[]).sort((a, b) => score[b] - score[a])[0];
  const mood: Mood = score[best] > 0 ? best : 'bright';
  const fast = FAST_WORDS.some((w) => ws.includes(w));
  const slow = SLOW_WORDS.some((w) => ws.includes(w));
  return { mood, tempo: fast && !slow ? 1 : slow && !fast ? -1 : 0 };
}

function pickPatch(prompt: string, spec: MoodSpec, r: Rng): SynthPatch {
  const text = ` ${words(prompt).join(' ')} `;
  for (const [ws, patch] of SOUND_WORDS) if (ws.some((w) => text.includes(` ${w} `))) return patch;
  return r.pick(spec.patches);
}

const smallWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'and', 'or', 'to', 'for', 'at', 'by', 'de', 'la', 'le', 'du', 'von', 'van']);
const titleCase = (s: string) => s.split(/\s+/).map((w, i) => (i > 0 && smallWords.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

/** "Mr. Brightside by The Killers", "Sandstorm - Darude", "\"Levitating\" Dua Lipa" → title and artist. */
export function parseRequest(request: string): { title: string; artist: string } {
  const q = request.trim().replace(/\s+/g, ' ');
  const m = /^(.*?)\s+(?:by|from)\s+(.+)$/i.exec(q) ?? /^(.*?)\s*[-–—|]\s*(.+)$/.exec(q);
  let title = m ? m[1] : q;
  let artist = m ? m[2] : '';
  const quoted = /^["“'](.+?)["”']\s*(.*)$/.exec(q);
  if (!m && quoted) { title = quoted[1]; artist = quoted[2]; }
  const fix = (s: string) => {
    const t = s.replace(/^["“'\s]+|["”'\s]+$/g, '').slice(0, 60);
    return t === t.toLowerCase() ? titleCase(t) : t;
  };
  return { title: fix(title) || 'Untitled', artist: fix(artist) || 'Unknown artist' };
}

// One-bar rhythms as [beat offset, length]. Denser ones give Hard more to work with.
const RHYTHMS: [number, number][][] = [
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
  [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
  [[0, 1.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
  [[0, 0.25], [0.25, 0.25], [0.5, 0.5], [1, 1], [2, 0.25], [2.25, 0.25], [2.5, 0.5], [3, 1]],
  [[0, 2], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1], [3.5, 0.5]],
];
const CADENCE: [number, number][] = [[0, 1], [1, 1], [2, 2]];
const FINALE: [number, number][] = [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]];

interface Motif { rhythms: [number, number][][]; steps: number[] }

function makeMotif(r: Rng, energy: number): Motif {
  const pool = energy > 0 ? RHYTHMS : RHYTHMS.filter((x) => x.length <= 6);
  const rhythms = [r.pick(pool), r.pick(pool)];
  const count = rhythms[0].length + rhythms[1].length;
  const steps = Array.from({ length: count }, () => r.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]));
  return { rhythms, steps };
}

/** Writes 2 bars of melody from a motif over the given chord roots. */
function playMotif(m: Motif, startBar: number, chords: number[], r: Rng, opts: { lift?: number; vary?: number; last?: [number, number][] } = {}): MelodyNote[] {
  const out: MelodyNote[] = [];
  let deg = chords[0] + 7 + (opts.lift ?? 0);
  let k = 0;
  for (let b = 0; b < 2; b++) {
    const rhythm = b === 1 && opts.last ? opts.last : m.rhythms[b];
    const root = chords[b];
    const tones = [root, root + 2, root + 4].map((d) => d + 7 + (opts.lift ?? 0));
    for (const [off, len] of rhythm) {
      let step = m.steps[k % m.steps.length];
      if (opts.vary && r.chance(opts.vary)) step += r.pick([-1, 1]);
      deg += step;
      const strong = off === 0 || off === 2;
      if (strong) {
        // Land on the nearest chord tone (any octave) on strong beats.
        let best = deg, dist = 99;
        for (const t of tones) for (const o of [-7, 0, 7]) {
          const d = Math.abs(t + o - deg);
          if (d < dist) { dist = d; best = t + o; }
        }
        deg = best;
      }
      deg = Math.max(3, Math.min(15, deg));
      out.push({ t: (startBar + b) * 4 + off, len, degree: deg, strong });
      k++;
    }
  }
  if (opts.last) {
    // End phrases on the chord root.
    const lastNote = out[out.length - 1];
    lastNote.degree = chords[1] + 7 + (opts.lift ?? 0);
  }
  return out;
}

export function compose(prompt: string, opts: ComposeOptions = {}): ComposedSong {
  const seed = (hashString(prompt.trim().toLowerCase()) ^ (opts.seed ?? 0)) >>> 0;
  const r = rng(seed);
  const { mood, tempo } = detectMood(prompt);
  const spec = MOODS[mood];
  const scaleName = r.pick(spec.scales);
  const scale = SCALES[scaleName];
  const key = r.pick(KEYS);
  let bpm = r.int(spec.bpm[0], spec.bpm[1]);
  if (tempo > 0) bpm = Math.min(168, bpm + 18);
  if (tempo < 0) bpm = Math.max(72, bpm - 14);
  bpm = Math.round(bpm / 2) * 2;
  const energy = tempo + (mood === 'epic' ? 1 : mood === 'chill' ? -1 : 0);

  const progression = r.pick(spec.progressions);
  const chordAt = (bar: number) => progression[bar % progression.length];
  // Base so the melody sits roughly between C4 and C6.
  const root = rootIndex(key);
  const baseMidi = 48 + root + (root > 6 ? -12 : 0);

  const A = makeMotif(r, energy);
  const B = makeMotif(r, energy);
  const C = makeMotif(r, energy + 1);
  const melody: MelodyNote[] = [];
  // Sections of 4 bars: A A' B A C A''. Each motif covers 2 bars, played twice per section.
  const plan: { motif: Motif; lift?: number; vary?: number; cadence?: boolean; finale?: boolean }[] = [
    { motif: A }, { motif: A, vary: 0.2 },
    { motif: A }, { motif: A, cadence: true },
    { motif: B, lift: 2 }, { motif: B, lift: 2, vary: 0.3 },
    { motif: A }, { motif: A, vary: 0.25, cadence: true },
    { motif: C, lift: 1 }, { motif: C, lift: 3, vary: 0.3 },
    { motif: A, vary: 0.1 }, { motif: A, finale: true },
  ];
  // Fast songs get an extra B and C pass so they still run close to a minute.
  if (bpm >= 128) plan.splice(10, 0, { motif: B, lift: 2, vary: 0.35 }, { motif: B, lift: 4, cadence: true }, { motif: C, lift: 2, vary: 0.2 }, { motif: C, lift: 3, vary: 0.3 });
  plan.forEach((p, i) => {
    const bar = i * 2;
    melody.push(...playMotif(p.motif, bar, [chordAt(bar), chordAt(bar + 1)], r, {
      lift: p.lift, vary: p.vary, last: p.finale ? FINALE : p.cadence ? CADENCE : undefined,
    }));
  });
  const bars = plan.length * 2;
  for (const n of melody) n.midi = degreeToMidi(n.degree, scale, baseMidi);
  // Section starts get an accent: Hard turns these into two-lane chords.
  for (const n of melody) n.accent = n.t % 16 === 0;

  const bassBase = 36 + root - (root > 7 ? 12 : 0);
  const backing: Backing = {
    bass: Array.from({ length: progression.length }, (_, i) => midiToName(degreeToMidi(progression[i], scale, bassBase))),
    drums: r.pick(spec.drums),
  };

  const charts = buildCharts(melody, scale, baseMidi, bpm);
  const last = melody[melody.length - 1];
  const hueA = { bright: 320, dark: 265, epic: 12, chill: 190 }[mood] + r.int(-18, 18);
  const hueB = (hueA + r.pick([150, 170, 190, 200])) % 360;

  const parsed = parseRequest(prompt);
  const title = opts.title?.trim().slice(0, 60) || parsed.title;
  const artist = opts.title !== undefined ? opts.artist?.trim().slice(0, 60) || 'Unknown artist' : parsed.artist;
  // Energy: how busy the Hard chart is, bar by bar, smoothed to 48 points.
  const perBar = new Array(bars).fill(0);
  for (const n of charts.hard.notes) perBar[Math.min(bars - 1, Math.floor(n.t / 4))]++;
  const peak = Math.max(1, ...perBar);
  const energyCurve = Array.from({ length: 48 }, (_, i) => Math.round((perBar[Math.floor((i / 48) * bars)] / peak) * 100) / 100);
  // One section per 4-bar phrase of the plan (A A' B A C A'', with two more on fast songs).
  const names = bars / 4 === 8 ? SECTIONS_LONG : SECTIONS_SHORT;
  const sections = Array.from({ length: Math.ceil(bars / 4) }, (_, i) => ({ label: names[Math.min(i, names.length - 1)], beat: i * 16 }));
  const report: MapReport = { mapper: 'Mock mapper (stand-in audio)', confidence: 0.62 + r() * 0.3, sections, energy: energyCurve, cues: cuesFromSections(sections) };

  return {
    title,
    artist,
    prompt: prompt.trim(),
    bpm,
    key,
    scale: SCALE_LABEL[scaleName],
    mood: spec.label,
    lengthBeats: Math.max(bars * 4, last.t + last.len) + 2,
    hues: [(hueA + 360) % 360, hueB],
    source: { kind: 'synth', standIn: true },
    report,
    patch: pickPatch(prompt, spec, r),
    backing,
    charts,
  };
}
