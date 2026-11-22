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
  /** How far the whole build has got (0..1: buildProgress), and what it's doing (title case). */
  progress: number;
  label?: string;
  /** Why it fell back to a fan chart. */
  note?: string;
  /** Listening didn't work (ready step): what went wrong. */
  problem?: string;
}

const stageOf: Record<Flow['step'], number> = { find: 0, ready: 1, listen: 1, map: 2, chart: 3, fan: 1, done: 4 };

/** Words kept lower case inside a title ("Finding the Beat"). */
const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'up', 'as', 'into', 'from', 'with']);
/** "finding the beat" → "Finding the Beat" (words already capitalised, like Easy, stay). */
export function titleCase(s: string): string {
  return s.split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/**
 * Where a build has got, 0..1, from the step and the progress inside it: each step takes its share
 * of the time. Two ways a build goes (the listen the same share in both):
 *
 *   split: WebGPU splits the song, its parts' notes are heard and the charts come from its lines.
 *          Measured on the bank's 8 songs remapped Nov 22 (88-298 s): listening 42-56% of the
 *          build, the split 38-42%, the notes (the singing and the instruments) 5-16%, the charts
 *          under a second. (Before, the trained mapper's steps took 74-95% of the bar, and they
 *          don't run on these: it waited at 74% while the instruments were heard, then jumped to
 *          100%. The user, Nov 22.)
 *   whole: no split: the trained mapper charts the song after the listen.
 */
const BUILDS = {
  split: {
    find: [0, 0.02], listen: [0.02, 0.5], beat: [0.5, 0.51], split: [0.51, 0.87], notes: [0.87, 0.88],
    voice: [0.88, 0.97], load: [0.97, 0.972], ai: [0.972, 0.976], chart: [0.976, 0.99], save: [0.99, 1],
    fan: [0.02, 0.9],
  },
  whole: {
    find: [0, 0.02], listen: [0.02, 0.5], beat: [0.5, 0.53], split: [0.53, 0.53], notes: [0.53, 0.55],
    voice: [0.55, 0.55], load: [0.55, 0.62], ai: [0.62, 0.75], chart: [0.75, 0.97], save: [0.97, 1],
    fan: [0.02, 0.9],
  },
} as const;
export type BuildWay = keyof typeof BUILDS;
/** The listen's share (the same both ways: the dialog counts the song's time from it). */
export const BUILD = BUILDS.split;
export const buildProgress = (part: keyof typeof BUILD, p = 0, way: BuildWay = 'split') =>
  BUILDS[way][part][0] + (BUILDS[way][part][1] - BUILDS[way][part][0]) * Math.max(0, Math.min(1, p));


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
  const stageIndex = flow ? stageOf[flow.step] : 0;
  const pct = flow ? Math.round((flow.step === 'done' ? 1 : flow.progress) * 100) : 0;
  const label = !flow ? '' : flow.step === 'done' ? 'Mapped' : flow.label ?? (flow.step === 'find' ? 'Finding the Song on YouTube' : flow.step === 'fan' ? 'Finding a Fan-Made Chart' : 'Mapping');
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
                {/* What's happening, then the whole build's progress, its percentage in the bar. */}
                <p className="build-now" aria-live="polite">{label}{flow.step === 'listen' && flow.video?.seconds
                  ? <span className="mono muted"> · {fmtTime(Math.round(Math.max(0, (flow.progress - BUILD.listen[0]) / (BUILD.listen[1] - BUILD.listen[0])) * flow.video.seconds))} / {fmtTime(Math.round(flow.video.seconds))}</span> : null}</p>
                <div className="build-bar" role="progressbar" aria-label="Building the map" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <span className="build-fill" style={{ transform: `scaleX(${pct / 100})` }} />
                  <b className="build-pct mono">{pct}%</b>
                </div>
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
