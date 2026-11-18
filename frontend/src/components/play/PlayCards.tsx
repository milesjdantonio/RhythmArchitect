import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Song } from '../../api/types';
import { keyLabel, laneKeyList, useBinds } from '../../lib/keys';
import { laneHue } from '../../game/render';
import { href } from '../../lib/router';
import { fmtTime } from '../../lib/format';
import { Icon } from '../Icon';
import { EASE_OUT } from '../../lib/motion';

const sourceNote = (song: Song) =>
  song.source.kind === 'stream' ? ' · real audio' : song.source.kind === 'youtube' ? ' · from YouTube' : song.source.standIn ? ' · stand-in audio' : '';

/** Practice mode: a stretch of the song (beats), looped, at a speed (one of PRACTICE_SPEEDS). */
export interface Practice { from: number; to: number; label: string; speed: number }

/**
 * The practice speeds: the ones YouTube's player has (between half and full speed), the same for
 * every song, so a YouTube song plays at exactly the speed its tiles fall at.
 */
export const PRACTICE_SPEEDS = [0.5, 0.75, 1];

/** The shortest loop, in seconds. */
const MIN_LOOP = 3;

/**
 * A practice loop from `a` to `b` (seconds): the whole beats it covers (the start's beat to the
 * end's), labelled by its times.
 */
export function practiceLoop(song: Song, a: number, b: number, speed: number): Practice {
  const spb = 60 / song.bpm;
  const from = Math.max(0, Math.floor(a / spb));
  const to = Math.max(from + 1, Math.min(Math.ceil(song.lengthBeats), Math.ceil(b / spb)));
  return { from, to, label: `${fmtTime(Math.round(a))}–${fmtTime(Math.round(b))}`, speed };
}

/**
 * Before a run: the song, the four keys, then a choice: play the song (how to play), or practise
 * a part (which part, how fast). One button starts whichever is chosen, and says which (Enter does
 * the same: `onChoose` tells the screen). Practice takes the place of the how-to-play text, so the
 * card is the same height either way and fits without scrolling.
 */
