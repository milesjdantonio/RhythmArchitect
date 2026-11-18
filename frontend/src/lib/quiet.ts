// "Quiet, please": something needs the sound to itself (the Generate dialog plays the found video
// and the AI listens to the whole tab; a YouTube result plays its preview). While anything holds
// it, the menu's song preview and its music stay off, and all of it comes back after. A hold that
// is `still` (the Generate dialog: the listening pass needs the machine) also keeps the backdrop
// and the stage preview still; a preview's hold doesn't (the visuals carry on).

import { useSyncExternalStore } from 'react';
import { holdAmbient } from '../audio/ambient';

/** Who holds it, and whether they want the visuals still too. */
const holds = new Map<string, boolean>();
const listeners = new Set<() => void>();
let quiet = false;
let still = false;

export function holdQuiet(key: string, on: boolean, { still: wantsStill = true }: { still?: boolean } = {}) {
  if (on) holds.set(key, wantsStill); else holds.delete(key);
  holdAmbient(key, on);
  const q = holds.size > 0;
  const s = [...holds.values()].some(Boolean);
  if (q === quiet && s === still) return;
  quiet = q;
  still = s;
  listeners.forEach((l) => l());
}

/** The menu's sound is held (no song preview, no music). */
export const isQuiet = () => quiet;
/** The visuals are held too (the backdrop and the stage preview stay still). */
export const isStill = () => still;

/** Calls `l` whenever quiet (or still) starts or ends; returns the unsubscribe. */
export function onQuiet(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useQuiet(): boolean {
  return useSyncExternalStore(onQuiet, isQuiet);
}

export function useStill(): boolean {
  return useSyncExternalStore(onQuiet, isStill);
}
