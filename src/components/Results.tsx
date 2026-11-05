import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Grade, Song } from '../api/types';
import type { Judgement } from '../game/engine';
import { starsFor } from '../game/engine';
import { RiveAnim } from '../rive/RiveAnim';
import { href } from '../lib/router';
import { Icon } from './Icon';
import { VideoSlot } from './VideoSlot';
import { fmtTime } from '../lib/format';
import { EASE_OUT } from '../lib/motion';

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
}

interface Props {
  song: Song;
  difficulty: Difficulty;
  result: RunResult;
  previousBest?: number;
  saving: 'saving' | 'saved' | 'error' | 'skipped';
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

export function Results({ song, difficulty, result, previousBest, saving, onRetry }: Props) {
  const score = useCountUp(result.score);
  const stars = starsFor(result.grade);
  const newBest = !result.failed && !result.assisted && (previousBest === undefined || result.score > previousBest);
  const timing = result.meanOffsetMs;
  const full = !result.failed && result.counts.miss === 0;

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
        {timing !== null && Math.abs(timing) >= 15 && !result.assisted && (
          <p className="muted small">You hit {Math.abs(Math.round(timing))} ms {timing < 0 ? 'early' : 'late'} on average. If that feels wrong, adjust the audio offset in Settings.</p>
        )}
        <p className="muted small save-state" aria-live="polite">
          {saving === 'skipped' ? 'Autoplay run: not saved.' : saving === 'saving' ? 'Saving your score' : saving === 'saved' ? 'Score saved.' : "Couldn't save this score."}
        </p>

        <motion.div className="results-actions" {...rise(5)}>
          <button type="button" className="btn btn-primary" onClick={onRetry} autoFocus><Icon name="retry" /> Play again <kbd>R</kbd></button>
          <a className="btn" href={href.song(song.id, difficulty)}><Icon name="back" size={16} /> Return to main menu <kbd>Esc</kbd></a>
        </motion.div>
      </div>
    </motion.div>
  );
}
