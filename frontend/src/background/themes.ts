// The backdrop's colours, chosen in Settings: Dynamic follows the song on stage (its hues, a new
// palette each section, Overdrive's colours), the others hold one pair of hues everywhere.

export interface BackdropTheme {
  id: string;
  name: string;
  /** The two hues it holds, or null to follow the song. */
  hues: [number, number] | null;
}

export const BACKDROP_THEMES: BackdropTheme[] = [
  { id: 'dynamic', name: 'Dynamic', hues: null },
  { id: 'nebula', name: 'Nebula', hues: [262, 300] },
  { id: 'ocean', name: 'Ocean', hues: [192, 222] },
  { id: 'aurora', name: 'Aurora', hues: [148, 186] },
  { id: 'rose', name: 'Rose', hues: [326, 352] },
  { id: 'ember', name: 'Ember', hues: [10, 36] },
  { id: 'gold', name: 'Gold', hues: [38, 52] },
];

/** The hues a theme holds (null: Dynamic, or an unknown id). */
export const themeHues = (id: string): [number, number] | null => BACKDROP_THEMES.find((t) => t.id === id)?.hues ?? null;
