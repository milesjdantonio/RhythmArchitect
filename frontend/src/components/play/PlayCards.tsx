import { motion } from 'motion/react';
import type { Difficulty, Song } from '../../api/types';
import { KEYS } from '../../game/engine';
import { laneHue } from '../../game/render';
import { href } from '../../lib/router';
import { fmtTime } from '../../lib/format';
import { Icon } from '../Icon';
import { EASE_OUT } from '../../lib/motion';

const sourceNote = (song: Song) =>
  song.source.kind === 'stream' ? ' · real audio' : song.source.kind === 'youtube' ? ' · from YouTube' : song.source.standIn ? ' · stand-in audio' : '';

/** Before a run: the song, the four keys, how to play, Start. */
export function StartCard({ song, difficulty, starting, milestone, onStart }: {
  song: Song; difficulty: Difficulty; starting: boolean; milestone: number; onStart: () => void;
}) {
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <motion.div className="overlay-card" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }}>
        <span className="label">{difficulty} · {Math.round(song.bpm)} BPM{sourceNote(song)}</span>
        <h1 className={song.title.length > 34 ? 'is-long' : undefined}>{song.title}</h1>
        <p className="overlay-artist">{song.artist}</p>
        <div className="lane-keys" aria-label="Keys">
          {KEYS.map((k, i) => (
            <span key={k.code} className="lane-key" style={{ '--h': laneHue(i, 4, song.hues), '--i': i } as React.CSSProperties}><kbd>{k.label}</kbd></span>
          ))}
        </div>
        <p className="overlay-help">Every tile is a note in the song. Hit it as you hear it; hold the long ones. Every {milestone} in a row lights up the stage, and ×4 starts fever.</p>
        <button type="button" className="btn btn-primary" onClick={onStart} autoFocus disabled={starting}>
          <Icon name="play" /> {starting ? 'Starting' : 'Start'} <kbd>Enter</kbd>
        </button>
        <a className="btn btn-ghost btn-sm" href={href.song(song.id, difficulty)}><Icon name="back" size={16} /> Back</a>
      </motion.div>
    </motion.div>
  );
}

/** Paused: where the song is, then resume, restart or quit. */
export function PauseCard({ at, of, onResume, onRestart, onQuit }: { at: number; of: number; onResume: () => void; onRestart: () => void; onQuit: () => void }) {
  return (
    <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="paused-title">
      <motion.div className="overlay-card" initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
        <h1 id="paused-title">Paused</h1>
        <div className="pause-where">
          <span className="mono">{fmtTime(Math.max(0, Math.round(at)))} <span className="muted">/ {fmtTime(Math.round(of))}</span></span>
          <span className="reached-bar is-progress" aria-hidden><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, at / Math.max(1, of)))})` }} /></span>
        </div>
        <button type="button" className="btn btn-primary" onClick={onResume} autoFocus><Icon name="play" /> Resume <kbd>Esc</kbd></button>
        <button type="button" className="btn" onClick={onRestart}><Icon name="retry" /> Restart</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onQuit}>Quit</button>
      </motion.div>
    </motion.div>
  );
}
