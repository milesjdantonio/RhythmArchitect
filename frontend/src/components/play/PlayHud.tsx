import { useRef, type Ref } from 'react';
import { motion } from 'motion/react';
import type { Difficulty, Song } from '../../api/types';
import type { BotMode } from '../../game/autoplay';
import type { Judgement } from '../../game/engine';
import { fmtTime } from '../../lib/format';
import { RiveAnim, type RiveHandle } from '../../rive/RiveAnim';
import { Icon } from '../Icon';
import { VideoSlot } from '../VideoSlot';
import { OVERDRIVE_LOOKS, overdriveHue } from '../../game/overdrive';

export interface HudState {
  score: number; combo: number; accuracy: number; health: number; multiplier: number; progress: number; counts: Record<Judgement, number>;
  /** Overdrive's charge (0..1), its level (0 off, 1..5) and what is left of it (0..1). */
  charge: number; overdrive: number; overdriveLeft: number;
}

const COUNTS: [Judgement, string][] = [['perfect', 'Perfect'], ['great', 'Great'], ['good', 'Good'], ['miss', 'Miss']];

interface Props {
  song: Song;
  difficulty: Difficulty;
  section: string;
  hud: HudState;
  /** Whole seconds into the song. */
  clock: number;
  bot: BotMode;
  devTools: boolean;
  canPause: boolean;
  onDev: () => void;
  onPause: () => void;
  combo: Ref<RiveHandle>;
  /** The left panel, so the game can keep the lanes clear of it. */
  panel: Ref<HTMLElement>;
  /** The Overdrive key's name, and setting it off by touch or click. */
  overdriveKey: string;
  onOverdrive: () => void;
  /** Practice mode: what is looping and how fast (nothing is saved). */
  practice?: string;
}

/**
 * The game's heads-up display: a hairline of progress and the song across the top (with the
 * clock, Dev and Pause), and one panel at the top left with everything about the run: score,
 * accuracy, multiplier, combo, signal and counts. A YouTube song's video heads the panel: up there
 * the lanes are narrow and far away, so the panel stays clear of them (they widen toward the
 * bottom of the screen, which is left free). The lanes and the hit line stay centred.
 */
export function PlayHud({ song, difficulty, section, hud, clock, bot, devTools, canPause, onDev, onPause, combo, panel, overdriveKey, onOverdrive, practice }: Props) {
  const length = Math.round((song.lengthBeats * 60) / song.bpm);
  const video = song.source.kind === 'youtube';
  return (
    <>
      <div className="hud-top">
        <div className="hud-line" aria-hidden><span style={{ transform: `scaleX(${hud.progress})` }} /></div>
        <div className="hud-song">
          <span className="hud-title">{song.title}</span>
          <span className="label">{[song.artist, difficulty, section].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="hud-tools">
          <span className="hud-time mono" aria-label="Time">{fmtTime(clock)} <span className="muted">/ {fmtTime(length)}</span></span>
          {bot !== 'off' && <span className="chip hud-bot">Autoplay</span>}
          {practice && <span className="chip hud-practice">{practice}</span>}
          <button type="button" className={`btn btn-sm dev-toggle ${devTools ? 'is-on' : ''}`} onClick={onDev} aria-pressed={devTools} title="Dev tools (`)">Dev</button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onPause} aria-label="Pause" disabled={!canPause}><Icon name="pause" /></button>
        </div>
      </div>

      <aside ref={panel} className={`hud-panel ${video ? 'has-video' : ''}`} aria-label="Run">
        {video && (
          <VideoSlot className="hud-video" rest={
            <>
              <span className="now-video-art" style={{ '--rA': song.hues[0], '--rB': song.hues[1] } as React.CSSProperties} aria-hidden />
              <span className="now-video-note"><span className="yt-mark" aria-hidden />The video plays here with the song</span>
            </>
          } />
        )}
        <div className="hud-stat hud-score-block">
          <span className="label">Score</span>
          <ScoreGain score={hud.score} />
          <motion.span key={hud.score} className="hud-score mono" initial={{ scale: hud.score ? 1.06 : 1 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 800, damping: 20 }}>{hud.score.toLocaleString()}</motion.span>
        </div>
        <div className="hud-pair">
          <div className="hud-stat">
            <span className="label">Accuracy</span>
            <span className="hud-acc mono">{(hud.accuracy * 100).toFixed(1)}%</span>
          </div>
          <div className="hud-stat">
            <span className="label">Multiplier</span>
            <span className={`hud-mult mono ${hud.overdrive ? 'is-overdrive' : hud.multiplier >= 5 ? 'is-fever' : ''}`}>×{hud.multiplier}</span>
          </div>
        </div>
        <div className="hud-stat hud-combo-block">
          <span className="label">Combo</span>
          <div className="hud-combo-row">
            <motion.span key={hud.combo} className="hud-combo mono" initial={{ scale: hud.combo ? 1.22 : 1, opacity: 0.7 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 700, damping: 18 }}>{hud.combo}</motion.span>
            <RiveAnim ref={combo} src="combo" stateMachine="Combo" className="combo-meter"
              fallback={<span className="combo-fallback" data-level={hud.combo ? Math.min(5, hud.multiplier - hud.overdrive) : 0}><i /><i /><i /><i /><i /></span>} />
          </div>
        </div>
        <Overdrive hud={hud} keyName={overdriveKey} onFire={onOverdrive} />
        <div className="hud-stat">
          <span className="label">Signal</span>
          <div className="hud-health" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.health * 100)}>
            <span style={{ transform: `scaleX(${hud.health})` }} className={hud.health < 0.3 ? 'is-low' : ''} />
          </div>
        </div>
        <dl className="hud-counts">
          {COUNTS.map(([j, label]) => <div key={j} className={`hud-count stat-${j}`}><dt className="label">{label}</dt><dd className="mono">{hud.counts[j]}</dd></div>)}
        </dl>
      </aside>
    </>
  );
}

