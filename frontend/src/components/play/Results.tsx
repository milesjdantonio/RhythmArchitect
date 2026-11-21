import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Grade, PlayState, Song } from '../../api/types';
import type { Judgement } from '../../game/engine';
import { starsFor } from '../../game/engine';
import { RiveAnim } from '../../rive/RiveAnim';
import { href } from '../../lib/router';
import { Icon } from '../Icon';
import { VideoSlot } from '../VideoSlot';
import { FeelAsk } from './FeelAsk';
import { fmtTime } from '../../lib/format';
import { createStore, useStore, type ReadStore } from '../../lib/store';

const NO_MODEL = createStore<{ state: PlayState | null } | null>(null);
import { EASE_OUT } from '../../lib/motion';
import { OVERDRIVE_LOOKS, OVERDRIVE_ROMAN, overdriveVars } from '../../game/overdrive';

export interface RunResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Record<Judgement, number>;
  grade: Grade;
  failed: boolean;
  total: number;
  /** Mean timing error in ms (negative = early). */
  meanOffsetMs: number | null;
  /** The autoplay bot played some or all of the run: the score isn't saved. */
  assisted?: boolean;
  /** A failed run: how far into the song it got, and the song's length (seconds). */
  reached?: { at: number; of: number };
  /** Overdrive: the highest level reached, how many times it was set off, the points it added. */
  overdrive?: { peak: number; fired: number; bonus: number };
}

interface Props {
  song: Song;
  difficulty: Difficulty;
  result: RunResult;
  previousBest?: number;
  saving: 'saving' | 'saved' | 'error' | 'skipped';
  /** Why it couldn't be saved (the server's words: the controller flagged the run, say). */
  saveError?: string;
  /** What the controller (main.Main on the server) counted for the run. */
  model?: ReadStore<{ state: PlayState | null } | null>;
  /** The kept run's id: the results ask how it felt (FeelAsk). */
  feelRun?: string | null;
  onRetry: () => void;
}

const LABEL: Record<Judgement, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };

