import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_OUT } from '../lib/motion';
import { perf } from '../lib/perf';
import { ORDER, cancelFrame, nextFrame } from '../lib/ticker';

export interface Callout {
  id: number;
  /** combo: a milestone (25, 50, 75...). fever: ×4 starts. */
  kind: 'combo' | 'fever';
  value: number;
}

const SHARDS = [-70, -40, -12, 14, 40, 68, 160, 200];

/** Counts the number up from the last milestone, written straight into the text (no re-renders). */
function CountUp({ from, to }: { from: number; to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || from >= to) { el.textContent = String(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 420);
      el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = nextFrame(step, ORDER.ui);
    };
    raf = nextFrame(step, ORDER.ui);
    return () => cancelFrame(raf);
  }, [from, to]);
  return <span ref={ref}>{from}</span>;
}

/**
 * Combo milestones and fever, called out on the right of the lanes (never over them): the number
 * slams in from the right and counts up from the last milestone, a streak of light cuts across
 * behind it, rings and shards burst from it, and the word tightens in under it. Every hundred is
 * gold and bigger. It drifts up and away after a moment.
 */
export function ComboCallout({ callout, step }: { callout: Callout | null; step: number }) {
  // Perf profile B: the same callout, built once and kept (see LiteCallout).
  const lite = perf().uiFx === 'lite';
  if (lite) return <LiteCallout callout={callout} />;
  return (
    <AnimatePresence>
      {callout && (
        <motion.div key={callout.id} aria-live="polite"
          className={`callout callout-${callout.kind} ${callout.kind === 'fever' || callout.value % 100 === 0 ? 'is-gold' : ''}`}
          initial={{ opacity: 0, x: 80, skewX: -16, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, skewX: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -34, filter: 'blur(8px)', transition: { duration: 0.45, ease: EASE_OUT } }}
          transition={{ type: 'spring', stiffness: 460, damping: 24, mass: 0.9 }}>
          <span className="callout-streak" aria-hidden />
          <span className="callout-burst" aria-hidden>
            <i /><i /><i />
            {SHARDS.map((a) => <b key={a} style={{ '--a': `${a}deg` } as React.CSSProperties} />)}
          </span>
          <span className="callout-num">
            {callout.kind === 'combo' ? <CountUp from={Math.max(0, callout.value - step)} to={callout.value} /> : 'Fever'}
          </span>
          <span className="callout-word">{callout.kind === 'combo' ? (callout.value % 100 === 0 ? 'Combo · streak' : 'Combo') : '×4 multiplier'}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hidden is 0.4% opaque, not 0: invisible, but the browser keeps it painted (a fully transparent
// layer isn't, and painting it at the milestone is what cost the frames).
const HIDDEN = 0.004;
const ENTER: Keyframe[] = [
  { opacity: HIDDEN, transform: 'translateX(80px) skewX(-16deg)' },
  { opacity: 1, transform: 'translateX(-6px) skewX(1deg)', offset: 0.55 },
  { opacity: 1, transform: 'none' },
];
const EXIT: Keyframe[] = [{ opacity: 1, transform: 'none' }, { opacity: HIDDEN, transform: 'translateY(-34px)' }];

/**
 * Perf profile B: the callout above, built once when the game screen opens and kept on the page
 * (hidden), so a milestone only changes its text and restarts its animations. Mounting it fresh
 * made the browser build and paint a dozen new layers with large glows at the moment of the
 * milestone, on the graphics chip the stage draws with, and the stage dropped frames. Only
 * transform and opacity move; the glows are gradients (game.css, .is-lite).
 */
function LiteCallout({ callout }: { callout: Callout | null }) {
  const root = useRef<HTMLDivElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!callout) {
      if (shown.current) { shown.current = false; el.animate(EXIT, { duration: 450, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }); }
      return;
    }
    const gold = callout.kind === 'fever' || callout.value % 100 === 0;
    el.className = `callout callout-${callout.kind} is-lite${gold ? ' is-gold' : ''}`;
    const text = callout.kind === 'combo' ? String(callout.value) : 'Fever';
    num.current!.firstChild!.textContent = text;
    glow.current!.textContent = text;
    word.current!.textContent = callout.kind === 'combo' ? (callout.value % 100 === 0 ? 'Combo · streak' : 'Combo') : '×4 multiplier';
    shown.current = true;
    // Restart the pieces' CSS animations (rings, shards, streak, word, glow) and slam it in.
    for (const a of el.getAnimations({ subtree: true })) { if (a instanceof CSSAnimation) { a.cancel(); a.play(); } }
    el.animate(ENTER, { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' });
  }, [callout]);

  return (
    <div ref={root} className="callout callout-combo is-lite" aria-live="polite" style={{ opacity: HIDDEN }}>
      <span className="callout-streak" aria-hidden />
      <span className="callout-burst" aria-hidden>
        <i /><i /><i />
        {SHARDS.map((a) => <b key={a} style={{ '--a': `${a}deg` } as React.CSSProperties} />)}
      </span>
      <span className="callout-num" ref={num}><span>25</span><span className="callout-num-glow" ref={glow} aria-hidden>25</span></span>
      <span className="callout-word" ref={word}>Combo</span>
    </div>
  );
}
