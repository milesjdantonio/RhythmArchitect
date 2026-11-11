import { useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { VideoMatch } from '../../api/types';
import { fmtTime } from '../../lib/format';
import { EASE_OUT } from '../../lib/motion';
import { RiveAnim } from '../../rive/RiveAnim';
import { Icon } from '../Icon';
import { huesFor } from '../../mapping/osu';
import { ListenAura, type AuraHandle } from './ListenAura';
import { ListenScope, type ScopeHandle, type ScopePhase } from './ListenScope';
import { VideoSlot } from '../VideoSlot';

/**
 * Generating a beatmap, step by step:
 *   find   — the song's video on YouTube (it plays from there; its audio is never downloaded)
 *   ready  — the video is shown; the player says go (the browser then asks to share this tab's
 *            sound). If listening fails (sharing turned down or stopped part-way), it comes back
 *            here with the problem, and the button tries again.
 *   listen — the video plays once while the browser listens
 *   map    — the mapper finds the beat and every note (in the browser)
 *   chart  — the trained mapper (in the browser) charts the song, all three difficulties; then it's saved
 *   fan    — browsers that can't share a tab's sound: a fan-made osu! chart, lined up with the video
 */
export interface Flow {
  step: 'find' | 'ready' | 'listen' | 'map' | 'chart' | 'fan' | 'done';
  video?: VideoMatch;
  progress: number;
  /** Why it fell back to a fan chart. */
  note?: string;
  /** Listening didn't work (ready step): what went wrong. */
  problem?: string;
}

const LISTEN_STAGES = ['Finding the song on YouTube', 'Listening to it once', 'Finding the beat and every note', 'Charting Easy, Medium and Hard'];
const FAN_STAGES = ['Finding the song on YouTube', 'Finding a fan-made chart', 'Lining it up with the video', 'Shaping Easy, Medium and Hard'];
const stageOf: Record<Flow['step'], number> = { find: 0, ready: 1, listen: 1, map: 2, chart: 3, fan: 1, done: 4 };


/**
 * The Generate beatmap dialog, over everything: the video (once found), the listening scope, the
 * step the AI is on, and the choices (listen, cancel). NameSong runs the flow.
 */
export function GenerateDialog({ flow, asked, scope, onListen, onCancel }: {
  flow: Flow | null;
  asked: { title: string; artist: string };
  scope: RefObject<ScopeHandle | null>;
  onListen: () => void;
  onCancel: () => void;
}) {
  const fan = flow?.step === 'fan' || (flow?.step === 'done' && !!flow.note);
  const stages = fan ? FAN_STAGES : LISTEN_STAGES;
  const stageIndex = flow ? stageOf[flow.step] : 0;
  const showVideo = flow?.step === 'ready' || flow?.step === 'listen';
  // The scope stays from listening through mapping to the finished map (not for fan charts).
  const showScope = !!flow && (flow.step === 'listen' || flow.step === 'map' || flow.step === 'chart' || (flow.step === 'done' && !flow.note));
  const aura = useRef<AuraHandle>(null);
  const phase: ScopePhase = flow?.step === 'map' ? 'map' : flow?.step === 'chart' ? 'chart' : flow?.step === 'done' ? 'done' : 'listen';
  // The song's own colours (the same ones it gets once mapped).
  const hues = flow?.video ? huesFor(`${flow.video.songTitle} ${flow.video.songArtist}`.toLowerCase()) : undefined;

  return createPortal(
    <AnimatePresence>
      {flow && (
        <motion.div className={`composing ${showScope ? 'is-listening' : ''}`} role="dialog" aria-modal="true" aria-labelledby="composing-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={hues ? ({ '--hA': hues[0], '--hB': hues[1] } as React.CSSProperties) : undefined}>
          {showScope && <ListenAura ref={aura} phase={phase} hues={hues} />}
          <motion.div className={`composing-card ${showVideo || showScope ? 'has-video' : ''}`} initial={{ scale: 0.94, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 1.04, opacity: 0 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
            {showVideo || showScope
              ? <div className="listen-media">
                  <VideoSlot className="composing-video" label={flow.video ? `${flow.video.title} · ${flow.video.channel}` : 'YouTube'} idle="show" />
                  {showScope && <ListenScope ref={scope} seconds={flow.video?.seconds ?? 0} phase={phase} hues={hues} aura={aura} />}
                </div>
              : <RiveAnim src="composing" stateMachine="Composing" inputs={{ stage: stageIndex }} className="composing-anim"
                  fallback={<div className="composing-fallback"><span /><span /><span /></div>} />}
            <h2 id="composing-title">{flow.step === 'listen' && <span className="live-dot" aria-hidden />}{flow.step === 'done' ? 'Mapped' : flow.step === 'ready' ? 'Ready to listen' : flow.step === 'listen' ? 'Listening' : 'Mapping'}</h2>
            <p className="composing-prompt">{asked.title}{asked.artist && <span> · {asked.artist}</span>}</p>
            {flow.step === 'ready' ? (
              <div className="listen-ask">
                {flow.problem
                  ? <p className="listen-problem" role="alert">{flow.problem}</p>
                  : <p className="small">The song plays once while the AI maps it. When asked, share <span className="ink">this tab</span> with its audio.</p>}
                <div className="listen-actions">
                  <button type="button" className="btn btn-primary" onClick={onListen} autoFocus><Icon name={flow.problem ? 'retry' : 'wave'} size={16} /> {flow.problem ? 'Try again' : 'Listen and map'}</button>
                </div>
              </div>
            ) : (
              <>
                {flow.note && <p className="small muted listen-note">{flow.note}</p>}
                <ol className={`stages ${showScope ? 'is-compact' : ''}`}>
                  {stages.map((label, i) => (
                    <li key={label} className={i < stageIndex ? 'is-done' : i === stageIndex ? 'is-now' : ''} aria-current={i === stageIndex ? 'step' : undefined}>
                      <span className="stage-dot" aria-hidden>{i < stageIndex ? <Icon name="check" size={11} /> : null}</span>
                      <span className="stage-label">{label}</span>{flow.step === 'listen' && i === 1 ? <span className="mono muted"> {flow.video?.seconds ? `${fmtTime(Math.round(flow.progress * flow.video.seconds))} / ${fmtTime(Math.round(flow.video.seconds))}` : `${Math.round(flow.progress * 100)}%`}</span> : null}
                    </li>
                  ))}
                </ol>
                <div className="progress" aria-hidden><span style={{ transform: `scaleX(${flow.step === 'listen' ? flow.progress : flow.step === 'done' ? 1 : (stageIndex + 0.5) / 4})` }} /></div>
              </>
            )}
            {flow.step !== 'done' && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