export function StartCard({ song, difficulty, starting, milestone, onStart, onChoose }: {
  song: Song; difficulty: Difficulty; starting: boolean; milestone: number; onStart: (practice?: Practice) => void;
  /** What Start would start now (null: the whole song). */
  onChoose?: (practice: Practice | null) => void;
}) {
  const binds = useBinds();
  const [mode, setMode] = useState<'play' | 'practice'>('play');
  const [speed, setSpeed] = useState(0.75);
  const spb = 60 / song.bpm;
  // The loop: a start and an end, in whole seconds, anywhere in the song (at least MIN_LOOP apart).
  const length = Math.max(MIN_LOOP, Math.floor(song.lengthBeats * spb));
  const [[a, b], setLoop] = useState<[number, number]>(() => [0, Math.min(length, 20)]);
  const canPractise = length > MIN_LOOP;
  const practice = useMemo<Practice | null>(() => (mode === 'practice' && canPractise ? practiceLoop(song, a, b, speed) : null), [mode, canPractise, song, a, b, speed]);
  // Where the sections start, as ticks on the loop's track (orientation only).
  const ticks = useMemo(() => (song.report?.sections ?? []).filter((x) => x.beat > 0 && x.beat * spb < length)
    .map((x) => ({ at: (x.beat * spb) / length, label: x.label })), [song, spb, length]);
  useEffect(() => { onChoose?.(practice); }, [practice, onChoose]);
  const pct = Math.round(speed * 100);
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <motion.div className="overlay-card" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }}>
        <span className="label">{difficulty} · {Math.round(song.bpm)} BPM{sourceNote(song)}</span>
        <h1 className={song.title.length > 34 ? 'is-long' : undefined}>{song.title}</h1>
        <p className="overlay-artist">{song.artist}</p>
        <div className="lane-keys" aria-label="Keys">
          {laneKeyList(binds).map((k, i) => (
            <span key={k.code} className="lane-key" style={{ '--h': laneHue(i, 4, song.hues), '--i': i } as React.CSSProperties}><kbd>{k.label}</kbd></span>
          ))}
        </div>
        {canPractise && (
          <div className="start-mode" role="radiogroup" aria-label="Play or practise">
            <button type="button" role="radio" aria-checked={mode === 'play'} className={mode === 'play' ? 'is-on' : ''} onClick={() => setMode('play')}>Play the song</button>
            <button type="button" role="radio" aria-checked={mode === 'practice'} className={mode === 'practice' ? 'is-on' : ''} onClick={() => setMode('practice')}>Practice a part</button>
          </div>
        )}
        {!practice ? (
          <p className="overlay-help">Every tile is a note in the song. Hit it as you hear it; hold the long ones. Every {milestone} in a row lights up the stage, and ×5 starts fever. Accurate hits charge Overdrive: press <kbd>{keyLabel(binds.overdrive)}</kbd> when it's full, and again while it runs, up to three levels (×8). A miss ends it, except in the first few seconds after you press.</p>
        ) : (
            <div className="practice-body">
              <p className="practice-help muted">Drag the start and the end of the loop, and pick a speed. It loops until you pause and stop; nothing is saved and you can't fail.</p>
              <div className="practice-times">
                <span>Start <output className="mono">{fmtTime(a)}</output></span>
                <span className="muted mono">{b - a} s loop</span>
                <span>End <output className="mono">{fmtTime(b)}</output></span>
              </div>
              {/* Two handles on one track: the start can't pass the end (MIN_LOOP between them). */}
              <div className="dual-range" style={{ '--a': `${(a / length) * 100}%`, '--b': `${(b / length) * 100}%` } as React.CSSProperties}>
                {ticks.map((x) => <i key={`${x.at}-${x.label}`} className="dual-range-tick" style={{ left: `${x.at * 100}%` }} title={x.label} />)}
                <input type="range" aria-label="Loop start" min={0} max={length} step={1} value={a} aria-valuetext={fmtTime(a)}
                  style={{ zIndex: a > length - MIN_LOOP * 3 ? 3 : 2 }} onChange={(e) => setLoop([Math.min(Number(e.target.value), b - MIN_LOOP), b])} />
                <input type="range" aria-label="Loop end" min={0} max={length} step={1} value={b} aria-valuetext={fmtTime(b)}
                  onChange={(e) => setLoop([a, Math.max(Number(e.target.value), a + MIN_LOOP)])} />
              </div>
              <div className="practice-speed" role="radiogroup" aria-label="Speed">
                <span>Speed</span>
                {PRACTICE_SPEEDS.map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={speed === v}
                    className={`practice-part mono ${speed === v ? 'is-on' : ''}`} onClick={() => setSpeed(v)}>{Math.round(v * 100)}%</button>
                ))}
              </div>
            </div>
        )}
        <button type="button" className="btn btn-primary" onClick={() => onStart(practice ?? undefined)} autoFocus disabled={starting}>
          <Icon name={practice ? 'retry' : 'play'} /> {starting ? 'Starting' : practice ? `Practise ${practice.label} · ${pct}%` : 'Start'} <kbd>Enter</kbd>
        </button>
        <a className="btn btn-ghost btn-sm" href={href.song(song.id, difficulty)}><Icon name="back" size={16} /> Back</a>
      </motion.div>
    </motion.div>
  );
}

/** Paused: where the song is, then resume, restart or quit (and, practising, stop the practice). */
export function PauseCard({ at, of, onResume, onRestart, onQuit, practice, onStopPractice }: {
  at: number; of: number; onResume: () => void; onRestart: () => void; onQuit: () => void; practice?: Practice | null; onStopPractice?: () => void;
}) {
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="paused-title">
      <motion.div className="overlay-card" initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
        <h1 id="paused-title">Paused</h1>
        <div className="pause-where">
          <span className="mono">{fmtTime(Math.max(0, Math.round(at)))} <span className="muted">/ {fmtTime(Math.round(of))}</span></span>
          <span className="reached-bar is-progress" aria-hidden><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, at / Math.max(1, of)))})` }} /></span>
        </div>
        <button type="button" className="btn btn-primary" onClick={onResume} autoFocus><Icon name="play" /> Resume <kbd>Esc</kbd></button>
        <button type="button" className="btn" onClick={onRestart}><Icon name="retry" /> {practice ? 'Restart the loop' : 'Restart'}</button>
        {practice && <button type="button" className="btn" onClick={onStopPractice}>Stop practising</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onQuit}>Quit</button>
      </motion.div>
    </motion.div>
  );
}
