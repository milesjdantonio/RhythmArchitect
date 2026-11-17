import { useMemo, useState } from 'react';
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

/** Practice mode: a stretch of the song (beats), looped, at a speed (0.5..1). */
export interface Practice { from: number; to: number; label: string; speed: number }

/** The stretches a song can be practised in: its sections from the map, or its quarters. */
export function practiceStretches(song: Song): { from: number; to: number; label: string }[] {
  const end = song.lengthBeats;
  const secs = (song.report?.sections ?? []).filter((x) => x.beat < end).sort((a, b) => a.beat - b.beat);
  const out = secs.map((x, i) => ({ from: x.beat, to: secs[i + 1]?.beat ?? end, label: x.label || `Part ${i + 1}` }))
    .filter((x) => x.to - x.from >= 4);
  if (out.length >= 2) {
    // The same name twice (verse, verse): numbered.
    const seen = new Map<string, number>();
    for (const x of out) { const n = (seen.get(x.label) ?? 0) + 1; seen.set(x.label, n); if (n > 1) x.label = `${x.label} ${n}`; }
    return out;
  }
  const q = Math.max(4, Math.floor(end / 4));
  return [0, 1, 2, 3].map((k) => ({ from: k * q, to: k === 3 ? end : (k + 1) * q, label: `Quarter ${k + 1}` })).filter((x) => x.to > x.from);
}

/** Before a run: the song, the four keys, how to play, Start (or practise a stretch). */
export function StartCard({ song, difficulty, starting, milestone, onStart }: {
  song: Song; difficulty: Difficulty; starting: boolean; milestone: number; onStart: (practice?: Practice) => void;
}) {
  const binds = useBinds();
  const stretches = useMemo(() => practiceStretches(song), [song]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [speed, setSpeed] = useState(0.75);
  const spb = 60 / song.bpm;
  const chosen = stretches[Math.min(pick, stretches.length - 1)];
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
        <p className="overlay-help">Every tile is a note in the song. Hit it as you hear it; hold the long ones. Every {milestone} in a row lights up the stage, and ×5 starts fever. Accurate hits charge Overdrive: press <kbd>{keyLabel(binds.overdrive)}</kbd> when it's full, and again while it runs, up to five times for ×10.</p>
        <button type="button" className="btn btn-primary" onClick={() => onStart()} autoFocus disabled={starting}>
          <Icon name="play" /> {starting ? 'Starting' : 'Start'} <kbd>Enter</kbd>
        </button>
        <div className={`practice ${open ? 'is-open' : ''}`}>
          <button type="button" className="btn btn-ghost btn-sm practice-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            Practice a part {open ? '▴' : '▾'}
          </button>
          {open && chosen && (
            <div className="practice-body">
              <p className="practice-help muted">Loops one part until you stop it, slowed down if you like. Nothing is saved and you can't fail.</p>
              <div className="practice-parts" role="radiogroup" aria-label="Part to practise">
                {stretches.map((x, i) => (
                  <button key={`${x.from}-${x.label}`} type="button" role="radio" aria-checked={i === pick}
                    className={`practice-part ${i === pick ? 'is-on' : ''}`} onClick={() => setPick(i)}>
                    {x.label} <span className="muted mono">{fmtTime(Math.round(x.from * spb))}</span>
                  </button>
                ))}
              </div>
              <label className="practice-speed">
                <span>Speed</span>
                <input type="range" min={0.5} max={1} step={0.01} value={speed} aria-valuetext={`${Math.round(speed * 100)}%`}
                  style={{ '--p': `${((speed - 0.5) / 0.5) * 100}%` } as React.CSSProperties} onChange={(e) => setSpeed(Number(e.target.value))} />
                <output className="mono">{Math.round(speed * 100)}%</output>
              </label>
              {song.source.kind === 'youtube' && speed < 1 && <p className="practice-help muted">YouTube plays at the nearest speed it has.</p>}
              <button type="button" className="btn btn-sm" disabled={starting}
                onClick={() => onStart({ from: chosen.from, to: chosen.to, label: chosen.label, speed })}>
                <Icon name="retry" /> Practise {chosen.label}
              </button>
            </div>
          )}
        </div>
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
