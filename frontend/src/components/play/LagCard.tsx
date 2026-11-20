import { motion } from 'motion/react';
import { RiveAnim } from '../../rive/RiveAnim';
import { Icon } from '../Icon';
import { EASE_OUT } from '../../lib/motion';
import { STRONG_AHEAD } from '../../game/lag';

/** What the card shows of the connection (game/lag.ts LagWatch, read a few times a second). */
export interface LagView {
  /** Seconds of song loaded ahead, and loading speed (song seconds a second; null: can't tell yet). */
  ahead: number;
  rate: number | null;
  /** The whole song is loaded. */
  complete: boolean;
  /** The browser's estimate (Chrome, Edge), when it gives one. */
  mbps: number | null;
  strong: boolean;
  /** Continue waits for a strong connection (the card came up several times). */
  mustWait: boolean;
  cards: number;
}

/**
 * The song's video keeps lagging: the connection is slow. A weak signal at the top (signal.riv),
 * what was measured, and the choice: carry on (after a 3, 2, 1) or back to the menu. After the card
 * has come up a few times, Continue stays greyed out until the connection is strong.
 */
export function LagCard({ view, onContinue, onMenu }: { view: LagView; onContinue: () => void; onMenu: () => void }) {
  const speed = view.complete ? 'the whole song is loaded'
    : view.rate === null ? 'measuring how fast it loads…'
    : `loading at ${view.rate.toFixed(1)}× the song's speed${view.rate < 1 ? ' (slower than it plays)' : ''}`;
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alertdialog" aria-modal="true" aria-labelledby="lag-title" aria-describedby="lag-body">
      <motion.div className="overlay-card lag-card" initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
        <RiveAnim src="signal" stateMachine="Signal" inputs={{ strong: view.strong }} className="lag-signal" label={view.strong ? 'Connection strong' : 'Connection weak'}
          fallback={<span className={`lag-bars ${view.strong ? 'is-strong' : ''}`} aria-hidden><i /><i /><i /><i /></span>} />
        <h1 id="lag-title">Your connection is slow</h1>
        <p id="lag-body" className="lag-body">The song's video keeps stopping to load. Waiting a little lets more of it load ahead, so it plays through.</p>
        <dl className="lag-stats">
          <div><dt>Loaded ahead</dt><dd className="mono">{view.complete ? 'all of it' : `${Math.floor(view.ahead)} s`}</dd></div>
          <div><dt>Speed</dt><dd>{speed}</dd></div>
          {view.mbps !== null && <div><dt>Connection</dt><dd className="mono">about {view.mbps.toFixed(1)} Mbps</dd></div>}
        </dl>
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={view.mustWait} autoFocus={!view.mustWait}
          aria-describedby={view.mustWait ? 'lag-wait' : undefined}>
          <Icon name="play" /> Continue playing
        </button>
        {view.mustWait && <p id="lag-wait" className="lag-wait muted small" role="status">Continue opens once the connection holds up ({Math.floor(view.ahead)} of {STRONG_AHEAD} s loaded ahead).</p>}
        <button type="button" className="btn" onClick={onMenu} autoFocus={view.mustWait}><Icon name="back" /> Return to main menu</button>
      </motion.div>
    </motion.div>
  );
}
