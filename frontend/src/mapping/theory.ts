// Small music-theory helpers: note names, scales and MIDI numbers.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export const SCALE_LABEL: Record<string, string> = {
  major: 'Major',
  minor: 'Minor',
  dorian: 'Dorian',
  harmonicMinor: 'Harmonic minor',
  mixolydian: 'Mixolydian',
};

export function midiToName(midi: number): string {
  const n = Math.round(midi);
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function nameToMidi(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note name ${name}`);
  return NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
}

export function rootIndex(key: string): number {
  const i = NAMES.indexOf(key);
  if (i < 0) throw new Error(`Bad key ${key}`);
  return i;
}

/** MIDI note for a scale degree (0 = tonic, may be negative or beyond 7) above `baseMidi`. */
export function degreeToMidi(degree: number, scale: number[], baseMidi: number): number {
  const len = scale.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return baseMidi + octave * 12 + scale[idx];
}

export const KEYS = NAMES;
