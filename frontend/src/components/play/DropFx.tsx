import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { bus } from '../../lib/bus';

export interface DropFxHandle {
  /** A drop started (`strength` 0..1). */
  enter(strength: number): void;
  /** The drop ended (or the run did). */
  exit(): void;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The drop at the screen's edges, over the stage and under the HUD, for as long as the song's drop
 * plays (the stage's lasers and walls are its graphics thread's: Stage3D.setDrop). Both edges glow
 * in the song's colours and flare on every beat. Nothing near the lanes: the badge with "DROP" and
 * its equalizer beside the lanes, and the stripes scrolling up the edges the whole drop, were taken
 * out (the user, Nov 22: "remove the word drop on the side"; the notes first). Built once and kept:
 * a drop only flips a class and runs opacity animations, so nothing is laid out or painted mid-song.
 */
export const DropFx = forwardRef<DropFxHandle>(function DropFx(_props, ref) {
  const [on, setOn] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const edges = useRef<(HTMLDivElement | null)[]>([]);
  const live = useRef({ on: false, strength: 0 });

  useImperativeHandle(ref, () => ({
    enter(strength) {
      live.current = { on: true, strength };
      root.current?.style.setProperty('--drop-k', strength.toFixed(2));
      setOn(true);
      if (reduced()) return;
      // In: both edges flash and settle to their glow.
      for (const e of edges.current) e?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.35 + 0.35 * strength }], { duration: 900, easing: 'ease-out' });
    },
    exit() {
      if (!live.current.on) return;
      live.current = { on: false, strength: 0 };
      setOn(false);
    },
  }), []);

  // Every beat of the drop: the edges flare.
  useEffect(() => bus.on('beat', ({ downbeat }) => {
    const d = live.current;
    if (!d.on || reduced()) return;
    const base = 0.35 + 0.35 * d.strength, peak = Math.min(1, base + (downbeat ? 0.5 : 0.28));
    for (const e of edges.current) e?.animate([{ opacity: peak }, { opacity: base }], { duration: downbeat ? 520 : 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }), []);

  return (
    <div ref={root} className={`dropfx ${on ? 'is-on' : ''}`} aria-hidden>
      <div ref={(e) => { edges.current[0] = e; }} className="dropfx-edge is-left" />
      <div ref={(e) => { edges.current[1] = e; }} className="dropfx-edge is-right" />
    </div>
  );
});
