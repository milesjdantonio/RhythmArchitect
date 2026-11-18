import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { EASE_OUT } from '../lib/motion';
import type { ServerState } from '../lib/server';
import { Icon } from './Icon';

/** Segments in the ring; one lights every RING_STEP seconds of waiting (a clock, not a progress bar). */
const SEGMENTS = 24;
const RING_STEP = 2.5;

/**
 * While the song server wakes up: a reactor powering on. A ring of light fills a segment at a
 * time as the seconds pass (about a minute round, the usual wait), a core pulses inside it, four
 * lanes charge underneath, and the words say what's happening and how long it has been. Honest
 * about it: the ring counts the wait, it doesn't claim to know how far along the server is.
 * Pure CSS motion (transforms and opacity).
 */
export function BootScreen({ state, since, onRetry }: { state: ServerState; since: number; onRetry: () => void }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (state === 'down') return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [state]);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const lit = Math.min(SEGMENTS, Math.floor(secs / RING_STEP) + 1);
  const down = state === 'down';
  const slow = secs >= 90;
  return (
    <motion.div className={`boot ${down ? 'is-down' : ''}`} role="status" aria-live="polite"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.6, ease: EASE_OUT } }}>
      <div className="boot-reactor" aria-hidden>
        <svg viewBox="-60 -60 120 120" className="boot-ring">
          {Array.from({ length: SEGMENTS }, (_, i) => {
            const a0 = (i / SEGMENTS) * Math.PI * 2 - Math.PI / 2 + 0.04;
            const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2 - Math.PI / 2 - 0.04;
            const r = 50;
            return (
              <path key={i} className={i < lit ? 'is-lit' : ''} style={{ '--i': i } as React.CSSProperties}
                d={`M ${Math.cos(a0) * r} ${Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r}`} />
            );
          })}
        </svg>
        <span className="boot-orbit"><i /></span>
        <span className="boot-core" />
        <span className="boot-wave" />
        <span className="boot-wave" style={{ animationDelay: '1.2s' }} />
      </div>
      <div className="boot-lanes" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ '--i': i } as React.CSSProperties}><i /></span>)}
      </div>
      <div className="boot-copy">
        <p className="boot-title">{down ? "The song server isn't answering" : 'Waking the song server'}</p>
        <p className="boot-sub">
          {down
            ? "It may be down for a moment, or your connection dropped. Try again in a bit."
            : slow
              ? 'Taking longer than usual. Hang on, it carries on by itself.'
              : "It sleeps when nobody's playing. Waking takes about a minute; the game opens by itself when it's up."}
        </p>
        <p className="label mono boot-clock">{down ? 'No answer after 3 minutes' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</p>
        {down && <button type="button" className="btn btn-primary" onClick={onRetry} autoFocus><Icon name="retry" /> Try again</button>}
      </div>
    </motion.div>
  );
}
