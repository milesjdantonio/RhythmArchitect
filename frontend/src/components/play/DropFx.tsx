import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { RiveAnim, type RiveHandle } from '../../rive/RiveAnim';
import { bus } from '../../lib/bus';
import { EASE_OUT } from '../../lib/motion';

export interface DropFxHandle {
  /** A drop started (`strength` 0..1; `big`: a real drop, with its badge, not a plain chorus), `spb` seconds a beat. */
  enter(strength: number, big: boolean, spb: number): void;
  /** The drop ended (or the run did). */
  exit(): void;
  /** How much of the drop is left (0..1), a few times a second. */
  left(share: number): void;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The drop across the screen, over the stage and under the HUD, for as long as the song's drop
 * plays (the stage's lasers and warp are its graphics thread's: Stage3D.setDrop). Both edges of the
 * screen glow in the song's colours and light streams up them; every beat they flare. A real drop
 * also gets its badge on the right of the lanes: the Rive "DROP" over an equalizer that ripples
 * the whole time and jumps on each beat, and under it a hairline that runs down as the drop does.
 * Built once and kept: a drop only flips classes and restarts animations (transform and opacity),
 * so nothing is laid out or painted in the middle of the song.
 */
export const DropFx = forwardRef<DropFxHandle>(function DropFx(_props, ref) {
  const [on, setOn] = useState(false);
  const [badge, setBadge] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const edges = useRef<(HTMLDivElement | null)[]>([]);
  const meter = useRef<HTMLSpanElement>(null);
  const rive = useRef<RiveHandle>(null);
  const live = useRef({ on: false, strength: 0, big: false });

  useImperativeHandle(ref, () => ({
    enter(strength, big, spb) {
      live.current = { on: true, strength, big };
      const el = root.current;
      el?.style.setProperty('--drop-k', strength.toFixed(2));
      // The light up the edges climbs a band a beat.
      el?.style.setProperty('--drop-beat', `${Math.max(0.2, Math.min(1.2, spb)).toFixed(3)}s`);
      setOn(true);
      setBadge(big);
      if (meter.current) meter.current.style.transform = 'scaleX(1)';
      if (big) { rive.current?.set('on', true); rive.current?.stayAwake(true); } else rive.current?.set('on', false);
      if (reduced()) return;
      // In: both edges flash and settle to their glow.
      for (const e of edges.current) e?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.35 + 0.35 * strength }], { duration: 900, easing: 'ease-out' });
    },
    exit() {
      if (!live.current.on) return;
      live.current = { on: false, strength: 0, big: false };
      setOn(false);
      setBadge(false);
      rive.current?.set('on', false);
      rive.current?.stayAwake(false);
    },
    left(share) {
      if (meter.current) meter.current.style.transform = `scaleX(${Math.max(0, Math.min(1, share)).toFixed(3)})`;
    },
  }), []);

  // Every beat of the drop: the edges flare and the badge's bars jump.
  useEffect(() => bus.on('beat', ({ downbeat }) => {
    const d = live.current;
    if (!d.on) return;
    if (d.big) rive.current?.fire('beat');
    if (reduced()) return;
    const base = 0.35 + 0.35 * d.strength, peak = Math.min(1, base + (downbeat ? 0.5 : 0.28));
    for (const e of edges.current) e?.animate([{ opacity: peak }, { opacity: base }], { duration: downbeat ? 520 : 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }), []);

  return (
    <div ref={root} className={`dropfx ${on ? 'is-on' : ''}`} aria-hidden>
      <div ref={(e) => { edges.current[0] = e; }} className="dropfx-edge is-left"><i /></div>
      <div ref={(e) => { edges.current[1] = e; }} className="dropfx-edge is-right"><i /></div>
      <motion.div className="dropfx-badge" initial={false}
        animate={badge ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 36, scale: 0.94 }}
        transition={badge ? { duration: 0.45, ease: EASE_OUT } : { duration: 0.6, ease: EASE_OUT, delay: 0.25 }}>
        <RiveAnim ref={rive} src="drop" stateMachine="Drop" className="dropfx-rive" sleepy
          fallback={<span className="dropfx-word">Drop</span>} />
        <span className="dropfx-meter"><span ref={meter} /></span>
      </motion.div>
    </div>
  );
});
