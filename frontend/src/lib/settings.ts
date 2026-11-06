// Player settings live in this browser (localStorage); songs live on the backend.

import { useSyncExternalStore } from 'react';

export interface Settings {
  /** 0..1 */
  volume: number;
  /** 0..1, the drums and bass under the tiles. */
  backing: number;
  /** Running out of health doesn't end the song. */
  noFail: boolean;
  /** The song on stage plays its preview by itself (after the first click or key press). */
  autoPreview: boolean;
  /** The menu plays its own calm music while no song preview is playing (src/audio/ambient.ts). */
  menuMusic: boolean;
  /** Turns off the moving background and heavy glow. Also on when the OS asks for reduced motion. */
  calm: boolean;
  /** The dev tools panel on the game screen is open. */
  devTools: boolean;
}

const KEY = 'rythm-architect:settings';
export const DEFAULTS: Settings = { volume: 0.8, backing: 0.6, noFail: false, calm: false, autoPreview: true, menuMusic: true, devTools: false };

const listeners = new Set<() => void>();
let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // The old hand-set audio offset is gone (the Map Syncer keeps songs in sync): drop any saved one.
    const { offsetMs: _old, ...saved } = JSON.parse(raw) as Settings & { offsetMs?: number };
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings { return current; }

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getSettings);
}

export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isCalm = () => current.calm || prefersReducedMotion();