function useCountUp(target: number, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const rise = (i: number) => ({
  initial: { opacity: 0, y: 14, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.7, delay: 0.25 + i * 0.08, ease: EASE_OUT },
});

export function Results({ song, difficulty, result, previousBest, saving, saveError, model: modelStore, feelRun, onRetry }: Props) {
  const model = useStore(modelStore ?? NO_MODEL);
  const score = useCountUp(result.score);
  const stars = starsFor(result.grade);
  const newBest = !result.failed && !result.assisted && (previousBest === undefined || result.score > previousBest);
  const timing = result.meanOffsetMs;
  const full = !result.failed && result.counts.miss === 0;
  const od = result.overdrive;

  return (
    <motion.div className="results" role="dialog" aria-modal="true" aria-labelledby="results-title"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
      <div className="results-card">
        {/* A YouTube song replays here, quietly, in the stars' place (centred, and nothing over it). */}
        {song.source.kind === 'youtube' ? (
          <VideoSlot className="results-video" rest={
            <>
              <span className="now-video-art" style={{ '--rA': song.hues[0], '--rB': song.hues[1] } as React.CSSProperties} aria-hidden />
              <span className="now-video-note"><span className="yt-mark" aria-hidden />The song plays again here</span>
            </>
          } />
        ) : result.failed ? (
          <RiveAnim src="result" artboard="Failed" stateMachine="Failed" className="results-anim" fallback={<div className="results-fallback is-failed">✕</div>} />
        ) : (
          <RiveAnim src="result" artboard="Clear" stateMachine="Clear" inputs={{ stars }} className="results-anim"
            fallback={<div className="results-fallback">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>} />
        )}
        <motion.span className="label" {...rise(0)}>{song.title} · {difficulty}</motion.span>
        <motion.h2 id="results-title" {...rise(1)}>{result.failed ? 'The signal dropped' : full ? 'Full combo' : stars === 3 ? 'Flawless build' : 'Song cleared'}</motion.h2>

        <motion.div className="results-main" {...rise(2)}>
          <div className={`grade grade-${result.grade}`} aria-label={`Grade ${result.grade}`}>{result.grade}</div>
          <div className="results-scoreblock">
            <span className="label">Score</span>
            <div className="results-score mono" aria-label={`Score ${result.score}`}>{score.toLocaleString()}</div>
            {newBest && <span className="chip chip-best">New best</span>}
            {!newBest && previousBest !== undefined && !result.assisted && <span className="muted small">Best {previousBest.toLocaleString()}</span>}
            {result.assisted && <span className="chip">Autoplay</span>}
          </div>
        </motion.div>

        {result.failed && result.reached && (
          <motion.div className="reached" {...rise(3)}>
            <span className="label">Reached {fmtTime(Math.round(result.reached.at))} of {fmtTime(Math.round(result.reached.of))}</span>
            <span className="reached-bar" aria-hidden><span style={{ transform: `scaleX(${Math.min(1, result.reached.at / Math.max(1, result.reached.of))})` }} /></span>
          </motion.div>
        )}
        {/* Accuracy and the longest combo on top; every judgement on the row under them. */}
        <motion.dl className="results-stats results-top" {...rise(3)}>
          <div><dt>Accuracy</dt><dd className="mono">{(result.accuracy * 100).toFixed(1)}%</dd></div>
          <div><dt>Max combo</dt><dd className="mono">{result.maxCombo}</dd></div>
        </motion.dl>
        <motion.dl className="results-stats results-counts" {...rise(4)}>
          {(['perfect', 'great', 'good', 'miss'] as Judgement[]).map((j) => (
            <div key={j} className={`stat-${j}`}><dt>{LABEL[j]}</dt><dd className="mono">{result.counts[j]}</dd></div>
          ))}
        </motion.dl>
        {/* Overdrive: how high it went, how often, and what it added (in the peak level's colour). */}
        {od && od.fired > 0 && (
          <motion.div className={`results-od od-${od.peak}`} style={overdriveVars(od.peak) as React.CSSProperties} {...rise(5)}>
            <span className="results-od-pips" aria-hidden>{OVERDRIVE_ROMAN.slice(1).map((_, i) => <i key={i} className={i < od.peak ? 'is-lit' : ''} />)}</span>
            <span className="results-od-text">
              <span className="label">Overdrive</span>
              <span>Peak {OVERDRIVE_ROMAN[od.peak]} · {OVERDRIVE_LOOKS[od.peak].name} · set off {od.fired} {od.fired === 1 ? 'time' : 'times'}</span>
            </span>
            <span className="results-od-bonus mono">+{Math.round(od.bonus).toLocaleString()}</span>
          </motion.div>
        )}
        {/* The controller: the presses Main reviewed, and the score the model confirmed (GameScore). */}
        {model?.state && (
          <motion.p className="results-model muted small" {...rise(5)}>
            <span className="label">Controller</span>{' '}
            {model.state.reviewed} presses reviewed ·{' '}
            {model.state.review && !model.state.review.passed ? <>flagged: {model.state.review.flags.map((f) => f.check).join(', ')} · </> : null}
            {!model.state.confirmed ? 'the run was refused'
              : model.state.confirmed.score === result.score ? <>score confirmed: <span className="mono">{model.state.confirmed.score.toLocaleString()}</span> ✓</>
              : <>the model counted <span className="mono">{model.state.confirmed.score.toLocaleString()}</span> (not the same)</>}
          </motion.p>
        )}
        {timing !== null && Math.abs(timing) >= 15 && !result.assisted && (
          <p className="muted small">You hit {Math.abs(Math.round(timing))} ms {timing < 0 ? 'early' : 'late'} on average. If that feels wrong, adjust the audio offset in Settings.</p>
        )}
        <p className="muted small save-state" aria-live="polite">
          {saving === 'skipped' ? (song.id.startsWith('test-') ? 'Testing ground run: not saved.' : 'Autoplay run: not saved.') : saving === 'saving' ? 'Saving your score' : saving === 'saved' ? 'Score saved.' : saveError ? `Couldn't save this score: ${saveError}` : "Couldn't save this score."}
        </p>

        {saving === 'saved' && feelRun && <FeelAsk key={feelRun} songId={song.id} difficulty={difficulty} run={feelRun} />}

        <motion.div className="results-actions" {...rise(6)}>
          <button type="button" className="btn btn-primary" onClick={onRetry} autoFocus><Icon name="retry" /> Play again <kbd>R</kbd></button>
          <a className="btn" href={href.song(song.id, difficulty)}><Icon name="back" size={16} /> Return to main menu <kbd>Esc</kbd></a>
        </motion.div>
      </div>
    </motion.div>
  );
}
