import { createContext, useContext } from 'react';
import type { Variants } from 'motion/react';
import { EASE_OUT } from './motion';

/**
 * How the main menu comes in. With the intro, the menu is mounted (hidden) behind it from the
 * start so nothing loads at the moment of the hand-off; on the way in the intro's title flies to
 * the menu's wordmark while the panels build themselves around it.
 *   wait — the intro is up; the menu is laid out but hidden
 *   go   — the hand-off: the title is in flight, the panels are coming in
 *   done — the title has landed (or there was no intro)
 */
export type EntranceStage = 'wait' | 'go' | 'done';

/** The title's flight from the intro to the menu, in ms. The menu's timing is set against it. */
export const FLIGHT_MS = 1900;
/** After the click, the intro's world charges for this long (ms) before it bursts and the menu comes in. */
export const CHARGE_MS = 1000;

export const EntranceContext = createContext<EntranceStage>('done');
export const useEntrance = () => useContext(EntranceContext);


/** Panels on the left: rise into place as they light up (custom = delay in seconds). */
export const enterRise: Variants = {
  hide: { opacity: 0, y: 28, scale: 0.98 },
  show: (d: number = 0) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: d, duration: 1, ease: EASE_OUT, opacity: { delay: d, duration: 0.5, ease: 'easeOut' } },
  }),
};

/** The gameplay side: comes forward out of the depth, as if the camera flew into the menu. */
export const enterDepth: Variants = {
  hide: { opacity: 0, scale: 0.9 },
  show: (d: number = 0) => ({
    opacity: 1, scale: 1,
    transition: { delay: d, duration: 1.25, ease: EASE_OUT, opacity: { delay: d, duration: 0.6, ease: 'easeOut' } },
  }),
};

/**
 * When each part of the menu starts coming in, in seconds. After the intro the clock starts at
 * the key press (the title lands at FLIGHT_MS); otherwise at mount, quicker.
 */
export function entranceTimes(handoff: boolean) {
  return handoff
    ? { play: 0.1, pitch: 0.4, name: 0.48, fav: 0.6, settings: 0.78, settle: 2.7 }
    : { play: 0.04, pitch: 0.1, name: 0.14, fav: 0.22, settings: 0.3, settle: 2.2 };
}
