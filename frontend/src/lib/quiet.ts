// "Quiet, please": something needs the sound to itself (the Generate dialog plays the found video
// and the AI listens to the whole tab). While anything holds it, the menu's song preview and its
// music stay off, and the backdrop and the stage preview hold still (they're behind the dialog,
// and the listening pass needs the machine), and all of it comes back after.

import { useSyncExternalStore } from 'react';
import { holdAmbient } from '../audio/ambient';

const holds = new Set<string>();
const listeners = new Set<() => void>();
let quiet = false;

export function holdQuiet(key: string, on: boolean) {
  if (on) holds.add(key); else holds.delete(key);
  holdAmbient(key, on);
  const q = holds.size > 0;
  if (q === quiet) return;
  quiet = q;
  listeners.forEach((l) => l());
}

export const isQuiet = () => quiet;

/** Calls `l` whenever quiet starts or ends; returns the unsubscribe. */
export function onQuiet(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useQuiet(): boolean {
  return useSyncExternalStore(onQuiet, isQuiet);
}