/**
 * Overdrive: the charge filling (a bar), then, full, a cue to press its key (a button too, for
 * touch). While it runs: its level as five pips in the level's colour, the bar showing what is left.
 */
function Overdrive({ hud, keyName, onFire }: { hud: HudState; keyName: string; onFire: () => void }) {
  const level = hud.overdrive;
  const ready = hud.charge >= 1;
  const look = OVERDRIVE_LOOKS[level];
  const hue = overdriveHue(level || 1, 1, 0);
  const fill = level ? (ready ? 1 : hud.overdriveLeft) : hud.charge;
  return (
    <div className={`hud-stat hud-od ${ready ? 'is-ready' : ''} ${level ? `is-on od-${level}` : ''}`} style={{ '--od': hue } as React.CSSProperties}>
      <div className="hud-od-head">
        <span className="label">{level ? `Overdrive · ${look.name}` : 'Overdrive'}</span>
        <span className="hud-od-pips" aria-label={`Level ${level} of 5`}>{[1, 2, 3, 4, 5].map((k) => <i key={k} className={k <= level ? 'is-lit' : ''} />)}</span>
      </div>
      <div className="hud-od-bar" role="meter" aria-label={level ? 'Overdrive left' : 'Overdrive charge'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill * 100)}>
        <span style={{ transform: `scaleX(${fill})` }} />
        {level > 0 && <span className="hud-od-charge" style={{ transform: `scaleX(${hud.charge})` }} />}
      </div>
      {ready && (
        <button type="button" className="btn btn-sm hud-od-fire" onClick={onFire} onPointerDown={(e) => e.stopPropagation()}>
          {level >= 5 ? 'Keep it going' : level ? `Overdrive ${level + 1}` : 'Overdrive ready'} <kbd>{keyName}</kbd>
        </button>
      )}
    </div>
  );
}

/** What the last few hits scored: "+4,000" flashing beside the score as it climbs. */
function ScoreGain({ score }: { score: number }) {
  const last = useRef(score);
  const gain = useRef(0);
  if (score !== last.current) { gain.current = Math.max(0, score - last.current); last.current = score; }
  if (!gain.current || !score) return null;
  return (
    <motion.span key={score} className="hud-gain mono" aria-hidden initial={{ opacity: 1, y: 0 }} animate={{ opacity: 0, y: -10 }} transition={{ duration: 0.7, ease: 'easeOut' }}>
      +{gain.current.toLocaleString()}
    </motion.span>
  );
}
