// Keybinds: the four lane keys and the Overdrive key, set in Settings and kept in this browser.
// Arrow keys and 1-4 always work for the lanes too, unless one of them is bound to something else.

import { getSettings, useSettings } from './settings';

export const DEFAULT_LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const DEFAULT_OVERDRIVE_KEY = 'Space';

/** Keys that already mean something in the game (pause, dev tools, start) and can't be bound. */
export const RESERVED = new Set(['Escape', 'Backquote', 'Enter', 'NumpadEnter', 'Tab', 'MetaLeft', 'MetaRight']);

const NAMED: Record<string, string> = {
  Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Semicolon: ';', Quote: "'", Comma: ',',
  Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  CapsLock: 'Caps', Backspace: 'Bksp',
};

/** A key's name as printed on it, from its `KeyboardEvent.code`. */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export interface KeyBinds { lanes: string[]; overdrive: string }

/** A saved set of binds, or the defaults where it isn't usable (four different lane keys, an Overdrive key apart). */
export function cleanBinds(lanes: unknown, overdrive: unknown): KeyBinds {
  const ok = Array.isArray(lanes) && lanes.length === 4 && lanes.every((k) => typeof k === 'string' && k && !RESERVED.has(k)) && new Set(lanes).size === 4;
  const l = ok ? (lanes as string[]) : DEFAULT_LANE_KEYS;
  const o = typeof overdrive === 'string' && overdrive && !RESERVED.has(overdrive) && !l.includes(overdrive) ? overdrive : DEFAULT_OVERDRIVE_KEY;
  return { lanes: [...l], overdrive: l.includes(o) ? '' : o };
}

export function getBinds(): KeyBinds {
  const s = getSettings();
  return cleanBinds(s.laneKeys, s.overdriveKey);
}

export function useBinds(): KeyBinds {
  const s = useSettings();
  return cleanBinds(s.laneKeys, s.overdriveKey);
}

/** The lane keys with their labels. */
export const laneKeyList = (b: KeyBinds) => b.lanes.map((code) => ({ code, label: keyLabel(code) }));

/**
 * Binds `code` to a slot (a lane 0-3, or 'overdrive'). A key already bound elsewhere swaps places
 * with what the slot had, so no key is ever bound twice. Null when the key can't be bound.
 */
export function rebind(b: KeyBinds, slot: number | 'overdrive', code: string): KeyBinds | null {
  if (!code || RESERVED.has(code)) return null;
  const lanes = [...b.lanes];
  let overdrive = b.overdrive;
  const old = slot === 'overdrive' ? overdrive : lanes[slot];
  const at = lanes.indexOf(code);
  if (at >= 0) lanes[at] = old;
  else if (overdrive === code) overdrive = old;
  if (slot === 'overdrive') overdrive = code; else lanes[slot] = code;
  return { lanes, overdrive };
}
